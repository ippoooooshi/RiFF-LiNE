#!/usr/bin/env node
// 現在地を「書かずに、毎回計算する」。
//
// なぜこれがあるか:
//   CLAUDE.md に進捗を書くと必ず腐る。実際、3日前の状態（「次は作業パッケージ2」
//   「既知ギャップ G1-G21」）が毎セッション注入され続けていた。
//   毎セッション読まれるファイルが現在地について嘘をつくのは、
//   ハルシネーションの供給源そのもの。
//
//   実測できないのは「いま何をやっているか」と「人間が何を承認したか」の2つだけ。
//   それだけを state/current.json に持ち、他はすべてここで計算する。
//
// 使い方: node .claude/scripts/status.mjs [--json] [--no-verify]
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ROOT, config, read, exists, readState, json } from './lib/config.mjs'
import { allStats } from './ledger.mjs'
import { debtSummary } from './lib/baseline.mjs'

const cfg = config()

// 入れ子の verify を禁止する。
//   status → verify → selftest → gate(session-start) → status → verify → …
// という閉路がある（selftest はフックの発火そのものを検査するので gate を起動する）。
// これまで回らなかったのは、status が verify を cwd 相対で起動していて
// fixture 内で解決に失敗し、そこで連鎖が偶然切れていたため。
// 偶然に頼らず、子プロセス側では verify を走らせないと明示する。
const nested = process.env.CLAUDE_VERIFY_NESTED === '1'
const noVerify = process.argv.includes('--no-verify') || nested

// 出力に版スタンプを入れる。
// フックが注入した現在地と、手で実行した結果が食い違ったとき、
// 「どちらがどの版の出力か」を推測せずに判別できるようにする。
// スタンプが無い注入テキストは、この status.mjs の出力ではない。
const STAMP = (() => {
  try {
    const self = fileURLToPath(import.meta.url)
    return createHash('sha1').update(readFileSync(self)).digest('hex').slice(0, 7)
  } catch { return 'unknown' }
})()

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? (r.stdout || '').trim() : null
}

// ── git ────────────────────────────────────────────────────────────────
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(git なし)'
const dirty = (git('status', '--porcelain') || '').split('\n').filter(Boolean)
const base = git('rev-parse', '--verify', 'main') ? 'main' : (git('rev-parse', '--verify', 'master') ? 'master' : null)
const ahead = base ? (git('diff', '--name-only', `${base}...HEAD`) || '').split('\n').filter(Boolean) : []
const recent = (git('log', '--oneline', '-5') || '').split('\n').filter(Boolean)

// ── ギャップ台帳 ────────────────────────────────────────────────────────
const gl = cfg.gapLedger
let gaps = { open: [], resolved: 0, error: null }
if (gl && exists(gl.file)) {
  const src = read(gl.file)
  const rows = src.split('\n').filter(l => new RegExp(`^\\|\\s*${gl.prefix}\\d+`).test(l.trim()))
  rows.forEach(l => {
    const id = (l.match(new RegExp(`${gl.prefix}\\d+`)) || [])[0]
    if (!id) return
    if (l.includes(gl.resolvedMarker)) gaps.resolved++
    else gaps.open.push(id)
  })
  if (!rows.length) gaps.error = `${gl.file} の §${gl.section} から ${gl.prefix} 行を1つも読めていません（表の書式を確認）`
} else if (gl) {
  gaps.error = `${gl.file} が見つかりません`
}

// ── 網羅台帳 ────────────────────────────────────────────────────────────
let ledger = []
try { ledger = allStats() } catch (e) { ledger = [{ error: e.message }] }

// ── 作業単位（実測できない唯一のもの）───────────────────────────────────
const current = readState('current.json')
const unverified = readState('unverified.json')

