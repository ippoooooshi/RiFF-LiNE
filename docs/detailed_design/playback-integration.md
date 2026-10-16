# 再生エンジン統合 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 7「再生エンジン統合」
- **ブランチ名**：`feature/playback-integration`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 全体構成と公開する操作

[[../basic_design/05_playback_audio.md#1]] を受ける。alphaTab に委ねる範囲の線は [[web-core-foundation.md#9]] の 9.1 節、SoundFont のファイルを配る形は [[web-core-foundation.md#4]] の 4.1 節の表が正で、本節は再生のしくみの組み立てを書く。alphaTab の名前は、1.8.4 の型定義（`dist/alphaTab.d.ts`）と実装（`dist/alphaTab.core.mjs`）で確かめた。

### 1.1 音源のエンジン

- 音源のエンジンは、alphaTab に同梱の AlphaSynth を使う。 <!-- req 05:21bbf0d5.8bc9 -->
- AlphaSynth は SoundFont2 の形の音源を鳴らすシンセとする。発音と合成の所には手を加えない。 <!-- req 05:21bbf0d5.8b87 -->
- 使う alphaTab は、本家の同じ版を元にした fork とする。fork で本家に足すのは、再生中にチャンネルのパンを変える命令と、それを呼ぶ公開の API（2.2 節の `changeTrackPan`）の 1 つだけとする（2026-10-11 本人決定、基本設計 13 章 A13）。fork の置き場所・取り込み方・版の上げ方は [[web-core-foundation.md#4]] の 4.1 節。 <!-- req 05:eb148cf6.d688 --> <!-- req 05:eb148cf6.289a --> <!-- req 05:eb148cf6.fbaf --> <!-- req 05:eb148cf6.62fd --> <!-- req 05:eb148cf6.6bf8 -->
- 自前のシンセは作らない。発音・合奏・音色の切り替えは AlphaSynth に任せる。 <!-- req 05:21bbf0d5.4bff -->
- 入力の試しの音のためにだけ、曲の再生と同じ SoundFont を読む AlphaSynth をもう 1 つ持つ（8.2 節の `PreviewSynth`、基本設計 13 章 A15 の (a)）。これも alphaTab に同梱の AlphaSynth で、自前のシンセではない。 <!-- req 05:b1625936.f3a0 -->
- alphaTab の再生の設定は、描画の設定（[[web-core-foundation.md#10]] の 10.3 節の `core.enableLazyLoading`）と同じ `packages/core/src/rendering` の 1 か所で渡す。渡す値は、`player.playerMode` に `PlayerMode.EnabledSynthesizer`、`player.enableCursor` に `true`（5 節）、`player.scrollMode` に `ScrollMode.Off`（5 節）、`player.soundFont` に同梱の SoundFont のアプリの中の相対パス（1.3 節）の 4 つとする。(b) `EnabledSynthesizer` にするのは、曲のファイルに伴奏の音声（backing track）を持たず、いつもシンセで鳴らすため。

### 1.2 `PlaybackService`（再生の窓口）

- 再生制御のサービス `PlaybackService` は、alphaTab の再生の API（`AlphaTabApi` の `play`・`pause`・`tickPosition`・`playbackRange`・`isLooping`・`playbackSpeed`・`changeTrackVolume`・`changeTrackMute`・`changeTrackSolo`・`loadMidiForScore` と、`player` の `playOneTimeMidiFile`・`resetChannelStates`・`setChannelVolume`）を呼ぶ薄い窓口（ファサード）とする。中で再生の規則を新しく起こさない。 <!-- req 05:de5cc725.6178 -->
- 画面に公開する操作は、再生（`play`）・停止（`stop`）・シーク（`seekToBar`）・ループ範囲の設定（`setRegionLoop`・`setSectionLoop`・`clearLoop`）・テンポの倍率（`setTempoFactor`）・パート別のミュートとソロ（`setPartMute`・`setPartSolo`・`setTemporarySolo`）・音量とパン（`setPartVolume`・`setPartPan`）・書き出しの試し（`startExportAudition`・`stopExportAudition`、1.4 節）とする。 <!-- req 05:de5cc725.2eb0 --> <!-- req 05:de5cc725.f431 --> <!-- req 05:de5cc725.bc3c --> <!-- req 05:de5cc725.0542 --> <!-- req 05:de5cc725.0df4 --> <!-- req 05:de5cc725.b384 --> <!-- req 05:de5cc725.c4ec --> <!-- req 05:de5cc725.7e3b --> <!-- req 05:de5cc725.85f7 --> <!-- req 05:de5cc725.3b3e -->
- 画面（`packages/ui-desktop` と `packages/core/src/ui`）は、再生について上の操作だけを呼び、`AlphaTabApi` の再生の API と AlphaSynth に直接触れない。公開する操作は上の 8 種に限り、ここに無い操作を `PlaybackService` に足さない。曲の状態を読むだけのもの（`isPlaying`・`readiness`・`loop`・`lastLoop`・`tempoFactor`・`isAuditioning` と、その変化の購読）と、編集ウィンドウを開け閉めするときの `preWarm`・`dispose` は操作に数えない。 <!-- req 05:de5cc725.48a1 -->
- メトロノーム・カウントイン・入力のときのクリック（6 節）は、上の 8 種とは別の働きで、`PlaybackService` には入れず、6 節のクラスに置く。

```ts
// packages/core/src/playback/PlaybackService.ts
/** 音源の読み込みの状態（8 節）。 */
export type PlaybackReadiness = 'loading' | 'ready' | 'failed';

/** ループの範囲（3 節）。 */
export type LoopRange =
  | { kind: 'region'; startBarIndex: number; endBarIndex: number }
  | { kind: 'section'; markerId: string };

/** AlphaTabApi のうち、PlaybackService が使う所だけ（テストで差し替える）。 */
export interface PlaybackApi {
  play(): boolean;
  pause(): void;
  tickPosition: number;
  playbackRange: { startTick: number; endTick: number } | null;
  isLooping: boolean;
  playbackSpeed: number;
  changeTrackVolume(tracks: model.Track[], volume: number): void;
  changeTrackMute(tracks: model.Track[], mute: boolean): void;
  changeTrackSolo(tracks: model.Track[], solo: boolean): void;
  loadMidiForScore(): void;
  /** 書き出しの試し（1.4 節）だけが使う。 */
  readonly player: Pick<synth.IAlphaSynth, 'playOneTimeMidiFile' | 'resetChannelStates' | 'setChannelVolume'> | null;
}

export interface PlaybackServiceDeps {
  /** パートの値を変えるコマンドを通す所（その曲の CommandHistory）。 */
  history: { execute(command: Command): CommandOutcome };
  target: EditTarget;
  audioSession: AudioSessionAdapter;
  reporter: NotificationReporter;
  songId: string;
  /** パンのつまみを離したことを渡す先（7 節）。 */
  mixer: Pick<PlaybackMixerBinder, 'releasePan'>;
}

/** 編集ウィンドウ（開いている曲）ごとに 1 つ。 */
export class PlaybackService {
  constructor(api: PlaybackApi, score: model.Score, deps: PlaybackServiceDeps);
  /** 音源の読み込みを始める（8 節）。曲を開いた編集ウィンドウで 1 回呼ぶ（00_reference.md 5 節の PLAY-001・PLAY-003 の「起動時」はこの時点）。2 回目からは同じ Promise を返す。失敗しても reject せず、readiness を 'failed' にする。 */
  preWarm(): Promise<void>;
  get readiness(): PlaybackReadiness;
  onReadinessChanged(listener: (readiness: PlaybackReadiness) => void): () => void;
  /** 今の再生位置から鳴らす。パートが 0 の曲と readiness が 'ready' でないときは何もしない（2 節・8 節）。 */
  play(): void;
  /** 鳴らすのを止め、再生位置はそのまま残す。 */
  stop(): void;
  /** 再生位置をその小節の頭へ動かす。再生中なら続けて鳴らす。 */
  seekToBar(barIndex: number): void;
  get isPlaying(): boolean;
  onStateChanged(listener: (playing: boolean) => void): () => void;
  /** 区間ループ。endBarIndex はその小節を含む。端の順は問わない。 */
  setRegionLoop(startBarIndex: number, endBarIndex: number): void;
  /** セクションマーカーの区間のループ（3.1 節）。 */
  setSectionLoop(markerId: string): void;
  clearLoop(): void;
  get loop(): LoopRange | null;
  /** 最後に入れたループ（clearLoop の後も残す。編集ウィンドウを閉じるまで持つ）。Ctrl+L の入れ直しに使う（11 節）。 */
  get lastLoop(): LoopRange | null;
  onLoopChanged(listener: (loop: LoopRange | null) => void): () => void;
  /** 1 がもとの速さ。範囲の外は RangeError（4 節）。 */
  setTempoFactor(factor: number): void;
  get tempoFactor(): number;
  /** 4 つともコマンドを通す（7 節）。 */
  setPartMute(trackIndex: number, mute: boolean): void;
  setPartSolo(trackIndex: number, solo: boolean): void;
  setPartVolume(trackIndex: number, volume: number): void;
  /** final はつまみを離したとき（1 回で決まる変更も）true。7 節。 */
  setPartPan(trackIndex: number, pan: number, final?: boolean): void;
  /** 曲のファイルに残さない一時のソロ（2 節）。空の配列で外す。 */
  setTemporarySolo(trackIndices: readonly number[]): void;
  /** 書き出しの試し（1.4 節）。書き出す MIDI と同じ中身の MidiFile を、曲の再生のデータと別に 1 回だけ鳴らす。曲を鳴らしていれば先に止める。readiness が 'ready' でないときは何もしない。 */
  startExportAudition(midiFile: midi.MidiFile): void;
  /** 試しの音を止め、曲の再生に戻す。試しの音が鳴り終えたときも同じ戻し方をする。 */
  stopExportAudition(): void;
  get isAuditioning(): boolean;
  onAuditionChanged(listener: (auditioning: boolean) => void): () => void;
  dispose(): void;
}
```

- (b) `stop` は再生位置を残す（alphaTab の `pause` を呼ぶ）。alphaTab の `stop` は再生位置を曲の頭へ戻すが、基本設計 03 章 7 節は Space を「その場から再生」とし、曲の頭からの再生を Shift+Space に分けているので（11 節）、止めた位置から続けられる形にするため。
- (b) `PlaybackService` は編集ウィンドウごとに 1 つ作る。編集ウィンドウごとにレンダラーを分ける（[[web-core-foundation.md#10]] の 10.2 節）ので、曲ごとに曲を鳴らす AlphaSynth が 1 つずつあるため（試しの音用の 2 つ目は 8.2 節）。

### 1.3 同梱する SoundFont の選び方

- 同梱する SoundFont は、次の 2 つの条件をどちらも満たすものから選ぶ。
- 条件 (1)：v1 で使うエレキギターの音色が、実際の楽器を録音したサンプルを収めたものであること。 <!-- req 05:f008fb25.5d84 -->
- 条件 (1)：v1 で使うベースの音色も、実際の楽器を録音したサンプルを収めたものであること。 <!-- req 05:f008fb25.85cb -->
- 波形の合成だけで作った音色は使わない。(b) 確かめる音色は、パートの楽器の 2 つが使う MIDI のプログラム（エレキギターが 30、ベースが 33。[[part-tuning-management.md#2]] の 2.1 節）の 2 つとする。v1 の楽器はこの 2 つだけで、音色はプログラムで決まるため。 <!-- req 05:f008fb25.a7fd -->
- 条件 (2)：同梱するファイルの大きさが、通常の編集のメモリの目標 400MB（[[../basic_design/09_nonfunctional.md#3]]）の内側に収まること。SoundFont は編集ウィンドウに常駐させる 3 つの 1 つとして 400MB に入れて測る（[[web-core-foundation.md#10]] の 10.2 節）。 <!-- req 05:841598a5.8917 -->
- 候補の 1 つ目は、alphaTab の npm パッケージに入っている `dist/soundfont/sonivox.sf2`（と同じ中身を圧縮した `sonivox.sf3`）とする。この 2 つの条件を満たすかは未確認（推測）で、Phase 0 で候補を鳴らして決める（決め方は基本設計 05 章 1 節）。決まったら、ファイルの名前を本節に書き、[[web-core-foundation.md#4]] の 4.1 節のコピーの台本がそのファイルだけを配るようにする。

### 1.4 書き出しの画面で MIDI を試しに鳴らすとき

- 書き出しの画面の MIDI のプレビューも、別の音源を持たず、その編集ウィンドウの `PlaybackService` と AlphaSynth で鳴らす。 <!-- req 05:716b21ea.eee0 -->
- 試しに鳴らす音には、書き出す範囲を反映する。 <!-- req 05:716b21ea.5484 -->
- 書き出すパートも反映し、書き出さないパートは鳴らさない。 <!-- req 05:716b21ea.3228 -->
- MIDI の設定（メトロノームとカウントインを含めるか、ミキサーの音量とパンを入れるか）も反映して鳴らす。 <!-- req 05:716b21ea.e26f -->
- この試しの音は、1.2 節の「書き出しの試し」の操作（`startExportAudition`）で鳴らす。渡すのは、書き出すファイルと同じ中身（切り出した範囲とパート、クリック、音量とパン）の `MidiFile` で、作り方は [[export-print.md#1]] の 1.3 節の `MidiExportService.compose` とする（2026-10-13 チャット側の決定、honnin-queue 97 番）。 <!-- req 05:d0e8eb82.f326 --> <!-- req 05:d0e8eb82.a000 --> <!-- req 05:d0e8eb82.4193 --> <!-- req 05:d0e8eb82.2d1b --> <!-- req 05:d0e8eb82.c2f2 --> <!-- req 05:d0e8eb82.43c5 -->
- 試しの音を止めたら、曲の再生のデータに戻す。 <!-- req 05:d0e8eb82.b9df -->
- 試しの音のために、利用者のループ（`loop`・`lastLoop`）・ソロ（曲のファイルのソロと一時のソロ）・メトロノームの入切・ミキサーの値（音量とパン）を書き換えない。 <!-- req 05:39eb07ff.ad03 --> <!-- req 05:39eb07ff.c1a8 --> <!-- req 05:39eb07ff.eace --> <!-- req 05:39eb07ff.a817 -->
- (b) 鳴らすのは AlphaSynth の `playOneTimeMidiFile` とする。曲の再生のデータ（`loadMidiFile` で読ませた曲の MIDI）を残したまま別の MIDI を 1 回だけ鳴らし、鳴り終えると曲の側に戻る（alphaTab 1.8.4 の実装の `AlphaSynth.playOneTimeMidiFile` と `checkForFinish` で確かめた）。曲を鳴らしていれば、`stop` と同じく再生位置を残して先に止める。曲の MIDI を作り直さずに済み、止めた後に曲の位置から続けられるため。
- (b) 試しの間だけ、AlphaSynth のチャンネルの状態を、書き出すファイルの鳴り方にそろえる。`resetChannelStates` でミュートとソロを外し、試しの MIDI が使うチャンネルの音量（`setChannelVolume`）を 1 にし、`playbackSpeed` を 1 にする。2 節のミュート・ソロ・音量と 4 節の倍率は AlphaSynth のチャンネルと速さに掛かっていて、そのままだと書き出すファイルに無い値で鳴るため。
- (b) 止めるときは `pause` を呼ぶ。次に `play` を呼ぶと、alphaTab が 1 回だけの MIDI を外して曲の再生のデータに戻る（実装の `_playInternal` で確かめた）。止めたときと鳴り終えたときに、`PlaybackService` が持っている曲の値（2 節のミュート・ソロ・一時のソロ・音量・パンと、4 節の倍率）と、6.1 節のクリックのチャンネルの状態（メトロノームの入切に当たるミュートと、メトロノームの音量）を AlphaSynth に当て直す。`resetChannelStates` はクリックのチャンネルのミュートも外すので、当て直さないと、メトロノームを切っていても試しの後にクリックが鳴るため。`loop`・`lastLoop`・`tempoFactor` と曲の `playbackInfo` は試しの間も変えないので、当て直すだけで元に戻る。
- (b) 試しの間は `isPlaying` を false のままにし、5 節の `PlaybackCursorFollow` を動かさない。試しの位置は曲の小節と対応しないため。試しの間に alphaTab の再生カーソルと位置のイベントがどう動くかは未確認（推測）で、実装の前に確かめる（12 節）。
- (b) 書き出し画面を閉じたときと、範囲・パート・設定を変えたときは、画面が `stopExportAudition` を呼ぶ（[[export-print.md#2]] の 2.2 節の `ExportService.stopMidiAudition`）。前の中身の音が、変えた後の欄の値と違って聞こえ続けないため。

## 2. 合奏・ソロ・ミュート・音量とパン

[[../basic_design/05_playback_audio.md#2]] を受ける。値の範囲（音量 0 から 100、パン -50 から 50）は [[part-tuning-management.md#2]] の 2.1 節が正。

- 曲を開いたときは、全部のパートを一緒に鳴らす（合奏）。ミュートとソロはどのパートにも付いていない状態から始まる（曲のファイルに残した値があれば、その値から始まる）。 <!-- req 05:2d508429.c254 -->
- パートごとのミュートを切り替える操作として、`PlaybackService.setPartMute` を公開する。 <!-- req 05:2d508429.0a92 -->
- パートごとのソロを切り替える操作として、`PlaybackService.setPartSolo` を公開する。 <!-- req 05:2d508429.2197 -->
- ミキサーパネル（[[screens-navigation.md#12]] の 12.5 節）と左のパートリスト（[[screens-navigation.md#7]] の 7.2 節）のトグルは、この 2 つを呼んで、パートごとにミュートとソロを入れたり切ったりする。 <!-- req 05:2d508429.4367 -->
- パートが 0 の曲では、再生を始めない。`play` は `score.tracks.length === 0` なら何もしない。 <!-- req 05:2d508429.5a3b -->
- パートが 0 の曲では、ツールバーの再生ボタンを押せない状態（グレー）にする。 <!-- req 05:2d508429.4cfb -->
- 「再生」メニューの項目も、パートが 0 の間は押せない状態にする。見せ方は [[screens-navigation.md#12]] の 12.2 節。 <!-- req 05:2d508429.c72c -->
- (b) 押せるかどうかは、画面が `score.tracks.length` と `PlaybackService.readiness`（8 節）の 2 つから決める。2 つを別々の所で見ると、片方だけを見落とした入口が鳴ってしまうため、ツールバーの状態のクラス（[[screens-navigation.md#7]] の 7.5 節）の 1 か所で決める。

### 2.1 ソロとミュートの重ね方

- ソロのパートが 1 つ以上あるときは、そのパートの AlphaSynth のチャンネルだけを鳴らす。 <!-- req 05:2534e9ea.ccb6 -->
- ソロでないパートは、中でミュートの扱いにする（曲のファイルの `isMute` は変えない）。 <!-- req 05:2534e9ea.0b49 -->
- 同じパートにミュート（`Part.mute`）とソロ（`Part.solo`）が両方付いているときは、ミュートを先にして鳴らさない。 <!-- req 05:2534e9ea.4999 --> <!-- req 13:19a8800f.d0ba --> <!-- req 13:9ac9864e.e1dc -->
- ソロは、利用者が付けたミュートを外さない。 <!-- req 05:2534e9ea.6ce1 -->
- 実際に鳴らさないかどうか（実効のミュート）は、次の 1 つの式で決める。`tempSolo` は `setTemporarySolo` の一時のソロの集合（[[00_reference.md#8.1]] の G35 で決めた形）。 <!-- req 13:19a8800f.a69b -->

```
effectiveMute(i) = part[i].mute
                || (anySolo && !part[i].solo)
                || (tempSolo.size > 0 && !tempSolo.has(i))
```

- (b) AlphaSynth へ書くのは `PlaybackMixerBinder`（7 節）だけとし、全部のパートの実効のミュートを毎回まとめて `changeTrackMute` で送る。`changeTrackSolo` は使わない。ソロを alphaTab のソロの仕組みに渡すと、明示のミュートとの重ね方が alphaTab の規則（ソロのパートはミュートより先に鳴る）になり、上の式と食い違うため。
- (b) 「再生」メニューの「ソロ再生」は、カーソルのあるパートの一時のソロの入切とする（`setTemporarySolo`）。曲のファイルに残すソロ（`Part.solo`）はミキサーパネルとパートリストのトグルで変える。一時のソロは G35 で決めた形で、その入口はメニューの項目 1 つで足りるため。

### 2.2 音量とパンの写し方

- ミキサーパネルの音量は、パートの MIDI のチャンネルの音量（Control Change の Volume）にすぐ効かせる。再生中は `changeTrackVolume` にパートの音量 ÷ 100 を渡す。 <!-- req 05:4088536b.7cca -->
- ミキサーパネルのパンは、パートの MIDI のチャンネルのパン（Control Change の Pan）に写す。再生していない間は曲のデータに書き、次に鳴らすときの MIDI に入る。再生中は、つまみの動きに合わせて、fork に足した命令でそのパートのチャンネルのパンを変えてすぐ効かせる（`PanControlChannel`、下の箇条。2026-10-10 本人決定、手段は 2026-10-11 本人決定で fork に見直し、honnin-queue 74 番）。 <!-- req 05:4088536b.b966 --> <!-- req 05:4088536b.24be --> <!-- req 13:bc93cc74.57f7 -->
- パートの値は alphaTab の `Track.playbackInfo` に次の式で持つ。alphaTab の `volume` と `balance` は 0 から 16 の値（`balance` は 8 が中央）で、MIDI を作るときに `値 × 8` を Control Change の値にする（`MidiFileGenerator._toChannelShort`）。

```
playbackInfo.volume  = volume × 16 ÷ 100        （0 → 0、100 → 16）
playbackInfo.balance = (pan + 50) × 16 ÷ 100    （-50 → 0、0 → 8、50 → 16）
volume = round(playbackInfo.volume × 100 ÷ 16)
pan    = round(playbackInfo.balance × 100 ÷ 16) − 50
```

- パンの向きは、`balance` の 0 が MIDI の Pan の 0（左の端）、16 が右の端になる。パートの -50（左の端、[[part-tuning-management.md#2]] の 2.1 節）は `balance` の 0 に当たる。
- (b) `playbackInfo` には割り切れない値（例：音量 55 なら 8.8）をそのまま入れ、整数に丸めない。`playbackInfo` が曲のファイルでの音量とパンの唯一の置き場所（[[data-model-persistence.md#4]]）で、丸めると 0 から 100 の値が保存と読み戻しで変わってしまうため。alphaTab の型は `number` で、MIDI を作る所は値を整数にしてから Control Change に入れる（`<< 7` で切り捨てる）ことを実装で確かめた。
- (b) 再生中の音量の変更に `changeTrackVolume` へ渡す値（音量 ÷ 100）は、alphaTab が再生の準備ができたときに `playbackInfo.volume ÷ 16` を同じ口（チャンネルの音量）へ渡しているのと同じ尺度にする（実装で確かめた）。MIDI の中の音量の値は、次に MIDI を作るときに新しい値になる。
- alphaTab 1.8.4 の公開の API には、再生中にパートのパンを変える口（`changeTrackVolume` に当たるパンのもの）が無い（型定義で確かめた。`changeTrackPan`・`setChannelPan` は無い）。
- ブラウザでは、曲のシンセ（AlphaSynth）はいつもワーカーの中に作られ、本体のスレッドの `AlphaTabApi.player`（`AlphaSynthWrapper`）の中身は、ワーカーへ命令を送る窓口（`AlphaSynthWebWorkerApi`）になる（実装の `BrowserUiFacade.createWorkerPlayer` で確かめた。`core.useWorkers` を見ていない）。音量の命令も、`changeTrackVolume` → `player.setChannelVolume` → ワーカーへの命令 `alphaSynth.setChannelVolume` → ワーカーの中の AlphaSynth の `setChannelVolume` の順に届く（実装の `AlphaSynthWebWorkerApi.setChannelVolume`・`AlphaSynthWebWorker` の命令の受け口・`AlphaSynth.setChannelVolume` で確かめた）。そのため、本体のスレッドから AlphaSynth の中のチャンネルを直接触る口は無い。
- そこで、alphaTab を fork して、音量の命令と同じ通り道でパンの命令を足す（[[../basic_design/13_design_decision_points.md#2]] A13 の 2026-10-11 の決定）。fork に足す公開の API は次の 1 つとする。 <!-- req 13:bc93cc74.8b53 -->

```ts
// fork した alphaTab の AlphaTabApi に足す（本家の changeTrackVolume と同じ形）
/** パートのパンを、再生中でもすぐ変える。balance は Track.playbackInfo.balance と同じ 0 から 16 の値（8 が中央）。 */
changeTrackPan(tracks: Track[], balance: number): void;
```

- `changeTrackPan` は、パートの 2 つのチャンネル（`playbackInfo.primaryChannel` と `secondaryChannel`）の両方に効かせる。alphaTab が MIDI を作るときも、Pan をこの 2 つのチャンネルへ出している（実装の `MidiFileGenerator._generateChannel` と曲の途中のパンの変化の所で確かめた）。
- (b) ワーカーの中では、受けた `balance` を alphaTab が MIDI を作るときと同じ式（`MidiFileGenerator._toChannelShort`）で Control Change の値にし、そのチャンネルが CC 10（`ControllerType.PanCoarse`）を受けたときと同じ処理（`TinySoundFont.channelMidiControl`）に渡す。鳴っている音とこの後に鳴り始める音の両方に同じ値が効き、曲の MIDI の中のパンと同じ尺度になるため。`TinySoundFont.channelMidiControl` が PanCoarse を受けるとチャンネルのパンを変えることは実装で確かめた。fork の中の通り道（本体のスレッドの窓口・ワーカーへの命令の名前・ワーカーの中の処理）は fork の側の足したものの一覧に書き、本書には API の形だけを書く。
- (b) 曲の MIDI の頭にはパートのパン（CC 10）が入っているので、ループの頭へ戻ったときやシークで曲の頭の Control Change を通り直すと、`changeTrackPan` で変えたパンが MIDI の中の値に戻りうる（未確認（推測）、12 節で確かめる）。戻ると分かったときは、'fork-command' の `PanControlChannel` が、位置が後ろへ飛んだとき（`playerPositionChanged` で小節の番号が下がったとき）に今のパンを送り直す。つまみの位置と聞こえ方が食い違ったままにしないため。
- 代わりの形（fork で効かないと分かったとき、A13 の (b')）：つまみを離したときに 1 回、再生のデータを作り直して鳴らし直す。手順は 3.2.2 の `PauseResumeStrategy` と同じ（`pause` → `loadMidiForScore` → `tickPosition` を元の位置へ → `play`）で、数十 ms の空白を受け入れる。 <!-- req 13:bc93cc74.691e --> <!-- req 13:bc93cc74.ed02 --> <!-- req 13:bc93cc74.4e1e -->
- 代わりの形（A13 の (b')）にしたときも、音量・ソロ・ミュートは今までどおり再生中にすぐ効かせる。作り直して鳴らし直すのは、パンのつまみを離したときだけとする（基本設計 13 章 A13）。 <!-- req 13:bc93cc74.59a8 -->
- fork の命令を使う形と代わりの形（A13 の (b')）のどちらにしても、パートの `pan`（[[part-tuning-management.md#2]] の 2.1 節）とミキサーパネルの画面の仕様（[[screens-navigation.md#12]] の 12.5 節）は変えない。どちらにするかで替わるのは、下の `PanControlChannel` の中だけとする（基本設計 13 章 A13）。 <!-- req 13:bc93cc74.911f -->
- fork に頼る所は、次の `PanControlChannel` の 1 つの部品に閉じ込め、この部品の外から `changeTrackPan` を呼ばない。alphaTab の版を上げたときに見る所を 1 つにするため。fork の命令を使う形と代わりの形のどちらにするかは、この部品を作るときに渡す 1 つの値で決め、その値だけで替えられるようにする（3.2.2 の `AudioSyncStrategy` と同じ形）。 <!-- req 13:bc93cc74.2007 -->

```ts
// packages/core/src/playback/PanControlChannel.ts
/** 再生中のパンを AlphaSynth へ効かせる所。fork に足した changeTrackPan を呼ぶのはここだけ（A13）。 */
export interface PanControlChannel {
  readonly kind: 'fork-command' | 'reload-on-release';
  /** パートのパン（-50 から 50）を効かせる。'fork-command' はすぐ changeTrackPan を呼ぶ。'reload-on-release' は覚えておくだけ。再生していないときは何もしない。 */
  apply(trackIndex: number, pan: number): void;
  /** つまみを離したとき。'reload-on-release' は覚えた値があれば再生のデータを作り直して鳴らし直す。'fork-command' は何もしない。 */
  release(): void;
}
```

- (b) 'fork-command' の形で口が見つからないとき（入っている alphaTab の `AlphaTabApi` に `changeTrackPan` が無いとき）は、作るときに 'reload-on-release' に替える。あわせて、入っている alphaTab に `changeTrackPan` が在ることを確かめる単体テストをアプリの側に置く。fork でない alphaTab が入ったときや、版を上げて当て直しを忘れたときに、パンが黙ってつまみに付いてこなくなるのを、ビルドの前に見つけるため（9.2 節のカポのテストと同じ考え方）。
- (b) fork の側にも、`changeTrackPan` を受けたワーカーの中の AlphaSynth で、そのチャンネルのパンが変わることを確かめる単体テストを置く。基本設計 01 章 AD-4 の「再生中のパンの単体テスト」はこの 2 つを指し、本家の版を上げて足したものを当て直したときに両方を走らせる。

### 2.3 2 つ目のボイス

- 2 つ目のボイス（[[editing-core.md#3]] の 3.1 節の終わりの箇条）の拍も、1 つ目と同じパートの音として、同じ時刻に一緒に鳴らす。(b) ボイスごとに鳴らし分ける仕組みは持たない。要件 4.1 がボイスを「同時に鳴る別の線」としていて、alphaTab の MIDI を作る所は小節の全部のボイスを同じパートのチャンネルに出すため。2 つ目のボイスの入力のときの試しの音も、8.2 節の 1 つ目と同じ出し方にする。

## 3. ループ再生

### 3.1 区間ループとセクションループ

[[../basic_design/05_playback_audio.md#3.1]] を受ける。セクションの区間（マーカーの小節から次のマーカーの手前まで）は [[data-model-persistence.md#6]] の 6.1 節が正。

- ループの範囲は、開始の小節と終わりの小節の番号で指定する（区間ループ、`LoopRange` の `'region'`）。 <!-- req 05:f38bb4a6.b921 -->
- セクションマーカーを選んだときは、そのマーカーのセクションの区間をループの範囲にする（`setSectionLoop`）。 <!-- req 05:f38bb4a6.8a44 -->
- マーカーとループの範囲のつながりは、設定したときだけでなく、その後にマーカーが動いたときも続く。 <!-- req 05:dcb0afee.9baa -->
- マーカーを選んで作ったループの範囲は、マーカーの位置が変わったら、同じだけ動かす。 <!-- req 05:dcb0afee.6e80 -->
- そのために、マーカーから作ったループは、開始と終わりの小節の番号ではなく、選んだマーカーの `id` で持つ（`LoopRange` の `'section'`）。 <!-- req 05:4e921fc7.d381 -->
- 小節の番号は、鳴らすたびに（ループの頭へ戻るたびと、`play` のたびに）マーカーから引き直す。 <!-- req 05:4e921fc7.b986 -->
- マーカーの位置が変わったとき（マーカーを動かしたときと、[[editing-core.md#10]] の小節の挿入と削除で番号がずれたとき）は、次の周回から新しい範囲でループする。 <!-- req 05:4446d364.4648 -->
- 範囲の切り替えは、ループの境目で行う（3.2 節の反映の時機と同じ）。 <!-- req 05:4446d364.fb54 -->
- 選んでいたマーカーが消されたときは、消された時点の小節の番号を、決まった値として引き継ぐ。 <!-- req 05:4e4d27d2.e899 -->
- そして、そのループを区間ループ（`'region'`）に替える。 <!-- req 05:4e4d27d2.97ba -->
- 替えたことは Warning の `PLAY-004` で知らせる（[[00_reference.md#5]]）。 <!-- req 05:4e4d27d2.ccb1 -->
- 区間ループの開始と終わりは、利用者が手で入れて作れる。 <!-- req 05:7a05a95a.9564 -->
- 手で入れて作った区間ループは、マーカーを持たないので、マーカーが変わっても動かない。 <!-- req 05:7a05a95a.731e -->
- 区間ループの範囲は、譜面の上の小節番号の帯で作る（2026-10-10 本人決定、honnin-queue 72 番。帯の部品は [[screens-navigation.md#7]] の 7.7 節）。帯の上をドラッグするとその範囲で、帯の上をクリックするとその 1 小節で、`setRegionLoop` を呼ぶ。範囲の両端のつまみを動かしたときも、動かした後の範囲で `setRegionLoop` を呼び直す。
- Ctrl+L で入れ直すときの範囲の決め方は 11 節。そのために `PlaybackService` は、最後に入れたループを `lastLoop` に持つ。`clearLoop` しても `lastLoop` は消さない。
- (b) `lastLoop` は区間ループもセクションループもそのまま持つ（`LoopRange` の形）。「前に作った範囲」は利用者が最後に聞いていたループで、どちらの作り方でも同じに入れ直せる方が分かりやすいため。セクションループのマーカーが消えていたときは、3.1 節の上の決まりのとおり区間ループに替わっているので、その範囲で入れ直す。
- ループの終わりに着いたら、再生位置を開始の小節の頭へシークし直して、鳴らし続ける。 <!-- req 05:d39502cc.db36 -->
- (b) ループは alphaTab の `playbackRange`（開始と終わりの tick）と `isLooping` に渡し、終わりから頭へ戻すのは alphaTab に任せる。範囲は、開始の小節の頭の tick から、終わりの小節の次の小節の頭の tick までとする。alphaTab に範囲の中を繰り返させれば、頭へ戻るシークを自前で出さずに済むため。
- (b) マーカーの変化は、`CommandHistory.onCommandApplied`（[[editing-core.md#2]] の 2.2 節）で `kind` が小節を足す・消すかマーカーを変えるコマンド（`insert-bar`・`delete-bar` と、3 つのマーカーのコマンド）のときに見て、`appMeta.sectionMarkers` から範囲を引き直す。引き直した範囲は次のループの境目で `playbackRange` に入れる。マーカーが無くなっていたら、その場で `'region'` に替えて `PLAY-004` を出す。

### 3.2 ループ再生中の編集

[[../basic_design/05_playback_audio.md#3.2]] を受ける。

- ループ再生中の編集（音符を足す・直す）も、ふだんと同じコマンド（[[editing-core.md#2]]）を通し、`Score` にすぐ当てる。再生中かどうかで編集の通り道を変えない。 <!-- req 05:ef88e568.fcd9 -->
- ループ再生中は、鳴っている AlphaSynth への反映を、ループの頭（次の周回の初め）まで遅らせる。 <!-- req 05:ef88e568.13f7 --> <!-- req 13:7cd8cff5.266b -->
- ループしていない普通の再生では、鳴っている AlphaSynth への反映を、次の小節の頭まで遅らせる。 <!-- req 05:ef88e568.5822 --> <!-- req 13:7cd8cff5.ab04 --> <!-- req 13:ef8ae04e.ba78 -->
- どちらでも、譜面の見た目はすぐ変わる（`CommandHistory` がコマンドの後に描き直しを頼む、[[editing-core.md#2]] の 2.4 節）。 <!-- req 05:ef88e568.18d4 -->
- 譜面（画面の表示）はすぐ直り、利用者は直した結果をすぐ見られる。 <!-- req 05:de4197bf.75cc -->
- 音の反映だけが境目（ループ再生中はループの頭、普通の再生では次の小節の頭）まで遅れることを、画面に印で出す。反映を待っている小節には、譜面の小節の上に「変更待ち」の印を出し、反映したら消す。印の色は [[screens-navigation.md#15]] の 15.8 節（info-tag のバッジの形）。 <!-- req 05:de4197bf.55e5 --> <!-- req 13:ef8ae04e.949f -->
- パートを足すときは、遅らせて反映する扱いにせず、再生を止めてから足す。 <!-- req 05:ca3421fc.ec5c -->
- パートを消すときも、再生を止めてから消す。 <!-- req 05:ca3421fc.fce2 -->
- パートを並べ替えるときも、再生を止めてから並べ替える。 <!-- req 05:ca3421fc.2f7e -->
- パートの音色を変えるときも、再生を止めてから変える。 <!-- req 05:ca3421fc.9056 -->
- (b) 止めるのは、そのコマンドを発行する画面（パート管理パネル・パートを足すダイアログ・音色を変えるメニュー）で、コマンドの前に `PlaybackService.stop()` を呼ぶ。止めずに発行されたときのために、`PlaybackSyncController` は `kind` がこの 4 つ（`AddPartCommand`・`RemovePartCommand`・`ReorderPartsCommand`・`SetPartInstrumentCommand` の kind）のコマンドを受けたら、再生中ならその場で止めて MIDI を作り直す。入口が増えても音が崩れないため。
- 入力したときの試しの音（ノートオン）は遅らせない。 <!-- req 05:067d36a4.9728 -->
- 遅らせるのは、曲の再生のデータ（MIDI）への反映だけとする。 <!-- req 05:7b911088.6bd3 -->
- 再生中でも、置いた音はすぐ鳴らす（8.2 節）。 <!-- req 05:7b911088.688f -->

#### 3.2.1 遅らせて反映するしくみ（`PlaybackSyncController`）

```ts
// packages/core/src/playback/PlaybackSyncController.ts
/** CommandHistory のうち使う所だけ。 */
export interface CommandAppliedSource {
  onCommandApplied(listener: (event: CommandAppliedEvent) => void): () => void;
}
/** 再生中の編集を音へ反映するやり方（A4、3.2.2）。 */
export interface AudioSyncStrategy {
  readonly kind: 'partial-reload' | 'pause-resume';
  /** 境目に着いたときに呼ぶ。dirtyTrackIndices は 1 つ以上。wholeScore は曲全体に掛かる変更があったとき true。 */
  sync(dirtyTrackIndices: readonly number[], wholeScore: boolean, api: PlaybackApi): void;
}

/** 編集ウィンドウごとに 1 つ。 */
export class PlaybackSyncController {
  constructor(api: PlaybackApi, playback: PlaybackService, history: CommandAppliedSource,
              tickMap: TickMap, strategy: AudioSyncStrategy);
  /** 反映を待っているパート（昇順の写し）。 */
  get dirtyTrackIndices(): number[];
  /** 「変更待ち」の印を出す小節（昇順の写し）。 */
  get pendingBarIndices(): number[];
  onPendingChanged(listener: () => void): () => void;
  dispose(): void;
}

/** tick と小節の番号の対応。alphaTab の MasterBar の長さを足し合わせて作る。 */
export interface TickMap {
  tickToBarIndex(tick: number): number;
  barStartTick(barIndex: number): number;
}
```

- 再生中に `onCommandApplied` を受けたら、`affectedTrackIndices` を「反映を待つパート」の集合に足し、AlphaSynth にはすぐ渡さない。再生していないときは集合に溜めず、次の `play` の前に MIDI を作り直す。
- 境目は、alphaTab の `playerPositionChanged`（5 節と同じイベント）で小節の番号が変わったときに見る。ループ再生中はループの頭へ戻ったとき（番号が下がったとき）、普通の再生では次の小節に入ったときを境目とする。
- 境目に着いて、集合が空でなければ `strategy.sync` を呼び、集合と「変更待ち」の印を空にする。
- (b) 境目の判定（再生中か・小節の番号が変わったか・集合が空でないか）は、条件網羅（C2）で単体テストする。3 つの条件が重なり、どれか 1 つを見落とすと音が黙って古いままになるため（作り直す前の本書 7 節の決まりを引き継ぐ）。
- 変えたパートだけを読み込み直して、大きな曲でも境目での遅れを小さくする（`PartialReloadStrategy`）。 <!-- req 05:b259ed92.99fa -->
- テンポの変更（`SetTempoCommand`）は、曲全体に掛かる変更として、全部のパートの再生のデータを作り直す（`wholeScore` を true にする）。 <!-- req 05:b259ed92.eef8 -->
- 拍子の変更（`SetTimeSignatureCommand`）も、全部のパートの再生のデータを作り直す。 <!-- req 05:b259ed92.c8d9 -->
- 小節の挿入（`InsertBarCommand`）も、全部のパートの再生のデータを作り直す。 <!-- req 05:b259ed92.b77f -->
- 小節の削除（`DeleteBarCommand`）も、全部のパートの再生のデータを作り直す。 <!-- req 05:b259ed92.3544 -->
- (b) 「変更待ち」の印を出す小節は、反映を待っているコマンドの対象の小節とする。コマンドの `kind` だけでは小節が分からないので、`PlaybackSyncController` は `CursorController` の位置（[[editing-core.md#4]] の 4.1 節）をコマンドの時点で写して持つ。曲全体に掛かる変更（テンポ・拍子・小節の挿入と削除）のときも、そのコマンドの小節（テンポか拍子を変えた小節、挿入か削除をした位置の小節）に印を出す。全部の小節に出すと、どこを変えたかが分からなくなるため。

#### 3.2.2 部分の差し替えができるか（A4）

- AlphaSynth の API が「再生中の部分の差し替え」をどこまでできるかは、Phase 1 で試作して確かめる（[[../basic_design/13_design_decision_points.md#2]] A4）。 <!-- req 05:e8710040.d8e6 -->
- 差し替えが足りないときの代わりの形として、ループの境目でいったん止め、新しいデータですぐに鳴らし直す（`PauseResumeStrategy`）。境目での数十 ms の空白は受け入れる。 <!-- req 05:e8710040.7696 -->
- alphaTab 1.8.4 の公開の API には、パートを選んで再生のデータを差し替える口が無い（型定義で確かめた）。`loadMidiForScore` は曲全体の MIDI を作り直し、鳴っている再生を止める（型定義の注記「This will result in the player to stop playback」）。そのため、A4 を確かめるまでの既定は `PauseResumeStrategy` とし、`pause` → `loadMidiForScore` → `tickPosition` を元の位置へ → `play` の順にする。`PartialReloadStrategy` は、A4 で差し替えの口が見つかったときに足す。 <!-- req 13:1965e5f1.b7c6 -->
- どちらの形にするかは、`PlaybackSyncController` を作るときに渡す 1 つの値で決め、その値だけで替えられるようにする（作り直す前の本書 5 節の決まりを引き継ぐ）。 <!-- req 13:1965e5f1.9fed -->
- alphaTab は、同じ `Score` を描き直すとき（`renderTracks`・`renderScore` に同じ `Score` を渡すとき）は MIDI を作り直さない（実装の `_internalRenderTracks` で確かめた）。そのため、`CommandHistory` の描き直しは鳴っている音を変えず、上の境目まで遅らせる形と両立する。

## 4. 減速再生

[[../basic_design/05_playback_audio.md#4]] を受ける。

- テンポを落とすのは、音声の時間を伸ばす処理（タイムストレッチ）ではなく、再生のテンポの値そのものを変えて行う。alphaTab の `playbackSpeed` に倍率を渡す。 <!-- req 05:effbd6c7.8251 -->
- 再生のテンポの倍率を指定する操作として、`PlaybackService.setTempoFactor(factor: number): void` を公開する。 <!-- req 05:3bb8db2b.aafa -->
- 倍率は、小節の基準のテンポ（`Bar.tempoBpm`）に掛ける値として鳴らす。1 がもとの速さで、曲のテンポの値は変えない。 <!-- req 05:3bb8db2b.c2b6 -->
- メソッドのシグネチャは上の 1 つとし、渡せる倍率は 0.125 から 8.0 まで（alphaTab の `playbackSpeed` の範囲。型定義の注記で確かめた）、範囲の外と数でない値は `RangeError` にする。倍率は編集ウィンドウを閉じるまで持ち、曲のファイルに書かない。 <!-- req 05:3bb8db2b.7eff -->
- 画面で選べる倍率は、25% から 100% までの 5% 刻み（0.25 から 1.00 までの 16 段）とする（2026-10-10 本人決定、honnin-queue 73 番）。選ぶ所は、ステータスバーのテンポの表示の隣のスライダー（[[screens-navigation.md#7]] の 7.4 節）。
- メニューの「減速再生」は、倍率を 1（100%）と、前に選んだ倍率とで入れ替える。前に選んだ倍率は、スライダーかこのメニューで 1 より小さくした最後の値で、まだ無ければ 0.75（75%）とする。前に選んだ倍率も、編集ウィンドウを閉じるまで持つ。

```ts
// packages/core/src/playback/TempoFactorSelector.ts
/** スライダーで選べる倍率の百分率（25 から 100 までの 5 刻み）。 */
export const TEMPO_FACTOR_PERCENT_STEPS: readonly number[];
/** 前に選んだ倍率がまだ無いときの「減速再生」の倍率（百分率）。 */
export const DEFAULT_SLOWDOWN_PERCENT = 75;

/** 編集ウィンドウごとに 1 つ。スライダーとメニューの「減速再生」の両方がこれを通す。 */
export class TempoFactorSelector {
  constructor(playback: Pick<PlaybackService, 'setTempoFactor' | 'tempoFactor'>);
  /** スライダーの値。TEMPO_FACTOR_PERCENT_STEPS の 1 つで、それ以外の値は RangeError。setTempoFactor(percent / 100) を呼ぶ。 */
  selectPercent(percent: number): void;
  /** 100 と、前に選んだ 100 より小さい倍率（無ければ 75）を入れ替える。 */
  toggleSlowdown(): void;
  get percent(): number;
  /** 前に選んだ 100 より小さい倍率（百分率）。まだ無ければ DEFAULT_SLOWDOWN_PERCENT。 */
  get lastSlowPercent(): number;
  onChange(listener: () => void): () => void;
}
```

- (b) 入れ替えの持ち手は `PlaybackService` に入れず、別のクラスにする。`PlaybackService` が公開する操作は 1.2 節の 8 種に限り、ここに無い操作を足さないため。`TempoFactorSelector` は倍率の操作（`setTempoFactor`）だけを呼ぶ。
- (b) 倍率は百分率の整数で持ち、`setTempoFactor` に渡すときに 100 で割る。0.05 刻みの小数を持つと、足し引きの誤差で 16 段の値と同じかの比べ方が崩れるため。

## 5. 再生カーソルとスクロールの追従

[[../basic_design/05_playback_audio.md#5]] を受ける。

- 再生カーソルは、今の再生位置を示す。 <!-- req 05:e91567e4.f89d -->
- 再生中は、再生カーソルを譜面の上に出す。 <!-- req 05:e91567e4.a51a -->
- 出すのは alphaTab の再生カーソルとする。 <!-- req 05:661e655a.223e -->
- alphaTab の設定の `player.enableCursor` を `true` にする（1.1 節）。 <!-- req 05:661e655a.09b9 -->
- カーソルの位置の計算を自前で持たない。 <!-- req 05:5424bf5a.20fb -->
- カーソルの描画も自前で持たない。 <!-- req 05:5424bf5a.1231 -->
- alphaTab の再生位置のイベント（`playerPositionChanged`）を購読する。 <!-- req 05:048843e8.0636 -->
- 再生カーソルがフォーカス表示の範囲の外に出たときだけ、表示の範囲を動かす（`ViewModeController.revealBar`、[[view-modes.md#1]] の 1.1 節）。 <!-- req 05:048843e8.8efd -->
- カーソルが表示の範囲の中にある間は、スクロールしない。 <!-- req 05:048843e8.ad47 -->

```ts
// packages/core/src/playback/PlaybackCursorFollow.ts
/** ViewModeController のうち使う所だけ。 */
export interface PlaybackViewport {
  isBarVisible(barIndex: number): boolean;
  revealBar(barIndex: number): void;
}
/** 編集ウィンドウごとに 1 つ。 */
export class PlaybackCursorFollow {
  constructor(api: { playerPositionChanged: IEventEmitterOfT<PositionChangedEventArgs> },
              viewport: PlaybackViewport, tickMap: TickMap);
  dispose(): void;
}
```

- `PlaybackCursorFollow` は、位置のイベントで小節の番号が変わり、かつ `isBarVisible` が false のときだけ `revealBar` を呼ぶ。小節の中の動きでは何もしない。
- (b) alphaTab のスクロール（`player.scrollMode`）は `ScrollMode.Off` にする（1.1 節）。alphaTab の `OffScreen` も「外に出たときだけ」動くが、alphaTab が動かすのは自分のスクロールの要素で、フォーカス表示の範囲（描く小節を絞る形、[[view-modes.md#1]] の 1.1 節）を知らない。2 つが同時に動くと、表示がずれるため。

## 6. メトロノーム・カウントイン・タップテンポ・テンポの数値入力・入力のときのクリック

[[../basic_design/05_playback_audio.md#6]] を受ける。設定の欄は [[screens-navigation.md#12]] の 12.10 節、テンポの数値入力の入口は [[screens-navigation.md#7]] の 7.4 節、`SetTempoCommand` は [[editing-core.md#3]] の 3.8 節が正。

### 6.1 クリックの鳴らし方

- メトロノームは、別の音源を持たず、AlphaSynth で鳴らす。 <!-- req 05:54ac75c2.bb6e -->
- カウントインも、別の音源を持たず、AlphaSynth で鳴らす。 <!-- req 05:54ac75c2.49a1 -->
- 入力のときのクリック（6.5 節）も、別の音源を持たず、AlphaSynth で鳴らす。 <!-- req 05:54ac75c2.bf6f -->
- メトロノームは、1 節のとおり別の音源を持たず、同梱の SoundFont の音で鳴らす。 <!-- req 05:ce3d6b29.d903 -->
- (b) 再生中のクリックは、曲の MIDI を作るときに、クリックの音符を MIDI に足して一緒に読ませる。`MidiFileGenerator`（`AlphaSynthMidiFileHandler` を渡す）で作った `MidiFile` に、拍ごとのクリックの `NoteOnEvent` と `NoteOffEvent` を `addEvent` で足し、`loadMidiFile` で読ませる。クリックは曲のパートに使わない 1 つのチャンネルに置き、メトロノームの入切はそのチャンネルのミュートで、音量はそのチャンネルの音量で、すぐ効かせる。alphaTab 自身のメトロノーム（`metronomeVolume`）は使わない。alphaTab のメトロノームは決まった 1 つの音（MIDI の打楽器の 33 番）を同じ強さで鳴らすだけで（実装の `SynthConstants.MetronomeKey` で確かめた）、音色の選択と 1 拍目の強調ができないため。
- (b) 再生していない間のクリックとカウントインは、クリックの音符だけの `MidiFile` を作り、`playOneTimeMidiFile` で鳴らす。`playBeat`・`playNote`・`playOneTimeMidiFile` は鳴っている曲を止める（型定義の注記）ので、再生中のクリックには使わない。
- 上の 2 つの形で、alphaTab の再生カーソルと位置のイベントが崩れないかと、再生していない間にクリックだけを続けて鳴らせるかは、未確認（推測）。実装の前に確かめる（12 節）。

### 6.2 メトロノームの音色と音量

- メトロノームの音色は、複数のプリセットを用意する。 <!-- req 05:ce3d6b29.72a4 -->
- 音色のプリセットは、設定ダイアログ（[[screens-navigation.md#12]] の 12.10 節の 2 項目目）から選べるようにする。 <!-- req 05:ce3d6b29.71b9 --> <!-- req 13:0a8438f2.5287 -->
- MVP では、アコースティックの系統（木を打つようなクリックの音）を 1 つ同梱する（下の表の `wood`）。 <!-- req 05:ce3d6b29.9bd3 --> <!-- req 13:0a8438f2.c130 -->
- MVP では、電子の系統（電子的なビープの音）も 1 つ同梱する（下の表の `beep`）。 <!-- req 05:ce3d6b29.57d6 --> <!-- req 13:0a8438f2.ce01 -->
- どの音色でも、1 拍目の強調は、音の高さを上げる向きで作る。 <!-- req 05:ce3d6b29.5257 --> <!-- req 13:0a8438f2.31a4 -->
- 強調は、同梱の SoundFont の音で、1 拍目に高い音を鳴らして作る（下の表の「1 拍目」の列）。 <!-- req 05:ce3d6b29.efd7 -->

| id | 系統 | 鳴らす音（SoundFont の中の音） | 2 拍目から | 1 拍目 |
|---|---|---|---|---|
| `wood` | アコースティック | MIDI の打楽器のチャンネル（10 チャンネル目）のウッドブロック | 77（Low Wood Block） | 76（Hi Wood Block） |
| `beep` | 電子 | MIDI のプログラム 81（Lead 1、矩形波の音色） | ノート 81（A5） | ノート 93（A6、1 オクターブ上） |

- (b) プリセットは上の 2 つとし、既定は `wood` とする。基本設計の「最低でも 1 種ずつ」の最低の数にそろえ、Phase 0 で SoundFont に音があるかを確かめる対象を増やさないため。どちらも MIDI の標準の音色表（General MIDI）の音で、1 拍目は同じ音色の高い音（ウッドブロックの高い側と、1 オクターブ上）にした。選んだ SoundFont にこの音があるかは、1.3 節の候補と一緒に Phase 0 で確かめる。今のコードの id（`acoustic`・`click`・`wood`・`beep` の 4 つ、`packages/core/src/ui/types.ts`）は、実装の段で上の 2 つに直す。
- (b) メトロノームの音量は 0 から 100 の整数、既定は 80 とする。パートの音量（0 から 100）と同じ形にそろえるため。既定は今のコードの既定（0 から 1 の 0.8）を同じ尺度に写した値。クリックのチャンネルの音量には音量 ÷ 100 を渡す（2.2 節の音量と同じ尺度）。

### 6.3 カウントイン

- 再生を始める前に、今の拍子の 1 小節ぶんのクリックを鳴らしてから再生を始める `CountInController` を、既定の動きとする。 <!-- req 05:f1bc9414.b36a --> <!-- req 13:a060aa94.ac58 -->
- 設定ダイアログで、長さの倍率として「1 小節ぶん」を選べるようにする。 <!-- req 05:f1bc9414.b61a --> <!-- req 13:a060aa94.9225 -->
- 設定ダイアログで、「2 小節ぶん」も選べるようにする。 <!-- req 05:f1bc9414.1dd5 --> <!-- req 13:a060aa94.cee0 -->

```ts
// packages/core/src/playback/CountInController.ts
export class CountInController {
  constructor(clicks: ClickScheduler, playback: Pick<PlaybackService, 'play'>, preferences: PlaybackPreferencesSource);
  /** クリックを鳴らし終えたら play() する。途中で cancel() されたら play() しない。
   *  @throws bpm か beatsPerMeasure が正でないとき、すでに鳴らしているとき。 */
  start(context: { beatsPerMeasure: number; bpm: number }): Promise<void>;
  cancel(): void;
}
```

- (b) 今の拍子とテンポは、再生を始める位置の小節の値（継いだ値を含む、[[editing-core.md#3]] の 3.2 節）を使う。カウントインのテンポにも 4 節の倍率を掛ける。減速して聞くときに、カウントインだけ速いと入りが合わないため。
- (b) カウントインを鳴らしている間に停止（Space）を押したら `cancel` し、曲を鳴らし始めない。

### 6.4 タップテンポとテンポの数値入力

- ボタンを続けてクリックした間隔の、直近のタップの平均から BPM を出す。 <!-- req 05:b5027d9b.6ee5 -->
- 平均に使うタップの回数は、設定ダイアログで 2 回から 8 回の範囲で選べる。 <!-- req 05:b5027d9b.e48c -->
- 平均に使う回数の既定は 4 回とする。 <!-- req 05:b5027d9b.9070 -->
- 出した BPM は、`Bar.tempoBpm` を変えるコマンド（`SetTempoCommand`）を発行して曲に入れる。 <!-- req 05:b5027d9b.c406 -->
- ステータスバーのテンポの表示をクリックすると、数値の入力に切り替わる（[[screens-navigation.md#7]] の 7.4 節）。 <!-- req 05:7f3fc218.a095 -->
- 数値の入力を確定すると、タップテンポと同じコマンド（`SetTempoCommand`、`Bar.tempoBpm` を変える）を発行する。 <!-- req 05:7f3fc218.a0ec -->
- 入れられる BPM の範囲は、実装の段で決めてよい。決めた値は `SetTempoCommand` の定数（今のコードは `MIN_TEMPO_BPM` が 20、`MAX_TEMPO_BPM` が 400）の 1 か所に置き、数値の入力とタップテンポの両方がそれを使う。 <!-- req 05:7f3fc218.3d59 -->
- 拍子の変更も同じ操作の形にする。ステータスバーの拍子の表示をクリックして入れ、`SetTimeSignatureCommand` を発行する（[[editing-core.md#10]]）。 <!-- req 05:7f3fc218.18c9 -->

```ts
// packages/core/src/playback/TapTempoController.ts
export const TAP_RESET_GAP_MS = 2000;
export class TapTempoController {
  constructor(deps: { history: { execute(command: Command): CommandOutcome }; target: EditTarget;
                      preferences: PlaybackPreferencesSource; now?: () => number });
  get currentBpm(): number | null;
  /** 1 回のタップ。2 回目から BPM を返す（1 回目は null）。 */
  tap(): number | null;
  /** 出した BPM を、その小節の SetTempoCommand として確定する。発行したら true。 */
  commit(barIndex: number): boolean;
  reset(): void;
}
```

- (b) 前のタップから 2 秒（`TAP_RESET_GAP_MS`）より空いたら、数え直す。2 秒の間隔は 30 BPM に当たり、それより遅いテンポを叩いて合わせる使い方は無いと見て、前の曲の叩きが混ざらないようにするため（今のコードの値）。
- (b) 出した BPM は整数に丸め、上の範囲の端に収める。`commit` は、カーソルのある小節（タップテンポのボタンを押したときの `CursorController` の位置）に `SetTempoCommand` を出す。

### 6.5 入力のときのクリック

- 再生していない編集の間も、メトロノームが入っていれば、今のテンポと拍子でクリックを鳴らし続ける。 <!-- req 05:32c76be0.1023 -->
- 再生していない間に AlphaSynth でクリックだけを鳴らせるかは未確認で、実装の前に確かめる（6.1 節の 2 つ目の形、12 節）。 <!-- req 05:32c76be0.900d -->
- 入切は、「再生」メニューのメトロノームの項目（Ctrl+M、11 節）と同じ 1 つの値を使う。 <!-- req 05:32c76be0.4640 -->
- 音色と音量は、6.2 節の設定の値を同じく使う。 <!-- req 05:32c76be0.6b2a -->
- このクリックは、入力への合図ではない。置く操作に応じて鳴るのではなく、メトロノームが入っている間は拍に合わせて鳴り続ける。 <!-- req 05:32c76be0.cb7e -->
- 入力のときの合図は、[[screens-navigation.md#11]] のハイライトの 1 つだけとする。 <!-- req 05:32c76be0.fc80 -->

```ts
// packages/core/src/playback/MetronomeService.ts
/** 編集ウィンドウごとに 1 つ。入切の値を 1 つだけ持つ。 */
export class MetronomeService {
  constructor(clicks: ClickScheduler, playback: Pick<PlaybackService, 'isPlaying' | 'onStateChanged'>,
              preferences: PlaybackPreferencesSource);
  get enabled(): boolean;
  setEnabled(enabled: boolean): void;
  onEnabledChanged(listener: (enabled: boolean) => void): () => void;
  dispose(): void;
}
/** クリックの音符を作って AlphaSynth へ渡す所（6.1 節の 2 つの形）。 */
export interface ClickScheduler {
  /** 曲の MIDI に足すクリック（再生中）。 */
  appendToSongMidi(midi: MidiFile, preset: MetronomePresetId, volume: number): void;
  /** クリックだけを鳴らす（再生していない間とカウントイン）。鳴らし終えたら resolve する。 */
  playClicksOnly(bars: number, beatsPerMeasure: number, bpm: number, preset: MetronomePresetId, volume: number): Promise<void>;
  stopClicksOnly(): void;
}
export type MetronomePresetId = 'wood' | 'beep';
```

- (b) `MetronomeService` は、入っている間、再生していなければクリックだけを鳴らし続け、再生が始まったらクリックだけの鳴らし方を止めて曲の MIDI のクリックに任せ、再生が止まったらクリックだけの鳴らし方に戻す。再生中かどうかで鳴らし方が替わっても、利用者から見える入切は 1 つにするため。

### 6.6 設定の値

- メトロノームの音量と音色は、設定ダイアログで変えられるようにする（6.2 節の範囲）。 <!-- req 05:29fd4d8e.4646 -->
- カウントインの長さ（倍率）も、設定ダイアログで変えられるようにする（6.3 節の 1 か 2）。 <!-- req 05:29fd4d8e.ba30 -->
- タップテンポの感度も、設定ダイアログで変えられるようにする（6.4 節の 2 回から 8 回）。 <!-- req 05:29fd4d8e.9322 -->
- 設定の値は `AppPreferencesService`（`preferences.json`、[[data-model-persistence.md#13]]）に置き、再生の側は次の形で読む。(b) 読み込むのは再生を始めるときと、設定ダイアログで値を変えたときとする。設定を変えた直後の再生から効かせるため。 <!-- req 13:953ef585.24b7 -->

```ts
// packages/core/src/playback/types.ts
export interface PlaybackPreferences {
  metronomePresetId: MetronomePresetId;
  /** 0 から 100 の整数。 */
  metronomeVolume: number;
  countInMeasureMultiplier: 1 | 2;
  /** 2 から 8 の整数。 */
  tapTempoSampleSize: number;
}
export interface PlaybackPreferencesSource { load(): Promise<PlaybackPreferences>; }
```

## 7. ミキサーの値の流れ

[[../basic_design/05_playback_audio.md#7]] を受ける。ミキサーパネルの画面は [[screens-navigation.md#12]] の 12.5 節。

- 音量は、パート（[[part-tuning-management.md#2]] の 2.1 節、曲のファイルの `Track.playbackInfo`）に保存した値を、そのまま AlphaSynth のチャンネルの制御へつなぐ。値の流れは一方向にする。 <!-- req 05:a32b9a15.a58a -->
- パンも、パートに保存した値を、そのまま AlphaSynth のチャンネルの制御へ一方向につなぐ。つなぐ通り道は、再生していない間は次に作る MIDI の Control Change の Pan、再生中は `PanControlChannel` が呼ぶ fork の `changeTrackPan`（どちらも 2.2 節）とする。 <!-- req 05:a32b9a15.c9ef -->
- ミュートも、パートに保存した値を、そのまま AlphaSynth のチャンネルの制御へ一方向につなぐ（ソロとの重ね方は 2.1 節）。 <!-- req 05:a32b9a15.75f7 -->
- 順番は、画面の操作 → コマンド → `Score` の変更 → AlphaSynth への反映とし、必ず `Score` を通す。 <!-- req 05:a32b9a15.4a59 -->
- 画面からシンセを直接操作しない。`PlaybackService` の `setPartVolume`・`setPartPan`・`setPartMute`・`setPartSolo` も、コマンドを発行するだけで AlphaSynth に触れない。 <!-- req 05:a32b9a15.c7d0 -->

| 変えるもの | コマンド | 決まり |
|---|---|---|
| 音量 | `SetPartVolumeCommand` | 0 から 100 の整数（[[part-tuning-management.md#2]] の 2.1 節）。範囲の外は発行しない |
| パン | `SetPartPanCommand` | -50 から 50 の整数。範囲の外は発行しない |
| ソロ | `SetPartSoloCommand` | 真偽の値 |
| ミュート | `SetPartMuteCommand` | 真偽の値 |

- 4 つのコマンドの `affectedTrackIndices` はそのパートとする。4 つとも今のコード（`packages/core/src/parts/commands/partAttributeCommands.ts`）にある。
- (b) 音量とパンのコマンドは `canMergeWith`・`mergeWith`（[[editing-core.md#2]] の 2.2 節）を持ち、同じパートのスライダーを続けて動かした間は履歴の 1 つの項目にまとめる。取り消すとスライダーを動かし始める前の値に戻る。スライダーを動かすたびに履歴が積もると、200 件の下限（[[editing-core.md#2]] の 2.3 節）が音量の動きで埋まるため（今のコードと同じ形）。

```ts
// packages/core/src/playback/PlaybackMixerBinder.ts
/** 編集ウィンドウごとに 1 つ。AlphaSynth へミキサーの値を書くのはこのクラスだけ。 */
export class PlaybackMixerBinder {
  constructor(api: PlaybackApi, history: CommandAppliedSource, score: model.Score,
              temporarySolo: { get(): ReadonlySet<number>; onChange(listener: () => void): () => void },
              pan: PanControlChannel);
  /** 全部のパートの音量・実効のミュート・パンを送る（同じ値を何度送っても同じ結果）。 */
  syncAll(): void;
  /** パンのつまみを離したとき（PlaybackService.setPartPan の final が true のとき）。pan.release() を呼ぶ。 */
  releasePan(): void;
  dispose(): void;
}
```

- (b) `onCommandApplied` のたびに、どのコマンドがミキサーの値を変えたかを調べず、全部のパートの値をまとめて送り直す。ソロは全部のパートに掛かるので、1 つのパートだけを送ると実効のミュートが食い違うため（作り直す前の本書 4.3 節の決まりを引き継ぐ）。取り消しとやり直しも同じ通り道を通る。
- (b) パンも `syncAll` で、全部のパートの値を `PanControlChannel.apply` に渡す（2.2 節）。fork の `changeTrackPan` は同じ値を何度呼んでも同じ結果（チャンネルのパンをその値にする）で、音量と同じく、どのコマンドが変えたかを調べずに済むため。'reload-on-release' の形では `apply` は覚えるだけなので、つまみを動かしている間は鳴らし直さない。
- (b) つまみを離したことは、画面が `PlaybackService.setPartPan(trackIndex, pan, true)` で知らせ、`PlaybackService` が `PlaybackMixerBinder.releasePan()` を呼ぶ。AlphaSynth へ書く所を `PlaybackMixerBinder` の 1 つに保つため（2.1 節の (b)）。つまみを使わずに 1 回で決まる変更も `final` を `true` にする。

## 8. 音源の読み込みと再生ボタン・入力の音

[[../basic_design/05_playback_audio.md#9]] を受ける。目標値（200ms・100ms）は [[../basic_design/09_nonfunctional.md#1]] が正で、アーキテクチャの側の決まりは [[web-core-foundation.md#10]] の 10.1 節と 10.4 節。

### 8.1 音源の読み込みと再生ボタン

- 曲を開いたら、その編集ウィンドウで AlphaSynth の初期化と音源（SoundFont）の読み込みを始める。編集ウィンドウを作ったときに `PlaybackService.preWarm()` を 1 回呼ぶ。 <!-- req 05:22f3ee83.cf56 -->
- 読み終わるまで、再生ボタンには「音源を読み込み中」と出し、押せない状態にする（`readiness` が `'loading'` の間）。 <!-- req 05:22f3ee83.1ad3 -->
- 曲一覧のウィンドウだけのときは、音源を読まない（曲一覧のウィンドウでは `PlaybackService` を作らない、[[web-core-foundation.md#10]] の 10.1 節）。 <!-- req 05:22f3ee83.6517 -->
- 押せない間は押す操作が起きないので、要件 5.2 の「再生ボタンを押してから発音まで 200ms 以内」は、再生ボタンを押せるようになってからの目標とし、この形で満たす。 <!-- req 05:22f3ee83.a13c -->
- (b) 読み込みに失敗したら（alphaTab の `soundFontLoadFailed`）、`readiness` を `'failed'` にし、`PLAY-003` をログにだけ書く（[[00_reference.md#5]]）。再生ボタンは押せる状態に戻し、押したときにもう一度読み込む。それも失敗したら `PLAY-001` を出す。`PLAY-001` を「再生を押して、そのときの読み込み直しも失敗したときだけ」出す決まり（2026-09-24 本人決定）に合わせ、失敗したまま押せない状態に留めないため。
- (b) `preWarm` の前に `AudioSessionAdapter.configureMixWithOthers()`（10 節）を呼ぶ。音声を出し始める前に共存の設定を済ませるため。

### 8.2 入力のときの音（ノートオン）

- 音符を置いたときの試しの音は、画面への反映と分けて出し、画面への反映を先に行う。どちらもその入力のイベントの処理の中ですぐ行う（[[web-core-foundation.md#10]] の 10.4 節）。 <!-- req 05:fb411a24.ae6a -->
- (b) 試しの音は `NotePreviewer` が出す。`PlaceNoteCommand` を発行した後（`onCommandApplied` の `kind` が `place-note` のとき）に、置いた音符を試しの音用のシンセ（下の `PreviewSynth`）に渡して鳴らす。音の高さは alphaTab が `Note` から出す（9.2 節）。
- 再生中に置いた音も、曲を止めずにすぐ鳴らす。そのために、試しの音用に、曲の再生と同じ SoundFont を読む AlphaSynth をもう 1 つ持つ（[[../basic_design/13_design_decision_points.md#2]] A15 の (a)、2026-10-11 本人決定）。 <!-- req 05:3e8d673f.c100 --> <!-- req 13:d2196294.dc45 -->
- (b) 止めているときも再生中も、試しの音はこの 2 つ目のシンセで鳴らし、曲の `AlphaTabApi.playNote` は使わない。`playNote` は鳴っている曲を止める（型定義の注記「This will stop the any other current ongoing playback」）ので再生中に使えず、止めているときだけ曲のシンセで鳴らすと、再生の入切で試しの音の通り道が替わり、確かめる所が 2 つになるため。
- (b) 1 音の MIDI は、alphaTab が `playNote` の中で作るのと同じ作り方で作る。`MidiFileGenerator` の `generateSingleNote` に `AlphaSynthMidiFileHandler` を渡して `MidiFile` に書き（どちらも型定義にある）、2 つ目のシンセの `playOneTimeMidiFile` で鳴らす（alphaTab 1.8.4 の実装の `playNote` で確かめた）。この作り方では、そのパートの `Track.playbackInfo` の音色（プログラム）・音量・パンが MIDI の頭に入る（実装の `prepareSingleBeat` と `_generateChannel` で確かめた）ので、試しの音はそのパートの音色・音量・パンで鳴る。曲の音と同じ聞こえ方にするため、パンを真ん中に直さない。2 つ目のシンセは曲を鳴らさないので、`playOneTimeMidiFile` が止めるのは前の試しの音だけになる。
- (b) 試しの音のシンセは、曲を開いた時点で SoundFont を読む。編集ウィンドウを作ったときに、`PlaybackService.preWarm()`（8.1 節）と同じ時機に `PreviewSynth.load()` を 1 回呼ぶ。入力から発音までの経路にロード待ちを入れないため（[[../basic_design/09_nonfunctional.md#1]]）。読むファイルは曲のシンセと同じ同梱の SoundFont（1.3 節）で、2 つ目のシンセのために別のファイルを持たない。読み終わるまでと、読み込みに失敗したときは試しの音を鳴らさず、画面には知らせない（音符を置く操作は止めない）。曲のシンセの `preWarm` の失敗を画面に出さない決まり（2026-09-24 本人決定、8.1 節の (b)）に合わせるため。
- 2 つ目のシンセを作る所は、次の `PreviewSynth` の 1 つの部品に閉じ込め、この部品の外から 2 つ目の AlphaSynth に触れない。alphaTab の型定義に無い口（下の箇条の音を出す部品）に触れる所を 1 つにし、版を上げたときに見る所を 1 つにするため（2.2 節の `PanControlChannel` と同じ考え）。 <!-- req 13:d2196294.b3a2 -->
- (a) の形（既定）：`'second-synth'`。alphaTab の `alphaTab.synth.AlphaSynth`（型定義にあり、`constructor(output: ISynthOutput, bufferTimeInMilliseconds: number)`）を、編集ウィンドウのレンダラーのメインスレッドに 1 つ作る。音を出す部品（`ISynthOutput`、型定義にある）には、alphaTab が曲のシンセに使う Web Audio の出力（`AlphaSynthAudioWorkletOutput` か `AlphaSynthScriptProcessorOutput`）を使う。この 2 つは `alphaTab.synth` から実行時に取り出せるが、型定義には無く、実装の中で `@internal` の印が付いている（`dist/alphaTab.core.mjs` の `synth` の書き出しの一覧と、`dist/alphaTab.d.ts` を grep して確かめた）。入っている alphaTab にこの口が在ることを確かめる単体テストを置き、口が無ければ作るときに (b) の形に替える（2.2 節の `PanControlChannel` と同じ）。
- (b) の形（代わりの形、A15 の (b)）：`'song-boundary'`。止めているときは曲の `AlphaTabApi.playNote` で鳴らし、再生中は鳴らさない。再生中に置いた音は、3.2.1 の `PlaybackSyncController` が次の小節の頭（ループ中はループの頭）で曲の再生データに入れるので、そこから曲の中で聞こえる（2026-10-10 本人決定の形）。この形にするときは、基本設計 13 章 A15 のとおり要件 5.2 に但し書きを足して要件から降ろし直す。 <!-- req 05:3e8d673f.1376 -->
- (a) と (b) のどちらにするかは、`PreviewSynth` を作るときに渡す 1 つの値で決め、その値だけで替えられるようにする（3.2.2 の `AudioSyncStrategy` と同じ形）。どちらにするかは、Phase 0 で SoundFont を選んだ後に、A15 の 3 つの条件（曲と別に鳴らせる・入力から 100ms 以内・400MB にゆとりを持って収まる）を実機で確かめて決める（12 節）。

```ts
// packages/core/src/playback/PreviewSynth.ts
/** 試しの音を鳴らす所。2 つ目の AlphaSynth を作って持つのはここだけ（A15）。 */
export interface PreviewSynth {
  readonly kind: 'second-synth' | 'song-boundary';
  /** 曲を開いたときに 1 回。'second-synth' は同梱の SoundFont を読む。'song-boundary' は何もせずに resolve する。失敗しても reject せず、以後 playNote は何もしない。 */
  load(): Promise<void>;
  /** 置いた音符を 1 音鳴らす。前の試しの音は止める。'song-boundary' は再生中なら何もしない。 */
  playNote(note: model.Note): void;
  dispose(): void;
}

// packages/core/src/playback/NotePreviewer.ts
/** 編集ウィンドウごとに 1 つ。 */
export class NotePreviewer {
  constructor(preview: PreviewSynth, history: CommandAppliedSource, findPlacedNote: () => model.Note | null);
  dispose(): void;
}
```

- (b) `NotePreviewer` は再生中かどうかを見ない。再生中の扱いの違いは `PreviewSynth` の 2 つの形の中に閉じ、`NotePreviewer` を (a) と (b) のどちらでも同じにするため。
- (b) 2 つ目のシンセは、曲のシンセと同じく、編集ウィンドウを閉じるときに `dispose` で壊す（AlphaSynth の `destroy` で出力の AudioContext も閉じる。実装の `AlphaSynthBase.destroy` と `AlphaSynthWebAudioOutputBase.destroy` で確かめた）。
- 2 つ目のシンセはレンダラーの中に作り、子プロセスと `BrowserWindow` は増やさない（[[web-core-foundation.md#10]] の 10.2 節）。メモリは 400MB に含めて測る（同じ 10.2 節）。

## 9. カポの実音への変換

[[../basic_design/05_playback_audio.md#10]] を受ける。カポの位置を alphaTab の `Staff.capo` に持つことと、関数の置き場所（`packages/core/src/domain`）は [[web-core-foundation.md#9]] の 9.2 節が正。関数を呼ぶのは MIDI の書き出しとコード名の推定の 2 か所で、再生は alphaTab に任せる（9.2 節、2026-10-10 本人決定、honnin-queue 76 番）。

- `capoFret` の表示は運指を基準にし、実音への変換は再生（と 9.1 節の関数を呼ぶ 2 か所）のときだけ行う。 <!-- req 05:4f196aa7.0cd9 --> <!-- req 13:07d4555b.021d -->
- カポの加算は、再生に使う音符の高さを出す時点でだけ当てる。曲のデータ（記譜のフレット）には当てない。 <!-- req 05:d8494beb.65e6 --> <!-- req 13:1ba4f8e7.657b -->
- 譜面の表示（記譜のフレットの番号）は、カポの実音への変換で一切変えない。 <!-- req 05:73e874eb.6523 -->

### 9.1 変換の関数

```ts
// packages/core/src/domain/pitch.ts
/** カポを含めた実音の MIDI の高さ。開放弦の音高 ＋ capoFret ＋ 記譜のフレット。範囲の確かめは呼ぶ側。 */
export function computeRealMidiPitch(openStringPitch: number, capoFret: number, frettedFret: number): number;
```

- 実際に鳴らす MIDI の高さは、その弦の開放弦のチューニングの音高をもとに出す。 <!-- req 05:24045027.729b -->
- その高さに `capoFret` を足す。 <!-- req 05:24045027.bc71 -->
- さらに記譜のフレットの番号を足す。 <!-- req 05:24045027.ac77 -->
- `capoFret` の範囲は 0 から 12（範囲の確かめは `SetCapoFretCommand`、[[part-tuning-management.md#2]] の 2.5 節）。 <!-- req 05:4aa84629.047f -->
- `capoFret` が 0（カポなし）のときは、足す値が 0 になる。 <!-- req 05:4aa84629.56db -->
- 0 のときも足す値が 0 になるだけで、ふだんの通り道から分かれる場合分けを作らない。 <!-- req 05:4aa84629.438f -->
- 変換は、チューニング（`stringPitches`）による。 <!-- req 05:ef23c5a3.a314 -->
- 変換は、カポによる。 <!-- req 05:ef23c5a3.4e0d -->
- 変換は、拍子によらない。 <!-- req 05:ef23c5a3.3f97 -->
- 変換は、テンポによらない。 <!-- req 05:ef23c5a3.1958 -->
- 変換は、奏法記号によらない。 <!-- req 05:ef23c5a3.7d8e -->
- 変換は足し算だけで、場合分けと副作用を持たない。 <!-- req 05:ef23c5a3.45f4 -->
- 同じ変換の式を、MIDI の書き出しでも使う（export-print.md、基本設計 07 章の回）。 <!-- req 05:c5000213.05dd -->
- 変換の式は、上の 1 つの関数にだけ書く。 <!-- req 05:c5000213.c9a7 -->
- MIDI の書き出しは、この関数を呼び、自分の中で加算を書かない。再生の側の扱いは 9.2 節。
- コード名の推定も、構成音の実音が要るので、同じ関数を呼ぶ（[[editing-core.md#8]]）。 <!-- req 05:52c15e9d.64d8 --> <!-- req 05:c5000213.860c -->
- (b) 単体テストは、境目の値（`capoFret` が 0 と 12、フレットが 0 と 24）を含めて条件網羅（C2）で行う。式は場合分けを持たないが、呼ぶ 2 か所の結果と、9.2 節で再生と比べる値がここで決まるため（作り直す前の本書 7 節の決まりを引き継ぐ）。

### 9.2 再生の側の扱い（A14）

- alphaTab 1.8.4 は、MIDI を作るときの音の高さ（`Note.realValue`）を `fret + stringTuning − transpositionPitch` で出し、その `stringTuning` は `Staff.capo` ＋ 開放弦の音高を返す（実装の `Note.calculateRealValue` と `get stringTuning` で確かめた）。つまり、`Staff.capo` に値を入れると、alphaTab のシンセは自分でカポを足して鳴らす見込みが高い（[[../basic_design/13_design_decision_points.md#2]] A14 の (b)）。実機の音で確かめるのは Phase 0（12 節）。
- 再生の音の高さは、`computeRealMidiPitch` を呼ばず、alphaTab が `Staff.capo` を足して出す高さに任せる（基本設計 05 章 10 節と 13 章 A14 の (b)、2026-10-10 本人決定）。A14 が (b) のときの 2 つの選び方のうち、「自前の加算を再生の通り道から外して alphaTab に任せる」に当たる。再生の MIDI は alphaTab の `MidiFileGenerator` が `Score` から作り、本書の側から音の高さを入れる口が無い（3.2.2 の `loadMidiForScore` と 6.1 節の `MidiFileGenerator` のどちらも `Note.realValue` を使う）ので、もう一方の「再生に渡すスコアでだけ `Staff.capo` を 0 にして自前で足す」は、足す口が無く成り立たない。 <!-- req 05:c5000213.32ed --> <!-- req 13:a95f400c.6960 --> <!-- req 13:1ba4f8e7.4355 -->
- 再生と書き出しで鳴る音が食い違わないことは、単体テストで見張る。対応する弦の本数（5 から 8 弦と 3 から 6 弦のチューニングのプリセット）の全部の弦・フレット 0 から 24・`capoFret` 0 から 12 の組を全部回し、`computeRealMidiPitch` の値と、同じ値を入れた `Note` の `realValue` が同じになることを確かめる。(b) テストは、入っている alphaTab の `Note` を使って作る。alphaTab の版を上げて加算の仕方が変わったときに、ビルドの前に落ちるようにするため。 <!-- req 05:c5000213.56b0 --> <!-- req 05:c5000213.b61b --> <!-- req 13:a95f400c.d293 -->
- A14 が (a)（alphaTab がカポを足さない）と分かったときは、再生の通り道だけを替える（パートのチャンネルの移調の値 `changeTrackTranspositionPitch` に `capoFret` を渡す）。どちらでも、`Staff.capo` に `capoFret` を入れること（[[web-core-foundation.md#9]] の 9.2 節）は変えない。 <!-- req 13:a95f400c.9789 -->

## 10. `AudioSessionAdapter` のシグネチャ

[[web-core-foundation.md#3]] の 3.3 節の表で、本書に回されたもの。責務（別の音楽アプリとの共存）と PC 版で何もしないことは [[web-core-foundation.md#3]] の 3.2 節が正。

```ts
// packages/core/src/platform/AudioSessionAdapter.ts
export interface AudioSessionAdapter {
  /** 別のアプリの音と混ぜて鳴らす設定にする。PC 版は何もせずに resolve する。
   *  iPhone 版は AVAudioSession の mixWithOthers を設定し、失敗したら reject する（中身は Phase 3）。 */
  configureMixWithOthers(): Promise<void>;
}
```

| メソッド | 引数 | 戻り値 | 非同期か | エラーのとき |
|---|---|---|---|---|
| `configureMixWithOthers` | なし | `Promise<void>` | 非同期（[[web-core-foundation.md#3]] の 3.3 節の決まりで、iPhone 版にそろえる） | PC 版は失敗しない。iPhone 版の失敗の扱いは Phase 3 の詳細設計で決める |

- PC 版は、OS がいつも複数のアプリの音を同時に鳴らせるので、共存のために特別なことをしない（何もしない実装、[[../basic_design/05_playback_audio.md#8]]）。 <!-- req 05:b5dd9513.e33e -->
- iPhone 版のラッパーの実装だけが実際の処理を持ち、AVAudioSession の `mixWithOthers` を設定する。WebView の中の音がこの設定を継ぐかは未確かめで（要件のリスク #1）、Phase 3 で決めることは [[web-core-foundation.md#13]] の 13.5 節。 <!-- req 05:ebe614ce.4bec --> <!-- req 13:41d84b47.7b95 -->
- (b) 呼ぶのは `PlaybackService.preWarm` の初め（8.1 節）の 1 か所だけとする。PC 版は何もしないので、呼ぶ所を増やしても意味が無いため。
- (b) 名前を `configureMixWithOthers` にしたのは、iPhone 版で設定する中身（`mixWithOthers`）をそのまま表し、責務が共存の設定 1 つだけであることが名前から分かるようにするため。

## 11. 再生のキーとメニューの呼ぶ先

[[screens-navigation.md#8]] の 8.1 節の「再生」メニューと、[[screens-navigation.md#9]] の 9.2 節のキーの表から、中身を本書に回されたもの。どの画面がキーを受けるかは screens-navigation.md が正。

| キー・メニュー | 呼ぶ先 |
|---|---|
| Space（再生／停止） | 止まっていれば `PlaybackService.play()`（カウントインが入っていれば `CountInController.start`）、鳴っていれば `stop()` |
| Shift+Space（曲頭から再生） | `seekToBar(0)` の後に Space と同じ再生の始め方 |
| Ctrl+L（区間ループの入切） | ループがあれば `clearLoop()`。無ければ、`lastLoop` があればそれを入れ直す（区間なら `setRegionLoop`、セクションなら `setSectionLoop`）。`lastLoop` も無ければ、譜面で選んでいる小節（`CursorController.selection` の小節の範囲）で `setRegionLoop`、それも無ければカーソルのある小節 1 つで `setRegionLoop(i, i)`（2026-10-10 本人決定、honnin-queue 72 番） |
| Ctrl+M（メトロノームの入切） | `MetronomeService.setEnabled(!enabled)` |
| 「セクションループ」 | `setSectionLoop(カーソルのある小節を含むセクションのマーカーの id)`。マーカーが無ければ押せない状態にする。(b) どのセクションかを別に聞かずに済むよう、カーソルのある小節を含むセクションを使う |
| 「ソロ再生」 | `setTemporarySolo`（2.1 節） |
| 「区間ループ設定」 | ループを変えず、小節番号の帯の使い方を短く示す（[[screens-navigation.md#7]] の 7.7 節。新しいダイアログは作らない） |
| 「減速再生」 | `TempoFactorSelector.toggleSlowdown()`（4 節） |
| 「カウントイン ON-OFF」 | カウントインを入れるかの値（`PlaybackPreferences` には入れず、編集ウィンドウを閉じるまで持つ） |
| 「タップテンポ」 | `TapTempoController.tap()`。確定のしかたは下の箇条 |

- (b) カウントインの入切は、編集ウィンドウを閉じるまで持つ値とし、設定のファイルに書かない。基本設計 05 章 6 節が設定に置くのは長さ（倍率）だけで、入切はメトロノームの入切と同じく、その場の操作として切り替えるため。
- (b) 「タップテンポ」の項目とボタンは、押すたびに 1 回のタップとして数え、出た BPM を `tap` のたびに曲に入れる（`commit`）。押すのをやめたときの値が曲に残る。叩き終わりを知らせる操作を別に置かずに済むため。
- (b) 続けて叩いた分（前のタップから 2 秒〈`TAP_RESET_GAP_MS`〉以内）の `commit` は、取り消しの履歴の 1 つの項目にまとめ、取り消すと叩き始める前のテンポに戻る（7 節の音量とパンのスライダーと同じ形）。`TapTempoController` は数え直すたびに新しい番号を付け、`commit` が出す `SetTempoCommand` にその番号を持たせる。`SetTempoCommand` の `canMergeWith` は、同じ小節で同じ番号のものだけをまとめる。数回叩いただけで、取り消しが何回分も要るのを避けるため（チャット側の決定 turn 134）。テンポの数値の入力から出す `SetTempoCommand` は番号を持たず、まとめない。

## 12. 実装の前と Phase 0・1 で確かめること

本書が「未確認（推測）」とした所を、確かめる時機ごとに並べる。

| 確かめること | 時機 | 結果で変わる所 |
|---|---|---|
| 1.3 節の候補の SoundFont が 2 つの条件を満たすか（エレキギターとベースが録音のサンプルか、大きさ）と、6.2 節の音（ウッドブロック・プログラム 81）があるか | Phase 0 | 1.3 節のファイルの名前、6.2 節の表 |
| AlphaSynth が `Staff.capo` を再生の音の高さに足すか（A14、9.2 節） | Phase 0 | 9.2 節の通り道 <!-- req 13:a95f400c.93ed --> |
| alphaTab の fork を作り（[[web-core-foundation.md#4]] の 4.1 節）、fork に足した `changeTrackPan` で再生中のパンがつまみの動きに合わせて効くか。ループの頭へ戻ったときとシークの後も、変えたパンのまま鳴るか（A13、2.2 節）。確かめは実機で、fork した alphaTab のワーカーで鳴らしながらつまみを動かし、左右の定位が変わるかを聞いて確かめる（基本設計 13 章 A13 の 2026-10-15 本人決定） | Phase 0（実機） | 2.2 節の `PanControlChannel` の形（'fork-command' か 'reload-on-release'）と、位置が後ろへ飛んだときに送り直すか <!-- req 13:bc93cc74.e335 --> <!-- req 13:bc93cc74.031a --> |
| 上の行の Phase 0 で、fork で鳴らしながらつまみを動かしても左右の定位が変わらなかったときだけ、代わりの形（A13 の (b')、2.2 節の 'reload-on-release'）で、つまみを離したときに作り直して鳴らし直すと左右の定位が変わるか（2026-10-15 本人決定） | Phase 1 の実機検証の回 | 2.2 節の `PanControlChannel` を 'reload-on-release' の形で作るか <!-- req 13:bc93cc74.4564 --> |
| 試しの音用の 2 つ目の AlphaSynth（8.2 節の `PreviewSynth` の 'second-synth'）が、基本設計 13 章 A15 の 3 つの条件を満たすか。① 曲の再生と並べて鳴らせるか（曲のシンセはブラウザではいつも「alphaSynth Worker」のワーカーの中に作られ〈実装の `createWorkerPlayer` で確かめた〉、2 つ目はメインスレッドに作るので、ワーカーは増えない。出力はそれぞれ自分の AudioContext を開く〈実装の `AlphaSynthWebAudioOutputBase.open` で確かめた〉。2 つの AudioContext が同時に鳴るかは未確認（推測））。② 入力から 100ms 以内に鳴るか（`AlphaSynthScriptProcessorOutput` の 1 回の塊は 4096 サンプルで、44.1kHz なら約 93ms になり、遅れの元になりうる。`player.bufferTimeInMilliseconds` の既定は 500。2 つ目のシンセに渡す値はここで決める）。③ SoundFont を 2 つ読んだときのメモリの増え（[[web-core-foundation.md#10]] の 10.6 節で測る。同梱の候補の `sonivox.sf2` はファイルで約 1.35MB だが、読み込んだ後の大きさは未確認（推測））。あわせて、メインスレッドで合成して描画と入力の反応が落ちないか | Phase 0（SoundFont を選んだ後の実機） | 8.2 節の `PreviewSynth` の形（'second-synth' か 'song-boundary'）。'song-boundary' にするときは要件 5.2 から降ろし直す（基本設計 13 章 A15） |
| 再生中の部分の差し替えができるか（A4、3.2.2） | Phase 1 | 3.2.2 の既定の形 |
| 曲の MIDI にクリックを足して読ませたとき、再生カーソルと位置のイベントが崩れないか（6.1 節） | 実装の前 | 6.1 節の再生中のクリックの作り方 |
| 再生していない間にクリックだけを続けて鳴らせるか、カウントインの後に曲を鳴らし始めるまでの空白（6.1 節・6.3 節） | 実装の前 | 6.1 節の再生していない間の作り方 |
| 書き出しの試し（1.4 節）で、`playOneTimeMidiFile` の間に再生カーソルと位置のイベントがどう動くか。`pause` で止めた後の `play` で、曲の止めた位置から鳴るか | 実装の前 | 1.4 節の止め方と、`PlaybackCursorFollow` を止める所 |
