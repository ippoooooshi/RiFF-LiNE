#!/usr/bin/env node
// 網羅台帳 段階1+2: 構造単位への分割と、要求数の下限推定。
//
// なぜこれがあるか:
//   「上位を全行読め」と AI に指示する方式は、読んだことを検証できないため機能しなかった。
//   対応表方式・検証キー方式も試して両方すり抜けた（キーは書く側が選ぶため、
//   見落としているものは原理的にキーにならない）。
//   そこで列挙は機械の仕事にする。機械は間引かない。間引きは「対象外」という
//   判定であり、記録に残さなければならない。
//
// 下限推定の意味:
//   1つの表の行に複数の要求が畳み込まれていると、「対応する設計あり → 一致」で
//   通ってしまう。実際、要件4.1 の28行には61件の要求が入っていた（平均2.18）。
//   区切り記号・「両方」「ハイブリッド」を機械が数え、分解件数がこの下限を
//   下回ったら decompose を fail させる。
//
// 使い方:
//   node .claude/scripts/split.mjs <tierId> [--json] [--dry-run]
//   node .claude/scripts/split.mjs --all [--dry-run]
//     **既定で .claude/coverage/units/<tierId>.jsonl を書き換える。** 見るだけなら --dry-run
//   node .claude/scripts/split.mjs --coverage [--show-skipped]   # 分割が全行を覆っているかの検算
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { ROOT, config, tier, tierFiles, read, json } from './lib/config.mjs'
import { hasOpenEnum } from './lib/wording.mjs'
import { extractApi, extractTests, extractorMode } from './lib/ts-api.mjs'

const COVERAGE = join(ROOT, '.claude', 'coverage')

// ── 段階2 で使う検出パターン ────────────────────────────────────────────
const SEP   = /[／\/、，＋\+･・]|および|かつ|ならびに|\band\b/g
const BOTH  = /両方|いずれも|すべて|全て|全部|双方|ともに|必須/
const HYBRID= /ハイブリッド|併用|切替|切り替え|選択可能|または|もしくは/
// 列挙の未閉鎖は **lib/wording.mjs の定義を使う。** ここで別に書かない——
// req-add.mjs と別々の定義を持っていて、「といった」「のような」が片方だけ、
// 「〜」がもう片方だけ、という状態だった（2026-09-16 に統合）。
const RETRACT = /~~/

// 区切りを数える前に、区切りでないスラッシュを落とす。
//   docs/basic_design/04_editing_core.md → 「／」2 個として数えられていた。
// 設計書でパスを書くのは日常なので、これを数えると全域で下限が水増しされる。
// 落とすのは「パスだと確信できる形」だけ:
//   - インラインコード `…`
//   - URL
//   - スラッシュを含み、かつ 拡張子で終わる／末尾がスラッシュ／glob を含む もの
// alphaTab/MIDI のような ASCII 2 語の併記は**残す**（本物の区切りなので）。
const CODE_SPAN = /`[^`]*`/g
const URL       = /https?:\/\/\S+/g
// コメント記号のスラッシュを区切りとして数えない。
// `setTempo(bpm: number): void  // 20〜300、範囲外は例外` が sep:3（本来は 1）になっていた。
const COMMENT_MARK = /\/\/|\/\*|\*\//g
const PATHISH   = /[A-Za-z0-9_.\-*]+(?:\/[A-Za-z0-9_.\-*]+)+\/?/g
export function stripNonSeparators(s) {
  return String(s)
    .replace(CODE_SPAN, ' ')
    .replace(URL, ' ')
    .replace(COMMENT_MARK, ' ')
    .replace(PATHISH, m => (/\.[A-Za-z0-9]+$/.test(m) || m.endsWith('/') || m.includes('*')) ? ' ' : m)
}

