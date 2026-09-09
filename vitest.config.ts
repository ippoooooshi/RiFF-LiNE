import { defineConfig } from 'vitest/config';

// ワークスペース横断のテスト構成（11_test_strategy.md §1）。
// - core: Webコアの単体テスト。ScoreRenderHost が DOM 要素を扱うため jsdom
// - desktop: Electron ラッパー層（main / preload / renderer の純ロジック）の単体＋結合テスト。Node 環境
// - desktop-renderer: renderer の React bootstrap（DI 配線）の結合テスト。jsdom ＋ .tsx（独立レビュー B-4）
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: 'packages/core',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'desktop',
          root: 'apps/desktop',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        // React コンポーネントの DI 配線（App.tsx の EditWindow / SongListWindow bootstrap）を
        // jsdom でマウントして「例外なく chrome が描画される」ことを検証する（B-4、B-3 の初期化順回帰を固定）。
        // JSX は Vitest 既定のトランスフォーマ（oxc）が .tsx を automatic runtime で処理する。
        test: {
          name: 'desktop-renderer',
          root: 'apps/desktop',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
        },
      },
    ],
  },
});
