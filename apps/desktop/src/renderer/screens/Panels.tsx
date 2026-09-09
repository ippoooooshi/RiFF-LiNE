/**
 * 編集ウィンドウ内の非モーダルパネル群（screens-navigation.md §4.8 #4〜#8）。
 *
 * いずれも対応するサービス／コントローラを呼び出すだけの薄い JSX（AD-2）。各パネルの表示トグルは
 * `ToolbarViewModel`（§4.4）が保持する。ドメイン計算はここで行わない。
 */

import { tokens, Panel } from './common';

// ===== #4 ミキサーパネル（PartManagementService、part-tuning-management.md §4.1） =====

export interface MixerRow {
  index: number;
  name: string;
  volume: number;
  pan: number;
  solo: boolean;
  mute: boolean;
}
export interface MixerPanelProps {
  rows: MixerRow[];
  onSetVolume: (index: number, volume: number) => void;
  onSetPan: (index: number, pan: number) => void;
  onToggleSolo: (index: number) => void;
  onToggleMute: (index: number) => void;
  onClose?: () => void;
}

export function MixerPanel(props: MixerPanelProps): React.JSX.Element {
  return (
    <Panel title="ミキサー" onClose={props.onClose}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.index}>
              <td style={{ paddingRight: tokens.gap }}>{row.name}</td>
              <td>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={row.volume}
                  aria-label={`${row.name} 音量`}
                  onChange={(e) => props.onSetVolume(row.index, Number(e.target.value))}
                />
              </td>
              <td>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={row.pan}
                  aria-label={`${row.name} パン`}
                  onChange={(e) => props.onSetPan(row.index, Number(e.target.value))}
                />
              </td>
              <td>
                <button type="button" aria-pressed={row.solo} onClick={() => props.onToggleSolo(row.index)}>
                  S
                </button>
                <button type="button" aria-pressed={row.mute} onClick={() => props.onToggleMute(row.index)}>
                  M
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ===== #5 フレットボード図オーバーレイ（読み取り専用、CursorController + ChordDetectionService、editing-core.md §8） =====

export interface FretboardOverlayProps {
  /** 現在 Beat のノート（弦番号・フレット）。 */
  notes: { string: number; fret: number }[];
  /** 推定コードネーム（`ChordDetectionService`）。無ければ null。 */
  chordName: string | null;
  onClose?: () => void;
}

export function FretboardOverlay(props: FretboardOverlayProps): React.JSX.Element {
  return (
    <Panel title="フレットボード図" onClose={props.onClose}>
      <div style={{ fontSize: '0.8rem' }}>
        <div>コード: {props.chordName ?? '—'}</div>
        <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
          {props.notes.map((note, i) => (
            <li key={`${note.string}-${note.fret}-${i}`}>
              {note.string}弦 {note.fret}フレット
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

// ===== #6 パート管理パネル（PartManagementService、part-tuning-management.md §4.1・§4.3） =====

export interface PartRow {
  index: number;
  name: string;
  colorHex: string;
  capoFret: number;
}
export interface PartManagementPanelProps {
  parts: PartRow[];
  onAddPart: () => void;
  onRemovePart: (index: number) => void;
  onMovePart: (index: number, direction: -1 | 1) => void;
  onSetCapo: (index: number, fret: number) => void;
  onClose?: () => void;
}

export function PartManagementPanel(props: PartManagementPanelProps): React.JSX.Element {
  return (
    <Panel title="パート管理" onClose={props.onClose}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.8rem' }}>
        {props.parts.map((part) => (
          <li key={part.index} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <span style={{ width: 12, height: 12, background: part.colorHex, borderRadius: 2 }} aria-hidden="true" />
            <span style={{ flex: 1 }}>{part.name}</span>
            <label>
              カポ
              <input
                type="number"
                min={0}
                max={12}
                value={part.capoFret}
                aria-label={`${part.name} カポ`}
                style={{ width: 44 }}
                onChange={(e) => props.onSetCapo(part.index, Number(e.target.value))}
              />
            </label>
            <button type="button" onClick={() => props.onMovePart(part.index, -1)} aria-label="上へ">
              ↑
            </button>
            <button type="button" onClick={() => props.onMovePart(part.index, 1)} aria-label="下へ">
              ↓
            </button>
            <button type="button" onClick={() => props.onRemovePart(part.index)} aria-label="削除">
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={props.onAddPart} style={{ marginTop: 6 }}>
        パートを追加
      </button>
    </Panel>
  );
}

// ===== #7 チューニング設定パネル（TuningPresetService、part-tuning-management.md §4.2） =====

export interface TuningPanelProps {
  presets: { id: string; name: string; builtin: boolean }[];
  currentTrackName: string;
  onApplyPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onRestorePreset: (presetId: string) => void;
  onClose?: () => void;
}

export function TuningPanel(props: TuningPanelProps): React.JSX.Element {
  return (
    <Panel title={`チューニング設定（${props.currentTrackName}）`} onClose={props.onClose}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.8rem' }}>
        {props.presets.map((preset) => (
          <li key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <span style={{ flex: 1 }}>
              {preset.name}
              {preset.builtin ? '（標準）' : ''}
            </span>
            <button type="button" onClick={() => props.onApplyPreset(preset.id)}>
              適用
            </button>
            {!preset.builtin ? (
              <button type="button" onClick={() => props.onDeletePreset(preset.id)}>
                削除
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ===== #8 小節メモ一覧パネル（AppMetadata.memos、editing-core.md §6.4） =====

export interface MemoRow {
  id: string;
  barIndex: number;
  text: string;
}
export interface MemoListPanelProps {
  memos: MemoRow[];
  onJumpToBar: (barIndex: number) => void;
  onAddMemo: () => void;
  onEditMemo: (id: string, text: string) => void;
  onDeleteMemo: (id: string) => void;
  onClose?: () => void;
}

export function MemoListPanel(props: MemoListPanelProps): React.JSX.Element {
  return (
    <Panel title="小節メモ" onClose={props.onClose}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.8rem' }}>
        {props.memos.map((memo) => (
          <li key={memo.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <button
              type="button"
              onClick={() => props.onJumpToBar(memo.barIndex)}
              aria-label={`${memo.barIndex + 1}小節へ`}
            >
              {memo.barIndex + 1}
            </button>
            <input
              value={memo.text}
              aria-label={`メモ ${memo.barIndex + 1}`}
              style={{ flex: 1 }}
              onChange={(e) => props.onEditMemo(memo.id, e.target.value)}
            />
            <button type="button" onClick={() => props.onDeleteMemo(memo.id)} aria-label="削除">
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={props.onAddMemo} style={{ marginTop: 6 }}>
        メモを追加
      </button>
    </Panel>
  );
}