// ── 段階1: 分割 ─────────────────────────────────────────────────────────
// **抽出ではなく分割（partition）である。** 文書の全行がちょうど 1 つ以上の単位に属し、
// 判定対象でない行も「なぜ対象外か」を持った単位として残る。
//
// なぜこの形か:
//   旧実装は「要求らしいものを抽出する」形だった。結果、コードフェンスの中身が
//   丸ごと消え（`setTempo(bpm: number): void // 20〜300、範囲外は例外` が分母に入らない）、
//   逆に水平線と HTML コメントが「要求」として分母に入っていた。
//   抽出方式だと **拾えなかったものは存在自体が見えない**。分割方式なら、
//   拾わなかったものも単位として残り、理由が付き、件数が出る。
//   `split.mjs --coverage` が「総行数 = 覆った行数」を検算する。
const HR        = /^(-{3,}|\*{3,}|_{3,})\s*$/
const TABLE_SEP = /^\|[\s:|\-]+\|\s*$/
const FENCE     = /^(`{3,}|~{3,})\s*(\S*)/

// フェンス内で「宣言」とみなす行。ここだけが判定対象になる。
// 設計書のコードブロックは interface / メソッドシグネチャを置く場所なので、
// 1 宣言 = 1 要求として分母に入れる。波括弧だけの行や実行例は対象外。
const DECL_KEYWORD = /^(export|import|public|private|protected|readonly|static|abstract|async|function|class|interface|type|enum|const|let|var|def|fn|struct|impl|trait|namespace|declare)\b/
export function isDeclLine(l) {
  const t = String(l).trim()
  if (!t) return false
  if (/^[)\]}{,;]+$/.test(t)) return false          // 閉じ括弧・区切りだけの行
  if (/^(\/\/|#|\*|<!--|\/\*)/.test(t)) return false // コメントだけの行
  if (DECL_KEYWORD.test(t)) return true
  // 識別子のあとに ( か : が来る形（メソッド・プロパティ宣言）
  if (/^[A-Za-z_$][\w$]*\s*\??\s*[(:]/.test(t)) return true
  return false
}

// 図の記述言語。**中身は図であって、要求の文ではない。**
//
// 実測（2026-09-15）: mermaid のフェンス内 1,061 行が判定対象の単位になっていた。
//   [下限 2] subgraph UI["UI層（画面群パッケージ、既存）"]
//   [下限 2] EDIT1 -->|パネル表示切替| MIXER["ミキサーパネル(非モーダル)"]
// 「、」や「切替」が区切り・ハイブリッドとして数えられ、**図の 1 行に「最低 2 件に
// 分解せよ」が出ていた**。正直にやる道が無いので、水増しを学習させるだけになる。
// 1 行ずつ理由を書いて外すこともできる（分解の skip）が、1,000 行に手で理由を書くのは
// 作業ではなく儀式なので、**構造で外す**。
//
// **消すのではなく「対象外」にする。** units には理由つきで残るので
// `--coverage` の全行の覆いは保たれ、`--show-skipped` で目視できる。
export function isDiagramFence(lang) {
  return /^(mermaid|plantuml|puml|dot|graphviz|nomnoml|wavedrom|vega|vega-lite)$/i.test(String(lang || ''))
}
// 言語指定が無い／テキスト系のフェンス。中身がコードとは限らない。
// **tree / ascii はここに残す。** 実測でモジュール名や責務が書かれていた例がある
//   └─ Undo/Redo・バリデーション等のロジック層
// 図だが中身は要求に届きうるので、機械では外さず 1 行ずつ判断させる。
export function isTextFence(lang) { return !lang || /^(text|txt|plain|none|tree|ascii)$/i.test(lang) }
// 罫線・区切り・記号だけの行。図の枠であって要求ではない。
export function isStructuralLine(l) {
  const t = String(l).trim()
  if (!t) return true
  return !/[A-Za-z0-9ぁ-んァ-ヴ一-龥]/.test(t) || /^[\s│├└┌┐┘┬┴┼─━|+\-=*_.·•~^<>()\[\]]+$/.test(t)
}

export function splitMarkdown(rel, src) {
  const lines = src.split('\n')
  const units = []
  let headingPath = []
  let inFence = false, fenceChar = '', fenceLang = ''
  let inHtmlComment = false, inFrontmatter = false
  let tableState = 'none'   // none | header | body

  const add = (no, kind, text, opts = {}) => {
    const u = mk(rel, no, kind, text, headingPath.join(' > '), opts.cells || null)
    if (opts.skip) { u.minReq = 0; u.judge = false; u.skipReason = opts.skip }
    else u.judge = u.minReq > 0
    if (opts.lang) u.lang = opts.lang
    units.push(u)
  }

  lines.forEach((raw, i) => {
    const no = i + 1
    const line = raw.trim()

    // フロントマター（先頭の --- で始まるブロック）
    if (no === 1 && line === '---') { inFrontmatter = true; add(no, 'frontmatter', raw, { skip: 'フロントマター' }); return }
    if (inFrontmatter) { add(no, 'frontmatter', raw, { skip: 'フロントマター' }); if (line === '---') inFrontmatter = false; return }

    // コードフェンス
    const fm = !inFence && line.match(FENCE)
    if (fm) { inFence = true; fenceChar = fm[1][0]; fenceLang = fm[2] || ''
      add(no, 'fence-open', line, { skip: 'フェンス記号', lang: fenceLang }); return }
    if (inFence) {
      if (new RegExp('^\\' + fenceChar + '{3,}\\s*$').test(line)) {
        inFence = false; add(no, 'fence-close', line, { skip: 'フェンス記号' }); return
      }
      if (!line) { add(no, 'blank', raw, { skip: '空行' }); return }
      if (isDeclLine(line)) { add(no, 'code-decl', line, { lang: fenceLang }); return }
      // **言語指定の無いフェンスは、コードとは限らない。**
      // 構成図・ディレクトリツリー・箇条書きがここに入ることが多く、v22 はそれを
      // 一律「コード本体」として判定対象から外していた。実例: 要件定義書 6 章の
      // 構成図にある「Windows上でビルド・実行可能」「（Mac不要）」が分母から消えていた。
      // 罫線・区切りだけの行は落とし、文字のある行は本文として扱う。
      if (isDiagramFence(fenceLang)) {
        add(no, 'diagram-line', line, { skip: `図の記述（${fenceLang}）`, lang: fenceLang }); return
      }
      if (isTextFence(fenceLang)) {
        if (isStructuralLine(line)) { add(no, 'diagram-line', line, { skip: '図の罫線・区切り', lang: fenceLang }); return }
        add(no, 'sentence', line, { lang: fenceLang }); return
      }
      add(no, 'code-line', line, { skip: 'コード本体（宣言行でない）', lang: fenceLang }); return
    }

    // HTML コメント
    if (!inHtmlComment && /^<!--/.test(line)) {
      inHtmlComment = !/-->/.test(line); add(no, 'html-comment', line, { skip: 'HTML コメント' }); return
    }
    if (inHtmlComment) { if (/-->/.test(line)) inHtmlComment = false; add(no, 'html-comment', line, { skip: 'HTML コメント' }); return }

    if (!line) { tableState = 'none'; add(no, 'blank', raw, { skip: '空行' }); return }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      headingPath = headingPath.slice(0, h[1].length - 1); headingPath.push(h[2])
      tableState = 'none'
      add(no, 'heading', line, { skip: '見出し（配下の本文で判定する）' }); return
    }

    if (/^\|/.test(line)) {
      if (TABLE_SEP.test(line) && tableState === 'header') { tableState = 'body'; add(no, 'table-sep', line, { skip: '表の区切り' }); return }
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (tableState === 'body') { add(no, 'table-row', line, { cells }); return }
      tableState = 'header'
      add(no, 'table-header', line, { skip: '表の見出し行', cells }); return
    }
    tableState = 'none'

    // 水平線と HTML コメントは要求ではない。旧実装はこれを sentence として
    // 分母に入れていた（偽の分母。判定コストも無駄に増える）
    if (HR.test(line)) { add(no, 'hr', line, { skip: '水平線' }); return }

    if (/^[-*+]\s|^\d+\.\s|^-\s*\[[ x]\]/.test(line)) { add(no, 'list-item', line); return }

    // 段落・引用は文で割る（半分だけ降りている型を検出するため、段落のまま残さない）
    const quoted = /^>/.test(line)
    const body = quoted ? line.replace(/^>\s?/, '') : line
    const parts = body.split(/(?<=。)/).map(x => x.trim()).filter(Boolean)
    if (!parts.length) { add(no, 'blank', raw, { skip: '空行' }); return }
    parts.forEach(x => add(no, quoted ? 'quote' : 'sentence', x))
  })
  return finalizeIds(units)
}

// ── 単位の同一性 ────────────────────────────────────────────────────────
// 2 つの鍵を持たせる。
//   id     … ファイル＋本文ハッシュ（＋同一本文の出現順）。**行が動いても変わらない。**
//   anchor … ファイル＋見出しパス＋種別（＋その中の出現順）。**本文が変わっても残る。**
// id で引き継げば「行がずれただけ」、anchor だけで引き継げば「同じ場所の本文が変わった」。
// 後者を検出できるようにするのが anchor の役目で、v22 の `stale` が構造的に
// 何も返さなかった（本文が変わると id も変わるので、変化を見る分岐に到達できなかった）
// のはこの鍵が無かったため。
export function finalizeIds(units) {
  const byText = new Map()
  const byAnchor = new Map()
  for (const u of units) {
    const tk = `${u.file}:${String(u.hash).slice(0, 8)}`
    const n = byText.get(tk) || 0; byText.set(tk, n + 1)
    // 区切りに # を使わない。reqId が `unitId#要求番号` なので衝突する。
    u.id = `${tk}~${n}`

    const ak = `${u.file}::${u.section || ''}::${u.kind}`
    const m = byAnchor.get(ak) || 0; byAnchor.set(ak, m + 1)
    u.anchor = `${ak}~${m}`
  }
  return units
}

