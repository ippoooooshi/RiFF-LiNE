/**
 * タブ譜編集ウィンドウのシェル（screens-navigation.md §4.8 #3、§4.2〜§4.4）。
 *
 * メニュー（`MenuBarController.buildTemplate()`）・ツールバー（`ToolbarViewModel`）・ステータスバー
 * （`StatusBarViewModel`）を内包し、`ScoreRenderHost` のレンダリング領域をホストする（`scoreContainerRef`）。
 * web-core-foundation.md §3.5 の最小シェルを、本パッケージで実際の編集ウィンドウ UI に置き換える。
 *
 * 状態はすべて props（ViewModel の派生結果）で受け、ここではイベントをコールバックへ流すだけ（AD-2）。
 */

import type { Ref } from 'react';

import type { MenuItemDescriptor, StatusBarState, ToolbarPanelName, ToolbarState } from '@riff-line/core/ui';

import { tokens } from './common';

export interface EditWindowShellProps {
  menuTemplate: MenuItemDescriptor[];
  toolbar: ToolbarState;
  statusBar: StatusBarState;
  /** `ScoreRenderHost.initialize()` に渡すマウント先。 */
  scoreContainerRef: Ref<HTMLDivElement>;
  onUndo: () => void;
  onRedo: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onTogglePanel: (name: ToolbarPanelName) => void;
  onInvokeMenu: (id: string) => void;
  /** 開いているパネル（`EditWindowShell` の下部に差し込む）。 */
  panels?: React.ReactNode;
}

const PANEL_LABELS: Record<ToolbarPanelName, string> = {
  mixer: 'ミキサー',
  partManagement: 'パート',
  tuning: 'チューニング',
  fretboard: 'フレットボード',
  memoList: 'メモ',
};

export function EditWindowShell(props: EditWindowShellProps): React.JSX.Element {
  const { toolbar, statusBar } = props;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: tokens.baseFont,
        color: tokens.text,
      }}
    >
      {/* メニューバー（OS ネイティブメニュー登録は main 側。ここは可視のフォールバックバー） */}
      <nav
        aria-label="メニュー"
        style={{ display: 'flex', gap: 4, padding: '2px 6px', borderBottom: `1px solid ${tokens.border}` }}
      >
        {props.menuTemplate.map((menu) => (
          <div key={menu.id ?? menu.label} style={{ position: 'relative' }}>
            <button type="button" onClick={() => menu.id !== undefined && props.onInvokeMenu(menu.id)}>
              {menu.label}
            </button>
          </div>
        ))}
      </nav>

      {/* ツールバー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <button type="button" disabled={!toolbar.canUndo} onClick={props.onUndo}>
          元に戻す
        </button>
        <button type="button" disabled={!toolbar.canRedo} onClick={props.onRedo}>
          やり直し
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: tokens.border }} />
        <button type="button" onClick={props.onPlayPause}>
          {toolbar.isPlaying ? '一時停止' : '再生'}
        </button>
        <button type="button" onClick={props.onStop}>
          停止
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: tokens.border }} />
        {(Object.keys(PANEL_LABELS) as ToolbarPanelName[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={toolbar.panels[name]}
            onClick={() => props.onTogglePanel(name)}
          >
            {PANEL_LABELS[name]}
          </button>
        ))}
      </div>

      {/* 譜面レンダリング領域＋パネル */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          ref={props.scoreContainerRef}
          aria-label="score"
          style={{ flex: 1, overflow: 'auto', position: 'relative' }}
        />
        {props.panels !== undefined ? (
          <aside
            style={{
              width: 280,
              borderLeft: `1px solid ${tokens.border}`,
              overflow: 'auto',
              padding: 6,
              display: 'grid',
              gap: 6,
            }}
          >
            {props.panels}
          </aside>
        ) : null}
      </div>

      {/* ステータスバー（等幅） */}
      <footer
        style={{
          display: 'flex',
          gap: 16,
          padding: '2px 8px',
          borderTop: `1px solid ${tokens.border}`,
          fontFamily: tokens.monoFont,
          fontSize: '0.8rem',
          color: tokens.subtext,
        }}
      >
        <span>小節 {statusBar.barNumber}</span>
        <span>{statusBar.timeSignature}</span>
        <span>♩={statusBar.tempoBpm}</span>
        <span>カポ {statusBar.capoFret}</span>
        <span>{statusBar.zoomPercent}%</span>
      </footer>
    </div>
  );
}
