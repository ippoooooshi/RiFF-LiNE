/**
 * モーダルダイアログ群（screens-navigation.md §4.8 #9〜#12）。曲一覧ウィンドウの子として開く。
 *
 * - #9 設定ダイアログ：タブ4分類で12項目。保存先/ミラー先/ゴミ箱保持日数 → `StorageConfigService`、
 *   項目7（タグ管理）→ タグ管理ダイアログへの導線のみ、それ以外 → `AppPreferencesService`（§3.1、§5.4）。
 * - #10 タグ管理ダイアログ：`TagStore`（§3.2）の CRUD。
 * - #11 ゴミ箱ダイアログ：`TrashService`（data-model-persistence.md §3.2）の一覧・復元・完全削除、残り日数表示。
 * - #12 ライセンス／クレジットダイアログ：静的コンテンツ（サービス接続なし）。
 */

import { useState } from 'react';

import type { AppPreferences, MetronomePresetId } from '@riff-line/core/ui';

import { Dialog, Field, tokens } from './common';

// ===== #9 設定ダイアログ =====

type SettingsTab = 'edit' | 'playback' | 'storage' | 'other';

export interface SettingsDialogProps {
  preferences: AppPreferences;
  /** ストレージ構成（保存先・ミラー先・ゴミ箱保持日数）。表示用の要約文字列で受ける。 */
  storageSummary: { activeRootLabel: string; mirrorCount: number; trashRetentionDays: number };
  onSavePreferences: (prefs: AppPreferences) => void;
  onChangeStorageRoot: () => void;
  onOpenTagManagement: () => void;
  onShowOnboarding: () => void;
  onClose: () => void;
}

