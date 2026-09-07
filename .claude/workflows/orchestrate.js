export const meta = {
  name: 'orchestrate',
  description: 'RiFF-LiNE 開発フロー: plan → design → design-review → impl → impl-review（V字モデル・詳細設計書運用）',
  phases: [
    { title: 'Plan', detail: 'リポジトリ・設計ドキュメント分析／対象作業パッケージ・実行パス決定' },
    { title: 'Design', detail: '詳細設計書の作成/差分更新＋基本設計・00_reference.md・進捗ログの同時改訂' },
    { title: 'Design Review', detail: '設計整合・文書同時改訂の完全性レビュー PASS/FAIL' },
    { title: 'Impl', detail: '詳細設計書のシグネチャに従い実装／テスト後書き／git 操作なし' },
    { title: 'Impl Review', detail: '独立レビュー（PR 差分のみ）・差し戻し判定' },
  ],
}

// args: string — ユーザーのリクエスト文字列
// 例: Workflow({ name: 'orchestrate', args: 'データモデル・永続化パッケージを実装してほしい' })
// 本プロジェクトは .claude/settings.meta.json の workflow.designDocs=true（詳細設計書運用）。
// 設計書は SBD/SDD ではなく docs/basic_design/* + docs/detailed_design/<スラッグ>.md + docs/detailed_design/00_reference.md。

const MAX_LOOP = 3

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string' },
    execution_path: { type: 'string' },
    target_work_package: { type: 'string' },
    needs_design: { type: 'boolean' },
    needs_impl: { type: 'boolean' },
    affected_files: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    risks: { type: 'string' },
    estimated_impl_steps: { type: 'integer' },
  },
  required: ['classification', 'execution_path', 'target_work_package', 'needs_design', 'needs_impl', 'affected_files', 'reason', 'risks', 'estimated_impl_steps'],
}

const DESIGN_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    blocking_issues: { type: 'array', items: { type: 'string' } },
    non_blocking_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blocking_issues', 'non_blocking_issues'],
}

const IMPL_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL_IMPL', 'FAIL_DESIGN', 'FAIL_REQUIREMENT'] },
    blocking_issues: { type: 'array', items: { type: 'string' } },
    non_blocking_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blocking_issues', 'non_blocking_issues'],
}

const request = args || 'リクエストが指定されていません'

// ── Plan ──────────────────────────────────────────────────────────────────
phase('Plan')
log(`リクエスト: ${request}`)

const plan = await agent(
  `### リクエスト\n${request}`,
  { label: 'plan', phase: 'Plan', model: 'haiku', agentType: 'sdlc-plan', schema: PLAN_SCHEMA }
)

if (!plan) {
  return { status: 'error', phase: 'plan', message: 'plan エージェントが失敗しました' }
}

log(`対象パッケージ: ${plan.target_work_package} | 分類: ${plan.classification}`)
log(`設計: ${plan.needs_design ? 'あり' : 'なし'} | 実装: ${plan.needs_impl ? 'あり' : 'なし'}`)
log(`影響ファイル: ${plan.affected_files.join(', ')}`)
if (plan.risks) log(`リスク: ${plan.risks}`)

// ── Design → Design-Review loop ───────────────────────────────────────────
let designSummary = null

if (plan.needs_design) {
  let designLoop = 0
  let designPassed = false
  let lastDesignReview = null

  while (!designPassed) {
    designLoop++
    if (designLoop > MAX_LOOP) {
      return {
        status: 'blocked',
        phase: 'design',
        message: `design フェーズが ${MAX_LOOP} 回ループしました。手動確認が必要です。`,
        blocking_issues: lastDesignReview ? lastDesignReview.blocking_issues : [],
      }
    }

    phase('Design')
    if (designLoop > 1) log(`design 再実行 (${designLoop}/${MAX_LOOP})`)

    const feedbackSection = lastDesignReview && lastDesignReview.blocking_issues.length > 0
      ? `\n### 前回の design-review フィードバック（ブロッキング問題）\n${lastDesignReview.blocking_issues.map(i => `- ${i}`).join('\n')}`
      : ''

    designSummary = await agent(
      `### リクエスト
${request}

### 実行計画
- 対象作業パッケージ: ${plan.target_work_package}
- 分類: ${plan.classification}
- 影響ファイル: ${plan.affected_files.join(', ')}
- 理由: ${plan.reason}
${feedbackSection}`,
      { label: 'design', phase: 'Design', model: 'sonnet', agentType: 'sdlc-design' }
    )

    if (!designSummary) {
      return { status: 'error', phase: 'design', message: 'design エージェントが失敗しました' }
    }

    phase('Design Review')

    lastDesignReview = await agent(
      `### リクエスト
${request}

### 実行計画（対象: ${plan.target_work_package} / 分類: ${plan.classification}）
${plan.reason}

### design エージェントの変更サマリ
${designSummary}`,
      { label: 'design-review', phase: 'Design Review', model: 'haiku', agentType: 'sdlc-design-review', schema: DESIGN_REVIEW_SCHEMA }
    )

    if (!lastDesignReview) {
      return { status: 'error', phase: 'design-review', message: 'design-review エージェントが失敗しました' }
    }

    if (lastDesignReview.verdict === 'PASS') {
      designPassed = true
      log('design-review: PASS')
      if (lastDesignReview.non_blocking_issues.length > 0) {
        log(`非ブロッキング: ${lastDesignReview.non_blocking_issues.length} 件`)
      }
    } else {
      log(`design-review: FAIL — ブロッキング ${lastDesignReview.blocking_issues.length} 件 → design に差し戻し`)
    }
  }
}

