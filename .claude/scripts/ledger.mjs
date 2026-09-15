#!/usr/bin/env node
// 網羅台帳 段階3〜5: 要求分解の記録・検算と、判定の記録・集計。
//
// 分解（decompose）は上位ドキュメントだけを見て行う。下位を見せない。
//   → 検証キー方式が失敗した理由は「下位を見ながらキーを選んでいた」ため。
//      下位に無いものはキーにならなかった。上位だけを見る分解は、
//      下位の欠落に一切影響されない。
// 分解件数が split.mjs の推定下限を下回ったら、この場で拒否する。
//
// 使い方:
//   node .claude/scripts/ledger.mjs stats [--json]
//   node .claude/scripts/ledger.mjs next <edge> [件数|all] [--file <部分一致>] [--section <部分一致>] [--ids-only] [--phase decompose|judge]
//   node .claude/scripts/ledger.mjs show <edge> <unitId|reqId>
//     既定は all（全件）。試しに少しだけ回したいときだけ件数か --file / --section で絞る。
//   node .claude/scripts/ledger.mjs decompose <edge> <unitId> '["要求1","要求2"]'
//   node .claude/scripts/ledger.mjs judge <edge> <reqId> <verdict> '<evidence json>' [--human]
//     --human は人が判定したことの記録。humanJudged: true の段はこれが揃うまで完了にならない
//   node .claude/scripts/ledger.mjs pending <edge> [--file <部分一致>] [--section <部分一致>] [--json]
//     担当範囲の未分解／未判定の件数。Stop hook と /wp が「分母が固定されているか」を見るのに使う
//   node .claude/scripts/ledger.mjs stale <edge>
//     edge は "req->bd" の形式。**シェルでは必ず引用符で囲む**（`>` はリダイレクト）。
//     引用を忘れて `req-` になった場合は、その旨を出して止まる。`req:bd` の形も受け付ける。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, config, json, matchesAny, tier } from './lib/config.mjs'
import { checkEvidence } from './lib/evidence.mjs'

// ── 語の共有 ────────────────────────────────────────────────────────────
// 分解した要求・対象外の理由が、上位の原文と 1 語も共有していないなら、
// それは原文を読んで書いたものではない。v22 は `["x","x","x","x"]` が
// 下限 4 件を満たして通った（実測）ので、最低限の紐付けを要求する。
export function tokensOf(text) {
  const t = String(text || '')
  const out = new Set()
  for (const m of t.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[ァ-ヴー]{2,}/g)) out.add(m[0])
  for (const m of t.matchAll(/[一-龥]{2,}/g)) out.add(m[0])
  for (const m of t.matchAll(/[0-9]+/g)) out.add(m[0])
  return out
}
export function sharesToken(text, src) {
  const a = tokensOf(text), b = tokensOf(src)
  for (const x of a) {
    if (b.has(x)) return true
    // 漢字列・カタカナ列は部分一致も許す（「再生位置」と「再生」を別語にしない）。
    // **カタカナを外していたのは取りこぼしだった**（2026-09-15、実地の分解で判明）:
    // 要件 §4.1 を 28 単位ぜんぶ分解したとき、
    //   要求「ピンチハーモニクスに対応すること」／ 出どころ「・ピンチ）」
    // が「1 語も共有していない」で弾かれた。日本語の複合語はカタカナでも同じ形になる。
    // 漢字だけを特別扱いする理由が無い。
    if (/^[一-龥]{2,}$/.test(x) || /^[ァ-ヴー]{2,}$/.test(x)) {
      for (const y of b) if (y.includes(x) || x.includes(y)) return true
    }
  }
  return false
}
// 判定した段の成果物だけを evidence の引用元として認める
function allowFilesFor(e) {
  const t = safeTier(e.to)
  return t?.sources?.length ? t.sources : null
}
function safeTier(id) { try { return tier(id) } catch { return null } }

const COVERAGE = join(ROOT, '.claude', 'coverage')
const EDGES = join(COVERAGE, 'edges')
const UNITS = join(COVERAGE, 'units')

export const VERDICTS = ['一致', '部分', '不一致', '陳腐化', '申し送り先が不在', '対応先が誤り', '対象外']

export function edgeId(e) { return `${e.from}->${e.to}` }
function edgeFile(id) { return join(EDGES, id.replace('->', '-') + '.jsonl') }