// journal.jsonl は追記のみの記録。壊れた行があっても読める分だけ返す。
function journalTail(n) {
  try {
    const p = join(ROOT, '.claude', 'state', 'journal.jsonl')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// ── 台帳を使わずに通した小修正（adhoc）────────────────────────────────
// 逃げ道そのものは要る（小修正のたびに台帳を要求すると F23 と同じ道）。
// **選んだことが見えなければ、逃げ道ではなく素通りと同じ。**
const adhoc = readState('adhoc.json', { entries: [] }).entries || []

// ── レビューの分母 ──────────────────────────────────────────────────────
// phase が review のときだけ出す。それ以外の場面で前回の残骸を「現在地」として
// 見せない。state を直接読む（diff-units.mjs は import すると先頭の
// コマンド振り分けが status.mjs の引数で走ってしまう）。
let review = null
if (current?.phase === 'review') {
  const st = readState('review.json', { units: [] })
  const units = st.units || []
  const unjudged = units.filter(u => !u.verdict).length
  review = { base: st.base, units: units.length, unjudged, judged: units.length - unjudged,
             findings: units.filter(u => u.verdict === '指摘あり').length }
}

// ── 旧構成の残骸（警告として見せる。ターンは止めない）───────────────────
// これは一度きりの移行状態であって、コードの品質ではない。毎ターンのゲートに
// 入れると「移行の宿題が残っている」だけで開発が恒久的に止まる（F26）。
// パスは fileURLToPath で解決する（new URL(...).pathname は Windows で /C:/… になる）。
let legacyData = null
{
  const r = spawnSync('node', [fileURLToPath(new URL('./check-legacy.mjs', import.meta.url)), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  try { legacyData = JSON.parse(r.stdout) } catch { /* 取れなくても止めない */ }
}

// ── 検証（本人の選択により毎回実行）─────────────────────────────────────
let verify = null
if (!noVerify) {
  // 子プロセスのパスは cwd 相対にしない（F28。同じファイル内の check-legacy は
  // モジュール相対で解決しているのに、ここだけ cwd 相対が残っていた）。
  const r = spawnSync('node', [fileURLToPath(new URL('./verify.mjs', import.meta.url)), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  try { verify = JSON.parse(r.stdout) } catch { verify = { ok: false, results: [], error: '検証の実行に失敗しました' } }
}

const data = { stamp: STAMP, branch, dirty: dirty.length, ahead: ahead.length, base, recent, gaps, ledger, review, adhoc: adhoc.length, adhocRecent: adhoc.slice(-3), current, unverified, verify, debt: debtSummary(), legacy: legacyData }

if (json) { console.log(JSON.stringify(data, null, 2)); process.exit(0) }

// ── 表示 ────────────────────────────────────────────────────────────────
const L = []
// スタンプの区切りに ':' を使わない。`status.mjs:1499286` は claims.mjs の
// 引用検査（ファイル名.拡張子:数字）と形が同じで、**この行を報告に引用すると必ず誤検知する**。
// 実運用で 3 ターン続けて踏んだ（訂正のたびに同じ表記を再掲して、また踏んだ）。
// 検査を緩めるより、**衝突する文字列を機械が生成しないようにする**のが先。
L.push(`現在地（${new Date().toLocaleString('ja-JP')} 実測 / 版 status.mjs@${STAMP}）`)
L.push(`  ※ この行末の status.mjs@<7桁> が版のスタンプです（行番号ではありません）。`)
L.push(`     フックが注入した現在地と手で実行した結果が食い違ったら、まずこのスタンプを比べてください。`)
L.push('')
L.push(`  ブランチ    : ${branch}${base ? `（${base} から ${ahead.length} ファイル差分）` : ''}  未コミット ${dirty.length}`)
if (current?.unit) {
  L.push(`  作業単位    : ${current.unit}${current.goalId ? ` / ${current.goalId}` : ''}`)
  if (current.goal) L.push(`  ゴール      : ${current.goal}`)
  if (current.pendingHuman?.length) L.push(`  ⚠ 人間の判断待ち: ${current.pendingHuman.length} 件 — ${current.pendingHuman.slice(0, 3).join(' / ')}`)
} else {
  L.push(`  作業単位    : 未設定 ← /wp start で対象とゴールを置いてから着手すること`)
}
L.push('')
L.push('  網羅台帳')
// 先頭 1 段のエラーで全段の表示を止めない（旧実装は ledger[0].error で短絡していた）
ledger.forEach(s => {
  if (s.error) { L.push(`   ! ${s.edge.padEnd(14)} ${s.error}`); return }
  // 未初期化・未着手を ✓ と混同しない（偽の緑を出さない）
  const mark = { '未初期化': '!', '未着手': '!', '進行中': ' ', '前後確認待ち': '!', '人間判定待ち': '!', '完了': '✓' }[s.state] || ' '
  const hint = s.state === '未初期化' ? '  ← split.mjs / ledger sync が未実行'
             : s.state === '未着手'   ? '  ← 一度も分解していない'
             : s.state === '前後確認待ち' ? `  ← 前の分解と見比べていない単位 ${s.recutPending} 件（stale-diff で読み --ack が必要）`
             : s.state === '人間判定待ち' ? `  ← AI 判定のみ ${s.humanPending} 件（judge --human が必要）`
             : ''
  L.push(`   ${mark} ${s.edge.padEnd(14)} ${String(s.state).padEnd(5)} 要求 ${String(s.requirements).padStart(5)}  判定済 ${String(s.judged).padStart(5)}  未判定 ${String(s.unjudged).padStart(5)}  不一致等 ${String(s.problems).padStart(4)}${s.stale ? `  陳腐化 ${s.stale}` : ''}${s.humanJudged ? '  [人間判定を含む]' : ''}${hint}`)
})
L.push('')
if (adhoc.length) {
  const recent = adhoc.slice(-3)
  L.push(`  台帳を使わずに通した小修正: ${adhoc.length} 件`)
  recent.forEach(a => L.push(`     ${String(a.at || '').slice(0, 16).replace('T', ' ')}  ${String(a.why || '').slice(0, 60)}`))
  if (adhoc.length >= 5) L.push(`     ⚠ 続くようなら、それは小修正ではなく宣言されていない作業です。/wp start で作業単位を置いてください。`)
  L.push('')
}
if (review) {
  L.push('  レビューの分母（phase: review）')
  if (!review.units) {
    L.push(`   ! 未固定 ← node .claude/scripts/diff-units.mjs split`)
    L.push(`     **分母が無い状態の「指摘 0 件」は、問題が無いことではありません。**`)
  } else {
    L.push(`   ${review.unjudged ? ' ' : '✓'} hunk ${String(review.units).padStart(4)}  判定済 ${String(review.judged).padStart(4)}  未判定 ${String(review.unjudged).padStart(4)}  指摘 ${String(review.findings).padStart(3)}（base: ${review.base || '(作業ツリーのみ)'}）`)
  }
  L.push('')
}
if (verify) {
  L.push('  機械ゲート')
  verify.results.forEach(r => L.push(`   ${r.ok ? '✓' : '✗'} ${r.name.padEnd(12)}${r.skipped ? '（未定義）' : r.ok ? '' : `失敗 exit ${r.code}`}`))
  L.push('')
}
if (legacyData && (legacyData.legacy?.length || legacyData.missingIgnore?.length)) {
  // 2 種類の宿題を 1 行に混ぜない。旧構成 0 種でも .gitignore が不足していると
  // 「旧構成 0 種が残存」＋「新旧の規約が同時に読まれる状態です」と出て、
  // **自動注入されるテキストが事実でないことを言う**（F15 と同じ型）。
  if (legacyData.legacy?.length) {
    L.push(`  ⚠ 移行の宿題: 旧構成 ${legacyData.legacy.length} 種が残存`)
    L.push(`     新旧の規約が同時に読まれる状態です。ターンは止めませんが、どちらが正かを誰も確かめられません。`)
  }
  if (legacyData.missingIgnore?.length) {
    L.push(`  ⚠ .gitignore に不足 ${legacyData.missingIgnore.length} 件: ${legacyData.missingIgnore.join(' ')}`)
    L.push(`     state / settings.local.json がコミット対象に入ります（coverage の台帳は git で追いかける決まり）。`)
  }
  L.push(`     詳細: node .claude/scripts/check-legacy.mjs`)
  L.push('')
}

// 基準線として認めた負債を必ず出す。件数が見えないまま緑になると偽の緑になる。
const debt = debtSummary()
if (debt.broken) {
  L.push(`  ⚠ baseline.json が読めません（JSON として壊れています）。`)
  L.push(`     既存の負債が全件「新規」と判定され、機械ゲートが赤のままになります。`)
  L.push(`     直すか、削除して node .claude/scripts/baseline.mjs record を実行してください。`)
  L.push('')
}
if (debt.total > 0) {
  L.push(`  既知の負債（基準線 ${debt.recordedAt ? debt.recordedAt.slice(0, 10) : ''}）: 合計 ${debt.total} 件`)
  debt.rows.forEach(r => L.push(`     ${r.name.padEnd(10)} ${String(r.count).padStart(4)} 件  ← ゲートは「これより増えないこと」だけを見ています`))
  L.push('')
}
L.push(`  未解消ギャップ: ${gaps.open.length} 件${gaps.open.length ? `（${gaps.open.slice(0, 8).join(' ')}${gaps.open.length > 8 ? ' …' : ''}）` : ''}  解消済み ${gaps.resolved}`)
if (gaps.error) L.push(`  ⚠ ${gaps.error}`)
L.push('')
L.push(`  直近のコミット: ${recent[0] || '(なし)'}`)

if (unverified) {
  L.push('')
  L.push('  ⚠⚠ 前回のターンは未検証のまま終了しています。')
  L.push(`     ${unverified.reason}`)
  L.push(`     （${unverified.at}、ブロック ${unverified.count} 回）`)
  if (unverified.edited?.length) {
    L.push(`     未検証のまま残っている変更: ${unverified.edited.slice(0, 6).join(' ')}${unverified.edited.length > 6 ? ' …' : ''}`)
  }
  L.push('     続きの作業に入る前に、これを解消してください。')
}

// ── 宣言の記録 ────────────────────────────────────────────────────────
// ゲートを外す向きの宣言（既存テストの書き換え解禁・連続ブロック）は、
// 出しっぱなしにせず毎セッション頭で突きつける。記録が見られない記録は記録ではない。
{
  const jl = journalTail(200)
  const testDecl = jl.filter(e => e.kind === 'phase-test')
  const blocked = jl.filter(e => e.kind === 'stop-blocked')
  if (testDecl.length || blocked.length) {
    L.push('')
    if (testDecl.length) {
      L.push(`  既存テストの書き換えを解禁した宣言: ${testDecl.length} 件`)
      for (const e of testDecl.slice(-3)) L.push(`     ${String(e.at).slice(0, 19)}  ${String(e.why).slice(0, 70)}`)
    }
    if (blocked.length) {
      L.push(`  Stop hook が止めたターン: ${blocked.length} 件（直近 ${Math.min(3, blocked.length)} 件）`)
      for (const e of blocked.slice(-3)) L.push(`     ${String(e.at).slice(0, 19)}  ${String(e.first).slice(0, 70)}`)
    }
  }
}
const notReady = ledger.filter(s => s.state === '未初期化' || s.state === '未着手')
if (notReady.length) {
  L.push('')
  L.push(`  ⚠ 網羅台帳の ${notReady.length} 段がまだ動いていません（${notReady.map(s => s.edge).join(' ')}）。`)
  L.push('     「未判定 0」は完了を意味しません。/trace init から始めてください。')
}
if (verify && !verify.ok) {
  L.push('')
  L.push('  ⚠ 現時点で機械ゲートが赤です。新しい作業を積む前に緑にしてください。')
}

console.log(L.join('\n'))
