#!/usr/bin/env node
// 作業パッケージの台帳。**どのパッケージが在るか**と**着手してよいか**を機械が持つ。
//
// なぜこれがあるか:
//   `/wp start <パッケージ名>` は「既に在るパッケージを始める」前提で書かれていたが、
//   そのパッケージ一覧はどこにも機械可読な形で存在しなかった。実測で確認した穴が 3 つ:
//
//     1. パッケージの一覧が無い。名前は会話と `project.json` の phases の散文の中だけ
//     2. `/wp start` の手順 2「実施順序上の前提パッケージが未完なら報告して止まる」は
//        **どのスクリプトも実装していない**。前提も完了状態も機械が持っていないので判定できない
//     3. `/gap` は「担当作業単位」を必須にしているが、そこに書いた名前が**実在するか誰も確かめない**。
//        存在しないパッケージへ繰り越すと、無期限の持ち越しと同じになる（F4 が狙って防いだもの）
//
//   さらに `/feature` で要件を足したあと、**それをどのパッケージが担当するか**を
//   決める場所が無かった。要件は増えるが、担当が決まらないまま宙に浮く。
//
//   置き場所はギャップ台帳と同じ形にする——`docs/` のマークダウン表を config が指す。
//   計画は人が読むものなので docs に置き、機械はそれを解析する。
//
// 使い方:
//   node .claude/scripts/wp.mjs list [--json]
//   node .claude/scripts/wp.mjs add <ID> --name "<名前>" --after "<前提ID...>" --scope "<glob>" --done "<完了条件>"
//   node .claude/scripts/wp.mjs start <ID>      # 前提が未完なら拒否し、current.json の骨格を書く
//   node .claude/scripts/wp.mjs check [--json]  # 前提の実在・循環・担当の実在
//   node .claude/scripts/wp.mjs suggest [--apply]   # 残作業から候補を機械が束ねる
//   node .claude/scripts/wp.mjs init            # 表の節をまだ作っていないとき
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config, read, writeState, readState, matchesAny, allFiles, json } from './lib/config.mjs'
import { loadEdge, edgeId } from './ledger.mjs'

const cfg = config()
// file が空なら未設定として扱う（設定していないプロジェクトを初日から赤にしない＝F23）。
// 逆に file を書いたのに実ファイルが無いのは**設定の誤り**なので赤にする——
// パスの打ち間違いが静かに通ると、台帳が空のまま「不整合 0 件」になる。
const WL = cfg.wpLedger?.file ? cfg.wpLedger : null
const STATES = ['未着手', '進行中', '完了', '中止']

function ledgerPath() { return WL?.file ? join(ROOT, WL.file) : null }

// 表を読む。列は ID / 名前 / 前提 / 範囲 / 完了条件 / 状態。
export function parseRows(src, prefix) {
  const rows = []
  for (const line of String(src || '').split('\n')) {
    const t = line.trim()
    if (!new RegExp(`^\\|\\s*${prefix}[-\\d]`).test(t)) continue
    const cells = t.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.length < 6) continue
    rows.push({
      id: cells[0], name: cells[1],
      after: cells[2].split(/[\s,、]+/).filter(x => x && x !== '-' && x !== '—'),
      scope: cells[3] === '-' ? '' : cells[3],
      done: cells[4], state: cells[5], raw: t,
    })
  }
  return rows
}

function load() {
  const p = ledgerPath()
  if (!WL) return { configured: false, rows: [] }
  if (!p || !existsSync(p)) return { configured: true, missing: true, rows: [] }
  return { configured: true, rows: parseRows(readFileSync(p, 'utf8'), WL.prefix || 'WP') }
}

// 前提の実在・循環・担当の実在。**参照が壊れた計画は計画ではない。**
export function audit(rows, gapRows) {
  const ids = new Set(rows.map(r => r.id))
  const findings = []
  for (const r of rows) {
    for (const a of r.after) {
      if (!ids.has(a)) findings.push({ kind: 'missing-prereq', id: r.id, ref: a,
        why: `前提に書かれた ${a} が台帳に無い。実在しない前提は「順序を決めた」ことにならない` })
    }
    if (!STATES.includes(r.state)) findings.push({ kind: 'unknown-state', id: r.id, ref: r.state,
      why: `状態が既知の 4 つ（${STATES.join(' / ')}）のどれでもない` })
    if (!r.done || r.done === '-') findings.push({ kind: 'no-done', id: r.id,
      why: '完了条件が空。誰が見ても同じ判定にならないパッケージは、一番早く終わる基準に収束する' })
  }
  // 循環（A の前提が B、B の前提が A）
  const seen = new Map()
  const walk = (id, path) => {
    if (path.includes(id)) { findings.push({ kind: 'cycle', id, ref: path.concat(id).join(' → '),
      why: '前提が循環している。どちらも永遠に着手できない' }); return }
    if (seen.has(id)) return
    seen.set(id, true)
    const r = rows.find(x => x.id === id)
    if (r) r.after.forEach(a => walk(a, path.concat(id)))
  }
  rows.forEach(r => walk(r.id, []))
  // ギャップの担当が実在するか
  for (const g of gapRows || []) {
    if (g.owner && !ids.has(g.owner)) findings.push({ kind: 'dangling-owner', id: g.id, ref: g.owner,
      why: `担当作業単位 ${g.owner} が台帳に無い。実在しない担当への繰り越しは、無期限の持ち越しと同じ` })
  }
  return findings
}