function readUnits(tierId) {
  const p = join(UNITS, `${tierId}.jsonl`)
  if (!existsSync(p)) throw new Error(`units/${tierId}.jsonl がありません。先に split.mjs を実行してください。`)
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

export function loadEdge(id) {
  const p = edgeFile(id)
  if (!existsSync(p)) return new Map()
  const m = new Map()
  readFileSync(p, 'utf8').split('\n').filter(Boolean).forEach(l => {
    const r = JSON.parse(l); m.set(r.unitId, r)
  })
  return m
}

function saveEdge(id, map) {
  if (!existsSync(EDGES)) mkdirSync(EDGES, { recursive: true })
  writeFileSync(edgeFile(id), [...map.values()].map(r => JSON.stringify(r)).join('\n') + '\n')
}

// 上位 tier の units を土台に、台帳の骨格を作る（既存の判定は保持する）
export function sync(edge) {
  const id = edgeId(edge)
  // internal（private メンバー・未 export のモジュール内部）は分母に入れない。
  // 外へ出していないものに「下位へ降りているか」を問うても判定できず、
  // 未判定件数だけが増えて数字の意味が薄れる。units ファイルには残るので見える。
  const units = readUnits(edge.from).filter(u => u.minReq > 0 && !u.internal)
  const cur = loadEdge(id)
  const next = new Map()

  // 引き継ぎの索引を 3 つ持つ。
  //   byId     … 本文が同じ（行が動いただけ）→ そのまま引き継ぐ
  //   byAnchor … 位置は同じで本文が変わった  → 判定を落として「要再判定」にする
  //   byLegacy … v22 の id（file:line:hash6）→ file:hash6 で寄せて移行する
  // v22 は byId しか無く、しかも id に行番号が入っていたので、
  // **上位に 1 行足すだけで判定が全部消えていた**（実測 25 件）。
  const byId = new Map(), byAnchor = new Map(), byLegacy = new Map()
  for (const r of cur.values()) {
    byId.set(r.unitId, r)
    if (r.anchor) byAnchor.set(r.anchor, r)
    const k = `${r.file}:${String(r.hash || '').slice(0, 6)}`
    if (!byLegacy.has(k)) byLegacy.set(k, [])
    byLegacy.get(k).push(r)
  }
  const used = new Set()
  const carry = r => { used.add(r.unitId); return r }

  let kept = 0, stale = 0, fresh = 0
  for (const u of units) {
    // 1. 本文が同じ
    let prev = byId.get(u.id)
    if (!prev || prev.hash !== u.hash) {
      const cands = (byLegacy.get(`${u.file}:${String(u.hash).slice(0, 6)}`) || [])
        .filter(r => !used.has(r.unitId) && r.hash === u.hash)
      prev = cands[0] || null
    }
    if (prev && prev.hash === u.hash && !used.has(prev.unitId)) {
      carry(prev); kept++
      next.set(u.id, { ...prev, unitId: u.id, anchor: u.anchor,
                       line: u.line, section: u.section, label: u.label,
                       text: u.text, minReq: u.minReq, flags: u.flags })
      continue
    }

    const base = {
      unitId: u.id, anchor: u.anchor, hash: u.hash, file: u.file, line: u.line, kind: u.kind,
      section: u.section, label: u.label, text: u.text, minReq: u.minReq, flags: u.flags,
    }

    // 2. 位置は同じで本文が変わった
    const at = u.anchor ? byAnchor.get(u.anchor) : null
    if (at && !used.has(at.unitId)) {
      carry(at); stale++
      next.set(u.id, {
        ...base,
        // **判定は落とす。** 上位の本文が変わったなら、そこから降ろした要求も
        // 導き直さなければならない。ただし前の分解と判定は参照用に残す
        // （捨てると、何がどう変わったのかを後から追えなくなる）。
        staleFrom: at.hash, staleText: at.text, staleAt: new Date().toISOString(),
        stalePrevReqs: Array.isArray(at.reqs) ? at.reqs : undefined,
        reqs: null,
      })
      continue
    }

    // 3. 新規
    fresh++
    next.set(u.id, { ...base, reqs: null })
  }
  saveEdge(id, next)
  const st = stats(edge, next)
  return { ...st, carried: kept, staled: stale, added: fresh }
}

export function stats(edge, map = null) {
  const id = edgeId(edge)
  const m = map || loadEdge(id)
  const rows = [...m.values()]
  const decomposed = rows.filter(r => Array.isArray(r.reqs))
  const allReqs = decomposed.flatMap(r => r.reqs)
  const judged = allReqs.filter(q => q.verdict)
  const byVerdict = {}
  judged.forEach(q => byVerdict[q.verdict] = (byVerdict[q.verdict] || 0) + 1)
  const stale = rows.filter(r => r.staleFrom)
  // 「未判定 0 だから完了」ではない。一度も分解していない台帳も未判定 0 になる。
  // 着手前と完遂を区別しないと、セッション冒頭に自動注入される status で
  // 「台帳は済んでいる」と読めてしまう（偽の緑）。
  // humanJudged: true の段（要件 → 受入シナリオ）は、人が判定した記録が無い限り完了にしない。
  // 以前は humanJudged をラベル表示するだけで、AI の判定だけで「完了」に到達できた。
  // HOWTO の「最後の項目は AI が埋められません」が台帳側では嘘だった。
  // humanJudged の 2 段階。project.json に "partial" と書いてあるのに
  // ledger は === true しか見ておらず、bd->system は AI の判定だけで完了できていた。
  //   true    … 判定はすべて人が行う（要件 → 受入シナリオ）
  //   partial … AI が判定してよいが、**人が 1 件も見ていない段は完了にしない**
  const humanPending = edge.humanJudged === true
    ? judged.filter(q => q.by !== 'human').length
    : edge.humanJudged === 'partial'
      ? (judged.length && !judged.some(q => q.by === 'human') ? 1 : 0)
      : 0
  const state =
    rows.length === 0                              ? '未初期化'
    : decomposed.length === 0                       ? '未着手'
    : (allReqs.length - judged.length) > 0 || (rows.length - decomposed.length) > 0 ? '進行中'
    : humanPending > 0                              ? '人間判定待ち'
    : '完了'
  return {
    edge: id, kind: edge.kind, humanJudged: edge.humanJudged || false, state, humanPending,
    units: rows.length,
    unitsDecomposed: decomposed.length,
    unitsUndecomposed: rows.length - decomposed.length,
    requirements: allReqs.length,
    // 「要求ゼロ」と宣言された単位。**逃げ道は用意するが、必ず数える。**
    // これを数えないと、全単位を要求ゼロにした台帳が「完了」と表示される。
    unitsNoRequirement: decomposed.filter(r => r.reqs.length === 0).length,
    skips: decomposed.reduce((n, r) => n + ((r.skips || []).length), 0),
    judged: judged.length,
    unjudged: allReqs.length - judged.length,
    stale: stale.length,
    byVerdict,
    problems: (byVerdict['部分'] || 0) + (byVerdict['不一致'] || 0) + (byVerdict['陳腐化'] || 0)
            + (byVerdict['申し送り先が不在'] || 0) + (byVerdict['対応先が誤り'] || 0),
  }
}

export function allStats() {
  return (config().edges || []).map(e => {
    // 例外の中身を捨てて「split.mjs 未実行」と決め打ちしない。
    // stats() は units を読まない（loadEdge は台帳が無ければ空 Map を返し、
    // その場合は例外にならず「未初期化」になる）。つまりここへ来る時点で原因は
    // 別のもの——台帳 JSONL の破損など——であり、固定文言は必ず嘘になる。
    try { return stats(e) } catch (err) { return { edge: edgeId(e), state: '不明', error: `台帳を読めません: ${err.message}` } }
  })
}

// 表示用の記号と整形。
// **コマンド分岐より前に置くこと。** const は巻き上げられても TDZ に入るので、
// 分岐の中から fmt() を呼ぶと「Cannot access 'MARK' before initialization」で落ちる。
// `--json` を付けない `ledger.mjs stats` / `sync`——HOWTO が毎日打つコマンドとして
// 載せているもの——が、配布物のまま一度も動いていなかった。
export const MARK = { '未初期化': '!', '未着手': '!', '進行中': '·', '人間判定待ち': '!', '完了': '✓', '不明': '?' }

function fmt(s) {
  if (s.error) return `${s.edge.padEnd(14)} ${s.error}`
  const human = s.humanJudged === true ? ' [全件を人が判定]' : s.humanJudged === 'partial' ? ' [人の判定が最低1件必要]' : ''
  const hint = s.state === '未初期化' ? '  ← split.mjs / ledger sync が未実行'
             : s.state === '未着手'   ? '  ← 一度も分解していない'
             : s.state === '人間判定待ち' ? `  ← AI 判定のみ ${s.humanPending} 件。judge --human で人が記録するまで完了にならない`
             : ''
  // 「要求ゼロ」は逃げ道なので、**あるときは必ず目に入る位置に出す**。
  const none = s.unitsNoRequirement ? `  要求ゼロ ${s.unitsNoRequirement}` : ''
  return `${MARK[s.state] || ' '} ${s.edge.padEnd(14)} ${String(s.state).padEnd(5)} 単位 ${String(s.units).padStart(5)}  要求 ${String(s.requirements).padStart(5)}  判定済 ${String(s.judged).padStart(5)}  未判定 ${String(s.unjudged).padStart(5)}  不一致等 ${String(s.problems).padStart(4)}${none}${s.stale ? `  陳腐化 ${s.stale}` : ''}${human}${hint}`
}

// ── コマンド（直接実行されたときだけ）───────────────────────────────────
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , cmd0, ...rest] = process.argv
const cmd = invokedDirectly ? cmd0 : undefined
const args = rest.filter(a => !a.startsWith('--'))
const opt = name => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : null }

