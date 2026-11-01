// UT-EB: ErrorBoundary（画面の部品の描画の例外を受け止め、SYS-004 を記録して代わりの画面を出す）
// 検証節: error-logging-foundation.md 2.5 節（report と reloadWindow は props にスパイを渡して確かめる、2026-10-29 決定 L3）
// 番号は 03 から：作り直す前の apps/desktop/src/renderer/ErrorBoundary.test.tsx が 01・02 を使っていたので、欠番のまま残す
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary, type ErrorBoundaryProps } from './ErrorBoundary';

let container: HTMLDivElement;
let root: Root;

function Boom(): React.JSX.Element {
  throw new Error('render exploded');
}

function BoomInEffect(): React.JSX.Element {
  useEffect(() => {
    throw new Error('effect exploded');
  }, []);
  return <p>effect</p>;
}

function BoomWithString(): React.JSX.Element {
  // 投げる値が Error でないとき（2.2 節の stack の取り方のため、context.error は Error にそろえる）
  throw 'not an error';
}

function Ok(): React.JSX.Element {
  return <p data-testid="ok">ok</p>;
}

/** props に渡すスパイ（report と、読み込み直しの IPC を呼ぶ関数の代わり）。 */
function spies() {
  return { report: vi.fn<ErrorBoundaryProps['report']>(), reloadWindow: vi.fn<ErrorBoundaryProps['reloadWindow']>() };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // React は受け止めた例外もコンソールに出す（開発用のビルド）。テストの出力を汚さないよう黙らせる
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary（error-logging-foundation.md 2.5 節）', () => {
  it('ErrorBoundary_子が投げない_子をそのまま描きreportを呼ばない', () => {
    // UT-EB-03 2.5 節「子が投げなければ子をそのまま描き、report() を呼ばないこと」
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="song-list" report={report} reloadWindow={reloadWindow}>
          <Ok />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeNull();
    expect(report).not.toHaveBeenCalled();
    expect(reloadWindow).not.toHaveBeenCalled();
  });

  it('ErrorBoundary_子が描くときに投げる_代わりの画面を出しSYS-004を1回だけ記録する', () => {
    // UT-EB-04 2.5 節「子の部品が描くときに投げたら代わりの画面を出し、report() が SYS-004 で 1 回だけ呼ばれること」
    // context は { windowKind, error }。代わりの画面は見出し・説明・「画面を開き直す」ボタンの 3 つ（2026-10-14 本人決定の文言）
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <Boom />
        </ErrorBoundary>,
      );
    });

    const fallback = container.querySelector('[data-testid="error-boundary-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector('h1')?.textContent).toBe('画面の表示中に問題が起きました');
    expect(fallback?.querySelector('p')?.textContent).toBe(
      'この画面を表示している途中で問題が起きました。原因はログに記録しました。「画面を開き直す」を押すと、最後に自動保存した内容でこの画面を開き直します。',
    );
    const buttons = fallback?.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]?.textContent).toBe('画面を開き直す');

    expect(report).toHaveBeenCalledTimes(1);
    const [code, context] = report.mock.calls[0]!;
    expect(code).toBe('SYS-004');
    expect(context).toEqual({ windowKind: 'edit', error: expect.any(Error) });
    expect((context!['error'] as Error).message).toBe('render exploded');
    expect(reloadWindow).not.toHaveBeenCalled();
  });

  it('ErrorBoundary_子のuseEffectの中で投げる_受け止めてSYS-004をwindowKind付きで記録する', () => {
    // UT-EB-05 2.5 節「部品のライフサイクル（useEffect を含む）の中で投げた例外」も受け止める
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="song-list" report={report} reloadWindow={reloadWindow}>
          <BoomInEffect />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).not.toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('SYS-004', { windowKind: 'song-list', error: expect.any(Error) });
  });

  it('ErrorBoundary_画面を開き直すを押す_reloadWindowを1回呼びreportは増えない', () => {
    // UT-EB-06 2.5 節「代わりの画面の『画面を開き直す』を押すと、読み込み直しの IPC が 1 回呼ばれること」
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <Boom />
        </ErrorBoundary>,
      );
    });

    const button = container.querySelector('button');
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(reloadWindow).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('ErrorBoundary_Errorでない値を投げる_context.errorをErrorに包む', () => {
    // UT-EB-07 2.5 節「context に windowKind と、例外の error」。stack を 2.2 節の決まりで取れるよう Error にそろえる
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <BoomWithString />
        </ErrorBoundary>,
      );
    });

    expect(report).toHaveBeenCalledTimes(1);
    const context = report.mock.calls[0]![1]!;
    expect(context['error']).toBeInstanceOf(Error);
    expect((context['error'] as Error).message).toBe('not an error');
  });

  it('ErrorBoundary_クリックのハンドラの中で投げる_受け止めず子を描いたままにする', () => {
    // UT-EB-08 2.5 節「クリックのハンドラの中の例外と、Promise の reject は受け止めない」（拾うのは 2.6 節の SYS-005）
    const { report, reloadWindow } = spies();
    // クリックのハンドラの中の例外は window の error に上がる（2.6 節の SYS-005 の側で拾う）。ここではテストの失敗にしないよう受ける
    const windowErrors: unknown[] = [];
    const swallow = (event: ErrorEvent): void => {
      windowErrors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', swallow);
    function ThrowOnClick(): React.JSX.Element {
      return (
        <button
          type="button"
          data-testid="throw"
          onClick={() => {
            throw new Error('click exploded');
          }}
        >
          x
        </button>
      );
    }
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <ThrowOnClick />
        </ErrorBoundary>,
      );
    });

    act(() => {
      container.querySelector('[data-testid="throw"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    window.removeEventListener('error', swallow);

    expect(container.querySelector('[data-testid="throw"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeNull();
    expect(report).not.toHaveBeenCalled();
    expect(windowErrors).toHaveLength(1);
    expect((windowErrors[0] as Error).message).toBe('click exploded');
  });

  it('ErrorBoundary_受け止めた例外_windowのerrorに上がらない', () => {
    // UT-EB-10 2.6 節の (b)「ErrorBoundary が受け止めた例外は window の error に上がらないので、SYS-004 と SYS-005 が
    // 同じ例外で 2 回記録されることは無い見込み（実装の段に単体テストで 1 回だけになることを確かめる）」。
    // SYS-005 は window の error から出す（errorLoggingBootstrap、UT-ERR-BOOT-14）ので、ここに上がらなければ 2 回にならない
    const { report, reloadWindow } = spies();
    const windowErrors: unknown[] = [];
    const onWindowError = (event: ErrorEvent): void => {
      windowErrors.push(event.error);
    };
    window.addEventListener('error', onWindowError);
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    window.removeEventListener('error', onWindowError);

    expect(report).toHaveBeenCalledTimes(1);
    expect(windowErrors).toEqual([]);
  });

  it('ErrorBoundary_代わりの画面_style属性を持たずトークンのクラスで色を付ける', () => {
    // UT-EB-09 2.5 節の (b)「色は直値を使わず、基本設計 14 章 3 節のトークンを CSS 変数で使う」
    const { report, reloadWindow } = spies();
    act(() => {
      root.render(
        <ErrorBoundary windowKind="edit" report={report} reloadWindow={reloadWindow}>
          <Boom />
        </ErrorBoundary>,
      );
    });

    const fallback = container.querySelector('[data-testid="error-boundary-fallback"]')!;
    const elements = [fallback, ...fallback.querySelectorAll('*')];
    for (const element of elements) {
      expect(element.hasAttribute('style')).toBe(false);
      // 任意値のクラス（[#d64545] のような直値）を使わない
      expect(element.getAttribute('class') ?? '').not.toMatch(/\[|#/);
    }
    expect(fallback.getAttribute('class')).toContain('text-text-primary');
    expect(fallback.querySelector('button')?.getAttribute('class')).toContain('bg-accent');
  });
});
