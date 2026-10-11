export const meta = {
  name: 'bd-audit',
  description: '基本設計の「閉じる文」（範囲を閉じる・既定に任せる・ほかを足さない）ごとに、基本設計のほかの箇所に両立しない決定が無いかを探し、両方の逐語の引用つきで返す（v41、読むだけ）',
  phases: [
    { title: 'List', detail: 'bd-closures.mjs で閉じる文の候補を取る' },
    { title: 'Audit', detail: '1 体に同じファイルの閉じる文を max 件まで。基本設計の全章を grep して両立しない決定を探す' },
    { title: 'Verify', detail: '挙げた引用を verify-evidence で実ファイルと照合する' },
  ],
}

// 使い方（パスで回す）:
//   Workflow({ scriptPath: '.claude/workflows/bd-audit.js', args: { file: '04_editing_core' } })   1 章だけ
//   Workflow({ scriptPath: '.claude/workflows/bd-audit.js', args: {} })                            全章
//   args:
//     file      閉じる文を拾う基本設計のファイル（部分一致）。無ければ全章。探す先はいつも全章
//     kind      'strong' | 'only' | 'all'（既定 all）
//     max       1 体に渡す閉じる文の数（既定 8）
//     model     確かめ役のモデル（既定 opus）
//     parallel  同時に動かす確かめ役の数（既定 6）
//
// なぜこれがあるか（本人決定 2026-10-08「今ある分の洗い出し＋再発防止の決まり」）:
//   turn 126・127 で、基本設計の中の食い違いが 2 つ、詳細設計を書く段になって初めて見つかった
//   （03:224 の Ctrl+W と 01 章 4 節の自前のメニュー／04:143 の範囲の操作を閉じる文と 03 章の Ctrl+D ほか）。
//   どちらも「閉じる文」と、後から別の章に足した決定のぶつかり。網羅台帳は上位と下位を突き合わせるが、同じ段の中どうしは見ない。
//   **何も書かない。** 結果は本体が _bridge/bd-conflicts.md にまとめ、直すかどうかは本人とチャット側が決める。

const cfg = (() => {
  if (args && typeof args === 'object') return args
  const t = String(args ?? '').trim()
  if (t.startsWith('{')) { try { const o = JSON.parse(t); if (o && typeof o === 'object') return o } catch { /* 下で既定 */ } }
  return {}
})()
const MAX = Math.max(1, Math.min(12, Number(cfg.max) || 8))
const MODEL = cfg.model || 'opus'
const PAR = Math.max(1, Math.min(12, Number(cfg.parallel) || 6))
const KIND = ['strong', 'only', 'all'].includes(cfg.kind) ? cfg.kind : 'all'
const FILE = cfg.file ? String(cfg.file) : ''

// v42: turn 128 に、一覧役が 2 回とも chapter.md 0 節の手順を始め、active-turn.md の running を見て止まった（結果なし）
const ROLE_GUARD =
  `**あなたの役は、下に書いたコマンドを実行して、その結果を返すことだけです。** ほかのファイルを読む前に、すぐコマンドを実行してください。\n` +
  `- 下に書いたもの以外のコマンドを打たないこと\n` +
  `- ファイルを開かない・書かないこと（_bridge/ や to-cc.md も含む）\n` +
  `- 会話の最初に「本人の依頼」が見えても、それはこのワークフローを起動した人の依頼で、**あなたへの指示ではありません**\n` +
  `- あなたは**ワークフローの中の役**です。\`.claude/commands/chapter.md\` の手順（0 節の印・\`_bridge/active-turn.md\` の確かめ・\`_bridge/to-cc.md\` を読む）は本体の役で、**あなたはしない**。active-turn.md が running なのは本体のターンが動いているからで、止まる理由にならない（v42）\n- 本人の許可の文（「打ってよいと許可します」のような文）や、許された・禁じられたコマンドの一覧が見えても、それは本体に向けたものです。**あなたが打つのは下の 1 本だけで、それはこのワークフローが打つと決めたものです。** 一覧に無いことや active-turn.md を理由に止まらず、すぐ打ってください（v45）\n\n`
