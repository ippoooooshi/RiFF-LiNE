#!/usr/bin/env node
// 検証コマンドをまとめて実行し、結果を state に記録する。
// Stop hook もこれを呼ぶ。「実行したと報告する」ではなく「実行して緑である」が条件。
//
// 使い方:
//   node .claude/scripts/verify.mjs            # コード系すべて
//   node .claude/scripts/verify.mjs docs       # ドキュメント系だけ
//   node .claude/scripts/verify.mjs --json
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, config, readState, writeState, json, filesFor, codeGlobs, abs } from './lib/config.mjs'
import { BASELINED, evaluate, loadBaseline } from './lib/baseline.mjs'

// スクリプトのパスは cwd 相対にしない（起動失敗の原因になる）
const HERE = dirname(fileURLToPath(import.meta.url))
const q = n => JSON.stringify(join(HERE, n))

const cfg = config()
const mode = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1])

// 名前 → 実際に走らせるコマンド
function resolve(name) {
  if (cfg.commands?.[name]) return cfg.commands[name]
  const builtin = {
    smoke:    `node ${q('smoke.mjs')}`,
    // 設定と実ファイルのズレ。段が 0 件・段どうしが重なっていると、
    // 台帳の「未判定 0」がそもそも意味を持たない。子プロセスを増やさないので安い。
    config:   `node ${q('check-config.mjs')}`,
    docs:     `node ${q('check-docs-links.mjs')}`,
    stubs:    `node ${q('check-stubs.mjs')}`,
    tests:    `node ${q('check-tests.mjs')}`,
    legacy:   `node ${q('check-legacy.mjs')}`,
    ledger:   `node ${q('ledger.mjs')} stats`,
    // テストの十分性。既にある coverage サマリを読むだけなので毎ターン走らせても無料。
    coverage: `node ${q('check-coverage.mjs')}`,
    // レビューの分母。未判定の hunk が残っていれば赤。
    review:   `node ${q('diff-units.mjs')} pending`,
    // 水平展開の分母。直した型の同型に未判定が残っていれば赤。
    spread:   `node ${q('spread.mjs')} pending`,
    // 上位文書と保存済みの分母のズレ。足した要求が台帳に載っていなければ赤。
    drift:    `node ${q('split.mjs')} drift`,
    // 作業パッケージの参照健全性。前提の実在・循環・繰り越し先の実在。
    wp:       `node ${q('wp.mjs')} check`,
  }
  return builtin[name] || null
}

// selftest を先頭に置く。検査スクリプト自身が壊れていたら、以降の結果は
// 信用できない（初版は Windows パス・採番簿・コメント判定・空台帳の 4 箇所で
// 誤検知を出し、うち 1 つはドキュメント作業を恒久的にブロックした）。
// legacy（旧構成の残骸検出）は **毎ターンのゲートに入れない**。
// あれは一度きりの移行状態であって、コードの品質ではない。入れてしまうと
// 「移行の宿題が残っている」というだけで開発ターンが恒久的に止まる
// ——既存の負債で全ターンが止まった F23 と同じ誤りを別の場所で犯していた。
// legacy は /migrate と CI で見て、status.mjs が警告として見せる。
// **smoke（検査スクリプト自身の検査）はここに入れない。**
// v22 は selftest を毎回の verify に入れていて、コードを触るたびに子プロセス 302 本・
// 実測 23 秒（Windows ではさらに）が上乗せされていた。Stop hook がタイムアウトすると
// non-blocking 扱いでターンが通る——つまり**重すぎる検査は、検査が消えることと同じ**。
// 検査スクリプトの健全性は /verify smoke と /migrate と CI で見る。
const CODE_SET = [...(cfg.verifyOnCodeChange || ['typecheck', 'lint', 'test']), 'stubs', 'tests', 'coverage', 'docs', 'config', 'wp']
const DOC_SET  = [...(cfg.verifyOnDocChange || ['docs']), 'config', 'wp']
const nested = process.env.CLAUDE_VERIFY_NESTED === '1'
const names = (mode === 'docs' ? DOC_SET : mode ? [mode] : CODE_SET)

// 既存の負債を持つ検査（stubs / tests / docs）は、件数ゼロではなく
// **基準線より増えていないか**で判定する。ゼロを初日に要求すると、
// 既知の負債だけで毎ターン Stop hook に止められて何も進まない。
const baseline = loadBaseline()

