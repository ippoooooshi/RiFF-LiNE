#!/usr/bin/env node
// `.claude` の道具一式が、配布されたものと一致しているかを見る。
//
// なぜこれがあるか（2026-09-15、実際に踏んだ）:
//   差分配布を手で組み立てていて、**変更したファイルを 1 つ入れ忘れた**。
//   しかも「前回ぶんも含めた一式」と宣言して渡したので、受け取った側は
//   全部入っていると信じて当てた。結果、新しい smoke が古い gate を検査して
//   2 件落ち、原因の切り分けに時間を使わせた。
//
//   このとき配布物には「入れたファイルのハッシュ」しか付いていなかった。
//   **入れ忘れたファイルは、そのリストにも載らない。** 載っていないものは照合できない。
//   だから照合の相手は「配布物」ではなく「**道具一式の全ファイル**」でなければならない。
//
//   手順書に「全部当てること」と書いても実行されない（F51 と同型）。機械が見る。
//
// 対象外にするもの:
//   project.json と rules/{typescript,electron,ui,layer}.md
//     … project.json 自身が「他プロジェクトへ持っていくときはここを書き換える」と
//       宣言しているファイル。プロジェクトごとに違って当然なので照合しない。
//   state/ と coverage/ … 機械が書く場所
//
// 使い方:
//   node .claude/scripts/check-version.mjs            # 照合する
//   node .claude/scripts/check-version.mjs --json
//   node .claude/scripts/check-version.mjs --write    # マニフェストを作り直す（配布側）
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const CLAUDE = join(HERE, '..')
const MANIFEST = join(CLAUDE, 'MANIFEST.sha256')
const json = process.argv.includes('--json')
const write = process.argv.includes('--write')

// プロジェクトごとに書き換える前提のファイル。照合しない。
const PROJECT_OWNED = new Set([
  'project.json',
  'rules/typescript.md', 'rules/electron.md', 'rules/ui.md', 'rules/layer.md',
  'settings.local.json',
])
const SKIP_DIR = new Set(['state', 'coverage', 'node_modules', '.git'])
// 機械が書くファイル。**配布物ではないので照合しない。**
// baseline.json は基準線の記録（lib/baseline.mjs が `.claude/baseline.json` に書く）。
// 初版はこれを「旧版の残骸かもしれません」と報告していた。**当たっていない警告は、
// 警告そのものを無視する癖をつける**ので、誤検知は誤検知として直す。
// v40: scheduled_tasks.lock は Claude Code の予定のタスクの錠のファイル（リポジトリの道具ではない）。
// 実測（turn 125）: v39 を当てたときにマニフェストに入り、中身が変わると「ずれ」と出るようになった
const MACHINE_WRITTEN = new Set(['baseline.json', 'scheduled_tasks.lock'])

function walk(dir, base = '') {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIR.has(name)) continue
      out.push(...walk(p, rel))
    } else if (st.isFile()) {
      if (rel === 'MANIFEST.sha256') continue
      if (PROJECT_OWNED.has(rel) || MACHINE_WRITTEN.has(rel)) continue
      out.push(rel)
    }
  }
  return out
}
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex')

const files = walk(CLAUDE)
const actual = new Map(files.map(f => [f, sha(join(CLAUDE, f.split('/').join(sep)))]))

if (write) {
  const body = [...actual.entries()].map(([f, h]) => `${h}  ${f}`).join('\n') + '\n'
  writeFileSync(MANIFEST, body)
  console.log(`MANIFEST.sha256 を作り直しました（${actual.size} ファイル）`)
  process.exit(0)
}

if (!existsSync(MANIFEST)) {
  console.error('.claude/MANIFEST.sha256 がありません。')
  console.error('  配布物に付いているはずのファイルです。当て漏れが無いかを確かめられません。')
  process.exit(1)
}

const expected = new Map()
for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
  const m = line.match(/^([0-9a-f]{64})\s\s(.+)$/)
  if (m) expected.set(m[2], m[1])
}

const stale = [], missing = [], extra = []
for (const [f, h] of expected) {
  if (!actual.has(f)) missing.push(f)
  else if (actual.get(f) !== h) stale.push(f)
}
for (const f of actual.keys()) if (!expected.has(f)) extra.push(f)

const ok = !stale.length && !missing.length
if (json) {
  console.log(JSON.stringify({ ok, checked: expected.size, stale, missing, extra }, null, 2))
} else if (ok && !extra.length) {
  console.log(`✓ .claude の道具 ${expected.size} ファイルは配布されたものと一致しています。`)
} else {
  if (stale.length) {
    console.log(`✗ 内容が違うファイル（${stale.length} 件）— **当て漏れか、手で編集したもの**`)
    stale.forEach(f => console.log(`    .claude/${f}`))
  }
  if (missing.length) {
    console.log(`✗ 存在しないファイル（${missing.length} 件）`)
    missing.forEach(f => console.log(`    .claude/${f}`))
  }
  if (extra.length) {
    console.log(`△ マニフェストに無いファイル（${extra.length} 件）— 旧版の残骸かもしれません`)
    extra.forEach(f => console.log(`    .claude/${f}`))
  }
  if (!ok) {
    console.log('')
    console.log('**この状態で他の検査結果を信用しないでください。**')
    console.log('新しい検査スクリプトが古い実装を検査すると、原因と無関係な場所が赤くなります。')
  }
}
process.exit(ok ? 0 : 1)
