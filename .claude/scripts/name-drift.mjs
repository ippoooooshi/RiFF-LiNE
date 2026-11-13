#!/usr/bin/env node
// 設計書とコードのどちらか片方からだけ消えた名前（定数・部品・関数の名前）を見つける（v73、読むだけ）。
//
// なぜ要るか:
//   turn 225 でコードから定数 DEFAULT_FLUSH_TIMEOUT_MS を無くしたが、設計書の 3 か所はその名前のままだった（照合で見つかり 244 番になった）。
//   turn 227 では設計書の決定が変わったのに、コードの注が古い形のまま残っていた。
//   名前は機械で追える。**片方で消えて、もう片方に残っている名前**は、どちらかの書き漏れの疑いが強い。
//   言い回し（「タイムアウトで先へ進む」）は機械では追えないので、ここでは見ない（照合で見る）。
//
// 見るもの（--base のコミットから今の作業の木まで）:
//   A. コードの消えた行に在った名前で、今のコードのどこにも無く、今の設計書に残っているもの → 設計書の直し漏れの疑い
//   B. 設計書の消えた行に `…` で在った名前で、今の設計書のどこにも無く、今のコードに残っているもの → コード（注を含む）の直し漏れの疑い
//   名前の形：英字で始まる 6 文字以上で、途中に大文字があるか（camelCase・PascalCase）、大文字と _ だけ（CONST_CASE）のもの
//
// 使い方:
//   node .claude/scripts/name-drift.mjs --base <コミット> [--ok <名前>]… [--json]
//   --ok は、見たうえで残してよいと決めた名前（報告に理由を書く）。何も書かない。
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/config.mjs'

const argv = process.argv.slice(2)
const optAll = name => { const out = []; argv.forEach((a, i) => { if (a === '--' + name && argv[i + 1] !== undefined) out.push(argv[i + 1]) }); return out }
const base = optAll('base')[0]
const okNames = new Set(optAll('ok'))
const asJson = argv.includes('--json')
if (!base) { console.error('使い方: node .claude/scripts/name-drift.mjs --base <コミット> [--ok <名前>]… [--json]'); process.exit(2) }

const git = args => {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 256 * 1024 * 1024 })
  return { code: r.status ?? 99, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
export const NAME_RE = /[A-Za-z][A-Za-z0-9_]*/g
export function nameish(t) {
  if (t.length < 6) return false
  if (/^[A-Z][A-Z0-9_]*$/.test(t)) return t.includes('_')            // CONST_CASE（_ を含むものだけ。HTTPS・README などの語を外す）
  return /^[A-Za-z][a-z0-9]*[A-Z]/.test(t) && /[a-z]/.test(t)           // camelCase・PascalCase（途中に大文字）
}
const namesIn = s => (String(s).match(NAME_RE) || []).filter(nameish)
const ticked = s => [...String(s).matchAll(/`([^`]+)`/g)].map(m => m[1])

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|css|html|ya?ml)$/i
const listed = git(['ls-files', '--', 'apps', 'packages', 'docs'])
if (listed.code !== 0) { console.error(listed.err); process.exit(1) }
const files = listed.out.split('\n').filter(Boolean).filter(f => !/(^|\/)(dist|node_modules|coverage)\//.test(f))
const codeFiles = files.filter(f => /^(apps|packages)\//.test(f) && CODE_EXT.test(f))
const docFiles = files.filter(f => /^docs\//.test(f) && f.endsWith('.md'))
const readLines = f => { try { return readFileSync(join(ROOT, f), 'utf8').split('\n') } catch { return [] } }
const index = list => {
  const at = new Map()
  for (const f of list) readLines(f).forEach((l, i) => { for (const t of new Set(String(l).match(NAME_RE) || [])) { if (!at.has(t)) at.set(t, []); const a = at.get(t); if (a.length < 5) a.push(`${f}:${i + 1}`) } })
  return at
}
const codeNow = index(codeFiles), docNow = index(docFiles)

const removedLines = paths => {
  const d = git(['diff', '--no-color', '-U0', base, '--', ...paths])
  if (d.code !== 0) { console.error(d.err); process.exit(1) }
  const out = []
  let file = null
  for (const l of d.out.split('\n')) {
    if (l.startsWith('--- ')) { file = l.slice(4).replace(/^a\//, ''); continue }
    if (l.startsWith('-') && !l.startsWith('---')) out.push({ file, text: l.slice(1) })
  }
  return out
}
const codeGone = removedLines(['apps', 'packages']).filter(x => x.file && CODE_EXT.test(x.file) && !/(^|\/)(dist|node_modules)\//.test(x.file))
const docGone = removedLines(['docs']).filter(x => x.file && x.file.endsWith('.md'))

const findings = [], okayed = []
const seen = new Set()
for (const x of codeGone) for (const n of namesIn(x.text)) {
  if (seen.has('A' + n) || codeNow.has(n) || !docNow.has(n)) continue
  seen.add('A' + n)
  const f = { kind: 'コードから消えて設計書に残る', name: n, from: x.file, at: docNow.get(n) }
  ;(okNames.has(n) ? okayed : findings).push(f)
}
for (const x of docGone) for (const s of ticked(x.text)) for (const n of namesIn(s)) {
  if (seen.has('B' + n) || docNow.has(n) || !codeNow.has(n)) continue
  seen.add('B' + n)
  const f = { kind: '設計書から消えてコードに残る', name: n, from: x.file, at: codeNow.get(n) }
  ;(okNames.has(n) ? okayed : findings).push(f)
}
const res = { base, codeFiles: codeFiles.length, docFiles: docFiles.length, removedCodeLines: codeGone.length, removedDocLines: docGone.length, findings, okayed }
if (asJson) console.log(JSON.stringify(res, null, 2))
else {
  console.log(`name-drift（${base.slice(0, 7)} から）：片方から消えた名前 ${findings.length}${okayed.length ? `（--ok で外した ${okayed.length}）` : ''}`)
  for (const f of findings) console.log(`  ${f.kind}  ${f.name}  ← ${f.from}  残っている所: ${f.at.slice(0, 3).join(' ')}`)
}
process.exitCode = findings.length ? 1 : 0
