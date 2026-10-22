// UT-DEV-LAYER: web-core-foundation.md §2.2 — リポジトリ直下の eslint.config.js の依存の向きの規則（no-restricted-imports と import-x の no-restricted-paths）
// 検証観点: 2.2 節の層どうしの向きの表の全部の向きで、禁止の import がエラーになり、許す import が通ること。
// あわせて 5.1 節・5.2 節・8.4 節の禁止（electron・expo-*・Node.js の組み込みモジュール・apps/**・ui-desktop・react・ビルドの構成）。
// 実物の設定を ESLint に読ませ、置き場所ごとに 1 行の import を渡してエラーを数える（リポジトリにファイルは作らない）。
// no-restricted-paths は import を解いた先で見るので、相対パスの import 先は実在のファイル（各フォルダの index.ts など）にする。

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

/** `file`（リポジトリからの場所）に `import x from '<spec>'` の 1 行を置いたとき、依存の向きの規則のエラーが出るか。 */
async function blocked(file: string, spec: string): Promise<boolean> {
  const [result] = await eslint.lintText(`import x from '${spec}';\nexport default x;\n`, {
    filePath: join(repoRoot, file),
  });
  return (result?.messages ?? []).some(
    (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'import-x/no-restricted-paths',
  );
}

type Case = readonly [file: string, spec: string];

/** 期待（止める・通す）と合わなかった import の並び。空なら全部が期待どおり。 */
async function mismatches(wantBlocked: boolean, cases: readonly Case[]): Promise<Case[]> {
  const wrong: Case[] = [];
  for (const c of cases) if ((await blocked(c[0], c[1])) !== wantBlocked) wrong.push(c);
  return wrong;
}

const CORE = 'packages/core/src/ui/X.ts';
const UI_SHARED = 'packages/ui-shared/src/X.tsx';
const UI_DESKTOP = 'packages/ui-desktop/src/X.tsx';
const MAIN = 'apps/desktop/src/main/X.ts';

describe('Webコア 3 パッケージのプラットフォームの禁止（turn 173 の手の確かめ 32 通り）', () => {
  // 置き場所 4 × import 8。turn 173 に ESLint へ 1 行ずつ渡して確かめた表をそのまま固定する
  const specs = [
    'electron',
    'expo-av',
    'node:fs/promises',
    'path',
    'fs/promises',
    '@riff-line/ui-desktop',
    '../domain/types',
    '../apps/desktop/x',
  ] as const;

  it('packages/core/src_ui-desktopを含め相対パス以外は止める', async () => {
    // UT-DEV-LAYER-01 §5.2・§5.1
    expect(
      await mismatches(
        true,
        specs.filter((s) => s !== '../domain/types').map((s) => [CORE, s] as const),
      ),
    ).toEqual([]);
    expect(await mismatches(false, [[CORE, '../domain/types']])).toEqual([]);
  });

  it('packages/ui-shared/src_ui-desktopを含め相対パス以外は止める', async () => {
    // UT-DEV-LAYER-02 §5.2・§2.2「packages/ui-shared は packages/ui-desktop を import しない」
    expect(
      await mismatches(
        true,
        specs.filter((s) => s !== '../domain/types').map((s) => [UI_SHARED, s] as const),
      ),
    ).toEqual([]);
    expect(await mismatches(false, [[UI_SHARED, '../domain/types']])).toEqual([]);
  });

  it('packages/ui-desktop/src_ui-desktop自身と相対パスは通す', async () => {
    // UT-DEV-LAYER-03 §5.2
    expect(
      await mismatches(
        true,
        specs
          .filter((s) => s !== '../domain/types' && s !== '@riff-line/ui-desktop')
          .map((s) => [UI_DESKTOP, s] as const),
      ),
    ).toEqual([]);
    expect(
      await mismatches(false, [
        [UI_DESKTOP, '@riff-line/ui-desktop'],
        [UI_DESKTOP, '../domain/types'],
      ]),
    ).toEqual([]);
  });

  it('apps/desktop/src/main_8通りとも通す', async () => {
    // UT-DEV-LAYER-04 §2.2 の表の L5 の行（electron を import してよい）
    expect(
      await mismatches(
        false,
        specs.map((s) => [MAIN, s] as const),
      ),
    ).toEqual([]);
  });
});

describe('組み込みモジュールの名前が相対パスに当たらない', () => {
  it('domain・constants・stream_相対パスは通し名前そのものは止める', async () => {
    // UT-DEV-LAYER-05 turn 173 の取り違え（組み込みモジュールの名前を patterns に入れると ../domain/types にも当たった）
    expect(
      await mismatches(false, [
        ['packages/core/src/editing/X.ts', '../domain/types'],
        ['packages/core/src/ui/X.ts', './constants'],
        ['packages/core/src/playback/X.ts', '../domain/stream'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(true, [
        ['packages/core/src/editing/X.ts', 'domain'],
        ['packages/core/src/ui/X.ts', 'constants'],
        ['packages/core/src/playback/X.ts', 'stream'],
      ]),
    ).toEqual([]);
  });
});

describe('2.2 節の層どうしの向きの表', () => {
  it('L1_L2・L3・L4・errorsを通しReactは止める', async () => {
    // UT-DEV-LAYER-06 §2.2 の表の L1 の行。React を import してよいのは ui-desktop と ui-shared だけ
    for (const file of ['packages/core/src/ui/X.ts', 'packages/core/src/rendering/X.ts']) {
      expect(
        await mismatches(
          false,
          [
            '../editing/index',
            '../playback/index',
            '../export/index',
            '../domain/index',
            '../platform/index',
            '../errors/index',
            '@riff-line/shared-types',
          ].map((s) => [file, s] as const),
        ),
      ).toEqual([]);
      expect(
        await mismatches(true, [
          [file, 'react'],
          [file, 'react-dom/client'],
        ]),
      ).toEqual([]);
    }
    expect(
      await mismatches(false, [
        [UI_SHARED, 'react'],
        [UI_DESKTOP, 'react'],
        [UI_DESKTOP, 'react-dom/client'],
        [UI_SHARED, '@riff-line/core'],
        [UI_DESKTOP, '@riff-line/ui-shared'],
      ]),
    ).toEqual([]);
  });

  it('L2_L3・L4・errorsを通しL1は止める', async () => {
    // UT-DEV-LAYER-07 §2.2 の表の L2 の行・「下の層は上の層を import しない」
    for (const file of [
      'packages/core/src/editing/commands/X.ts',
      'packages/core/src/playback/X.ts',
      'packages/core/src/export/X.ts',
    ]) {
      const up = file.includes('/commands/') ? '../../' : '../';
      expect(
        await mismatches(
          false,
          ['domain/index', 'platform/index', 'errors/index'].map((s) => [file, `${up}${s}`] as const),
        ),
      ).toEqual([]);
      expect(
        await mismatches(
          true,
          ['ui/index', 'rendering/index', 'ui'].map((s) => [file, `${up}${s}`] as const),
        ),
      ).toEqual([]);
    }
  });

  it('L3_L4・errors・shared-typesを通しL1・L2は止める', async () => {
    // UT-DEV-LAYER-08 §2.2 の表の L3 の行
    const file = 'packages/core/src/domain/X.ts';
    expect(
      await mismatches(false, [
        [file, '../platform/index'],
        [file, '../errors/index'],
        [file, '@riff-line/shared-types'],
        [file, './SongDocument'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(
        true,
        ['../ui/index', '../rendering/index', '../editing/index', '../playback/index', '../export/index'].map(
          (s) => [file, s] as const,
        ),
      ),
    ).toEqual([]);
  });

  it('L4_shared-typesとerrorsだけを通す', async () => {
    // UT-DEV-LAYER-09 §2.2 の表の L4 の行（L5 は import しない。AD-3 の依存性逆転）。errors は 2.1 節「どの層から使ってもよく」で通す
    const file = 'packages/core/src/platform/X.ts';
    expect(
      await mismatches(false, [
        [file, '@riff-line/shared-types'],
        [file, './errors'],
        [file, '../errors/index'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(
        true,
        [
          '../ui/index',
          '../rendering/index',
          '../editing/index',
          '../playback/index',
          '../export/index',
          '../domain/index',
          '../persistence/index',
          '@riff-line/desktop',
        ].map((s) => [file, s] as const),
      ),
    ).toEqual([]);
  });

  it('errors_shared-typesだけを通す', async () => {
    // UT-DEV-LAYER-10 §2.2 の表の errors の行・2.1 節「errors からはほかの層を import しない」
    const file = 'packages/core/src/errors/X.ts';
    expect(
      await mismatches(false, [
        [file, '@riff-line/shared-types'],
        [file, './Logger'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(
        true,
        ['../ui/index', '../editing/index', '../domain/index', '../platform/index', '../persistence/index'].map(
          (s) => [file, s] as const,
        ),
      ),
    ).toEqual([]);
  });

  it('層のフォルダからcoreのindexを止める', async () => {
    // UT-DEV-LAYER-11 core の index.ts は全部の層を引き込むので、層の向きを越える
    for (const spec of ['..', '../index', '../..'])
      expect(await mismatches(true, [['packages/core/src/domain/X.ts', spec]])).toEqual([]);
  });

  it('L5_L1からL4・errors・electronを通す', async () => {
    // UT-DEV-LAYER-12 §2.2 の表の L5 の行
    expect(
      await mismatches(
        false,
        [
          '@riff-line/ui-desktop',
          '@riff-line/core',
          '@riff-line/core/errors',
          '@riff-line/shared-types',
          'electron',
        ].map((s) => [MAIN, s] as const),
      ),
    ).toEqual([]);
  });
});

describe('ほかの禁止', () => {
  it('core_ui-sharedを止める', async () => {
    // UT-DEV-LAYER-13 §5.2「依存の向きは ui-shared → core」
    expect(await mismatches(true, [[CORE, '@riff-line/ui-shared']])).toEqual([]);
  });

  it('ビルドの構成_packagesとapps/desktop/srcから止める', async () => {
    // UT-DEV-LAYER-14 §8.4「packages/** と apps/desktop/src/** からの electron-vite と Electron Builder のパッケージの import の禁止」
    for (const file of [
      CORE,
      UI_SHARED,
      UI_DESKTOP,
      'packages/shared-types/src/X.ts',
      MAIN,
      'apps/desktop/src/renderer/X.tsx',
      'apps/desktop/src/preload/X.ts',
    ]) {
      expect(
        await mismatches(
          true,
          ['electron-vite', 'electron-builder', '../../electron.vite.config'].map((s) => [file, s] as const),
        ),
      ).toEqual([]);
    }
  });

  it('preload_coreとfsを止めelectronを通す', async () => {
    // UT-DEV-LAYER-15 6.1 節の preload の持つもの（今の規則を固定する）
    const file = 'apps/desktop/src/preload/X.ts';
    expect(
      await mismatches(true, [
        [file, '@riff-line/core'],
        [file, 'node:fs'],
      ]),
    ).toEqual([]);
    expect(await mismatches(false, [[file, 'electron']])).toEqual([]);
  });

  // UT-DEV-LAYER-16 は欠番（turn 174 に「テストのファイルには規則を当てない」から 18 番の形へ変えた）

  it('Webコアのテスト_プラットフォームの禁止は当て層のフォルダの禁止は当てない', async () => {
    // UT-DEV-LAYER-18 §1「packages/core・packages/ui-shared・packages/ui-desktop の中での electron・expo-*・Node.js の組み込みモジュール・apps/** の import」
    const tests = [
      'packages/core/src/domain/X.test.ts',
      'packages/ui-shared/src/X.test.tsx',
      'packages/ui-desktop/src/X.test.tsx',
    ];
    expect(
      await mismatches(
        true,
        tests.flatMap((file) =>
          ['electron', 'expo-av', 'node:fs/promises', 'fs', '../apps/desktop/x'].map((s) => [file, s] as const),
        ),
      ),
    ).toEqual([]);
    // 偽物（testing）やほかの層のエラーのクラスで場面を作るのは通す（層のフォルダの禁止は製品のコードだけ）
    expect(
      await mismatches(false, [
        ['packages/core/src/errors/X.test.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/errors/X.test.ts', '../platform/errors'],
      ]),
    ).toEqual([]);
    // ラッパー（apps）のテストは Node.js と ESLint を使ってよい
    expect(await mismatches(false, [['apps/desktop/src/dev/X.test.ts', 'eslint']])).toEqual([]);
  });

  it('shared-types_ほかのパッケージとプラットフォーム固有のものを止める', async () => {
    // UT-DEV-LAYER-19 §2.2 の表の L4 の行「packages/shared-types」（shared-types も L4）
    const file = 'packages/shared-types/src/X.ts';
    expect(
      await mismatches(
        true,
        [
          '@riff-line/core',
          '@riff-line/ui-shared',
          '@riff-line/ui-desktop/x',
          '@riff-line/desktop',
          'electron',
          'node:fs',
          'react',
        ].map((s) => [file, s] as const),
      ),
    ).toEqual([]);
    // 相対パスでほかのパッケージへ入る形も止める
    expect(
      await mismatches(true, [
        [file, '../../core/src/ui/index'],
        [file, '../../ui-desktop/src/index'],
      ]),
    ).toEqual([]);
    expect(await mismatches(false, [[file, './index']])).toEqual([]);
  });

  it('core_自分のパッケージ名でのimportを止める', async () => {
    // UT-DEV-LAYER-20 §2.2「下の層は上の層を import しない」を、@riff-line/core/ui の形で通り抜けさせない
    expect(
      await mismatches(true, [
        ['packages/core/src/domain/X.ts', '@riff-line/core/ui'],
        ['packages/core/src/editing/X.ts', '@riff-line/core'],
      ]),
    ).toEqual([]);
  });
});

/** `file` に `import x from '<spec>'` の 1 行を置いたとき、お互いに頼り合う import（import-x/no-cycle）のエラーが出るか。 */
async function cycles(file: string, spec: string): Promise<boolean> {
  const [result] = await eslint.lintText(`import x from '${spec}';\nexport default x;\n`, {
    filePath: join(repoRoot, file),
  });
  return (result?.messages ?? []).some((m) => m.ruleId === 'import-x/no-cycle');
}

describe('層の無かった 4 つのフォルダと同じ層の中（honnin-queue 178 番）', () => {
  it('4つのフォルダ_viewmodesはL1・persistenceとpartsはL2・testingは製品のコードから止める', async () => {
    // UT-DEV-LAYER-21 §2.1 の表の viewmodes・persistence・parts・testing の行、§2.2「testing は製品のコードのどの層からも import しない」
    expect(
      await mismatches(false, [
        ['packages/core/src/viewmodes/X.ts', '../editing/index'],
        ['packages/core/src/viewmodes/X.ts', '../persistence/index'],
        ['packages/core/src/viewmodes/X.ts', '../parts/index'],
        ['packages/core/src/viewmodes/X.ts', '../domain/index'],
        ['packages/core/src/persistence/X.ts', '../domain/index'],
        ['packages/core/src/parts/X.ts', '../platform/index'],
        ['packages/core/src/parts/X.ts', '../errors/index'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(true, [
        // L2 から L1 の viewmodes へは上り
        ['packages/core/src/persistence/X.ts', '../viewmodes/index'],
        ['packages/core/src/parts/X.ts', '../viewmodes/index'],
        ['packages/core/src/editing/X.ts', '../viewmodes/index'],
        ['packages/core/src/persistence/X.ts', '../ui/index'],
        // L3 から L2 の persistence・parts と L1 の viewmodes へも上り
        ['packages/core/src/domain/X.ts', '../persistence/index'],
        ['packages/core/src/domain/X.ts', '../parts/index'],
        ['packages/core/src/domain/X.ts', '../viewmodes/index'],
        // testing は製品のコードのどの層からも止める
        ['packages/core/src/ui/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/viewmodes/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/editing/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/persistence/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/domain/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/platform/X.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/errors/X.ts', '../testing/FakeFileSystemAdapter'],
      ]),
    ).toEqual([]);
  });

  it('同じ層の中_別のフォルダへのimportを通す', async () => {
    // UT-DEV-LAYER-22 §2.2「同じ層の中の import はしてよい（同じ層の別のフォルダへの import も含む）」
    expect(
      await mismatches(false, [
        ['packages/core/src/editing/X.ts', '../persistence/index'],
        ['packages/core/src/editing/X.ts', '../parts/index'],
        ['packages/core/src/persistence/X.ts', '../editing/index'],
        ['packages/core/src/parts/X.ts', '../playback/index'],
        ['packages/core/src/playback/X.ts', '../export/index'],
        ['packages/core/src/ui/X.ts', '../viewmodes/index'],
        ['packages/core/src/viewmodes/X.ts', '../rendering/index'],
        ['packages/core/src/rendering/X.ts', '../ui/index'],
      ]),
    ).toEqual([]);
  });

  it('お互いに頼り合うimport_直接も間に1つ挟む形も止め頼り合わない形は通す', async () => {
    // UT-DEV-LAYER-23 §2.2「お互いに頼り合う import（間に別のファイルを挟む形も含む）はしない」・ESLint の import-x/no-cycle
    // 実在のつながり SongDocument.ts → checksum.ts → sha256.ts の側に、戻りの import を 1 行置く（ファイルは作らない）
    expect(await cycles('packages/core/src/domain/checksum.ts', './SongDocument')).toBe(true);
    expect(await cycles('packages/core/src/domain/sha256.ts', './SongDocument')).toBe(true);
    expect(await cycles('packages/core/src/domain/sha256.ts', './checksum')).toBe(true);
    // 戻らない向き（SongDocument から checksum、sha256 から types）は通す
    expect(await cycles('packages/core/src/domain/SongDocument.ts', './checksum')).toBe(false);
    expect(await cycles('packages/core/src/domain/sha256.ts', './types')).toBe(false);
  });

  it('Webコアのテスト_層のフォルダの禁止は外しプラットフォームとreactの禁止は当てる', async () => {
    // UT-DEV-LAYER-24 §2.2「層のフォルダどうしの禁止は製品のコードだけにかけ…テストのファイルにもかける」
    expect(
      await mismatches(false, [
        ['packages/core/src/domain/X.test.ts', '../ui/index'],
        ['packages/core/src/domain/X.test.ts', '../persistence/index'],
        ['packages/core/src/platform/X.test.ts', '../testing/FakeFileSystemAdapter'],
        ['packages/core/src/persistence/X.test.ts', '../viewmodes/index'],
        ['packages/core/src/errors/X.test.ts', '../editing/index'],
      ]),
    ).toEqual([]);
    expect(
      await mismatches(true, [
        ['packages/core/src/platform/X.test.ts', 'react'],
        ['packages/core/src/viewmodes/X.test.ts', 'electron'],
        ['packages/core/src/persistence/X.test.ts', 'node:fs'],
        ['packages/core/src/parts/X.test.ts', 'expo-av'],
        ['packages/core/src/testing/X.test.ts', '../../../../apps/desktop/x'],
      ]),
    ).toEqual([]);
  });
});

describe('相対パスの書き方を変えたすり抜け（turn 175 の照合）', () => {
  it('srcやcoreの外へ出てから戻る形と相対パスでほかのパッケージへ入る形を止める', async () => {
    // UT-DEV-LAYER-25 §2.2「下の表に無い向きはすべて禁止」・5.2 節のパッケージの依存の向き
    expect(
      await mismatches(true, [
        ['packages/core/src/domain/X.ts', '../../src/ui/index'],
        ['packages/core/src/domain/X.ts', '../../../core/src/editing/index'],
        ['packages/core/src/platform/X.ts', '../../src/editing/index'],
        ['packages/core/src/errors/X.ts', '../../src/domain/types'],
        ['packages/core/src/persistence/X.ts', './../ui/index'],
        ['packages/core/src/editing/X.ts', '../../../ui-desktop/src/index'],
        ['packages/core/src/domain/X.ts', '../../../ui-shared/src/index'],
        ['packages/ui-shared/src/X.tsx', '../../ui-desktop/src/index'],
      ]),
    ).toEqual([]);
    // 同じ層の中と、上の層から下の層へは、同じ書き方でも通す
    expect(
      await mismatches(false, [
        ['packages/core/src/editing/X.ts', '../../src/persistence/index'],
        ['packages/core/src/ui/X.ts', '../../src/domain/index'],
        ['packages/core/src/domain/X.ts', '../../src/domain/types'],
        ['packages/ui-desktop/src/X.tsx', '../../ui-shared/src/index'],
      ]),
    ).toEqual([]);
  });
});

describe('解いた先のファイルの場所で向きを見る（turn 176、import-x の no-restricted-paths）', () => {
  it('turn175で止まらなかった書き方_どれも解いた先の場所で止める', async () => {
    // UT-DEV-LAYER-27 §2.2「下の表に無い向きはすべて禁止」「testing は製品のコードのどの層からも import しない」・5.2 節のパッケージの依存の向き
    expect(
      await mismatches(true, [
        // いったん自分のフォルダへ戻ってから上の層へ入る形
        ['packages/core/src/domain/X.ts', '../domain/../ui'],
        ['packages/core/src/persistence/X.ts', '../domain/../viewmodes/index'],
        // リポジトリの根まで出てから packages/ に入り直す形
        ['packages/core/src/domain/X.ts', '../../../../packages/core/src/ui/index'],
        ['packages/core/src/errors/X.ts', '../../../../packages/core/src/platform'],
        // ui-shared・ui-desktop・apps から core/src/testing へ入る形
        ['packages/ui-shared/src/X.tsx', '../../core/src/testing/FakeFileSystemAdapter'],
        ['packages/ui-desktop/src/X.tsx', '../../core/src/testing/FakeFileSystemAdapter'],
        ['apps/desktop/src/main/X.ts', '../../../../packages/core/src/testing/FakeFileSystemAdapter'],
        ['apps/desktop/src/renderer/X.tsx', '../../../../packages/core/src/testing/editingFakes'],
        // shared-types から ./../ で core へ入る形（フォルダの import は package.json の types で index.ts に解ける）
        ['packages/shared-types/src/X.ts', './../../core/src/domain/index'],
        ['packages/shared-types/src/X.ts', './../../core'],
        // core から ./../ で ui-shared へ入る形
        ['packages/core/src/ui/X.ts', './../../../ui-shared/src/index'],
      ]),
    ).toEqual([]);
    // 同じ書き方でも、上の層から下の層へ・L5 から Webコアへは通す
    expect(
      await mismatches(false, [
        ['packages/core/src/ui/X.ts', '../ui/../domain/index'],
        ['packages/core/src/editing/X.ts', '../../../../packages/core/src/domain/types'],
        ['apps/desktop/src/main/X.ts', '../../../../packages/core/src/domain/index'],
        ['packages/core/src/testing/X.ts', '../domain/types'],
      ]),
    ).toEqual([]);
  });

  it('区域を当てるのは解けるimportだけ_止まった理由がno-restricted-pathsであること', async () => {
    // UT-DEV-LAYER-28 §2.2 (b)「解いた先のファイルの場所で見る」。名前の規則（no-restricted-imports）で止まったのではないことを確かめる
    const [result] = await eslint.lintText(`import x from '../domain/../ui';\nexport default x;\n`, {
      filePath: join(repoRoot, 'packages/core/src/domain/X.ts'),
    });
    const rules = (result?.messages ?? []).map((m) => m.ruleId);
    expect(rules).toContain('import-x/no-restricted-paths');
    expect(rules).not.toContain('no-restricted-imports');
  });
});

describe('リポジトリの形', () => {
  it('shared-types_アダプタとサービスのインターフェースを置かない', () => {
    // UT-DEV-LAYER-26 §3.1「4 つとも packages/core/src/platform に置く」・5.1 節「shared-types には…型の定義だけ」
    // （turn 175 に、shared-types に残っていた FileSystemAdapter・WindowAdapter・AppLocalConfigService を移した）
    const text = readFileSync(join(repoRoot, 'packages', 'shared-types', 'src', 'index.ts'), 'utf8');
    expect(text.match(/export interface \w+(Adapter|AdapterFactory|Service)\b/g) ?? []).toEqual([]);
    for (const name of [
      'FileSystemAdapter',
      'AudioSessionAdapter',
      'WindowAdapter',
      'UpdateCheckAdapter',
      'PlatformAdapters',
    ])
      expect(existsSync(join(repoRoot, 'packages', 'core', 'src', 'platform', `${name}.ts`))).toBe(true);
  });

  it('リポジトリ直下にtools/が無い', () => {
    // UT-DEV-LAYER-17 §5.1「そのための tools/ はリポジトリに設けない」（turn 173 で外したものが戻らないように）
    expect(existsSync(join(repoRoot, 'tools'))).toBe(false);
    expect(existsSync(join(repoRoot, 'eslint.config.js'))).toBe(true);
  });
});