if (!plan.needs_impl) {
  return {
    status: 'complete',
    classification: plan.classification,
    message: 'ドキュメント更新完了。impl フェーズなし。',
  }
}

// ── Impl → Impl-Review loop ───────────────────────────────────────────────
let implLoop = 0
let implPassed = false
let lastImplReview = null

while (!implPassed) {
  implLoop++
  if (implLoop > MAX_LOOP) {
    return {
      status: 'blocked',
      phase: 'impl',
      message: `impl フェーズが ${MAX_LOOP} 回ループしました。手動確認が必要です。`,
      blocking_issues: lastImplReview ? lastImplReview.blocking_issues : [],
    }
  }

  phase('Impl')
  if (implLoop > 1) log(`impl 再実行 (${implLoop}/${MAX_LOOP})`)

  const feedbackSection = lastImplReview && lastImplReview.blocking_issues.length > 0
    ? `\n### 前回の impl-review フィードバック（要修正）\n${lastImplReview.blocking_issues.map(i => `- ${i}`).join('\n')}`
    : ''

  const implModel = plan.estimated_impl_steps >= 2 ? 'opus' : 'sonnet'
  const implOutput = await agent(
    `### リクエスト
${request}

### 実行計画
- 対象作業パッケージ: ${plan.target_work_package}
- 分類: ${plan.classification}
- 影響ファイル: ${plan.affected_files.join(', ')}
- 推定ステップ数: ${plan.estimated_impl_steps}
${designSummary ? `\n### 設計変更サマリ\n${designSummary}` : ''}
${feedbackSection}`,
    { label: 'impl', phase: 'Impl', model: implModel, agentType: 'sdlc-impl' }
  )

  if (!implOutput) {
    return { status: 'error', phase: 'impl', message: 'impl エージェントが失敗しました' }
  }

  phase('Impl Review')

  lastImplReview = await agent(
    `### リクエスト
${request}

### 実行計画（対象: ${plan.target_work_package} / 分類: ${plan.classification}）
影響ファイル: ${plan.affected_files.join(', ')}

### impl の出力
${implOutput}`,
    { label: 'impl-review', phase: 'Impl Review', model: 'haiku', agentType: 'sdlc-impl-review', schema: IMPL_REVIEW_SCHEMA }
  )

  if (!lastImplReview) {
    return { status: 'error', phase: 'impl-review', message: 'impl-review エージェントが失敗しました' }
  }

  log(`impl-review 判定: ${lastImplReview.verdict}`)

  if (lastImplReview.verdict === 'PASS') {
    implPassed = true
    if (lastImplReview.non_blocking_issues.length > 0) {
      log(`非ブロッキング ${lastImplReview.non_blocking_issues.length} 件（可読性・スタイルのみ）`)
    }
  } else if (lastImplReview.verdict === 'FAIL_IMPL') {
    log(`impl 差し戻し: ブロッキング ${lastImplReview.blocking_issues.length} 件`)
  } else if (lastImplReview.verdict === 'FAIL_DESIGN') {
    return {
      status: 'fail_design',
      message: '設計ドキュメントの修正が必要です。design フェーズから再実行してください。',
      blocking_issues: lastImplReview.blocking_issues,
    }
  } else if (lastImplReview.verdict === 'FAIL_REQUIREMENT') {
    return {
      status: 'fail_requirement',
      message: '要件の明確化が必要です。ユーザーへの確認を推奨します。',
      blocking_issues: lastImplReview.blocking_issues,
    }
  }
}

return {
  status: 'complete',
  classification: plan.classification,
  target_work_package: plan.target_work_package,
  affected_files: plan.affected_files,
  message: '実装完了。impl-review: PASS。DoD 6項目（特に基準4 セルフレビュー・基準5 手動シナリオ・基準6 CI通過とマージ）の残りを確認すること。',
  non_blocking_issues: lastImplReview ? lastImplReview.non_blocking_issues : [],
}
