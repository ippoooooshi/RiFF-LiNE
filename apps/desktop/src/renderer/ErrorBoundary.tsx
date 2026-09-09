/**
 * レンダラーの軽量エラーバウンダリ（screens-navigation.md §4.8、独立レビュー B-3/B-4）。
 *
 * `EditWindow` / `SongListWindow` の描画時（render / effect）に投げられた例外でウィンドウが白飛びするのを防ぐ。
 * 設計変更ではなく bootstrap の頑健化 — 捕捉した例外は `notificationCenter.report('RENDER-001')` で記録し、
 * 画面には原因メッセージを出す（白画面にしない）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { notificationCenter } from '@riff-line/core/errors';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** バウンダリ識別用ラベル（どのウィンドウで落ちたかの手掛かり）。 */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error);
    // console はデバッグ用。ユーザー向けの記録は NotificationCenter → ログ基盤へ。
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info.componentStack);
    notificationCenter.report('RENDER-001', { detail: message });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <main
        role="alert"
        style={{ fontFamily: 'system-ui, sans-serif', padding: 16, color: '#d64545' }}
        data-testid="error-boundary-fallback"
      >
        <h1 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
          画面の初期化中にエラーが発生しました{this.props.label ? `（${this.props.label}）` : ''}
        </h1>
        <p style={{ color: '#6b6b70', margin: 0, whiteSpace: 'pre-wrap' }}>{error.message}</p>
      </main>
    );
  }
}
