export const meta = {
  name: 'audit',
  description: '横断監査。独立3観点を並列で走らせ、各指摘を批評者が証拠つきで検証してから統合する',
  phases: [
    { title: 'Machine', detail: '機械で取れるものを先に取り、後続に添付する' },
    { title: 'Review',  detail: '独立3観点を並列で走らせる（互いの出力を見ない）' },
    { title: 'Critic',  detail: '各指摘に AGREE / DISAGREE_EVIDENCE / DISAGREE_CONCERN を返す' },
    { title: 'Verify',  detail: '引用を実ファイルと照合し、一致しない指摘を無効化する' },
  ],
}

// 使い方: Workflow({ name: 'audit', args: 'design' })  /  Workflow({ name: 'audit', args: 'impl' })
//
// なぜ批評者を挟むか:
//   独立レビュアーを 2 体に増やしても検出率は変わらない（実測 77% → 77%）。
//   効くのは構造化された反論だけ（同条件で 87%）。ただし構造の無い敵対レビューは
//   単独レビュアーより悪化する（F1 0.495 → 0.457）ので、判定を 3 択に固定し、
//   反論には必ずコード引用を要求する。

const MODE = (typeof args === 'string' ? args : args?.mode) || 'design'

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    checked: { type: 'array', items: { type: 'string' } },
    notVerified: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['Blocking', 'Major', 'Minor'] },
          summary: { type: 'string' },
          why: { type: 'string' },
          evidence: {
            type: 'object',
            // 「無い」型の指摘は逐語を持てない。quote か method のどちらかを必須にする（プロンプトで指示）
            properties: { file: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' }, method: { type: 'string' } },
            required: ['file'],
          },
          suggestedFix: { type: 'string' },
        },
        required: ['id', 'severity', 'summary', 'why', 'evidence'],
      },
    },
  },
  required: ['perspective', 'checked', 'notVerified', 'findings'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          verdict: { type: 'string', enum: ['AGREE', 'DISAGREE_EVIDENCE', 'DISAGREE_CONCERN'] },
          evidence: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' } } },
          reasoning: { type: 'string' },
          resolvesBy: { type: 'string' },
        },
        required: ['findingId', 'verdict', 'reasoning'],
      },
    },
    missedByReview: { type: 'array', items: { type: 'object' } },
  },
  required: ['verdicts'],
}

const PERSPECTIVES = MODE === 'impl' ? [
  { key: 'as-built', title: '設計との一致',
    prompt: `詳細設計書と 00_reference.md §3 が定めたクラス構成・メソッドシグネチャに対し、実コードが一致しているかを照合してください。
名前が一致していても、引数・返り値・例外時の挙動が設計と違えば不一致です。
実コードにあって設計に無いもの（逆方向）も列挙してください。` },
  { key: 'wiring', title: '結線と完成度',
    prompt: `設計が「UI から呼ぶ」と定めたサービス・メソッドを 1 件ずつ取り、実コードに呼び出し箇所があるかを確認してください。
列挙の源は設計側の接続先表です。コードを眺めて探さないこと。
ダミーハンドラ・未結線を「シェル段階だから」を理由に Minor に下げないでください。重大度は「製品として出せるか」だけで決めます。` },
  { key: 'test', title: 'テストの実質',
    prompt: `テストが振る舞いを検証しているかを確認してください。
特に、モックに設定した戻り値をそのまま assert しているだけのテスト、assertion が実質的に効いていないテストを探してください。
設計項目に対して、それを検証するテストが存在しないものも列挙してください（V字の横方向）。` },
] : [
  { key: 'trace', title: 'トレーサビリティ',
    prompt: `要件 → 基本設計 → 詳細設計 → 00_reference.md §3 §5 の連鎖に、欠落・二重定義・未反映が無いかを確認してください。
特に「上位が A と B の両方を要求しているのに、下位に A しか無い」型を探してください。過去に 6 回繰り返しています。` },
  { key: 'quote', title: '引用の一致',
    prompt: `ある詳細設計が別の詳細設計のクラス／メソッド名を引用している箇所を洗い出し、原典の現行シグネチャと一致するかを確認してください。
00_reference.md §3 は古い可能性があるので、疑わしいときは原典を開いてください。` },
  { key: 'handoff', title: '申し送りの履行',
    prompt: `「別パッケージへ」「Phase 2 へ」「実装フェーズへ」と書かれた申し送りを洗い出し、受け側に実体があるかを確認してください。
「〜は◯章で扱う」と書いてあるのに ◯章にその語が 1 件も無い、という型です。
00_reference.md §8.1 の未解消ギャップそれぞれの現況も確認してください。` },
]

// ── Machine ───────────────────────────────────────────────────────────────
phase('Machine')

const machine = await agent(
  `次のコマンドをすべて実行し、それぞれの標準出力を丸ごと返してください。分析や要約はしないこと。\n` +
  (MODE === 'impl'
    ? `\`node .claude/scripts/check-stubs.mjs\`\n\`node .claude/scripts/check-tests.mjs\`\n\`node .claude/scripts/verify.mjs\`\n\`node .claude/scripts/ledger.mjs stats\``
    : `\`node .claude/scripts/check-docs-links.mjs\`\n\`node .claude/scripts/ledger.mjs stats\``),
  { label: 'machine', phase: 'Machine', model: 'haiku' }
)

