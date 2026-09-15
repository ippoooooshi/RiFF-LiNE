#!/usr/bin/env node
// 水平展開検索。修正したパターンがリポジトリの他の場所に残っていないかを数える。
//
// なぜこれがあるか:
//   SetTempoCommand の欠落（G2）を直したが仕組みを足さなかったため、
//   同型の欠落が拍子変更・リピート・アクセント・チョーキング・付点・連符の
//   6 件に残っていた。個別の不具合は直るが、同じクラスが別の場所で再発する。
//   「直した」と報告する前に、必ずここを通す。
//
// 使い方:
//   node .claude/scripts/horizontal.mjs "<正規表現>" [--in "glob"] [--json]
//   node .claude/scripts/horizontal.mjs "Command\\b" --in "packages/*/src/**/*.ts"
import { allFiles, read, matchesAny, json, codeGlobs } from './lib/config.mjs'

const args = process.argv.slice(2)
const inIdx = args.indexOf('--in')
const scope = inIdx >= 0 ? args[inIdx + 1] : null
// `--in` の値を検索パターンに取らない（`--in "glob" "pattern"` の順で書くと glob が
// 正規表現として解釈され、合法なら黙って別物を検索していた）
// `--in` が無いとき inIdx は -1 で、inIdx + 1 が 0 になる——つまり**最初の位置引数
// （パターンそのもの）を除外していた**。`--in` を付けずに呼ぶと必ず「使い方」を出して
// exit 2 で終わる。どの hook からも呼ばれていなかったので誰も気づかなかった。
const skipIdx = inIdx >= 0 ? inIdx + 1 : -1
const pattern = args.find((a, i) => !a.startsWith('--') && i !== skipIdx)

if (!pattern) {
  console.log('使い方: node .claude/scripts/horizontal.mjs "<正規表現>" [--in "glob"]')
  console.log('  修正したパターンを渡すと、同型がリポジトリの他の場所に残っていないかを列挙します。')
  process.exit(2)
}

let re
try { re = new RegExp(pattern, 'g') }
catch (e) { console.error('正規表現が不正です: ' + e.message); process.exit(2) }

const DEFAULT_SCOPE = [...codeGlobs(), 'docs/**/*.md']   // project.json の paths.code。固定しない
const files = allFiles().filter(f => matchesAny(f, scope ? [scope] : DEFAULT_SCOPE))

const hits = []
for (const f of files) {
  let src
  try { src = read(f) } catch { continue }
  src.split('\n').forEach((line, i) => {
    re.lastIndex = 0
    if (re.test(line)) hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 140) })
  })
}

const byFile = {}
hits.forEach(h => (byFile[h.file] ??= []).push(h))

if (json) console.log(JSON.stringify({ pattern, scope: scope || DEFAULT_SCOPE, scanned: files.length, hits: hits.length, byFile }, null, 2))
else {
  Object.entries(byFile).forEach(([f, hs]) => {
    console.log(`\n${f}  (${hs.length})`)
    hs.forEach(h => console.log(`  ${String(h.line).padStart(5)}  ${h.text}`))
  })
  console.log(`\n水平展開検索: パターン /${pattern}/  ヒット ${hits.length} 件 / ${Object.keys(byFile).length} ファイル（走査 ${files.length}）`)
  console.log('報告に必須の3つ: 検索パターン / ヒット件数 / そのうち未対応の件数。')
  console.log('未対応が残るなら G 番号を起こしてから完了にすること。')
}
