/**
 * 新規曲の初期 Score 生成（data-model-persistence.md §3.2 `SongRepository.create`）。
 *
 * 本パッケージのスコープは「保存でき、JsonConverter で決定的に往復できる最小の妥当な Score」を作るところまで。
 * パートの本格的な CRUD・チューニングプリセット適用はパート・チューニング管理パッケージ。
 * alphaTex importer ではなく alphaTab のモデル API で直接組み立てる（importer は診断が厳しく
 * ヘッドレス／jsdom で空テンプレートを通しにくいため。model builder は往復も決定的）。
 */

import { model, Settings } from '@coderline/alphatab';

import type { NewPartSetup, NewSongSetup } from './types';

/** 標準チューニング（6 弦、高音弦→低音弦の MIDI ピッチ）：e B G D A E。 */
export const STANDARD_GUITAR_TUNING: readonly number[] = [64, 59, 55, 50, 45, 40];

/** 標準ベースチューニング（4 弦、高音弦→低音弦）：G D A E。 */
export const STANDARD_BASS_TUNING: readonly number[] = [43, 38, 33, 28];

/** 既定パート：標準チューニングのエレキギター 1 本。 */
const DEFAULT_PARTS: readonly NewPartSetup[] = [
  { name: 'Guitar 1', instrumentType: 'electric_guitar', tuning: [...STANDARD_GUITAR_TUNING] },
];

/** General MIDI プログラム番号（02_data_model.md §3.2 の 2 種）。 */
const MIDI_PROGRAM: Record<NewPartSetup['instrumentType'], number> = {
  electric_guitar: 30, // Distortion Guitar
  bass: 33, // Electric Bass (finger)
};

/**
 * 1 パート分の Track を組み立てて score に追加する。空の 1 小節（全休符）を持たせる。
 */
function addPart(score: model.Score, part: NewPartSetup): void {
  const track = new model.Track();
  track.name = part.name;
  track.playbackInfo.program = MIDI_PROGRAM[part.instrumentType];
  score.addTrack(track);

  const staff = new model.Staff();
  track.addStaff(staff);
  staff.stringTuning.tunings = [...part.tuning];
  staff.showTablature = true;
  staff.showStandardNotation = false;

  // Score の各 MasterBar に対応する Bar を 1 本用意する（最初のパートが MasterBar を作る）。
  for (let i = 0; i < Math.max(1, score.masterBars.length); i++) {
    const bar = new model.Bar();
    staff.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    const rest = new model.Beat();
    rest.duration = model.Duration.Whole;
    voice.addBeat(rest);
  }
}

/**
 * 初期 Score を組み立てる。各パートは空の 1 小節（全休符）だけを持つ。
 * @param setup タイトルとパート構成。
 */
export function createInitialScore(setup: NewSongSetup): model.Score {
  const parts = setup.parts && setup.parts.length > 0 ? setup.parts : DEFAULT_PARTS;

  const score = new model.Score();
  score.title = setup.title;

  // 1 小節分の MasterBar（拍子・テンポの器）を用意する。
  score.addMasterBar(new model.MasterBar());

  for (const part of parts) {
    addPart(score, part);
  }

  score.finish(new Settings());
  return score;
}