export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('edit');
  const [draft, setDraft] = useState<AppPreferences>(props.preferences);

  function patch(next: Partial<AppPreferences>): void {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  return (
    <Dialog
      title="設定"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" onClick={props.onClose}>
            キャンセル
          </button>
          <button type="button" onClick={() => props.onSavePreferences(draft)}>
            保存
          </button>
        </>
      }
    >
      <nav style={{ display: 'flex', gap: 4, marginBottom: tokens.gap }}>
        {(['edit', 'playback', 'storage', 'other'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {{ edit: '編集', playback: '再生', storage: '保存先', other: 'その他' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'edit' ? (
        <div>
          <Field label="① 初期チューニングプリセットID">
            <input
              value={draft.defaultTuningPresetId ?? ''}
              onChange={(e) => patch({ defaultTuningPresetId: e.target.value || null })}
            />
          </Field>
          <Field label="② 初期音色ID">
            <input
              value={draft.defaultInstrumentSoundId ?? ''}
              onChange={(e) => patch({ defaultInstrumentSoundId: e.target.value || null })}
            />
          </Field>
          <Field label="③ デフォルトズーム倍率（focus %）">
            <input
              type="number"
              value={draft.zoomScaleByMode.focus}
              onChange={(e) => patch({ zoomScaleByMode: { ...draft.zoomScaleByMode, focus: Number(e.target.value) } })}
            />
          </Field>
          <Field label="⑧ パート初期音量">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft.partDefaultVolume}
              onChange={(e) => patch({ partDefaultVolume: Number(e.target.value) })}
            />
          </Field>
        </div>
      ) : null}

      {tab === 'playback' ? (
        <div>
          <Field label="④ メトロノーム音量">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft.metronomeVolume}
              onChange={(e) => patch({ metronomeVolume: Number(e.target.value) })}
            />
          </Field>
          <Field label="④ メトロノーム音色">
            <select
              value={draft.metronomePresetId}
              onChange={(e) => patch({ metronomePresetId: e.target.value as MetronomePresetId })}
            >
              <option value="acoustic">アコースティック</option>
              <option value="click">クリック</option>
              <option value="wood">ウッド</option>
              <option value="beep">ビープ</option>
            </select>
          </Field>
          <Field label="⑤ カウントイン小節数">
            <select
              value={draft.countInMeasureMultiplier}
              onChange={(e) => patch({ countInMeasureMultiplier: Number(e.target.value) === 2 ? 2 : 1 })}
            >
              <option value={1}>1 小節</option>
              <option value={2}>2 小節</option>
            </select>
          </Field>
          <Field label="⑥ タップテンポ感度（サンプル数）">
            <input
              type="number"
              min={2}
              max={8}
              value={draft.tapTempoSampleSize}
              onChange={(e) => patch({ tapTempoSampleSize: Number(e.target.value) })}
            />
          </Field>
        </div>
      ) : null}

      {tab === 'storage' ? (
        <div>
          <Field label="⑨ 保存先">
            <span>
              {props.storageSummary.activeRootLabel}{' '}
              <button type="button" onClick={props.onChangeStorageRoot}>
                変更…
              </button>
            </span>
          </Field>
          <Field label="⑩ ミラー先">
            <span>{props.storageSummary.mirrorCount} 箇所</span>
          </Field>
          <Field label="⑫ ゴミ箱保持日数">
            <span>{props.storageSummary.trashRetentionDays} 日</span>
          </Field>
        </div>
      ) : null}

      {tab === 'other' ? (
        <div>
          <Field label="⑦ タグ管理">
            <button type="button" onClick={props.onOpenTagManagement}>
              タグ管理を開く…
            </button>
          </Field>
          <Field label="曲一覧の既定表示方式">
            <select
              value={draft.songListLayout}
              onChange={(e) => patch({ songListLayout: e.target.value === 'list' ? 'list' : 'grid' })}
            >
              <option value="grid">グリッド</option>
              <option value="list">リスト</option>
            </select>
          </Field>
          <Field label="⑪ 起動時にアプリ情報を表示">
            <input
              type="checkbox"
              checked={draft.showAppInfoOnStartup}
              onChange={(e) => patch({ showAppInfoOnStartup: e.target.checked })}
            />
          </Field>
          <Field label="使い方（オンボーディング）">
            <button type="button" onClick={props.onShowOnboarding}>
              もう一度表示
            </button>
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}

// ===== #10 タグ管理ダイアログ =====

export interface TagManagementDialogProps {
  tags: { id: string; name: string }[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function TagManagementDialog(props: TagManagementDialogProps): React.JSX.Element {
  const [newName, setNewName] = useState('');
  return (
    <Dialog title="タグ管理" onClose={props.onClose}>
      <div style={{ display: 'flex', gap: 4, marginBottom: tokens.gap }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新しいタグ名"
          aria-label="新しいタグ名"
        />
        <button
          type="button"
          onClick={() => {
            props.onCreate(newName);
            setNewName('');
          }}
        >
          追加
        </button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {props.tags.map((tag) => (
          <li key={tag.id} style={{ display: 'flex', gap: 4, padding: '2px 0' }}>
            <input
              value={tag.name}
              aria-label={`タグ ${tag.name}`}
              style={{ flex: 1 }}
              onChange={(e) => props.onRename(tag.id, e.target.value)}
            />
            <button type="button" onClick={() => props.onDelete(tag.id)}>
              削除
            </button>
          </li>
        ))}
      </ul>
      <p style={{ color: tokens.subtext, fontSize: '0.8rem' }}>タグは最大50個まで（超過時は TAG-001）。</p>
    </Dialog>
  );
}

// ===== #11 ゴミ箱ダイアログ =====

export interface TrashEntry {
  songId: string;
  title: string;
  remainingDays: number;
}
export interface TrashDialogProps {
  entries: TrashEntry[];
  onRestore: (songId: string) => void;
  onPermanentlyDelete: (songId: string) => void;
  onClose: () => void;
}

export function TrashDialog(props: TrashDialogProps): React.JSX.Element {
  return (
    <Dialog title="ゴミ箱" onClose={props.onClose}>
      {props.entries.length === 0 ? (
        <p style={{ color: tokens.subtext }}>ゴミ箱は空です。</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {props.entries.map((entry) => (
            <li key={entry.songId} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
              <span style={{ flex: 1 }}>{entry.title}</span>
              <span style={{ color: tokens.subtext, fontSize: '0.8rem' }}>残り {entry.remainingDays} 日</span>
              <button type="button" onClick={() => props.onRestore(entry.songId)}>
                復元
              </button>
              <button type="button" onClick={() => props.onPermanentlyDelete(entry.songId)}>
                完全に削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ===== #12 ライセンス／クレジットダイアログ =====

export interface LicenseDialogProps {
  onClose: () => void;
  /** 同梱物のライセンス表記（14_visual_design_system.md §7.2）。 */
  entries?: { name: string; license: string }[];
}

const DEFAULT_LICENSE_ENTRIES: { name: string; license: string }[] = [
  { name: '@coderline/alphatab', license: 'MPL-2.0' },
  { name: 'Bravura Music Font', license: 'SIL OFL 1.1' },
  { name: '同梱 SoundFont', license: '同梱ライセンス参照' },
];

export function LicenseDialog(props: LicenseDialogProps): React.JSX.Element {
  const entries = props.entries ?? DEFAULT_LICENSE_ENTRIES;
  return (
    <Dialog title="ライセンス / クレジット" onClose={props.onClose}>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
        {entries.map((entry) => (
          <li key={entry.name}>
            <strong>{entry.name}</strong> — {entry.license}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