// 範囲の絞り込み。既定は全件で、指示があったときだけ狭める。
function scopeFilter() {
  const file = opt('file'), section = opt('section')
  return r => (!file || r.file.includes(file)) && (!section || (r.section || '').includes(section))
}
function limitOf(raw) {
  if (raw === undefined || raw === null || raw === 'all' || raw === '') return Infinity
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Infinity
}

function findEdge(id0) {
  const id = String(id0 || '').replace(':', '->')
  const e = (config().edges || []).find(e => edgeId(e) === id)
  if (!e) {
    const known = (config().edges || []).map(edgeId).join(' / ')
    if (/->?$/.test(id) || !id.includes('->')) {
      throw new Error(`edge "${id0}" は不完全です。シェルで "req->bd" のように**引用符で囲んで**ください（裸の > はリダイレクトになり、末尾が消えます）。定義済み: ${known}`)
    }
    throw new Error(`edge "${id0}" は project.json に定義されていません。定義済み: ${known}`)
  }
  return e
}

if (cmd === 'sync') {
  const rows = args[0] ? [sync(findEdge(args[0]))] : config().edges.map(e => { try { return sync(e) } catch (err) { return { edge: edgeId(e), error: err.message } } })
  console.log(json ? JSON.stringify(rows, null, 2) : rows.map(fmt).join('\n'))
}

else if (cmd === 'stats') {
  const rows = allStats()
  console.log(json ? JSON.stringify(rows, null, 2) : rows.map(fmt).join('\n'))
}

