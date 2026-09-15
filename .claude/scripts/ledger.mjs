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
//   node .claude/scripts/ledger.mjs approve-next <edge> [件数|all] [--file <部分一致>] [--ids-only]
//   node .claude/scripts/ledger.mjs approve-show <edge> <entryId>
//   node .claude/scripts/ledger.mjs approve <edge> <entryId> <要求|要求でない|判断できない> '<json>'
//     分解した断片 1 つずつに「これは要求か」を別の目で答える。分解した側とは別の役が行う。
//     「要求」と答えるときは expect（下位に現れるはずの一文）が必須。**書けないものは要求ではない。**
//   node .claude/scripts/ledger.mjs concede <edge> <entryId> [--why "<理由>"]
//     指摘に同意して、その要求を同じ断片の対象外へ移す。承認はそのまま引き継ぐ。
//     **同意するのを一番安くしておく**（高いと「反論して押し切る」が最短経路になる）。
//   node .claude/scripts/ledger.mjs rebut <edge> <entryId> '<json>'
//     指摘に反論して分解した側の扱いを維持する。維持する側にも expect を課す（反論を無料にしない）。
//   node .claude/scripts/ledger.mjs approval-report <edge> [--json]
//   node .claude/scripts/ledger.mjs pending <edge> [--file <部分一致>] [--section <部分一致>] [--json]
//     担当範囲の未分解／未判定の件数。Stop hook と /wp が「分母が固定されているか」を見るのに使う
//   node .claude/scripts/ledger.mjs stale <edge>
//     edge は "req->bd" の形式。**シェルでは必ず引用符で囲む**（`>` はリダイレクト）。
//     引用を忘れて `req-` になった場合は、その旨を出して止まる。`req:bd` の形も受け付ける。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, config, json, matchesAny, tier, tierFiles, read as readRel } from './lib/config.mjs'
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

// ── 承認（分解が「要求」として正しいかを、別の目で見る）─────────────────
//
// 形の検査（from が逐語か・区間が重なっていないか・取り残しが無いか）は、
// **嘘の紐付け**を全部捕まえる。捕まえられないのは
// 「紐付けは正しいが、そもそも要求ではない」もの——
// `（PC版）` → 「（PC版）を対象とした利用シーンである」は形として満点である。
// 意味を読まないと判定できないので、機械には原理的に見えない。
//
// そこで、分解とは別の役に 1 断片ずつ同じ問いを出す:
//   **「この断片は要求か」**（＝下位に書かれていなければ不備といえるか）
// 答えは 3 つに固定し、「要求」と答えるときは
//   **その要求が満たされたとき下位の文書に現れるはずの一文**（expect）
// を書かせる。書けないものは要求ではない。感想ではなく作文を課すことで、
// 「なんとなく良さそう」で通せなくする。
//
// 分解した側が水増しするのは**下限があるから**で、承認する側に下限は無い。
// 同じモデルでも掛かっている圧力が違うので、間違え方が違う。
// 重ならない誤りを二重に通すことだけが、この仕掛けの根拠である。
// 承認する側に件数の目標を与えた時点で、この根拠は消える。
export const APPROVAL_VERDICTS = ['要求', '要求でない', '判断できない']
export const NON_REQ_KINDS = ['ラベル・項目名', '目的・ねらい', '枠組み・位置づけ', '経緯・旧方針', '出典・参照', '根拠・前提の説明', 'プロジェクトの属性']

function hash12(x) { return createHash('sha256').update(String(x)).digest('hex').slice(0, 12) }

// 承認は**断片ごと**に紐づける。単位全体のハッシュに紐づけると、
// 10 件のうち 1 件を直しただけで残り 9 件の承認が消える。
// 「この断片は要求か」は断片だけで決まる問いなので、他の断片が変わっても答えは変わらない。
// 上位の原文そのものが変わった場合は sync が reqs を落とすので、そこで一緒に消える。
export function entriesOf(r) {
  const out = []
  ;(r.reqs || []).forEach((q, i) => out.push({ id: `${r.unitId}#${i}`, kind: 'req', idx: i, span: String(q.from || ''), text: String(q.text || ''), node: q }))
  ;(r.skips || []).forEach((k, i) => out.push({ id: `${r.unitId}#s${i}`, kind: 'skip', idx: i, span: String(k.skip || ''), text: String(k.why || ''), node: k }))
  return out
}
export function entryKeyOf(e) { return hash12(`${e.kind}\u0000${e.span}\u0000${e.text}`) }

// 断片ごとの承認の状態。
//   未承認     … まだ見ていない
//   承認       … 承認する側の答えと、分解した側の扱いが一致した
//   指摘       … 食い違った（要求として書いたものを「要求でない」と言われた、またはその逆）
//   反論で維持 … 指摘に対して反論が記録され、そのまま維持されている
//   保留       … 承認する側が判断できないと答えた
export function entryApproval(e) {
  const a = e.node.approval
  if (!a || a.of !== entryKeyOf(e)) return { state: '未承認', approval: null }
  if (a.verdict === '判断できない') return { state: '保留', approval: a }
  const agrees = (a.verdict === '要求') === (e.kind === 'req')
  if (agrees) return { state: '承認', approval: a }
  const reb = e.node.rebuttal
  if (reb && reb.of === entryKeyOf(e)) return { state: '反論で維持', approval: a, rebuttal: reb }
  return { state: '指摘', approval: a }
}

