# エクスポート・印刷 詳細設計書

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1.1]] のPhase 2 の実施順 1「書き出し機能」・2「印刷プレビュー」
- **ブランチ名**：`feature/export-print`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 1. 書き出しの 3 つの形式

[[../basic_design/07_export_print.md#1]] を受ける。書き出し画面に置く欄は [[screens-navigation.md#12]] の 12.6 節が正で、本節は 3 つの形式の変換の作りを書く。alphaTab の名前は、1.8.4 の型定義（`dist/alphaTab.d.ts`）で確かめた。

### 1.1 書き出す Score の取り出しと切り出し

- 書き出す Score は、書き出しを始めた編集ウィンドウがメモリに持っている `SongDocument` の Score を使い、保存先のファイルを読み直さない（[[../basic_design/13_design_decision_points.md#3]] B23）。自動保存の前の編集も書き出しに入れるため。 <!-- req 13:55cf088f.cecd -->
- 書き出す範囲・パートで Score を切り出す処理を持つ。 <!-- req 07:8777bd48.2c5c -->
- この切り出しは、書き出しの 3 つの形式で共通の、自前の小さな処理 1 つとする（`ExportScoreSlicer`）。 <!-- req 07:250cb5a1.8093 --> <!-- req 07:8777bd48.9be0 -->
- この切り出しは範囲とパートを選ぶだけの処理で、alphaTex への変換そのものではない。形式ごとの変換（1.2 節から 1.4 節）は、切り出した Score を受け取ってから始める。 <!-- req 07:208481ff.e2dc -->

```ts
// packages/core/src/export/ExportScoreSlicer.ts
import type { model } from '@coderline/alphatab';

/** 書き出す範囲を小節の番号に直したもの（2 節の 5 つの選び方から作る）。0 始まりで、endBarIndex はその小節を含む。 */
export interface ExportBarRange { startBarIndex: number; endBarIndex: number; }

export interface ExportSelection {
  range: ExportBarRange;
  /** 書き出すパート（Score.tracks の番号）。1 つ以上で、曲のパートの順に並べる。 */
  trackIndices: readonly number[];
}

export class ExportScoreSlicer {
  /** 元の Score を変えずに、範囲とパートだけを持つ写しを返す。
   *  @throws RangeError 範囲が曲の小節の外のとき、trackIndices が空か曲の外の番号を含むとき */
  slice(score: model.Score, selection: ExportSelection): model.Score;
}
```

- (b) 写しは alphaTab の `JsonConverter.scoreToJson` と `JsonConverter.jsonToScore` で作り、写しの上で範囲の外の小節（`MasterBar` と各パートの `Bar`）と、選ばなかったパート（`Track`）を外してから、`Score.finish` で整え直す。元の Score を書き換えると、開いている編集ウィンドウの譜面と取り消しの履歴に響くため。
- (b) 範囲の頭の小節には、その小節より前で決まった拍子とテンポ（継いだ値、[[editing-core.md#3]] の 3.2 節）を書き入れる。途中から切り出しても、書き出したものの頭の拍子とテンポが、曲の中のその位置と同じになるため。

### 1.2 alphaTex（`AlphaTexExportService`）

- alphaTex の書き出しは、切り出した Score を alphaTex の文に変える。 <!-- req 07:250cb5a1.6f48 -->
- 変換には、alphaTab（1.7.0 以降）が持つ API の `alphaTab.exporter.AlphaTexExporter`（`exportToString(score, settings)`）を使う。 <!-- req 07:250cb5a1.2448 --> <!-- req 13:42d0c343.0a56 -->
- alphaTex のための自前のシリアライザは作らない。 <!-- req 07:250cb5a1.1549 --> <!-- req 13:42d0c343.f053 -->
- alphaTex への変換そのものは、この API だけで行う。 <!-- req 07:250cb5a1.072a -->
- `AlphaTexExportService` は、この API を呼ぶだけで alphaTex の書き出しを作り、自前のシリアライザを持たない。 <!-- req 07:208481ff.ec4a -->
- Phase 2 の作業は、この API を呼ぶことと、渡す設定のオプションを合わせることだけで足り、自前のシリアライザを実装しない。 <!-- req 07:8777bd48.a406 -->
- 書き出し画面には、alphaTex の形式ごとの設定を置かない（[[screens-navigation.md#12]] の 12.6 節）。 <!-- req 07:250cb5a1.0b1b -->
- 書き出すのは、譜面（Score）のデータだけとする。 <!-- req 07:250cb5a1.b91c -->
- alphaTex には、小節メモとタグを入れない。 <!-- req 07:250cb5a1.cad8 --> <!-- req 07:8777bd48.34c3 -->
- 小節メモとタグは、書き出す文には入らないが、曲のファイルには残る。書き出しは曲のファイルを変えない。 <!-- req 07:250cb5a1.817d -->
- 小節メモとタグは Score の外の `appMeta`（[[data-model-persistence.md#6]]）に持つので、切り出した Score だけを API に渡せば入らない。
- 書き出し画面のプレビューは、書き出す範囲・パートで切り出した Score を `exportToString` した文を、そのまま読み取り専用で見せる。 <!-- req 07:250cb5a1.c11b -->
- プレビューの文は、書き出すボタンで書く文と同じ `export` の戻り値を使い、プレビューのための整形をしない。範囲かパートを変えたら作り直す。書き出すファイルと同じ文を見せるため。
- (b) `exportToString` に渡す `Settings` は、alphaTab の既定の値で作った新しいものとし、編集ウィンドウの表示の設定（表示のモード・ズーム）を持ち込まない。書き出す文が、書き出したときの画面の状態で変わらないため。既定の値のままで足りない設定のオプションがあるかは、実装の前に確かめる（7 節）。

```ts
// packages/core/src/export/AlphaTexExportService.ts
export class AlphaTexExportService {
  constructor(reporter: NotificationReporter);
  /** 切り出した Score を alphaTex の文にする。変換に失敗したら EXPORT-001 を出して null を返す（5 節）。 */
  export(score: model.Score): string | null;
}
```

- alphaTex への変換で情報を失わないこと（変換の完全性）を確かめる。確かめる中身は、奏法記号・タイ・スラー・セクション・繰り返しの記号を含む（[[data-model-persistence.md#3]] の「内部データそのまま」の読み方）。 <!-- req 07:250cb5a1.34e3 -->
- 確かめの主眼は、自前の処理を網羅することではなく、ライブラリの書き出しの結果が要件 4.4 節を満たすかの確認とする。 <!-- req 07:250cb5a1.2ca9 --> <!-- req 13:42d0c343.6987 -->
- 書き出しの設定のオプションを正しく使えているかも、確かめの対象にする。 <!-- req 07:250cb5a1.c33b -->
- (b) 確かめは、書き出した文を alphaTab の `AlphaTexImporter` で読み戻し、元の切り出した Score と比べる往復のテストで行う。比べる項目は、上の 5 つと、音の高さ・音価・拍子・テンポとする。単体テストとしての種類とカバレッジは [[web-core-foundation.md#14]] の 14.3 節の表。

### 1.3 MIDI（`MidiExportService`）

- MIDI の書き出しは、切り出した Score を標準 MIDI ファイル（SMF）に変える。 <!-- req 07:9f23c6a2.a490 -->
- 変換の処理は自前で作り、alphaTab の `MidiFileGenerator` を使わない（要件 9 章の方針、[[web-core-foundation.md#9]] の 9.3 節）。 <!-- req 07:9f23c6a2.3fd0 -->
- パートと MIDI のトラックを 1 対 1 で対応させる。 <!-- req 07:9f23c6a2.2609 -->
- (b) 形式は SMF のフォーマット 1 とし、1 本目のトラックを拍子とテンポだけを持つトラック（コンダクタートラック）、2 本目からを書き出すパートに曲のパートの順で当てる。作り直す前の本書の決まりを引き継ぐ。パートのトラックの名前には `Track.name` を入れる。
- テンポの変化と拍子の変化は、MIDI のテンポと拍子のメタイベントにする。 <!-- req 07:9f23c6a2.2194 -->
- 各ノートの音の高さは、チューニングとフレットとカポから出して、MIDI のノートの番号にする。出すのは [[playback-integration.md#9]] の 9.1 節の `computeRealMidiPitch` を呼んで行い、本書の中で加算を書かない。 <!-- req 07:9f23c6a2.9d2d --> <!-- req 13:d1985887.3d74 -->
- 各ノートのベロシティを、MIDI のノートの強さに変える。 <!-- req 07:9f23c6a2.3673 -->
- (b) 強さは alphaTab の `Beat.dynamics`（強弱の記号）から引き、`Note.accentuated`（アクセント）があれば足す。対応の値は実装の段で決め、`MidiExportService` の定数の 1 か所に置く。
- ベンドは、ピッチベンドのイベントにする。 <!-- req 07:9f23c6a2.030b -->
- (b) 各パートのトラックの頭で、ピッチベンドの幅（RPN 0）を 12 半音にする。チョーキング（[[editing-core.md#3]] の 3.5 節の `Note.bendPoints`）は 1 音（2 半音）を超えることがあり、MIDI の既定の幅（2 半音）では表せないため。
- チョーキングを除く奏法記号の全部（[[editing-core.md#3]] の 3.5 節の表のスライド・ハンマリング・プリング・ハーモニクス・パームミュート・ビブラート・タッピング・スラップ・ポップ・ブラシ）を、それぞれ近い表し方に変える（2026-10-13 本人決定、honnin-queue 100 番）。チョーキングは上のピッチベンドで出す。 <!-- req 07:9f23c6a2.6118 --> <!-- req 07:9f23c6a2.f20b --> <!-- req 07:9f23c6a2.b669 --> <!-- req 07:9f23c6a2.4f0f --> <!-- req 07:9f23c6a2.f30b --> <!-- req 07:9f23c6a2.0e65 --> <!-- req 07:9f23c6a2.d314 --> <!-- req 07:9f23c6a2.5349 --> <!-- req 07:9f23c6a2.ba60 --> <!-- req 07:9f23c6a2.198d --> <!-- req 07:9f23c6a2.d304 -->
- (b) 奏法記号ごとの近い表し方は下の表とする。honnin-queue 100 番の案 C の書き方を出発点にした。音色の切り替え（プログラムチェンジ）は使わず、音の高さ・長さ・強さ・ピッチベンド・エクスプレッションだけで表す。MIDI の標準に奏法の音色の決まりが無く、音色を替えると鳴らすソフトごとに別の楽器になりうるため。表の割合と幅は `MidiExportService` の定数の 1 か所に置く。

| 奏法記号 | MIDI での近い表し方 |
|---|---|
| スライド（`Note.slideOutType`） | シフト（`Shift`）とレガート（`Legato`）は、その音の終わりの 4 分の 1 の長さで、同じ弦の次の音の高さまでピッチベンドで動かす。シフトは次の音を弾き直し、レガートは弾き直さずに始まりの音を次の音の終わりまで伸ばして高さだけを移す。下へ（`OutDown`）と上へ（`OutUp`）のスライドアウトは、その音の終わりの 4 分の 1 の長さで 5 半音下げる・上げる。動かす幅はピッチベンドの幅の 12 半音までとする |
| ハンマリング・プリング（`Note.isHammerPullOrigin`） | 行き先の音（`Note.hammerPullDestination`）の強さを、始まりの音の強さの 7 割にする。始まりの音の終わりを行き先の音の頭まで伸ばし、間を空けない |
| ハーモニクス 3 種（`Note.harmonicType`） | 鳴る高さで出す。人工（`Artificial`）とピンチ（`Pinch`）は、`computeRealMidiPitch` の高さに alphaTab の `Note.harmonicPitch` の半音の数を足す。自然（`Natural`）は、開放弦の高さ（`computeRealMidiPitch` にフレット 0 を渡した値）に `Note.harmonicPitch` を足す。alphaTab が再生の高さを出すとき（実装の `Note.calculateRealValue`）と同じ足し方にそろえる |
| パームミュート（`Note.isPalmMute`） | 長さを縮め、エクスプレッション（CC 11）を下げて減衰を近づける（作り直す前の本書の決まり） |
| ビブラート（`Note.vibrato`） | ピッチベンドで、音の頭から終わりまで高さを上下に揺らす。`Slight` は上下 0.25 半音、`Wide` は上下 0.5 半音とし、どちらも 1 秒に 5 回揺らす |
| タッピング（`Beat.tap`） | 拍の音の強さを 8 割にする。ピックで弾かない音なので、ハンマリングに近い強さにする |
| スラップ（`Beat.slap`） | 拍の音の強さを 2 割上げる（127 を超えない） |
| ポップ（`Beat.pop`） | 拍の音の強さを 2 割上げる（127 を超えない） |
| ブラシ（`Beat.brushType`） | 和音の音を少しずつずらして鳴らす。`BrushDown` と `ArpeggioDown` は低い弦から、`BrushUp` と `ArpeggioUp` は高い弦から順に遅らせる。ずらす全体の長さは alphaTab の `Beat.brushDuration`（alphaTab のティック）を SMF のティックに直した値とし、音の数で同じ長さずつに分ける |

- (b) 繰り返し（リピートと番号付きの括弧）は、鳴る順に展開して並べる。MIDI には繰り返しの記号が無く、展開しないと 2 回目からが鳴らないため。
- (b) 2 つ目のボイスの拍は、1 つ目と同じパートのトラックと同じチャンネルに出す（[[playback-integration.md#2]] の 2.3 節と同じ）。
- (b) パートのミュートとソロ、減速の倍率は MIDI に入れない。書き出すパートは書き出し画面のパートの欄で選び、ミュートとソロと減速は再生の状態のため。
- 書き出し画面の MIDI の形式ごとの設定として、メトロノームとカウントインのクリックを含めるかどうかを選べる。画面は、メトロノームとカウントインを別々の切り替えで出す（[[screens-navigation.md#12]] の 12.6 節）。 <!-- req 07:9f23c6a2.c173 -->
- (b) クリックを含めるときは、クリックだけの 1 本のトラックを足す。音色と音量は設定ダイアログのメトロノームの値（[[playback-integration.md#6]] の 6.2 節の表と音量）を使い、1 拍目を高い音にする。`wood` は打楽器のチャンネル（10 チャンネル目）、`beep` は曲のパートに使わない 1 つのチャンネルにプログラム 81 を置く。カウントインを含めるときは、曲の頭の前に、設定のカウントインの長さ（6.3 節の 1 か 2 小節ぶん）のクリックを置き、曲の音をその分だけ後ろへずらす。再生で聞くクリックと同じ音を書き出すため。
- 書き出し画面の MIDI の形式ごとの設定として、ミキサーの各パートの音量・パンを入れるかどうかを選べる。画面は、音量とパンを別々の切り替えで出す（12.6 節）。 <!-- req 07:9f23c6a2.c5bf -->
- (b) 入れるときは、各パートのトラックの頭に、音量（CC 7）とパン（CC 10）を置く。値は、[[playback-integration.md#2]] の 2.2 節の `playbackInfo` の値を、alphaTab が再生の MIDI を作るときと同じ式（`MidiFileGenerator._toChannelShort`）で写す。再生で聞いた音量とパンの比が、書き出したファイルでも同じになるため。入れないときは、CC 7 と CC 10 を置かず、鳴らすソフトの既定に任せる。

```ts
// packages/core/src/export/MidiExportService.ts
/** 書き出し画面の MIDI の 4 つの切り替え（screens-navigation.md 12.6 節）。 */
export interface MidiExportOptions {
  includeMetronome: boolean;
  includeCountIn: boolean;
  includeMixerVolume: boolean;
  includeMixerPan: boolean;
}

export class MidiExportService {
  constructor(preferences: PlaybackPreferencesSource, reporter: NotificationReporter);
  /** 切り出した Score から、書き出す MIDI の中身を alphaTab の MidiFile（format は MidiFileFormat.MultiTrack）で作る。
   *  purpose が 'audition'（書き出しの試し）のときだけ、入れない音量とパンの代わりに GM の既定の値を置く。変換に失敗したら EXPORT-001 を出して null を返す（5 節）。 */
  compose(score: model.Score, options: MidiExportOptions, purpose: 'file' | 'audition'): Promise<midi.MidiFile | null>;
  /** compose(score, options, 'file') を SMF（フォーマット 1）のバイト列にする。変換に失敗したら EXPORT-001 を出して null を返す（5 節）。 */
  export(score: model.Score, options: MidiExportOptions): Promise<Uint8Array | null>;
}
```

- `PlaybackPreferencesSource` は [[playback-integration.md#6]] の 6.6 節の形で、クリックの音色・音量・カウントインの長さを読むためだけに使う。
- (b) MIDI の中身は、alphaTab の `MidiFile` を入れ物にして、`addEvent` でイベントを並べて作る。ファイルには `MidiFile.toBinary` で書く。どのイベントを並べるか（変換の中身）は自前で、alphaTab の `MidiFileGenerator` は使わない。書き出すファイルと書き出しの試し（下の「MIDI のプレビュー」）が同じ組み立てを使い、AlphaSynth にもそのまま渡せる形にするため。`toBinary` がフォーマット 1 のトラックの並び（1 本目のコンダクタートラック）のとおりに書くかは、実装の前に確かめる（7 節）。書けないと分かったときは、同じイベントの並びから SMF のバイト列を自前で書く。
- (b) `'audition'` で音量とパンを入れないときは、各パートのトラックの頭に GM の既定の値（CC 7 を 100、CC 10 を 64）を置く。書き出すファイルには置かない（上の「入れないときは置かない」）。AlphaSynth のチャンネルには前に鳴らした曲の音量とパンが残っていて、置かないとその値で鳴るため。

#### MIDI のプレビュー（試しに鳴らす）

- 書き出し画面のプレビューの「試しに鳴らす」は、書き出す範囲・パートと、上の 2 つの設定を反映して、基本設計 05 章の `PlaybackService`（AlphaSynth）で鳴らす（[[playback-integration.md#1]] の 1.4 節）。 <!-- req 07:9f23c6a2.d562 -->
- 書き出す MIDI のファイルを、別の再生の部品で鳴らさない。 <!-- req 07:9f23c6a2.a227 -->
- MIDI のプレビューのために、AlphaSynth 以外の音源をアプリに置かない（基本設計 05 章 1 節）。 <!-- req 07:9f23c6a2.0061 -->
- このため、プレビューで確かめられるのは、入る範囲・パート・クリック・音量とパンまでとする。書き出した MIDI を別のソフトで鳴らしたときの音色は、そのソフトの音源で決まる。 <!-- req 07:9f23c6a2.8be3 -->
- 試しに鳴らすのは、`PlaybackService` の「書き出しの試し」の操作（[[playback-integration.md#1]] の 1.2 節と 1.4 節の `startExportAudition`）とする（2026-10-13 チャット側の決定、honnin-queue 97 番）。鳴らす中身は、書き出す MIDI と同じもの（切り出した範囲とパート、クリック、音量とパン）とし、上の `compose(score, options, 'audition')` で作る。
- 試しの音を止めたら曲の再生のデータに戻し、試しの音のために利用者のループ・ソロ・メトロノーム・ミキサーの値を書き換えない（戻し方は playback-integration.md 1.4 節）。
- (b) 書き出し画面の MIDI のプレビューには「試しに鳴らす」のボタンを置き、鳴っている間は同じ所を「止める」に替え、鳴り終えたら「試しに鳴らす」に戻す。範囲・パート・設定の欄を変えたときと、書き出し画面を閉じたときは止める（2.2 節の `ExportService.stopMidiAudition`）。前の中身の音が、変えた後の欄と違って鳴り続けないため。

### 1.4 PDF

- PDF の書き出しは、Electron の `webContents.printToPDF()` を第一の選択とする（[[../basic_design/13_design_decision_points.md#3]] B6）。 <!-- req 07:36919650.c83e --> <!-- req 13:ddcbbc7b.9ea6 -->
- alphaTab のレイアウトエンジンで A4 に合わせて組んだ描画の結果を、そのまま PDF にする（作りは 3 節）。 <!-- req 07:36919650.cc8e -->
- 描画の結果は、SVG のベクターの出力とする（[[web-core-foundation.md#4]] の 4.1 節の SVG）。 <!-- req 07:36919650.06f2 --> <!-- req 13:6e832a7a.f3ec -->
- 書き出し画面の PDF の形式ごとの設定として、譜面の大きさ（拡大率）を選べる。 <!-- req 07:36919650.be84 -->
- (b) 拡大率は 50% から 200% まで 10% 刻みで選び、既定は 100% とする。設定ダイアログの「譜面のデフォルトズームレベル」の倍率（[[view-modes.md#1]] の 1.3 節、2026-10-05 本人決定、honnin-queue 31 番）と同じ範囲と刻みにそろえ、譜面の大きさの選び方を 2 通りにしないため。値は `PrintLayoutRenderHost` が alphaTab の `display.scale` に渡す（3.2 節）。印刷プレビューダイアログの拡大率の欄（3.3 節）も、同じ範囲と刻みと既定にする。
- 書き出し画面の PDF の形式ごとの設定として、コード名と小節メモを入れるかどうかを選べる。画面は、コード名と小節メモを別々の切り替えで出す（[[screens-navigation.md#12]] の 12.6 節）。 <!-- req 07:36919650.4d26 -->
- (b) コード名を入れるときは、印刷用の写しの各拍の `Beat.text` に、画面と同じ名前（`ChordDetectionService.resolveDisplayName`、[[editing-core.md#8]]）を入れ、alphaTab の `notation.elements` の `NotationElement.EffectText` を入れて描かせる。入れないときは `EffectText` を切る。画面はコード名を譜面の上に重ねて出す（editing-core.md 8 節）が、印刷用の写しは利用者が触らないので、alphaTab の描画に任せればページの組み方と一緒に動くため。写しの外の、曲の Score の `Beat.text` は変えない。
- PDF に小節メモを入れるときは、その小節の上に、小さな文字で本文を出す（2026-10-13 本人決定、honnin-queue 98 番）。
- 長いメモで隣の小節やコード名と重ならないように、段の間を広げる。描き方は 3.2 節で、印刷（3.3 節）でも同じ描き方を使う。
- プレビューは、3.2 節の生成の流れのうち、ページ単位の SVG の描画までを使ってページを見せる。 <!-- req 07:36919650.5b2f -->
- `printToPDF()` は、書き出すボタンを押したときだけ呼ぶ。プレビューのたびに PDF を作らず、書き出す PDF と同じレイアウトを見せるため。 <!-- req 07:36919650.5334 -->

## 2. ファイル名と書き出し画面の中身

[[../basic_design/07_export_print.md#2]] を受ける。画面に置く欄は [[screens-navigation.md#12]] の 12.6 節が正で、本節は欄に入れる値と書き出すまでの決まりを書く。

### 2.1 ファイル名（`ExportFileNameGenerator`）

- 書き出すファイルの名前は、`{曲名}_{パート名}_{YYYYMMDD}.{拡張子}` の決まりで自動で作る。 <!-- req 07:b81b83d7.3164 -->
- 1 つのパートを書き出すときは、パート名の所に、そのパートの名前（`Track.name`、[[part-tuning-management.md#2]]）を入れる。 <!-- req 07:b81b83d7.caf6 -->
- 2 つ以上のパート、または全部のパートをまとめて 1 つのファイルに書き出すときは、パート名の所に `{パート数}パート` の文字（3 つなら「3パート」）を入れる。 <!-- req 07:b81b83d7.c5e6 -->
- 曲名に、ファイルの名前に使えない文字（`/ \ : * ? " < > |`）が入っていれば、自動で置き換える。 <!-- req 07:16ce8244.630f -->
- (b) 置き換える先の文字は `_` とし、パート名にも同じ置き換えを当てる。作り直す前の本書の決まりを引き継ぎ、パート名からも書けない名前ができないため。
- (b) 曲名は `Score.title`（[[data-model-persistence.md#5]]）、日付は書き出すときの PC の時計の日付（その PC の時刻帯）とする。拡張子は、PDF が `pdf`、alphaTex が `tex`、MIDI が `mid` とする（作り直す前の本書の決まり）。

```ts
// packages/core/src/export/ExportFileNameGenerator.ts
export type ExportFormat = 'pdf' | 'alphatex' | 'midi';
export class ExportFileNameGenerator {
  /** @param partNames 書き出すパートの名前。1 つならその名前、2 つ以上なら「{数}パート」を入れる。
   *  @param now PC の時計の今（epoch ms）
   *  @throws RangeError partNames が空のとき */
  generate(songTitle: string, partNames: readonly string[], format: ExportFormat, now: number): string;
  /** 使えない文字を _ に置き換え、拡張子が無ければ形式の拡張子を足す（2.2 節の欄に書き換えた名前）。 */
  normalize(fileName: string, format: ExportFormat): string;
}
```

### 2.2 書き出し画面の欄と書き出すまで

- 書き出し画面のファイル名の欄に、2.1 節で作った名前を入力前の薄い文字（プレースホルダー）で出す。 <!-- req 07:4934fb05.7f8d -->
- ファイル名の欄は、自由に書き換えられる。 <!-- req 07:4934fb05.add8 -->
- (b) 欄が空のまま書き出したときは、プレースホルダーの名前で書き出す。書き換えた名前には `normalize` を当てる（使えない文字の置き換えと、拡張子が無いときの形式の拡張子の追加）。書けない名前で書き出しが失敗するのを、書く前に防ぐため。
- 書き出しは、書き出すボタンで行う。 <!-- req 07:4934fb05.a421 -->
- 保存先のフォルダの欄には、その曲で前回書き出したフォルダを最初から入れておく。前回のフォルダは、ローカル既定パスの `export-folders.json` に曲の `id` ごとに覚える（[[data-model-persistence.md#13]] の 13.2 節）。 <!-- req 07:4934fb05.4033 -->
- 初めて書き出す曲と、前回書き出したフォルダが見つからないときは、保存先のフォルダの欄に「ドキュメント」フォルダを入れておく。 <!-- req 07:4934fb05.1e20 -->
- (b) 「ドキュメント」フォルダは、Electron の `app.getPath('documents')` とする。前回のフォルダが見つかるかは、書き出し画面を開いたときに main で確かめる（5 節の `export:resolveInitialFolder`）。
- (b) 書き出せたときだけ、そのフォルダを `export-folders.json` のその曲の 1 件に書く。書き出せなかったフォルダを次の初めの値にしないため。
- 書き出す範囲として、曲の全体を選べる。 <!-- req 07:4934fb05.24d4 -->
- 書き出す範囲として、譜面で選んでいる小節を選べる。 <!-- req 07:4934fb05.fcf8 -->
- 書き出す範囲として、小節の番号で指定した範囲を選べる。 <!-- req 07:4934fb05.5d43 -->
- 書き出す範囲として、ループの区間（[[playback-integration.md#3]] の 3.1 節）を選べる。 <!-- req 07:4934fb05.41aa -->
- 書き出す範囲として、セクションを選べる。 <!-- req 07:4934fb05.58fd -->
- 譜面で選んでいる小節・ループの区間・セクションが無いときは、それを書き出す範囲として選べないようにする。 <!-- req 07:4934fb05.2f42 -->
- (b) 5 つの選び方は、次のとおり `ExportBarRange` に直す。曲の全体は最初の小節から最後の小節まで。譜面で選んでいる小節は、編集ウィンドウの範囲選択（`CursorController.selection`、[[editing-core.md#4]] の 4.1 節）の `startBarIndex` から `endBarIndex` までの小節を丸ごと、選んだ全部のパートに当てる。小節の番号で指定した範囲は、欄に入れた 1 始まりの番号から 1 を引いた値。ループの区間は `PlaybackService.loop`（[[playback-integration.md#1]] の 1.2 節）の今の値で、セクションのループはそのマーカーの区間を引き直した値。セクションは、選んだセクションマーカーの区間（[[data-model-persistence.md#6]] の 6.1 節）。範囲選択が無い・ループが入っていない・セクションマーカーが 1 つも無いときを、それぞれ「無いとき」とする。
- 書き出し画面の欄は、開くたびに次の決まった初めの値から始め、前回の値を覚えない。保存先のフォルダの欄だけは、上のとおり前回のフォルダを覚える（2026-10-13 本人決定）。
- 形式の欄の初めの値は PDF とする（2026-10-13 本人決定）。
- PDF の欄の初めの値は、書き出す範囲が曲の全体、パートが全部のパート、拡大率が 100%（1.4 節）、コード名が編集ウィンドウのコードネームの表示の入切（[[editing-core.md#8]]）と同じ、小節メモが入れないとする（2026-10-13 本人決定）。
- MIDI の欄の初めの値は、メトロノームのクリックを含めない・カウントインを含めない・ミキサーの音量を入れる・ミキサーのパンを入れるとする（1.3 節の欄、2026-10-13 本人決定）。
- 印刷プレビューダイアログ（3.3 節）も、開くたびに上の PDF の欄と同じ初めの値から始める（2026-10-13 本人決定）。2 つのダイアログの PDF の欄をそろえ（honnin-queue 99 番）、画面で見ている譜面のとおりに組んだものから始めるため。
- PDF を選んで書き出しても、印刷プレビューへは移らない（印刷は 3.3 節）。 <!-- req 07:4934fb05.9ad9 -->
- 保存先に同じ名前のファイルがあるときは、上書きしてよいかを聞く。 <!-- req 07:4934fb05.819b -->
- 聞いて「いいえ」と答えたら、書き出さずに書き出し画面に戻る。 <!-- req 07:4934fb05.05cd -->
- (b) 聞くのは書き出し画面の上に開くモーダルダイアログとし、文は「{ファイル名} はもうあります。上書きしますか？」、ボタンは「上書きする」と「上書きしない」にする。基本設計 08 章 5 節の、ボタンを肯定と否定のはっきりした言葉にする決まりに合わせるため。「上書きしない」が基本設計の「いいえ」に当たる。 <!-- req 13:dcf8dce0.43b7 -->
- パートが 0 の曲では、エクスポートダイアログと印刷プレビューダイアログを開く入口（ボタンとメニュー）を押せないようにする。押せない状態の出し方は [[screens-navigation.md#12]] の 12.2 節。 <!-- req 07:4934fb05.fcdf -->

```ts
// packages/core/src/export/ExportService.ts
export type ExportRangeKind = 'whole' | 'selection' | 'barNumbers' | 'loop' | 'section';

export interface ExportRequest {
  format: ExportFormat;
  rangeKind: ExportRangeKind;
  /** rangeKind が 'barNumbers' のときの、欄に入れた 1 始まりの番号。 */
  barNumbers?: { from: number; to: number };
  /** rangeKind が 'section' のときに選んだマーカー。 */
  sectionMarkerId?: string;
  trackIndices: readonly number[];
  /** 欄に入れた名前。空ならプレースホルダーの名前。 */
  fileName: string;
  folderAbsolutePath: string;
  midi?: MidiExportOptions;
  pdf?: PrintLayoutSettings;   // 3.2 節
  revealAfterExport: boolean;  // 4 節
}

export type ExportResult = 'written' | 'cancelled' | 'failed';

/** 印刷プレビューダイアログの欄（3.3 節）。PDF の欄と同じもの。 */
export interface PrintRequest {
  rangeKind: ExportRangeKind;
  barNumbers?: { from: number; to: number };
  sectionMarkerId?: string;
  trackIndices: readonly number[];
  layout: PrintLayoutSettings;   // 3.2 節
}

/** 書き出し画面と印刷プレビューダイアログから呼ぶ窓口。編集ウィンドウごとに 1 つ。 */
export class ExportService {
  /** 5 つの選び方のうち、いま選べるもの（2 節の「無いとき」を除いたもの）。 */
  availableRangeKinds(): ReadonlySet<ExportRangeKind>;
  /** 書き出し画面を開いたときの保存先の欄の値。 */
  resolveInitialFolder(songId: string): Promise<string>;
  /** 同じ名前のファイルがあれば confirmOverwrite を呼び、false なら書かずに 'cancelled' を返す。 */
  export(request: ExportRequest, confirmOverwrite: (fileName: string) => Promise<boolean>): Promise<ExportResult>;
  /** MIDI のプレビューの「試しに鳴らす」（1.3 節）。切り出し（1.1 節）と MidiExportService.compose(…, 'audition') を通し、PlaybackService.startExportAudition に渡す。 */
  auditionMidi(request: ExportRequest): Promise<void>;
  /** 試しの音を止める（PlaybackService.stopExportAudition）。鳴っていなければ何もしない。 */
  stopMidiAudition(): void;
  /** 印刷プレビューダイアログのページを組み、ページの中身を返す（3.3 節）。 */
  layoutPrint(request: PrintRequest): Promise<readonly string[]>;
  /** 今のプレビューと同じ組みを印刷する（3.3 節）。 */
  print(request: PrintRequest): Promise<void>;
}
```

- (b) 書き出し画面（`packages/ui-desktop`）は、書き出しについて `ExportService` だけを呼び、1 節の 3 つの変換と 3 節の PDF の作りに直接触れない。`ExportService` が、切り出し（1.1 節）・変換・ファイル名の決まり・書き込み（5 節の IPC）を順に呼ぶ。印刷プレビューダイアログも、ページを組むのと印刷は `ExportService` の `layoutPrint` と `print` だけを呼ぶ。

## 3. PDF と印刷プレビュー

[[../basic_design/07_export_print.md#3]] を受ける。印刷プレビューダイアログに置くものは [[screens-navigation.md#12]] の 12.7 節が正。

### 3.1 レイアウト

- 用紙の大きさは A4 に決め、選べるようにしない。 <!-- req 07:1aa748d1.5334 -->
- 1 段に並べる小節の数は決めず、用紙の幅に合わせて自動で変える（[[view-modes.md#1]] の 1.4 節と同じ決まり）。 <!-- req 07:f110ab96.a79f -->
- (b) alphaTab の `display.layoutMode` を `LayoutMode.Page`、`display.barsPerRow` を `-1`（自動）にする。どちらも alphaTab の既定の値で、画面と同じ組み方になるため。
- 組み方は、画面の表示と同じ alphaTab のレイアウトエンジンの標準の動きを、A4 の幅に合わせた描画の設定で使う。 <!-- req 07:f110ab96.3e25 -->
- 編集画面のフォーカスビューと、印刷の組み方の作りを分けない。 <!-- req 07:f110ab96.7ff3 -->
- 編集画面の全体スクロールビューとも、印刷の組み方の作りを分けない。 <!-- req 07:f110ab96.cb02 -->
- (b) `PrintLayoutRenderHost`（3.2 節）は、`ScoreRenderHost` と同じ `RenderHostOptions`（[[web-core-foundation.md#12]] の 12.1 節）で alphaTab を作り、同じ描き方の設定（SVG・フォント・タブ譜だけを描く `Staff` の設定、[[view-modes.md#1]] の 1.4 節）を使う。印刷の側が変えるのは、幅・拡大率・ページ分け・コード名の要素（1.4 節）・小節メモのための段の上の余白（3.2 節）だけとし、印刷のための組み方の規則を自前で起こさない。`ScoreRenderHost` を広げず別のクラスにするのは B21（[[web-core-foundation.md#12]] の 12.4 節）。
- ヘッダーに曲名を出す。 <!-- req 07:f1a2577d.586b -->
- フッターにページ番号を出す。 <!-- req 07:f1a2577d.94fc -->
- あわせて、書き出した日付を小さく出す。 <!-- req 07:f1a2577d.8cd1 -->
- (b) ページの余白は上下左右とも 15mm とし、ヘッダーは上の余白の中、フッターは下の余白の中に置く。譜面を組む幅は、A4 の幅 210mm から左右の余白を引いた 180mm とする。ページ番号は「1 / 3」（今のページ／全部のページ）の形でフッターの中央に、日付はフッターの右に、ページ番号より小さい文字で出す。日付は基本設計 03 章 5 節の書式のうち、年が違うときの形の日付の部分（「2026/10/13」、月と日に 0 を付けない）とする。紙は後から読むので、今日に書き出しても年を省かないため。書体は画面の本文と同じもの（[[web-core-foundation.md#4]] の 4.2 節）を使う。

### 3.2 生成の流れ（`PrintLayoutRenderHost`・`PrintWindowController`）

- PDF は、Electron の標準の API の `webContents.printToPDF()` で作る。 <!-- req 07:96c2ec68.a1eb -->
- PDF を作るための、画面に出さない専用の `BrowserWindow` を用意する（2026-09-27 本人決定。編集画面を止めないため）。 <!-- req 07:96c2ec68.8b3d -->
- その中で、alphaTab のレイアウトエンジンで A4 の幅に組み直した描画の結果（SVG）を用意する。 <!-- req 07:96c2ec68.1eb0 -->
- ヘッダーとフッターを、同じページの中に HTML の要素として置く。 <!-- req 07:96c2ec68.561c -->
- そのうえで `printToPDF()` を呼び、戻り値の PDF のバイト列をそのまま受け取る。外部の PDF のライブラリに頼らず、ページ分けは Chromium の印刷のエンジンに任せる。 <!-- req 07:96c2ec68.a3c9 -->
- PDF の作りは、`PrintLayoutRenderHost` と `PrintWindowController` による、`printToPDF()` を第一の選択とする形で決める。 <!-- req 07:12523674.75f3 -->

```ts
// packages/core/src/rendering/PrintLayoutRenderHost.ts（見えないウィンドウのレンダラーで動く）
/** 印刷と PDF の組み方の設定（書き出し画面の PDF の設定と同じもの）。 */
export interface PrintLayoutSettings {
  /** 0.5 から 2.0 を 0.1 刻み（1.4 節）。 */
  scale: number;
  includeChordNames: boolean;
  includeMemos: boolean;
}
export interface PrintPageHeader { songTitle: string; exportDateText: string; }
/** 小節メモ（includeMemos のときだけ渡す）。barIndex は写しの中の 0 始まりの小節の番号、texts はその小節のメモを置いた順に並べたもの。 */
export interface PrintBarMemo { barIndex: number; texts: readonly string[]; }
export class PrintLayoutRenderHost {
  initialize(container: HTMLElement, options: RenderHostOptions): void;
  /** 写しの Score を A4 の幅で組み、ページごとの要素（SVG とヘッダーとフッターと小節メモ）を container に並べる。組み終えたらページの数を返す。 */
  layoutPages(score: model.Score, settings: PrintLayoutSettings, header: PrintPageHeader, memos: readonly PrintBarMemo[]): Promise<number>;
  /** プレビューに見せるページの中身（ページごとの SVG とヘッダーとフッターの要素の文字列）。 */
  pageMarkup(): readonly string[];
  dispose(): void;
}
```

```ts
// apps/desktop/src/main/PrintWindowController.ts
export interface PrintLayoutKey { songId: string; settingsHash: string; }
export class PrintWindowController {
  /** 見えないウィンドウを作り（あれば使い回し）、写しの Score を組ませて、ページの中身を返す。 */
  layout(key: PrintLayoutKey, scoreJson: string, settings: PrintLayoutSettings, header: PrintPageHeader, memos: readonly PrintBarMemo[]): Promise<readonly string[]>;
  /** key が今の組みと同じなら組み直さずに printToPDF() し、absolutePath に書く。 */
  writePdf(key: PrintLayoutKey, absolutePath: string): Promise<void>;
  /** key が今の組みと同じなら組み直さずに webContents.print() を呼ぶ（3.3 節）。 */
  print(key: PrintLayoutKey): Promise<void>;
  /** ダイアログを閉じたとき。見えないウィンドウを閉じる。 */
  release(): void;
}
```

- (b) 見えないウィンドウは、アプリで 1 つだけ持つ（[[web-core-foundation.md#10]] の 10.2 節の「1 つ」）。書き出し画面か印刷プレビューダイアログでページを見せるときに作り、そのダイアログを閉じたら閉じる（`release`）。持っている間は、最後に組んだ `PrintLayoutKey` と組み終えたページを 1 つだけ持ち、同じ key の `writePdf`・`print` では組み直さない（[[../basic_design/13_design_decision_points.md#3]] B28）。key が違うときは、同じウィンドウで組み直してから書く。B28 の「新しく組み終えてから前の組みを捨てる」順は、ウィンドウを 1 つにしたので、組み直しの前の組みを `PrintLayoutRenderHost.dispose` で捨てる形になる。 <!-- req 13:5864777d.7314 --> <!-- req 13:5864777d.4ee3 --> <!-- req 13:5864777d.ebe4 -->
- (b) 写しの Score は、編集ウィンドウのレンダラーで 1.1 節の `ExportScoreSlicer` と 1.4 節のコード名の書き入れを済ませ、`JsonConverter.scoreToJson` の文字列にして IPC で main へ送る。main は見えないウィンドウへ渡し、見えないウィンドウは `JsonConverter.jsonToScore` で戻す。B23 のとおりメモリの Score を使い、IPC には文字列だけを通すため。`settingsHash` は `PrintLayoutSettings` と範囲とパートと、小節メモを入れるときはメモの本文から作る。
- (b) 小節メモを入れるときは、写しの範囲の小節にあるメモ（`appMeta.memos`、[[editing-core.md#3]] の 3.10 節）を、編集ウィンドウのレンダラーで `PrintBarMemo` の並びにして、写しの Score と一緒に送る。メモは Score の外の `appMeta` に持ち、`JsonConverter` の文字列には入らないため。
- (b) 小節メモは、ヘッダーとフッターと同じく、本書がページの要素の側で HTML の要素として描く。alphaTab で 1 回組んだ後、`boundsLookup` の各小節の枠（段の上の端と、小節の左右の端）から、メモの枠の幅をその小節の幅にして本文を折り返し、要る高さを測る。1 つの小節に 2 件以上あれば、置いた順に改行して並べる。段の上の余白（alphaTab の `display.systemPaddingTop`）を、alphaTab の既定の値に全部のメモの枠の高さの最大を足した値にして組み直し、各メモをその小節の段の上の余白の中に、小節の左の端にそろえて置く。文字の大きさは、フッターの日付（3.1 節）と同じ小さい文字とする。メモの枠を小節の幅に収めて段の上の余白に置くので、隣の小節のメモとも、段の中のコード名とも重ならない（2026-10-13 本人決定、honnin-queue 98 番の「段の間を広げる」）。
- (b) メモの無い範囲と、小節メモを入れない設定のときは、段の上の余白を既定のままにして組み直さない。段の上の余白を変えても 1 段に並ぶ小節と小節の幅が 1 回目と同じになるかは未確認（推測）で、実装の前に確かめる（7 節）。
- (b) 見えないウィンドウには、`apps/desktop/src/renderer` の印刷用の入口（`print.html`）を読ませ、Webコアの `PrintLayoutRenderHost` だけを載せる。編集の一式（コマンド・再生）は載せない。`webPreferences` は [[web-core-foundation.md#6]] の 6.2 節の既定値のままとする。
- (b) 見えないウィンドウのレンダラーが落ちたとき（`render-process-gone`）は、持っていた組みを捨て、待っている頼みを失敗にして `EXPORT-001` を出す。[[web-core-foundation.md#7]] の 7.2 節の⑦のように自動保存から読み込み直すことはしない。このウィンドウは曲のデータを持たず、次にページを見せるときに作り直せば足りるため。
- (b) `printToPDF()` には、用紙 A4・余白なし・`printBackground: true`・`displayHeaderFooter: false` を渡し、余白とヘッダーとフッターはページの要素の側（3.1 節）で作る。ヘッダーとフッターの書体と位置を HTML と CSS で決められるようにするため。
- (b) プレビューに見せるページは、見えないウィンドウで組んだページの中身（`pageMarkup`）を IPC で書き出し画面と印刷プレビューダイアログへ返し、ダイアログはページの順に持って 1 ページずつめくって見せる（めくり方は 3.3 節）。中身は alphaTab が描いた SVG と、本書が作ったヘッダーとフッターの要素だけで、ダイアログのレンダラーの CSP（`script-src 'self'`、6.2 節）のまま見せる。
- ヘッダーとフッター（曲名・ページ番号・日付）の書体と位置を思うように置けることを前提とし、それが `printToPDF()` のオプションで出せないと分かったときに限り、切り替えを考える段に進む。 <!-- req 07:6391affc.6634 --> <!-- req 13:ddcbbc7b.f009 -->
- そのときは、Phase 2 で、専用の PDF 生成ライブラリ（候補は pdf-lib）への切り替えを考える。切り替えは必要になってから考えることとし、本書は切り替えた後の組み方を決めない（2026-10-13 本人決定、honnin-queue 92 番）。 <!-- req 07:6391affc.c437 -->
- Phase 2 の実装では、ヘッダーとフッターの表し方がこの方式で足りるかを、作りながら確かめる。 <!-- req 07:f9235422.ead6 -->
- 足りないときに限って、専用のライブラリへの切り替えを判断する。 <!-- req 07:f9235422.a2cd -->

### 3.3 印刷プレビューダイアログ

- 印刷プレビューダイアログを開く入口は、編集画面のファイルメニューの「印刷」の 1 つと、Ctrl+P の 1 つの、2 つだけとする（[[screens-navigation.md#5]] の 5.1 節の #11）。 <!-- req 07:743c6d68.c591 --> <!-- req 07:743c6d68.4991 -->
- 3.2 節と同じ印刷用のレイアウトでページごとに描いたものを、ページをめくって見せる。 <!-- req 07:743c6d68.346c -->
- 書き出し画面で PDF を選んで書き出しても、印刷プレビューへは移らない（2.2 節）。 <!-- req 07:743c6d68.f159 -->
- 「印刷」ボタンを押すと、OS 標準の印刷のダイアログ（プリンタを選ぶ画面）を呼ぶ。 <!-- req 07:c62c200d.eb6c -->
- 呼ぶのは Electron の `webContents.print()` とし、実際の印刷の処理は OS に任せる。 <!-- req 07:c62c200d.9836 -->
- (b) `print()` は、3.2 節の見えないウィンドウの、プレビューに見せたのと同じ組み（同じ印刷用のレイアウトの DOM）に対して呼ぶ。`printToPDF()` とは別の API だが、組みを 2 回作らないため（B28）。基本設計の 2 つの選び方のうち `webContents.print()` を採るのは、OS 標準の印刷のダイアログを Electron がそのまま開き、ネイティブの印刷の API を別に持たずに済むため。(b) ページめくりは、プレビューの下に「前のページ」「次のページ」のボタンと「1 / 3」（今のページ／全部のページ）の表示を置き、ダイアログにフォーカスがある間は ← と → のキーでもめくる。最初のページでは「前のページ」、最後のページでは「次のページ」を押せない状態で出す。書き出し画面の PDF のプレビューも同じめくり方にする。紙の 1 枚ずつの見え方で確かめられ、2 つのダイアログで見せ方をそろえるため。
- 印刷プレビューダイアログには、PDF の書き出しと同じ設定の欄（範囲・パート・拡大率・コード名を入れるか・小節メモを入れるか）を置き、プレビューと印刷はその値で組む（2026-10-13 本人決定、honnin-queue 99 番。欄の並びは [[screens-navigation.md#12]] の 12.7 節、初めの値は 2.2 節）。
- (b) 欄の値を変えたら、`ExportService.layoutPrint` でページを組み直してプレビューを替える。「印刷」ボタンは、今のプレビューと同じ組みを印刷する（3.2 節の key が同じなら組み直さない）。プレビューで見たものと印刷されるものを同じにするため。範囲の 5 つの選び方と「無いとき」は、書き出し画面と同じ（2.2 節）。コード名と小節メモの描き方も PDF と同じ（1.4 節・3.2 節）。

## 4. 共有

[[../basic_design/07_export_print.md#4]] を受ける。

- PC 版の共有は、OS 標準の共有の手段（エクスプローラーでファイルを見せる・既定のメールのアプリ）に任せる。 <!-- req 07:4be17bc6.66ff -->
- アプリの中に、独自の共有の画面を持たない。 <!-- req 07:4be17bc6.2cbe -->
- (b) アプリがするのは、書き出し画面の「書き出したらフォルダを開く」（[[screens-navigation.md#12]] の 12.6 節）が入っているときに、書き出したファイルをエクスプローラーで選んだ状態で見せることだけとする。main が `shell.showItemInFolder` を呼ぶ（5 節の `export:revealFile`）。設定ダイアログからログのフォルダを開く `app:openLogFolder`（[[error-logging-foundation.md#2]] の 2.4 節）と同じ形にそろえるため。(b) 既定のメールのアプリは、アプリから起動しない。利用者が、エクスプローラーで見せたファイルを、OS の手段（右クリックの「送る」やメールのアプリへの添付）で送る。基本設計の「OS標準の共有手段に委ねる」を、共有の操作そのものを OS の側で行うことと読み、アプリからメールを起動する入口を置くと、アプリの中に独自の共有の画面を持つことになるため。
- エクスポートと共有の機能は、少数の知人への私的な共有を想定した範囲に留める（耳コピしたタブ譜は他者の楽曲を書き写したものなので）。 <!-- req 07:0350cf41.6a91 -->
- 不特定多数への公開や再配布を前提にした機能（SNS への直接の投稿、公開のリンクの発行）は、設計として意図して持たない。 <!-- req 07:0350cf41.a21b -->
- この方針は、将来機能を足すときも変えない。 <!-- req 07:0350cf41.e586 -->

## 5. エラーと IPC

- 変換の失敗（alphaTex・MIDI の変換と、PDF の組みと `printToPDF()` の失敗。見えないウィンドウが落ちたときを含む）は `EXPORT-001`（Error）とし、その形式の書き出しだけを止める。書き込みの失敗は `EXPORT-002`（Error）、書き出せたら `EXPORT-003`（Info）を出す。コードとレベルと文言は [[00_reference.md#5]] が正。 <!-- req 13:9e532f77.5935 --> <!-- req 13:9e532f77.06d4 -->
- (b) 書き出しの失敗は、どれも自動でやり直さない。利用者が保存先かファイル名を変えて書き出し直す形にする（作り直す前の本書の決まり）。
- IPC は [[web-core-foundation.md#6]] の 6.3 節の決まり（`invoke`／`handle`、型は `packages/shared-types`）で、次のチャンネルを置く。main は受けたパスとファイル名を確かめてから使う（6.2 節）。

| チャンネル | 向き | main のすること | 要求 → 応答 |
|---|---|---|---|
| `export:resolveInitialFolder` | renderer → main | `export-folders.json` のその曲のフォルダがあればそれを、無いか見つからなければ `app.getPath('documents')` を返す（2.2 節） | `{ songId }` → `string` |
| `export:rememberFolder` | renderer → main | `export-folders.json` のその曲の 1 件を替える（[[data-model-persistence.md#13]] の 13.2 節の書き方） | `{ songId, folderAbsolutePath }` → `void` |
| `export:chooseFolder` | renderer → main | フォルダを選ぶ OS のダイアログを開く（[[web-core-foundation.md#7]] の 7.3 節の (b)） | `{ initialFolder }` → `string \| null` |
| `export:fileExists` | renderer → main | そのパスにファイルがあるか | `{ absolutePath }` → `boolean` |
| `export:writeFile` | renderer → main | alphaTex の文か MIDI のバイト列を書く。失敗は `EXPORT-002` の元になる | `{ absolutePath, data: string \| Uint8Array }` → `{ ok: boolean }` |
| `export:layoutPages` | renderer → main | `PrintWindowController.layout` | `{ key, scoreJson, settings, header, memos }` → `string[]` |
| `export:writePdf` | renderer → main | `PrintWindowController.writePdf` | `{ key, absolutePath }` → `{ ok: boolean; failure?: 'convert' \| 'write' }` |
| `export:print` | renderer → main | `PrintWindowController.print` | `{ key }` → `void` |
| `export:release` | renderer → main | `PrintWindowController.release` | `{}` → `void` |
| `export:revealFile` | renderer → main | `shell.showItemInFolder`（4 節） | `{ absolutePath }` → `void` |

- (b) PDF は main が `printToPDF()` の戻り値をそのまま書き（`export:writePdf`）、PDF のバイト列をレンダラーへ返さない。大きな曲で PDF をレンダラーへ往復させないため。

## 6. Phase 2 の申し送りと終わりの条件

[[../basic_design/07_export_print.md#5]] と [[../basic_design/07_export_print.md#6]] を受ける。中身は 1 節から 3 節に書いた。

- Phase 1 では、書き出しと印刷のボタンを押せない状態にしてある（[[../basic_design/13_design_decision_points.md#3]] B19、[[screens-navigation.md#12]] の 12.6 節と 12.7 節）。B19 は、2 つのダイアログの実行のボタンが本書のサービス（`ExportService` と `PrintWindowController`）につながり、押せない状態が解かれたときに解消したとする。 <!-- req 07:a3cf0182.fa8e --> <!-- req 13:a7f577e8.7011 -->

## 7. テストと実装の前に確かめること

- 単体テスト（基準は [[web-core-foundation.md#14]] の 14.3 節、[[../basic_design/11_test_strategy.md#2]]）：`ExportScoreSlicer`（範囲の端・パートの選び方・頭の拍子とテンポ）、`ExportFileNameGenerator`（パートが 1 つと 2 つ以上・使えない文字・拡張子）、`MidiExportService`（カポ・2 つ以上のパート・拍子の変化を含む曲で、音の高さが `computeRealMidiPitch` と同じになること、4 つの切り替え、1.3 節の表の 10 の奏法記号、`'audition'` のときだけ置く GM の既定の値）、`PrintWindowController` の key の比べ方（同じ key で組み直さない・違う key で組み直す）。
- 往復のテスト：alphaTex は 1.2 節の読み戻し。MIDI は、テストのためだけの軽い SMF の読み手で読み戻して比べる（作り直す前の本書の決まり）。種類とカバレッジは [[web-core-foundation.md#14]] の 14.3 節の表。
- 結合か手での確かめ：書き出し画面のプレビュー → 書き出す（PDF）、印刷プレビュー → 印刷の 2 つの流れで、組みが 1 回だけ作られること。
- 実装の前に確かめること（Phase 2 の始め）：(1) `AlphaTexExporter` に渡す `Settings` に、既定の値のままで足りないオプションがあるか（1.2 節）。(2) alphaTab の `boundsLookup.staffSystems` の段の高さで、段をページへ分けられるか（3.2 節の `layoutPages`）。(3) 見えないウィンドウで組んだ SVG を、書き出し画面の中で同じフォントで見せられるか（3.2 節）。(4) `printToPDF()` に余白なしを渡して、ページの要素の余白どおりに出るか（3.1 節）。(5) `MidiFile` を `MidiFileFormat.MultiTrack` にして `toBinary` で書いたものが、1 本目をコンダクタートラックとする SMF のフォーマット 1 になるか（1.3 節）。(6) `display.systemPaddingTop` を変えて組み直しても、1 段に並ぶ小節と小節の幅が変わらないか、`boundsLookup` から小節の枠を見えないウィンドウで取れるか（3.2 節の小節メモ）。
- 大きな曲（基本設計 09 章 2 節の 2048 小節）での書き出しと PDF の時間は、Phase 2 の実機で測る（[[../basic_design/13_design_decision_points.md#2]] の A10）。足りないと分かったときは、A10 の (b) のとおり、書き出し画面に進み具合を出す形に替え、本書のサービスのシグネチャは変えない。 <!-- req 13:18cdf3a0.e5b7 --> <!-- req 13:18cdf3a0.29ba --> <!-- req 13:18cdf3a0.26b9 -->