else if (cmd === 'next') {
  // --ids-only: 識別子だけを返す。
  //   大量の本文をエージェント間で復唱させると、量が増えたときに欠落・改変が起きる。
  //   受け渡しは短い ID に限り、中身は各自が show で取りに行く。
  const idsOnly = rest.includes('--ids-only')
  // --phase judge: 未分解が残っていても判定の一覧を返す。
  // 既定（auto）は「未分解があるうちは分解の一覧」なので、分解に失敗した単位が
  // 1 件でも残ると判定フェーズが永久に始まらなかった（sim で判明）。
  const forced = opt('phase')
  const e = findEdge(args[0]); const n = limitOf(args[1]); const inScope = scopeFilter()
  const m = loadEdge(edgeId(e))
  const undecomposed = forced === 'judge' ? []
    : [...m.values()].filter(r => inScope(r) && !Array.isArray(r.reqs)).slice(0, n === Infinity ? undefined : n)
  if (undecomposed.length || forced === 'decompose') {
    const payload = idsOnly
      ? { phase: 'decompose', edge: edgeId(e), count: undecomposed.length, ids: undecomposed.map(u => u.unitId) }
      : { phase: 'decompose', edge: edgeId(e),
          note: '上位だけを見て、この単位が要求している事項を列挙する。下位は見ない。' +
                ' 要求ごとに、原文のどの部分から読み取ったか（from）を逐語で付ける。' +
                ' 要求ではない部分（出典・履歴・接続）は {"skip": "<原文の一部>", "why": "<理由>"} で外す。' +
                ' section はその行が属する章。**章を見て、そもそも要求を書く場所かを判断すること**' +
                '（変更履歴・リスク一覧・見積もりの章に要求は無い）。',
          format: '[{"text":"<要求>","from":"<原文の逐語>"}, {"skip":"<原文の逐語>","why":"<なぜ要求でないか>"}]',
          units: undecomposed.map(u => ({ unitId: u.unitId, file: u.file, line: u.line,
                   section: u.section, label: u.label, text: u.text, minReq: u.minReq, flags: u.flags })) }
    console.log(JSON.stringify(payload, null, 2))
  } else {
    const pending = []
    for (const r of m.values()) { if (!inScope(r)) continue; (r.reqs || []).forEach((q, i) => { if (!q.verdict && pending.length < n) pending.push({ reqId: `${r.unitId}#${i}`, file: r.file, line: r.line, section: r.section, label: r.label, upper: r.text, requirement: q.text, from: q.from || null }) }) }
    const payload = idsOnly
      ? { phase: 'judge', edge: edgeId(e), targetTier: e.to, count: pending.length, ids: pending.map(q => q.reqId) }
      : { phase: 'judge', edge: edgeId(e), targetTier: e.to, verdicts: VERDICTS, note: '下位を実際に開いて読み、意味で突き合わせる。目次や「反映済み」の記述を根拠にしない。', requirements: pending }
    console.log(JSON.stringify(payload, null, 2))
  }
}

else if (cmd === 'show') {
  // 1 件だけ取り出す。ワークフローは ID を配るだけで済み、本文の復唱が要らない。
  const e = findEdge(args[0]); const id = args[1]
  const m = loadEdge(edgeId(e))
  // judge と同じく最後の # で割る（unitId に # が混ざっても壊れないように）
  const cut0 = String(id).lastIndexOf('#')
  const unitId = cut0 < 0 ? String(id) : String(id).slice(0, cut0)
  const idxStr = cut0 < 0 ? undefined : String(id).slice(cut0 + 1)
  const r = m.get(unitId)
  if (!r) { console.error(JSON.stringify({ error: `${unitId} が台帳にありません` })); process.exit(1) }
  if (idxStr === undefined) {
    console.log(JSON.stringify({ phase: 'decompose', edge: edgeId(e), unitId: r.unitId,
      file: r.file, line: r.line, section: r.section, label: r.label, text: r.text,
      minReq: r.minReq, flags: r.flags,
      note: '上位の原文だけを見て要求を列挙する。下位のファイルを開かない。' }, null, 2))
  } else {
    const q = (r.reqs || [])[Number(idxStr)]
    if (!q) { console.error(JSON.stringify({ error: `${id} が台帳にありません` })); process.exit(1) }
    console.log(JSON.stringify({ phase: 'judge', edge: edgeId(e), reqId: id, targetTier: e.to,
      file: r.file, line: r.line, section: r.section, label: r.label,
      upper: r.text, requirement: q.text, from: q.from || null, verdicts: VERDICTS,
      note: '下位を実際に開いて読み、意味で突き合わせる。目次や「反映済み」の記述を根拠にしない。' }, null, 2))
  }
}

