// UT-DEV-I18N: web-core-foundation.md 14.4 節（採番簿の UT-DEV-I18N の行）— 文言の見張り（apps/desktop/src/dev/i18nGuard.ts）
// 検証節: editing-core.md 2.2 節 (b)「文言が 2 か所の外に無いことは、単体テスト apps/desktop/src/dev/i18nGuard.test.ts で見張る」
// 検証観点: コメントの中の日本語は通し、文字列のリテラル（テンプレートリテラルの文字の部分と JSX の地の文字を含む）の中は見つける。
// ログの文（console.* の引数）と例外の文（Error とその子のクラスの引数）は数えない（editing-core.md 2.2 節 (b)、237 番）。
// 保存の部品の console.warn の包み warnProvisional の引数もログの文として数えない（同じ節、242 番）。
// テストのファイルと *ErrorCodes.ts は見ない。リポジトリの実物で、決まるまでの例外の外に日本語の文字列が無いこと。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findI18nViolations,
  findJapaneseLiterals,
  hasJapanese,
  isErrorCodesFile,
  isScannedFile,
  isTestFile,
  listScannedFiles,
} from './i18nGuard';

/** リポジトリの直下。 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * 決まるまでの例外。設計書は *ErrorCodes.ts だけを除くと決めている。honnin-queue 237 番が決まるまでの例外。
 * ここに載ったファイルは、日本語の文字列のリテラルを今も持っていること（消えたら一覧から外す）を下のテストで確かめる。
 */
const PENDING_EXCEPTIONS: readonly string[] = [
  'apps/desktop/src/main/ipcPayload.ts', // 作業パッケージ 1（Webコア基盤構築）
  'apps/desktop/src/renderer/App.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/Dialogs.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/EditWindowShell.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/ExportPrintDialogs.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/NewSongWizard.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/OnboardingOverlay.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/Panels.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/SongListView.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'apps/desktop/src/renderer/screens/common.tsx', // 作業パッケージ 8（画面群・ナビゲーション）
  'packages/core/src/parts/TuningPresetService.ts', // 作業パッケージ 5（パート・チューニング管理）
  'packages/core/src/persistence/SongIndexService.ts', // 作業パッケージ 2（データモデル・永続化）
  'packages/core/src/persistence/SongRepository.ts', // 作業パッケージ 2（データモデル・永続化）
  'packages/core/src/testing/scoreFixtures.ts', // 作業パッケージ 1（Webコア基盤構築）
  'packages/core/src/ui/MenuBarController.ts', // 作業パッケージ 8（画面群・ナビゲーション）
];

describe('日本語の文字の見分け', () => {
  // UT-DEV-I18N-01 hasJapanese_ひらがな・カタカナ・漢字・長音を見つけ英数字と記号は通す
  it('hasJapanese_ひらがな・カタカナ・漢字・長音を見つけ英数字と記号は通す', () => {
    for (const text of ['ほ', 'カ', '譜', 'ー', 'Save 保存', 'ｶﾅ']) expect(hasJapanese(text), text).toBe(true);
    for (const text of ['save', 'EDIT-001', '{code}: x', '→ ・ …', '', 'Ǣ é ü'])
      expect(hasJapanese(text), text).toBe(false);
  });
});

