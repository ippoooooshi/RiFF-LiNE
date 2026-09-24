# 詳細設計書：Webコア基盤構築

- **対応作業パッケージ**：[[../basic_design/15_development_process.md#4.1]] の実施順 1「Webコア基盤構築」
- **ブランチ名**：`feature/web-core-foundation`
- **作り直し**：本書は基本設計を正として、基本設計の章ごとに作り直す（2026-09-24 開始）。基本設計のどの節が本書のどこに降りるかは、[[00_reference.md#1]] の受け先表にある
- **作り直す前の本書**：git の履歴（`2759936` 時点）にある。決定・教訓の拾い上げは `ledger.mjs harvest` の記録で追う

---

## 下書き（08 の試走で直した文。章ごとに確かめ直す）

以下は作り直す前の本書の節を写したもの。見出しの番号は作り直す前のまま。

#### 3.5.1 スタイリングとテーマトークン

**2026-09-24 追加（本人決定。[[../basic_design/01_architecture.md#AD-4：実装言語・UI技術スタック]]・[[../basic_design/08_error_logging.md#4]]・[[../basic_design/14_visual_design_system.md]]）**：renderer の見た目は **Tailwind CSS v4 系**で書き、[[../basic_design/14_visual_design_system.md]]のトークンを CSS の `@theme` に定義する。**色・文字・余白・角丸・影のトークンを定義する場所は、この節で決める CSS ファイル 1 つだけ**にする（ほかの書・ほかのファイルは値を持たず参照するだけ）。

| 項目 | 決まり |
|---|---|
| 定義を置くファイル | `apps/desktop/src/renderer/theme.css` の 1 つ。先頭に `@import "tailwindcss";`、続けて `@theme static { … }` にトークンを並べる（下の CSS） |
| `static` を付ける理由 | Tailwind v4 は既定では使われたテーマ変数だけを CSS 変数として出す（公式文書 Theme variables：「By default only used CSS variables will be generated in the final CSS output.」）。`packages/core` の `ScoreRenderHost` の赤枠や SVG の着色は Tailwind のクラスを使わず `var(--color-danger)` で参照するので、使われていなくても全トークンを CSS 変数として出す `static` にする |
| 既定のテーマを外す | `@theme static` の最初に `--*: initial;` を書き、Tailwind の既定のテーマ変数（名前空間を問わず、既定で入っているもの全部。例：`red-500`）をすべて外す。**画面が使えるのは 14 章のトークンから作られたクラスだけ**になる |
| 読み込み方 | renderer の入口 `apps/desktop/src/renderer/main.tsx` で `import './theme.css';` を 1 回だけ行う。Vite へは `@tailwindcss/vite` のプラグインを `apps/desktop/electron.vite.config.ts` の `renderer.plugins` に足して入れる（公式の Vite での導入手順：`import tailwindcss from '@tailwindcss/vite'` と `plugins: [tailwindcss()]`） |
| 直値を書かない | 画面のコンポーネントは、色・文字・余白・角丸・影を Tailwind のクラス（`bg-surface`・`text-danger`・`p-3`・`rounded-md` の形）か `var(--…)` で書く。色・長さの直値（例：`#c62a3f`）、角括弧で値を書く任意値のクラス（例：`[#c62a3f]`・`[13px]`）、`style` 属性の直値のどれも書かない（`ScoreRenderHost` の `el.style.border` も `var(--color-danger)` にする） |
| ダークの値 | 14 章 3 節の表のダーク値（先行定義）は v1 では `@theme` に入れない（14 章 3 節「v1で使用するのはライト値のみ」）。入れるときは同じファイルに上書きの規則を足す |
| パート識別色 | `Part.color`（データとしてのパートの色、14 章 3.2 節）は `--color-*` のトークン体系に入れない。曲データの値なので、描画のときに渡す |

**色は 14 章 3 節の表の全トークン（19 個）**を、表の名前に `--color-` を付けて、ライトの値のまま並べる（[[../basic_design/08_error_logging.md#4]]の「`--color-` ＋表の名前」）。色以外（14 章 4〜6 節）は、Tailwind の名前空間（公式文書の表：`--font-*`・`--text-*`・`--font-weight-*`・`--spacing-*`・`--radius-*`・`--shadow-*`）に合わせて下の対応表の名前にする。

```css
@import "tailwindcss";

@theme static {
  --*: initial;

  /* 色：14 章 3.1 節 ニュートラル */
  --color-bg: #f6f6f7;
  --color-surface: #ffffff;
  --color-surface-2: #f0f0f2;
  --color-surface-3: #e9e9ec;
  --color-border: #e2e2e6;
  --color-border-strong: #d3d3d9;
  --color-text-primary: #1a1a1e;
  --color-text-secondary: #68686f;
  --color-text-tertiary: #a0a0a8;
  /* 色：14 章 3.2 節 アクセント */
  --color-accent: #5850ec;
  --color-accent-hover: #473fd6;
  --color-accent-soft: #eeecfd;
  /* 色：14 章 3.3 節 ステータス */
  --color-success: #157f45;
  --color-success-soft: #e5f5ec;
  --color-warning: #b5690a;
  --color-warning-soft: #fdf1e2;
  --color-danger: #c62a3f;
  --color-danger-soft: #fbe9ec;
  --color-info-tag: #0b6e8f;

  /* 文字：14 章 4 節 */
  --font-ui: "Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --text-heading: 1rem;
  --text-body: 0.8125rem;
  --text-label: 0.75rem;
  --text-caption: 0.6875rem;
  --font-weight-heading: 650;
  --font-weight-body: 400;
  --font-weight-label: 600;
  --font-weight-caption: 500;

  /* 余白：14 章 5 節（4px グリッド） */
  --spacing: 4px;

  /* 角丸：14 章 6 節 */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* 影：14 章 6 節に値が無いので、値を足すまで置かない（名前は --shadow-float） */
}
```

**14 章の名前と `@theme` の名前の対応**（名前がそのまま名前空間に合わないもの）：

| 14 章 | 14 章の値 | `@theme` の名前と値 | 作られるクラスの例 |
|---|---|---|---|
| 4 節 フォントスタック「UI基本」 | `"Segoe UI", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif` | `--font-ui`（同じ値） | `font-ui` |
| 4 節 フォントスタック「数値・技術情報用（等幅）」 | `"Cascadia Mono", "Consolas", ui-monospace, monospace` | `--font-mono`（同じ値） | `font-mono` |
| 4 節 ダイアログ見出し | 15〜16px相当・650 | `--text-heading: 1rem`（16px）／`--font-weight-heading: 650` | `text-heading`・`font-heading` |
| 4 節 本文・標準UI文字 | 13〜13.5px相当・400〜450 | `--text-body: 0.8125rem`（13px）／`--font-weight-body: 400` | `text-body`・`font-body` |
| 4 節 ラベル・見出し小 | 11.5〜12px相当・600 | `--text-label: 0.75rem`（12px）／`--font-weight-label: 600` | `text-label`・`font-label` |
| 4 節 補助文字・タイムスタンプ | 11px相当・500 | `--text-caption: 0.6875rem`（11px）／`--font-weight-caption: 500` | `text-caption`・`font-caption` |
| 5 節 space-1〜space-5 | 4／8／12／16／20〜24px | `--spacing: 4px` の 1 つだけ。Tailwind の数値の余白クラスは `--spacing` の倍数になる（公式文書：既定は `--spacing: 0.25rem;`）。space-1＝`*-1`（4px）、space-2＝`*-2`（8px）、space-3＝`*-3`（12px）、space-4＝`*-4`（16px）、space-5＝`*-5`（20px）か `*-6`（24px） | `p-3`・`gap-4` |
| 6 節 radius-sm／radius-md／radius-lg | 4／6／8px | `--radius-sm`／`--radius-md`／`--radius-lg`（名前も値もそのまま） | `rounded-sm`・`rounded-md`・`rounded-lg` |
| 6 節 影（浮いている要素だけに使う） | **14 章 6 節に値が無い**（使う要素の決まりだけ） | 名前だけ `--shadow-float` と決める。値は 14 章 6 節に足してから並べる | `shadow-float` |

- 文字の大きさは 14 章 4 節の「相対単位で定義する」に従って `rem` で書く。14 章が幅で示している値（見出し 15〜16px、本文 13〜13.5px、ラベル 11.5〜12px、本文のウェイト 400〜450）のどこを取るかは本書で決めた（見出し 16px・本文 13px・ラベル 12px・補助 11px、本文のウェイト 400）
- ツールバー・メニューバーの高さ（14 章 5 節の目安 28〜32px／44〜48px）は `@theme` のトークンにせず、`--spacing` の倍数（`h-8`＝32px・`h-12`＝48px）で書く
- 14 章の値や表を変えたときは、この節の CSS と対応表を同じ変更の中で直す
