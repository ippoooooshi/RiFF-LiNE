/**
 * オーディオセッション制御のアダプタ（PlatformAdapter の 4 系統の 1 つ）。
 *
 * 置き場所は web-core-foundation.md 3.1 節、シグネチャは playback-integration.md 10 節。
 * IPC を通らないが、iPhone 版で非同期になるので Promise を返す形にそろえる（3.3 節）。
 * PC 版は何もしない実装をレンダラーの側に置く（3.2 節）。
 */

export interface AudioSessionAdapter {
  /** 別のアプリの音と混ぜて鳴らす設定にする。PC 版は何もせずに resolve する。 */
  configureMixWithOthers(): Promise<void>;
}
