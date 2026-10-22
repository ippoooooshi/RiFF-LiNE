// ESLint フラットコンフィグ（ESLint 10 は eslintrc 形式を廃止したため eslint.config.js を使う）。
// 詳細設計書 docs/detailed_design/web-core-foundation.md 2.2 節（ESLint で見張る）・5.2 節（import したらビルドが失敗する仕組み）・
// 8.4 節（ビルドの構成を import しない）。単体テストは apps/desktop/src/dev/layerRules.test.ts（UT-DEV-LAYER）。 <!-- req webcorefoundation:6b4164d2.3dfa -->
// <!-- req webcorefoundation:1323559c.3fc7 -->
// <!-- req webcorefoundation:743c2379.6eba -->
//
// <!-- req webcorefoundation:8ecbea75.bcd1 --> <!-- req webcorefoundation:8ecbea75.4c49 --> <!-- req webcorefoundation:8ecbea75.84b8 --> <!-- req webcorefoundation:5bd19fd8.401a --> <!-- req webcorefoundation:0cbb8d74.47ea --> <!-- req webcorefoundation:0cbb8d74.a3ed -->
// レイヤー依存規則（01_architecture.md AD-5、リスク#8「Electron依存混入」の仕組みによる防止）:
//   packages/core/**・packages/ui-shared/**・packages/ui-desktop/** から electron / expo-* / Node.js の組み込みモジュール /
//   apps/** への import を error にする。リポジトリ直下の `build` は最初に `pnpm lint` を走らせるので、この error でビルドが止まる。
//   名前で止めるもの（electron・expo-*・Node.js・パッケージ名・react・ビルドの構成）は組み込みの no-restricted-imports（パターン指定）、
//   層のフォルダどうしの向きと、相対パスでほかのパッケージへ入る向きは、import-x の no-restricted-paths で、
//   import を解いた先のファイルの場所で見る（書き方を変えた相対パスでもすり抜けない。2.2 節の (b)）。
//
// <!-- req webcorefoundation:bff1b4d2.33dc --> <!-- req webcorefoundation:bff1b4d2.4534 --> <!-- req webcorefoundation:bff1b4d2.5097 --> <!-- req webcorefoundation:bff1b4d2.88d4 --> <!-- req webcorefoundation:bff1b4d2.857c --> <!-- req webcorefoundation:bff1b4d2.4dd9 --> <!-- req webcorefoundation:bff1b4d2.8f5f -->
// 1 つのファイルに no-restricted-imports の塊が 2 つ当たると、後の塊の設定で置き換わる（足し合わせない）。
// そのため、塊ごとに `restricted(...)` で禁止の全部を組み立てる。no-restricted-paths も同じなので、区域は 2 つの塊（製品のコードとテスト）に分けて 1 回ずつ渡す。

import { readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';

// no-restricted-paths の区域の場所は、このファイルの置き場所（リポジトリ直下）から数える（ESLint を呼んだ場所によらない）。
const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

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
  // <!-- req webcorefoundation:9a764364.4747 --> <!-- req webcorefoundation:9a764364.6d77 --> <!-- req webcorefoundation:9a764364.f9c3 --> <!-- req webcorefoundation:9a764364.9c2b --> <!-- req webcorefoundation:9a764364.a512 --> <!-- req webcorefoundation:57d66463.ac40 --> <!-- req webcorefoundation:57d66463.dad0 -->
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

// パッケージの依存の向きは apps/desktop → ui-desktop → ui-shared → core → shared-types（5.2 節）。core から ui-shared を参照しない。 <!-- req webcorefoundation:e6c5a6ed.6203 -->
const uiSharedRestrictedPattern = {
  group: ['@riff-line/ui-shared', '@riff-line/ui-shared/*'],
  message: 'packages/core は @riff-line/ui-shared に依存できません（依存の向きは ui-shared → core、5.2 節）。',
};

// <!-- req webcorefoundation:357c640f.eb70 --> <!-- req webcorefoundation:b790063b.304d -->
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

// <!-- req webcorefoundation:b790063b.2db2 --> <!-- req webcorefoundation:b790063b.8f3f --> <!-- req webcorefoundation:542560fc.e2b8 --> <!-- req webcorefoundation:08f7960d.fe7b --> <!-- req webcorefoundation:08f7960d.b883 --> <!-- req webcorefoundation:14688377.dcd8 --> <!-- req webcorefoundation:14688377.1553 --> <!-- req webcorefoundation:e8c602fc.cf46 -->
// packages/core/src のフォルダを層に当てはめたもの（2.1 節）。viewmodes は L1、persistence・parts は L2（honnin-queue 178 番）。
const CORE_LAYERS = {
  L1: ['ui', 'rendering', 'viewmodes'],
  L2: ['editing', 'playback', 'export', 'persistence', 'parts'],
  L3: ['domain'],
  L4: ['platform'],
  errors: ['errors'],
};
// testing（開発用のサンプルと偽物）はどの層にも入れない。製品のコードのどの層からも import しない（2.1 節、honnin-queue 178 番）。
const CORE_FOLDERS_WITHOUT_LAYER = ['testing'];
// <!-- req webcorefoundation:2f7f74b8.11a7 --> <!-- req webcorefoundation:2f7f74b8.db22 --> <!-- req webcorefoundation:b790063b.88c2 --> <!-- req webcorefoundation:a0047314.2672 --> <!-- req webcorefoundation:a0047314.0a08 --> <!-- req webcorefoundation:a0047314.2289 --> <!-- req webcorefoundation:a0047314.53b8 --> <!-- req webcorefoundation:03b99b93.f878 -->

// packages/core/src に層の決まっていないフォルダか、index.ts のほかの直下のファイルができたら、設定を読む時点で止める（どちらも区域に入らない。turn 174・176）。
// 新しいフォルダを足すときは、2.1 節の表に層を書いてから上の CORE_LAYERS に足す。
{
  const known = new Set([...Object.values(CORE_LAYERS).flat(), ...CORE_FOLDERS_WITHOUT_LAYER]);
  const coreSrc = fileURLToPath(new URL('./packages/core/src/', import.meta.url));
  const unknown = readdirSync(coreSrc, { withFileTypes: true })
    .filter((d) => (d.isDirectory() ? !known.has(d.name) : d.name !== 'index.ts'))
    .map((d) => d.name);
  if (unknown.length > 0) {
    throw new Error(
      `eslint.config.js: packages/core/src の ${unknown.join('・')} に層が決まっていません（フォルダは web-core-foundation.md 2.1 節の表に書いてから CORE_LAYERS に足す。直下に置いてよいファイルは index.ts だけ）。`,
    );
  }
}

/** packages/core の中から自分のパッケージ名（`@riff-line/core/ui` など）で import すると、層の向きの区域を名前で避けられるので止める。 */
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

/** apps/desktop/src の通信の禁止（6.2 節：v1 はネットワーク I/O を行う実装を持たない）。`node:` の付かない名前と electron の net も止める。 */
const NETWORK_MODULES = ['http', 'https', 'net', 'tls', 'dgram'];
// 8.4 節：packages と apps/desktop/src からビルドの構成（electron-vite・Electron Builder）を import しない（buildToolRestrictedPatterns） <!-- req webcorefoundation:46958c39.43d0 --> <!-- req webcorefoundation:46958c39.af77 --> <!-- req webcorefoundation:46958c39.9988 --> <!-- req webcorefoundation:46958c39.acda -->
// 動きの確かめ（ネットワークアダプタを無効にして新規作成から印刷プレビューまで通す）は Phase 1 の受け入れ確認（14.6 節の #1） <!-- req webcorefoundation:9c2bedf0.ffdf --> <!-- req webcorefoundation:9c2bedf0.8a07 --> <!-- req webcorefoundation:9c2bedf0.d9a7 --> <!-- req webcorefoundation:9c2bedf0.93fd --> <!-- req webcorefoundation:9c2bedf0.9413 --> <!-- req webcorefoundation:9c2bedf0.b1ff --> <!-- req webcorefoundation:9c2bedf0.dc69 --> <!-- req webcorefoundation:9c2bedf0.1746 -->
// 6.2 節 (b)：ネットワーク I/O を持たないことを import で機械で止める（Webコア 3 パッケージの Node.js の組み込みモジュールは nodeBuiltinRestrictedPaths で止めている） <!-- req webcorefoundation:991b5e82.35cb --> <!-- req webcorefoundation:991b5e82.3cc7 --> <!-- req webcorefoundation:9c2bedf0.82fd --> <!-- req webcorefoundation:9c2bedf0.4d7e --> <!-- req webcorefoundation:9c2bedf0.20e7 --> <!-- req webcorefoundation:9c2bedf0.a9d5 --> <!-- req webcorefoundation:9c2bedf0.012f --> <!-- req webcorefoundation:9c2bedf0.d524 --> <!-- req webcorefoundation:9c2bedf0.dc37 --> <!-- req webcorefoundation:9c2bedf0.d7d3 --> <!-- req webcorefoundation:9c2bedf0.9552 --> <!-- req webcorefoundation:9c2bedf0.6d6a --> <!-- req webcorefoundation:9c2bedf0.e528 --> <!-- req webcorefoundation:9c2bedf0.dd13 -->
const networkRestrictedPaths = [
  ...NETWORK_MODULES.flatMap((m) => [m, `node:${m}`]).map((name) => ({
    name,
    message: `${name} は import できません。v1 のアプリはネットワーク I/O を行う実装を持ちません（web-core-foundation.md 6.2 節）。`,
  })),
  {
    name: 'electron',
    importNames: ['net'],
    message:
      'electron の net は import できません。v1 のアプリはネットワーク I/O を行う実装を持ちません（web-core-foundation.md 6.2 節）。',
  },
];

/**
 * no-restricted-imports の設定を 1 つに組み立てる。
 * @param {{ paths?: object[], patterns?: object[] }} parts
 */
const restricted = ({ paths = [], patterns = [] }) => ['error', { paths, patterns }];

// <!-- req webcorefoundation:5bd19fd8.527d --> <!-- req webcorefoundation:5bd19fd8.60f4 --> <!-- req webcorefoundation:5bd19fd8.687c --> <!-- req webcorefoundation:5bd19fd8.75f1 --> <!-- req webcorefoundation:5bd19fd8.b53a -->
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

// ── import-x の no-restricted-paths の区域（2.2 節・5.2 節） ──────────────────────────────
// 区域は「target のファイルから、from の場所へ解ける import を止める」。import の書き方（`../domain/../ui`・リポジトリの根から
// `packages/` に入り直す形・`./../core`）によらず、解いた先のファイルの場所で見る。解けない import は TypeScript の型の確かめで止まる。 <!-- req webcorefoundation:e8c602fc.4224 --> <!-- req webcorefoundation:e8c602fc.b811 --> <!-- req webcorefoundation:e8c602fc.1aeb --> <!-- req webcorefoundation:a1a78658.d5dd --> <!-- req webcorefoundation:a1a78658.0bd1 --> <!-- req webcorefoundation:16561b09.bb75 -->

const coreDir = (folder) => `packages/core/src/${folder}`;
/** packages/core の index.ts。全部の層をまとめて引き込むので、層のフォルダからは import しない。 */
const CORE_INDEX = 'packages/core/src/index.ts';

/**
 * パッケージの依存の向き（apps/desktop → ui-desktop → ui-shared → core → shared-types、5.2 節）。逆向きに入る import を止める。
 * 製品のコードにもテストのファイルにも当てる（パッケージの向きはテストでも変わらない）。
 */
const packageZones = [
  {
    target: 'packages/core',
    from: ['packages/ui-shared', 'packages/ui-desktop', 'apps'], // <!-- req webcorefoundation:5ec6142c.de43 -->
    message: 'packages/core から ui-shared・ui-desktop・apps へは入れません（パッケージの依存の向き、5.2 節）。',
  },
  {
    target: 'packages/ui-shared',
    from: ['packages/ui-desktop', 'apps'],
    message:
      'packages/ui-shared から ui-desktop・apps へは入れません（中身は入れ物を import しない、2.2 節の表・5.2 節）。',
  },
  {
    target: 'packages/ui-desktop',
    from: ['apps'],
    message: 'packages/ui-desktop から apps へは入れません（パッケージの依存の向き、5.2 節）。',
  },
  // <!-- req webcorefoundation:a526d15b.edc2 -->
  {
    target: 'packages/shared-types',
    from: ['packages/core', 'packages/ui-shared', 'packages/ui-desktop', 'apps'],
    message: 'packages/shared-types は、ほかのパッケージへ入れません（2.2 節の表の L4 の行・5.2 節）。',
  },
];

/** testing（開発用のサンプルと偽物）は、製品のコードのどこからも import しない（2.1 節・2.2 節、honnin-queue 178 番）。core の層のフォルダの分は下の層の区域に入れてある。 */
const testingZone = {
  target: [CORE_INDEX, 'packages/ui-shared', 'packages/ui-desktop', 'apps'],
  from: [coreDir('testing')],
  message: 'packages/core/src/testing は、製品のコードから import できません（テストのファイルからだけ使う、2.1 節）。',
};

// <!-- req webcorefoundation:31412657.c715 --> <!-- req webcorefoundation:31412657.b6e1 --> <!-- req webcorefoundation:31412657.93b4 -->
/**
 * packages/core/src の層ごとの区域。import してよい先（2.2 節の表）の外にある層のフォルダと、core の index.ts を止める。
 * 同じ層の中（L1 どうし・L2 どうし）の import は止めない。お互いに頼り合う import は下の import-x/no-cycle で止める。
 * @param {string[]} folders この層のフォルダ
 * @param {string[]} forbidden import してはいけないフォルダ
 * @param {string} label エラーの文に出す層の名前
 */
const layerZone = (folders, forbidden, label) => ({
  target: folders.map(coreDir),
  from: [...forbidden.map(coreDir), CORE_INDEX],
  message: `${label} から ${forbidden.join('・')} と packages/core の index.ts は import できません（web-core-foundation.md 2.2 節の層どうしの向きの表）。`,
});

const allCoreFolders = [...Object.values(CORE_LAYERS).flat(), ...CORE_FOLDERS_WITHOUT_LAYER];
const except = (...keep) => allCoreFolders.filter((f) => !keep.includes(f));

// 2.2 節の層どうしの向きの表。下の層から上の層へは import しない（L1 → L2 → L3 → L4）。
const layerZones = [
  // <!-- req webcorefoundation:b790063b.e597 --> <!-- req webcorefoundation:b790063b.6712 --> <!-- req webcorefoundation:b790063b.5d52 --> <!-- req webcorefoundation:b790063b.a74c -->
  // L1（ui・rendering・viewmodes）は L2・L3・L4・errors を import してよいので、層のフォルダは testing だけを止める。
  layerZone(CORE_LAYERS.L1, [...CORE_FOLDERS_WITHOUT_LAYER], 'L1（ui・rendering・viewmodes）'),
  // <!-- req webcorefoundation:3f49f8ee.8d97 --> <!-- req webcorefoundation:3f49f8ee.4230 --> <!-- req webcorefoundation:03b99b93.d7f6 --> <!-- req webcorefoundation:03b99b93.1110 --> <!-- req webcorefoundation:9c6c3c07.8cb6 --> <!-- req webcorefoundation:9c6c3c07.1110 -->
  // <!-- req webcorefoundation:7bf1f0cc.fa76 --> <!-- req webcorefoundation:7bf1f0cc.43e1 --> <!-- req webcorefoundation:7bf1f0cc.83ce -->
  layerZone(
    CORE_LAYERS.L2,
    [...CORE_LAYERS.L1, ...CORE_FOLDERS_WITHOUT_LAYER],
    'L2（editing・playback・export・persistence・parts）',
  ),
  // <!-- req webcorefoundation:c8986586.ec21 --> <!-- req webcorefoundation:c8986586.dbe8 --> <!-- req webcorefoundation:c8986586.ffdb -->
  layerZone(CORE_LAYERS.L3, [...CORE_LAYERS.L1, ...CORE_LAYERS.L2, ...CORE_FOLDERS_WITHOUT_LAYER], 'L3（domain）'),
  // L4 が import してよいのは packages/shared-types だけ（L5 が L4 のインターフェースを実装して注入する。AD-3 の依存性逆転）。
  // errors も通す（2.1 節「どの層から使ってもよく」と 2.2 節の表の L4 の行、honnin-queue 178 番）。
  // <!-- req webcorefoundation:a526d15b.e1b4 --> <!-- req webcorefoundation:a526d15b.1435 --> <!-- req webcorefoundation:78eb81f7.1a67 -->
  layerZone(CORE_LAYERS.L4, except(...CORE_LAYERS.L4, ...CORE_LAYERS.errors), 'L4（platform）'),
  // <!-- req webcorefoundation:a526d15b.7849 -->
  // errors はどの層から使ってもよく、errors からは packages/shared-types のほかを import しない。
  // <!-- req webcorefoundation:5c6a79d0.8baf --> <!-- req webcorefoundation:78eb81f7.b993 -->
  layerZone(CORE_LAYERS.errors, except(...CORE_LAYERS.errors), 'errors'),
];

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
      // <!-- req webcorefoundation:e40c40ec.74f9 --> <!-- req webcorefoundation:e40c40ec.ea88 --> <!-- req webcorefoundation:e40c40ec.dc58 --> <!-- req webcorefoundation:e40c40ec.896d --> <!-- req webcorefoundation:e40c40ec.9719 -->
    },
  },
  {
    // import-x の規則（no-restricted-paths・no-cycle）が import を解くための設定。
    // 拡張子を書かない相対パス（`../domain/types`）を .ts・.tsx へ解き、フォルダの import は package.json の types を先に見る
    // （TypeScript の moduleResolution: bundler と同じ解き方。`../..` が packages/core の index.ts に解ける）。
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
          mainFields: ['types', 'module', 'main'],
        }),
      ],
    },
  },
  {
    // 製品のコードの区域：パッケージの依存の向き・testing・層のフォルダどうしの向き（2.2 節の表）。
    // テストは偽物（testing）やほかの層のエラーのクラスで場面を作るので、層のフォルダどうしと testing の区域は製品のコードだけに当てる。
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        { basePath: REPO_ROOT, zones: [...packageZones, testingZone, ...layerZones] },
      ],
    },
  },
  {
    // Webコア（packages/*）のテストのファイルには、パッケージの依存の向きの区域だけを当てる（2.2 節、honnin-queue 178 番）。
    // electron・expo-*・Node.js・apps・react の禁止は、上の core の塊と下の ui-shared・ui-desktop・shared-types の塊で当たる。
    files: ['packages/**/*.test.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': ['error', { basePath: REPO_ROOT, zones: packageZones }],
    },
  },
  {
    // お互いに頼り合う import（A → B → A。間に別のファイルを挟む形も含む）を、Webコアでも L5（apps）でも止める（2.2 節、honnin-queue 178 番）。
    // 組み込みの no-restricted-imports は 1 つの import しか見ないので、import-x/no-cycle を使う。ほかのパッケージ（node_modules）の中はたどらない。
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    rules: {
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      // <!-- req webcorefoundation:3f49f8ee.7641 --> <!-- req webcorefoundation:3f49f8ee.d154 --> <!-- req webcorefoundation:3f49f8ee.a3ef --> <!-- req webcorefoundation:8ec5dbd1.3014 --> <!-- req webcorefoundation:8ec5dbd1.af3b --> <!-- req webcorefoundation:8ec5dbd1.8603 -->
    },
  },
  {
    // PC 版・iPhone 版・iPad 版で共通の画面の中身。core と同じ禁止に加え、入れ物（ui-desktop）を import しない
    // <!-- req webcorefoundation:a08c965a.c3cd --> <!-- req webcorefoundation:feca276f.fde2 --> <!-- req webcorefoundation:a08c965a.4917 -->
    // <!-- req webcorefoundation:403daace.de3b --> <!-- req webcorefoundation:403daace.6dcc --> <!-- req webcorefoundation:b790063b.66fb --> <!-- req webcorefoundation:b790063b.bdb1 --> <!-- req webcorefoundation:5bd19fd8.4daa --> <!-- req webcorefoundation:42aa18eb.da46 -->
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
    // <!-- req webcorefoundation:5bd19fd8.a232 --> <!-- req webcorefoundation:b790063b.2e8a --> <!-- req webcorefoundation:42aa18eb.fff5 -->
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
    // apps・ビルドの構成（8.4 節）を import しない（2.2 節の表の L4 の行）。相対パスでほかのパッケージへ入る形は上の区域で止める
    files: ['packages/shared-types/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({
        paths: nodeBuiltinRestrictedPaths('packages/shared-types'),
        patterns: [
          ...platformRestrictedPatterns('packages/shared-types'),
          sharedTypesRestrictedPattern,
          reactRestrictedPattern,
          ...buildToolRestrictedPatterns,
        ],
      }),
    },
  },
  {
    // ラッパーのソースはビルドの構成を import しない（8.4 節）。L5 は L1〜L4・errors・electron を import してよい（2.2 節）
    // <!-- req webcorefoundation:e6c5a6ed.e7bb --> <!-- req webcorefoundation:e6c5a6ed.a14b --> <!-- req webcorefoundation:e6c5a6ed.e2f0 --> <!-- req webcorefoundation:e6c5a6ed.f4b0 -->
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({ paths: networkRestrictedPaths, patterns: buildToolRestrictedPatterns }),
    },
  },
  {
    // preload はレンダラーへの橋渡しのみ。Webコア・fs へ依存させない。通信の禁止は上の塊と同じものを入れ直す（塊は足し合わない）
    // 2.2 節の L5 の行：preload は packages/shared-types と electron だけを import する（3.1 節） <!-- req webcorefoundation:e6c5a6ed.2f5d -->
    files: ['apps/desktop/src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({
        paths: networkRestrictedPaths,
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
    // テストは any と console を使ってよい。Webコア（packages/*）のテストにも electron・expo-*・Node.js・apps・react の禁止は
    // そのまま当て、層のフォルダどうしの区域だけを外す（上の製品のコードの区域の ignores。2.2 節、honnin-queue 178 番）。
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // ラッパー（apps）のテストは、一時フォルダの読み書きに Node.js を使い、ビルドの構成の確かめに ESLint を呼ぶので、
    // ほかの名前の禁止は外す。通信の禁止（6.2 節）とビルドの構成の禁止（8.4 節）は apps/desktop/src/** のテストのファイルにもかける
    files: ['apps/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted({ paths: networkRestrictedPaths, patterns: buildToolRestrictedPatterns }),
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