else if (cmd === 'decompose') {
  // ── 入力の形 ──────────────────────────────────────────────────────────
  //   [ {"text": "<要求>",   "from": "<原文の逐語の一部>"},   … 要求
  //     {"skip": "<原文の逐語の一部>", "why": "<なぜ要求でないか>"} … 要求でない部分
  //   ]
  //
  // なぜ from を必須にしたか（実測で分かったこと、2026-09-15）:
  //   旧版は文字列の配列で、機械が見ていたのは「件数が下限以上か」「完全一致の重複が
  //   無いか」「原文の語を使っているか」の 3 つだけだった。**中身が原文のどこから
  //   来たのかを誰も見ていなかった。**
  //   実際に要件定義書で回したところ、**正直に分解すると 5/5 が弾かれ、数合わせを
  //   すると 5/5 が通った**。日付の行（要求ゼロ）にも架空の要求 2 件を書かされ、
  //   それが「判定済 2」として台帳に載った。
  //   弾かれた側は書き直す。書き直す方向は通る方なので、**この仕掛けは数合わせを
  //   正解として教えていた**。サボりを検出するための道具が、逆を教えていた。
  //
  //   from を必須にすると、言い換えを並べても**同じ区間を取り合って落ちる**。
  //   書ける件数は原文の長さで決まり、AI の裁量では増やせない。
  //   そして**どこにも割り当てられなかった区間**が残るので、飛ばしたことが見える。
  //   件数（minReq）は「要求の数の下限」から「**原文のうち説明すべき断片の数の下限**」
  //   へ意味が変わる。要求として書くか、理由つきで skip するかは選べるが、
  //   **黙って無視することはできない**。
  const e = findEdge(args[0]); const unitId = args[1]
  let entries
  try { entries = JSON.parse(args[2]) } catch { console.error('分解は JSON 配列で渡してください'); process.exit(1) }
  const m = loadEdge(edgeId(e)); const r = m.get(unitId)
  if (!r) { console.error(`unitId ${unitId} が台帳にありません`); process.exit(1) }
  const src = String(r.text)

  if (!Array.isArray(entries)) { console.error('分解は JSON 配列で渡してください'); process.exit(1) }
  if (entries.some(x => typeof x === 'string')) {
    console.error('分解の書式が変わりました。文字列の配列では受け取れません。')
    console.error('  要求ごとに、原文のどの部分から取ったか（from）を付けてください:')
    console.error('    [{"text":"<要求>","from":"<原文の逐語の一部>"},')
    console.error('     {"skip":"<原文の逐語の一部>","why":"<なぜ要求でないか>"}]')
    console.error(`  原文: ${src}`)
    process.exit(1)
  }
  const reqs = [], skips = []
  for (const x of entries) {
    if (!x || typeof x !== 'object') { console.error('分解の各要素はオブジェクトで渡してください'); process.exit(1) }
    if (typeof x.skip === 'string') skips.push({ skip: String(x.skip), why: String(x.why || '') })
    else reqs.push({ text: String(x.text || ''), from: String(x.from || '') })
  }
  if (!reqs.length && !skips.length) {
    console.error('分解が空です。要求を書くか、要求でない部分を理由つきで skip してください。')
    process.exit(1)
  }

  // ① 要求の文は判定できる粒度か（旧版から継続）
  const short = reqs.filter(x => x.text.trim().length < 8)
  if (short.length) {
    console.error(`要求が短すぎます（8 文字以上）: ${short.slice(0, 3).map(x => JSON.stringify(x.text)).join(' ')}`)
    console.error('  上位が何を要求しているかを、判定できる粒度で書いてください。')
    process.exit(1)
  }
  const seen = new Set(), dup = []
  for (const x of reqs) { const k = x.text.trim(); if (seen.has(k)) dup.push(k); seen.add(k) }
  if (dup.length) {
    console.error(`同じ要求が重複しています: ${dup.slice(0, 3).map(x => JSON.stringify(x)).join(' ')}`)
    console.error('  件数の下限を満たすために同じ行を並べても、分母を固定したことにはなりません。')
    process.exit(1)
  }

  // ② from / skip は原文の逐語の一部か。**捏造できないのはここ。**
  const spans = []
  for (const x of [...reqs.map(q => ({ frag: q.from, kind: '要求', label: q.text })),
                   ...skips.map(k => ({ frag: k.skip, kind: 'skip', label: k.why }))]) {
    const frag = x.frag.trim()
    if (!frag) {
      console.error(`${x.kind}「${String(x.label).slice(0, 30)}」に原文の引用（${x.kind === 'skip' ? 'skip' : 'from'}）がありません。`)
      console.error(`  原文: ${src}`)
      process.exit(1)
    }
    const at = src.indexOf(frag)
    if (at < 0) {
      console.error(`原文に無い文字列が指定されています: ${JSON.stringify(frag)}`)
      console.error(`  原文: ${src}`)
      console.error('  from / skip は、原文からそのまま切り出した文字列でなければなりません。')
      process.exit(1)
    }
    spans.push({ ...x, frag, at, end: at + frag.length })
  }

  // ③ 区間が重なっていないか。**言い換えの水増しはここで落ちる。**
  const sorted = [...spans].sort((a, b) => a.at - b.at)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].at < sorted[i - 1].end) {
      console.error('原文の同じ部分を 2 つの項目が取り合っています。')
      console.error(`  ${JSON.stringify(sorted[i - 1].frag)}  ←→  ${JSON.stringify(sorted[i].frag)}`)
      console.error(`  原文: ${src}`)
      console.error('  同じ内容を言い換えて件数を埋めることはできません。原文の別の部分を指してください。')
      process.exit(1)
    }
  }

  // ④ 要求の文と、その出どころが結びついているか（すり替え防止）
  //
  // **語に分けられない断片は、逐語で見る。**（2026-09-15、コードの段で判明）
  // tokensOf は英数字の識別子を 3 文字以上でしか拾わない。上位段がコードのエッジ
  // （impl->ut）では単位の本文がクラス名・メソッド名なので、`A` や `f` のような
  // 短い名前は**語が 1 つも取れず、どう書いても「1 語も共有していない」で落ちる**。
  // 実際にコードの単位を分解しようとして全件拒否された。
  // 語に分けられないときは、要求の文がその断片を逐語で含んでいるかで見る。
  const swapped = reqs.filter(q => {
    if (sharesToken(q.text, q.from)) return false
    if (tokensOf(q.from).size === 0) return !q.text.includes(q.from.trim())
    return true
  })
  if (swapped.length) {
    console.error(`要求の文と、その出どころ（from）が 1 語も共有していません（${swapped.length} 件）。`)
    swapped.slice(0, 3).forEach(q => console.error(`    要求 ${JSON.stringify(q.text)}\n    from ${JSON.stringify(q.from)}`))
    console.error('  from はその要求が実際に読み取れる部分を指してください。')
    process.exit(1)
  }

  // ⑤ skip の理由は、この単位に固有のものか
  const thinWhy = skips.filter(k => k.why.trim().length < 15 || !sharesToken(k.why, src))
  if (thinWhy.length) {
    console.error(`skip の理由が不十分です（15 文字以上・原文の語を含むこと）: ${thinWhy.slice(0, 2).map(k => JSON.stringify(k.why)).join(' ')}`)
    console.error(`  原文: ${src}`)
    console.error('  なぜ**この部分が**要求でないのかを、原文に触れて書いてください。')
    process.exit(1)
  }

  // ⑥ 取り残しが無いか。**飛ばしたことが見えるのはここ。**
  // 助詞や接続詞まで割り当てを強制すると全件落ちるので、10 文字以上の連続区間だけを見る。
  // この閾値を外したときの症状は「skip の記録が少し増減する」だけで、
  // minReq と違って**水増しを強制する側には絶対に振れない**。
  const covered = new Array(src.length).fill(false)
  for (const s2 of spans) for (let i = s2.at; i < s2.end; i++) covered[i] = true
  const leftovers = []
  let run = ''
  for (let i = 0; i <= src.length; i++) {
    if (i < src.length && !covered[i]) { run += src[i]; continue }
    if (run.trim().length >= 10) leftovers.push(run.trim())
    run = ''
  }
  if (leftovers.length) {
    console.error(`原文のうち、どの要求にも割り当てられていない部分があります（${leftovers.length} 箇所）。`)
    leftovers.slice(0, 5).forEach(x => console.error(`    ${JSON.stringify(x)}`))
    console.error(`  原文: ${src}`)
    console.error('  ここに要求が書かれていませんか。書かれていないなら、理由をつけて外してください:')
    console.error(`    {"skip": ${JSON.stringify(leftovers[0].slice(0, 20))}, "why": "<なぜ要求でないか>"}`)
    process.exit(1)
  }

  // ⑦ 件数の下限。**要求 ＋ skip の合計**で見る。
  // 下限は「原文に実在する切れ目の数 + 1」なので、切れ目で切れば必ず満たせる。
  // 要求として書くか理由つきで外すかは選べるが、断片を黙って消すことはできない。
  // 原文の全体を 1 つの skip が覆っているとき（＝この行は丸ごと要求ではない）は免除する。
  const wholeSkip = skips.some(k => k.skip.trim() === src.trim())
  if (!wholeSkip && spans.length < r.minReq) {
    console.error(`説明された断片が足りません。この単位は最低 ${r.minReq} 個に分かれるはずですが ${spans.length} 個しかありません。`)
    console.error(`  検出根拠: ${r.flags.join(', ') || '(なし)'}`)
    console.error(`  原文: ${src}`)
    console.error('  要求として書けない断片は {"skip": …, "why": …} で外してください（記録に残ります）。')
    process.exit(1)
  }

  r.reqs = reqs.map(q => ({ text: q.text, from: q.from }))
  if (skips.length) r.skips = skips; else delete r.skips
  delete r.staleFrom
  saveEdge(edgeId(e), m)
  const none = reqs.length === 0 ? '  ← **要求ゼロ**として記録しました' : ''
  console.log(`OK ${unitId} → 要求 ${reqs.length} 件 / skip ${skips.length} 件（下限 ${r.minReq}）${none}`)
}

