export const meta = {
  name: 'coverage',
  description: '網羅台帳を自律的に埋める。1件ずつ独立に分解・判定し、証拠つきで台帳へ書く',
  phases: [
    { title: 'Decompose', detail: '上位の各単位が要求している事項を列挙する（下位は見ない）' },
    { title: 'Judge', detail: '要求1件ずつを下位と突き合わせ、証拠つきで判定する' },
  ],
}

// 使い方:
//   Workflow({ name: 'coverage', args: 'req->bd' })                              全件（既定）
//   Workflow({ name: 'coverage', args: { edge: 'bd->dd', limit: 30 } })          先頭 30 件だけ
//   Workflow({ name: 'coverage', args: { edge: 'bd->dd', file: '04_editing' } })  その章だけ
//   Workflow({ name: 'coverage', args: { edge: 'bd->dd', section: '4.1' } })     その節だけ
//   Workflow({ name: 'coverage', args: { edge: 'req->bd', model: 'opus' } })     判定モデルを上げる
//
//   絞り込み候補は  node .claude/scripts/ledger.mjs scope <edge>  で見られる。
//
// 受け渡しの原則:
//   **エージェント間で本文を運ばない。** 運ぶのは短い ID だけ。
//   各エージェントが自分で `ledger.mjs show` を叩いて中身を取り、
//   自分で `ledger.mjs decompose|judge` を叩いて書き戻す。
//   本文を復唱させると、量が増えたときに欠落・改変が起きて、
//   台帳という「分母を機械が固定する」仕組みの前提が崩れる。

// args は「edge 名の文字列」でも「設定オブジェクト」でも受ける。
// **JSON 文字列で渡ってくることもある**（Workflow ツールの呼び出し側が
// オブジェクトを stringify してくるケースが実際にあった）。
// 文字列として素通しすると edge 名が `{"edge":"req->bd",…}` になり、
// 最初の一覧取得で落ちたまま **「0 件 / complete」** で返る。
// 黙って空振りするより、読めるものは読む。
const cfg = (() => {
  if (args && typeof args === 'object') return args
  const t = String(args ?? '').trim()
  if (t.startsWith('{')) { try { const o = JSON.parse(t); if (o && typeof o === 'object') return o } catch { /* 下で edge 名として扱う */ } }
  return { edge: t }
})()
const EDGE = cfg.edge
const BATCH = cfg.batch || 20            // 1 ラウンドの並列数
const LIMIT = cfg.limit || null           // 総処理件数の上限（既定なし＝全件）
const MODEL = cfg.model || 'sonnet'       // 分解・判定のモデル
const SCOPE = [
  cfg.file ? `--file ${JSON.stringify(cfg.file)}` : '',
  cfg.section ? `--section ${JSON.stringify(cfg.section)}` : '',
].filter(Boolean).join(' ')

if (!EDGE) return { status: 'error', message: 'edge を指定してください（例: "req->bd"）' }

const L = 'node .claude/scripts/ledger.mjs'
// edge はシェルで必ず引用する。`req->bd` を裸で渡すと `>` がリダイレクトになり、
// `req-` という edge を探して失敗したうえ、リポジトリ直下に `bd` という空ファイルが生える。
// sim で初めて分かった——本物のエージェントは最初の一覧取得で必ずここに落ちていた。
const E = JSON.stringify(EDGE)

const DECOMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    unitId: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
    written: { type: 'boolean' },
    cliOutput: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['unitId', 'requirements', 'written', 'cliOutput'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    reqId: { type: 'string' },
    verdict: { type: 'string', enum: ['一致', '部分', '不一致', '陳腐化', '申し送り先が不在', '対応先が誤り', '対象外'] },
    detail: { type: 'string' },
    written: { type: 'boolean' },
    cliOutput: { type: 'string' },
  },
  required: ['reqId', 'verdict', 'detail', 'written', 'cliOutput'],
}

