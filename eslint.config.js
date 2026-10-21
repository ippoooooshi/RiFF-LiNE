// ESLint フラットコンフィグ（ESLint 10 は eslintrc 形式を廃止したため eslint.config.js を使う）。
// 詳細設計書 docs/detailed_design/web-core-foundation.md 2.2 節（ESLint で見張る）・5.2 節（import したらビルドが失敗する仕組み）・
// 8.4 節（ビルドの構成を import しない）。単体テストは apps/desktop/src/dev/layerRules.test.ts（UT-DEV-LAYER）。
// <!-- req webcorefoundation:1323559c.3fc7 -->
// <!-- req webcorefoundation:743c2379.6eba -->
//
// <!-- req webcorefoundation:8ecbea75.bcd1 --> <!-- req webcorefoundation:8ecbea75.4c49 --> <!-- req webcorefoundation:8ecbea75.84b8 --> <!-- req webcorefoundation:828d6899.401a --> <!-- req webcorefoundation:0cbb8d74.47ea --> <!-- req webcorefoundation:0cbb8d74.a3ed -->
// レイヤー依存規則（01_architecture.md AD-5、リスク#8「Electron依存混入」の仕組みによる防止）:
//   packages/core/**・packages/ui-shared/**・packages/ui-desktop/** から electron / expo-* / Node.js の組み込みモジュール /
//   apps/** への import を error にする。リポジトリ直下の `build` は最初に `pnpm lint` を走らせるので、この error でビルドが止まる。
//   組み込みの no-restricted-imports（パターン指定）を使い、eslint-plugin-import は足さない（2.2 節の (b)）。
//
// <!-- req webcorefoundation:bff1b4d2.33dc --> <!-- req webcorefoundation:bff1b4d2.4534 --> <!-- req webcorefoundation:bff1b4d2.5097 --> <!-- req webcorefoundation:bff1b4d2.88d4 --> <!-- req webcorefoundation:bff1b4d2.857c --> <!-- req webcorefoundation:bff1b4d2.4dd9 --> <!-- req webcorefoundation:bff1b4d2.8f5f -->
// 1 つのファイルに no-restricted-imports の塊が 2 つ当たると、後の塊の設定で置き換わる（足し合わせない）。
// そのため、塊ごとに `restricted(...)` で禁止の全部を組み立てる。

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

// パッケージの依存の向きは apps/desktop → ui-desktop → ui-shared → core → shared-types（5.2 節）。core から ui-shared を参照しない。
const uiSharedRestrictedPattern = {
  group: ['@riff-line/ui-shared', '@riff-line/ui-shared/*'],
  message: 'packages/core は @riff-line/ui-shared に依存できません（依存の向きは ui-shared → core、5.2 節）。',
};

// <!-- req webcorefoundation:357c640f.eb70 --> <!-- req webcorefoundation:a5df59a3.304d -->
// React の部品は packages/ui-shared と packages/ui-desktop だけに置く（2.2 節の表、13 章 B36 の理由 (1)）。
const reactRestrictedPattern = {
  group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  message:
    'packages/core は React を import できません。React の部品は packages/ui-shared（中身）と packages/ui-desktop（入れ物）に置きます（2.2 節）。',
};

// <!-- req webcorefoundation:f821f2e1.ba57 -->
// ビルドの構成（electron-vite と Electron Builder の設定ファイルとパッケージ）はソースから import しない（8.4 節）。
const buildToolRestrictedPatterns = [
  {
    group: [
      'electron-vite',
      'electron-vite/*',
      'electron-builder',
      'electron-builder/*',
      'app-builder-lib',
      'app-builder-lib/*',
    ],
    message:
      'ソースからビルドの構成（electron-vite・Electron Builder）を import できません（web-core-foundation.md 8.4 節）。',
  },
  {
    regex: '(^|/)(electron\\.vite\\.config|electron-builder\\.(json|ya?ml|config))(\\.[cm]?[jt]s)?$',
    message: 'ソースからビルドの構成の設定ファイルを import できません（web-core-foundation.md 8.4 節）。',
  },
];