function gapOwners() {
  const gl = cfg.gapLedger
  if (!gl?.file) return []
  const src = read(gl.file)
  if (src == null) return []
  const out = []
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!new RegExp(`^\\|\\s*${gl.prefix}\\d+`).test(t)) continue
    if (gl.resolvedMarker && t.includes(gl.resolvedMarker)) continue
    const cells = t.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    const id = (t.match(new RegExp(`${gl.prefix}\\d+`)) || [])[0]
    // 担当作業単位の列は「WP」で始まるセルとして拾う（列位置に依存しない）
    const owner = cells.find(c => new RegExp(`^${WL?.prefix || 'WP'}[-\\d]`).test(c))
    if (id) out.push({ id, owner: owner || null })
  }
  return out
}

const [, , cmd, ...rest] = process.argv
const args = rest.filter(a => !a.startsWith('--'))
const opt = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null }

// 設定していないプロジェクトを毎ターン赤にはしない（check / list は緑のまま通す）。
// ただし **start / add は非 0 で落とす。**
// v22 は未設定のとき全コマンドが exit 0 の no-op だったので、`wp.mjs start WP1` が
// 何もせずに成功し、「前提が未完なら機械が拒否する」（wp.md / HOWTO.md / gap.md）は
// 現設定では全部嘘になっていた。**何も起きないことを成功と呼ばない。**
if (!WL) {
  const msg = `作業パッケージ台帳は未設定です（project.json の wpLedger）。\n` +
    `  有効にすると、パッケージの一覧・前提・完了条件を機械が持ち、\n` +
    `  「前提が未完なら着手させない」「実在しない担当へ繰り越させない」が効きます。\n` +
    `    "wpLedger": { "file": "docs/basic_design/15_development_process.md", "section": "2", "prefix": "WP" }\n` +
    `  書いたあと:  node .claude/scripts/wp.mjs init`
  const MUTATING = ['start', 'add', 'done', 'set', 'init']
  if (MUTATING.includes(cmd)) {
    console.error(`${cmd} は実行できません。${msg}`)
    console.error(`  **未設定のまま「${cmd} しました」と報告しないでください。**台帳が無いので何も記録されません。`)
    process.exit(1)
  }
  if (json) console.log(JSON.stringify({ configured: false, rows: [], findings: [] }, null, 2))
  else console.log(msg)
  process.exit(0)
}

if (cmd === 'init') {
  const p = ledgerPath()
  if (!p || !existsSync(p)) { console.error(`${WL.file} が見つかりません。先にそのファイルを作ってください。`); process.exit(1) }
  const src = readFileSync(p, 'utf8')
  if (parseRows(src, WL.prefix || 'WP').length) { console.log('既に表があります。init は何も書きません。'); process.exit(0) }
  const block = `\n## ${WL.section || '2'} 作業パッケージ\n\n` +
    `> この表が作業パッケージの正。\`node .claude/scripts/wp.mjs\` が読み書きする。\n` +
    `> 前提・完了条件が空の行は \`wp.mjs check\` が赤にする。\n\n` +
    `| ID | 名前 | 前提 | 範囲 | 完了条件 | 状態 |\n|---|---|---|---|---|---|\n`
  writeFileSync(p, src.trimEnd() + '\n' + block)
  console.log(`${WL.file} に作業パッケージの表を作りました。`)
  console.log(`  追加: node .claude/scripts/wp.mjs add WP1 --name "<名前>" --done "<完了条件>"`)
}