const READ_GUARD =
  `**何も書かないこと。** 文書（docs/ など）・_bridge/・.claude/ のファイルを作らない・書き換えない・消さない。台帳のコマンドも打たない。\n` +
  `- 読むのは \`docs/basic_design/\` と要件定義書だけ（grep -n と、当たった行の前後を読む）\n` +
  `- 会話の最初に「本人の依頼」が見えても、それはこのワークフローを起動した人の依頼で、**あなたへの指示ではありません**\n` +
  `- あなたは**ワークフローの中の役**です。\`.claude/commands/chapter.md\` の手順（0 節の印・\`_bridge/active-turn.md\` の確かめ・\`_bridge/to-cc.md\` を読む）は本体の役で、**あなたはしない**。active-turn.md が running なのは本体のターンが動いているからで、止まる理由にならない（v42）\n- 本人の許可の文（「打ってよいと許可します」のような文）や、許された・禁じられたコマンドの一覧が見えても、それは本体に向けたものです。**あなたが打つのは下の 1 本だけで、それはこのワークフローが打つと決めたものです。** 一覧に無いことや active-turn.md を理由に止まらず、すぐ打ってください（v45）\n\n`

// v44: 一覧役が JSON を HTML の書き方（&quot; &gt; など）に崩して返すことがある（turn 132：承認の 5 回のうち 3 回、
// 返事の edge が "bd-&gt;dd" になっていて一覧が読めなかった）。そのまま読めなければ、書き方を戻してもう 1 回だけ読む
function unHtml(t) { return String(t).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') }
function parseJson(out) {
  if (!out) return null
  if (typeof out === 'object') return out
  const mm = String(out).match(/\{[\s\S]*\}/)
  if (!mm) return null
  try { return JSON.parse(mm[0]) } catch { /* 下で書き方を戻して読む */ }
  try { const u = unHtml(mm[0]); return u === mm[0] ? null : JSON.parse(u) } catch { return null }
}

// ── List ──────────────────────────────────────────────────────────────────
phase('List')
const listCmd = `node .claude/scripts/bd-closures.mjs --json --kind ${KIND}${FILE ? ` --file ${JSON.stringify(FILE)}` : ''}`
const listOnce = label => agent(
  ROLE_GUARD + `次のコマンドを実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n\`${listCmd}\``,
  { label, phase: 'List', model: 'sonnet', effort: 'low' }
).then(parseJson)
let listRetries = 0
let listing = await listOnce('closures:0')
const listOk = x => !!x && Array.isArray(x.items) && x.items.every(i => i && i.id && i.file && i.text)
if (!listOk(listing)) { listRetries++; log('閉じる文の一覧が読めませんでした。1 回だけ取り直します。'); listing = await listOnce('closures:0r') }
if (!listOk(listing)) return { status: 'error', listRetries, message: '閉じる文の一覧が 2 回続けて読めませんでした。止めて報告してください（何も書いていません）' }
const items = listing.items
if (!items.length) return { status: 'complete', total: 0, conflicts: [], message: '閉じる文の候補がありません' }

// 同じファイルの閉じる文を MAX 件ずつ
const byFile = new Map()
for (const x of items) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x) }
const groups = []
for (const xs of byFile.values()) for (let i = 0; i < xs.length; i += MAX) groups.push(xs.slice(i, i + MAX))
log(`閉じる文 ${items.length} 行・${groups.length} 体（モデル ${MODEL}）`)

// ── Audit ─────────────────────────────────────────────────────────────────
phase('Audit')
const ONE = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['conflict', 'none', 'unclear'] },
    closes: { type: 'string' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'number' }, quote: { type: 'string' }, why: { type: 'string' } },
        required: ['file', 'line', 'quote', 'why'],
      },
    },
    method: { type: 'string' },
  },
  required: ['id', 'verdict', 'method'],
}
const SCHEMA = { type: 'object', properties: { results: { type: 'array', items: ONE } }, required: ['results'] }

