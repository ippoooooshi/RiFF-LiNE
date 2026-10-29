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
// <!-- req webcorefoundation:4c0d3d51.360a --> <!-- req webcorefoundation:7eb6666d.ab60 --> <!-- req webcorefoundation:47306a52.d757 -->
// <!-- req webcorefoundation:7eb6666d.7c2f --> <!-- req webcorefoundation:7eb6666d.32df -->
// <!-- req webcorefoundation:e2e8521c.967d --> <!-- req webcorefoundation:e2e8521c.c73c -->
// <!-- req webcorefoundation:e220e853.f08d --> <!-- req webcorefoundation:3aec5d4c.b894 -->

export {};
// <!-- req webcorefoundation:d2ce5509.2f12 --> <!-- req webcorefoundation:d2ce5509.1abb --> <!-- req webcorefoundation:d2ce5509.1294 --> <!-- req webcorefoundation:d2ce5509.3fae --> <!-- req webcorefoundation:ae026fc8.9d33 -->
// 作業パッケージ 8 で作る（plan の受け持ち）：右クリックのメニューは main で組まず、このパッケージの画面で描く（web-core-foundation.md 5.1 節） <!-- req webcorefoundation:28944e7e.cb82 -->