// 見出しパスが、段の skipSections に当たるか
export function matchesSkipSection(section, list) {
  const path = String(section || '')
  const segs = path.split('>').map(x => x.trim()).filter(Boolean)
  for (const raw of list) {
    const k = String(raw).trim()
    if (!k) continue
    if (/^\d+(\.\d+)*$/.test(k)) {
      if (segs.some(sg => new RegExp(`^${k.replace(/\./g, '\\.')}(\\D|$)`).test(sg))) return true
    } else if (path.includes(k)) return true
  }
  return false
}

// 分割が全行を覆っているかの検算。覆えていない行が 1 行でもあれば分割ではない。
export function coverageOf(units, lineCount) {
  const covered = new Set(units.map(u => u.line))
  const missing = []
  for (let n = 1; n <= lineCount; n++) if (!covered.has(n)) missing.push(n)
  return { lines: lineCount, coveredLines: covered.size, missing }
}

function mk(file, line, kind, text, section = '', cells = null) {
  // 表の行は「ID 列を除く全セル」を対象にする。
  // 以前は cells[cells.length - 1]（最後のセル）だけを見ていたため、
  // | ID | 要件本文 | 備考 | の形では要件本文が下限推定に一切入らず、
  // 代わりに備考欄のファイルパスが区切りとして数えられていた。
  // **下限推定が最も効くべきケース（表に畳み込まれた複数要求）で効いていなかった。**
  const body = cells ? (cells.length > 1 ? cells.slice(1).join(' ') : cells[0]) : text
  const label = cells && cells.length > 1 ? cells[0] : ''
  const scan = stripNonSeparators(body)
  const seps = (scan.match(SEP) || []).length
  const flags = []
  if (seps >= 1) flags.push(`sep:${seps}`)
  if (BOTH.test(scan)) flags.push('both')
  if (HYBRID.test(scan)) flags.push('hybrid')
  if (hasOpenEnum(scan)) flags.push('open-enum')
  if (RETRACT.test(text)) flags.push('retracted')

  // 下限: 区切りで分かれる数。「両方」「ハイブリッド」があるなら最低2。
  let minReq = seps + 1
  if ((flags.includes('both') || flags.includes('hybrid')) && minReq < 2) minReq = 2
  // 対象外の指定は add() が skip 理由つきで行う（ここで kind を見て決め打ちしない）

  return {
    // id は finalizeIds() が後から付ける。**行番号を含めない。**
    // v22 は `${file}:${line}:${hash6}` だったので、上位文書の先頭に空行を 1 つ
    // 足すだけで以降の全単位の id が変わり、sync が引き継げず判定が丸ごと消えた
    // （実測: 25 判定が「未着手 要求 0」になった）。設計フェーズは文書に行を
    // 挿入し続ける作業なので、これは日常的に起きていた。
    id: null, anchor: null,
    file, line, kind, section, label,
    text, body,
    minReq, flags,
    hash: createHash('sha1').update(text).digest('hex').slice(0, 12),
  }
}

