export const meta = {
  name: 'approve',
  description: '分解された断片1つずつを別の目に通し、「これは要求か」を証拠つきで答えさせる',
  phases: [
    { title: 'Approve', detail: '断片ごとに 要求 / 要求でない / 判断できない を答える（ファイルは一切開かない）' },
    { title: 'Report',  detail: '食い違いを一覧にする。**消さない。**' },
  ],
}

// 使い方:
//   Workflow({ name: 'approve', args: 'req->bd' })                                全件
//   Workflow({ name: 'approve', args: { edge: 'req->bd', limit: 100 } })          先頭 100 断片だけ
//   Workflow({ name: 'approve', args: { edge: 'req->bd', file: '04_editing' } })  その章だけ
//   Workflow({ name: 'approve', args: { edge: 'req->bd', perAgent: 5 } })         1 エージェントに 5 断片
//
// なぜこれが要るか:
//   分解の**形**（from が逐語か・区間が重なっていないか・取り残しが無いか）は
//   ledger.mjs が全部見ている。見ていないのは「紐付けは正しいが、そもそも要求ではない」もの。
//     `（PC版）` → 「（PC版）を対象とした利用シーンである」
//   これは形として満点で、中身だけが間違っている。意味を読まないと判定できない。
//
// なぜ Claude を足すことが循環にならないか:
//   分解した側が水増しするのは**下限があるから**である（説明すべき断片が 5 つあるなら
//   5 件書かないと通らない）。承認する側に下限は無い。1 件について 1 つ答えるだけで、
//   何件通そうが何件落とそうが仕事は終わる。**掛かっている圧力が違うので、間違え方が違う。**
//   重ならない誤りを二重に通すことだけが根拠であり、
//   **承認する側に件数の目標を与えた時点でこの根拠は消える。**
//
// ── なぜ取得と書き戻しを親がやるのか（2026-09-15 に作り直した理由）──────
//   承認する側は「下位の文書に書かれていなければ不備といえるか」を**上位だけを見て**
//   答える。下位を開くと「下位に書いてあるから要求だ」という逆立ちした判断になり、
//   **下位に無いものだけが「要求でない」に落ちる**——漏れを漏れでなくする。
//
//   初版は承認する側に自分で `approve-show` / `approve` を叩かせていた。
//   そのためには Bash が要り、Bash があればどのファイルでも開ける。
//   逆にファイルを開けるツールを外すと、今度は書き戻せない
//   （実機で 20 件すべてが「No such tool available: Bash」で落ちた）。
//
//   なので**役を分けた**。承認する側はファイルを触るツールを持たず、
//   渡された断片だけを見て JSON で答える。台帳の読み書きは親（このスクリプト）が
//   別のエージェントにやらせる。**承認する側は、開きたくても開けない。**

const cfg = (() => {
  if (args && typeof args === 'object') return args
  const t = String(args ?? '').trim()
  // args が JSON 文字列で渡ってくることがある。素通しすると edge 名が
  // `{"edge":"req->bd",…}` になり、最初の取得で落ちたまま「0 件」で返る。
  if (t.startsWith('{')) { try { const o = JSON.parse(t); if (o && typeof o === 'object') return o } catch { /* edge 名として扱う */ } }
  return { edge: t }
})()

const EDGE = cfg.edge
const BATCH = cfg.batch || 20             // 1 ラウンドの並列数
const LIMIT = cfg.limit || null            // 総処理件数の上限（既定なし＝全件）
const MODEL = cfg.model || 'sonnet'
// 1 エージェントが受け持つ断片の数。既定 1。
// **同じ単位から切り出された断片を同じ呼び出しに混ぜない**（下でそう組む）。
// 隣の断片をどう答えたかが次に効くと、1 件ずつ独立に見るという前提が崩れる。
const PER_AGENT = Math.max(1, Math.min(10, cfg.perAgent || 1))
const SCOPE = [
  cfg.file ? `--file ${JSON.stringify(cfg.file)}` : '',
  cfg.section ? `--section ${JSON.stringify(cfg.section)}` : '',
].filter(Boolean).join(' ')

if (!EDGE) return { status: 'error', message: 'edge を指定してください（例: "req->bd"）' }

const L = 'node .claude/scripts/ledger.mjs'
// edge はシェルで必ず引用する。裸の `>` はリダイレクトになる。
const E = JSON.stringify(EDGE)

