import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 8.1 節：React は UI のフレームワーク。import してよいのは packages/ui-desktop と packages/ui-shared だけ（移すのは作業パッケージ 8） <!-- req webcorefoundation:f6857417.0ceb --> <!-- req webcorefoundation:f6857417.89ff --> <!-- req webcorefoundation:f6857417.4e80 -->
// 6.1 節：レンダラーの入口は apps/desktop/src/renderer、中身は Webコア（packages/ui-shared・packages/ui-desktop を載せるのは作業パッケージ 8） <!-- req webcorefoundation:86b266c6.431b --> <!-- req webcorefoundation:86b266c6.92d1 --> <!-- req webcorefoundation:86b266c6.1c61 --> <!-- req webcorefoundation:86b266c6.36e5 --> <!-- req webcorefoundation:86b266c6.34c8 -->
// <!-- req webcorefoundation:a7cc8aa5.6a8b --> <!-- req webcorefoundation:a7cc8aa5.1fd6 -->

import { App } from './App';
// web-core-foundation.md 14.7 節：この入口には分かれ道を置かず、#root が無いときの判断は rootElement.ts の関数に出す。 <!-- req webcorefoundation:8f5284e2.db36 -->
import { requireRootElement } from './rootElement';

createRoot(requireRootElement(document)).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
