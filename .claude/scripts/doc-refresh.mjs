#!/usr/bin/env node
// 設計書を直したあとの、決まった順の後始末を 1 本で打つ（v73）。照合・分け直し・ダブルチェックは含めない（ワークフローと本体の仕事のまま）。
//
// なぜ要るか（turn 227）: 設計書 3 か所の直しの後始末（分母の作り直し・同期・消えた中身の確かめ・引用の付け直し・印の付け替え）を
//   1 本ずつ打ち、出力を全部抱えて、本体の呼び出しが 110 回・会話 22 万になり、照合まで届かなかった。
//   **手順と中身は変えない。** 今まで打っていたコマンドを、この台本が同じ順に打ち、結果を 1 行ずつにする。
//
// 使い方（--tier は上の段の名前。既定は bd と dd。"dd"・"bd"・"bd,dd" の形）:
//   node .claude/scripts/doc-refresh.mjs before [--tier dd|bd|both]   # 設計書を直した後・コミットの前でよい
//     split.mjs <tier> → sync（dd：dd-impl・dd-it、bd：bd-dd）→ stale-diff の数 → 分け直す単位の数
//     分け直す単位（陳腐化した単位）の ID は .claude/state/doc-refresh.json に書く（本体が show・decompose に使う）
//   node .claude/scripts/doc-refresh.mjs after [--tier dd|bd|both]    # 設計書をコミットし、分け直しとダブルチェックを終えた後
//     reanchor（--file を付けず、--since を省く。v69）→ 中身の同じ要求の印の付け替え（tag-moves --apply、コードとテストの段だけ）→ tag-check の数
//     bd-dd の印は設計書の中に在るので書き替えず、数だけ出す（書き替えたら設計書が変わるため、本体が tag-moves --apply を打ってから before からやり直す）
//   after --since <始まりのコミット>：そのターンの 1 回目と、reanchor が窓の抜けで断ったときに付ける（2 回目からは省く。v69）
//   --json で 1 つの JSON にする
//
// 打つ書き込みの種類（終わりの確かめの --expect に入れる）: before は sync、after は reanchor
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, config, tier } from './lib/config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const sub = argv[0]
const opt = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null }
const asJson = argv.includes('--json')
// 段は project.json から引く（上の段 → その段から出る辺）。既定は bd と dd（このリポジトリの設計書の 2 段）
const allEdges = config().edges || []
const name = e => `${e.from}-${e.to}`
const isDoc = id => { try { return tier(id).extractor === 'markdown' } catch { return false } }
const tierArg = opt('tier') || 'both'
const tiers = tierArg === 'both' ? ['bd', 'dd'].filter(t => allEdges.some(e => e.from === t)) : tierArg.split(',').filter(Boolean)
const bad = tiers.filter(t => !allEdges.some(e => e.from === t))
if (!tiers.length || bad.length) { console.error(`--tier に、辺の上の段でないものがある: ${bad.join(' ') || '（空）'}`); process.exit(2) }
const EDGES = Object.fromEntries(tiers.map(t => [t, allEdges.filter(e => e.from === t).map(name)]))
const CODE_EDGES = new Set(allEdges.filter(e => !isDoc(e.to)).map(name))