const APPROVE_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entryId: { type: 'string' },
          verdict: { type: 'string', enum: ['要求', '要求でない', '判断できない'] },
          why: { type: 'string' },
          expect: { type: 'string' },
          kind: { type: 'string' },
          resolvesBy: { type: 'string' },
        },
        required: ['entryId', 'verdict', 'why'],
      },
    },
  },
  required: ['verdicts'],
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: { outputs: { type: 'array', items: { type: 'string' } } },
  required: ['outputs'],
}

function parseJson(x) {
  if (!x) return null
  if (typeof x === 'object') return x
  const m = String(x).match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

// 未承認の断片を**中身つきで**取る。承認する側はここで取れたものしか見られない。
// 生の出力も返す——読めなかったときに「何が返ってきたのか」を報告に載せるため。
async function fetchEntries(round, count) {
  const out = await agent(
    `次のコマンドを実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n` +
    `\`${L} approve-next ${E} ${count} ${SCOPE}\``,
    { label: `fetch:${round}`, phase: 'Approve', model: 'haiku' }
  )
  return { parsed: parseJson(out), raw: out }
}

// 同じ単位の断片を同じ呼び出しに入れない組み方。
// entryId は "<unitId>#<番号>" なので、最後の # より前が単位。
function unitOf(id) { return String(id).slice(0, String(id).lastIndexOf('#')) }
function groupEntries(entries, per) {
  if (per <= 1) return entries.map(x => [x])
  const byUnit = new Map()
  for (const e of entries) {
    const u = unitOf(e.entryId)
    if (!byUnit.has(u)) byUnit.set(u, [])
    byUnit.get(u).push(e)
  }
  const queues = [...byUnit.values()]
  const groups = []
  let cur = [], seen = new Set(), remaining = entries.length
  while (remaining > 0) {
    let placed = false
    for (const q of queues) {
      if (!q.length) continue
      const u = unitOf(q[0].entryId)
      if (seen.has(u)) continue
      cur.push(q.shift()); seen.add(u); remaining--; placed = true
      if (cur.length >= per) { groups.push(cur); cur = []; seen = new Set() }
    }
    if (!placed) { if (cur.length) { groups.push(cur); cur = []; seen = new Set() } else break }
  }
  if (cur.length) groups.push(cur)
  return groups
}

// シェルに渡す JSON。**単引用符と改行だけ落とす。**
// `'\''` 方式の入れ子引用はエージェントが写し間違えやすく、写し間違えると
// 何が起きたか分からなくなる。日本語の理由文で `'` が要る場面はほぼ無いので、
// 全角に寄せて**コマンドが必ず 1 行で閉じる**ほうを取る。
function shellJson(obj) {
  const clean = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    clean[k] = String(v).replace(/[\r\n]+/g, ' ').replace(/'/g, '’')
  }
  return `'${JSON.stringify(clean)}'`
}

// ── Approve ───────────────────────────────────────────────────────────────
phase('Approve')

// **一覧を一度も読めなかったら complete にしない。**
// 読めない理由（edge 名が壊れている・台帳が無い）で 0 件になったのか、
// 本当に承認済みで 0 件なのかは、件数だけでは区別できない。
// 区別しないと「承認 0 件 / complete」＝**何も見ていないことが完了に見える。**
let listedOk = false
let listFailure = null
let scopeWarning = null

const attempted = new Set()   // 1 度でも書き戻しを試した断片
const failedIds = new Set()   // 試したのに未承認のまま残った断片
const failures = []
const deferred = []
let quota = LIMIT || Infinity
let windowN = BATCH * PER_AGENT

for (let round = 0; round < 400 && quota > 0; round++) {
  const { parsed: listing, raw } = await fetchEntries(round, windowN)
  if (listing?.phase === 'approve') listedOk = true
  else if (round === 0) listFailure = String(raw ?? '').slice(0, 600)
  if (listing?.warning && !scopeWarning) { scopeWarning = listing.warning; log(listing.warning) }
  if (!listing || listing.phase !== 'approve' || !listing.entries?.length) break

  // **書き戻せたかどうかは台帳に訊く。** 自己申告を数えない。
  // 前のラウンドで試したのにまだ一覧に残っている＝書き戻しに失敗している。
  for (const e of listing.entries) {
    if (attempted.has(e.entryId) && !failedIds.has(e.entryId)) {
      failedIds.add(e.entryId)
      failures.push({ entryId: e.entryId, why: '書き戻し後も未承認のまま台帳に残っている' })
    }
  }

  const fresh = listing.entries.filter(e => !failedIds.has(e.entryId))
  if (!fresh.length) {
    if (listing.entries.length < windowN) { log('未承認の残りはすべて書き戻しに失敗済みです。打ち切ります。'); break }
    windowN *= 4
    if (windowN > 4000) { log('失敗済みの断片を飛ばしきれませんでした。打ち切ります。'); break }
    continue
  }
  windowN = BATCH * PER_AGENT

  const take = fresh.slice(0, Math.min(BATCH * PER_AGENT, quota))
  const groups = groupEntries(take, PER_AGENT).slice(0, BATCH)
  const planned = groups.flat()
  quota -= planned.length
  log(`承認 ${planned.length} 断片 / ${groups.length} 呼び出し（ラウンド ${round + 1}${LIMIT ? ` / 残り予算 ${quota}` : ''}${failedIds.size ? ` / 失敗済み ${failedIds.size} 件を除外` : ''}）`)

  const KINDS = (listing.nonReqKinds || []).join(' / ')
  const results = await parallel(groups.map(g => () => agent(
    `# 承認（${g.length} 断片）\n\n` +
    `下の断片それぞれについて、**これだけ**を答えてください。\n\n` +
    `> **この断片は、下位の文書に書かれていなければ不備といえるか。**\n\n` +
    `## 答えは 3 つしかありません\n` +
    `- **要求** … いえる。このとき \`expect\`（その要求が満たされたとき**下位の文書に現れるはずの一文**）が必須。\n` +
    `  **書けないなら要求ではありません。** 「重要な観点である」は expect ではない。設計書にそのまま載る形の一文を書く\n` +
    `- **要求でない** … いえない。\`kind\` でどれかを名指しする: ${KINDS}\n` +
    `- **判断できない** … 断片が曖昧。\`resolvesBy\` に何を確かめれば決着するかを書く\n\n` +
    `## 守ること\n` +
    `- **下の情報だけで判断してください。ファイルは開きません**（開くためのツールも渡していません）。\n` +
    `  あなたが答えるのは「下位に無ければ不備か」であって「下位に書いてあるか」ではありません。\n` +
    `  下位を見ると、下位に書いてあるものが要求に見え、**下位に無いものだけが「要求でない」に落ちます**——\n` +
    `  つまり**漏れているものを「もともと要求ではなかった」ことにしてしまう**\n` +
    `- **分解した側の扱い（\`wrote\`）に合わせない。** 食い違っても、その断片が台帳から消えることはありません\n` +
    `- **落とすこと自体を目的にしない。** 件数の目標はありません。` +
    `あなたに下限が無いことが、この役が分解した側と違う間違え方をする唯一の理由です\n` +
    `- **1 件ずつ独立に。** 隣の断片をどう答えたかを次に引きずらない\n` +
    `- \`why\` は 15 文字以上で、**原文（\`source\`）の語に触れて**書く。どの断片にも貼れる文は理由になりません\n` +
    `- \`entryId\` は渡されたものをそのまま返す\n\n` +
    `## 断片\n\`\`\`json\n${JSON.stringify(g, null, 2)}\n\`\`\``,
    { label: `apr:${String(g[0].entryId).slice(-10)}${g.length > 1 ? `+${g.length - 1}` : ''}`,
      phase: 'Approve', model: MODEL, schema: APPROVE_SCHEMA, agentType: 'approver' }
  ).then(r => ({ r, g }))))

  // ── 書き戻し（親がやる）──────────────────────────────────────────────
  const cmds = []
  for (const { r, g } of results) {
    const got = new Map((r?.verdicts || []).map(v => [v.entryId, v]))
    for (const e of g) {
      const v = got.get(e.entryId)
      if (!v?.verdict) {
        failedIds.add(e.entryId)
        failures.push({ entryId: e.entryId, why: '承認する側が判定を返さなかった' })
        continue
      }
      attempted.add(e.entryId)
      if (v.verdict === '判断できない') deferred.push({ entryId: e.entryId, resolvesBy: v.resolvesBy, why: v.why })
      const body = v.verdict === '要求' ? { why: v.why, expect: v.expect }
        : v.verdict === '要求でない' ? { why: v.why, kind: v.kind }
        : { why: v.why, resolvesBy: v.resolvesBy }
      cmds.push(`${L} approve ${E} ${JSON.stringify(e.entryId)} ${v.verdict} ${shellJson(body)}`)
    }
  }
  if (!cmds.length) { log('このラウンドは判定が 1 件も返りませんでした。打ち切ります。'); break }

  await agent(
    `次のコマンドを**上から順にすべて**実行し、それぞれの標準出力と標準エラーを\n` +
    `outputs に**そのまま**入れて返してください。コマンドを書き換えないこと。失敗しても止めず、次へ進んでください。\n\n` +
    cmds.map(c => '`' + c + '`').join('\n'),
    { label: `write:${round}`, phase: 'Approve', model: 'haiku', schema: WRITE_SCHEMA }
  )
  // **戻り値は見ない。** 書けたかどうかは次のラウンドの一覧が答える
  // （まだ未承認として出てくるなら書けていない）。自己申告を数えない。
}

// 最後にもう一度、試したのに未承認のまま残っているものを拾う。
{
  const { parsed: last } = await fetchEntries('final', 4000)
  for (const e of (last?.entries || [])) {
    if (attempted.has(e.entryId) && !failedIds.has(e.entryId)) {
      failedIds.add(e.entryId)
      failures.push({ entryId: e.entryId, why: '書き戻し後も未承認のまま台帳に残っている' })
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
phase('Report')

// 件数は**台帳から取る。** 自己申告を信じない。
const rep = parseJson(await agent(
  `次を実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n` +
  `\`${L} approval-report ${E} --json ${SCOPE}\``,
  { label: 'report', phase: 'Report', model: 'haiku' }
))
const pj = parseJson(await agent(
  `次を実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n` +
  `\`${L} pending ${E} --json ${SCOPE}\``,
  { label: 'pending', phase: 'Report', model: 'haiku' }
))

const c = rep?.counts || null

return {
  // 空振りも、一覧が読めなかったのも complete にしない。**0 件を「もう無い」と読ませない。**
  status: !listedOk ? 'error' : (failures.length || scopeWarning) ? 'partial' : 'complete',
  listFailure: listedOk ? undefined : (listFailure || '一覧が返ってこなかった'),
  edge: EDGE,
  scope: SCOPE || '全件',
  scopeWarning,
  perAgent: PER_AGENT,
  model: MODEL,
  // 試した件数と、実際に台帳に入った件数は別物。**別々に出す。**
  attempted: attempted.size,
  failed: failures.length,
  failures: failures.slice(0, 20),
  ledger: c,
  challengedIds: (pj?.challengedIds || []).slice(0, 40),
  deferredSample: deferred.slice(0, 20),
  // **覗きの疑い。** expect が下位の文書と逐語一致した件数。
  expectVerbatimBelow: rep?.expectVerbatimBelow ?? null,
  endingVsVerdict: rep?.endingVsVerdict || null,
  nonReqKinds: rep?.nonReqKinds || null,
  next:
    (!listedOk
      ? `**承認の一覧を一度も取得できませんでした。1 件も見ていません。**\n` +
        `  edge の指定（${JSON.stringify(EDGE)}）が project.json の edges に在るか、\n` +
        `  台帳が作られているか（split.mjs --all → ledger.mjs sync）を確かめてください。\n` +
        `  返ってきたもの: ${JSON.stringify(listFailure || '')}\n`
      : '') +
    (scopeWarning ? `${scopeWarning}\n` : '') +
    (failures.length
      ? `**書き戻せなかった断片が ${failures.length} 件あります。** failures を見て原因を潰してから再実行してください。\n` +
        `  （台帳にまだ未承認として残っているものだけを失敗と数えています。自己申告ではありません。）\n`
      : '') +
    (c?.challenged || c?.deferred
      ? `食い違い ${(c.challenged || 0) + (c.deferred || 0)} 件。**この断片は消えていません。** ` +
        `分解を直す（decompose し直す）か、反論を記録する（rebut）かで決着させてください。` +
        `指摘に従って直した分は承認を引き継ぐので、直すほうが安く済みます。\n`
      : '') +
    (rep?.expectVerbatimBelow
      ? `**expect が下位の文書と逐語一致したものが ${rep.expectVerbatimBelow} 件あります。** ` +
        `承認する側にファイルを開くツールは渡していないので、偶然の一致か、原文がそのまま通る書き方かのどちらかです。\n`
      : '') +
    `語尾の型ごとの当たり方は endingVsVerdict にあります。` +
    `**語尾は承認する側に見せていません**ので、ここでの差は「語尾で先に絞り込めるか」の検証になります。` +
    `差が出ないなら語尾は使えません——その場合は全件に回し続けてください。`,
}
