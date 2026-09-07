/**
 * alphaTab 同梱アセット（フォント・SoundFont）を renderer の public/ へコピーする。
 * 要件5.1（外部CDN禁止・完全オフライン）。dev / build の前に実行する（package.json の predev / prebuild）。
 *
 * SoundFont は本パッケージでは読み込まないが、再生エンジン統合パッケージ向けに配置だけ行う。
 */
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
