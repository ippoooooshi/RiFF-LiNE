#!/usr/bin/env node
/**
 * ダミー配線（dead wiring）ガード。
 *
 * WP8 では 15 画面のシェルを実装したものの、曲一覧のカード操作・パネル・再生・
 * ショートカット等のハンドラが `() => undefined` のまま「シェル段階だから非ブロッキング」
 * と分類され、実 UI では何も動かない状態でマージ直前まで進んだ（G23 / G25、
 * docs/review/design_audit_2026-09-10.md）。レビューの判断に委ねず機械的に落とす。
 *
 * 検査内容（`apps/desktop/src/renderer/**` と `packages/core/src/ui/**` の非テストファイル）:
 *   1. JSX プロパティに渡されたダミーハンドラ  `onXxx={() => undefined}` / `onXxx={() => {}}`
 *   2. 実装放棄マーカー `TODO` / `FIXME` / `未実装` / `not implemented`
 *
 * 意図的に置く場合は直前行または同一行に理由付きの opt-out を書く:
 *   // quality-allow-stub: <理由と、いつ誰が解消するか>
 *
 * 使い方: node scripts/check-stub-wiring.mjs
 * 終了コード: 0=OK / 1=ダミー配線あり
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 走査対象（UI の配線が集まる場所）。 */
const SCAN_ROOTS = [
  join(REPO_ROOT, 'apps', 'desktop', 'src', 'renderer'),
  join(REPO_ROOT, 'packages', 'core', 'src', 'ui'),
];

const SOURCE_EXT = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const ALLOW_MARKER = 'quality-allow-stub';

const RULES = [
  {
    id: 'dead-handler',
    // onClick={() => undefined} / onComplete={() => {}} 形式のダミーハンドラ
    re: /\bon[A-Z]\w*\s*=\s*\{\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\})\s*\}/g,
    message: 'ダミーハンドラ（実サービス/コントローラへ未結線）',
  },
  {
    id: 'abandoned',
    // 「未実装」は B19 のような意図的な Phase 2 繰り越しを説明する JSDoc でも使われるため対象外。
    // 放棄マーカーとして一義的な TODO / FIXME / not implemented のみを見る。
    re: /\b(TODO|FIXME)\b|not implemented/gi,
    message: '実装放棄マーカー',
  },
];

function listSources(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (SOURCE_EXT.test(entry) && !TEST_FILE.test(entry)) out.push(p);
  }
  return out;
}

const findings = [];

for (const root of SCAN_ROOTS) {
  for (const file of listSources(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // 同一行 or 直前行に opt-out があれば見逃す。
      const allowed = line.includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER));
      if (allowed) return;
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (m !== null) findings.push({ file, line: i + 1, rule: rule.id, message: rule.message, text: line.trim() });
      }
    });
  }
}

const rel = (p) => relative(REPO_ROOT, p).replace(/\\/g, '/');

if (findings.length === 0) {
  console.log('stub wiring: OK（ダミー配線 0 件）');
  process.exit(0);
}

console.error(`\nstub wiring: ${findings.length} 件のダミー配線／実装放棄マーカー\n`);
for (const f of findings) {
  console.error(`  ${rel(f.file)}:${f.line}  [${f.rule}] ${f.message}`);
  console.error(`    ${f.text.slice(0, 140)}`);
}
console.error(
  `\n設計が定めた接続先へ実結線するか、意図的な繰り越しなら理由付きで opt-out を書く:\n` +
    `  // ${ALLOW_MARKER}: <理由と、いつ誰が解消するか>\n` +
    `方針は .claude/rules/quality.rule.md。`,
);
process.exit(1);
