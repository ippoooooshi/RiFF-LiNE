// project.json の読み込みと、依存ゼロの glob / ファイル走査。
// 他プロジェクトへ .claude を持っていっても、書き換えるのは project.json だけ。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, relative, sep, posix } from 'node:path'

export const ROOT = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : findRoot(process.cwd())

function findRoot(start) {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, '.claude', 'project.json'))) return dir
    const up = resolve(dir, '..')
    if (up === dir) return resolve(start)
    dir = up
  }
}

let _cfg = null
export function config() {
  if (_cfg) return _cfg
  const p = join(ROOT, '.claude', 'project.json')
  if (!existsSync(p)) throw new Error(`.claude/project.json が見つかりません（探索起点: ${ROOT}）`)
  _cfg = JSON.parse(stripComments(readFileSync(p, 'utf8')))
  return _cfg
}

// project.json は "$comment" キーで注釈を書く方式なので JSON のまま。
// 将来 // コメントを許したくなったとき用の保険。
function stripComments(s) {
  return s.replace(/^\s*\/\/.*$/gm, '')
}

export function stateDir() {
  const d = join(ROOT, '.claude', 'state')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

export function readState(name, fallback = null) {
  const p = join(stateDir(), name)
  if (!existsSync(p)) return fallback
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback }
}

export function writeState(name, data) {
  writeFileSync(join(stateDir(), name), JSON.stringify(data, null, 2) + '\n')
}

export function clearState(name) {
  const p = join(stateDir(), name)
  if (existsSync(p)) rmSync(p)
}

// ── glob ────────────────────────────────────────────────────────────────
// 対応: ** / * / ? / {a,b}。POSIX 区切りで比較する。
export function globToRegExp(pattern) {
  let re = '', i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // **/ は 0 個以上のディレクトリ
        if (pattern[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 3 }
        else { re += '.*'; i += 2 }
      } else { re += '[^/]*'; i += 1 }
    } else if (c === '?') { re += '[^/]'; i += 1 }
    else if (c === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) { re += '\\{'; i += 1 }
      else {
        re += '(?:' + pattern.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')'
        i = end + 1
      }
    }
    else { re += escapeRe(c); i += 1 }
  }
  return new RegExp('^' + re + '$')
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// sep を使うとプラットフォーム依存になる（Linux では sep === '/' なので
// バックスラッシュが残り、Windows 由来のパスを渡されたときに正規化されない）。
// バックスラッシュは常に区切りとして畳む。
export function toPosix(p) { return String(p).replaceAll('\\', '/') }

// パス比較は必ずここを通す。生の startsWith('docs/') は Windows で全滅する。
export function isUnder(relPath, dir) {
  const p = toPosix(relPath)
  const d = toPosix(dir).replace(/\/$/, '')
  return p === d || p.startsWith(d + '/')
}

export function matchesAny(relPath, patterns) {
  const p = toPosix(relPath)
  return (patterns || []).some(pat => globToRegExp(pat).test(p))
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo'])

export function walk(dir = ROOT, acc = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(full, acc)
    } else if (e.isFile()) {
      // 区切りは必ず POSIX に正規化する。
      // Windows で raw な relative() を返していたため、f.startsWith('docs/') の
      // ような素直なパス比較が全滅した（2311 件の誤検知）。台帳の unitId にも
      // 区切りが混入し、プラットフォームで ID が変わる状態だった。
      // 正規化は「使う側で気をつける」のではなく、ここ1箇所で閉じる。
      acc.push(toPosix(relative(ROOT, full)))
    }
  }
  return acc
}

let _allFiles = null
export function allFiles() { return _allFiles ??= walk() }

export function filesFor(patterns, exclude = []) {
  return allFiles().filter(f => matchesAny(f, patterns) && !matchesAny(f, exclude))
}

// コードの置き場所。project.json の paths.code で差し替えられる。
// 以前は gate.mjs / recurrence.mjs / horizontal.mjs / check-stubs.mjs の 4 箇所に
// `packages/**` `apps/**` が固定で書かれていて、PORTING.md の「scripts/hooks は
// そのまま動く」が嘘だった（check-stubs だけを固有と認めていた）。
export const DEFAULT_CODE_GLOBS = ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx']
export function codeGlobs() {
  const c = config().paths?.code
  return Array.isArray(c) && c.length ? c : DEFAULT_CODE_GLOBS
}
// ゴールが要る範囲（コード＋docs）。paths.goalScope で差し替え。
export function goalGlobs() {
  const g = config().paths?.goalScope
  return Array.isArray(g) && g.length ? g : [...codeGlobs().map(p => p.replace(/\/\*\*\/\*\.\w+$/, '/**')), 'docs/**']
}

export function tier(id) {
  const t = config().tiers.find(t => t.id === id)
  if (!t) throw new Error(`tier "${id}" が project.json に定義されていません`)
  return t
}

export function tierFiles(id) {
  const t = tier(id)
  return filesFor(t.sources, t.exclude || [])
}

// 改行は必ず LF に正規化する。
// CRLF のまま返すと `^#{1,6}\s+(.*)$` の `.` が `\r` を跨げず見出しが 1 つも取れない
// →アンカー付きリンクが全件 missing-heading になる。Windows 主体のプロジェクトで
// docs を CRLF 保存した瞬間に docs 系ゲートが全赤になる（F16 と同型）。
// 「使う側で気をつける」ではなく、読む口 1 箇所で閉じる。
export function read(rel) { return readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n') }
export function exists(rel) { return existsSync(join(ROOT, rel)) }
export function abs(rel) { return join(ROOT, rel) }

// ── 出力 ────────────────────────────────────────────────────────────────
export const json = process.argv.includes('--json')

export function out(human, data) {
  if (json) console.log(JSON.stringify(data, null, 2))
  else console.log(human)
}
