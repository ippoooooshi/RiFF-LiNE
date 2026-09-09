// UT-EB: ErrorBoundary（独立レビュー B-3/B-4、bootstrap 頑健化）
// 検証節: screens-navigation.md §4.8（描画時例外でウィンドウが白飛びしない）
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationCenter } from '@riff-line/core/errors';

import { ErrorBoundary } from './ErrorBoundary';

let container: HTMLDivElement;
let root: Root;

function Boom(): React.JSX.Element {
  throw new Error('render exploded');
}

function Ok(): React.JSX.Element {
  return <p data-testid="ok">ok</p>;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('UT-EB-01: 子が正常なら子をそのまま描画する', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Ok />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
  });

  it('UT-EB-02: 子が描画時に throw したらフォールバックを出し RENDER-001 を発行する（白飛びしない）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reportSpy = vi.spyOn(notificationCenter, 'report');

    act(() => {
      root.render(
        <ErrorBoundary label="編集ウィンドウ">
          <Boom />
        </ErrorBoundary>,
      );
    });

    const fallback = container.querySelector('[data-testid="error-boundary-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('画面の初期化中にエラーが発生しました（編集ウィンドウ）');
    expect(container.textContent).toContain('render exploded');
    expect(reportSpy).toHaveBeenCalledWith('RENDER-001', expect.objectContaining({ detail: 'render exploded' }));
  });
});
