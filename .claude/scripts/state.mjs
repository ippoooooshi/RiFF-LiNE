#!/usr/bin/env node
// .claude/state/current.json を書く唯一の正規経路。
//
// なぜスクリプトを挟むか:
//   v22 は current.json をモデルが直接 Write していた。つまり「検査される側が
//   検査の条件を書ける」構造で、{"phase":"test"} と書けば既存テストの書き換えが
//   解禁され、{"phase":"foo"} と書けば台帳もゴールも全部外れた（実測）。
//   state/ を permissions.deny で塞ぎ、書き込みをここに一本化する。
//
//   ここは「意思」だけを受け取る。**事実（何を編集したか・検証が緑か）は
//   ゲートが git と実行結果から自分で観測する**ので、ここに書いても意味は無い。
//
// 使い方:
//   node .claude/scripts/state.mjs show
//   node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" --verify-by "<手段>"
//                                      [--edge "bd->dd"] [--file "<範囲>"] [--section "<節>"]
//                                      [--out-of-scope "<範囲外>"] [--prevent "<再発防止>"]
//   node .claude/scripts/state.mjs phase design|impl|review
//   node .claude/scripts/state.mjs phase test --why "<仕様がどう変わったか>"
//   node .claude/scripts/state.mjs adhoc "<何をなぜ台帳なしで直すか。触ったファイル名を含める>"
//   node .claude/scripts/state.mjs baseline "<コマンド>" "<着手前の値>"
//   node .claude/scripts/state.mjs clear
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, config, readState, writeState, clearState, stateDir, json } from './lib/config.mjs'

const cfg = config()
const argv = process.argv.slice(2)
const cmd = argv[0]
const PHASES = ['design', 'impl', 'test', 'review']

function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
function die(...lines) { lines.forEach(l => console.error(l)); process.exit(1) }
function journal(kind, data) {
  try {
    appendFileSync(join(stateDir(), 'journal.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n')
  } catch { /* 記録に失敗しても本処理は続ける */ }
}
// いま未コミットの変更は何か（adhoc の理由がそれに触れているかの照合に使う）
function dirty() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
  if (r.status !== 0 || r.error) return []
  const out = []
  const parts = String(r.stdout || '').split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (!e || e.length < 4) continue
    if (e[0] === 'R' || e[0] === 'C') { out.push(e.slice(3)); i++; continue }
    out.push(e.slice(3))
  }
  return out.filter(p => p && !p.startsWith('.claude/state/') && !p.startsWith('.claude/coverage/'))
}
function edgeIds() { return (cfg.edges || []).map(e => `${e.from}->${e.to}`) }