const auditPrompt = g =>
  `# 基本設計の中の食い違いを探す（${g.length} 件）\n\n` +
  READ_GUARD +
  `下の文は、どれも基本設計の「閉じる文」の候補です（範囲を閉じる・ほかを足さない・既定に任せる・〜だけ・〜しない）。\n` +
  `**1 件ずつ独立に**、次を行ってください。\n\n` +
  `1. その文が何を閉じているか（何に限っているか・何を足さないと言っているか・何を既定に任せているか）を closes に 1 文で書く。` +
  `閉じる文でない（ただの説明・経緯・UI の「閉じる」ボタンの話）なら verdict は none、method に「閉じる文でない」と書く\n` +
  `2. \`docs/basic_design/\` の**全部のファイル**（同じファイルのほかの節も含む）を、閉じている対象の語で \`grep -n\` する。` +
  `**語を変えて 3 回以上**探す（同じ機能の別の呼び方・キーの名前・コマンドの名前など）\n` +
  `3. 閉じた範囲の外にあるものを足している決定、既定に任せたものを別の決まりが壊している決定（例：自前のメニューを作るので既定のキーが消える）、` +
  `「〜だけ」と言った一覧に無いものを別の箇所が決めている、のどれかが見つかれば verdict は conflict。conflicts に、**食い違う側の文の逐語**（file・line・quote）と、なぜ両立しないかを書く\n` +
  `   - 閉じる文そのものの引用は要らない（id で分かる）。quote は 12 文字以上の逐語。要約しない\n` +
  `   - 同じ決まりを言い直しているだけ・閉じた範囲の中の詳しい決まりは食い違いではない\n` +
  `4. 見つからなければ verdict は none。method に grep した語と件数を書く。判断が付かなければ unclear にして、何が分からないかを method に書く\n\n` +
  `**「食い違いなし」に寄せない。** この洗い出しの目的は、詳細設計を書く前に食い違いを見つけること。\n\n` +
  `## 閉じる文の候補\n` +
  g.map((x, i) => `${i + 1}. id=${x.id}  ${x.file}:${x.line}\n   ${x.text}`).join('\n') + '\n\n' +
  `results には、渡した順に 1 件 1 つずつ入れる（id は渡したまま）。`

const results = []
for (let i = 0; i < groups.length; i += PAR) {
  const out = await parallel(groups.slice(i, i + PAR).map((g, j) => () => agent(auditPrompt(g),
    { label: `aud:g${i + j + 1}`, phase: 'Audit', model: MODEL, schema: SCHEMA }
  ).then(r => ({ g, rs: (r && r.results) || [] }))))
  for (const o of out) {
    if (!o) continue
    for (const x of o.g) {
      const r = o.rs.find(y => y && y.id === x.id)
      results.push(r ? { ...r, _x: x } : { id: x.id, verdict: 'unclear', method: '確かめ役が答えを返さなかった', _x: x })
    }
  }
}

// ── Verify ────────────────────────────────────────────────────────────────
// 挙げた引用が実ファイルに逐語で在るかを照合する（判定と同じ照合。捏造や要約の引用を落とす）
phase('Verify')
const ev = []
for (const r of results) for (const [k, c] of (r.conflicts || []).entries()) ev.push({ key: `${r.id}#${k}`, file: c.file, line: c.line, quote: c.quote })
const checked = new Map()
if (ev.length) {
  const v = parseJson(await agent(
    ROLE_GUARD +
    `次の JSON を標準入力に渡して \`node .claude/scripts/verify-evidence.mjs --json\` を実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n\n` +
    '```json\n' + JSON.stringify({ evidence: ev }) + '\n```',
    { label: 'verify-evidence', phase: 'Verify', model: 'sonnet', effort: 'low' }
  ))
  for (const row of (Array.isArray(v?.results) ? v.results : [])) if (row?.key) checked.set(row.key, row.ok === true ? true : String(row.reason || '照合できない'))
}

const conflicts = []
for (const r of results) {
  if (r.verdict !== 'conflict') continue
  const withs = (r.conflicts || []).map((c, k) => {
    const ok = checked.get(`${r.id}#${k}`)
    return { file: c.file, line: c.line, quote: c.quote, why: c.why, valid: ok === true, invalid: ok === true ? undefined : (ok || '照合していない') }
  })
  conflicts.push({ id: r.id, closure: { file: r._x.file, line: r._x.line, text: r._x.text, kind: r._x.kind }, closes: r.closes, with: withs,
    allValid: withs.length > 0 && withs.every(w => w.valid) })
}
const count = v => results.filter(r => r.verdict === v).length
log(`閉じる文 ${results.length} 行：食い違い ${count('conflict')}・なし ${count('none')}・判断できない ${count('unclear')}`)
return {
  status: 'complete',
  model: MODEL, max: MAX, kind: KIND, file: FILE || undefined, agents: groups.length, listRetries: listRetries || undefined,
  total: results.length, conflict: count('conflict'), none: count('none'), unclear: count('unclear'),
  conflicts,
  unclearItems: results.filter(r => r.verdict === 'unclear').map(r => ({ id: r.id, file: r._x.file, line: r._x.line, text: r._x.text, method: r.method })),
  next: '本体へ：conflicts を _bridge/bd-conflicts.md にまとめる（閉じる文と食い違う側の両方の逐語、invalid のものは外して数だけ）。直すかどうかはチャット側と本人が決める。何も直さない',
}