// ── 内容ハッシュ ────────────────────────────────────────────────────────
// v22 のキャッシュは verify.json の ok と時刻だけを見ていたので、
// {"ok":true,"at":"<未来>","mode":"code"} を書けば typecheck も lint も test も
// 走らずに通った（実測）。ここではキャッシュの鍵を**検証対象ファイルの内容**にする。
// 偽造するには正しいハッシュを自分で計算して書く必要があり、それは
// 「検証を意図的に飛ばした」という別種の行為になる（state/ は deny 済み）。
function treeHash() {
  const pats = [...codeGlobs(), 'docs/**/*.md', 'package.json', 'pnpm-lock.yaml',
                'tsconfig*.json', '*/tsconfig*.json', 'packages/*/package.json', 'apps/*/package.json']
  let files = []
  try { files = filesFor(pats) } catch { return null }
  const h = createHash('sha256')
  for (const f of files.sort()) {
    h.update(f); h.update('\0')
    try { h.update(readFileSync(abs(f))) } catch { h.update('<unreadable>') }
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}
const HASH = treeHash()
const cache = readState('verify.json', null)
const cacheEntries = (cache && cache.hash && cache.hash === HASH && cache.entries) ? cache.entries : {}
const entries = {}

// 外部コマンド（project.json の commands）だけキャッシュする。組み込みの検査は
// 台帳や coverage の状態にも依存し、どれも数秒なので毎回走らせる。
const CACHEABLE = new Set(Object.keys(cfg.commands || {}))

// 1 コマンドの上限。ハングした test（watch モード等）で hook のタイムアウトまで
// 固まるのを防ぐ。Stop hook 側の上限は settings.json で 1800 秒。
const CMD_TIMEOUT = Number(process.env.CLAUDE_VERIFY_CMD_TIMEOUT || 480) * 1000

const results = []
for (const name of names) {
  const started = Date.now()

  if (BASELINED[name]) {
    const e = evaluate(name, baseline)
    if (e?.error) {
      results.push({ name, cmd: `(baseline) ${name}`, ok: false, code: 1, ms: Date.now() - started, tail: e.error + '\n' + (e.raw || '') })
      if (!json) { console.log(`✗ ${name.padEnd(10)} ${e.error}`); console.log(indent(e.raw || '')) }
      continue
    }
    const tail = e.ok
      ? `既存 ${e.carried} 件（基準線）／新規 0 件${e.resolvedCount ? ` ／ 解消 ${e.resolvedCount} 件（shrink 可）` : ''}`
      : `新規 ${e.addedCount} 件（基準線 ${e.baselineCount} 件に無いもの）\n` +
        e.added.slice(0, 15).map(f => '  + ' + e.spec.label(f)).join('\n') +
        (e.addedCount > 15 ? `\n  … 他 ${e.addedCount - 15} 件` : '') +
        `\n  既存の負債として認めるなら: node .claude/scripts/baseline.mjs record`
    results.push({ name, cmd: `(baseline) ${name}`, ok: e.ok, code: e.ok ? 0 : 1, ms: Date.now() - started,
                   tail, baseline: { total: e.total, carried: e.carried, added: e.addedCount, resolved: e.resolvedCount } })
    if (!json) {
      console.log(`${e.ok ? '✓' : '✗'} ${name.padEnd(10)} 現在 ${e.total} 件（既存 ${e.carried} / 新規 ${e.addedCount}）`)
      if (!e.ok) console.log(indent(tail))
    }
    continue
  }

  const cmd = resolve(name)
  if (!cmd) {
    // 名前を指定して呼んだのに未定義なら、それは緑ではなく誤り。
    // `verify.mjs bogus` が「1/0 緑」で exit 0 になり、しかも ok:true のキャッシュを
    // 書いて次の Stop を通していた。一覧実行での未定義（typecheck を持たない
    // プロジェクトなど）だけをスキップとして扱う。
    if (mode && mode !== 'docs') {
      console.error(`✗ ${name}: project.json の commands にも組み込みにも定義がありません`)
      console.error(`  使える名前: ${[...Object.keys(cfg.commands || {}), 'smoke', 'config', 'docs', 'stubs', 'tests', 'legacy', 'ledger', 'coverage', 'review', 'spread', 'drift', 'wp'].join(' / ')}`)
      process.exit(2)
    }
    results.push({ name, skipped: true, why: 'project.json に定義がありません' }); continue
  }
  // 内容が前回の緑のときと同一なら、外部コマンドは再実行しない。
  // 鍵はこのプロセスが自分で計算したハッシュなので、verify.json を書き換えても効かない。
  const hit = HASH && CACHEABLE.has(name) && cacheEntries[name]?.ok === true
  if (hit) {
    entries[name] = cacheEntries[name]
    results.push({ name, cmd, ok: true, code: 0, ms: 0, cached: true, tail: '（前回と内容が同一のため再利用）' })
    if (!json) console.log(`✓ ${name.padEnd(10)} ${cmd}  (キャッシュ: 内容に変化なし)`)
    continue
  }

  // 子プロセスからさらに verify が呼ばれる閉路を塞ぐ。子孫はこの印を見て verify を走らせない。
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
                             timeout: CMD_TIMEOUT,
                             env: { ...process.env, CLAUDE_VERIFY_NESTED: '1' } })
  const timedOut = r.error && (r.error.code === 'ETIMEDOUT' || r.signal)
  const ok = !timedOut && r.status === 0
  let tail = ((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).slice(-25).join('\n')
  if (timedOut) tail = `${CMD_TIMEOUT / 1000} 秒を超えたため打ち切りました（ハングしている可能性があります）。\n` + tail
  results.push({ name, cmd, ok, code: r.status, ms: Date.now() - started, tail })
  if (ok && CACHEABLE.has(name)) entries[name] = { ok: true, at: new Date().toISOString() }
  if (!json) console.log(`${ok ? '✓' : '✗'} ${name.padEnd(10)} ${cmd}${ok ? '' : `  (exit ${r.status}${timedOut ? ' / 時間切れ' : ''})`}`)
  if (!ok && !json) console.log(indent(tail))
}

const failed = results.filter(r => !r.ok && !r.skipped)
const ran = results.filter(r => !r.skipped)
// 1 つも走っていない緑は緑ではない（全部スキップなら ok:false）
const ok = failed.length === 0 && ran.length > 0
if (!ran.length && !json) console.log('✗ 検査が 1 つも実行されていません（すべて未定義）。project.json の commands を確認してください。')
writeState('verify.json', { at: new Date().toISOString(), mode: mode || 'code', hash: HASH, entries, results, ok })

if (json) console.log(JSON.stringify({ ok, results }, null, 2))
else console.log(`\nverify: ${ran.length - failed.length}/${ran.length} 緑${results.length - ran.length ? `（未定義でスキップ ${results.length - ran.length}）` : ''}`)

function indent(s) { return s.split('\n').map(l => '    ' + l).join('\n') }
process.exit(ok ? 0 : 1)