// ── show ────────────────────────────────────────────────────────────────
if (!cmd || cmd === 'show') {
  const c = readState('current.json')
  if (json) { console.log(JSON.stringify(c || {}, null, 2)); process.exit(0) }
  if (!c || !Object.keys(c).length) {
    console.log('現在の作業状態: 未設定')
    console.log('  作業を置く:  node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" --verify-by "<手段>"')
    process.exit(0)
  }
  console.log('現在の作業状態')
  for (const [k, v] of Object.entries(c)) {
    console.log(`  ${String(k).padEnd(12)} ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  }
  process.exit(0)
}

// ── goal ────────────────────────────────────────────────────────────────
// ゴールは 3 つ揃って初めてゴール。達成状態と検証手段が無いゴールは、
// 一番早く終わる基準に収束する。
else if (cmd === 'goal') {
  const unit = opt('unit'), goal = opt('goal'), verifyBy = opt('verify-by') || opt('verifyBy')
  const missing = [['unit', unit], ['goal', goal], ['--verify-by', verifyBy]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    die(`ゴールの要素が足りません（不足: ${missing.join(', ')}）。`,
        '  --unit       何の作業か（作業パッケージ／サブ機能名）',
        '  --goal       何が「在る」状態になれば完了か（作業の列挙ではなく達成状態）',
        '  --verify-by  それを誰が見ても同じ判定で確かめる手段（できればコマンド）')
  }
  if (String(goal).trim().length < 10) {
    die('--goal が短すぎます（10 文字以上）。',
        '  「何が在る状態になれば完了か」を書いてください。作業の名前ではありません。',
        '  悪い例: リンクを直す / 良い例: 相互参照が実在ファイル・実在節のみを指している')
  }
  if (String(verifyBy).trim().length < 6) {
    die('--verify-by が短すぎます（6 文字以上）。',
        '  誰が見ても同じ判定になる手段を書いてください。',
        '  悪い例: レビューで問題なければ / 良い例: node .claude/scripts/check-docs-links.mjs が 0 件')
  }

  const edge = opt('edge')
  if (edge && !edgeIds().includes(edge)) {
    die(`--edge ${JSON.stringify(edge)} は project.json の edges にありません。`,
        `  使えるのは: ${edgeIds().join(' / ')}`,
        '  シェルでは必ず引用符で囲んでください（裸の > はリダイレクトになります）。')
  }

  const c = readState('current.json') || {}
  delete c.why
  const next = {
    ...c,
    unit, goal, verifyBy,
    outOfScope: opt('out-of-scope') ? [opt('out-of-scope')] : (c.outOfScope || []),
    prevent: opt('prevent') || c.prevent || '',
    baseline: c.baseline || {},
    pendingHuman: c.pendingHuman || [],
  }
  if (edge) next.ledger = { edge, file: opt('file') || '', section: opt('section') || '' }
  const phase = opt('phase')
  if (phase) {
    if (!PHASES.includes(phase)) die(`--phase は ${PHASES.join(' / ')} のいずれかです。`)
    next.phase = phase
  }
  writeState('current.json', next)
  journal('goal', { unit, goal, verifyBy, edge: edge || null })
  console.log(`OK ゴールを置きました: ${unit}`)
  if (!edge && !c.ledger?.edge) {
    console.log('  ⚠ --edge を指定していません。docs/ やコードを編集するターンは、')
    console.log(`     担当する段の台帳が要ります: ${edgeIds().join(' / ')}`)
  }
  if (next.ledger?.edge) {
    console.log(`  次: node .claude/scripts/ledger.mjs pending ${JSON.stringify(next.ledger.edge)}${next.ledger.file ? ` --file ${JSON.stringify(next.ledger.file)}` : ''}`)
  }
}

// ── phase ───────────────────────────────────────────────────────────────
else if (cmd === 'phase') {
  const p = argv[1]
  if (!PHASES.includes(p)) {
    die(`phase は ${PHASES.join(' / ')} のいずれかです（指定: ${JSON.stringify(p ?? '')}）。`,
        '  未知の値を書くと、台帳もゴールも「作業ではない」と判定されて全部外れます。',
        '  台帳を使わない小修正は phase ではなく adhoc です:',
        '    node .claude/scripts/state.mjs adhoc "<理由>"')
  }
  const c = readState('current.json') || {}

  // test 宣言は「既存テストの書き換え」を解禁する。最も強い宣言なので理由を要求し、
  // 記録を残す。v22 は PreToolUse の拒否メッセージ自身がこの抜け道を教えていた。
  if (p === 'test') {
    const why = opt('why')
    if (!why || String(why).trim().length < 15) {
      die('phase test には --why が必須です（15 文字以上）。',
          '  これは**既存テストの書き換えを解禁する宣言**です。テストを通すために',
          '  テストを直すのを防ぐのが元々の目的なので、外すなら理由が要ります。',
          '  書くべきこと: 仕様がどう変わったか、その根拠がどの設計書の何節にあるか。',
          '  仕様が変わっていないなら、直すのはテストではなく実装です。',
          '    node .claude/scripts/state.mjs phase test --why "..."')
    }
    c.testWhy = String(why).trim()
    journal('phase-test', { why: c.testWhy })
    console.log('OK phase=test（既存テストの書き換えを解禁しました）')
    console.log('  この宣言は journal.jsonl に記録され、セッション冒頭に出ます。')
  } else {
    delete c.testWhy
    journal('phase', { phase: p })
    console.log(`OK phase=${p}`)
  }
  c.phase = p
  delete c.why
  writeState('current.json', c)
}

// ── adhoc ───────────────────────────────────────────────────────────────
// 小さな修正のたびに台帳を要求すると、既存の負債で全ターンが止まる道になる。
// かといって黙って素通りさせると、塞いだ穴がそのまま残る。
// 中間を取る: 宣言すれば通るが、理由が要り、記録が残り、1 ターンで失効する。
else if (cmd === 'adhoc') {
  const why = String(argv.slice(1).filter(a => !a.startsWith('--')).join(' ') || '').trim()
  if (why.length < 12) {
    die('adhoc には理由が要ります（12 文字以上）。',
        '  node .claude/scripts/state.mjs adhoc "<何をなぜ台帳なしで直すか。触ったファイル名を含める>"',
        '  どの修正にも貼れる文は弾かれます。')
  }
  const files = dirty()
  const names = files.map(f => f.split('/').pop().replace(/\.[^.]*$/, '').toLowerCase()).filter(n => n.length >= 3)
  if (names.length && !names.some(n => why.toLowerCase().includes(n))) {
    die('理由が、いま変更されているファイルに触れていません。',
        `  変更されているファイル: ${files.slice(0, 8).join(' ')}`,
        `  次のどれかを理由に含めてください: ${[...new Set(names)].slice(0, 6).join(' ')}`,
        '  **逃げ道を塞いでいるのではなく、黙って通る道を塞いでいます。**')
  }

  // 連続使用の抑制。「小修正」を連打して作業パッケージ 1 つ分を通せてしまうと、
  // adhoc は逃げ道ではなく既定の経路になる。
  const prev = readState('adhoc.json', { entries: [] })
  const since = Date.now() - 6 * 60 * 60 * 1000
  const recent = (prev.entries || []).filter(e => Date.parse(e.at) > since)
  if (recent.length >= 3) {
    const c0 = readState('current.json') || {}
    if (!c0.unit || !c0.goal) {
      die(`直近 6 時間で adhoc を ${recent.length} 回使っています。`,
          '  それはもう「小修正」ではなく、宣言されていない作業です。',
          '  先にゴールを置いてください:',
          '    node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" --verify-by "<手段>"',
          '  直近の宣言:',
          ...recent.slice(-3).map(e => `    ${String(e.at).slice(0, 19)}  ${e.why}`))
    }
  }

  const c = readState('current.json') || {}
  c.phase = 'adhoc'; c.why = why
  writeState('current.json', c)
  prev.entries = [...(prev.entries || []), { at: new Date().toISOString(), why, edited: files.slice(0, 20) }].slice(-200)
  writeState('adhoc.json', prev)
  journal('adhoc', { why, edited: files.slice(0, 10) })
  console.log('OK adhoc を宣言しました（1 ターンで失効します）')
  console.log('  検証（typecheck / lint / test）と同型走査は免除されません。')
}

// ── baseline ────────────────────────────────────────────────────────────
else if (cmd === 'baseline') {
  const key = argv[1], val = argv[2]
  if (!key || val == null) die('使い方: state.mjs baseline "<コマンド>" "<着手前の値>"')
  const c = readState('current.json') || {}
  c.baseline = { ...(c.baseline || {}), [key]: String(val) }
  writeState('current.json', c)
  console.log(`OK 着手前の値を記録しました: ${key} = ${val}`)
}

// ── clear ───────────────────────────────────────────────────────────────
else if (cmd === 'clear') {
  const c = readState('current.json')
  journal('clear', { unit: c?.unit || null })
  clearState('current.json')
  console.log('OK 作業状態をクリアしました')
}

else {
  die(`未知のコマンド: ${cmd}`,
      '  使えるのは: show / goal / phase / adhoc / baseline / clear')
}
