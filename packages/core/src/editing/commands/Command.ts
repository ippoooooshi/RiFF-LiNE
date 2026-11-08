/**
 * 取り消しとやり直しの単位になるコマンドの型（editing-core.md 2.2 節）。
 *
 * コマンド層（editing/commands）は、画面のモジュール・react・alphaTab の描画と再生の API を import しない。
 * 使ってよいのは alphaTab のデータの型だけ（editing-core.md 2.1 節）。
 */

import type { CommandOutcome } from '../types';

/**
 * 取り消し・やり直しで利用者に見せるラベルの id（editing-core.md 2.2 節）。2.6 節の各コマンドに 1 つ。
 * 日本語の文言はここに置かず、`packages/ui-desktop` の `COMMAND_LABELS`（`Record<CommandLabelId, string>`）に置く。
 */
// <!-- req editingcore:8f2bb5b2.2760 --> <!-- req editingcore:8f2bb5b2.db3d --> <!-- req editingcore:5ec8e62e.d096 --> <!-- req editingcore:5ec8e62e.281c --> <!-- req editingcore:5ec8e62e.3c29 --> <!-- req editingcore:5ec8e62e.8912 --> <!-- req editingcore:5ec8e62e.149f --> <!-- req editingcore:5ec8e62e.a15e -->
// <!-- req editingcore:844e42e4.c373 -->
// <!-- req editingcore:1ee91092.f6c5 --> <!-- req editingcore:51e9aba4.d7b9 --> <!-- req editingcore:26d7fc58.e1a5 -->
export type CommandLabelId =
  // <!-- req editingcore:8f2bb5b2.4b89 -->
  | 'place-note'
  | 'set-note-fret'
  | 'insert-rest'
  | 'delete-notes'
  | 'set-beat-duration'
  | 'set-tie'
  | 'set-slur'
  | 'set-technique'
  | 'set-beat-technique'
  | 'set-chord-name'
  | 'delete-selection'
  // 切り取りで出す DeleteSelectionCommand のラベル（editing-core.md 9 節の宣言「label は切り取りなら 'cut'」）
  | 'cut' // <!-- req editingcore:8f2bb5b2.1589 -->
  | 'paste'
  | 'duplicate-selection'
  | 'insert-bar'
  | 'delete-bar'
  | 'set-time-signature'
  | 'set-tempo'
  | 'set-repeat'
  | 'add-memo'
  | 'edit-memo'
  | 'delete-memo'
  | 'add-section-marker'
  | 'edit-section-marker'
  | 'delete-section-marker'
  | 'add-part'
  | 'remove-part'
  | 'reorder-parts'
  | 'rename-part'
  | 'set-part-color'
  | 'set-part-instrument'
  | 'set-string-count'
  | 'apply-tuning-preset'
  | 'set-custom-tuning'
  | 'set-capo-fret'
  | 'set-part-volume'
  | 'set-part-pan'
  | 'set-part-solo'
  | 'set-part-mute';

/** コマンドの型（editing-core.md 2.2 節）。具象コマンドはこれを実装する。 */
// <!-- req editingcore:8ee56da1.26a0 --> <!-- req editingcore:e27a9687.3cc9 --> <!-- req editingcore:ef2e8318.e41e --> <!-- req editingcore:7b11821e.47e7 --> <!-- req editingcore:77881053.7d71 --> <!-- req editingcore:1f9fd3f0.356d --> <!-- req editingcore:844e42e4.cd7a --> <!-- req editingcore:ff8d401a.fb23 --> <!-- req editingcore:54e0b2f1.5a85 --> <!-- req editingcore:54e0b2f1.1c85 --> <!-- req editingcore:54e0b2f1.ec1c --> <!-- req editingcore:54e0b2f1.62f2 --> <!-- req editingcore:54e0b2f1.bedd --> <!-- req editingcore:4d4a8a66.4771 --> <!-- req editingcore:4d4a8a66.4024 --> <!-- req editingcore:d49219fc.f09a -->
// <!-- req editingcore:8ee56da1.c4ad --> <!-- req editingcore:ff8d401a.1469 --> <!-- req editingcore:54e0b2f1.2d84 --> <!-- req editingcore:54e0b2f1.6fe0 --> <!-- req editingcore:4078a65f.da35 --> <!-- req editingcore:4078a65f.3664 -->
export interface Command {
  /** 履歴の中で種類を見分ける名前（例 'place-note'）。 */
  // <!-- req editingcore:3dd2da7f.4f6a --> <!-- req editingcore:ba53c663.236d --> <!-- req editingcore:ba53c663.869c -->
  readonly kind: string;
  /** 取り消し・やり直しで利用者に見せるラベルの id。 */
  // <!-- req editingcore:cc230708.bf95 --> <!-- req editingcore:d242f3fe.313c --> <!-- req editingcore:d242f3fe.b4a6 --> <!-- req editingcore:8f2bb5b2.c3cc -->
  readonly label: CommandLabelId;
  /** この変更が及ぶパートの番号（描き直しで使う）。 */
  // <!-- req editingcore:59923e39.9ddc -->
  readonly affectedTrackIndices: readonly number[];
  /** Score とサイドカーに変更を当てる。CommandHistory が二度は呼ばない。 */
  // <!-- req editingcore:ff7c701d.dc74 --> <!-- req editingcore:7b11821e.bc38 --> <!-- req editingcore:7e09307e.8aa9 --> <!-- req editingcore:7e09307e.4863 --> <!-- req editingcore:7e09307e.94dc --> <!-- req editingcore:f2cae7a9.d6eb --> <!-- req editingcore:44a1f637.848a --> <!-- req editingcore:44a1f637.22c2 -->
  execute(): CommandOutcome;
  /** execute の変更を打ち消す。execute との対称性は各コマンドが自分で保証する。 */
  // <!-- req editingcore:b94535fd.cfcd --> <!-- req editingcore:ff7c701d.0568 --> <!-- req editingcore:7b11821e.074a --> <!-- req editingcore:b0607adf.3510 --> <!-- req editingcore:61081469.5531 --> <!-- req editingcore:61081469.a873 --> <!-- req editingcore:61081469.64a2 -->
  undo(): CommandOutcome;
  /** 直前の履歴と 1 つにまとめられるか（任意。無ければまとめない）。 */
  // <!-- req editingcore:01bb4a04.0c51 --> <!-- req editingcore:7943f8f8.431d --> <!-- req editingcore:7943f8f8.a559 -->
  canMergeWith?(other: Command): boolean;
  /** other（古いほう）を this に取り込む（任意）。 */
  // <!-- req editingcore:c881a8b9.534d --> <!-- req editingcore:5b6d969c.1e97 --> <!-- req editingcore:5b6d969c.8f3c -->
  mergeWith?(other: Command): void;
  /** 履歴に積んだときの推定サイズ（バイト）。editing-core.md 2.3 節の 80MB の判定に使う。 */
  // <!-- req editingcore:1a2b8fec.fbc8 -->
  estimateSizeBytes(): number;
}
