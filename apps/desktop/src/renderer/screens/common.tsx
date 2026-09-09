/**
 * 画面群の共通プリミティブ（screens-navigation.md §4.8、14_visual_design_system.md）。
 *
 * これらは L5（Electron レンダラー）側の薄い JSX ホスト。画面の「見た目に依存しないロジック」は
 * `@riff-line/core/ui`（`packages/core/src/ui`）の ViewModel / Binder / Service が持ち、ここはそれを描画に
 * 結ぶだけ（ui.rule.md、レイヤー依存規則）。ビジュアルトークンの厳密値は 14_visual_design_system.md が権威で、
 * ここでは意味の分かる最小の inline style に留める（契約上の値は固定しすぎない）。
 */

import type { CSSProperties, ReactNode } from 'react';

/** 配色・余白の最小トークン（14_visual_design_system.md のサブセット。厳密値は将来トークン化）。 */
export const tokens = {
  bg: '#ffffff',
  panelBg: '#f6f6f7',
  border: '#dddddd',
  text: '#1d1d1f',
  subtext: '#6b6b70',
  accent: '#3b6fd6',
  danger: '#d64545',
  monoFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  baseFont: 'system-ui, sans-serif',
  gap: 8,
} as const;

/** モーダルダイアログの外枠（設定・タグ管理・ゴミ箱・ライセンス。曲一覧ウィンドウの子として開く）。 */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-label={props.title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: tokens.baseFont,
        color: tokens.text,
      }}
    >
      <div
        style={{
          background: tokens.bg,
          borderRadius: 8,
          minWidth: 420,
          maxWidth: 680,
          maxHeight: '82vh',
          overflow: 'auto',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          <h2 style={{ fontSize: '1rem', margin: 0 }}>{props.title}</h2>
          <button type="button" onClick={props.onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div style={{ padding: 16 }}>{props.children}</div>
        {props.footer !== undefined ? (
          <footer style={{ padding: '12px 16px', borderTop: `1px solid ${tokens.border}`, textAlign: 'right' }}>
            {props.footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** 編集ウィンドウ内の非モーダルパネル（ミキサー / パート管理 / チューニング / フレットボード / メモ一覧）。 */
export function Panel(props: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  style?: CSSProperties;
}): React.JSX.Element {
  return (
    <section
      aria-label={props.title}
      style={{
        background: tokens.panelBg,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        fontFamily: tokens.baseFont,
        color: tokens.text,
        ...props.style,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <strong style={{ fontSize: '0.85rem' }}>{props.title}</strong>
        {props.onClose !== undefined ? (
          <button type="button" onClick={props.onClose} aria-label={`${props.title}を閉じる`}>
            ×
          </button>
        ) : null}
      </header>
      <div style={{ padding: 10 }}>{props.children}</div>
    </section>
  );
}

/** ラベル付きフォーム行。 */
export function Field(props: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: tokens.gap,
        padding: '4px 0',
      }}
    >
      <span style={{ color: tokens.subtext, fontSize: '0.85rem' }}>{props.label}</span>
      {props.children}
    </label>
  );
}

/** Phase 2 未実装ボタン（B19：無効化＋ツールチップ「Phase 2で対応予定」）。 */
export function Phase2Button(props: { label: string }): React.JSX.Element {
  return (
    <button type="button" disabled title="Phase 2で対応予定" aria-disabled="true">
      {props.label}
    </button>
  );
}
