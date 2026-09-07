/**
 * FileSystemAdapter 越しの JSON 読み書きヘルパー（data-model-persistence.md §3.2 の各サービス共通）。
 * バイト列 ⇔ UTF-8 文字列 ⇔ JSON の往復を 1 箇所に集約する。
 */

import type { FileSystemAdapter } from '@riff-line/shared-types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** オブジェクトを UTF-8 バイト列（末尾改行付き）へ。 */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

/** バイト列を UTF-8 文字列としてデコードする。 */
export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * ルート相対パスの JSON を読んでパースする。
 * ファイルが存在しない（FileNotFoundError）場合は `fallback` を返す。
 * それ以外の読み取り／パース失敗はそのまま再送出する（呼び出し元が判断する）。
 */
export async function readJsonFile<T>(adapter: FileSystemAdapter, relativePath: string, fallback: T): Promise<T> {
  try {
    const bytes = await adapter.readFile(relativePath);
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch (error) {
    if (isFileNotFound(error)) return fallback;
    throw error;
  }
}

/** ルート相対パスへ JSON を書き込む（親ディレクトリは呼び出し元が用意済みである前提）。 */
export async function writeJsonFile(adapter: FileSystemAdapter, relativePath: string, value: unknown): Promise<void> {
  await adapter.writeFile(relativePath, encodeJson(value));
}

/** platform/errors.ts の FileNotFoundError（code:'FILE_NOT_FOUND'）かどうか。バレル循環を避け code で判定。 */
export function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FILE_NOT_FOUND';
}