// <!-- req webcorefoundation:a5df59a3.2db2 --> <!-- req webcorefoundation:a5df59a3.8f3f --> <!-- req webcorefoundation:542560fc.e2b8 --> <!-- req webcorefoundation:08f7960d.fe7b --> <!-- req webcorefoundation:08f7960d.b883 --> <!-- req webcorefoundation:14688377.dcd8 --> <!-- req webcorefoundation:14688377.1553 --> <!-- req webcorefoundation:828d6899.cf46 -->
// packages/core/src のフォルダを層に当てはめたもの（2.1 節）。persistence・parts・viewmodes・testing は 2.1 節の表に層が無いので、ここでは縛らない。
const CORE_LAYERS = {
  L1: ['ui', 'rendering'],
  L2: ['editing', 'playback', 'export'],
  L3: ['domain'],
  L4: ['platform'],
  errors: ['errors'],
};
const CORE_FOLDERS_WITHOUT_LAYER = ['persistence', 'parts', 'viewmodes', 'testing'];

/**
 * packages/core/src の中で、相対パスで `folders` のフォルダへ入る import を止める（2.2 節の表に無い向き）。
 * 自分のフォルダの外へ出る `../` から始まる import だけを見る（同じフォルダの中の import は層の向きではない）。
 * @param {string} who エラーの文に出す import する側
 * @param {string[]} folders import してはいけない packages/core/src の直下のフォルダ
 */
const coreFolderRestrictedPattern = (who, folders) => ({
  regex: `^(\\.\\./)+(${folders.join('|')})(/|$)`,
  message: `${who} から ${folders.join('・')} は import できません（web-core-foundation.md 2.2 節の層どうしの向きの表）。`,
});

/** packages/core/src の直下を指すだけの `..`（core の index.ts）を止める。全部の層をまとめて引き込むため。 */
const coreRootIndexRestrictedPattern = (who) => ({
  regex: '^(\\.\\.)(/\\.\\.)*(/index(\\.ts)?)?/?$',
  message: `${who} から packages/core の index.ts は import できません（層を越えて全部を引き込むため。2.2 節）。`,
});

/** packages/core の中から自分のパッケージ名（`@riff-line/core/ui` など）で import すると、相対パスの層の禁止を通り抜けるので止める。 */
const coreSelfRestrictedPattern = {
  group: ['@riff-line/core', '@riff-line/core/*'],
  message:
    'packages/core の中では自分のパッケージ名で import できません。相対パスで書き、2.2 節の層の向きに従ってください。',
};

/** packages/shared-types（L4）が import してよいのは packages/shared-types だけ（2.2 節の表の L4 の行）。ワークスペースのほかのパッケージを止める。 */
const sharedTypesRestrictedPattern = {
  group: [
    '@riff-line/core',
    '@riff-line/core/*',
    '@riff-line/ui-shared',
    '@riff-line/ui-shared/*',
    '@riff-line/ui-desktop',
    '@riff-line/ui-desktop/*',
  ],
  message:
    'packages/shared-types は、ワークスペースのほかのパッケージを import できません（2.2 節の表の L4 の行・5.2 節）。',
};

/** packages/shared-types から相対パスでほかのパッケージ（core・ui-shared・ui-desktop）へ入る import も止める。 */
const sharedTypesRelativeRestrictedPattern = {
  regex: '^(\\.\\./)+(core|ui-shared|ui-desktop)(/|$)',
  message: 'packages/shared-types は、相対パスでもほかのパッケージを import できません（2.2 節の表の L4 の行）。',
};

/**
 * no-restricted-imports の設定を 1 つに組み立てる。
 * @param {{ paths?: object[], patterns?: object[] }} parts
 */
const restricted = ({ paths = [], patterns = [] }) => ['error', { paths, patterns }];