// 切り詰めは黙ってやらない（切れた分は誰にも見えない）
const MACHINE_CAP = 6000
const machineText = String(machine ?? '').slice(0, MACHINE_CAP)
if (String(machine ?? '').length > MACHINE_CAP) log(`機械チェックの出力 ${String(machine).length} 字を ${MACHINE_CAP} 字に切り詰めて添付します。`)
log('機械チェック完了。以降の観点に添付します。')

// ── Review → Critic をパイプラインで ──────────────────────────────────────
// agentType で agents/review.md・critic.md を使う。指定しないと既定のワークフロー用
// サブエージェントになり、両者の tools（Edit/Write を持たない）が効かない。
// commands/audit.md が「review エージェントを 3 体起動する」と書いているのはこの指定のこと。
const results = await pipeline(
  PERSPECTIVES,
  p => {
    phase('Review')
    return agent(
      `# 横断監査 / 観点「${p.title}」\n\n` +
      `対象は特定パッケージではなく**全体**です。**検出だけ**を行い、ファイルは変更しないでください。\n\n` +
      `${p.prompt}\n\n` +
      `## すでに機械で取れている結果（再確認に時間を使わないこと）\n\`\`\`\n${machineText}\n\`\`\`\n\n` +
      `## 守ること\n` +
      `- すべての指摘に evidence（file / line / quote）を付ける。**quote は逐語。要約しない。**\n` +
      `  引用は後で実ファイルと機械照合され、一致しない指摘は無効になります。\n` +
      `- 「〜が無い」と書くときは quote を持てないので、無いことを確かめた方法（grep した語と結果件数）を evidence.method に書く。` +
      `quote も method も無い指摘は無効になります\n` +
      `- 重大度は「製品として出せるか」だけで決める。完成度を理由に下げない\n` +
      `- **確認できなかったことは notVerified に書く。** 全部確認したことにしない\n` +
      `- 他の観点の結果は見えません。あなたの観点だけを深く見てください\n\n` +
      `id は "${p.key}-1" のような形式で連番にしてください。`,
      { label: `review:${p.key}`, phase: 'Review', model: 'opus', schema: FINDINGS_SCHEMA, agentType: 'review' }
    )
  },
  review => {
    phase('Critic')
    if (!review?.findings?.length) return Promise.resolve({ review, critic: null })
    return agent(
      `# 批評\n\n` +
      `下のレビュー指摘を 1 件ずつ検証してください。**必ず実ファイルを自分で開いて**判断すること。\n` +
      `レビュアーの証拠をそのまま繰り返さないでください。\n\n` +
      `## 3 つの判定しか返せません\n` +
      `- **AGREE** … 妥当。**あなた自身が確認した証拠**を示す\n` +
      `- **DISAGREE_EVIDENCE** … 誤り。**矛盾する具体的なコード・記述を引用する**（引用の無い DISAGREE_EVIDENCE は無効）\n` +
      `- **DISAGREE_CONCERN** … 前提に疑問はあるが断定する証拠が無い。**何を確かめれば決着するか**を resolvesBy に書く\n\n` +
      `## 最も避けるべき 2 つ\n` +
      `1. **過剰分解** — 曖昧な懸念を無批判に追認して薄い指摘を量産すること。証拠を確認できない指摘には DISAGREE_CONCERN を返す\n` +
      `2. **降伏** — 引用したコードが実在する限り、あなたの判定は変わりません。取り下げてよいのは、` +
      `別の実ファイルの引用によってあなたの引用が古い／誤読であることが示された場合だけ\n\n` +
      `この 2 つが、構造の無い敵対レビューが単独レビュアーより悪化する原因です。\n\n` +
      // JSON を途中で切ると壊れた JSON が渡り、切れた分の指摘は検証されないまま生き残る。切らない。
      `## レビュー指摘\n\`\`\`json\n${JSON.stringify(review.findings, null, 2)}\n\`\`\`\n\n` +
      `読む過程で気づいた「レビューが挙げていない問題」があれば missedByReview に入れてください（証拠必須）。`,
      { label: `critic:${review.perspective}`, phase: 'Critic', model: 'opus', schema: CRITIC_SCHEMA, agentType: 'critic' }
    ).then(critic => ({ review, critic }))
  }
)

// ── Verify ────────────────────────────────────────────────────────────────
phase('Verify')

const merged = []
const failedPerspectives = []   // review が返ってこなかった観点（黙って消さない）
const criticMissing = []        // 指摘があるのに critic が返ってこなかった観点
results.flat().forEach((r, i) => {
  if (!r?.review?.findings) { failedPerspectives.push(PERSPECTIVES[i]?.key || `#${i}`); return }
  if (r.review.findings.length && !r.critic) criticMissing.push(r.review.perspective)
  const verdicts = new Map((r.critic?.verdicts || []).map(v => [v.findingId, v]))
  for (const f of r.review.findings) {
    const v = verdicts.get(f.id)
    merged.push({ ...f, perspective: r.review.perspective, criticVerdict: v?.verdict || 'NOT_REVIEWED', criticReasoning: v?.reasoning, resolvesBy: v?.resolvesBy })
  }
  for (const m of (r.critic?.missedByReview || [])) {
    merged.push({ id: `missed-${merged.length}`, severity: 'Major', summary: m.summary, why: '批評者が独自に検出', evidence: m.evidence, perspective: r.review.perspective, criticVerdict: 'AGREE' })
  }
})

