// UT-DEV-ENTRY: web-core-foundation.md 14.7 節 — Electron の入口（main.ts）から出した判断の関数（apps/desktop/src/main/entryDecisions.ts）
// 検証節: web-core-foundation.md 14.7 節・6.1 節・6.2 節 <!-- req webcorefoundation:c27f130d.9f04 --> <!-- req webcorefoundation:c27f130d.e9a7 --> <!-- req webcorefoundation:f3e5f349.3aeb --> <!-- req webcorefoundation:f3e5f349.2bd0 --> <!-- req webcorefoundation:8f5284e2.8d95 -->
// 検証観点: 単一インスタンスロック・2 つめの起動で前面に出すウィンドウ・activate で開くか・flush の宛先・
// 今のページと違う URL へのナビゲーションを止めるか・レンダラーの読み込み先・入口に分かれ道が残っていないこと（C0/C1）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  focusFirstWindow,
  loadRenderer,
  openIfNoWindows,
  preventForeignNavigation,
  runWithSingleInstanceLock,
  stripHash,
  windowForSong,
} from '../main/entryDecisions';

/** apps/desktop の場所。 */
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 偽物のウィンドウ（最小化されているかを渡す）。 */
function fakeWindow(minimized: boolean) {
  const calls: string[] = [];
  return {
    calls,
    isMinimized: () => minimized,
    restore: () => void calls.push('restore'),
    focus: () => void calls.push('focus'),
  };
}

describe('entryDecisions：単一インスタンスと前面に出すウィンドウ', () => {
  it('runWithSingleInstanceLock_ロックが取れたとき_起動の手順を走らせて終了しない', () => {
    // UT-DEV-ENTRY-01 6.1 節「main プロセスは 1 つ」
    const app = { requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn() };
    const start = vi.fn();
    runWithSingleInstanceLock(app, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('runWithSingleInstanceLock_ロックが取れないとき_終了して起動の手順を走らせない', () => {
    // UT-DEV-ENTRY-02 6.1 節「main プロセスは 1 つ」。取れなければ二重起動なので終了する
    const app = { requestSingleInstanceLock: vi.fn(() => false), quit: vi.fn() };
    const start = vi.fn();
    runWithSingleInstanceLock(app, start);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('focusFirstWindow_最小化された1枚目_元に戻してから前面に出す', () => {
    // UT-DEV-ENTRY-03 2 つめの起動が来たら 1 枚目のウィンドウを前面に出す。2 枚目には触らない
    const first = fakeWindow(true);
    const second = fakeWindow(true);
    focusFirstWindow([first, second]);
    expect(first.calls).toEqual(['restore', 'focus']);
    expect(second.calls).toEqual([]);
  });

  it('focusFirstWindow_最小化されていない_元に戻さず前面に出す', () => {
    // UT-DEV-ENTRY-04
    const first = fakeWindow(false);
    focusFirstWindow([first]);
    expect(first.calls).toEqual(['focus']);
  });

  it('focusFirstWindow_ウィンドウが無い_何もしない', () => {
    // UT-DEV-ENTRY-05
    expect(() => focusFirstWindow([])).not.toThrow();
  });

  it('openIfNoWindows_1枚も無いときだけ開く', () => {
    // UT-DEV-ENTRY-06 screens-navigation.md 4.1 節。activate で、ウィンドウが無ければ曲一覧ウィンドウを開く
    const open = vi.fn();
    openIfNoWindows([], open);
    expect(open).toHaveBeenCalledTimes(1);
    openIfNoWindows([fakeWindow(false)], open);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('windowForSong_開いている曲はそのウィンドウ_開いていない曲はnull', () => {
    // UT-DEV-ENTRY-07 screens-navigation.md 4.4 節。flush の要求の宛先
    const window = fakeWindow(false);
    const windowsBySong = new Map([['song-1', window]]);
    expect(windowForSong(windowsBySong, 'song-1')).toBe(window);
    expect(windowForSong(windowsBySong, 'song-2')).toBeNull();
  });
});

describe('entryDecisions：ナビゲーションとレンダラーの読み込み', () => {
  it('stripHash_シャープから後を除く', () => {
    // UT-DEV-ENTRY-08 6.2 節「# から後を除いて比べ」
    expect(stripHash('http://localhost:5173/#edit/1')).toBe('http://localhost:5173/');
    expect(stripHash('file:///app/index.html#songlist#x')).toBe('file:///app/index.html');
    expect(stripHash('file:///app/index.html')).toBe('file:///app/index.html');
    expect(stripHash('#songlist')).toBe('');
  });

  it('preventForeignNavigation_今のページと違うURL_止める', () => {
    // UT-DEV-ENTRY-09 6.2 節「今のページと違う URL へは移らせない」
    const event = { preventDefault: vi.fn() };
    preventForeignNavigation(event, 'https://example.com/', 'file:///app/index.html#songlist');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('preventForeignNavigation_ハッシュだけの変化とリロード_止めない', () => {
    // UT-DEV-ENTRY-10 6.2 節。ルートの遷移（ハッシュだけの変化）とリロードは許す
    const event = { preventDefault: vi.fn() };
    preventForeignNavigation(event, 'file:///app/index.html#edit/1', 'file:///app/index.html#songlist');
    preventForeignNavigation(event, 'file:///app/index.html', 'file:///app/index.html');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('loadRenderer_開発のURLがある_そのURLにルートをハッシュで付けて読む', () => {
    // UT-DEV-ENTRY-11 dev では electron-vite が Vite のサーバーの URL を渡す
    const window = { loadURL: vi.fn(() => Promise.resolve()), loadFile: vi.fn(() => Promise.resolve()) };
    loadRenderer(window, 'http://localhost:5173', 'edit/1', 'index.html');
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173#edit/1');
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  it('loadRenderer_URLが無いか空_ビルド済みのHTMLをハッシュ付きで読む', () => {
    // UT-DEV-ENTRY-12 配布したアプリではビルド済みの HTML を読む
    const window = { loadURL: vi.fn(() => Promise.resolve()), loadFile: vi.fn(() => Promise.resolve()) };
    loadRenderer(window, undefined, 'songlist', 'index.html');
    loadRenderer(window, '', 'songlist', 'index.html');
    expect(window.loadFile).toHaveBeenCalledTimes(2);
    expect(window.loadFile).toHaveBeenCalledWith('index.html', { hash: 'songlist' });
    expect(window.loadURL).not.toHaveBeenCalled();
  });
});

describe('入口：分かれ道を置かない', () => {
  it('main.ts・preload.ts・main.tsx・copy-alphatab-assets.mjs_分かれ道が無い', () => {
    // UT-DEV-ENTRY-13 14.7 節「入口には分かれ道を置かず、判断は別のファイルの関数に出して単体テストで通す」。
    // 注（// と /* */）を除いたコードに、if・else・?:・&&・||・??・?.・try・catch・switch が無いことを確かめる
    const entries = [
      join('src', 'main', 'main.ts'),
      join('src', 'preload', 'preload.ts'),
      join('src', 'renderer', 'main.tsx'),
      join('scripts', 'copy-alphatab-assets.mjs'),
    ];
    for (const entry of entries) {
      const code = readFileSync(join(desktopDir, entry), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect({
        entry,
        branches: code.match(/\b(?:if|else|switch|try|catch)\b|&&|\|\||\?\?|\?\.|\?\s*[^:\s]/g),
      }).toEqual({
        entry,
        branches: null,
      });
    }
  });
});
