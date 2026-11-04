/**
 * 画面の文言を書いてよい所の外に、日本語の文字列が紛れ込んでいないかを見る（editing-core.md 2.2 節 (b)）。
 * 単体テストは apps/desktop/src/dev/i18nGuard.test.ts。
 *
 * 見るファイル：packages/core/src と packages/shared-types/src の .ts、apps/desktop/src の .ts と .tsx
 * （どれもテストのファイルを除く）。除くのは各パッケージのエラーコードの定義のファイル（*ErrorCodes.ts）だけ。
 * 見るもの：コメントを除いた文字列のリテラル。TypeScript の構文解析で、文字列のリテラル（'…' と "…"）・
 * テンプレートリテラルの文字の部分（`…${x}…` の ${} の外）・JSX の地の文字を拾う。コメントは構文の木に
 * 載らないので拾わない。正規表現のリテラルは文字列のリテラルではないので拾わない。
 * 日本語の文字：ひらがな・カタカナ（長音の記号を含む）・漢字。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

/** 見るフォルダ（リポジトリからの場所）と、そこで見る拡張子。 */
export const SCANNED_ROOTS: readonly { readonly dir: string; readonly extensions: readonly string[] }[] = [
  { dir: 'packages/core/src', extensions: ['.ts'] },
  { dir: 'packages/shared-types/src', extensions: ['.ts'] },
  { dir: 'apps/desktop/src', extensions: ['.ts', '.tsx'] },
];

/** 降りないフォルダ（入れたもの）。 */
const SKIPPED_DIRS = new Set(['node_modules']);

/** ひらがな・カタカナ・漢字と、長音の記号（Unicode の文字の種類では共通の扱いなので足す）。 */
const JAPANESE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}ー]/u;

/** 日本語の文字を含むか。 */
export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/** テストのファイル（*.test.ts・*.test.tsx。結合テストの *.integration.test.ts も含む）か。 */
export function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

/** エラーコードの定義のファイル（*ErrorCodes.ts）か。 */
export function isErrorCodesFile(path: string): boolean {
  return /ErrorCodes\.ts$/.test(path);
}

/**
 * 見るファイルか（リポジトリからの場所、区切りは /）。
 * @param path `packages/core/src/editing/commands/Command.ts`
 */
export function isScannedFile(path: string): boolean {
  if (isTestFile(path) || isErrorCodesFile(path)) return false;
  return SCANNED_ROOTS.some(
    (root) => path.startsWith(`${root.dir}/`) && root.extensions.some((ext) => path.endsWith(ext)),
  );
}

/** 日本語の文字を含む文字列のリテラル 1 つ。 */
export interface JapaneseLiteral {
  /** 1 から数えた行。 */
  readonly line: number;
  /** リテラルの中身（引用符を除いた文字）。 */
  readonly text: string;
}

/** 文字列のリテラルとして数える構文の種類。 */
const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

/**
 * 1 つのファイルの中の、日本語の文字を含む文字列のリテラル（副作用なし）。
 * @param fileName 拡張子で .ts と .tsx を見分けるのに使う
 * @param source ファイルの中身
 */
export function findJapaneseLiterals(fileName: string, source: string): JapaneseLiteral[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: JapaneseLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      const { text } = node as ts.LiteralLikeNode;
      if (hasJapanese(text)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push({ line: line + 1, text });
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
  return found;
}

/**
 * 見るファイルの全部（リポジトリからの場所、区切りは /、並びは名前の順）。
 * @param repoRoot リポジトリの直下
 */
export function listScannedFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
      } else if (isScannedFile(path)) files.push(path);
    }
  };
  for (const root of SCANNED_ROOTS) walk(root.dir);
  return files.sort();
}

/** 日本語の文字列のリテラルを持つファイルと、その中のリテラル。 */
export interface I18nViolation {
  readonly path: string;
  readonly literals: readonly JapaneseLiteral[];
}

/**
 * 見るファイルのうち、日本語の文字列のリテラルを持つものの全部（並びは名前の順）。
 * @param repoRoot リポジトリの直下
 */
export function findI18nViolations(repoRoot: string): I18nViolation[] {
  const violations: I18nViolation[] = [];
  for (const path of listScannedFiles(repoRoot)) {
    const literals = findJapaneseLiterals(path, readFileSync(join(repoRoot, path), 'utf8'));
    if (literals.length > 0) violations.push({ path, literals });
  }
  return violations;
}