describe('文字列のリテラルとコメントの見分け（TypeScript の構文解析）', () => {
  // UT-DEV-I18N-02 findJapaneseLiterals_コメントの中の日本語は通す
  it('findJapaneseLiterals_コメントの中の日本語は通す', () => {
    const source = [
      '// 行のコメントの日本語',
      '/* 囲みのコメントの日本語 */',
      '/** 説明の注の日本語 */',
      "export const a = 'save'; // 後ろのコメント",
      'export const b = /* 式の中のコメント */ "ok";',
    ].join('\n');
    expect(findJapaneseLiterals('x.ts', source)).toEqual([]);
  });

  // UT-DEV-I18N-03 findJapaneseLiterals_文字列のリテラルとテンプレートリテラルの文字の部分は見つける
  it('findJapaneseLiterals_文字列のリテラルとテンプレートリテラルの文字の部分は見つける', () => {
    const tick = '`';
    const source = [
      "export const a = '保存';",
      'export const b = "開く";',
      `export const c = ${tick}閉じる${tick};`,
      `export const d = (n: number) => ${tick}頭\${n}中\${n}尻${tick};`,
      `export const e = (n: number) => ${tick}x\${'式の中'}y\${n}${tick};`,
      "export const f = { '名前': 1 };",
      'export const g = /正規表現/u;',
    ].join('\n');
    expect(findJapaneseLiterals('x.ts', source)).toEqual([
      { line: 1, text: '保存' },
      { line: 2, text: '開く' },
      { line: 3, text: '閉じる' },
      { line: 4, text: '頭' },
      { line: 4, text: '中' },
      { line: 4, text: '尻' },
      { line: 5, text: '式の中' },
      { line: 6, text: '名前' },
    ]);
  });

  // UT-DEV-I18N-04 findJapaneseLiterals_tsxのJSXの地の文字と属性の文字列を見つける
  it('findJapaneseLiterals_tsxのJSXの地の文字と属性の文字列を見つける', () => {
    const source = [
      'export const A = () => (',
      '  <div title="題">',
      '    {/* JSX の中のコメント */}',
      '    本文',
      '    {"式"}',
      '  </div>',
      ');',
    ].join('\n');
    expect(findJapaneseLiterals('x.tsx', source).map((l) => [l.line, l.text.trim()])).toEqual([
      [2, '題'],
      [4, '本文'],
      [5, '式'],
    ]);
  });

  // UT-DEV-I18N-11 findJapaneseLiterals_consoleの引数は数えずconsoleでない呼び出しの引数は数える
  // editing-core.md 2.2 節 (b)「ログの文（`console.*` の引数）…は見張りの外とする」
  it('findJapaneseLiterals_consoleの引数は数えずconsoleでない呼び出しの引数は数える', () => {
    const tick = '`';
    const source = [
      "console.log('ログ');",
      `console.warn(${tick}警告\${1}${tick}, { a: '中身' });`,
      "console.error('失敗', String('入れ子'));",
      "logger.log('数える1');",
      "log('数える2');",
      "console['log']('数える3');",
      "window.console.log('数える4');",
    ].join('\n');
    expect(findJapaneseLiterals('x.ts', source)).toEqual([
      { line: 4, text: '数える1' },
      { line: 5, text: '数える2' },
      { line: 6, text: '数える3' },
      { line: 7, text: '数える4' },
    ]);
  });

  // UT-DEV-I18N-12 findJapaneseLiterals_Errorとその子のクラスの引数は数えずほかのクラスの引数は数える
  // editing-core.md 2.2 節 (b)「例外の文（`Error` とその子のクラスの引数）は見張りの外とする」
  it('findJapaneseLiterals_Errorとその子のクラスの引数は数えずほかのクラスの引数は数える', () => {
    const source = [
      "throw new Error('例外');",
      "const e = new TypeError('型');",
      "const f = new CorruptSongFileError('自前', { why: '理由' });",
      "const g = new errors.FooError('名前空間');",
      "throw RangeError('newなし');",
      "throw make('数える1');",
      "throw '数える2';",
      "const h = new Label('数える3');",
      "const i = new (pick())('数える4');",
      "const j = RangeError('数える5');",
    ].join('\n');
    expect(findJapaneseLiterals('x.ts', source)).toEqual([
      { line: 6, text: '数える1' },
      { line: 7, text: '数える2' },
      { line: 8, text: '数える3' },
      { line: 9, text: '数える4' },
      { line: 10, text: '数える5' },
    ]);
  });

  // UT-DEV-I18N-13 findJapaneseLiterals_JSXの地の文字と普通の文字列はconsoleやErrorと並んでも数える
  // editing-core.md 2.2 節 (b)「JSX の地の文字は画面に出るので文言として数える」
  it('findJapaneseLiterals_JSXの地の文字と普通の文字列はconsoleやErrorと並んでも数える', () => {
    const source = [
      'export const A = () => {',
      "  console.info('ログ');",
      "  if (!ok) throw new Error('例外');",
      "  const label = 'ラベル';",
      '  return <p onClick={() => console.log("押した")}>地の文字</p>;',
      '};',
    ].join('\n');
    expect(findJapaneseLiterals('x.tsx', source)).toEqual([
      { line: 4, text: 'ラベル' },
      { line: 5, text: '地の文字' },
    ]);
  });

  // UT-DEV-I18N-14 findJapaneseLiterals_warnProvisionalの引数は数えず名前の違う呼び出しの引数は数える
  // editing-core.md 2.2 節 (b)「保存の部品がログを出す `console.warn` の包み `warnProvisional`（`packages/core/src/persistence/log.ts`）の引数も、ログの文として見張りの外とする」
  it('findJapaneseLiterals_warnProvisionalの引数は数えず名前の違う呼び出しの引数は数える', () => {
    const tick = '`';
    const source = [
      "warnProvisional('日本語');",
      `warnProvisional(${tick}失敗\${id}${tick}, { error: '中身' });`,
      "notWarnProvisional('数える1');",
      "warnProvisionalX('数える2');",
      "warn('数える3');",
    ].join('\n');
    expect(findJapaneseLiterals('x.ts', source)).toEqual([
      { line: 3, text: '数える1' },
      { line: 4, text: '数える2' },
      { line: 5, text: '数える3' },
    ]);
  });
});

