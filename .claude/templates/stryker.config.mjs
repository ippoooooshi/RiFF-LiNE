// mutation testing の設定ひな形。
//
// なぜ必要か:
//   「テストが通る」と「テストが検証している」は別物。静的検出
//   （check-tests.mjs）は assertion 0 件・恒真・モック反響までしか拾えない。
//   実装をわざと壊してテストが落ちるかを見るのが、空振りの唯一の本質的な検出。
//
// なぜ常時走らせないか:
//   変異ごとに全テストを回すため、実行時間が桁で増える。
//   /wp done（パッケージ完了時）だけで回す想定。
//
// 導入:
//   pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner
//   リポジトリ直下へ stryker.config.mjs としてコピーし、mutate を対象に合わせる
//   実行: pnpm exec stryker run

export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress', 'html'],
  coverageAnalysis: 'perTest',

  // 完了させようとしているパッケージだけに絞る。全体を一度に回さない。
  mutate: [
    'packages/core/src/**/*.ts',
    '!packages/core/src/**/*.test.ts',
    '!packages/core/src/**/index.ts',
  ],

  // 生存した変異（テストが気づかなかった改変）が多いほど、テストが空振りしている。
  thresholds: { high: 80, low: 60, break: 50 },

  timeoutMS: 60000,
  concurrency: 4,
}
