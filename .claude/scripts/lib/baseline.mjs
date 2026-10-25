// 既存の負債を「基準線」として記録し、ゲートは**増えていないか**だけを見る。
//
// なぜこれが要るか:
//   初日から「ダミー配線 0 件」「リンク切れ 0 件」を絶対条件にすると、
//   既存の負債があるリポジトリでは全ターンが Stop hook で止まり、
//   何も進められなくなる。実際、既知のダミー配線 9 件（I1 で解消予定）だけで
//   verify が永久に赤になった。
//
//   ゲートの役割は「今日より悪くしないこと」であって、「初日に全部返済させること」
//   ではない。返済は作業単位のゴールとして計画的にやる。
//
// なぜ負債を隠さないか:
//   基準線は .claude/baseline.json に**中身ごと**記録し、status.mjs が
//   セッション冒頭に件数を出す。件数が見えないまま緑になるのは、
//   これまで何度も踏んだ「偽の緑」そのもの。
//
// ラチェット:
//   解消された項目は基準線から落とす（`baseline.mjs shrink`）。
//   一度減らした基準線は増やさない——増やすときは必ず人が record し直す。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from './config.mjs'

// スクリプトの場所は cwd ではなく **このモジュールからの相対**で解決する。
// ROOT 基準にすると、フィクスチャや移植先で .claude/scripts が別の場所に
// あるときに動かない。
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const script = n => join(SCRIPTS, n)

export const BASELINE_PATH = join(ROOT, '.claude', 'baseline.json')

// 行番号は編集で動くので鍵に使わない。file + kind + 実体（本文・リンク・プレフィックス）で識別する。
export const BASELINED = {
  stubs: {
    cmd: ['node', [script('check-stubs.mjs'), '--json']],
    pick: d => d.findings || [],
    key: f => `${f.file}|${f.kind}|${String(f.text || '').trim()}`,
    label: f => `${f.file}:${f.line} [${f.kind}] ${String(f.text || '').slice(0, 90)}`,
  },
  docs: {
    cmd: ['node', [script('check-docs-links.mjs'), '--json']],
    pick: d => d.findings || [],
    key: f => `${f.file}|${f.kind}|${f.link || ''}`,
    label: f => `${f.file}:${f.line} [${f.kind}] ${f.link || ''}`,
  },
  tests: {
    cmd: ['node', [script('check-tests.mjs'), '--json']],
    pick: d => [...(d.idFindings || []), ...(d.substanceFindings || [])],
    key: f => `${f.file}|${f.kind}|${f.prefix || f.name || ''}`,
    label: f => `${f.file}${f.line ? ':' + f.line : ''} [${f.kind}] ${f.prefix || f.name || ''}`,
  },
}

export function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { recordedAt: null, checks: {} }
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) }
  catch { return { recordedAt: null, checks: {}, broken: true } }
}

export function saveBaseline(b) {
  writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2) + '\n')
}

export function runCheck(name) {
  const spec = BASELINED[name]
  if (!spec) return null
  const [bin, args] = spec.cmd
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  let data = null
  try { data = JSON.parse(r.stdout) } catch { /* 落ちた or JSON でない */ }
  if (!data) {
    return { name, error: `${name} の実行に失敗しました（JSON を返しませんでした）`,
             raw: ((r.stdout || '') + (r.stderr || '')).split('\n').slice(-15).join('\n') }
  }
  const findings = spec.pick(data)
  return { name, findings, keys: findings.map(spec.key), spec, data }
}

// 現在の検出結果を基準線と突き合わせる
export function evaluate(name, baseline = loadBaseline()) {
  // 壊れた baseline.json を黙って「空の基準線」として扱わない。
  // 空として扱うと既存の負債が全件「新規」になり、原因が表示されないまま
  // 全ターンが赤で止まる（何が起きたのか読む側に分からない）。
  if (baseline.broken) {
    return { name, error: 'baseline.json が JSON として読めません。既存の負債が全件「新規」と判定されます。',
             raw: `${BASELINE_PATH} を直すか、削除して node .claude/scripts/baseline.mjs record を実行してください。` }
  }
  const res = runCheck(name)
  if (!res || res.error) return res
  const base = new Set(baseline.checks?.[name]?.keys || [])
  const cur = new Map(res.findings.map((f, i) => [res.keys[i], f]))

  const added = [...cur.entries()].filter(([k]) => !base.has(k)).map(([, f]) => f)
  const resolved = [...base].filter(k => !cur.has(k))
  const carried = [...cur.keys()].filter(k => base.has(k)).length

  return {
    name, spec: res.spec,
    total: res.findings.length,
    added, addedCount: added.length,
    resolvedCount: resolved.length,
    carried,
    baselineCount: base.size,
    ok: added.length === 0,
  }
}

export function evaluateAll(baseline = loadBaseline()) {
  return Object.keys(BASELINED).map(n => evaluate(n, baseline))
}

// status.mjs 用の要約（負債を隠さないための表示）
export function debtSummary(baseline = loadBaseline()) {
  const rows = Object.entries(baseline.checks || {})
    .map(([name, v]) => ({ name, count: (v.keys || []).length }))
    .filter(r => r.count > 0)
  return { recordedAt: baseline.recordedAt, rows, total: rows.reduce((s, r) => s + r.count, 0), broken: !!baseline.broken }
}