// ── ts-api / ts-test 抽出 ────────────────────────────────────────────────
// リポジトリの typescript があれば AST、無ければ正規表現（lib/ts-api.mjs が判断）
function splitTs(rel, src, mode) {
  const items = mode === 'ts-test' ? extractTests(rel, src) : extractApi(rel, src)
  return finalizeIds(items.map(x => {
    const u = mk(rel, x.line, x.kind, x.name)
    if (x.signature) u.signature = x.signature
    if (x.id) u.testId = x.id
    if (x.family) u.testFamily = x.family
    if (x.owner) u.owner = x.owner
    if (x.exported === false) u.internal = true
    // 実装・テストの単位は「在るか無いか」を見る対象なので、下限は常に 1
    u.minReq = 1
    return u
  }))
}

// ── 実行 ────────────────────────────────────────────────────────────────
export function buildTier(id, { write = true } = {}) {
  const t = tier(id)
  const files = tierFiles(id)
  const units = []
  const coverage = []
  for (const f of files) {
    const src = read(f)
    const before = units.length
    if (t.extractor === 'markdown') units.push(...splitMarkdown(f, src))
    else units.push(...splitTs(f, src, t.extractor))
    // 分割が全行を覆っているかをファイル単位で検算する。
    // markdown 以外（ts-api / ts-test）は抽出であって分割ではないので、覆いは求めない。
    if (t.extractor === 'markdown') {
      const c = coverageOf(units.slice(before), src.split('\n').length)
      coverage.push({ file: f, ...c })
    }
  }
  // ── 段ごとの対象外指定 ──────────────────────────────────────────────
  // 文書には「要求ではない節」が必ず混じる（変更履歴・リスク一覧・作業パッケージ表）。
  // v22 はそれも要求として分解を要求していたので、変更履歴 1 行に「最低 8 件へ分解せよ」
  // が出ていた。正直にやる道が無い要求は、水増しを学習させるだけで終わる。
  //   { "id": "req", "sources": [...], "skipSections": ["変更履歴", "8", "リスク"] }
  // 数字だけの指定は見出し番号、それ以外は見出しパスへの部分一致。
  if (Array.isArray(t.skipSections) && t.skipSections.length) {
    for (const u of units) {
      if (!matchesSkipSection(u.section, t.skipSections)) continue
      u.judge = false; u.minReq = 0; u.skipReason = `対象外の節（${t.skipSections.join(' / ')}）`
    }
  }

  // ── ID による段の分離 ────────────────────────────────────────────────
  // テストの段は、パスでは分けられないことがある。実例（RiFF-LiNE の採番簿 §3.1）:
  //   apps/desktop/src/main には UT-WIN-* と IT-WIN-* の**両方**が在り、
  //   結合テストのファイル名も *.integration.test.ts で統一されていない
  //   （appBootstrap.test.tsx が IT-BOOT-*、WindowManager.test.ts が IT-WIN-*）。
  // glob をどう書いても片方に寄るか混ざるかのどちらかになる。
  // 唯一の確かな区別は **テストが持つ ID のプレフィックス**なので、それで絞れるようにする。
  //   { "id": "it", "sources": [...], "extractor": "ts-test", "idPrefix": "IT-" }
  // idPrefix が無いときは何もしない。
  // `filtered = units` と同一参照のまま units.length = 0 すると、
  // filtered も空になって**全段が 0 件になる**（markdown の段まで消えた）。
  //
  // 絞り込みのキーは「テスト自身の ID」→「ファイル冒頭の族」の順に見る。
  // 自身の ID だけを見ていた版は、ID をファイル冒頭にしか書いていない 33 本・
  // it( 239 個を **どの段にも入れないまま黙って捨てていた**（lib/ts-api.mjs に経緯）。
  // 落とした分は必ず droppedByPrefix に残す。残さないと orphanTests() が見られない。
  const dropped = []
  if (t.idPrefix) {
    const kept = []
    for (const u of units) {
      const key = String(u.testId || u.testFamily || '')
      if (key.startsWith(t.idPrefix)) kept.push(u)
      else dropped.push({ file: u.file, line: u.line, label: u.label, key: key || null })
    }
    units.length = 0
    for (const u of kept) units.push(u)   // spread は件数が多いとスタックを壊す
  }

  if (t.extractor !== 'markdown' && !buildTier._noted) {
    buildTier._noted = true
    buildTier._mode = extractorMode()
  }
  const dir = join(COVERAGE, 'units')
  if (write) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.jsonl`), units.map(u => JSON.stringify(u)).join('\n') + '\n')
  }
  const skipped = {}
  units.filter(u => u.judge === false).forEach(u => { skipped[u.skipReason || '(理由なし)'] = (skipped[u.skipReason || '(理由なし)'] || 0) + 1 })
  return { tier: id, extractor: t.extractor, mode: t.extractor === 'markdown' ? 'markdown' : extractorMode(),
           files: files.length, units: units.length, unitList: units, coverage, skipped,
           droppedByPrefix: dropped,
           uncovered: coverage.reduce((n, c) => n + c.missing.length, 0), ...summarize(units) }
}

function summarize(units) {
  const judgeable = units.filter(u => u.minReq > 0)
  const totalReq = judgeable.reduce((s, u) => s + u.minReq, 0)
  // 節ごと外した分（skipSections）は、**分母から消えた要求**そのもの。
  // 件数だけを見ていると、外しすぎても「判定対象が少ない」としか見えない。
  // どこをどれだけ外したのかを、常に数えて出す。
  const bySection = {}
  for (const u of units) {
    if (!/^対象外の節/.test(String(u.skipReason || ''))) continue
    const k = `${u.file}  ## ${String(u.section || '').split(' > ')[1] || '(見出し前)'}`
    bySection[k] = (bySection[k] || 0) + 1
  }
  return {
    judgeableUnits: judgeable.length,
    estimatedRequirements: totalReq,
    sectionSkipped: units.filter(u => /^対象外の節/.test(String(u.skipReason || ''))).length,
    sectionSkippedBy: bySection,
    multiRequirementUnits: judgeable.filter(u => u.minReq > 1).length,
    openEnumUnits: units.filter(u => u.flags.includes('open-enum')).length,
    retractedUnits: units.filter(u => u.flags.includes('retracted')).length,
  }
}