else if (cmd === 'judge') {
  const e = findEdge(args[0])
  // **最後の # で割る。** unitId 自体に # が含まれても壊れないようにする
  // （区切りの取り合いは、あとから id の形式を変えたときに黙って壊れる種になる）。
  const cut = String(args[1]).lastIndexOf('#')
  const unitId = cut < 0 ? String(args[1]) : String(args[1]).slice(0, cut)
  const idx = Number(cut < 0 ? NaN : String(args[1]).slice(cut + 1))
  const verdict = args[2]; const evidence = args[3] ? JSON.parse(args[3]) : null
  if (!VERDICTS.includes(verdict)) { console.error(`verdict は次のいずれか: ${VERDICTS.join(' / ')}`); process.exit(1) }
  const m = loadEdge(edgeId(e)); const r = m.get(unitId)
  if (!r || !r.reqs || !r.reqs[idx]) { console.error(`${args[1]} が台帳にありません`); process.exit(1) }
  if (verdict !== '対象外' && !evidence) { console.error('「対象外」以外の判定には evidence が必須です'); process.exit(1) }
  if (verdict === '対象外') {
    const reason = String((evidence && evidence.reason) || '').trim()
    if (!reason) { console.error('「対象外」には evidence.reason（なぜ対象外か）が必須です'); process.exit(1) }
    if (reason.length < 8) {
      console.error(`「対象外」の理由が短すぎます（8 文字以上）: ${JSON.stringify(reason)}`)
      console.error('  v22 は {"reason":"."} が通っていました。どの単位にも貼れる文は理由ではありません。')
      process.exit(1)
    }
    if (!sharesToken(reason, r.text)) {
      console.error('「対象外」の理由が、この単位の原文と 1 語も共有していません。')
      console.error(`  原文: ${r.text}`)
      console.error(`  理由: ${reason}`)
      console.error('  なぜ**この単位が**対象外なのかを、原文に触れて書いてください。')
      process.exit(1)
    }
  }

  // ── evidence を実ファイルと照合してから書く ────────────────────────────
  // 判定プロンプトは「quote は後で実ファイルと機械照合される」と宣言しているが、
  // 照合する経路がどこにも無かった。照合されない主張は自己申告と同じで、
  // レビューに報告文を渡して PASS させていた F13 と同じ構造になる。
  // 「無い」ことを示す判定は引用を持てないので、その場合は method（無いことを
  // 確かめた方法）を必須にする。どちらも無い判定は受け取らない。
  if (verdict !== '対象外') {
    const items = Array.isArray(evidence) ? evidence : [evidence]
    const quoted = items.filter(x => x && typeof x.quote === 'string' && x.quote.trim())

    // 「在る」と主張する判定（一致 / 部分）は逐語引用でしか示せない。
    // v22 は method だけで通ったので、`judge 一致 '{"method":"x"}'` を全件に流すと
    // 25 要求が「完了」になった（実測）。method は「無い」ことの証拠でしかない。
    const ASSERTS_PRESENCE = ['一致', '部分']
    const needsQuote = ASSERTS_PRESENCE.includes(verdict)
    if (!quoted.length) {
      const method = items.map(x => x && x.method).filter(Boolean).join(' ')
      if (needsQuote) {
        console.error(`「${verdict}」は下位に降りていることの判定なので、逐語引用（quote）が必須です。`)
        console.error('  method は「無いことを確かめた方法」なので、在ることの証拠には使えません。')
        console.error(`  下位を実際に開き、要求が降りている本文を ${'12'} 文字以上そのまま引用してください。`)
        console.error('  降りていないなら、それは 不一致 / 部分 ではなく**自分の書き漏らし**です。書き足してから判定し直してください。')
        process.exit(1)
      }
      if (!method.trim()) {
        console.error('evidence には quote（逐語引用）か method（無いことを確かめた方法）のどちらかが必須です。')
        console.error('  「在る」と判定するなら quote を、「無い」と判定するなら grep した語と結果件数を method に書いてください。')
        process.exit(1)
      }
    }
    const allowFiles = allowFilesFor(e)
    const bad = []
    const warns = []
    for (const q of quoted) {
      const v = checkEvidence(q, {
        strict: true,
        requireQuote: needsQuote,
        allowFiles: needsQuote ? allowFiles : null,
        matchAny: matchesAny,
      })
      if (!v.ok) bad.push(`${q.file}:${q.line ?? '?'} → ${v.reason}`)
      else if (v.warn) warns.push(`${q.file}:${q.line ?? '?'} → ${v.warn}`)
    }
    if (bad.length) {
      console.error('evidence が実ファイルと一致しないため、この判定は記録しません。')
      bad.forEach(b => console.error(`  ✗ ${b}`))
      console.error('  quote は逐語です。要約・整形しないでください。該当箇所を開き直して引用し直してください。')
      process.exit(1)
    }
    warns.forEach(x => console.log(`△ ${x}`))
    r.reqs[idx].evidenceChecked = { at: new Date().toISOString(), quotes: quoted.length, warns: warns.length }
  }

  r.reqs[idx].verdict = verdict
  r.reqs[idx].evidence = evidence
  // 誰が判定したかを残す。humanJudged の段は by: 'human' が揃うまで完了にならない。
  r.reqs[idx].by = rest.includes('--human') ? 'human' : 'ai'
  r.reqs[idx].at = new Date().toISOString()
  saveEdge(edgeId(e), m)
  console.log(`OK ${args[1]} = ${verdict}${r.reqs[idx].by === 'human' ? '（人間判定）' : ''}`)
}

