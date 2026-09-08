/**
 * @riff-line/core — Webコア本体（L1〜L3）。
 *
 * - rendering: alphaTab ファサード（Webコア基盤構築）
 * - platform: PlatformAdapter I/F（境界。FileSystemAdapter / Factory / AppLocalConfigService の型）
 * - domain: SongDocument 等のデータモデル（データモデル・永続化）
 * - persistence: Repository / Index / Trash / Migration / Storage 系サービス（データモデル・永続化）
 * - errors: NotificationCenter / Logger / ErrorCodeRegistry（エラー・ログ基盤）
 * - editing: Command / CommandHistory / EditingService（タブ譜編集コア）
 * - parts: PartManagementService / TuningPresetService（パート・チューニング管理）
 * - viewmodes: ViewModeController / ZoomController（表示モード）
 * - playback: PlaybackService / PlaybackSyncController 等（再生エンジン統合）
 */

export * from './rendering';
export * from './platform';
export * from './domain';
export * from './persistence';
export * from './errors';
export * from './editing';
export * from './parts';
export * from './viewmodes';
export * from './playback';
