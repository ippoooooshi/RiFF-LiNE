/**
 * エラーコード → 定義（レベル・メッセージテンプレート）の辞書（error-logging-foundation.md §2.1、
 * 00_reference.md §7「Registry」）。
 *
 * `NotificationCenter` はこのレジストリからレベルを引くため、同じコードに呼び出し側ごとに違う
 * レベルを渡せてしまう事故が原理的に起きない（error-logging-foundation.md §2.1 の設計意図）。
 */

import { UnknownErrorCodeError } from './errors';
import type { ErrorCodeDefinition } from './types';

export class ErrorCodeRegistry {
  private readonly definitions = new Map<string, ErrorCodeDefinition>();

  /**
   * コード定義を登録する。同一コードの再登録は後勝ち（テスト・拡張パッケージによる差し替えを許す。
   * `SchemaMigrator.register` と同じ方針）。
   */
  register(code: string, definition: ErrorCodeDefinition): void {
    this.definitions.set(code, definition);
  }

  /**
   * コード定義を返す。
   * @throws UnknownErrorCodeError 未登録コード（登録漏れを開発時に検出する）。
   */
  resolve(code: string): ErrorCodeDefinition {
    const definition = this.definitions.get(code);
    if (definition === undefined) {
      throw new UnknownErrorCodeError(code);
    }
    return definition;
  }

  /** 登録済みか。条件付きの report を避けたい呼び出し側・テスト用。 */
  has(code: string): boolean {
    return this.definitions.has(code);
  }
}
