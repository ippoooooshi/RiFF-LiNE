/**
 * エクスポート／印刷プレビューダイアログの UI シェル（screens-navigation.md §4.8 #14・#15、§3.6 B19）。
 *
 * Phase 1 は形式選択・ファイル名編集フィールド・レイアウトプレビュー領域の枠のみを実装し、
 * 「エクスポート実行」「印刷」ボタンは Phase 2 未実装であることを示す無効化状態（ツールチップ「Phase 2で対応予定」）
 * とする。実際の変換・出力処理は呼び出さない（Phase 2、export-print.md）。
 */

import { useState } from 'react';

import { Dialog, Phase2Button, tokens } from './common';

// ===== #14 エクスポートダイアログ（UIシェルのみ） =====

export interface ExportDialogProps {
  songTitle: string;
  onClose: () => void;
}

const EXPORT_FORMATS: { id: string; label: string; ext: string }[] = [
  { id: 'alphatex', label: 'alphaTex', ext: 'alphatex' },
  { id: 'midi', label: 'MIDI (SMF)', ext: 'mid' },
  { id: 'pdf', label: 'PDF', ext: 'pdf' },
];

export function ExportDialog(props: ExportDialogProps): React.JSX.Element {
  const [format, setFormat] = useState(EXPORT_FORMATS[0]!.id);
  const chosen = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0]!;
  const [fileName, setFileName] = useState(`${props.songTitle}.${chosen.ext}`);

  return (
    <Dialog
      title="エクスポート"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" onClick={props.onClose}>
            閉じる
          </button>
          {/* B19: Phase 1 では実処理を接続しない。 */}
          <Phase2Button label="エクスポート実行" />
        </>
      }
    >
      <label style={{ display: 'block', marginBottom: tokens.gap }}>
        形式
        <select
          value={format}
          onChange={(e) => {
            setFormat(e.target.value);
            const next = EXPORT_FORMATS.find((f) => f.id === e.target.value);
            if (next !== undefined) setFileName(`${props.songTitle}.${next.ext}`);
          }}
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'block' }}>
        ファイル名
        <input value={fileName} onChange={(e) => setFileName(e.target.value)} style={{ width: '100%' }} />
      </label>
      <p style={{ color: tokens.subtext, fontSize: '0.8rem' }}>変換処理は Phase 2 で対応予定です。</p>
    </Dialog>
  );
}

// ===== #15 印刷プレビューダイアログ（UIシェルのみ） =====

export interface PrintPreviewDialogProps {
  pageCount?: number;
  onClose: () => void;
}

export function PrintPreviewDialog(props: PrintPreviewDialogProps): React.JSX.Element {
  const pageCount = props.pageCount ?? 1;
  const [page, setPage] = useState(1);

  return (
    <Dialog
      title="印刷プレビュー"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" onClick={props.onClose}>
            閉じる
          </button>
          <Phase2Button label="印刷" />
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.gap, marginBottom: tokens.gap }}>
        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="前のページ">
          ‹
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} aria-label="次のページ">
          ›
        </button>
      </div>
      <div
        aria-label="レイアウトプレビュー"
        style={{ border: `1px solid ${tokens.border}`, background: tokens.panelBg, height: 260, borderRadius: 4 }}
      />
      <p style={{ color: tokens.subtext, fontSize: '0.8rem' }}>PDF 生成・印刷は Phase 2 で対応予定です。</p>
    </Dialog>
  );
}
