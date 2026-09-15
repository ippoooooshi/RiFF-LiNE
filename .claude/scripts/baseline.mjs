#!/usr/bin/env node
// 既存の負債の基準線を記録・確認・縮小する。
//
//   node .claude/scripts/baseline.mjs status   現在との差分（新規／解消／据え置き）
//   node .claude/scripts/baseline.mjs record   いまの検出結果を基準線として記録する
//   node .claude/scripts/baseline.mjs shrink   解消済みの項目を基準線から落とす（ラチェット）
//   node .claude/scripts/baseline.mjs list <check>   基準線に載っている項目を全件出す
//
// ゲート（verify.mjs）は「基準線より増えていないか」だけを見る。
// 基準線そのものは .claude/baseline.json に中身ごと残り、status.mjs が
// セッション冒頭に件数を出すので、負債が見えないまま緑になることはない。
import { BASELINED, loadBaseline, saveBaseline, runCheck, evaluateAll, BASELINE_PATH } from './lib/baseline.mjs'
import { json } from './lib/config.mjs'
import { spawnSync } from 'node:child_process'
import { relative, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from './lib/config.mjs'

// スクリプトのパスは cwd 相対にしない（F28: cwd がリポジトリ直下とは限らない）
const HERE = dirname(fileURLToPath(import.meta.url))
const script = n => join(HERE, n)

const cmd = process.argv[2]
const arg = process.argv[3]
const rel = relative(ROOT, BASELINE_PATH).split('\\').join('/')

if (cmd === 'record') {
  const b = { recordedAt: new Date().toISOString(), note: '既存の負債の基準線。ゲートはこれより増えていないかだけを見る。解消したら shrink で落とす。', checks: {} }
  const summary = []
  for (const name of Object.keys(BASELINED)) {
    const r = runCheck(name)
    if (r?.error) { console.error(`✗ ${name}: ${r.error}\n${r.raw || ''}`); process.exit(1) }
    b.checks[name] = { keys: r.keys, recordedLabels: r.findings.map(r.spec.label) }
    summary.push(`  ${name.padEnd(8)} ${String(r.findings.length).padStart(5)} 件`)
  }
  // カバレッジは findings 型ではないので check-coverage.mjs 側に記録させる
  saveBaseline(b)
  {
    const r = spawnSync('node', [script('check-coverage.mjs'), '--record'], { cwd: ROOT, encoding: 'utf8' })
    const line = (r.stdout || '').split('\n').find(Boolean)
    summary.push(`  ${'coverage'.padEnd(8)} ${line ? line.replace(/^カバレッジの基準線を記録しました: /, '') : '(未計測)'}`)
  }
  console.log(`基準線を記録しました → ${rel}\n`)
  console.log(summary.join('\n'))
  console.log(`\nこれ以降、ゲートは**新しく増えたもの**だけを赤にします。`)
  console.log(`ここに載っている分は「既知の負債」です。解消計画（G 番号・担当作業単位）を持たせてください。`)
  console.log(`解消したら: node .claude/scripts/baseline.mjs shrink`)
}

else if (cmd === 'shrink') {
  const b = loadBaseline()
  // 壊れた／無い基準線を「空の基準線」として書き戻さない。
  // 以前は JSON として読めない baseline.json を shrink すると checks:{} と broken:true で
  // 上書きし、手で直せた破損が消えたうえに「基準線が無い」「読めない」が矛盾して表示された。
  // shrink は減らす方向にしか動かない約束だが、「記録を消す」方向には動いていた。
  if (b.broken) { console.error(`✗ ${rel} が JSON として読めません。手で直すか、削除して record し直してください。shrink は何も書きません。`); process.exit(1) }
  if (!b.recordedAt) { console.error(`✗ 基準線がまだありません。先に record してください。`); process.exit(1) }
  let dropped = 0
  for (const name of Object.keys(BASELINED)) {
    const r = runCheck(name)
    if (r?.error) { console.error(`✗ ${name}: ${r.error}`); continue }
    const cur = new Set(r.keys)
    const before = b.checks?.[name]?.keys || []
    const after = before.filter(k => cur.has(k))
    dropped += before.length - after.length
    b.checks[name] = { keys: after, recordedLabels: (b.checks[name]?.recordedLabels || []).filter((_, i) => cur.has(before[i])) }
  }
  b.shrunkAt = new Date().toISOString()
  saveBaseline(b)
  console.log(`解消済み ${dropped} 件を基準線から落としました → ${rel}`)
  console.log(`基準線は減らす方向にしか動かしません。増やすときは record で明示的に記録し直してください。`)
}

else if (cmd === 'list') {
  const b = loadBaseline()
  const names = arg ? [arg] : Object.keys(BASELINED)
  for (const n of names) {
    const labels = b.checks?.[n]?.recordedLabels || []
    console.log(`\n[${n}] ${labels.length} 件`)
    labels.forEach(l => console.log(`  ${l}`))
  }
}

else {
  // status
  const rows = evaluateAll()
  if (json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0) }

  const b = loadBaseline()
  if (!b.recordedAt) {
    console.log(`基準線がまだありません（${rel} が無い）。\n`)
    console.log(`既存の負債があるリポジトリでは、まず現状を記録してください:`)
    console.log(`  node .claude/scripts/baseline.mjs record\n`)
    console.log(`記録せずに使うと、既存の負債で毎ターン Stop hook に止められます。`)
  } else {
    console.log(`基準線: ${b.recordedAt}${b.shrunkAt ? `（最終 shrink ${b.shrunkAt}）` : ''}\n`)
  }

  let anyNew = false
  for (const r of rows) {
    if (r?.error) { console.log(`✗ ${r.name}: ${r.error}`); anyNew = true; continue }
    const mark = r.ok ? '✓' : '✗'
    console.log(`${mark} ${r.name.padEnd(8)} 現在 ${String(r.total).padStart(4)} 件 ` +
                `／ 基準線 ${String(r.baselineCount).padStart(4)} ／ 新規 ${String(r.addedCount).padStart(3)} ／ 解消 ${String(r.resolvedCount).padStart(3)}`)
    if (r.addedCount) {
      anyNew = true
      r.added.slice(0, 20).forEach(f => console.log(`    + ${r.spec.label(f)}`))
      if (r.addedCount > 20) console.log(`    … 他 ${r.addedCount - 20} 件`)
    }
  }

  const resolved = rows.filter(r => r && !r.error && r.resolvedCount > 0)
  if (resolved.length) {
    console.log(`\n解消済みが ${resolved.reduce((s, r) => s + r.resolvedCount, 0)} 件あります。基準線を縮めてください:`)
    console.log(`  node .claude/scripts/baseline.mjs shrink`)
  }
  process.exit(anyNew ? 1 : 0)
}
