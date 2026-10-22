/**
 * alphaTab 同梱アセット（フォント・SoundFont）を renderer の public/ へコピーする。
 * 要件5.1（外部CDN禁止・完全オフライン）。dev / build の前に実行する（package.json の predev / prebuild）。
 *
 * SoundFont は本パッケージでは読み込まないが、再生エンジン統合パッケージ向けに配置だけ行う。
 */
// <!-- req webcorefoundation:fbf53582.f107 --> <!-- req webcorefoundation:fbf53582.8fcf --> <!-- req webcorefoundation:f87abd8f.6e9f -->
// <!-- req webcorefoundation:c6a73304.0185 --> <!-- req webcorefoundation:c6a73304.c09f --> <!-- req webcorefoundation:c6a73304.1dfb --> <!-- req webcorefoundation:c6a73304.8422 --> <!-- req webcorefoundation:c6a73304.457b --> <!-- req webcorefoundation:c6a73304.170a --> <!-- req webcorefoundation:c6a73304.4fac --> <!-- req webcorefoundation:c6a73304.53a0 --> <!-- req webcorefoundation:c6a73304.4881 --> <!-- req webcorefoundation:c6a73304.4f28 -->
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

// alphaTab の exports は './package.json' を公開しないため、メインエントリ（dist/alphaTab.js）から dist を導く。
const alphaTabDistDir = dirname(require.resolve('@coderline/alphatab'));
const outBase = resolve(import.meta.dirname, '../src/renderer/public/alphatab');

await rm(outBase, { recursive: true, force: true });
await mkdir(outBase, { recursive: true });
await cp(resolve(alphaTabDistDir, 'font'), resolve(outBase, 'font'), { recursive: true });
await cp(resolve(alphaTabDistDir, 'soundfont'), resolve(outBase, 'soundfont'), { recursive: true });

console.log(`[copy-alphatab-assets] copied font/soundfont -> ${outBase}`);
