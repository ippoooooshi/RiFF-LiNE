/**
 * Error レベル通知の譜面ハイライト表示（screens-navigation.md §4.5・§4.5.1・§5.3）。
 *
 * `NotificationUIBinder` から `channel === 'highlight'` のイベントを受け取り、`context` 内の慣例フィールド
 * （`barIndex` / `trackIndex` / `barCount`。エラーコード発生元が `report()` へ既に渡している値。例: `EDIT-001`/`EDIT-002`、
 * B20 で Error 化した `EDIT-003`/`EDIT-005`/`TAG-001` も本チャンネルを通る）をもとに、`ScoreRenderHost` の
 * ハイライト用非破壊拡張（§4.5.1）を呼び出す。譜面位置が特定できないイベント（`TAG-001` 等）は
 * ステータスバーメッセージのみで、ハイライトはスキップする。
 */

import type { ScoreHighlightRequest } from '../rendering';
import type { NotificationEvent } from '../errors';

/** `ScoreRenderHost` のハイライト用非破壊拡張（§4.5.1）の最小契約。テスト時に fake へ差し替える縫い目。 */
export interface ScoreHighlightHost {
  /** 指定トラック・小節（範囲）に赤枠ハイライトを一定時間表示する。 */
  showErrorHighlight(request: ScoreHighlightRequest): void;
  /** ハイライトを明示的に解除する。 */
  clearErrorHighlight(): void;
}

/** `context` から数値フィールドを安全に取り出す（文字列 "3" も許容）。範囲外・非数値は undefined。 */
function readIndex(context: Record<string, unknown> | undefined, key: string): number | undefined {
  if (context === undefined) return undefined;
  const value = context[key];
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export class ScoreHighlightBinder {
  private readonly host: ScoreHighlightHost;

  constructor(host: ScoreHighlightHost) {
    this.host = host;
  }

  /**
   * 1 件の highlight チャンネルイベントを処理する。`NotificationUIBinder` の `highlight` シンクとして渡す。
   *
   * - `barIndex` があれば `trackIndex`（省略時 0）と `barCount`（省略時 1）でハイライト要求。
   * - `barIndex` が無い（譜面に紐付かない Error）なら既存ハイライトだけ解除して終わる。
   */
  handle(event: NotificationEvent): void {
    const startBarIndex = readIndex(event.context, 'barIndex');
    if (startBarIndex === undefined) {
      this.host.clearErrorHighlight();
      return;
    }
    const trackIndex = readIndex(event.context, 'trackIndex') ?? 0;
    const barCount = Math.max(1, readIndex(event.context, 'barCount') ?? 1);
    const request: ScoreHighlightRequest = { trackIndex, startBarIndex, barCount, code: event.code };
    this.host.showErrorHighlight(request);
  }
}
