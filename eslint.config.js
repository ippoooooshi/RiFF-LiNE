// ESLint フラットコンフィグ（ESLint 10 は eslintrc 形式を廃止したため eslint.config.js を使う）。
// 詳細設計書 docs/detailed_design/web-core-foundation.md 2.2 節（ESLint で見張る）・5.2 節（import したらビルドが失敗する仕組み）。
// <!-- req webcorefoundation:1323559c.3fc7 -->
// <!-- req webcorefoundation:743c2379.6eba -->
//
// レイヤー依存規則（01_architecture.md AD-5、リスク#8「Electron依存混入」の仕組みによる防止）:
//   packages/core/**・packages/ui-shared/**・packages/ui-desktop/** から electron / expo-* / Node.js の組み込みモジュール /
//   apps/** への import を error にする。リポジトリ直下の `build` は最初に `pnpm lint` を走らせるので、この error でビルドが止まる。
//   組み込みの no-restricted-imports（パターン指定）を使い、eslint-plugin-import は足さない（2.2 節の (b)）。

import { builtinModules } from 'node:module';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Node.js の組み込みモジュール（`fs`・`fs/promises` の形）。一覧は実行中の Node から取り、手で写さない。
// patterns は gitignore の書き方で `domain` が `../domain/types` にも当たるので、名前そのものは paths（完全一致）で止める。
const nodeBuiltinNames = builtinModules.filter((m) => !m.startsWith('_'));

/**
 * Webコアのパッケージ（core・ui-shared・ui-desktop）に共通の、Node.js の組み込みモジュールの import の禁止（5.2 節）。
 * @param {string} who エラーの文に出すパッケージ名
 */
const nodeBuiltinRestrictedPaths = (who) =>
  nodeBuiltinNames.map((name) => ({
    name,
    message: `${who} は Node.js の組み込みモジュールを直接参照できません。ファイル I/O などは PlatformAdapter インターフェース経由にしてください（AD-3）。`,
  }));

/**
 * Webコアのパッケージ（core・ui-shared・ui-desktop）に共通の、プラットフォーム固有の import の禁止（5.2 節）。
 * @param {string} who エラーの文に出すパッケージ名
 */
const platformRestrictedPatterns = (who) => [
  // <!-- req webcorefoundation:60a4a359.b944 --> <!-- req webcorefoundation:a08c965a.c560 --> <!-- req webcorefoundation:4cf8aab7.4a6a -->
  {
    group: ['electron', 'electron/*'],
    message: `${who} は electron に依存できません（レイヤー依存規則 01_architecture.md AD-5）。PlatformAdapter インターフェース経由にしてください。`,
  },
  // <!-- req webcorefoundation:60a4a359.4566 --> <!-- req webcorefoundation:a08c965a.36fe -->
  {
    group: ['expo', 'expo-*', 'expo/*'],
    message: `${who} は expo に依存できません（レイヤー依存規則）。`,
  },
  // <!-- req webcorefoundation:60a4a359.cbcc --> <!-- req webcorefoundation:60a4a359.c075 -->
  {
    group: ['node:*'],
    message: `${who} は Node.js の組み込みモジュールを直接参照できません。ファイル I/O などは PlatformAdapter インターフェース経由にしてください（AD-3）。`,
  },
  {
    group: ['@riff-line/desktop', '@riff-line/desktop/*', '@riff-line/mobile', '@riff-line/mobile/*', '**/apps/**'],
    message: `${who} はラッパー層(apps/*)に依存できません（依存方向は上位→下位のみ）。`,
  },
];

// packages/ui-desktop を参照するのは apps/desktop だけ（5.1 節）。packages/ 側からの import を止める。
// <!-- req webcorefoundation:af78c4b9.5cc6 -->
const uiDesktopRestrictedPattern = {
  group: ['@riff-line/ui-desktop', '@riff-line/ui-desktop/*'],
  message: '@riff-line/ui-desktop を参照するのは apps/desktop だけです（web-core-foundation.md 5.1 節）。',
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
      // _bridge/ と _claude_fix/ も AI 運用ファイル（チャット側との受け渡しの台本と、.claude へ当てる前のパッチの置き場）。
      // 同じくワークフローのグローバルに依存し、製品のコードではないため対象外。
      '_bridge/**',
      '_claude_fix/**',
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
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltinRestrictedPaths('Webコア(packages/core)'),
          patterns: [...platformRestrictedPatterns('Webコア(packages/core)'), uiDesktopRestrictedPattern],
        },
      ],
    },
  },
  {
    // PC 版・iPhone 版・iPad 版で共通の画面の中身。core と同じ禁止に加え、入れ物（ui-desktop）を import しない
    // <!-- req webcorefoundation:a08c965a.c3cd --> <!-- req webcorefoundation:feca276f.fde2 --> <!-- req webcorefoundation:a08c965a.4917 -->
    files: ['packages/ui-shared/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltinRestrictedPaths('packages/ui-shared'),
          patterns: [...platformRestrictedPatterns('packages/ui-shared'), uiDesktopRestrictedPattern],
        },
      ],
    },
  },
  {
    // PC 版の画面の入れ物。core と同じ禁止
    // <!-- req webcorefoundation:a08c965a.c6c1 --> <!-- req webcorefoundation:feca276f.e40d --> <!-- req webcorefoundation:a08c965a.23c9 -->
    files: ['packages/ui-desktop/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltinRestrictedPaths('packages/ui-desktop'),
          patterns: platformRestrictedPatterns('packages/ui-desktop'),
        },
      ],
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