describe('見るファイルの選び方', () => {
  // UT-DEV-I18N-05 isScannedFile_3つのフォルダの決まった拡張子だけを見る
  it('isScannedFile_3つのフォルダの決まった拡張子だけを見る', () => {
    for (const path of [
      'packages/core/src/editing/commands/Command.ts',
      'packages/shared-types/src/index.ts',
      'apps/desktop/src/main/ipc.ts',
      'apps/desktop/src/renderer/App.tsx',
    ])
      expect(isScannedFile(path), path).toBe(true);
    for (const path of [
      // packages の 2 つは .ts だけ
      'packages/core/src/ui/X.tsx',
      // 3 つのフォルダの外
      'packages/ui-desktop/src/nativeText.ts',
      'packages/core/scripts/x.ts',
      'apps/desktop/scripts/run-app.mjs',
      'apps/desktop/src/renderer/index.html',
    ])
      expect(isScannedFile(path), path).toBe(false);
  });

  // UT-DEV-I18N-06 isScannedFile_テストのファイルは見ない
  it('isScannedFile_テストのファイルは見ない', () => {
    for (const path of [
      'packages/core/src/editing/EditingService.test.ts',
      'packages/core/src/editing/editing.integration.test.ts',
      'apps/desktop/src/renderer/App.test.tsx',
      'apps/desktop/src/dev/i18nGuard.test.ts',
    ]) {
      expect(isTestFile(path), path).toBe(true);
      expect(isScannedFile(path), path).toBe(false);
    }
    expect(isTestFile('packages/core/src/testing/scoreFixtures.ts')).toBe(false);
  });

  // UT-DEV-I18N-07 isScannedFile_ErrorCodesのファイルだけを除く
  it('isScannedFile_ErrorCodesのファイルだけを除く', () => {
    for (const path of [
      'packages/core/src/errors/coreErrorCodes.ts',
      'packages/core/src/editing/editingErrorCodes.ts',
      'apps/desktop/src/main/mainErrorCodes.ts',
    ]) {
      expect(isErrorCodesFile(path), path).toBe(true);
      expect(isScannedFile(path), path).toBe(false);
    }
    // 名前の途中に ErrorCode を含むだけのファイルは見る
    for (const path of [
      'packages/core/src/errors/ErrorCodeRegistry.ts',
      'packages/core/src/errors/errorCodesTable.ts',
    ]) {
      expect(isErrorCodesFile(path), path).toBe(false);
      expect(isScannedFile(path), path).toBe(true);
    }
  });

  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  /** OS の一時フォルダに、3 つのフォルダを持つ偽物のリポジトリを作る。 */
  function fakeRepo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'riffline-i18n-'));
    made.push(dir);
    for (const root of ['packages/core/src', 'packages/shared-types/src', 'apps/desktop/src'])
      mkdirSync(join(dir, root), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  }

  // UT-DEV-I18N-08 findI18nViolations_見るファイルの文字列だけを数え除くものは数えない
  it('findI18nViolations_見るファイルの文字列だけを数え除くものは数えない', () => {
    const dir = fakeRepo({
      'packages/core/src/editing/a.ts': "// 注は通す\nexport const a = 'x';\n",
      'packages/core/src/editing/b.ts': "export const b = 'ラベル';\n",
      'packages/core/src/errors/coreErrorCodes.ts': "export const m = '保存できません';\n",
      'packages/core/src/editing/b.test.ts': "it('名前', () => {});\n",
      'packages/shared-types/src/c.ts': 'export const c = "型の文字";\n',
      'apps/desktop/src/renderer/D.tsx': 'export const D = () => <p>文言</p>;\n',
      'apps/desktop/src/node_modules/x/e.ts': "export const e = '入れたもの';\n",
      'packages/ui-desktop/src/f.ts': "export const f = '置いてよい所';\n",
    });
    expect(listScannedFiles(dir)).toEqual([
      'apps/desktop/src/renderer/D.tsx',
      'packages/core/src/editing/a.ts',
      'packages/core/src/editing/b.ts',
      'packages/shared-types/src/c.ts',
    ]);
    expect(findI18nViolations(dir)).toEqual([
      { path: 'apps/desktop/src/renderer/D.tsx', literals: [{ line: 1, text: '文言' }] },
      { path: 'packages/core/src/editing/b.ts', literals: [{ line: 1, text: 'ラベル' }] },
      { path: 'packages/shared-types/src/c.ts', literals: [{ line: 1, text: '型の文字' }] },
    ]);
  });
});