// 引用の機械照合。以前は結果を報告に添えるだけで、生存判定に一切使っていなかった
// （「一致しない指摘は無効化する」と宣言しながら、無効化していなかった。F31 と同型）。
// JSON は切り詰めない——切れた JSON は実行できず、切れた分は照合されないまま生き残る。
const evidenceCheck = await agent(
  `次の JSON を一時ファイルに書き、\`node .claude/scripts/verify-evidence.mjs <そのファイル> --json\` を実行して、` +
  `**標準出力の JSON だけ**を返してください。解説を付けないこと。一時ファイルはリポジトリ外（OS の一時ディレクトリ）に作ること。\n\n` +
  `\`\`\`json\n${JSON.stringify({ findings: merged }, null, 2)}\n\`\`\``,
  { label: 'verify-evidence', phase: 'Verify', model: 'haiku' }
)
let evidenceResults = null
try {
  evidenceResults = typeof evidenceCheck === 'object' ? evidenceCheck
    : JSON.parse((String(evidenceCheck).match(/\{[\s\S]*\}/) || ['null'])[0])
} catch { evidenceResults = null }
if (!evidenceResults?.results) log('verify-evidence の結果を JSON として読めませんでした。照合なしで報告します（status は partial）。')

// verify-evidence は `$.findings[i].evidence` の形で位置を返す。位置で突き合わせる。
const invalidIdx = new Set()
for (const r of evidenceResults?.results || []) {
  if (r.ok) continue
  const m = String(r.path).match(/^\$\.findings\[(\d+)\]\.evidence$/)
  if (m) invalidIdx.add(Number(m[1]))
}
merged.forEach((f, i) => { if (invalidIdx.has(i)) f.evidenceInvalid = true })

const invalidEvidence = merged.filter(f => f.evidenceInvalid)
const dropped = merged.filter(f => !f.evidenceInvalid && f.criticVerdict === 'DISAGREE_EVIDENCE')
// critic が見ていない指摘を「生き残り」に混ぜない。以前は NOT_REVIEWED が Blocking ごと survived に入っていた。
const unreviewed = merged.filter(f => !f.evidenceInvalid && f.criticVerdict === 'NOT_REVIEWED')
const survived = merged.filter(f => !f.evidenceInvalid && f.criticVerdict !== 'DISAGREE_EVIDENCE' && f.criticVerdict !== 'NOT_REVIEWED')
const blocking = survived.filter(f => f.severity === 'Blocking')
const uncertain = survived.filter(f => f.criticVerdict === 'DISAGREE_CONCERN')

const partial = failedPerspectives.length || criticMissing.length || !evidenceResults?.results
return {
  status: partial ? 'partial' : 'complete',
  mode: MODE,
  raised: merged.length,
  survived: survived.length,
  droppedByCritic: dropped.length,
  droppedByEvidence: invalidEvidence.length,
  unreviewed: unreviewed.length,
  needsResolution: uncertain.length,
  blocking: blocking.length,
  failedPerspectives,
  criticMissing,
  findings: survived,
  unreviewedFindings: unreviewed.map(f => ({ id: f.id, severity: f.severity, summary: f.summary })),
  droppedFindings: dropped.map(f => ({ id: f.id, summary: f.summary, refutedBy: f.criticReasoning })),
  invalidEvidenceFindings: invalidEvidence.map(f => ({ id: f.id, summary: f.summary, evidence: f.evidence })),
  notVerified: results.flat().flatMap(r => r?.review?.notVerified || []),
  evidenceSummary: evidenceResults ? { total: evidenceResults.total, invalid: evidenceResults.invalid, absence: evidenceResults.absence } : null,
  next:
    (partial ? `**この監査は不完全です。** ${failedPerspectives.length ? `観点 ${failedPerspectives.join(', ')} のレビューが返ってきませんでした。` : ''}` +
               `${criticMissing.length ? `観点 ${criticMissing.join(', ')} は批評が返ってこず、指摘が未検証です。` : ''}` +
               `${!evidenceResults?.results ? '引用の機械照合ができていません。' : ''}再実行するか、unreviewedFindings を手で確認してください。\n` : '') +
    `引用が実ファイルと一致しなかった ${invalidEvidence.length} 件は無効化済み（invalidEvidenceFindings）。` +
    `生き残った Blocking を是正してください。是正はこのワークフローの仕事ではありません。` +
    `DISAGREE_CONCERN が付いたものは resolvesBy に書かれた確認を先に行ってください。` +
    `notVerified は「確認できなかったこと」なので、埋めるか、確認できない理由とともに繰り越してください。`,
}
