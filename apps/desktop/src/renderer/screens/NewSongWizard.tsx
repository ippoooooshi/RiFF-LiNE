/**
 * 新規曲作成ウィザード（screens-navigation.md §4.8 #2・§5.2）。
 *
 * ステップ1（パート数・楽器）→ `PartManagementService`、ステップ2（チューニング、既存パートからのコピー含む）→
 * `TuningPresetService`、初期値は `AppPreferencesService`。完了時 `SongRepository.create()` → `WindowManager` が
 * 編集ウィンドウを開く。ここは入力収集のみを担い、ドメイン反映はコールバック経由（AD-2）。
 */

import { useState } from 'react';

import type { NewSongSetup, TuningPreset } from '@riff-line/core';
import type { AppPreferences } from '@riff-line/core/ui';

import { tokens } from './common';

export interface NewSongWizardProps {
  preferences: AppPreferences;
  tuningPresets: TuningPreset[];
  onCancel: () => void;
  /** 収集した初期設定で曲を作る。呼び出し先が SongRepository.create → WindowManager.openSong を行う。 */
  onComplete: (setup: NewSongSetup) => void;
}

type InstrumentType = 'electric_guitar' | 'bass';

export function NewSongWizard(props: NewSongWizardProps): React.JSX.Element {
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState('新しい曲');
  const [instrument, setInstrument] = useState<InstrumentType>('electric_guitar');
  const [presetId, setPresetId] = useState<string>(props.preferences.defaultTuningPresetId ?? '');

  const chosenPreset = props.tuningPresets.find((p) => p.id === presetId);

  function complete(): void {
    const tuning = chosenPreset?.stringPitches ?? (instrument === 'bass' ? [43, 38, 33, 28] : [64, 59, 55, 50, 45, 40]);
    props.onComplete({
      title: title.trim() || '新しい曲',
      parts: [{ name: instrument === 'bass' ? 'Bass' : 'Guitar', instrumentType: instrument, tuning }],
    });
  }

  return (
    <div
      role="dialog"
      aria-label="新規曲作成"
      style={{ fontFamily: tokens.baseFont, color: tokens.text, padding: 16, maxWidth: 480 }}
    >
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>新規曲作成（ステップ {step} / 2）</h2>

      {step === 1 ? (
        <div>
          <label style={{ display: 'block', marginBottom: tokens.gap }}>
            タイトル
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label style={{ display: 'block', marginBottom: tokens.gap }}>
            楽器
            <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentType)}>
              <option value="electric_guitar">エレキギター</option>
              <option value="bass">ベース</option>
            </select>
          </label>
          <div style={{ textAlign: 'right' }}>
            <button type="button" onClick={props.onCancel}>
              キャンセル
            </button>
            <button type="button" onClick={() => setStep(2)}>
              次へ
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label style={{ display: 'block', marginBottom: tokens.gap }}>
            チューニングプリセット
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">標準（{instrument === 'bass' ? 'ベース' : 'ギター'}）</option>
              {props.tuningPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ textAlign: 'right' }}>
            <button type="button" onClick={() => setStep(1)}>
              戻る
            </button>
            <button type="button" onClick={complete}>
              作成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
