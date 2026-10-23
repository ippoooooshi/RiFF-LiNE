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
// web-core-foundation.md 14.2 節：単体テストと結合テストは同じ Vitest で走らせ、ファイルの名前で分ける（結合テストは *.integration.test.ts）。プロジェクトは core・desktop・desktop-renderer の 3 つで、どれも両方を拾う。単体テストは対象と同じフォルダの *.test.ts に置く <!-- req webcorefoundation:64f10aef.6816 --> <!-- req webcorefoundation:64f10aef.c8ee --> <!-- req webcorefoundation:64f10aef.8ac3 --> <!-- req webcorefoundation:64f10aef.7f60 --> <!-- req webcorefoundation:da3df5bf.348e -->
