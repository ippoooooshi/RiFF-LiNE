// ESLint フラットコンフィグ（ESLint 10 は eslintrc 形式を廃止したため eslint.config.js を使う。
// 詳細設計書 docs/detailed_design/web-core-foundation.md §6 を本実装に合わせて更新済み）。
//
// レイヤー依存規則（01_architecture.md §2・AD-5、リスク#8「Electron依存混入」の仕組みによる防止）:
//   packages/core/** から electron / expo-* / apps/** / 直接のファイル I/O への import を error にする。
//   詳細設計書 §6 は import/no-restricted-paths を指定していたが、ESLint 10 + eslint-plugin-import の
//   フラットコンフィグ対応状況を踏まえ、ビルトインの no-restricted-imports（パターン指定）で同等の禁止を実現する。

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const layerRestrictedImports = {
  paths: [
    {
      name: 'electron',
      message:
        'Webコア(packages/core)は electron に依存できません（レイヤー依存規則 01_architecture.md AD-5）。PlatformAdapter インターフェース経由にしてください。',
    },
  ],
  patterns: [
    {
      group: ['electron', 'electron/*'],
      message: 'Webコア(packages/core)は electron に依存できません（レイヤー依存規則）。',
    },
    {
      group: ['expo', 'expo-*', 'expo/*'],
      message: 'Webコア(packages/core)は expo に依存できません（レイヤー依存規則）。',
    },
    {
      group: ['@riff-line/desktop', '@riff-line/desktop/*', '@riff-line/mobile', '@riff-line/mobile/*', '**/apps/**'],
      message: 'Webコア(packages/core)はラッパー層(apps/*)に依存できません（依存方向は上位→下位のみ）。',
    },
    {
      group: ['fs', 'fs/*', 'node:fs', 'node:fs/*'],
      message:
        'Webコア(packages/core)は直接ファイル I/O を行えません。FileSystemAdapter インターフェース経由にしてください（AD-3）。',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/out/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      // .claude/ は AI 運用ファイル（設定・エージェント定義・ワークフローランタイム）。
      // orchestrate.js はワークフローランナーが注入するグローバル（args/phase/log/agent）に依存するため対象外。
      '.claude/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Webコア: any 禁止 ＋ レイヤー依存規則
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': ['error', layerRestrictedImports],
    },
  },
  {
    // preload はレンダラーへの橋渡しのみ。Webコア・fs へ依存させない
    files: ['apps/desktop/src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@riff-line/core', '@riff-line/core/*'],
              message: 'preload は @riff-line/core に依存できません。',
            },
            { group: ['fs', 'fs/*', 'node:fs', 'node:fs/*'], message: 'preload は直接ファイル I/O を行えません。' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
