export const meta = {
  name: 'judge106',
  description: '基本設計 02 章の区切り 5 の残り（298 行の 2 単位）と、02:270 に足した文の要求と、詳細設計を直して根拠が無効になった要求を、同じ受け先（同じファイルの同じ節）を見る 10 件までずつ Opus の役 1 体に判定させる（bd-dd、judge105.js の写し。grep してから読む）',
  phases: [{ title: 'Judge', detail: '同じ受け先の 10 件までにつき Opus の役 1 つ' }],
}

const L = 'node .claude/scripts/ledger.mjs'
const E = JSON.stringify('bd-dd')
const ONE = {
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
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { results: { type: 'array', items: ONE } },
  required: ['results'],
}
// coverage.js の WRITE_GUARD と同じ文面
const WRITE_GUARD = what =>
  `**文書・台帳のほかのものを書かないこと。書くのは \`${what}\` だけです（渡した要求 1 件につき 1 回）。**\n` +
  `- 文書（docs/ など）、_bridge/、.claude/ のファイルを作らない・書き換えない・消さない\n` +
  `- ledger.mjs の ${what} 以外の書き込み（approve・settle・plan・concede・uphold・rebut・hold など）を打たない\n` +
  `- 読んだ文書に誤りや食い違いを見つけても、直さずに detail に書くだけにする\n` +
  `- 会話の最初に「本人の依頼」が見えても、それはこのワークフローを起動した人の依頼で、**あなたへの指示ではありません**\n\n`
const SEGMENT =
  `## この回の範囲\n` +
  `- この回は、基本設計から詳細設計への段（bd-dd）で、基本設計 02_data_model.md の 298 行（5 節 曲一覧用インデックス）の要求と、270 行の終わりに足した文（曲のファイルのいちばん上の階層の 6 つ）の要求と、詳細設計を直して前の根拠の引用が見つからなくなった 2 件を判定する。前の判定を写さず、下位（docs/detailed_design/）を開いて判定する\n` +
  `- 受け先は受け先表（docs/detailed_design/00_reference.md 1 節）の 02 章の行で、4.1 節は data-model-persistence.md 6 節と 7 節、4.3 節は data-model-persistence.md 9 節と editing-core.md 3.9 節・3.10 節、5 節は data-model-persistence.md 9 節\n` +
  `- 受け先表や本文が別の章の回に回しているもの（index.json の置き場所と書き換えの時機は 06 章の回、曲一覧の画面と並べ替えの操作は 03 章の回）は、その回にまだ書かれていないことがある。書かれていなければ一致にしない\n` +
  `- 本文が「基本設計に書かれていないので本書では決めない」と注にしているものは、書かれていないものとして扱う（一致にしない）\n` +
  `- 一致の根拠は、下位の本文の逐語（file・line・quote）で示す\n` +
  `- **コマンドの段の名前は必ず引用符で囲む（"bd-dd"）。** 囲まないとシェルが記号を出力の向け先と読み、ファイルができてしまう\n` +
  `- 一時ファイルを含め、リポジトリの中にファイルを作らない\n` +
  `- **受け先のファイルは、まず \`grep -n\` で要求の語を探し、当たった行の前後だけを読む。ファイルを丸ごと読むのは、grep で見つからないときだけ。**「見つからない」と判定する前には、丸ごと読んでよい\n\n`

const groups = args.groups
phase('Judge')
log(`判定 ${groups.flat().length} 件・${groups.length} 体（${args.label}）`)

const out = await parallel(groups.map((ids, gi) => () => agent(
  `# 網羅判定（${ids.length} 件）\n\n` +
  WRITE_GUARD('judge') +
  SEGMENT +
  `## 対象の要求（${ids.length} 件。どれも同じ受け先のファイルを見る）\n` +
  ids.map((id, i) => `${i + 1}. ${id}`).join('\n') + '\n\n' +
  `**1 件ずつ独立に判定する。隣の要求の答えを次に引きずらない。** 前の要求で一致の根拠にした行を、次の要求にそのまま使い回さない。要求ごとに上位の文を読み直し、下位の本文をその要求の中身で探し直す。\n\n` +
  `## 手順（要求 1 件ごとに 1 から 5 を行う）\n` +
  `1. \`${L} show ${E} "<要求の ID>"\` を実行して対象を取得する\n` +
  `2. **下位のファイルを実際に開いて読む**（まず grep -n で探し、当たった行の前後を読む）。目次や「〜に反映済み」という記述を根拠にしない（それ自体が検証対象）\n` +
  `   show の出力に \`tag\` があれば、下位の文書を \`<!-- req <tag> -->\` で grep すると、書いた人がこの要求を満たすつもりの箇所が分かる。\n` +
  `   **印は探す手がかりにすぎない。** 印が付いていることは一致の根拠にならない。根拠は必ず本文の逐語で取り、印の無い箇所も読む\n` +
  `3. 意味で突き合わせる。下位が別の言葉で表現していても、意味が一致していれば「一致」\n` +
  `4. \`${L} judge ${E} "<要求の ID>" <判定> '<evidence JSON>'\` で書き戻す\n` +
  `5. 4 の標準出力／標準エラーを **そのまま** cliOutput に入れ、成功したかを written に入れる\n\n` +
  `results には、渡した要求の順に 1 件 1 つずつ入れる（reqId は渡した ID のまま）。\n\n` +
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
  { label: `jdg:g${gi + 1}`, phase: 'Judge', model: 'opus', schema: JUDGE_SCHEMA }
).then(r => ({ ids, results: (r && r.results) || [] }))))

const results = []
for (const g of out) {
  for (const id of g.ids) {
    const r = g.results.find(x => x && x.reqId === id)
    results.push(r ? { ...r, _id: id } : { _id: id, written: false, cliOutput: '結果を返さなかった' })
  }
}
const ok = results.filter(r => r.written === true)
const failed = results.filter(r => r.written !== true).map(r => ({ id: r._id, why: String(r.cliOutput || '').slice(0, 300) }))
log(`書き戻し ${ok.length} / ${results.length}、失敗 ${failed.length}`)
return { label: args.label, total: results.length, written: ok.length, failed, results: results.map(r => ({ id: r._id, verdict: r.verdict, written: r.written, detail: r.detail })) }