// 承認の集計。**「指摘」は消さない。**
// 承認する側が誤って「要求でない」と言ったとき黙って消すと、
// 網羅台帳が存在する理由そのもの——落ちが無いこと——が壊れる。
// 落ちるより残るほうが安全な側に倒す。
export function approvalCounts(rows) {
  const c = { entries: 0, unseen: 0, ok: 0, challenged: 0, heldOver: 0, deferred: 0 }
  const KEY = { '未承認': 'unseen', '承認': 'ok', '指摘': 'challenged', '反論で維持': 'heldOver', '保留': 'deferred' }
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const e of entriesOf(r)) { c.entries++; c[KEY[entryApproval(e).state]]++ }
  }
  // 未解決 = まだ人（または次の手）が動かないと決着しないもの。
  // **反論で維持は未解決に含めない**（記録が残り、別に数えられる）。
  c.unresolved = c.unseen + c.challenged + c.deferred
  return c
}

// 承認する側が下位の文書を覗いたかどうかの手がかり。
//
// 承認は「下位に無ければ不備といえるか」を**上位だけを見て**答える作業である。
// 下位を開くと「下位に書いてあるから要求だ」という逆立ちした判断になり、
// 下位に無いものだけが「要求でない」に落ちる——つまり**漏れを漏れでないことにする**。
// 分解で下位を見せない理由と同じで、ここが一番効く。
//
// ただし**止めない。** 偶然の一致はあり得るし、当たっていない検査で止めると
// 警告そのものを無視する癖がつく。記録して数えるだけにして、
// approval-report で「多いかどうか」を見る。
export function expectFoundBelow(edge, expect) {
  const t = (() => { try { return tier(edge.to) } catch { return null } })()
  if (!t || !expect || expect.length < 12) return null
  let files = []
  try { files = tierFiles(edge.to) } catch { return null }
  for (const f of files) {
    let body = ''
    try { body = readRel(f) } catch { continue }
    const at = body.indexOf(expect)
    if (at >= 0) return { file: f, line: body.slice(0, at).split('\n').length }
  }
  return null
}