describe('リポジトリの実物', () => {
  // UT-DEV-I18N-09 リポジトリ_決まるまでの例外の外に日本語の文字列のリテラルが無い
  it('リポジトリ_決まるまでの例外の外に日本語の文字列のリテラルが無い', () => {
    const violations = findI18nViolations(repoRoot);
    const outside = violations
      .filter((v) => !PENDING_EXCEPTIONS.includes(v.path))
      .map((v) => `${v.path}:${v.literals.map((l) => l.line).join(',')}`);
    expect(outside).toEqual([]);
    // 例外に載ったファイルは今も日本語の文字列を持つこと（直したら一覧から外す。一覧が古いまま残らないように）
    const hit = new Set(violations.map((v) => v.path));
    expect(PENDING_EXCEPTIONS.filter((p) => !hit.has(p))).toEqual([]);
  });

  // UT-DEV-I18N-10 リポジトリ_見るファイルは3つのフォルダに届き除くものは入らない
  it('リポジトリ_見るファイルは3つのフォルダに届き除くものは入らない', () => {
    // 空振り（見るファイルが 0 件で通る形）を止める
    const files = listScannedFiles(repoRoot);
    expect(files).toContain('packages/core/src/editing/commands/Command.ts');
    expect(files).toContain('packages/shared-types/src/index.ts');
    expect(files).toContain('apps/desktop/src/renderer/App.tsx');
    expect(files).toContain('apps/desktop/src/dev/i18nGuard.ts');
    expect(files.filter((f) => isTestFile(f) || isErrorCodesFile(f) || f.includes('node_modules'))).toEqual([]);
    // 除くファイルは実際に日本語の文字列を持っている（除くことに意味がある）
    expect(
      findJapaneseLiterals('coreErrorCodes.ts', readSource('packages/core/src/errors/coreErrorCodes.ts')).length,
    ).toBeGreaterThan(0);
  });
});

function readSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}