// 残っている作業から**候補を機械が束ねる**。
//
// `add` は「あなたが計画を既に持っている」前提の道具で、それだけでは足りない。
// 何が残っているか分からなければ、どんなパッケージを起こすべきかも決められない。
// 台帳は「どのファイルの何件が未処理か」を既に持っているので、そこから束ねる。
//
// **章（ファイル）を境界にする。** 設計書の 1 章はもともと 1 まとまりの関心事として
// 書かれているので、そこで切ると前提関係も素直になる（上位の同じ章が先）。
// 完了条件は機械が検証できる形で埋めるが、**それは必要条件でしかない**——
// 「台帳が 0 件」は「動く」ではない。実機確認は人が足す。
function suggestions() {
  const edges = cfg.edges || []
  const out = []
  const titleOf = f => {
    const src = read(f)
    const h = (src || '').split('\n').find(l => /^#\s+/.test(l))
    return h ? h.replace(/^#\s+/, '').trim() : f.split('/').pop().replace(/\.[^.]*$/, '')
  }
  for (const e of edges) {
    let m
    try { m = loadEdge(edgeId(e)) } catch { continue }
    const byFile = {}
    for (const r of m.values()) {
      const b = byFile[r.file] ??= { units: 0, undecomposed: 0, reqs: 0, unjudged: 0 }
      b.units++
      if (!Array.isArray(r.reqs)) b.undecomposed++
      else { b.reqs += r.reqs.length; b.unjudged += r.reqs.filter(q => !q.verdict).length }
    }
    for (const [file, b] of Object.entries(byFile)) {
      const remaining = b.undecomposed + b.unjudged
      if (!remaining) continue
      out.push({ edge: edgeId(e), from: e.from, to: e.to, file, title: titleOf(file),
                 units: b.units, undecomposed: b.undecomposed, unjudged: b.unjudged, remaining })
    }
  }
  // 上位の段を先に。同じ章なら上位が前提になる。
  const order = new Map(edges.map((e, i) => [edgeId(e), i]))
  out.sort((a, b) => (order.get(a.edge) - order.get(b.edge)) || a.file.localeCompare(b.file))
  return out
}

if (cmd === 'suggest') {
  const st = load()
  if (st.missing) { console.error(`${WL.file} が見つかりません。先に wp.mjs init を実行してください。`); process.exit(1) }
  const cands = suggestions()
  const taken = new Set(st.rows.map(r => r.id))
  const prefix = WL.prefix || 'WP'
  let next = Math.max(0, ...st.rows.map(r => Number(String(r.id).replace(/\D/g, '')) || 0))
  const keyOf = c => `${c.file}` // 同じ章は同じ束

  // 既に台帳にある範囲は候補から外す（同じ仕事を二重に起こさない）
  const covered = st.rows.filter(r => r.scope).map(r => r.scope)
  const rows = []
  const idByKey = new Map()
  for (const c of cands) {
    if (covered.some(sc => matchesAny(c.file, [sc]))) continue
    let id
    do { id = `${prefix}${++next}` } while (taken.has(id))
    taken.add(id)
    // 同じ章の上位の段が候補に在るなら、それが前提
    const upstream = rows.find(r => r.file === c.file)
    rows.push({ id, after: upstream ? [upstream.id] : [], ...c,
      name: `${c.title}（${c.from}→${c.to}）`,
      done: `ledger.mjs pending "${c.edge}" --file "${c.file.split('/').pop()}" が未分解 0・未判定 0`,
    })
    idByKey.set(keyOf(c), id)
  }

  // 担当の無いギャップ
  const orphanGaps = gapOwners().filter(g => !g.owner)

  if (json) { console.log(JSON.stringify({ candidates: rows, orphanGaps }, null, 2)); process.exit(0) }

  if (!cands.length) {
    console.log('台帳に未処理の作業がありません。')
    console.log('  ただし **「残作業が無い」と「台帳がまだ動いていない」は別です。**')
    console.log('  各段の状態を確認してください: node .claude/scripts/ledger.mjs stats')
    process.exit(0)
  }
  if (!rows.length) {
    console.log(`残作業 ${cands.length} 束はすべて既存パッケージの範囲に入っています。`)
    console.log('  node .claude/scripts/wp.mjs list')
    process.exit(0)
  }

  console.log(`残っている作業から ${rows.length} 件の候補を束ねました（章＝ファイル単位）。\n`)
  for (const r of rows) {
    console.log(`${r.id}  ${r.name}`)
    console.log(`   残り ${r.remaining} 件（未分解 ${r.undecomposed} / 未判定 ${r.unjudged}・単位 ${r.units}）  ${r.file}`)
    if (r.after.length) console.log(`   前提 ${r.after.join(' ')}（同じ章の上位の段）`)
  }
  if (orphanGaps.length) {
    console.log(`\n担当が書かれていないギャップ ${orphanGaps.length} 件: ${orphanGaps.map(g => g.id).join(' ')}`)
    console.log(`   上の候補のどれかを担当にするか、専用のパッケージを起こしてください。`)
  }
  console.log(`\nそのまま台帳へ書くなら:  node .claude/scripts/wp.mjs suggest --apply`)
  console.log(`\n**完了条件は機械が検証できる形しか埋めていません。**`)
  console.log(`「台帳が 0 件」は「動く」ことではないので、実機で何を確かめれば完了かを各行に足してください。`)
  console.log(`名前・粒度・順序も候補です。章より小さく切りたいなら、行を分けて範囲を絞ってください。`)

  if (rest.includes('--apply')) {
    const p = ledgerPath()
    const lines = readFileSync(p, 'utf8').split('\n')
    let at = -1
    lines.forEach((l, i) => { if (new RegExp(`^\\|\\s*${prefix}[-\\d]`).test(l.trim())) at = i })
    if (at < 0) at = lines.findIndex(l => /^\|\s*-+\s*\|/.test(l.trim()))
    if (at < 0) { console.error('\n表が見つかりません。wp.mjs init を実行してください。'); process.exit(1) }
    const added = rows.map(r =>
      `| ${r.id} | ${r.name} | ${r.after.length ? r.after.join(' ') : '-'} | ${r.file} | ${r.done}（＋実機確認の条件を足すこと） | 未着手 |`)
    lines.splice(at + 1, 0, ...added)
    writeFileSync(p, lines.join('\n'))
    console.log(`\n${WL.file} に ${added.length} 行を追加しました。**完了条件はまだ機械の分だけです。**`)
  }
}

else if (cmd === 'add') {
  const id = args[0]
  const name = opt('name'), done = opt('done')
  const after = (opt('after') || '').split(/[\s,、]+/).filter(Boolean)
  const scope = opt('scope') || ''
  if (!id || !name || !done) {
    console.error('使い方: wp.mjs add <ID> --name "<名前>" --done "<完了条件>" [--after "<前提ID...>"] [--scope "<glob>"]')
    console.error('  **完了条件が書けないパッケージは、切り方が悪い。** 分割するか、検証可能な代理指標を決めてから追加してください。')
    process.exit(2)
  }
  const st = load()
  if (st.missing) { console.error(`${WL.file} が見つかりません。先に wp.mjs init を実行してください。`); process.exit(1) }
  if (st.rows.some(r => r.id === id)) { console.error(`${id} は既にあります。`); process.exit(1) }
  const ids = new Set(st.rows.map(r => r.id))
  const bad = after.filter(a => !ids.has(a))
  if (bad.length) {
    console.error(`前提に書いた ${bad.join(' ')} が台帳にありません。`)
    console.error(`  実在しない前提は「順序を決めた」ことになりません。先にそちらを追加してください。`)
    process.exit(1)
  }
  if (scope) {
    const hit = allFiles().some(f => matchesAny(f, [scope]))
    if (!hit) {
      console.error(`範囲 "${scope}" が実ファイルに 1 つも当たりません。`)
      console.error(`  空振りする範囲は、あとで「単位 0」を「漏れなし」と読む事故になります。`)
      process.exit(1)
    }
  }
  const p = ledgerPath()
  const src = readFileSync(p, 'utf8')
  const lines = src.split('\n')
  // 表の最後の行の直後に足す
  let at = -1
  lines.forEach((l, i) => { if (new RegExp(`^\\|\\s*${WL.prefix || 'WP'}[-\\d]`).test(l.trim())) at = i })
  if (at < 0) {
    at = lines.findIndex(l => /^\|\s*-+\s*\|/.test(l.trim()))
    if (at < 0) { console.error('表が見つかりません。wp.mjs init を実行してください。'); process.exit(1) }
  }
  const row = `| ${id} | ${name} | ${after.length ? after.join(' ') : '-'} | ${scope || '-'} | ${done} | 未着手 |`
  lines.splice(at + 1, 0, row)
  writeFileSync(p, lines.join('\n'))
  console.log(`${WL.file} に追加しました:\n  ${row}\n`)
  console.log(`着手するとき: node .claude/scripts/wp.mjs start ${id}`)
  if (after.length) console.log(`  前提 ${after.join(' ')} が完了していないと start は拒否されます。`)
}

else if (cmd === 'start') {
  const id = args[0]
  const st = load()
  const r = st.rows.find(x => x.id === id)
  if (!r) {
    console.error(`${id} が作業パッケージ台帳にありません。`)
    console.error(`  在るもの: ${st.rows.map(x => x.id).join(' ') || '(なし)'}`)
    console.error(`  新しく起こすなら: node .claude/scripts/wp.mjs add ${id || '<ID>'} --name "<名前>" --done "<完了条件>"`)
    process.exit(1)
  }
  const notDone = r.after.filter(a => (st.rows.find(x => x.id === a)?.state) !== '完了')
  if (notDone.length) {
    console.error(`前提が完了していません: ${notDone.map(a => `${a}（${st.rows.find(x => x.id === a)?.state || '不明'}）`).join(' / ')}`)
    console.error(`  実施順序を飛ばすと、あとから前提側の設計が変わって作り直しになります。`)
    console.error(`  順序そのものが誤っているなら、台帳の前提列を直してから着手してください（**黙って飛ばさない**）。`)
    process.exit(1)
  }
  const cur = readState('current.json') || {}
  writeState('current.json', {
    ...cur, unit: `${r.id} ${r.name}`, wp: r.id,
    goal: cur.goal || '', verifyBy: cur.verifyBy || r.done, outOfScope: cur.outOfScope || [],
    prevent: cur.prevent || '', baseline: cur.baseline || {}, pendingHuman: cur.pendingHuman || [],
  })
  console.log(`${r.id} ${r.name} に着手しました。`)
  console.log(`  完了条件（台帳）: ${r.done}`)
  if (r.scope) console.log(`  範囲: ${r.scope}`)
  console.log(`\n**まだ goal と verifyBy が空です。** 5 要素が揃って初めてゴールです。`)
  console.log(`  達成状態 / 検証手段 / 範囲外 / 再発防止 を current.json に書いてから着手してください。`)
  console.log(`  そのあと担当段の台帳: { "phase": "design", "ledger": { "edge": "bd->dd", "file": "<範囲>" } }`)
}

else if (cmd === 'check') {
  const st = load()
  if (st.missing) {
    if (json) console.log(JSON.stringify({ configured: true, missing: true, findings: [] }, null, 2))
    else console.log(`${WL.file} が見つかりません（wpLedger が指す先）。`)
    process.exit(1)
  }
  const findings = audit(st.rows, gapOwners())
  if (json) console.log(JSON.stringify({ rows: st.rows.length, findings }, null, 2))
  else {
    findings.forEach(f => console.log(`✗ ${f.id}  [${f.kind}]${f.ref ? `  ${f.ref}` : ''}\n    ${f.why}`))
    console.log(`\nwp check: ${st.rows.length} パッケージ / 不整合 ${findings.length} 件`)
    if (!st.rows.length) console.log(`  ⚠ 1 件も読めていません。**「パッケージが無い」と「表の書式が違う」は別です。**\n     列は ID / 名前 / 前提 / 範囲 / 完了条件 / 状態。まだ作っていないなら wp.mjs init。`)
  }
  process.exit(findings.length ? 1 : 0)
}

else {
  // list
  const st = load()
  if (st.missing) { console.log(`${WL.file} が見つかりません（wpLedger が指す先）。`); process.exit(1) }
  if (json) { console.log(JSON.stringify({ rows: st.rows }, null, 2)); process.exit(0) }
  if (!st.rows.length) {
    console.log('作業パッケージが 1 件も読めていません。')
    console.log(`  ${WL.file} の表を確認してください（列: ID / 名前 / 前提 / 範囲 / 完了条件 / 状態）。`)
    console.log(`  まだ作っていないなら: node .claude/scripts/wp.mjs init`)
    process.exit(1)
  }
  const ids = new Set(st.rows.map(r => r.id))
  for (const r of st.rows) {
    const blocked = r.after.filter(a => (st.rows.find(x => x.id === a)?.state) !== '完了')
    const mark = r.state === '完了' ? '✓' : blocked.length ? '·' : r.state === '進行中' ? '>' : ' '
    console.log(`${mark} ${r.id.padEnd(8)} ${String(r.state).padEnd(4)} ${r.name}` +
      (r.after.length ? `\n      前提 ${r.after.map(a => ids.has(a) ? a : `${a}(不明)`).join(' ')}${blocked.length ? ` ← ${blocked.join(' ')} が未完のため着手できません` : ''}` : '') +
      `\n      完了条件 ${r.done}`)
  }
  const ready = st.rows.filter(r => r.state === '未着手' && !r.after.some(a => (st.rows.find(x => x.id === a)?.state) !== '完了'))
  console.log(`\n着手できるもの: ${ready.map(r => r.id).join(' ') || '(なし)'}`)
}
