/**
 * 音符の属性のコマンドのテストで、実物の alphaTab を通して確かめるための道具（editing-core.md 3.4 節・7.2 節）。
 *
 * コマンド層のテスト（editing/commands）は alphaTab の model のほかを import できない（editing-core.md 2.1 節、eslint）ので、
 * 描く前の作り直しと alphaTex の読み込みはここに置いて呼ぶ。本番コードからは import しない。
 */

import { importer, Settings, type model } from '@coderline/alphatab';

import { rebuildDerivedLinks } from '../rendering/rebuildDerivedLinks';

/** 描く前の作り直し（web-core-foundation.md 12.1 節の rebuildDerivedLinks）を、既定の設定で通す。 */
export function rebuildBeforeRender(score: model.Score): void {
  rebuildDerivedLinks(score, new Settings());
}

/** alphaTex の `nh`（自然ハーモニクス）で、指定したフレットの音を読み込んだときの harmonicValue。 */
export function harmonicValueReadFromAlphaTexNh(fret: number): number {
  const settings = new Settings();
  const texImporter = new importer.AlphaTexImporter();
  texImporter.initFromString(`\\tuning e5 b4 g4 d4 a3 e3 . ${fret}.3{nh}`, settings);
  const score = texImporter.readScore();
  return score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes[0]!.harmonicValue;
}