else if (cmd === 'pending') {
  // 担当範囲の「未分解」「未判定」を数える。Stop hook と /wp がこれを見る。
  //
  // なぜ要るか:
  //   台帳は事後監査の位置に置かれていて、**ブレイクダウンしている最中**には効いていなかった。
  //   分母が固定されないまま書くから漏れる。書く前に分解が済んでいることを機械が要求する。
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const rows = [...m.values()].filter(inScope)
  const undecomposed = rows.filter(r => !Array.isArray(r.reqs))
  const reqs = rows.filter(r => Array.isArray(r.reqs)).flatMap(r => r.reqs)
  const unjudged = reqs.filter(q => !q.verdict)
  const judgedAll = reqs.filter(q => q.verdict)
  const humanPending = e.humanJudged === true
    ? judgedAll.filter(q => q.by !== 'human').length
    : e.humanJudged === 'partial'
      ? (judgedAll.length && !judgedAll.some(q => q.by === 'human') ? 1 : 0)
      : 0
  const out = {
    edge: edgeId(e), scope: { file: opt('file') || null, section: opt('section') || null },
    units: rows.length, undecomposed: undecomposed.length,
    unitsNoRequirement: rows.filter(r => Array.isArray(r.reqs) && r.reqs.length === 0).length,
    noRequirementIds: rows.filter(r => Array.isArray(r.reqs) && r.reqs.length === 0).slice(0, 20).map(r => r.unitId),
    requirements: reqs.length, unjudged: unjudged.length, humanPending,
    problems: reqs.filter(q => q.verdict && q.verdict !== '一致' && q.verdict !== '対象外').length,
    undecomposedIds: undecomposed.slice(0, 20).map(r => r.unitId),
  }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`${out.edge}${out.scope.file ? ` / ${out.scope.file}` : ''}${out.scope.section ? ` / §${out.scope.section}` : ''}`)
    console.log(`  単位 ${out.units}  未分解 ${out.undecomposed}  要求 ${out.requirements}  未判定 ${out.unjudged}  不一致等 ${out.problems}${out.unitsNoRequirement ? `  要求ゼロ ${out.unitsNoRequirement}` : ''}${out.humanPending ? `  人間判定待ち ${out.humanPending}` : ''}`)
    if (out.unitsNoRequirement) {
      // 逃げ道は用意するが、使ったことは必ず目に入る場所に出す。
      console.log(`\n  ${out.unitsNoRequirement} 単位が「要求ゼロ」として記録されています。`)
      console.log(`  **この分は分母に入っていません。** 妥当かどうかは人が見てください:`)
      out.noRequirementIds.slice(0, 5).forEach(x => console.log(`    node .claude/scripts/ledger.mjs show ${JSON.stringify(out.edge)} ${JSON.stringify(x)}`))
    }
    if (out.undecomposed) {
      console.log(`\n  未分解が ${out.undecomposed} 件あります。**分母が固定されていない状態です。**`)
      console.log(`  先に分解してください: node .claude/scripts/ledger.mjs next ${JSON.stringify(out.edge)} --phase decompose${out.scope.file ? ` --file ${JSON.stringify(out.scope.file)}` : ''}`)
    }
  }
  process.exit(0)
}