// ── どの段にも入らなかったテスト ────────────────────────────────────────
// idPrefix は「入れる」仕掛けだが、裏返すと「黙って落とす」仕掛けでもある。
// 落ちたテストはどの jsonl にも出ず、台帳の分母にも現れない。
// **件数はそれらしく出るので、落ちていることは数字からは分からない。**
// 実測でこれが 239 件起きた（原因は lib/ts-api.mjs の頭に書いた）。
//
// そこで「抽出はされたが、どの ts-test の段にも属さなかったテスト」を数える。
// これは設定ミスでも書き方の揺れでも赤になる。分母の穴は、穴だと分かる形で出す。
export function orphanTests() {
  const tiers = (config().tiers || []).filter(t => t.extractor === 'ts-test')
  const seen = new Map()   // file:line → { file, line, label, key, kept }
  const counts = []
  for (const t of tiers) {
    const r = buildTier(t.id, { write: false })
    counts.push({ tier: t.id, idPrefix: t.idPrefix || null, files: r.files, units: r.units })
    const mark = (u, kept) => {
      const k = `${u.file}:${u.line}`
      const cur = seen.get(k)
      if (!cur) seen.set(k, { file: u.file, line: u.line, label: u.label, key: u.testId || u.testFamily || null, kept })
      else if (kept) cur.kept = true
    }
    for (const u of r.unitList) mark(u, true)
    for (const u of (r.droppedByPrefix || [])) mark(u, false)
  }
  const orphans = [...seen.values()].filter(x => !x.kept)
  const byFile = new Map()
  for (const o of orphans) {
    if (!byFile.has(o.file)) byFile.set(o.file, { file: o.file, tests: 0, keys: new Set() })
    const e = byFile.get(o.file); e.tests++; if (o.key) e.keys.add(o.key)
  }
  return {
    tiers: counts,
    extracted: seen.size,
    orphans: orphans.length,
    orphanFiles: [...byFile.values()].map(e => ({ file: e.file, tests: e.tests, keys: [...e.keys] }))
                   .sort((a, b) => b.tests - a.tests),
    sample: orphans.slice(0, 20),
  }
}

