#!/usr/bin/env node
// ターンの始めと終わりの確かめを 1 本で打つ（v61、読むだけ）。
//
// なぜ要るか（2026-10-24 本人の指摘「毎回このくらいトークン使うのは、トークンパフォーマンスが落ちている」）:
//   CC は 1 ターンに、始めの確かめ 6〜8 本・終わりの確かめ 15 本ほどを 1 本ずつ打ち、出力（JSON の一覧）を全部抱えていた。
//   CC はコマンドを 1 本打つたびに抱えている文を全部読み直すので、本数と出力の量がそのまま使う量になる。
//   **確かめの中身は変えない。** 今まで打っていたコマンドをこの台本が順に打ち、結果を 1 行ずつの表にする。
//   赤のものだけ、続きの行を少し出す（全文は、そのコマンドを直に打てば見られる）。
//
// 使い方:
//   node .claude/scripts/turn-check.mjs start
//   node .claude/scripts/turn-check.mjs end --since <ターンの始まりの ISO 時刻> --expect judge,plan,… \
//        [--scope "<詳細設計のファイル名>:<a-b>"]… [--edges "req-bd,bd-dd,dd-impl"] [--verify] [--allow "<直下の未追跡>"]… [--json]
//   --scope は何度でも書ける（区切りごと）。範囲の照合前・未分解・ダブルチェック前・印なしを見る
//   --scope-edge "dd-it" … --scope を見る段（何度でも書ける。既定は "dd-impl" だけ。v62）
//   --verify を付けると verify（typecheck・lint・test）も打つ（数分かかる）。v64：project.json の ciParity（CI と同じ確かめ。カバレッジのしきい値・書式など）も 1 本ずつ打つ
//
// 何も書かない（台帳・文書・state のどれにも）。子のコマンドも読むだけのものだけを打つ（split は --dry-run）。
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, config } from './lib/config.mjs'
import { envWithTools } from './lib/tool-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const sub = argv[0]
const optAll = name => { const out = []; argv.forEach((a, i) => { if (a === '--' + name && argv[i + 1] !== undefined) out.push(argv[i + 1]) }); return out }
const opt = name => optAll(name)[0] ?? null
const has = name => argv.includes('--' + name)
const asJson = has('json')