else if (cmd === 'scope') {
  // どこまで絞れるかを見るための一覧（章ごとの未処理件数）
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e))
  const byFile = {}
  for (const r of m.values()) {
    const k = r.file
    byFile[k] ??= { units: 0, undecomposed: 0, reqs: 0, unjudged: 0, sections: new Set() }
    const b = byFile[k]
    b.units++; if (r.section) b.sections.add(String(r.section).split(' > ')[0])
    if (!Array.isArray(r.reqs)) b.undecomposed++
    else { b.reqs += r.reqs.length; b.unjudged += r.reqs.filter(q => !q.verdict).length }
  }
  const rows = Object.entries(byFile).map(([file, b]) => ({ file, ...b, sections: [...b.sections] }))
  console.log(json ? JSON.stringify(rows, null, 2)
    : rows.map(r => `${String(r.undecomposed || r.unjudged).padStart(5)} 未処理  ${r.file}  （単位 ${r.units} / 要求 ${r.reqs}）`).join('\n')
      + `\n\n一部だけ回すなら: node .claude/scripts/ledger.mjs next ${edgeId(e)} --file <ファイル名の一部>`)
}

else if (cmd === 'stale') {
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e))
  const rows = [...m.values()].filter(r => r.staleFrom)
  if (json) { console.log(JSON.stringify(rows, null, 2)) }
  else if (!rows.length) { console.log('陳腐化した単位はありません。') }
  else {
    console.log(`上位の本文が変わった単位が ${rows.length} 件あります。分解と判定をやり直してください。\n`)
    for (const r of rows) {
      console.log(`${r.unitId}`)
      console.log(`  ${r.file}:${r.line}${r.label ? ` [${r.label}]` : ''}`)
      if (r.staleText) console.log(`  変更前: ${String(r.staleText).slice(0, 100)}`)
      console.log(`  変更後: ${String(r.text).slice(0, 100)}`)
      if (r.stalePrevReqs?.length) {
        console.log(`  以前の分解 ${r.stalePrevReqs.length} 件（参照用。そのまま使い回さないこと）:`)
        r.stalePrevReqs.slice(0, 5).forEach(q => console.log(`    - ${String(q.text).slice(0, 80)}${q.verdict ? `  [${q.verdict}]` : ''}`))
      }
      console.log('')
    }
    console.log(`  node .claude/scripts/ledger.mjs next ${JSON.stringify(edgeId(e))} --phase decompose`)
  }
}

else if (cmd) {
  console.log('使い方: ledger.mjs sync|stats|pending|next|show|decompose|judge|stale|scope')
  console.log('  next の既定は全件。--file <部分一致> / --section <部分一致> / 件数 で絞れる。')
}