// ID の一覧だけを取る。本文は運ばない。
// count はウィンドウ幅。書き込みに失敗した ID を飛ばして先へ進むために広げることがある。
async function nextIds(round, label, count) {
  // 判定フェーズは --phase judge で取る。分解に失敗した単位が残っていても判定を始められるように。
  const ph = label === 'list-d' ? 'decompose' : 'judge'
  const out = await agent(
    `次のコマンドを実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n` +
    `\`${L} next ${E} ${count} --ids-only --phase ${ph} ${SCOPE}\``,
    { label: `${label}:${round}`, phase: label === 'list-d' ? 'Decompose' : 'Judge', model: 'haiku' }
  )
  if (!out) return null
  if (typeof out === 'object') return out
  const m = String(out).match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

// ── Decompose ─────────────────────────────────────────────────────────────
phase('Decompose')

let decomposed = 0, decomposeFailed = []
// 範囲が空振りしていたら報告に載せる。**0 件を「もう無い」と読ませない。**
let scopeWarning = null
// **一覧を一度も読めなかったら complete にしない。** 理由は approve.js と同じ。
let listedOk = false
let listFailure = null
// `budget` はワークフロー実行環境の予約語（トークン予算 API）。同名を宣言すると
// 「Identifier 'budget' has already been declared」で **スクリプトごと読めない**。
let quota = LIMIT || Infinity

// 書き込みに失敗した ID を覚えておく。
// `next` は「未分解の先頭 n 件」を返すので、失敗した ID は次のラウンドでも
// 先頭に居座る。除外しないと、1 件でも成功しているかぎり同じ失敗 ID を
// 毎ラウンド拾い直し、予算だけを消費し続ける。
const skipD = new Set()
let windowD = BATCH

for (let round = 0; round < 200 && quota > 0; round++) {
  const listing = await nextIds(round, 'list-d', windowD)
  if (listing?.phase === 'decompose') listedOk = true
  else if (round === 0) listFailure = '分解の一覧が読めませんでした'
  if (listing?.warning && !scopeWarning) { scopeWarning = listing.warning; log(listing.warning) }
  if (!listing || listing.phase !== 'decompose' || !listing.ids?.length) break

  const fresh = listing.ids.filter(id => !skipD.has(id))
  if (!fresh.length) {
    // 見えている範囲が全部失敗済み。まだ先がありそうならウィンドウを広げて飛ばす。
    if (listing.ids.length < windowD) { log(`未分解の残りはすべて書き込みに失敗済みです。打ち切ります。`); break }
    windowD *= 4
    if (windowD > 4000) { log(`失敗済みの ID を飛ばしきれませんでした。打ち切ります。`); break }
    continue
  }
  windowD = BATCH

  const ids = fresh.slice(0, Math.min(BATCH, quota))
  log(`分解 ${ids.length} 件（ラウンド ${round + 1}${LIMIT ? ` / 残り予算 ${quota}` : ''}${skipD.size ? ` / 失敗済み ${skipD.size} 件を除外` : ''}）`)
  quota -= ids.length

  const results = await parallel(ids.map(id => () => agent(
    `# 要求分解（1 件）\n\n` +
    `## 手順\n` +
    `1. \`${L} show ${E} ${JSON.stringify(id)}\` を実行して対象を取得する\n` +
    `2. **上位の原文だけを見て**、その単位が要求している事項を列挙する\n` +
    `3. \`${L} decompose ${E} ${JSON.stringify(id)} '<JSON 配列>'\` で書き戻す\n` +
    `   JSON 配列の要素は 2 種類。**要求ごとに、原文のどの部分から読み取ったかを逐語で添える。**\n` +
    `     {"text":"<要求>","from":"<原文の逐語の一部>"}\n` +
    `     {"skip":"<原文の逐語の一部>","why":"<なぜ要求でないか>"}  … 出典・履歴・接続など要求でない部分\n` +
    `4. 3 の標準出力／標準エラーを **そのまま** cliOutput に入れ、成功したかを written に入れる\n\n` +
    `## 絶対に守ること\n` +
    `- **下位のドキュメントを一切開かない。** 下位に対応があるかは今は考えない。\n` +
    `  下位を見ながら分解すると、下位に無いものが分解結果から漏れる（過去にこれで 25 件見落とした）\n` +
    `- 「A と B の両方」なら 2 件に分ける。「／」で 7 個並んでいるなら 7 件に分ける\n` +
    `- 各要求は、下位ドキュメントで「在る／無い」を判定できる粒度で書く\n` +
    `- **原文の同じ部分を 2 つの項目が指すことはできない。** 同じ内容を言い換えて件数を埋めると、\n` +
    `  区間の取り合いで拒否される。原文のうち割り当てられなかった部分は列挙して返るので、\n` +
    `  そこに要求が書かれていないか確かめ、書かれていないなら skip で理由をつけて外す\n` +
    `- **section（その行が属する章）を見て、そもそも要求が書かれる場所かを判断する。**\n` +
    `  変更履歴・リスク一覧・見積もりの章に、下位へ降ろす要求は無い\n` +
    `- **この行が何も要求していないときは、原文全体を 1 つの skip にする。** 件数の下限は免除され、\n` +
    `  「要求ゼロ」として記録される。**件数を満たすために架空の要求を書かない**——\n` +
    `  要求ゼロは正当な答えで記録が残るが、水増しは記録に残らない嘘になる\n` +
    `- 書き戻しが失敗したら written=false にして cliOutput にエラーをそのまま入れる。**成功したことにしない**`,
    { label: `dec:${String(id).slice(-10)}`, phase: 'Decompose', model: MODEL, schema: DECOMPOSE_SCHEMA }
  // 自己申告の unitId ではなく、こちらが配った id で突き合わせる
  // （返ってこなかった場合に「どれが失敗したか」が分からなくなるため）
  ).then(r => ({ ...(r || {}), _id: id }))))

  for (const r of results) {
    if (r?.written === true) decomposed++
    else {
      skipD.add(r._id)
      decomposeFailed.push({ id: r._id, why: r?.cliOutput?.slice(0, 300) || '結果を返さなかった', note: r?.note })
    }
  }
  if (results.every(r => r?.written !== true)) {
    log(`このラウンドで 1 件も書き込めませんでした。打ち切ります。`)
    break
  }
}

// ── 承認を要る段は、ここで止める ──────────────────────────────────────────
// 分解の**形**は ledger.mjs が見ているが、「そもそも要求か」は見ていない。
// requireApproval を立てた段は、承認を通す前に判定へ進まない。
// 承認で落ちる断片を先に判定してしまうと、その判定は捨てることになるうえ、
// **水増しされた分母の上に「判定済」という数字が積み上がる**——
// 数字が増えるほど直しにくくなる方向なので、ここで止める。
// 既定（requireApproval を書いていない段）は素通りするので、従来どおり動く。
const gate = await agent(
  `次を実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n\`${L} pending ${E} --json ${SCOPE}\``,
  { label: 'approval-gate', phase: 'Decompose', model: 'haiku' }
)
let gj = null
try { gj = typeof gate === 'object' ? gate : JSON.parse((String(gate).match(/\{[\s\S]*\}/) || ['null'])[0]) } catch { gj = null }
if (gj?.requireApproval && gj.approvalUnresolved > 0) {
  const a = gj.approval || {}
  return {
    status: 'partial',
    edge: EDGE,
    scope: SCOPE || '全件',
    decomposed,
    failed: { decompose: decomposeFailed.length, judge: 0 },
    failures: decomposeFailed.slice(0, 20),
    approval: a,
    challengedIds: (gj.challengedIds || []).slice(0, 40),
    next:
      `**この段は承認が要る設定（requireApproval）です。判定には進んでいません。**\n` +
      `未承認 ${a.unseen || 0}  指摘 ${a.challenged || 0}  保留 ${a.deferred || 0}（承認済 ${a.ok || 0} / ${a.entries || 0}）\n` +
      (a.unseen ? `  まだ見ていない分: Workflow({ name: 'approve', args: ${JSON.stringify(EDGE)} })\n` : '') +
      ((a.challenged || a.deferred) ? `  食い違った分は**消えていません。** 分解を直すか、反論を記録して決着させてください。\n` : '') +
      `決着したら coverage をもう一度回してください。分解済みの分は飛ばされ、判定から始まります。`,
  }
}

// ── Judge ─────────────────────────────────────────────────────────────────
phase('Judge')

let judged = 0, judgeFailed = [], problems = []
quota = LIMIT || Infinity

const skipJ = new Set()
let windowJ = BATCH

for (let round = 0; round < 400 && quota > 0; round++) {
  const listing = await nextIds(round, 'list-j', windowJ)
  if (listing?.phase === 'judge') listedOk = true
  if (!listing || listing.phase !== 'judge' || !listing.ids?.length) break

  const fresh = listing.ids.filter(id => !skipJ.has(id))
  if (!fresh.length) {
    if (listing.ids.length < windowJ) { log(`未判定の残りはすべて書き込みに失敗済みです。打ち切ります。`); break }
    windowJ *= 4
    if (windowJ > 4000) { log(`失敗済みの ID を飛ばしきれませんでした。打ち切ります。`); break }
    continue
  }
  windowJ = BATCH

  const ids = fresh.slice(0, Math.min(BATCH, quota))
  log(`判定 ${ids.length} 件（ラウンド ${round + 1}${LIMIT ? ` / 残り予算 ${quota}` : ''}${skipJ.size ? ` / 失敗済み ${skipJ.size} 件を除外` : ''}）`)
  quota -= ids.length

  const results = await parallel(ids.map(id => () => agent(
    `# 網羅判定（1 件）\n\n` +
    `## 手順\n` +
    `1. \`${L} show ${E} ${JSON.stringify(id)}\` を実行して対象を取得する\n` +
    `2. **下位のファイルを実際に開いて読む**。目次や「〜に反映済み」という記述を根拠にしない（それ自体が検証対象）\n` +
    `3. 意味で突き合わせる。下位が別の言葉で表現していても、意味が一致していれば「一致」\n` +
    `4. \`${L} judge ${E} ${JSON.stringify(id)} <判定> '<evidence JSON>'\` で書き戻す\n` +
    `5. 4 の標準出力／標準エラーを **そのまま** cliOutput に入れ、成功したかを written に入れる\n\n` +
    `## 判定\n` +
    `- 一致 … 要求されていることが下位に在る\n` +
    `- 部分 … 一部だけ降りている（**上位の何が下位のどこにも無いか**を detail に具体的に書く）\n` +
    `- 不一致 … 下位が違うことを決めている（両者を引用して対比する）\n` +
    `- 陳腐化 … 上位が後から変更されたのに下位が古いまま\n` +
    `- 申し送り先が不在 … 下位 A が「B で扱う」と書いているが B にその記述が無い\n` +
    `- 対応先が誤り … 対応表等が指す節にその内容が実際には無い\n` +
    `- 対象外 … 上位側が「不要」「スコープ外」「他 Phase 送り」と決めている（evidence.reason が必須）\n\n` +
    `## evidence\n` +
    `\`{"file":"…","line":123,"quote":"逐語","method":"…"}\`\n` +
    `- quote は **逐語**。要約・整形しない。\`judge\` は書き込む前に quote を実ファイルと照合し、` +
    `**一致しなければ書き込みを拒否する**（その場合 written=false。引用し直して再実行すること）\n` +
    `- 「無い」と判断するときは quote を持てないので、**無いことを確かめた方法**` +
    `（grep した語と結果件数）を method に書く。quote も method も無い判定は受け付けられない\n\n` +
    `## 迷ったとき\n` +
    `**「一致」に寄せない。** 曖昧なら「部分」にして、何が無いかを detail に書く。` +
    `この台帳の目的は漏れを見つけることで、通すことではない。\n` +
    `書き戻しが失敗したら written=false にして cliOutput にエラーをそのまま入れる。**成功したことにしない**`,
    { label: `jdg:${String(id).slice(-10)}`, phase: 'Judge', model: MODEL, schema: JUDGE_SCHEMA }
  ).then(r => ({ ...(r || {}), _id: id }))))

  for (const r of results) {
    if (r?.written === true) {
      judged++
      if (r.verdict !== '一致' && r.verdict !== '対象外') {
        problems.push({ reqId: r._id, verdict: r.verdict, detail: r.detail })
      }
    } else {
      skipJ.add(r._id)
      judgeFailed.push({ id: r._id, why: r?.cliOutput?.slice(0, 300) || '結果を返さなかった' })
    }
  }
  if (results.every(r => r?.written !== true)) {
    log(`このラウンドで 1 件も書き込めませんでした。打ち切ります。`)
    break
  }
}

// ── 最終状態は台帳から取る（自己申告を信じない）──────────────────────────
const finalStats = await agent(
  `次を実行し、**標準出力の JSON だけ**を返してください。解説を付けないこと。\n\`${L} stats --json\``,
  { label: 'final-stats', phase: 'Judge', model: 'haiku' }
)

return {
  status: !listedOk ? 'error' : (decomposeFailed.length || judgeFailed.length || scopeWarning) ? 'partial' : 'complete',
  listFailure: listedOk ? undefined : (listFailure || '一覧が返ってこなかった'),
  edge: EDGE,
  scope: SCOPE || '全件',
  scopeWarning,
  limit: LIMIT || 'なし',
  model: MODEL,
  decomposed, judged,
  failed: { decompose: decomposeFailed.length, judge: judgeFailed.length },
  failures: [...decomposeFailed.slice(0, 20), ...judgeFailed.slice(0, 20)],
  problemCount: problems.length,
  problems: problems.slice(0, 80),
  ledgerAfter: String(finalStats).slice(0, 3000),
  next:
    (!listedOk
      ? `**台帳の一覧を一度も取得できませんでした。1 件も見ていません。**\n` +
        `  edge の指定（${JSON.stringify(EDGE)}）が project.json の edges に在るか、\n` +
        `  台帳が作られているか（split.mjs --all → ledger.mjs sync）を確かめてください。\n` +
        `  args は「edge 名の文字列」か「オブジェクト」で渡します。**JSON 文字列を渡さないこと。**\n`
      : '') +
    (scopeWarning ? `${scopeWarning}\n` : '') +
    (decomposeFailed.length || judgeFailed.length)
      ? '**書き込みに失敗した件があります。** 上の failures を見て原因を潰してから再実行してください。件数は台帳（ledger stats）が正で、この報告の自己申告ではありません。'
      : problems.length
        ? '「一致」「対象外」以外は 1 件ずつ G 番号で起票してください（/gap）。まとめて直さない。是正は上位に近い文書から順に。'
        : 'この範囲に未判定はありません。node .claude/scripts/ledger.mjs stats で確認してください。',
}
