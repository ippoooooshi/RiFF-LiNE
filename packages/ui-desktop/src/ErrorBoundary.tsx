/**
 * 画面の部品の描画の例外を受け止める `ErrorBoundary`（error-logging-foundation.md 2.5 節、基本設計 13 章 B36、UT-EB-*）。
 *
 * 曲一覧ウィンドウと編集ウィンドウの画面の根を 1 つずつ包む。受け止めるのは、包んだ部品が描くとき（render）と
 * ライフサイクル（useEffect を含む）の中で投げた例外だけ（React のエラーバウンダリが受け止める範囲そのもの）。
 * クリックのハンドラの中の例外と Promise の reject は受け止めない（呼んだサービスが report する。拾い残しは 2.6 節の SYS-005）。
 * レンダラーのプロセスそのものが落ちたときは CrashRecoveryController（2.3 節）が受け持ち、ここは関わらない。
 *
 * 受け止めたら props の `report` で `SYS-004`（Error、画面に出さない）を 1 回記録し、包んだ画面の代わりに
 * 見出し・説明・「画面を開き直す」ボタンの 3 つの代わりの画面を出す。代わりの画面はステータスバーのトーストに頼らない。
 * ボタンは props の `reloadWindow` を呼ぶだけ（`window:reloadAfterRenderError` の IPC を呼ぶ関数は窓の組み立てが渡す、決定 L3）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 代わりの画面の文言（error-logging-foundation.md 2.5 節、基本設計 08 章 1 節、2026-10-14 本人決定）。
 * 画面の文言を書いてよい所を 2 か所に限る決まり（screens-navigation.md 1 節）に合わせ、メニューの項目の名前と同じく
 * packages/ui-desktop に文字のデータとして置く。
 */
// <!-- req errorloggingfoundation:0bc36792.e775 -->
export const RENDER_ERROR_FALLBACK_TEXT = {
  /** 見出し。 */
  // <!-- req errorloggingfoundation:3d5277f8.45e4 -->
  heading: '画面の表示中に問題が起きました',
  /** 短い説明。最後に自動保存した内容に戻ることもここで伝える（2.5 節の (b)）。 */
  // <!-- req errorloggingfoundation:3d5277f8.3274 -->
  // <!-- req errorloggingfoundation:3d5277f8.1503 -->
  // <!-- req errorloggingfoundation:3d5277f8.9f9f -->
  // <!-- req errorloggingfoundation:2aeda6ea.08d0 -->
  description:
    'この画面を表示している途中で問題が起きました。原因はログに記録しました。「画面を開き直す」を押すと、最後に自動保存した内容でこの画面を開き直します。',
  /** ボタン。 */
  // <!-- req errorloggingfoundation:3d5277f8.1997 -->
  reloadButton: '画面を開き直す',
} as const;

// <!-- req errorloggingfoundation:65a105b7.77f1 -->
export interface ErrorBoundaryProps {
  // <!-- req errorloggingfoundation:c25fd862.e7c8 -->
  children: ReactNode;
  /** どのウィンドウで落ちたかの手がかり。ログの context に入れる（'song-list' | 'edit'）。 */
  // <!-- req errorloggingfoundation:3e26db9e.1225 -->
  windowKind: 'song-list' | 'edit';
  /** 記録の口。窓の組み立て（mountWindow）が RendererDeps.notifications の report を渡す（2026-10-29 決定 L3）。 */
  // <!-- req errorloggingfoundation:3e26db9e.b915 -->
  report: (code: string, context?: Record<string, unknown>) => void;
  /** 「画面を開き直す」の口。窓の組み立てが window:reloadAfterRenderError の IPC を呼ぶ関数を渡す（L3）。 */
  // <!-- req errorloggingfoundation:3e26db9e.90db -->
  reloadWindow: () => void;
}

/** 投げられた値を Error にそろえる（Error でなければ new Error(String(value)) に包む）。 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** ウィンドウごとに 1 つ。React のクラスのコンポーネント（エラーバウンダリ）。 */
// <!-- req errorloggingfoundation:aff55c24.11f3 -->
// <!-- req errorloggingfoundation:f693a5b2.9d16 -->
// <!-- req errorloggingfoundation:71ee025b.8c32 -->
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  // <!-- req errorloggingfoundation:81b9d5e4.da7b -->
  // <!-- req errorloggingfoundation:71ee025b.a3fb -->
  // <!-- req errorloggingfoundation:71ee025b.238b -->
  // <!-- req errorloggingfoundation:71ee025b.feb4 -->
  // <!-- req errorloggingfoundation:71ee025b.659c -->
  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: toError(error) };
  }

  /** SYS-004 を 1 回記録する。context は { windowKind, error }（stack は 2.2 節の決まりで context.error から取られる）。 */
  // <!-- req errorloggingfoundation:868a0cc3.4d17 -->
  // <!-- req errorloggingfoundation:dd41b4a4.06d9 -->
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // <!-- req errorloggingfoundation:f0d32104.44bc -->
    // <!-- req errorloggingfoundation:f0d32104.dae7 -->
    // <!-- req errorloggingfoundation:f0d32104.28bc -->
    // <!-- req errorloggingfoundation:f0d32104.866c -->
    // <!-- req errorloggingfoundation:f0d32104.cc80 -->
    // <!-- req errorloggingfoundation:215df0c4.f3f9 -->
    // <!-- req errorloggingfoundation:215df0c4.b2dd -->
    // <!-- req errorloggingfoundation:215df0c4.2c3d -->
    // <!-- req 00:704acb67.a66d -->
    // <!-- req 00:704acb67.3951 -->
    // <!-- req 00:704acb67.b68a -->
    // <!-- req errorloggingfoundation:37e0d1bb.868b -->
    this.props.report('SYS-004', { windowKind: this.props.windowKind, error: toError(error) });
  }

  // <!-- req errorloggingfoundation:c9e241d4.2526 -->
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    // 色・文字・余白は基本設計 14 章 3〜6 節のトークン（theme.css の CSS 変数）から作られたクラスだけで書く（08 章 4 節）。
    // <!-- req errorloggingfoundation:f0d32104.71d9 -->
    // <!-- req errorloggingfoundation:f0d32104.4df7 -->
    // <!-- req errorloggingfoundation:f0d32104.56d4 -->
    // <!-- req errorloggingfoundation:0bc36792.e6f1 -->
    // <!-- req errorloggingfoundation:0bc36792.2c78 -->
    return (
      <main
        role="alert"
        data-testid="error-boundary-fallback"
        className="flex min-h-screen flex-col items-start gap-3 bg-bg p-6 font-ui text-text-primary"
      >
        {/* <!-- req errorloggingfoundation:3d5277f8.9d0a --> */}
        <h1 className="text-heading font-heading">{RENDER_ERROR_FALLBACK_TEXT.heading}</h1>
        {/* <!-- req errorloggingfoundation:3d5277f8.cd0d --> */}
        <p className="text-body font-body text-text-secondary">{RENDER_ERROR_FALLBACK_TEXT.description}</p>
        {/* <!-- req errorloggingfoundation:3d5277f8.4558 --> */}
        {/* <!-- req errorloggingfoundation:6947599d.000e --> */}
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-label font-label text-surface hover:bg-accent-hover"
          onClick={() => this.props.reloadWindow()}
        >
          {RENDER_ERROR_FALLBACK_TEXT.reloadButton}
        </button>
      </main>
    );
  }
}