// ── コマンド（直接実行されたときだけ）───────────────────────────────────
// **import されたときに CLI を走らせない。** check-config.mjs が buildTier を
// import した瞬間、ここが呼び出し側の argv で動いて process.exit し、
// 検査が丸ごと落ちた（smoke が 53 件中 11 件失敗）。ledger.mjs は同じ形で
// 既に守ってあったが、こちらに入れ忘れていた。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const arg = invokedDirectly ? process.argv[2] : undefined
const wantCoverage = process.argv.includes('--coverage')
// **書くことを黙らない。** 実測（2026-09-23、turn 39）: `split.mjs bd` は数を見るだけのつもりで打たれ、
// `.claude/coverage/units/bd.jsonl` を書き換えていた。出力のどこにも「書いた」と出ていなかった。
// 見るだけなら --dry-run を付ける。付けなければ、書いたファイルを必ず出す。
const dryRun = process.argv.includes('--dry-run')
const showSkipped = process.argv.includes('--show-skipped')

function printCoverage(r) {
  if (r.extractor !== 'markdown') { console.log(`[${r.tier}] 抽出方式（${r.mode}）。分割の覆いは対象外`); return }
  const bad = r.coverage.filter(c => c.missing.length)
  console.log(`[${r.tier}] ファイル ${r.files}`)
  for (const c of r.coverage) {
    const ok = c.missing.length === 0
    console.log(`  ${ok ? '✓' : '✗'} ${c.file}  総行 ${c.lines} / 覆った行 ${c.coveredLines}${ok ? '' : `  ← 未覆 ${c.missing.length} 行: ${c.missing.slice(0, 10).join(' ')}`}`)
  }
  console.log(`\n  判定対象 ${r.judgeableUnits} 単位（推定要求 ${r.estimatedRequirements}）`)
  console.log(`  対象外 ${r.units - r.judgeableUnits} 単位:`)
  Object.entries(r.skipped).sort((a, b) => b[1] - a[1]).forEach(([why, n]) => console.log(`     ${String(n).padStart(5)}  ${why}`))
  if (showSkipped) {
    // 件数だけでは誤分類が見えない（F17）。除外した行そのものを出す。
    const units = readFileSync(join(COVERAGE, 'units', `${r.tier}.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(u => u.judge === false && u.kind !== 'blank')
    console.log(`\n  除外した行（空行を除く ${units.length} 件）— **要求が書かれている行がここに混ざっていないか目で見ること**`)
    units.forEach(u => console.log(`    ${u.file}:${String(u.line).padStart(4)}  [${u.skipReason}]  ${String(u.text).slice(0, 70)}`))
  }
  if (bad.length) {
    console.log(`\n  ✗ 分割が全行を覆えていません。**覆えていない行は分母から消えており、誰にも見えません。**`)
    process.exitCode = 1
  } else {
    console.log(`\n  ✓ 全行が単位に属しています（取りこぼし 0）。対象外は理由つきで残っています。`)
  }
}

// ── 保存済みの分母と実ファイルのズレ ────────────────────────────────────
// 上位文書に 1 行足しても、**再切り出しするまで全分母から見えない**。
// 実測: 要件に R-03 を追記しても pending は「単位 2」のままで、
// `ledger stale` も反応しなかった（stale は「変化した単位」しか見ず、
// **増えた単位**を見ていない）。要件だけ足して下に降ろさない、が黙って成立していた。
if (arg === 'orphan-tests') {
  const r = orphanTests()
  if (json) console.log(JSON.stringify(r, null, 2))
  else {
    r.tiers.forEach(t => console.log(`${t.tier.padEnd(8)} ファイル ${String(t.files).padStart(4)}  分母に入った単位 ${String(t.units).padStart(5)}  idPrefix ${t.idPrefix || '(なし)'}`))
    console.log(`\n抽出したテスト ${r.extracted} 件 / どの段にも入らなかったもの ${r.orphans} 件`)
    if (r.orphans) {
      console.log('\n✗ 下のテストは**どの台帳の分母にも入っていません**。')
      console.log('  「未判定 0」が出ても、この分は最初から数えられていません。')
      r.orphanFiles.slice(0, 40).forEach(f =>
        console.log(`    ${String(f.tests).padStart(4)} 件  ${f.file}${f.keys.length ? `  [${f.keys.join(' ')}]` : '  [ID なし]'}`))
      if (r.orphanFiles.length > 40) console.log(`    … 他 ${r.orphanFiles.length - 40} ファイル`)
      console.log('\n  直し方は 2 つ。')
      console.log('    1. テスト側に ID を書く（ファイル冒頭に `// UT-XXX-YYY: 説明` を 1 行、または各テストに `// UT-XXX-YYY-01`）')
      console.log('    2. 採番簿にその族が在るなら、project.json の tiers[].idPrefix と食い違っていないか見る')
    } else {
      console.log('\n✓ 抽出したテストは全件どこかの段に属しています（黙って落ちた分は 0）。')
    }
  }
  process.exit(r.orphans ? 1 : 0)
}

if (arg === 'drift') {
  const tiers = config().tiers || []
  const rows = []
  for (const t of tiers) {
    const cur = buildTier(t.id, { write: false })
    let stored = []
    try {
      stored = readFileSync(join(COVERAGE, 'units', `${t.id}.jsonl`), 'utf8')
        .split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch { stored = null }
    if (stored === null) { rows.push({ tier: t.id, state: '未切り出し', added: cur.units, changed: 0, removed: 0 }); continue }
    // id は本文ハッシュなので「本文が変わった単位」は id が一致しない。
    // anchor（位置）で拾い直して初めて「新規」と「変化」が分かれる。
    // v22 は id 一致かつ hash 不一致を「変化」としていたが、id に本文ハッシュが
    // 入っている以上その条件は成立せず、**変化列は常に 0** だった。
    const sById = new Map(stored.map(u => [u.id, u]))
    const sByAnchor = new Map(stored.filter(u => u.anchor).map(u => [u.anchor, u]))
    const matched = new Set()
    const added = [], changed = []
    for (const u of (cur.unitList || [])) {
      const hit = sById.get(u.id)
      if (hit && !matched.has(hit.id)) { matched.add(hit.id); continue }
      const a = u.anchor ? sByAnchor.get(u.anchor) : null
      if (a && !matched.has(a.id)) { matched.add(a.id); changed.push(u.id); continue }
      added.push(u.id)
    }
    const removed = stored.filter(u => !matched.has(u.id)).map(u => u.id)
    rows.push({ tier: t.id, state: added.length + changed.length + removed.length ? 'ズレあり' : '一致',
                added: added.length, changed: changed.length, removed: removed.length,
                addedIds: added.slice(0, 10), changedIds: changed.slice(0, 10) })
  }
  const drifted = rows.filter(r => r.state !== '一致')
  if (json) console.log(JSON.stringify({ rows, drifted: drifted.length }, null, 2))
  else {
    rows.forEach(r => console.log(`${r.state === '一致' ? '✓' : '✗'} ${r.tier.padEnd(8)} ${r.state.padEnd(6)} 新規 ${String(r.added).padStart(4)}  変化 ${String(r.changed).padStart(4)}  消失 ${String(r.removed).padStart(4)}`))
    if (drifted.length) {
      console.log(`\n上位文書を編集したのに分母が作り直されていません。**増えた分は、いまどの台帳にも載っていません。**`)
      drifted.forEach(r => console.log(`  node .claude/scripts/split.mjs ${r.tier}`))
      console.log(`  そのあと: node .claude/scripts/ledger.mjs sync "<edge>"`)
    } else console.log(`\nsplit drift: 保存済みの分母と実ファイルは一致しています。`)
  }
  process.exit(drifted.length ? 1 : 0)
}

if (arg && !arg.startsWith('--')) {
  const r = buildTier(arg, { write: !dryRun })
  if (json) console.log(JSON.stringify(r, null, 2))
  else if (wantCoverage) printCoverage(r)
  else {
    console.log(`[${r.tier}] ファイル ${r.files} / 構造単位 ${r.units}（抽出: ${r.mode}）`)
    console.log(`  判定対象      : ${r.judgeableUnits}`)
    if (r.sectionSkipped) {
      // **節ごと外すのは、分母をまるごと消す操作。** 黙って効かせない。
      console.log(`  節ごと対象外  : ${r.sectionSkipped} 単位（skipSections）`)
      Object.entries(r.sectionSkippedBy).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .forEach(([k, n]) => console.log(`     ${String(n).padStart(5)}  ${k}`))
    }
    console.log(`  推定要求数    : ${r.estimatedRequirements}（1単位あたり ${(r.estimatedRequirements / Math.max(1, r.judgeableUnits)).toFixed(2)}）`)
    console.log(`  複数要求を含む: ${r.multiRequirementUnits}`)
    console.log(`  列挙が未閉鎖  : ${r.openEnumUnits}（「等」「など」。要件未確定の候補）`)
    console.log(`  撤回マーク    : ${r.retractedUnits}（打ち消し線。下位が旧要件のままでないか要確認）`)
    if (r.uncovered) console.log(`  ⚠ 分割が ${r.uncovered} 行を覆えていません。--coverage で詳細を見てください`)
    console.log(dryRun ? '  （--dry-run: 分母のファイルは書いていません）'
                       : `  書いたファイル: .claude/coverage/units/${r.tier}.jsonl（見るだけなら --dry-run）`)
  }
} else if (invokedDirectly && (arg === '--all' || wantCoverage)) {
  const rows = config().tiers.map(t => buildTier(t.id, { write: !dryRun }))
  if (json) console.log(JSON.stringify(rows, null, 2))
  else if (wantCoverage) rows.forEach(r => { printCoverage(r); console.log() })
  else {
    rows.forEach(r => console.log(
      `${r.tier.padEnd(8)} 単位 ${String(r.units).padStart(5)}  判定対象 ${String(r.judgeableUnits).padStart(5)}  推定要求 ${String(r.estimatedRequirements).padStart(5)}  複数要求 ${String(r.multiRequirementUnits).padStart(4)}${r.sectionSkipped ? `  節ごと対象外 ${String(r.sectionSkipped).padStart(4)}` : ''}  [${r.mode}]${r.uncovered ? `  ⚠ 未覆 ${r.uncovered} 行` : ''}`))
    if (rows.some(r => r.mode === 'regexp-fallback')) {
      console.log('\n※ typescript パッケージを解決できず、正規表現で抽出しています。')
      console.log('  複数行シグネチャやオーバーロードを取りこぼす可能性があります。')
      console.log('  リポジトリ直下で pnpm install 済みかを確認してください。')
    }
    console.log(dryRun ? '\n（--dry-run: 分母のファイルは書いていません）'
                       : `\n書いたファイル: ${rows.map(r => `.claude/coverage/units/${r.tier}.jsonl`).join(' ')}（見るだけなら --dry-run）`)
    const un = rows.reduce((n, r) => n + (r.uncovered || 0), 0)
    if (un) { console.log(`\n⚠ 分割が合計 ${un} 行を覆えていません: node .claude/scripts/split.mjs --coverage`); process.exitCode = 1 }
    // idPrefix で落ちた分は上の表のどこにも出ない（落ちた段の件数が減るだけ）。
    // 一覧の直後に必ず出す。**黙って消える経路をここで塞ぐ。**
    const dropped = rows.reduce((n, r) => n + ((r.droppedByPrefix || []).length), 0)
    if (dropped) {
      const o = orphanTests()
      if (o.orphans) {
        console.log(`\n✗ テスト ${o.orphans} 件が**どの段にも入っていません**（ファイル ${o.orphanFiles.length} 本）。`)
        o.orphanFiles.slice(0, 10).forEach(f => console.log(`    ${String(f.tests).padStart(4)} 件  ${f.file}`))
        if (o.orphanFiles.length > 10) console.log(`    … 他 ${o.orphanFiles.length - 10} ファイル`)
        console.log(`  詳細: node .claude/scripts/split.mjs orphan-tests`)
        process.exitCode = 1
      }
    }
  }
} else if (invokedDirectly) {
  console.log('使い方: node .claude/scripts/split.mjs <tierId|--all> [--json] [--coverage] [--dry-run]')
  console.log('  **既定で .claude/coverage/units/<tierId>.jsonl を書き換えます。** 見るだけなら --dry-run')
  console.log('  --coverage … 分割が文書の全行を覆っているかを検算し、対象外の内訳を出す')
  console.log('  --show-skipped … 除外した行そのものを出す（件数だけでは誤分類が見えない）')
  console.log('  orphan-tests   … 抽出はされたがどの段にも入らなかったテストを出す（分母の穴）')
  console.log('  drift          … 保存済みの分母と実ファイルのズレを見る')
}
