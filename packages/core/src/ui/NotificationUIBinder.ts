/**
 * `NotificationCenter` 購読 → チャンネル別 UI への振り分け（screens-navigation.md §4.5・§5.3）。
 *
 * `NotificationCenter.subscribe(handler)` を購読し、`NotificationEvent.channel`（`toast` / `highlight` / `modal`）
 * に応じて注入済みのシンクへ渡すだけの `Binder`（00_reference.md §7）。ドメイン層は自分がどう表示されるかを
 * 知らず、レベル→チャンネルは `LEVEL_TO_CHANNEL` で機械的に決まっている（Info/Warning=toast、Error=highlight、
 * Critical=modal。03_screens_ui_pc.md §11 の配置表）。
 *
 * 振り分けは 3 値の単純分岐で C1（分岐網羅）で十分（screens-navigation.md §6）。
 */

import type { NotificationChannel, NotificationEvent } from '../errors';

/** `NotificationCenter` の購読部分だけの最小契約（テスト時に fake へ差し替えるための縫い目）。 */
export interface NotificationSource {
  subscribe(handler: (event: NotificationEvent) => void): () => void;
}

/** チャンネルごとの表示先。UI フレームワーク非依存（実体は L5 の React 層が渡す）。 */
export interface NotificationChannelSinks {
  /** 自動消滅トースト（Info / Warning）。 */
  toast(event: NotificationEvent): void;
  /** 譜面ハイライト＋ステータスバーメッセージ（Error）。通常は `ScoreHighlightBinder` を渡す。 */
  highlight(event: NotificationEvent): void;
  /** モーダルダイアログ（Critical、確認必須）。 */
  modal(event: NotificationEvent): void;
}

export class NotificationUIBinder {
  private readonly sinks: NotificationChannelSinks;
  private unsubscribe: (() => void) | null = null;

  constructor(sinks: NotificationChannelSinks) {
    this.sinks = sinks;
  }

  /**
   * 購読を開始する。多重 `attach` は無視する（前の購読を保持）。
   * @returns 解除関数（`detach` と同じ）。
   */
  attach(source: NotificationSource): () => void {
    if (this.unsubscribe !== null) return () => this.detach();
    this.unsubscribe = source.subscribe((event) => this.dispatch(event));
    return () => this.detach();
  }

  /** 購読を解除する。未 attach でも安全（冪等）。 */
  detach(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** 1 件のイベントをチャンネル別シンクへ渡す（screens-navigation.md §5.3 の alt 分岐）。 */
  private dispatch(event: NotificationEvent): void {
    const channel: NotificationChannel = event.channel;
    if (channel === 'toast') {
      this.sinks.toast(event);
    } else if (channel === 'highlight') {
      this.sinks.highlight(event);
    } else {
      this.sinks.modal(event);
    }
  }
}