// 語尾の型。**承認する側には絶対に見せない。**
// 「非要求は語尾で見分けられる（要求は『〜すること』、非要求は『〜である』）」
// という仮説を、承認の結果と突き合わせて**あとから**測るためだけに使う。
// 先に見せると仮説が答えを作ってしまい、測定にならない。
export function endingKind(text) {
  const t = String(text || '').trim().replace(/[。．.\s]+$/, '')
  if (/(こと|できる|可能|とする)$/.test(t)) return '規範形'
  if (/(である|だ|とされる|位置づける|重視する|想定する|前提とする)$/.test(t)) return '説明形'
  return 'その他'
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
  // 承認（③）。**既定では完了を止めない。**
  // 止めるかどうかは project.json の edge ごとの requireApproval で決める。
  // 最初から止めると、承認がどのくらい当たるかを測る前に作業が止まる。
  // まず全部に回して当たり方を測り、それから止める側に倒す——という順番にしている。
  const ap = approvalCounts(rows)
  const approvalPending = edge.requireApproval ? ap.unresolved : 0
  // 順番に意味がある。**承認は判定より先。**
  //   分解が残っている        → 進行中（まず分母を固定する）
  //   承認が未解決            → 承認待ち（**判定より先に決着させる**）
  //   判定が残っている        → 進行中
  // 承認を判定の後ろに置くと、承認で落ちる断片を先に判定することになり、
  // その判定は捨てることになる。そのうえ**水増しされた分母の上に「判定済」が積み上がる**——
  // 数字が増えるほど直しにくくなる方向なので、先に決着させる。
  const state =
    rows.length === 0                              ? '未初期化'
    : decomposed.length === 0                       ? '未着手'
    : (rows.length - decomposed.length) > 0         ? '進行中'
    : approvalPending > 0                           ? '承認待ち'
    : (allReqs.length - judged.length) > 0          ? '進行中'
    : humanPending > 0                              ? '人間判定待ち'
    : '完了'
  return {
    edge: id, kind: edge.kind, humanJudged: edge.humanJudged || false, state, humanPending,
    requireApproval: edge.requireApproval === true, approval: ap, approvalPending,
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
export const MARK = { '未初期化': '!', '未着手': '!', '進行中': '·', '承認待ち': '!', '人間判定待ち': '!', '完了': '✓', '不明': '?' }

function fmt(s) {
  if (s.error) return `${s.edge.padEnd(14)} ${s.error}`
  const human = s.humanJudged === true ? ' [全件を人が判定]' : s.humanJudged === 'partial' ? ' [人の判定が最低1件必要]' : ''
  const hint = s.state === '未初期化' ? '  ← split.mjs / ledger sync が未実行'
             : s.state === '未着手'   ? '  ← 一度も分解していない'
             : s.state === '承認待ち' ? `  ← 未承認・指摘・保留が ${s.approvalPending} 件。approve / rebut で決着させるまで完了にならない`
             : s.state === '人間判定待ち' ? `  ← AI 判定のみ ${s.humanPending} 件。judge --human で人が記録するまで完了にならない`
             : ''
  // 「要求ゼロ」は逃げ道なので、**あるときは必ず目に入る位置に出す**。
  const none = s.unitsNoRequirement ? `  要求ゼロ ${s.unitsNoRequirement}` : ''
  // 承認は既定で完了を止めないので、**数字だけは必ず出す**。
  // 出さないと「機構はあるが誰も見ていない」状態が緑のまま続く。
  const a = s.approval
  const appr = !a || !a.entries ? ''
    : `  承認 ${a.ok}/${a.entries}` + (a.challenged ? `  指摘 ${a.challenged}` : '')
      + (a.deferred ? `  保留 ${a.deferred}` : '') + (a.heldOver ? `  反論で維持 ${a.heldOver}` : '')
  return `${MARK[s.state] || ' '} ${s.edge.padEnd(14)} ${String(s.state).padEnd(5)} 単位 ${String(s.units).padStart(5)}  要求 ${String(s.requirements).padStart(5)}  判定済 ${String(s.judged).padStart(5)}  未判定 ${String(s.unjudged).padStart(5)}  不一致等 ${String(s.problems).padStart(4)}${none}${appr}${s.stale ? `  陳腐化 ${s.stale}` : ''}${human}${hint}`
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

const APPROVE_CRITERION = '下位の文書に書かれていなければ、不備といえること。'
const APPROVE_NOTE =
  '断片ごとに「これは要求か」だけを答える。下位の文書は開かない' +
  '（開くと「下位に無いから要求でない」という逆立ちした判断になり、漏れが漏れでなくなる）。' +
  ' 「要求」と答えるときは、その要求が満たされたとき下位に現れるはずの一文（expect）を書くこと。**書けないなら要求ではない。**' +
  ' 分解した側がどう扱ったかは見えているが、それに合わせる必要はない。食い違いは記録されるだけで、どちらも消えない。'

function approvePayloadOf(r, en) {
  return {
    entryId: en.id, file: r.file, line: r.line, section: r.section, label: r.label,
    source: r.text, span: en.span,
    wrote: en.kind === 'req' ? { as: '要求', text: en.text } : { as: '対象外', why: en.text },
  }
}

// entryId（"<unitId>#3" / "<unitId>#s0"）から断片を引く。
// **最後の # で割る。** unitId 自体に # が混ざっても壊れないようにする。
function findEntry(e, entryId) {
  const m = loadEdge(edgeId(e))
  const cut = String(entryId).lastIndexOf('#')
  if (cut < 0) { console.error(`entryId は "<unitId>#<番号>" の形式です: ${entryId}`); process.exit(1) }
  const unitId = String(entryId).slice(0, cut)
  const r = m.get(unitId)
  if (!r) { console.error(`unitId ${unitId} が台帳にありません`); process.exit(1) }
  if (!Array.isArray(r.reqs)) { console.error(`${unitId} はまだ分解されていません。先に分解してください。`); process.exit(1) }
  const entry = entriesOf(r).find(x => x.id === String(entryId))
  if (!entry) { console.error(`${entryId} が台帳にありません`); process.exit(1) }
  return { map: m, r, entry }
}

// 範囲が空振りしていないか。
//
// **0 件は「もう無い」ではなく「数えていない」ことがある。**
// `--file` / `--section` が当たるのは**上位側**の文書で、下位側の章名を渡しても 1 件も当たらない。
// たとえば req->bd の上位は要件定義書 1 本なので、基本設計の章名（04_editing）を
// --file に渡すと静かに 0 件が返る（実際にそうなった）。
// 台帳の他の場所では `単位 0` を「漏れなし」と読ませない検査を入れてあるのに、
// 一覧系のコマンドだけ黙って空の配列を返していた。同じ型なので同じ扱いにする。
function scopeWarning(e, m, inScope) {
  const all = [...m.values()]
  const f = opt('file'), sec = opt('section')
  if (!all.length) {
    return `この段の台帳に単位が 1 件もありません。**0 件は「漏れなし」ではありません。**\n` +
           `  先に: node .claude/scripts/split.mjs --all → node .claude/scripts/ledger.mjs sync ${JSON.stringify(edgeId(e))}`
  }
  if (!f && !sec) return null
  if (all.filter(inScope).length) return null
  const files = [...new Set(all.map(r => r.file))]
  return `**範囲が空振りしています。**（--file ${JSON.stringify(f)} / --section ${JSON.stringify(sec)}）\n` +
    `  --file と --section が当たるのは**上位側（${e.from}）**の文書です。下位側（${e.to}）の章名では 1 件も当たりません。\n` +
    `  この段の上位にあるファイル: ${files.slice(0, 8).join(' / ')}${files.length > 8 ? ` …他 ${files.length - 8} 本` : ''}\n` +
    `  **0 件は「もう無い」ではなく「数えていない」です。**`
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
  const scopeWarn = scopeWarning(e, m, inScope)
  const undecomposed = forced === 'judge' ? []
    : [...m.values()].filter(r => inScope(r) && !Array.isArray(r.reqs)).slice(0, n === Infinity ? undefined : n)
  if (undecomposed.length || forced === 'decompose') {
    const payload = idsOnly
      ? { phase: 'decompose', edge: edgeId(e), count: undecomposed.length, ids: undecomposed.map(u => u.unitId), warning: scopeWarn || undefined }
      : { phase: 'decompose', edge: edgeId(e),
          note: '上位だけを見て、この単位が要求している事項を列挙する。下位は見ない。' +
                ' 要求ごとに、原文のどの部分から読み取ったか（from）を逐語で付ける。' +
                ' 要求ではない部分（出典・履歴・接続）は {"skip": "<原文の一部>", "why": "<理由>"} で外す。' +
                ' section はその行が属する章。**章を見て、そもそも要求を書く場所かを判断すること**' +
                '（変更履歴・リスク一覧・見積もりの章に要求は無い）。',
          format: '[{"text":"<要求>","from":"<原文の逐語>"}, {"skip":"<原文の逐語>","why":"<なぜ要求でないか>"}]',
          warning: scopeWarn || undefined,
          units: undecomposed.map(u => ({ unitId: u.unitId, file: u.file, line: u.line,
                   section: u.section, label: u.label, text: u.text, minReq: u.minReq, flags: u.flags })) }
    console.log(JSON.stringify(payload, null, 2))
    if (scopeWarn) console.error(`\n${scopeWarn}\n`)
  } else {
    const pending = []
    for (const r of m.values()) { if (!inScope(r)) continue; (r.reqs || []).forEach((q, i) => { if (!q.verdict && pending.length < n) pending.push({ reqId: `${r.unitId}#${i}`, file: r.file, line: r.line, section: r.section, label: r.label, upper: r.text, requirement: q.text, from: q.from || null }) }) }
    const payload = idsOnly
      ? { phase: 'judge', edge: edgeId(e), targetTier: e.to, count: pending.length, ids: pending.map(q => q.reqId), warning: scopeWarn || undefined }
      : { phase: 'judge', edge: edgeId(e), targetTier: e.to, verdicts: VERDICTS, note: '下位を実際に開いて読み、意味で突き合わせる。目次や「反映済み」の記述を根拠にしない。', warning: scopeWarn || undefined, requirements: pending }
    console.log(JSON.stringify(payload, null, 2))
    if (scopeWarn) console.error(`\n${scopeWarn}\n`)
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
      entries: Array.isArray(r.reqs) ? entriesOf(r).map(x => {
        const a = entryApproval(x)
        return { entryId: x.id, as: x.kind === 'req' ? '要求' : '対象外', span: x.span, text: x.text,
                 approval: a.state, ...(a.approval ? { verdict: a.approval.verdict, why: a.approval.why, kind: a.approval.kind, expect: a.approval.expect, resolvesBy: a.approval.resolvesBy } : {}) }
      }) : undefined,
      note: '上位の原文だけを見て要求を列挙する。下位のファイルを開かない。' }, null, 2))
  } else {
    const q = (r.reqs || [])[Number(idxStr)]
    if (!q) { console.error(JSON.stringify({ error: `${id} が台帳にありません` })); process.exit(1) }
    // 承認の状態も出す。**指摘を受けたまま判定に進めてしまうのを防ぐ。**
    // ここに出さないと、show で 1 件だけ見て判定する経路から承認が見えない。
    const enShow = entriesOf(r).find(x => x.id === String(id))
    const apShow = enShow ? entryApproval(enShow) : null
    console.log(JSON.stringify({ phase: 'judge', edge: edgeId(e), reqId: id, targetTier: e.to,
      file: r.file, line: r.line, section: r.section, label: r.label,
      upper: r.text, requirement: q.text, from: q.from || null, verdicts: VERDICTS,
      approval: apShow ? { state: apShow.state, ...(apShow.approval || {}), rebuttal: apShow.rebuttal || undefined } : undefined,
      note: '下位を実際に開いて読み、意味で突き合わせる。目次や「反映済み」の記述を根拠にしない。'
            + (apShow && apShow.state === '指摘' ? ' **この要求は「要求でない」と指摘されています。** 判定より先に決着させてください。' : '') }, null, 2))
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
    console.error('  道は 2 つあります。')
    console.error('  A) from がずれている … その要求が実際に読み取れる部分を指し直す')
    console.error('  B) **そもそも要求でない** … 要求にせず、理由をつけて外す')
    console.error(`       {"skip": ${JSON.stringify(swapped[0].from)}, "why": "<なぜ要求でないか>"}`)
    console.error('     ラベル・目的・経緯・出典・枠組みの句は要求ではありません。')
    console.error('     **要求文のほうを出どころの語に寄せて辻褄を合わせないこと。**')
    console.error('     それをやると、要求でないものが要求として台帳に残ります（実際に起きた）。')
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

  // 分解を書き直しても、**内容が変わっていない断片の承認は引き継ぐ。**
  // 引き継がないと、10 件のうち 1 件を直すたびに残り 9 件を承認し直すことになり、
  // 「指摘を受けたら直す」という正しい行動が一番高くつく。
  // 引き継ぎの鍵は断片の内容そのもの（種別＋出どころ＋本文）なので、
  // 1 文字でも変われば別物になり、承認は付いてこない。
  const carried = new Map()
  const bySpan = new Map()
  for (const e0 of entriesOf(r)) {
    if (!e0.node.approval) continue
    carried.set(entryKeyOf(e0), { approval: e0.node.approval, rebuttal: e0.node.rebuttal })
    bySpan.set(e0.span, e0.node.approval)
  }
  const revive = (kind, span, text, node) => {
    const prev = carried.get(entryKeyOf({ kind, span, text }))
    if (prev?.approval) { node.approval = prev.approval; if (prev.rebuttal) node.rebuttal = prev.rebuttal; return node }
    // **指摘に従って直した分は、承認し直させない。**
    // 「この断片は要求でない」と言われて要求から対象外へ移したのは、指摘への同意である。
    // それを「内容が変わったから未承認」に戻すと、指摘に従うことが一番高くつく——
    // 承認を通す最短経路が「反論して押し切る」になってしまう。**そこは絶対に逆にしない。**
    //
    // 逆向き（「要求である」と言われて対象外から要求へ移した）は引き継がない。
    // 承認する側は「その断片は要求だ」と言っただけで、**新しく書かれた要求文は見ていない。**
    // 見ていないものを承認済みにはできない。
    const byspan = bySpan.get(span)
    if (byspan && byspan.verdict === '要求でない' && kind === 'skip') {
      node.approval = { ...byspan, of: entryKeyOf({ kind, span, text }), viaCompliance: true }
    }
    return node
  }
  r.reqs = reqs.map(q => revive('req', q.from, q.text, { text: q.text, from: q.from }))
  if (skips.length) r.skips = skips.map(k => revive('skip', k.skip, k.why, { skip: k.skip, why: k.why })); else delete r.skips
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

else if (cmd === 'approve-show') {
  // 1 断片だけを取り出す。**judge 向けの show とは別口にしてある。**
  // judge の show は「下位を開いて突き合わせろ」と書いた payload を返すので、
  // 承認する側にそれを渡すと、下位を開く経路をこちらから教えることになる。
  const e = findEdge(args[0]); const found = findEntry(e, args[1])
  const a = entryApproval(found.entry)
  console.log(JSON.stringify({
    phase: 'approve', edge: edgeId(e), verdicts: APPROVAL_VERDICTS, nonReqKinds: NON_REQ_KINDS,
    criterion: APPROVE_CRITERION, note: APPROVE_NOTE,
    state: a.state,
    ...approvePayloadOf(found.r, found.entry),
  }, null, 2))
}

else if (cmd === 'approve-next') {
  // 承認する側に渡す一覧。**まだ誰も見ていない断片だけ**を出す。
  //
  // 渡すもの: 原文・その断片・分解した側がどう扱ったか。
  // 渡さないもの: 分解した側の理屈（記録に無い）、語尾の型（仮説の検証を汚す）、
  //               他の断片の承認結果（前の答えに引きずられる）。
  const e = findEdge(args[0]); const n = limitOf(args[1]); const inScope = scopeFilter()
  const idsOnly = rest.includes('--ids-only')
  const m = loadEdge(edgeId(e))
  const todo = []
  for (const r of m.values()) {
    if (!inScope(r) || !Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      if (entryApproval(en).state !== '未承認') continue
      if (todo.length >= n) break
      todo.push(approvePayloadOf(r, en))
    }
  }
  const inS = [...m.values()].filter(inScope)
  const warn = scopeWarning(e, m, inScope)
    || (todo.length === 0 && inS.length && !inS.some(r => Array.isArray(r.reqs))
        ? `この範囲はまだ 1 件も分解されていません（単位 ${inS.length}）。**承認するものが無いのではなく、分解がまだです。**\n` +
          `  先に: node .claude/scripts/ledger.mjs next ${JSON.stringify(edgeId(e))} --phase decompose`
        : null)
  const counts = { unitsInScope: inS.length, decomposedInScope: inS.filter(r => Array.isArray(r.reqs)).length }
  const payload = idsOnly
    ? { phase: 'approve', edge: edgeId(e), ...counts, count: todo.length, ids: todo.map(x => x.entryId), warning: warn || undefined }
    : { phase: 'approve', edge: edgeId(e), verdicts: APPROVAL_VERDICTS, nonReqKinds: NON_REQ_KINDS,
        criterion: APPROVE_CRITERION, note: APPROVE_NOTE,
        ...counts, count: todo.length, entries: todo, warning: warn || undefined }
  console.log(JSON.stringify(payload, null, 2))
  // 警告は**標準エラーにも出す。** payload の中だけだと、人が読むときに本文に埋もれる。
  if (warn) console.error(`\n${warn}\n`)
}

else if (cmd === 'approve') {
  // 1 断片に 1 つの判定を記録する。
  const e = findEdge(args[0]); const entryId = args[1]; const verdict = args[2]
  let body
  try { body = args[3] ? JSON.parse(args[3]) : {} } catch { console.error('承認の内容は JSON オブジェクトで渡してください'); process.exit(1) }
  if (!APPROVAL_VERDICTS.includes(verdict)) { console.error(`承認の判定は次のいずれか: ${APPROVAL_VERDICTS.join(' / ')}`); process.exit(1) }
  const found = findEntry(e, entryId)
  const { r, entry } = found
  const why = String(body.why || '').trim()
  if (why.length < 15 || !sharesToken(why, r.text)) {
    console.error('承認の理由が不十分です（15 文字以上・原文の語を含むこと）。')
    console.error(`  原文: ${r.text}`)
    console.error(`  理由: ${JSON.stringify(why)}`)
    console.error('  なぜ**この断片が**そうなのかを、原文に触れて書いてください。どの断片にも貼れる文は理由ではありません。')
    process.exit(1)
  }
  const rec = { verdict, why, of: entryKeyOf(entry), at: new Date().toISOString() }
  if (verdict === '要求') {
    // **ここが承認の本体。** 感想ではなく作文を課す。
    // 「（PC版）を対象とした利用シーンである」を満たす設計書の一文は書けない。
    // 書けないものは要求ではない、という定義をそのまま作業にしている。
    const expect = String(body.expect || '').trim()
    if (expect.length < 12) {
      console.error('「要求」と答えるときは expect（この要求が満たされたとき下位の文書に現れるはずの一文）が必須です（12 文字以上）。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error('  **書けないなら要求ではありません。** その場合は「要求でない」を選んでください。')
      process.exit(1)
    }
    if (!sharesToken(expect, entry.span) && !sharesToken(expect, entry.text)) {
      console.error('expect が、この断片と 1 語も共有していません。別の断片の話になっています。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error(`  expect: ${JSON.stringify(expect)}`)
      process.exit(1)
    }
    rec.expect = expect
    const hit = expectFoundBelow(e, expect)
    if (hit) {
      // 止めない。記録して数える。
      rec.expectVerbatimIn = `${hit.file}:${hit.line}`
      console.log(`△ expect が下位の文書と逐語一致しています（${hit.file}:${hit.line}）。`)
      console.log('  承認は**上位だけを見て**答える作業です。下位を開いて写していませんか。')
      console.log('  下位を見ると「下位に書いてあるから要求だ」という逆立ちした判断になり、**漏れが漏れでなくなります。**')
    }
  } else if (verdict === '要求でない') {
    const kind = String(body.kind || '').trim()
    if (!NON_REQ_KINDS.includes(kind)) {
      console.error(`「要求でない」と答えるときは kind が必須です。次のいずれか: ${NON_REQ_KINDS.join(' / ')}`)
      console.error('  どれにも当てはまらないなら、それは要求である可能性があります。')
      process.exit(1)
    }
    rec.kind = kind
  } else {
    const resolvesBy = String(body.resolvesBy || '').trim()
    if (resolvesBy.length < 10) {
      console.error('「判断できない」と答えるときは resolvesBy（何を確かめれば決着するか）が必須です（10 文字以上）。')
      console.error('  決着のしかたを書けない保留は、ただの棄権です。')
      process.exit(1)
    }
    rec.resolvesBy = resolvesBy
  }
  entry.node.approval = rec
  delete entry.node.rebuttal
  saveEdge(edgeId(e), found.map)
  const st = entryApproval(entry).state
  console.log(`OK ${entryId} = ${verdict}  → ${st}`)
  if (st === '指摘') {
    console.log(`  分解した側は「${entry.kind === 'req' ? '要求' : '対象外'}」として扱っています。食い違いました。`)
    console.log('  **この断片は消えません。** 次のどちらかで決着させてください:')
    if (entry.kind === 'req') {
      console.log(`    同意する: node .claude/scripts/ledger.mjs concede ${JSON.stringify(edgeId(e))} ${JSON.stringify(entryId)}`)
    } else {
      console.log(`    直す    : node .claude/scripts/ledger.mjs decompose ${JSON.stringify(edgeId(e))} ${JSON.stringify(r.unitId)} '[…]'`)
    }
    console.log(`    反論する: node .claude/scripts/ledger.mjs rebut ${JSON.stringify(edgeId(e))} ${JSON.stringify(entryId)} '{"expect":"…","why":"…"}'`)
  }
}

else if (cmd === 'rebut') {
  // 指摘に反論して、分解した側の扱いを維持する。
  //
  // **反論にも同じ作文を課す。** 承認する側が「要求」と言うために
  // expect を書かされるのと同じものを、維持する側にも要求する。
  // そうしないと「反論」が無料になり、指摘を全部撥ねて終わりにできる。
  const e = findEdge(args[0]); const entryId = args[1]
  let body
  try { body = args[2] ? JSON.parse(args[2]) : {} } catch { console.error('反論は JSON オブジェクトで渡してください'); process.exit(1) }
  const found = findEntry(e, entryId)
  const { r, entry } = found
  const st = entryApproval(entry).state
  if (st !== '指摘') {
    console.error(`${entryId} は「指摘」ではありません（いまの状態: ${st}）。反論できるのは指摘を受けた断片だけです。`)
    process.exit(1)
  }
  const why = String(body.why || '').trim()
  if (why.length < 20 || !sharesToken(why, r.text)) {
    console.error('反論が不十分です（20 文字以上・原文の語を含むこと）。')
    console.error(`  原文: ${r.text}`)
    process.exit(1)
  }
  const rec = { why, of: entryKeyOf(entry), at: new Date().toISOString() }
  if (entry.kind === 'req') {
    // 「要求でない」と指摘された要求を維持する側は、
    // 承認する側が「要求」と言うときと同じ一文を書けなければならない。
    const expect = String(body.expect || '').trim()
    if (expect.length < 12 || (!sharesToken(expect, entry.span) && !sharesToken(expect, entry.text))) {
      console.error('要求として維持するなら expect（この要求が満たされたとき下位の文書に現れるはずの一文）が必須です（12 文字以上・この断片の語を含むこと）。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error('  **書けないなら、指摘のほうが正しいということです。** 分解を直してください。')
      process.exit(1)
    }
    rec.expect = expect
  }
  entry.node.rebuttal = rec
  saveEdge(edgeId(e), found.map)
  console.log(`OK ${entryId} → 反論で維持（記録に残ります）`)
  console.log('  **反論で通した件数は stats に別枠で出ます。** 多いときは、承認する側ではなく分解のほうを疑ってください。')
}

else if (cmd === 'concede') {
  // 指摘に同意して、要求を同じ断片の対象外へ移す。
  //
  // **なぜコマンドにしたか。**
  // 手でやるには分解をまるごと書き直すことになり、そのとき
  // **指摘を受けていない断片を 1 文字でも変えると、その承認まで消える。**
  // 直すのが一番高くつくと、承認を通す最短経路が「反論して押し切る」になる。
  // そこは絶対に逆にしない、というのがこの仕組みの土台なので、
  // **同意するのが一番安い**ようにしておく。
  //
  // 区間（span）は動かさないので、重なり・取り残し・下限の検査結果は変わらない。
  // 変わるのは「要求として数えるか、理由つきで外すか」だけ。
  const e = findEdge(args[0]); const entryId = args[1]
  const found = findEntry(e, entryId)
  const { r, entry } = found
  const a = entryApproval(entry)
  if (a.state !== '指摘') {
    console.error(`${entryId} は「指摘」ではありません（いまの状態: ${a.state}）。同意できるのは指摘を受けた断片だけです。`)
    process.exit(1)
  }
  if (entry.kind !== 'req') {
    // 逆向き（対象外にしたものを「要求である」と指摘された）は自動で直せない。
    // **要求の文は分解した側が書くものだから。** 機械が作文すると、
    // 誰も書いていない要求が台帳に載る。
    console.error(`${entryId} は対象外として書かれた断片で、「要求である」と指摘されています。`)
    console.error('  **要求の文は自動では作れません。** 分解し直して、その断片を要求として書いてください:')
    console.error(`    node .claude/scripts/ledger.mjs decompose ${JSON.stringify(edgeId(e))} ${JSON.stringify(r.unitId)} '[…]'`)
    process.exit(1)
  }
  const why = String(opt('why') || '').trim()
    || `${a.approval.kind}であり、${String(entry.span).slice(0, 20)} は下位へ降ろす要求を含まない`
  if (why.length < 15 || !sharesToken(why, r.text)) {
    console.error(`対象外にする理由が不十分です（15 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
    console.error(`  原文: ${r.text}`)
    console.error('  --why "<なぜこの部分が要求でないか>" で書き直してください。')
    process.exit(1)
  }
  r.reqs.splice(entry.idx, 1)
  const node = { skip: entry.span, why, concededFrom: { kind: a.approval.kind, at: new Date().toISOString() } }
  // 承認を引き継ぐ。**同意したのに承認し直させない。**
  node.approval = { ...a.approval, of: entryKeyOf({ kind: 'skip', span: entry.span, text: why }), viaCompliance: true }
  r.skips = [...(r.skips || []), node]
  saveEdge(edgeId(e), found.map)
  console.log(`OK ${entryId} → 対象外へ移しました（要求 ${r.reqs.length} 件 / 対象外 ${r.skips.length} 件）`)
  console.log(`  理由: ${why}`)
  if (!r.reqs.length) console.log('  ← この単位は**要求ゼロ**になりました。pending に件数が出ます。')
}

else if (cmd === 'approval-report') {
  // 承認が当たっているかを**あとから**測るための集計。
  // 語尾の型（規範形 / 説明形）は承認する側に一切渡していないので、
  // ここでの突き合わせは「仮説が結果と合っているか」の検証になる。
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const rows = [...m.values()].filter(inScope)
  const c = approvalCounts(rows)
  const cross = {}
  const kinds = {}
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const a = entryApproval(en)
      if (a.state === '未承認') continue
      if (en.kind !== 'req') continue
      const k = endingKind(en.text)
      cross[k] ??= { 要求: 0, 要求でない: 0, 判断できない: 0 }
      cross[k][a.approval.verdict]++
      if (a.approval.verdict === '要求でない') kinds[a.approval.kind] = (kinds[a.approval.kind] || 0) + 1
    }
  }
  let peeked = 0, viaCompliance = 0, conceded = 0
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const a = en.node.approval
      if (!a || a.of !== entryKeyOf(en)) continue
      if (a.expectVerbatimIn) peeked++
      if (a.viaCompliance) viaCompliance++
      if (en.node.concededFrom) conceded++
    }
  }
  const out = { edge: edgeId(e), counts: c, endingVsVerdict: cross, nonReqKinds: kinds, expectVerbatimBelow: peeked, carriedByCompliance: viaCompliance, conceded }
  if (json) { console.log(JSON.stringify(out, null, 2)); }
  else {
    console.log(`${out.edge}  断片 ${c.entries}  承認 ${c.ok}  指摘 ${c.challenged}  保留 ${c.deferred}  反論で維持 ${c.heldOver}  未承認 ${c.unseen}`)
    if (!Object.keys(cross).length) { console.log('\n承認済みの要求がまだありません。'); }
    else {
      console.log('\n要求として書かれた断片の語尾 × 承認の判定（語尾は承認する側に見せていない）')
      for (const [k, v] of Object.entries(cross)) {
        const tot = v['要求'] + v['要求でない'] + v['判断できない']
        console.log(`  ${k.padEnd(4)}  計 ${String(tot).padStart(4)}   要求 ${String(v['要求']).padStart(4)}   要求でない ${String(v['要求でない']).padStart(4)}   判断できない ${String(v['判断できない']).padStart(3)}`)
      }
      console.log('\n  説明形の「要求でない」率が高いなら、語尾で先に絞り込める（＝承認を全件に回さなくてよい）。')
      console.log('  差が出ないなら、語尾は使えない。**その場合は全件に回し続けること。**')
    }
    if (peeked) {
      console.log(`\n  expect が下位の文書と逐語一致したもの: ${peeked} 件`)
      console.log('  **多いなら、承認する側が下位を開いています。** その場合この承認は当てになりません（下位に無いものだけが「要求でない」に落ちる）。')
    }
    if (viaCompliance) console.log(`\n  指摘に従って直したため承認を引き継いだもの: ${viaCompliance} 件`)
    if (conceded) console.log(`  うち concede で対象外へ移したもの: ${conceded} 件`)
    if (Object.keys(kinds).length) {
      console.log('\n「要求でない」の内訳')
      Object.entries(kinds).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`))
    }
  }
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
  const ap = approvalCounts(rows)
  const challengedIds = []
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const st = entryApproval(en).state
      if ((st === '指摘' || st === '保留') && challengedIds.length < 20) challengedIds.push(en.id)
    }
  }
  const out = {
    edge: edgeId(e), scope: { file: opt('file') || null, section: opt('section') || null },
    requireApproval: e.requireApproval === true,
    approval: ap, approvalUnresolved: ap.unresolved, challengedIds,
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
    if (out.approval.entries) {
      console.log(`  承認 ${out.approval.ok}/${out.approval.entries}  未承認 ${out.approval.unseen}  指摘 ${out.approval.challenged}  保留 ${out.approval.deferred}  反論で維持 ${out.approval.heldOver}`)
    }
    if (out.approval.challenged || out.approval.deferred) {
      // **指摘は消さない。** だから、見えるところに出し続けるしかない。
      console.log(`\n  承認する側と食い違った断片が ${out.approval.challenged + out.approval.deferred} 件あります。`)
      console.log('  同意する（concede）か、反論する（rebut）かで決着させてください。**同意のほうが安く済みます**:')
      challengedIds.slice(0, 5).forEach(x => console.log(`    node .claude/scripts/ledger.mjs show ${JSON.stringify(out.edge)} ${JSON.stringify(x)}`))
    }
    if (out.approval.unseen) {
      console.log(`\n  まだ承認を通していない断片が ${out.approval.unseen} 件あります。`)
      console.log(`    node .claude/scripts/ledger.mjs approve-next ${JSON.stringify(out.edge)}${out.scope.file ? ` --file ${JSON.stringify(out.scope.file)}` : ''}`)
      if (!out.requireApproval) console.log('  （この段は requireApproval が立っていないので、未承認でも完了にはなります）')
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
  console.log('使い方: ledger.mjs sync|stats|pending|next|show|decompose|judge|stale|scope|approve-next|approve-show|approve|concede|rebut|approval-report')
  console.log('  next の既定は全件。--file <部分一致> / --section <部分一致> / 件数 で絞れる。')
}

