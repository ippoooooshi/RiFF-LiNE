#!/usr/bin/env node
// カバレッジが**下がっていないか**だけを見る（ラチェット）。
//
// なぜこれがあるか:
//   `11_test_strategy.md` は「全メソッド C0/C1 100%」を要求しているが、
//   強制が無いので守られているかを誰も確かめていなかった。テストを書いたことにする
//   サボりは、空振り検出（assertion 0 / 恒真 / モック反響）では拾いきれない——
//   assertion があっても通らない経路が残っていれば同じことだから。
//
//   初日に 100% を要求しない。それは F23（既存の負債で全ターンが止まる）と同じ誤り。
//   **基準線より下がったファイルだけ**を赤にする。上げるのは作業単位のゴールでやる。
//
// テストは実行しない。**既にある coverage サマリを読むだけ**なので、毎ターン走らせても
// コストがゼロ。プロジェクト側の test コマンドが coverage を出す設定なら自動で効く。
//
// 使い方:
//   node .claude/scripts/check-coverage.mjs [--json]
//   node .claude/scripts/check-coverage.mjs --record   # いまの値を基準線にする
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT, config, json, toPosix } from './lib/config.mjs'
import { loadBaseline, saveBaseline } from './lib/baseline.mjs'

const cfg = config()
// vitest / jest の json-summary、または istanbul の coverage-summary.json
const SUMMARY = cfg.paths?.coverageSummary || 'coverage/coverage-summary.json'
// プロジェクトが coverage を要求しているか（宣言していれば、計測が無いこと自体を赤にする）
const declared = !!cfg.paths?.coverageSummary ||
  /--coverage|c8|nyc|--collectCoverage/.test(String(cfg.commands?.test || '') + String(cfg.commands?.coverage || ''))

const p = join(ROOT, SUMMARY)
const record = process.argv.includes('--record')

function read() {
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// { 相対パス: { lines, branches } } に正規化する
function normalize(sum) {
  const out = {}
  for (const [k, v] of Object.entries(sum)) {
    if (k === 'total') continue
    const rel = toPosix(k.startsWith('/') || /^[A-Za-z]:/.test(k) ? relative(ROOT, k) : k)
    if (rel.startsWith('..')) continue
    const lines = Number(v?.lines?.pct)
    const branches = Number(v?.branches?.pct)
    if (!Number.isFinite(lines)) continue
    out[rel] = { lines, branches: Number.isFinite(branches) ? branches : 0 }
  }
  return out
}

const raw = read()

if (!raw) {
  const msg = declared
    ? `カバレッジのサマリが見つかりません: ${SUMMARY}\n` +
      `  project.json が coverage を宣言しているのに計測結果がありません。\n` +
      `  **「未計測」を「問題なし」と読まないこと。** テストを coverage 付きで実行してください。`
    : `カバレッジ未計測（${SUMMARY} が無い）。\n` +
      `  テストの十分性は検査されていません。有効にするには project.json に次を足してください:\n` +
      `    "commands": { "test": "<coverage を出すコマンド>" }\n` +
      `    "paths":    { "coverageSummary": "coverage/coverage-summary.json" }`
  if (json) console.log(JSON.stringify({ measured: false, declared, summary: SUMMARY, findings: [] }, null, 2))
  else console.log(msg)
  process.exit(declared ? 1 : 0)
}

const cur = normalize(raw)

if (record) {
  const b = loadBaseline()
  if (b.broken) { console.error('baseline.json が JSON として読めません。先に直してください。'); process.exit(1) }
  b.checks ??= {}
  b.checks.coverage = { recordedAt: new Date().toISOString(), files: cur }
  saveBaseline(b)
  const n = Object.keys(cur).length
  const avg = n ? (Object.values(cur).reduce((s, v) => s + v.lines, 0) / n).toFixed(1) : '0'
  console.log(`カバレッジの基準線を記録しました: ${n} ファイル（行平均 ${avg}%）`)
  console.log(`これ以降、**基準線より下がったファイルだけ**を赤にします。`)
  process.exit(0)
}

const base = loadBaseline().checks?.coverage?.files || {}
const findings = []
for (const [file, v] of Object.entries(cur)) {
  const b = base[file]
  if (!b) continue   // 新規ファイルは基準線が無い。ラチェットは「下がらないこと」だけを見る
  if (v.lines < b.lines) findings.push({ file, kind: 'lines-dropped', was: b.lines, now: v.lines })
  else if (v.branches < b.branches) findings.push({ file, kind: 'branches-dropped', was: b.branches, now: v.branches })
}
// 基準線に在ったファイルが消えた場合は、リネームか削除。ラチェットとしては見ない（shrink で落とす）
const gone = Object.keys(base).filter(f => !cur[f])
const files = Object.keys(cur).length
const avg = files ? (Object.values(cur).reduce((s, v) => s + v.lines, 0) / files).toFixed(1) : '0'

if (json) console.log(JSON.stringify({ measured: true, declared, summary: SUMMARY, files, avgLines: Number(avg), findings, gone }, null, 2))
else {
  findings.forEach(f => console.log(`✗ ${f.file}  ${f.kind === 'lines-dropped' ? '行' : '分岐'} ${f.was}% → ${f.now}%`))
  console.log(`\ncheck-coverage: ${files} ファイル / 行平均 ${avg}% / 低下 ${findings.length} 件` +
    (Object.keys(base).length ? '' : '  ← 基準線が未記録（node .claude/scripts/check-coverage.mjs --record）'))
  if (gone.length) console.log(`  基準線に在って今回の計測に無いファイル ${gone.length} 件（削除かリネーム）`)
  if (findings.length) console.log(`\nカバレッジが下がっています。**テストを消して通した形になっていないか確認してください。**`)
}
process.exit(findings.length ? 1 : 0)