// <!-- req webcorefoundation:828d6899.527d --> <!-- req webcorefoundation:828d6899.3215 --> <!-- req webcorefoundation:828d6899.687c --> <!-- req webcorefoundation:828d6899.75f1 --> <!-- req webcorefoundation:828d6899.e42a -->
/** packages/core のどのファイルにも当てる禁止（5.2 節・2.2 節・8.4 節）。 */
const coreBase = (who) => ({
  paths: nodeBuiltinRestrictedPaths(who),
  patterns: [
    ...platformRestrictedPatterns(who),
    uiDesktopRestrictedPattern,
    uiSharedRestrictedPattern,
    reactRestrictedPattern,
    coreSelfRestrictedPattern,
    ...buildToolRestrictedPatterns,
  ],
});

/**
 * packages/core/src の層ごとの塊。import してよい先（2.2 節の表）の外にある層のフォルダを止める。
 * @param {string[]} folders この層のフォルダ
 * @param {string[]} forbidden import してはいけないフォルダ
 * @param {string} label エラーの文に出す層の名前
 */
const coreLayerBlock = (folders, forbidden, label) => {
  const base = coreBase(`Webコア(packages/core)の ${label}`);
  return {
    // 1 つだけの `{domain}` は glob で広がらないので、フォルダごとに書く
    files: folders.map((folder) => `packages/core/src/${folder}/**/*.{ts,tsx}`),
    // テストは偽物（testing）やほかの層のエラーのクラスで場面を作るので、層のフォルダどうしの禁止は製品のコードだけに当てる。
    // テストにも packages/core の分の禁止（electron・expo-*・Node.js・apps・react ほか）は、上の core の塊で当たる。
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({
        paths: base.paths,
        patterns: [
          ...base.patterns,
          coreFolderRestrictedPattern(label, forbidden),
          coreRootIndexRestrictedPattern(label),
        ],
      }),
    },
  };
};