const node = (script, args, timeout = 300_000) => {
  const p = script.includes('/') ? join(ROOT, script) : join(HERE, script)
  const r = spawnSync(process.execPath, [p, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, env: process.env })
  return { code: r.status ?? (r.error ? 99 : 0), out: String(r.stdout || ''), err: String(r.stderr || '') + (r.error ? String(r.error.message) : '') }
}
const git = args => {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 99, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
const parse = s => { try { return JSON.parse(s) } catch { const i = s.indexOf('{'); try { return i >= 0 ? JSON.parse(s.slice(i)) : null } catch { return null } } }
const tail = (s, n = 8) => String(s).split('\n').map(x => x.trimEnd()).filter(Boolean).slice(0, n)

const rows = []
const add = (name, ok, summary, detail = []) => rows.push({ name, ok, summary, detail: ok ? [] : detail })
const warn = (name, summary, detail = []) => rows.push({ name, ok: null, summary, detail })

function finish() {
  const bad = rows.filter(r => r.ok === false)
  if (asJson) console.log(JSON.stringify({ sub, ok: bad.length === 0, failed: bad.length, rows }, null, 2))
  else {
    for (const r of rows) {
      console.log(`${r.ok === true ? '✔' : r.ok === false ? '✗' : '△'} ${r.name}：${r.summary}`)
      r.detail.slice(0, 10).forEach(d => console.log(`    ${String(d).slice(0, 220)}`))
    }
    console.log(bad.length ? `\n✗ 赤 ${bad.length} 件（${bad.map(r => r.name).join('・')}）。全文はそのコマンドを直に打って見る` : '\n全部緑')
  }
  process.exitCode = bad.length ? 1 : 0
}

// ── 共通の確かめ ─────────────────────────────────────────────────────────
function checkVersion() {
  const r = node('check-version.mjs', ['--json']); const j = parse(r.out)
  const d = j ? [...(j.stale || []), ...(j.missing || [])].filter(x => x !== 'scheduled_tasks.lock') : null
  add('道具のずれ（check-version）', !!j && d.length === 0, j ? `ずれ ${d.length}` : '読めない', d || tail(r.out + r.err))
}
function drift() {
  const r = node('split.mjs', ['drift', '--json']); const j = parse(r.out)
  const bad = (j?.rows || []).filter(x => x.state !== '一致')
  add('分母と文書（split drift）', !!j && bad.length === 0, j ? `${(j.rows || []).length} 段のうち一致しない ${bad.length}` : '読めない',
    j ? bad.map(x => `${x.tier} ${x.state} 新規 ${x.added} 変化 ${x.changed} 消失 ${x.removed}`) : tail(r.out + r.err))
}
function staleDiff(edges) {
  for (const e of edges) {
    const r = node('ledger.mjs', ['stale-diff', e, '--json']); const j = parse(r.out)
    add(`陳腐化の積み残し（stale-diff ${e}）`, !!j && j.units === 0, j ? `${j.units}` : '読めない', j ? (j.rows || []).slice(0, 5).map(x => `${x.unitId || ''} ${x.file || ''}:${x.line || ''}`) : tail(r.out + r.err))
  }
}
function checkTests() {
  const r = node('check-tests.mjs', ['--json']); const j = parse(r.out)
  const n = j ? (j.idFindings || []).length + (j.substanceFindings || []).length : null
  add('テストの番号と空振り（check-tests）', r.code === 0, j ? `見つかったもの ${n}（テストのファイル ${j.testFiles}）` : `終わりのコード ${r.code}`,
    j ? [...(j.idFindings || []), ...(j.substanceFindings || [])].slice(0, 6).map(x => `${x.file} [${x.kind}] ${x.why || ''}`) : tail(r.out + r.err))
}
function gitStatus(allow) {
  const r = git(['status', '--porcelain'])
  const lines = r.out.split('\n').filter(Boolean)
  const untracked = lines.filter(l => l.startsWith('??')).map(l => l.slice(3).replace(/^"|"$/g, ''))
  const allowed = new Set(['Claude outputs/', '_bridge/honnin_t171_decided.json', '_claude_fix/', '帰ったら打つ.md', ...allow])
  const newUntracked = untracked.filter(p => !allowed.has(p) && !p.startsWith('_bridge/archive/'))
  const changed = lines.filter(l => !l.startsWith('??')).map(l => l.trim())
  return { changed, untracked, newUntracked }
}

// ── start ───────────────────────────────────────────────────────────────
if (sub === 'start') {
  const head = git(['rev-parse', 'HEAD']).out.trim()
  const branch = (() => { try { return readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim().replace(/^ref: refs\/heads\//, '') } catch { return '?' } })()
  warn('始まり', `時刻 ${new Date().toISOString()}・コミット ${head.slice(0, 12)}・ブランチ ${branch}`)
  try { warn('active-turn.md', readFileSync(join(ROOT, '_bridge', 'active-turn.md'), 'utf8').replace(/\s+/g, ' ').trim().slice(0, 160)) } catch { warn('active-turn.md', '無い') }
  checkVersion()
  const s = node('smoke.mjs', ['--last'], 120_000); const sj = parse(s.out)
  add('自動テストの前の結果（smoke --last）', !!sj && sj.ok === true, sj ? `${sj.passed}/${sj.total}・今の道具と同じ ${sj.sameTools}` : '読めない', tail(s.out + s.err))
  const st = gitStatus(optAll('allow'))
  warn('差分（git status）', `変更 ${st.changed.length}・直下の新しい未追跡 ${st.newUntracked.length}`, [...st.changed, ...st.newUntracked.map(p => `?? ${p}`)].slice(0, 12))
  drift()
  staleDiff((opt('edges') || 'req-bd,bd-dd,dd-impl').split(',').map(x => x.trim()).filter(Boolean))
  checkTests()
  finish()
}

// ── end ─────────────────────────────────────────────────────────────────
else if (sub === 'end') {
  const edges = (opt('edges') || 'req-bd,bd-dd,dd-impl').split(',').map(x => x.trim()).filter(Boolean)
  checkVersion()
  drift()
  // split の表の疑いと覆えていない行（--dry-run：分母のファイルは書かない）
  {
    const r = node('split.mjs', ['--all', '--dry-run', '--json']); const j = parse(r.out)
    const arr = Array.isArray(j) ? j : []
    const un = arr.reduce((n, x) => n + (x.uncovered || 0), 0), sus = arr.flatMap(x => x.suspectTables || [])
    add('切り分け（覆えていない行・表の疑い）', arr.length > 0 && un === 0 && sus.length === 0, arr.length ? `覆えていない ${un}・表の疑い ${sus.length}` : '読めない', arr.length ? sus.slice(0, 5) : tail(r.out + r.err))
  }
  { const r = node('check-config.mjs', []); add('設定（check-config）', r.code === 0, r.code === 0 ? '0' : '赤', tail(r.out + r.err)) }
  { const r = node('check-docs-links.mjs', ['--json']); const j = parse(r.out)
    const f = j ? (j.findings || j.broken || []) : null
    add('文書のリンク（check-docs-links）', r.code === 0, f ? `${f.length}` : (r.code === 0 ? '0' : '赤'), f ? f.slice(0, 5).map(x => JSON.stringify(x).slice(0, 200)) : tail(r.out + r.err)) }
  // 【要確認】と今日より後の日付（docs/ の .md）
  {
    const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const walk = d => { let out = []; for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) out = out.concat(walk(p)); else if (n.endsWith('.md')) out.push(p) } return out }
    const files = existsSync(join(ROOT, 'docs')) ? walk(join(ROOT, 'docs')) : []
    const ask = [], future = []
    for (const f of files) {
      const ls = readFileSync(f, 'utf8').split('\n')
      ls.forEach((l, i) => {
        if (l.includes('【要確認】')) ask.push(`${relative(ROOT, f)}:${i + 1}`)
        for (const m of l.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) if (m[1] > ymd) future.push(`${relative(ROOT, f)}:${i + 1} ${m[1]}`)
      })
    }
    add('【要確認】', ask.length === 0, `${ask.length}`, ask.slice(0, 5))
    add(`今日（${ymd}）より後の日付`, future.length === 0, `${future.length}`, future.slice(0, 5))
  }
  // 引用切れ（_bridge/recheck-evidence.mjs）
  if (existsSync(join(ROOT, '_bridge', 'recheck-evidence.mjs'))) {
    for (const e of edges) {
      const r = node('_bridge/recheck-evidence.mjs', [e, '--json']); const j = parse(r.out)
      const s = j?.results?.[0]?.stat
      const inv = s ? (s.drift || 0) + (s.notFound || 0) + (s.other || 0) : null
      add(`引用切れ（recheck-evidence ${e}）`, inv === 0, s ? `照合 ${s.checked}・無効 ${inv}` : '読めない', s ? (j.results[0].bad || []).slice(0, 5).map(b => `${b.reqId} ${b.kind} ${b.file}:${b.line}`) : tail(r.out + r.err))
    }
  } else add('引用切れ（recheck-evidence）', false, '_bridge/recheck-evidence.mjs が無い')
  // 区切りごと：未分解・照合前・ダブルチェック前・印なし
  const scopeEdges = optAll('scope-edge').length ? optAll('scope-edge') : ['dd-impl']
  for (const sc of optAll('scope')) for (const se of scopeEdges) {
    const m = String(sc).match(/^(.+?):(\d+-\d+)$/)
    if (!m) { add(`範囲 ${sc}`, false, '形が違う（"<ファイル名>:<a-b>"）'); continue }
    const [, file, lines] = m
    const sl = se === 'dd-impl' ? '' : ` ${se}`
    const p = node('ledger.mjs', ['pending', se, '--file', file, '--lines', lines, '--json']); const pj = parse(p.out)
    // v63: ダブルチェックが要らない段（requireApproval が立っていない。dd-it）は、未承認を赤に数えない（turn 185 で dd-it の 3585 を赤にした）
    const apRed = pj && pj.requireApproval === true ? (pj.approvalUnresolved || 0) : 0
    add(`範囲 ${file}:${lines}${sl}（pending）`, !!pj && pj.undecomposed === 0 && pj.unjudged === 0 && !apRed,
      pj ? `未分解 ${pj.undecomposed}・照合前 ${pj.unjudged}・ダブルチェック前など ${pj.requireApproval === true ? (pj.approvalUnresolved || 0) : 'ー（要らない段）'}（先送り ${pj.deferred || 0}・照合しないスコープ外 ${pj.notJudgedScopeOut || 0}${pj.judgedElsewhere ? `・別の段で照合済み ${pj.judgedElsewhere}` : ''}）` : '読めない', tail(p.out + p.err))
    const t = node('ledger.mjs', ['tag-check', se, '--file', file, '--lines', lines, '--json']); const tj = parse(t.out)
    add(`範囲 ${file}:${lines}${sl}（tag-check）`, !!tj && tj.untagged === 0 && tj.orphan === 0 && tj.broken === 0,
      tj ? `印なし ${tj.untagged}・行き先の無い印 ${tj.orphan}・形の壊れた印 ${tj.broken}` : '読めない',
      tj ? [...(tj.untaggedList || []).map(x => `印なし ${x.entryId} ${x.file}:${x.line}`), ...(tj.orphanList || []).map(x => `行き先なし ${x.file}:${x.line} ${x.tag}`)].slice(0, 6) : tail(t.out + t.err))
  }
  { const r = node('ledger.mjs', ['plan-report', 'dd-impl', '--json']); const j = parse(r.out)
    add('分類（plan-report dd-impl）', !!j && j.missing === 0 && j.staleCount === 0, j ? `分類の無い一致以外 ${j.missing}・一致か対象外なのに分類が残る ${j.staleCount}` : '読めない',
      j ? [...(j.missingList || []).map(x => `分類なし ${x.reqId} ${x.verdict}`), ...(j.staleList || []).map(x => `残り ${x.reqId} ${x.kind}`)].slice(0, 6) : tail(r.out + r.err)) }
  staleDiff([...edges, 'dd-it'])
  // 想定外の書き込み
  {
    const since = opt('since'), expect = opt('expect')
    if (!since || !expect) add('想定外の書き込み（ops）', false, '--since と --expect が要る')
    else { const r = node('ledger.mjs', ['ops', '--since', since, '--expect', expect, '--json']); const j = parse(r.out)
      add('想定外の書き込み（ops）', r.code === 0 && !!j && j.unexpected === 0, j ? `${j.unexpected}（書き込み ${j.count ?? (j.rows || []).length}）` : `終わりのコード ${r.code}`,
        j ? (j.unexpectedRows || []).slice(0, 6).map(x => `${x.cmd} ${x.at || ''} ${x.edge || ''}`) : tail(r.out + r.err)) }
  }
  // 一時ファイルと直下の新しい未追跡
  {
    const d = join(ROOT, '.claude', 'coverage', 'edges')
    const tmp = existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.lock') || f.includes('.tmp')) : []
    add('進捗管理ファイルの一時ファイル', tmp.length === 0, `${tmp.length}`, tmp)
    const st = gitStatus(optAll('allow'))
    add('直下の新しい未追跡', st.newUntracked.length === 0, `${st.newUntracked.length}`, st.newUntracked)
    warn('コミットしていない変更', `${st.changed.length}`, st.changed.slice(0, 10))
  }
  checkTests()
  if (has('verify')) {
    const r = node('verify.mjs', ['--json'], 1_800_000); const j = parse(r.out)
    const ran = (j?.results || []).filter(x => !x.skipped), bad = ran.filter(x => !x.ok)
    // v64: verify は見張りの中でも打つので重いもの（カバレッジのしきい値・書式）を入れていない。CI だけが落ちる形を作らないため、
    //   終わりの確かめでは CI と同じ確かめ（project.json の ciParity）も打つ（turn 186：触っていない run-app.mjs の分かれ道で test:coverage が赤だった）
    for (const c of (config().ciParity || [])) {
      const rr = spawnSync(String(c), { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024, env: { ...envWithTools(process.env), CLAUDE_VERIFY_NESTED: '1' } })
      add(`CI と同じ確かめ（${c}）`, rr.status === 0, rr.status === 0 ? '緑' : `終わりのコード ${rr.status ?? '?'}`, rr.status === 0 ? [] : (String(rr.stdout || '') + String(rr.stderr || '')).split('\n').map(x => x.trimEnd()).filter(Boolean).slice(-8))
    }
    add('verify（typecheck・lint・test ほか）', r.code === 0 && !!j && j.ok !== false, j ? `${ran.length - bad.length}/${ran.length} 緑` : `終わりのコード ${r.code}`, j ? bad.flatMap(x => [`${x.name}:`, ...tail(x.tail || '', 4)]) : tail(r.out + r.err))
  }
  // 本人が読む文の言葉（手順書 10 節の左の列）。赤にはせず、当たった行を出す（引用・コマンド名の中は人が見て外す）
  {
    const words = ['台帳', '断片', '体）', '分類器', 'noText', '一致以外', '未承認', '受け先表', '見立て', '書き戻し', '子の役', '一覧役', '取り出し役']
    const hits = []
    for (const f of ['_bridge/from-cc.md', '_bridge/from-cc-detail.md']) {
      if (!existsSync(join(ROOT, f))) continue
      readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
        const plain = l.replace(/`[^`]*`/g, '').replace(/「[^」]*」/g, '')
        for (const w of words) if (plain.includes(w)) hits.push(`${f}:${i + 1} 「${w}」`)
      })
    }
    warn('報告の言葉（10 節の左の列。引用とコマンド名は除いた）', `${hits.length}`, hits.slice(0, 8))
  }
  finish()
}

else {
  console.log('使い方: node .claude/scripts/turn-check.mjs start | end --since <ISO> --expect <種類,…> [--scope "<ファイル名>:<a-b>"]… [--scope-edge <段>]… [--edges …] [--verify] [--allow <パス>]… [--json]')
  process.exitCode = 2
}