const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 256 * 1024 * 1024, env: process.env })
  return { code: r.status ?? 99, out: String(r.stdout || ''), err: String(r.stderr || '') + (r.error ? String(r.error.message) : '') }
}
const parse = s => { try { return JSON.parse(s) } catch { const i = s.search(/[[{]/); try { return i >= 0 ? JSON.parse(s.slice(i)) : null } catch { return null } } }
const firstLines = (s, n = 4) => String(s).split('\n').map(x => x.trimEnd()).filter(Boolean).slice(0, n)
const out = { sub, tiers, steps: [], ok: true }
const step = (name, ok, summary, extra = {}) => { out.steps.push({ name, ok, summary, ...extra }); if (!ok) out.ok = false }

if (sub === 'before') {
  const toDecompose = {}
  for (const t of tiers) {
    const sp = run('split.mjs', [t])
    step(`split.mjs ${t}`, sp.code === 0, sp.code === 0 ? '覆えていない行 0' : '赤（split.mjs を直に打って見る）', sp.code === 0 ? {} : { detail: firstLines(sp.out + sp.err, 6) })
    for (const e of EDGES[t]) {
      const sy = run('ledger.mjs', ['sync', e, '--json']); const j = parse(sy.out); const s = Array.isArray(j) ? j[0] : j
      if (sy.code !== 0 || !s || s.error) { step(`sync ${e}`, false, '赤', { detail: firstLines(sy.out + sy.err, 6) }); continue }
      step(`sync ${e}`, true, `引き継ぎ ${s.carried}・陳腐化 ${s.staled}・新しい単位 ${s.added}${s.added ? `（$L next "${e}" --phase decompose で引く）` : ''}・兄弟から ${s.inherited}・印だけ ${s.tagCarried}`)
      const sd = run('ledger.mjs', ['stale-diff', e, '--json']); const d = parse(sd.out)
      step(`stale-diff ${e}`, !!d, d ? `通し直す単位 ${d.units}・要求が減った ${d.shrunk}・入れ替わった ${d.replaced}（読む：$L stale-diff "${e}"）` : '読めない', d ? {} : { detail: firstLines(sd.out + sd.err, 4) })
      // 分け直す単位＝陳腐化した単位のうち、前の分け方が残っているもの。段の全体の未分解（まだ始めていない文書の分）は数えない
      const st = run('ledger.mjs', ['stale', e, '--json']); const rs = parse(st.out)
      // 前の分け方を持つものだけ（まだ一度も分けていない段落の陳腐化は、受け持ちの作業パッケージで分ける）
      toDecompose[e] = Array.isArray(rs) ? rs.filter(r => !Array.isArray(r.reqs) && ((r.stalePrevReqs || []).length || (r.stalePrevSkips || []).length)).map(r => r.unitId) : []
    }
  }
  try { mkdirSync(join(ROOT, '.claude', 'state'), { recursive: true }); writeFileSync(join(ROOT, '.claude', 'state', 'doc-refresh.json'), JSON.stringify({ at: new Date().toISOString(), tiers, undecomposed: toDecompose }, null, 2)) } catch { /* 書けなくても数は出す */ }
  out.undecomposed = Object.fromEntries(Object.entries(toDecompose).map(([k, v]) => [k, v.length]))
  out.next = '分け直す単位は .claude/state/doc-refresh.json。前の分け方は $L show "<段>" "<単位>" の prevEntries'
  out.writes = ['sync']
} else if (sub === 'after') {
  const dirty = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', 'docs'], { cwd: ROOT, encoding: 'utf8' })
  const dirtyFiles = String(dirty.stdout || '').split('\n').filter(Boolean)
  if (dirtyFiles.length) {
    step('設計書のコミット', false, `コミットしていない設計書 ${dirtyFiles.length}（先にコミットする。付け直しはコミットを窓にする）`, { detail: dirtyFiles.slice(0, 6) })
  } else {
    for (const t of tiers) for (const e of EDGES[t]) {
      const ra = run('ledger.mjs', ['reanchor', e, ...(opt('since') ? ['--since', opt('since')] : []), '--json']); const j = parse(ra.out)
      if (ra.code !== 0 || !j) { step(`reanchor ${e}`, false, '赤（道具が断った。reanchor を直に打って見る）', { detail: firstLines(ra.out + ra.err, 6) }); continue }
      const c = j.counts || {}
      step(`reanchor ${e}`, true, `付け直し ${c.fixed ?? 0}・照合し直し ${c.rejudge ?? 0}`)
      if (CODE_EDGES.has(e)) {
        const tm = run('ledger.mjs', ['tag-moves', e, '--apply', '--json']); const m = parse(tm.out)
        const a = m && m.applied
        step(`印の付け替え ${e}`, tm.code === 0 && !!a && a.conflicts.length === 0, a ? `書き替えた印 ${a.tokens}・ファイル ${a.files}${a.conflicts.length ? `・今の印が 2 つ以上当たって書き替えなかった ${a.conflicts.length}` : ''}` : '読めない',
          a ? { files: a.filesChanged, conflicts: a.conflicts } : { detail: firstLines(tm.out + tm.err, 4) })
      } else {
        const tm = run('ledger.mjs', ['tag-moves', e, '--json']); const m = parse(tm.out)
        step(`印の付け替え ${e}（設計書の中の印。書き替えない）`, !!m, m ? `付け替えが要る印 ${m.count}${m.count ? `（$L tag-moves "${e}" --apply を打ってから before からやり直す）` : ''}` : '読めない')
      }
      const tc = run('ledger.mjs', ['tag-check', e, '--json']); const k = parse(tc.out)
      step(`tag-check ${e}`, true, k ? `印なし ${k.untagged}・行き先の無い印 ${k.orphan}・形の壊れた印 ${k.broken}（範囲の外を含む。終わりの確かめは --scope で見る）` : '読めない')
    }
  }
  out.writes = ['reanchor']
} else {
  console.log('使い方: node .claude/scripts/doc-refresh.mjs before|after [--tier dd|bd|both] [--json]')
  process.exit(2)
}

if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  for (const s of out.steps) {
    console.log(`${s.ok ? '✔' : '✗'} ${s.name}：${s.summary}`)
    for (const d of (s.detail || [])) console.log(`    ${String(d).slice(0, 200)}`)
  }
  if (out.undecomposed) console.log(`分け直す単位（陳腐化）：${Object.entries(out.undecomposed).map(([k, v]) => `${k} ${v}`).join('・')}（${out.next}）`)
  console.log(`打った書き込み：${out.writes.join('・')}（終わりの確かめの --expect に入れる）`)
}
process.exitCode = out.ok ? 0 : 1