const allCoreFolders = [...Object.values(CORE_LAYERS).flat(), ...CORE_FOLDERS_WITHOUT_LAYER];
const except = (...keep) => allCoreFolders.filter((f) => !keep.includes(f));

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
    // Webコア: any 禁止 ＋ レイヤー依存規則（packages/core のどのファイルにも当てる分）
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': restricted(coreBase('Webコア(packages/core)')),
    },
  },
  // 2.2 節の層どうしの向きの表。下の層から上の層へは import しない（L1 → L2 → L3 → L4）。
  // <!-- req webcorefoundation:a5df59a3.e597 --> <!-- req webcorefoundation:a5df59a3.6712 --> <!-- req webcorefoundation:a5df59a3.5d52 --> <!-- req webcorefoundation:a5df59a3.a74c -->
  // L1（ui・rendering）は L2・L3・L4・errors を import してよいので、層のフォルダの禁止は足さない（core の分の禁止だけ当たる）。
  // <!-- req webcorefoundation:7bf1f0cc.fa76 --> <!-- req webcorefoundation:7bf1f0cc.43e1 --> <!-- req webcorefoundation:7bf1f0cc.83ce -->
  coreLayerBlock(CORE_LAYERS.L2, [...CORE_LAYERS.L1], 'L2（editing・playback・export）'),
  // <!-- req webcorefoundation:c8986586.ec21 --> <!-- req webcorefoundation:c8986586.dbe8 --> <!-- req webcorefoundation:c8986586.ffdb -->
  coreLayerBlock(CORE_LAYERS.L3, [...CORE_LAYERS.L1, ...CORE_LAYERS.L2], 'L3（domain）'),
  // L4 が import してよいのは packages/shared-types だけ（L5 が L4 のインターフェースを実装して注入する。AD-3 の依存性逆転）。
  // errors だけは 2.1 節「どの層から使ってもよく」に合わせて通す（2.2 節の表の L4 の行との食い違いは honnin-queue 178 番）。
  // <!-- req webcorefoundation:376faf74.e1b4 --> <!-- req webcorefoundation:376faf74.1435 --> <!-- req webcorefoundation:78eb81f7.1a67 -->
  coreLayerBlock(CORE_LAYERS.L4, except(...CORE_LAYERS.L4, ...CORE_LAYERS.errors), 'L4（platform）'),
  // errors はどの層から使ってもよく、errors からは packages/shared-types のほかを import しない。
  // <!-- req webcorefoundation:5c6a79d0.8baf --> <!-- req webcorefoundation:78eb81f7.b993 -->
  coreLayerBlock(CORE_LAYERS.errors, except(...CORE_LAYERS.errors), 'errors'),
  {
    // PC 版・iPhone 版・iPad 版で共通の画面の中身。core と同じ禁止に加え、入れ物（ui-desktop）を import しない
    // <!-- req webcorefoundation:a08c965a.c3cd --> <!-- req webcorefoundation:feca276f.fde2 --> <!-- req webcorefoundation:a08c965a.4917 -->
    // <!-- req webcorefoundation:403daace.de3b --> <!-- req webcorefoundation:403daace.6dcc --> <!-- req webcorefoundation:a5df59a3.66fb --> <!-- req webcorefoundation:a5df59a3.bdb1 --> <!-- req webcorefoundation:828d6899.4daa --> <!-- req webcorefoundation:42aa18eb.da46 -->
    files: ['packages/ui-shared/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': restricted({
        paths: nodeBuiltinRestrictedPaths('packages/ui-shared'),
        patterns: [
          ...platformRestrictedPatterns('packages/ui-shared'),
          uiDesktopRestrictedPattern,
          ...buildToolRestrictedPatterns,
        ],
      }),
    },
  },
  {
    // PC 版の画面の入れ物。core と同じ禁止
    // <!-- req webcorefoundation:a08c965a.c6c1 --> <!-- req webcorefoundation:feca276f.e40d --> <!-- req webcorefoundation:a08c965a.23c9 -->
    // <!-- req webcorefoundation:828d6899.a232 --> <!-- req webcorefoundation:a5df59a3.2e8a --> <!-- req webcorefoundation:42aa18eb.fff5 -->
    files: ['packages/ui-desktop/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': restricted({
        paths: nodeBuiltinRestrictedPaths('packages/ui-desktop'),
        patterns: [...platformRestrictedPatterns('packages/ui-desktop'), ...buildToolRestrictedPatterns],
      }),
    },
  },
  {
    // packages/shared-types は L4。import してよいのは shared-types だけで、プラットフォーム固有のもの・ほかのパッケージ・
    // apps・ビルドの構成（8.4 節）を import しない（2.2 節の表の L4 の行）
    files: ['packages/shared-types/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({
        paths: nodeBuiltinRestrictedPaths('packages/shared-types'),
        patterns: [
          ...platformRestrictedPatterns('packages/shared-types'),
          sharedTypesRestrictedPattern,
          sharedTypesRelativeRestrictedPattern,
          reactRestrictedPattern,
          ...buildToolRestrictedPatterns,
        ],
      }),
    },
  },
  {
    // ラッパーのソースはビルドの構成を import しない（8.4 節）。L5 は L1〜L4・errors・electron を import してよい（2.2 節）
    // <!-- req webcorefoundation:1cf9909d.e7bb --> <!-- req webcorefoundation:1cf9909d.a14b --> <!-- req webcorefoundation:1cf9909d.e2f0 --> <!-- req webcorefoundation:1cf9909d.f4b0 -->
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({ patterns: buildToolRestrictedPatterns }),
    },
  },
  {
    // preload はレンダラーへの橋渡しのみ。Webコア・fs へ依存させない
    files: ['apps/desktop/src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({
        patterns: [
          {
            group: ['@riff-line/core', '@riff-line/core/*'],
            message: 'preload は @riff-line/core に依存できません。',
          },
          { group: ['fs', 'fs/*', 'node:fs', 'node:fs/*'], message: 'preload は直接ファイル I/O を行えません。' },
          ...buildToolRestrictedPatterns,
        ],
      }),
    },
  },
  {
    // テストは any と console を使ってよい。Webコア（packages/*）のテストにも依存の向きの規則はそのまま当てる
    // （詳細設計に、テストを依存の向きの規則から外す決まりは無い）。
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // ラッパー（apps）のテストは、一時フォルダの読み書きに Node.js を使い、ビルドの構成の確かめに ESLint を呼ぶので外す
    files: ['apps/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
