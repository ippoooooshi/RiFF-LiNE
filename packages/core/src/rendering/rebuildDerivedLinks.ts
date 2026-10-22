/**
 * 描く前の作り直し（web-core-foundation.md 12.1 節、基本設計 13 章 B33、2026-10-17 本人決定）。
 *
 * タイの指定が外れた音符のつながりを空にしてから `score.finish(settings)` を呼び、`finish()` が作る派生情報
 * （拍の番号・前後の拍・タイによるフレットの写しとつながり・スライドの行き先）をまとめて作り直す。
 * alphaTab 1.8.4 の描き直しの通り道は `Score.finish` を呼ばないため、`ScoreRenderHost.render` がこれを呼ぶ。
 * DOM の無い単体テストからも同じ作り直しを呼んで確かめられるよう、`render` から切り出している。
 */

// 12.1 節：Settings は型のみで @coderline/alphatab から取り込む <!-- req webcorefoundation:2964ae35.1e37 --> <!-- req webcorefoundation:2964ae35.68d3 -->
import type { model, Settings } from '@coderline/alphatab';

/**
 * (1) タイの指定（`isTieDestination`）が偽で `tieOrigin` が空でない音符について、その `tieOrigin` の
 *     `tieDestination` がこの音符なら空にし、この音符の `tieOrigin` を空にする
 * (2) `score.finish(settings)` を呼ぶ
 * (1) を (2) の前にするのは、alphaTab 1.8.4 の `Note.chain` が、`tieOrigin` が空でなければタイの指定が偽の音符でも
 * 先へ進み、取り消したタイをもう一度張ってフレットを写すため。
 */
// 12.1 節：rebuildDerivedLinks(score, settings) を export し、(1) タイの取り消し (2) score.finish の順にする。コマンドと CommandHistory は Score.finish を呼ばない。Phase 0 で 2 回続けた finish と 2048 小節の 100ms を確かめ、成り立たなければ案 B（コマンドの中でつながりを張る・外す）に替える <!-- req webcorefoundation:7a43ecae.ef5d --> <!-- req webcorefoundation:eb22357d.05c2 --> <!-- req webcorefoundation:eb22357d.f2f0 --> <!-- req webcorefoundation:eb22357d.fac9 --> <!-- req webcorefoundation:eb22357d.529d --> <!-- req webcorefoundation:eb22357d.e4e6 --> <!-- req webcorefoundation:eb22357d.e735 --> <!-- req webcorefoundation:e1503f7f.fe7a --> <!-- req webcorefoundation:e1503f7f.9cac --> <!-- req webcorefoundation:e1503f7f.4172 --> <!-- req webcorefoundation:e1503f7f.5345 --> <!-- req webcorefoundation:e1503f7f.2e7f --> <!-- req webcorefoundation:e1503f7f.4e1d --> <!-- req webcorefoundation:0fadd2a6.9e55 --> <!-- req webcorefoundation:0fadd2a6.2589 --> <!-- req webcorefoundation:0fadd2a6.4186 --> <!-- req webcorefoundation:0fadd2a6.7aa4 --> <!-- req webcorefoundation:0fadd2a6.5e04 --> <!-- req webcorefoundation:0fadd2a6.52cb --> <!-- req webcorefoundation:0fadd2a6.b647 --> <!-- req webcorefoundation:99eb5f34.a5a6 --> <!-- req webcorefoundation:99eb5f34.6005 --> <!-- req webcorefoundation:99eb5f34.48ef --> <!-- req webcorefoundation:99eb5f34.1ec0 --> <!-- req webcorefoundation:99eb5f34.89da -->
export function rebuildDerivedLinks(score: model.Score, settings: Settings): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              const origin = note.tieOrigin;
              if (note.isTieDestination || origin === null) continue;
              if (origin.tieDestination === note) origin.tieDestination = null;
              note.tieOrigin = null;
            }
          }
        }
      }
    }
  }
  score.finish(settings);
}
