import { defineConfig } from 'vitest/config';

// ワークスペース横断のテスト構成（11_test_strategy.md §1）。
// - core: Webコアの単体テスト。ScoreRenderHost が DOM 要素を扱うため jsdom
// - desktop: Electron ラッパー層の単体＋結合テスト（実 I/O・IPC 契約の往復）。Node 環境
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
    ],
  },
});
