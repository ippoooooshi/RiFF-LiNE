/**
 * 最小シェル画面（web-core-foundation.md §3.5）。
 *
 * 画面群パッケージ（作業パッケージ8）の前段として、packages/core をマウントし、
 * ScoreRenderHost で alphaTex サンプルを 1 つ SVG 描画できることを確認するだけの画面。
 * 曲一覧・編集画面等の実 UI は画面群パッケージで実装する。
 */

import { useEffect, useRef, useState } from 'react';

import { ScoreRenderHost } from '@tab-app/core';

// alphaTab 同梱アセットは electron.vite.config.ts の viteStaticCopy でレンダラー配下へコピーされる。
const FONT_ASSETS_BASE_PATH = 'alphatab/font/';
const SOUND_FONT_ASSETS_BASE_PATH = 'alphatab/soundfont/';

const SAMPLE_ALPHATEX = '\\title "Hello Tab App" \\tempo 120 . 3.3*4 | 0.4 2.4 3.4 5.4 | 3.3*4';

type Status = 'initializing' | 'rendering' | 'ready' | 'error';

export function App(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('initializing');
  const [rootPath, setRootPath] = useState<string>('');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const host = new ScoreRenderHost();
    host.on('renderFinished', () => setStatus('ready'));
    host.on('renderError', ({ error }) => {
      setStatus('error');
      setDetail(error instanceof Error ? error.message : String(error));
    });

    try {
      host.initialize(container, {
        engine: 'svg',
        fontAssetsBasePath: FONT_ASSETS_BASE_PATH,
        soundFontAssetsBasePath: SOUND_FONT_ASSETS_BASE_PATH,
      });

      // 起動シーケンス（§5）: preload 経由で保存先ルートを取得して表示する（fs I/O 経路の疎通確認）。
      void window.tabAppApi.fs
        .getRootPath()
        .then(setRootPath)
        .catch((error: unknown) => setDetail(String(error)));

      setStatus('rendering');
      host.loadScore(ScoreRenderHost.parseAlphaTex(SAMPLE_ALPHATEX));
      host.render();
    } catch (error) {
      setStatus('error');
      setDetail(error instanceof Error ? error.message : String(error));
    }

    return () => host.dispose();
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1rem' }}>
      <h1 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>タブ譜作成アプリ — Webコア基盤 動作確認</h1>
      <p style={{ margin: '0 0 0.25rem' }}>
        状態: <strong data-testid="status">{status}</strong>
        {detail ? ` — ${detail}` : ''}
      </p>
      <p style={{ margin: '0 0 1rem', color: '#666' }}>保存先ルート: {rootPath || '(取得中)'}</p>
      <div
        ref={containerRef}
        aria-label="score"
        style={{ border: '1px solid #ddd', minHeight: 240, overflow: 'auto' }}
      />
    </main>
  );
}
