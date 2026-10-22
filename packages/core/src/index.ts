/**
 * @riff-line/core — Webコア本体（L1〜L3 と、L4 のうちインターフェースの platform、層の外の errors。web-core-foundation.md 2.1 節）。
 * 7.1 節：editing・domain・playback は PC 版と iPhone 版で同じコード。画面の入れ物は ui-desktop、中身の部品は ui-shared（作業パッケージ 8） <!-- req webcorefoundation:3c5c6f5a.4011 --> <!-- req webcorefoundation:3c5c6f5a.9fa4 --> <!-- req webcorefoundation:3c5c6f5a.05bb --> <!-- req webcorefoundation:3c5c6f5a.aca3 --> <!-- req webcorefoundation:0843bac1.e1ac --> <!-- req webcorefoundation:0843bac1.4961 --> <!-- req webcorefoundation:0843bac1.e459 --> <!-- req webcorefoundation:0843bac1.ceb1 --> <!-- req webcorefoundation:0843bac1.02da --> <!-- req webcorefoundation:ff43d25d.f6d6 --> <!-- req webcorefoundation:ff43d25d.3eb1 -->
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
 * - ui: AppPreferencesService / TagStore / 各 ViewModel・Binder（画面群・ナビゲーション、フレームワーク非依存部分）
 * - export: PDF・alphaTex・MIDI の書き出し（中身は export-print.md の作業パッケージ）
 */
// <!-- req webcorefoundation:6bb9de38.e554 --> <!-- req webcorefoundation:daed5221.d351 --> <!-- req webcorefoundation:60a4a359.48ca --> <!-- req webcorefoundation:47306a52.1736 -->
// <!-- req webcorefoundation:743c2379.48ca -->
// <!-- req webcorefoundation:c99aee68.ebb9 --> <!-- req webcorefoundation:c99aee68.9203 --> <!-- req webcorefoundation:f87abd8f.e5b4 --> <!-- req webcorefoundation:f87abd8f.6786 --> <!-- req webcorefoundation:f87abd8f.5c33 --> <!-- req webcorefoundation:f87abd8f.ce89 --> <!-- req webcorefoundation:f87abd8f.4704 -->

export * from './rendering'; // <!-- req webcorefoundation:ed1d3776.b77f --> <!-- req webcorefoundation:ed1d3776.3988 -->
export * from './platform'; // <!-- req webcorefoundation:fab380e3.cad3 --> <!-- req webcorefoundation:fab380e3.8513 --> <!-- req webcorefoundation:c4d71ee2.6705 --> <!-- req webcorefoundation:c4d71ee2.2c79 --> <!-- req webcorefoundation:60a4a359.3bf0 -->
export * from './domain'; // <!-- req webcorefoundation:08c14fcf.26fd --> <!-- req webcorefoundation:08c14fcf.ea04 --> <!-- req webcorefoundation:08c14fcf.e132 --> <!-- req webcorefoundation:44f200a7.6d46 --> <!-- req webcorefoundation:44f200a7.97aa --> <!-- req webcorefoundation:60a4a359.669a -->
export * from './persistence'; // <!-- req webcorefoundation:3ddab020.572f --> <!-- req webcorefoundation:3ddab020.f0b2 --> <!-- req webcorefoundation:3ad9700d.d80f -->
export * from './errors'; // <!-- req webcorefoundation:8315bd0f.9961 --> <!-- req webcorefoundation:8315bd0f.151e --> <!-- req webcorefoundation:0c71cda7.49ba --> <!-- req webcorefoundation:0c71cda7.3352 -->
export * from './editing'; // <!-- req webcorefoundation:41190d3d.11c0 --> <!-- req webcorefoundation:41190d3d.3522 --> <!-- req webcorefoundation:41190d3d.0128 --> <!-- req webcorefoundation:adffd0b8.7086 --> <!-- req webcorefoundation:adffd0b8.d6be --> <!-- req webcorefoundation:adffd0b8.4301 --> <!-- req webcorefoundation:60a4a359.b5a0 -->
export * from './parts'; // <!-- req webcorefoundation:b0aebc19.a1d7 --> <!-- req webcorefoundation:b0aebc19.5cc7 --> <!-- req webcorefoundation:3ad9700d.2e1a -->
export * from './viewmodes'; // <!-- req webcorefoundation:506629c9.7cdf --> <!-- req webcorefoundation:506629c9.0e2b --> <!-- req webcorefoundation:3ad9700d.1bfb -->
export * from './playback'; // <!-- req webcorefoundation:25f750e4.64e6 --> <!-- req webcorefoundation:25f750e4.6b89 --> <!-- req webcorefoundation:f643fe8e.74e5 -->
export * from './ui'; // <!-- req webcorefoundation:1cb6fa65.108b --> <!-- req webcorefoundation:1cb6fa65.2b64 --> <!-- req webcorefoundation:e5951fab.fdef --> <!-- req webcorefoundation:e5951fab.dc8d --> <!-- req webcorefoundation:e5951fab.454c --> <!-- req webcorefoundation:e5951fab.902e --> <!-- req webcorefoundation:e5951fab.91b5 --> <!-- req webcorefoundation:e5951fab.dec3 --> <!-- req webcorefoundation:e5951fab.5383 --> <!-- req webcorefoundation:e5951fab.e42b --> <!-- req webcorefoundation:e5951fab.0d85 --> <!-- req webcorefoundation:1af05ed8.af5b --> <!-- req webcorefoundation:1af05ed8.ab20 --> <!-- req webcorefoundation:1af05ed8.f862 --> <!-- req webcorefoundation:1af05ed8.454c --> <!-- req webcorefoundation:1af05ed8.9a43 --> <!-- req webcorefoundation:1af05ed8.3a1e --> <!-- req webcorefoundation:1af05ed8.099c --> <!-- req webcorefoundation:1af05ed8.4d66 --> <!-- req webcorefoundation:60a4a359.f7b1 -->
export * from './export';
// <!-- req webcorefoundation:fa45ae68.d9a8 --> <!-- req webcorefoundation:fa45ae68.e3d6 --> <!-- req webcorefoundation:fa45ae68.f689 --> <!-- req webcorefoundation:ae026fc8.f49f --> <!-- req webcorefoundation:ae026fc8.2c3f -->
