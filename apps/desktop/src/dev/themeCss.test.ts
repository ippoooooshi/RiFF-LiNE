// UT-DEV-THEME: web-core-foundation.md 4.2 節 — packages/ui-desktop/theme.css を Tailwind v4 で書き出した結果
// 検証節: web-core-foundation.md 4.2 節 <!-- req webcorefoundation:c4200219.fe59 --> <!-- req webcorefoundation:c4200219.9f04 --> <!-- req webcorefoundation:7a3794eb.faea --> <!-- req webcorefoundation:7a3794eb.78f6 -->
// 検証観点: 14 章 3〜6 節のトークン 36 個がすべて CSS 変数として出ること（`@theme static`）、
// 既定のテーマのクラスが作られないこと（`--*: initial`）、トークンから作ったクラスが作られること。
// Vite のプラグインと同じ tailwindcss の compile に実物の theme.css を渡し、クラス名の候補を直接与えて書き出す
// （リポジトリにファイルは作らない。turn 176 に scratchpad の台本で確かめたことをここへ移した）。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const themePath = join(repoRoot, 'packages', 'ui-desktop', 'theme.css');
const themeCss = readFileSync(themePath, 'utf8');
const require = createRequire(import.meta.url);

type Compiler = Awaited<ReturnType<typeof compile>>;
let compiler: Compiler;

beforeAll(async () => {
  compiler = await compile(themeCss, {
    base: dirname(themePath),
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
});

/** theme.css の `@theme static { … }` に書いたトークンの名前（`--*: initial` を除く）。 */
function tokenNames(): string[] {
  const body = /@theme static \{([\s\S]*?)\n\}/.exec(themeCss)?.[1] ?? '';
  return [...body.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1] as string);
}

/** 書き出した CSS に、そのクラスの規則（`.name {`）があるか。 */
function hasClass(css: string, name: string): boolean {
  return css.includes(`.${name} {`);
}

describe('トークンが CSS 変数として出る', () => {
  it('themeCss_クラスを使わなくても_36個のトークンがすべてCSS変数に出る', () => {
    // UT-DEV-THEME-01 4.2 節「`static` を付ける理由」「トークンの範囲」
    const names = tokenNames();
    expect(names).toHaveLength(36);
    const css = compiler.build([]);
    expect(names.filter((n) => !css.includes(`${n}:`))).toEqual([]);
  });

  it('themeCss_既定のテーマの変数は_CSS変数に出ない', () => {
    // UT-DEV-THEME-02 4.2 節「既定のテーマを外す」
    const css = compiler.build([]);
    expect(
      ['--color-red-500', '--color-blue-600', '--radius-xl', '--shadow-lg'].filter((v) => css.includes(`${v}:`)),
    ).toEqual([]);
  });
});

describe('作られるクラス', () => {
  it('themeCss_既定の色と角丸と影のクラスは_作られない', () => {
    // UT-DEV-THEME-03 4.2 節「既定のテーマを外す」（`--*: initial`）
    const defaults = ['bg-red-500', 'text-blue-600', 'rounded-xl', 'shadow-lg', 'font-sans'];
    const css = compiler.build(defaults);
    expect(defaults.filter((c) => hasClass(css, c))).toEqual([]);
  });

  it('themeCss_トークンから作ったクラスは_作られる', () => {
    // UT-DEV-THEME-04 4.2 節「直値を書かない」の `bg-surface`・`text-danger`・`p-3`・`rounded-md` の形と、ツールバーの h-12
    const tokens = [
      'bg-surface',
      'text-danger',
      'p-3',
      'gap-4',
      'rounded-md',
      'shadow-float',
      'font-mono',
      'text-body',
      'h-12',
    ];
    const css = compiler.build(tokens);
    expect(tokens.filter((c) => !hasClass(css, c))).toEqual([]);
  });

  it('themeCss_余白のクラスは_4pxの格子の倍数で書き出される', () => {
    // UT-DEV-THEME-05 4.2 節（14 章 5 節の 4px グリッド）
    const css = compiler.build(['p-3']);
    expect(css).toContain('--spacing: 4px');
    expect(css).toContain('calc(var(--spacing) * 3)');
  });
});

describe('クラス名を探す場所', () => {
  it('themeCss_sourceは_ui-desktopとui-sharedのsrcを指す', () => {
    // UT-DEV-THEME-06 4.2 節「定義を置くファイル」の `@source "./src"` と `@source "../ui-shared/src"`
    const bases = compiler.sources.map((s) => resolve(s.base, s.pattern));
    expect(bases).toEqual(
      expect.arrayContaining([
        join(repoRoot, 'packages', 'ui-desktop', 'src'),
        join(repoRoot, 'packages', 'ui-shared', 'src'),
      ]),
    );
  });
});
