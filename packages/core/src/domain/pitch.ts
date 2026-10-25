/**
 * カポの運指→実音変換（playback-integration.md §3.2、B18、00_reference.md §2）。
 *
 * 譜面表示（記譜フレット番号）は一切変更せず、再生／MIDI エクスポート時の実音ピッチ計算に**のみ**使う。
 * `PlaybackService`（本パッケージ）と将来の `MidiExportService`（[[export-print.md#3.1]]、Phase 2）が共用する
 * 共有純粋関数として `domain` 配下へ抽出している（ロジックの重複・drift を防ぐ、単一の真実源）。
 *
 * 弦番号規約（G22）：`stringNumber` 番弦の開放弦ピッチは呼び出し側で
 * `tunings[tunings.length - stringNumber]`（`editing/scoreModel.openStringPitch`）として解決すること。
 * `note.string` は 1 = 最低音弦、`stringTuning.tunings` は先頭＝最高音弦の並び。
 */

/**
 * 再生時の実 MIDI ピッチを求める。
 *
 * 式：`openStringPitch + capoFret + frettedFret`（playback-integration.md §3.2、B18）。
 * 分岐を持たない純粋な加算。範囲チェック（`capoFret` 0〜12、`frettedFret` 0〜24）は呼び出し側の責務。
 *
 * @param openStringPitch 対象弦の開放弦チューニングピッチ（MIDI ノート番号）。
 * @param capoFret        カポ位置（0〜12。0 = カポなし）。
 * @param frettedFret     記譜されたフレット番号（0〜24。0 = 開放）。
 * @returns 実音の MIDI ノート番号。
 */
// 9.2 節：実音への読み替え（開放弦の音高＋capoFret＋記譜のフレット）は alphaTab に委ねず自作し、この 1 つの関数だけに変換式を書く。置き場所は L3 の packages/core/src/domain（export・editing と、playback の側の単体テストから import できる） <!-- req webcorefoundation:b7b2e486.3a18 --> <!-- req webcorefoundation:b7b2e486.5971 --> <!-- req webcorefoundation:b7b2e486.0b12 --> <!-- req webcorefoundation:4b8d8417.4cd9 --> <!-- req webcorefoundation:4b8d8417.dc7e --> <!-- req webcorefoundation:d55416db.a0bb --> <!-- req webcorefoundation:d55416db.194a --> <!-- req webcorefoundation:d55416db.a58c --> <!-- req webcorefoundation:d55416db.9878 -->
export function computeRealMidiPitch(openStringPitch: number, capoFret: number, frettedFret: number): number {
  return openStringPitch + capoFret + frettedFret;
}
