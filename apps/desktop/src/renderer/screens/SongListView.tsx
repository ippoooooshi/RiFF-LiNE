/**
 * 曲一覧ウィンドウ（screens-navigation.md §4.8 #1・§5.1）。
 *
 * `SongIndexService.load()` で一覧取得、`ThumbnailGenerator`（§3.3）が生成済みのサムネイルを表示、
 * グリッド/リスト切替（既定値は `AppPreferencesService`）、右クリックメニュー（開く/名前変更/タグ編集/ゴミ箱へ/複製）、
 * 曲数表示（`SONG-001` 警告閾値、§3.5）。曲を開く操作は `window.riffLineApi.windows.openSong(songId)` 経由で
 * WindowManager（main）へ渡す（重複防止は main 側、AD-2）。
 */

import { useMemo } from 'react';

import { SONG_COUNT_WARN_THRESHOLD, type SongSummary } from '@riff-line/core';
import type { SongListLayout } from '@riff-line/core/ui';

import { tokens } from './common';

export interface SongListViewProps {
  songs: SongSummary[];
  layout: SongListLayout;
  onChangeLayout: (layout: SongListLayout) => void;
  /** 曲を開く（WindowManager へ委譲）。既定は preload の windows.openSong。 */
  onOpenSong: (songId: string) => void;
  onCreateSong: () => void;
  onRenameSong: (songId: string) => void;
  onEditTags: (songId: string) => void;
  onMoveToTrash: (songId: string) => void;
  onDuplicateSong: (songId: string) => void;
  onOpenTrash: () => void;
  onOpenSettings: () => void;
}

export function SongListView(props: SongListViewProps): React.JSX.Element {
  const active = useMemo(() => props.songs.filter((s) => !s.isTrashed), [props.songs]);
  const nearLimit = active.length >= SONG_COUNT_WARN_THRESHOLD;

  return (
    <main style={{ fontFamily: tokens.baseFont, color: tokens.text, padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: tokens.gap, marginBottom: 12 }}>
        <h1 style={{ fontSize: '1.1rem', margin: 0, flex: 1 }}>曲一覧</h1>
        <span style={{ color: nearLimit ? tokens.danger : tokens.subtext, fontSize: '0.85rem' }}>
          {active.length} 曲{nearLimit ? '（上限1000に接近）' : ''}
        </span>
        <button type="button" onClick={props.onCreateSong}>
          新規曲…
        </button>
        <button type="button" onClick={() => props.onChangeLayout(props.layout === 'grid' ? 'list' : 'grid')}>
          {props.layout === 'grid' ? 'リスト表示' : 'グリッド表示'}
        </button>
        <button type="button" onClick={props.onOpenTrash}>
          ゴミ箱
        </button>
        <button type="button" onClick={props.onOpenSettings}>
          設定
        </button>
      </header>

      <ul
        data-testid="song-list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: props.layout === 'grid' ? 'grid' : 'block',
          gridTemplateColumns: props.layout === 'grid' ? 'repeat(auto-fill, minmax(180px, 1fr))' : undefined,
          gap: tokens.gap,
        }}
      >
        {active.map((song) => (
          <li
            key={song.id}
            style={{ border: `1px solid ${tokens.border}`, borderRadius: 6, padding: 10 }}
            onDoubleClick={() => props.onOpenSong(song.id)}
          >
            <div
              style={{
                height: props.layout === 'grid' ? 96 : 0,
                background: tokens.panelBg,
                borderRadius: 4,
                marginBottom: props.layout === 'grid' ? 6 : 0,
                backgroundImage: song.thumbnailRef !== null ? `url(${song.thumbnailRef})` : undefined,
                backgroundSize: 'cover',
              }}
              aria-hidden="true"
            />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: tokens.gap }}>
              <strong style={{ flex: 1, fontSize: '0.9rem' }}>{song.title}</strong>
              <button type="button" onClick={() => props.onOpenSong(song.id)}>
                開く
              </button>
            </div>
            <div style={{ color: tokens.subtext, fontSize: '0.75rem' }}>
              更新 {new Date(song.updatedAt).toLocaleString()} / {song.tags.join(', ') || 'タグなし'}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button type="button" onClick={() => props.onRenameSong(song.id)}>
                名前変更
              </button>
              <button type="button" onClick={() => props.onEditTags(song.id)}>
                タグ編集
              </button>
              <button type="button" onClick={() => props.onDuplicateSong(song.id)}>
                複製
              </button>
              <button type="button" onClick={() => props.onMoveToTrash(song.id)}>
                ゴミ箱へ
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
