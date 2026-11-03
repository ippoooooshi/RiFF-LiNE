/**
 * @riff-line/ui-desktop — PC 版の画面の入れ物（web-core-foundation.md 5.1 節）。
 *
 * パネル・ダイアログ・ウィンドウの配置と開け閉めをする React のコンポーネントをここに置く。
 * Webコアの L1 に属し、参照するのは apps/desktop だけ（packages/ 側からの import は eslint.config.js で止める）。
 * トークンの CSS は package.json の exports の `./theme.css`（4.2 節）。
 *
 * 部品の中身と画面を DOM に載せる関数は、受け持つ区切り・作業パッケージで足す。このパッケージの形（依存の定義・tsconfig）は作業パッケージ 1 で作る。
 */
// <!-- req webcorefoundation:611f79ee.d674 --> <!-- req webcorefoundation:611f79ee.5319 --> <!-- req webcorefoundation:611f79ee.bd56 --> <!-- req webcorefoundation:611f79ee.456d --> <!-- req webcorefoundation:611f79ee.b07d --> <!-- req webcorefoundation:611f79ee.75a1 -->
// <!-- req webcorefoundation:4c0d3d51.360a --> <!-- req webcorefoundation:7eb6666d.ab60 --> <!-- req webcorefoundation:57e560c8.d757 -->
// <!-- req webcorefoundation:7eb6666d.7c2f --> <!-- req webcorefoundation:7eb6666d.32df -->
// <!-- req webcorefoundation:10384e3f.967d --> <!-- req webcorefoundation:10384e3f.c73c -->
// <!-- req webcorefoundation:7eda574e.f08d --> <!-- req webcorefoundation:3aec5d4c.b894 -->

// error-logging-foundation.md 2.5 節：画面の部品の描画の例外を受け止める ErrorBoundary と、その代わりの画面の文言
// <!-- req errorloggingfoundation:3cbdb0c5.bb60 -->
export { ErrorBoundary, RENDER_ERROR_FALLBACK_TEXT, type ErrorBoundaryProps } from './ErrorBoundary';
// <!-- req webcorefoundation:2c5293dc.2f12 --> <!-- req webcorefoundation:2c5293dc.1abb --> <!-- req webcorefoundation:2c5293dc.1294 --> <!-- req webcorefoundation:2c5293dc.3fae --> <!-- req webcorefoundation:ae026fc8.9d33 -->
// 作業パッケージ 8 で作る（plan の受け持ち）：右クリックのメニューは main で組まず、このパッケージの画面で描く（web-core-foundation.md 5.1 節） <!-- req webcorefoundation:7cb842f8.cb82 --> <!-- req webcorefoundation:563536f0.7e7b --> <!-- req webcorefoundation:563536f0.d79b --> <!-- req webcorefoundation:563536f0.5f10 -->
