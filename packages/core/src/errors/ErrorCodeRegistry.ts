/**
 * エラーコード（`{ドメイン}-{連番}`）ごとに、固定のレベル・メッセージテンプレートを持つ辞書
 * （error-logging-foundation.md 2.1 節、08_error_logging.md 1.2 節）。チャンネルはレベルから導出する（channels.ts）。
 *
 * `NotificationCenter.report(code, context)` はレベルを引数に取らず、ここからコードのレベルを引く。
 * コードとレベルを 1 対 1 に固定し、呼び出し側がレベルを誤って指定するバグをそもそも起こせない設計にする（2.1 節）。 <!-- req errorloggingfoundation:95c6d63b.77d2 --> <!-- req errorloggingfoundation:95c6d63b.e70b -->
 */

import { InvalidErrorCodeError, UnknownErrorCodeError } from './errors';
import type { ErrorCodeDefinition } from './types';

/**
 * エラーコードのドメインは 8 つに限る（error-logging-foundation.md 2.1 節、08_error_logging.md 1.2 節）。
 * 採番の規則は 00_reference.md 5 節の「エラーコードの採番規則」。
 */
// <!-- req errorloggingfoundation:f53886d9.1b16 --> <!-- req errorloggingfoundation:f53886d9.2a0a --> <!-- req errorloggingfoundation:f53886d9.f9e7 --> <!-- req errorloggingfoundation:f53886d9.6b51 --> <!-- req errorloggingfoundation:f53886d9.ae32 --> <!-- req errorloggingfoundation:f53886d9.cfaa --> <!-- req errorloggingfoundation:f53886d9.e1c4 --> <!-- req errorloggingfoundation:f53886d9.f8cd --> <!-- req errorloggingfoundation:f53886d9.3c33 -->
// <!-- req 00:de05acc3.263f -->
export const ERROR_DOMAINS = ['EDIT', 'PLAY', 'FILE', 'EXPORT', 'SYS', 'RENDER', 'TAG', 'SONG'] as const;

/** エラーコードのドメイン。 */
export type ErrorDomain = (typeof ERROR_DOMAINS)[number];

const DOMAIN_SET: ReadonlySet<string> = new Set<string>(ERROR_DOMAINS);

/** `{ドメイン}-{3桁の連番}`（00_reference.md 5 節の採番規則 (1)）。 */
// <!-- req errorloggingfoundation:ce6fccc1.c616 -->
// <!-- req 00:de05acc3.304c -->
const CODE_FORMAT = /^([A-Z]+)-\d{3}$/;

export class ErrorCodeRegistry {
  // <!-- req 00:befedfee.2141 -->
  private readonly definitions = new Map<string, ErrorCodeDefinition>();

  /**
   * コード定義を登録する。同じコードの再登録は後勝ち（テスト・後のパッケージによる差し替えを許す）。
   *
   * @throws InvalidErrorCodeError 8 つのドメインの外のコード（`{ドメイン}-{3桁の連番}` の形でないものを含む）、
   *   または `showOnScreen: false` なのに `logOnlyReason` が空の定義（レベルは問わない。出さない理由を必ず書かせる）。
   *   未登録コードの `UnknownErrorCodeError` と同じく、開発時に気づけるようにする。 <!-- req errorloggingfoundation:f53886d9.071f -->
   */
  // <!-- req errorloggingfoundation:ce6fccc1.aa29 -->
  register(code: string, definition: ErrorCodeDefinition): void {
    const domain = CODE_FORMAT.exec(code)?.[1];
    // <!-- req errorloggingfoundation:f53886d9.32d9 -->
    if (domain === undefined || !DOMAIN_SET.has(domain)) {
      throw new InvalidErrorCodeError(code, 'domain');
    }
    // <!-- req errorloggingfoundation:ce6fccc1.01ed --> <!-- req errorloggingfoundation:ce6fccc1.91dc -->
    // <!-- req 00:c6a42980.d456 -->
    if (definition.showOnScreen === false && (definition.logOnlyReason ?? '').trim() === '') {
      // <!-- req 00:b3d1352e.9c60 -->
      // <!-- req errorloggingfoundation:ce6fccc1.8f18 -->
      throw new InvalidErrorCodeError(code, 'logOnlyReason');
    }
    this.definitions.set(code, definition);
  }

  /**
   * コード定義を返す。
   * @throws UnknownErrorCodeError 未登録コード（登録漏れを開発時に気づけるようにする）。
   */
  // <!-- req errorloggingfoundation:ce6fccc1.affa -->
  resolve(code: string): ErrorCodeDefinition {
    const definition = this.definitions.get(code);
    if (definition === undefined) {
      // <!-- req errorloggingfoundation:ce6fccc1.ba52 -->
      throw new UnknownErrorCodeError(code);
    }
    return definition;
  }

  /** 登録済みか。条件付きの report を避けたい呼び出し側・テスト用。 */
  has(code: string): boolean {
    // <!-- req errorloggingfoundation:ce6fccc1.7611 -->
    return this.definitions.has(code); // <!-- req errorloggingfoundation:ce6fccc1.380c -->
  }
}
