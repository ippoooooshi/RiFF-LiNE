import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// alphaTab の同梱アセット（フォント・SoundFont）は scripts/copy-alphatab-assets.mjs が
// src/renderer/public/alphatab/ へコピーする（package.json の predev / prebuild）。
// Vite は public/ をルート（/）で配信し、ビルド時に dist-electron/renderer/ へそのままコピーする。
// 要件5.1: 外部CDN禁止・完全オフライン。
// <!-- req webcorefoundation:0408f13a.3f74 --> <!-- req webcorefoundation:b162240a.dc0e --> <!-- req webcorefoundation:6581ddd9.282d -->
// <!-- req webcorefoundation:a47f7f42.fe51 --> <!-- req webcorefoundation:a47f7f42.06f8 -->
// <!-- req webcorefoundation:8a9add99.66f8 --> <!-- req webcorefoundation:8a9add99.7952 --> <!-- req webcorefoundation:8a9add99.5a08 --> <!-- req webcorefoundation:8a9add99.94c4 --> <!-- req webcorefoundation:8a9add99.2ca1 -->

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        // electron 本体は実行時に Electron ランタイムが提供する（npm パッケージの shim をバンドルしない）。
        external: ['electron'],
        // CJS で出力する（Electron ランタイムの `require('electron')` が確実に解決できる）。
        output: { format: 'cjs', entryFileNames: '[name].js' },
        input: { main: resolve(rootDir, 'src/main/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].js' },
        input: { preload: resolve(rootDir, 'src/preload/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve(rootDir, 'src/renderer'),
    // Tailwind CSS v4 の Vite のプラグイン（web-core-foundation.md 4.2 節「Vite への入れ方」）。 // <!-- req webcorefoundation:0fa9efa2.d8e5 --> <!-- req webcorefoundation:232c51bb.9005 --> <!-- req webcorefoundation:232c51bb.352e --> <!-- req webcorefoundation:232c51bb.da2c -->
    // トークンは packages/ui-desktop/theme.css の @theme に置く。CSS がそれを読み込むまでは何も出さない。
    plugins: [react(), tailwindcss()],
    build: {
      // main（dist-electron/main）から `../renderer` で参照できるよう出力先を揃える。
      outDir: resolve(rootDir, 'dist-electron/renderer'),
      rollupOptions: { input: resolve(rootDir, 'src/renderer/index.html') },
      // alphaTab は単一バンドルで約 2.7MB。分割しても意味が薄いので警告閾値を上げる。
      chunkSizeWarningLimit: 4096,
    },
    server: {
      fs: { strict: true },
    },
  },
});
