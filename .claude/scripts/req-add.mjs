#!/usr/bin/env node
// 機能追加要望を、**設計可能なところまで絞り切ってから**要件に書き込む。
//
// なぜこれがあるか:
//   「この機能も欲しかった」は開発中に最も頻度の高い要望の形で、そのまま要件に
//   書き込むと曖昧なまま V 字の最上位に入る。要件の曖昧さは下位の全段へ伝播し、
//   実装まで降りてから「これどっちの意味？」になる——そこで直すと設計も実装も
//   テストもやり直しになる。
//
//   「よく質問してから書く」は規約にすると必ず形骸化する（F53 と同じ形）。
//   そこで、**未確定点が 1 つでも残っている限り書き込めない**ようにする。
//   質問は機械が本文から生成するので、「何を聞くべきか」を AI に当てさせない。
//
// 検出するのは4種類だけ。どれも機械的に判定できるものに限る。
//   未閉鎖の列挙  … 「等」「など」「その他」— 列挙が閉じていない＝中身が未定義
//   未定義の程度  … 「適切に」「高速に」「十分な」「必要に応じて」— 判定条件が無い
//   数値のない閾値… 「上限」「以内」「まで」があるのに数値が無い
//   受入条件が無い… 「〜できる」だけで、何をもって満たしたと見なすかが書かれていない
//
// 使い方:
//   node .claude/scripts/req-add.mjs check "<要件文>"        # 未確定点と質問を出す
//   node .claude/scripts/req-add.mjs open "<要望>"           # 下書きを開く（質問の記録が始まる）
//   node .claude/scripts/req-add.mjs answer "<聞いたこと>" "<返ってきた答え>"
//   node .claude/scripts/req-add.mjs commit "<ID>" "<確定した要件文>" [--section "4.1"]
//   node .claude/scripts/req-add.mjs row "<項目>" "<確定した要件文>" --section "5.6" [--after "<前の行の項目>"] --history "<変更内容>" [--before "<変更前>"]
//       … 節の中の**既存の表**に、その表と同じ列の数で行を足す（v31）。2 列の表なら「| 項目 | 文 |」
//   node .claude/scripts/req-add.mjs amend "<既存の箇条・行の頭の逐語>" "<足す文>" --section "4.2" --history "<変更内容>" [--before "<変更前>"]
//       … 節の中で**1 つだけ**当たる箇条（または表の行の最後のセル）の末尾に文を足す（v31）
//   node .claude/scripts/req-add.mjs replace "<今の文の逐語>" "<書き換えた後の文>" --section "4.6" --history "<変更内容>"
//       … 節の中で**1 か所だけ**当たる逐語を書き換える（v33）。変更前の欄には今の文がそのまま入る
//   row / amend / replace は、要件定義書の「変更履歴」の表（見出し行が「| # | 変更内容 | 変更前 | 変更後 |」）に 1 行を自動で足す
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config, readState, writeState, json } from './lib/config.mjs'
import { inspect } from './lib/wording.mjs'

const STATE = 'req-draft.json'

// ── 設計可能性の検査 ──────────────────────────────────────────────────
// **語彙と質問文は `lib/wording.mjs` に置いてある。** ここで別に定義しない——
// 同じ「列挙が閉じていない」を split.mjs と別々の定義で見ていて、
// 同じ語を数えているつもりで違う数を出していた（2026-09-16 に統合）。
export { inspect } from './lib/wording.mjs'

const [, , cmd, ...rest] = process.argv
const args = rest.filter(a => !a.startsWith('--'))

if (cmd === 'check') {
  const found = inspect(args[0] || '')
  if (json) console.log(JSON.stringify({ text: args[0], open: found.length, findings: found }, null, 2))
  else if (!found.length) console.log('設計可能性の検査: 未確定点はありません。commit できます。')
  else {
    found.forEach(f => console.log(`✗ ${f.kind}${f.hits.length ? `  「${f.hits.join('」「')}」` : ''}\n    ${f.why}\n    聞くこと: ${f.ask}`))
    console.log(`\n未確定点 ${found.length} 件。**推測で埋めないこと。** 本人に聞いてから確定した文で書き直してください。`)
  }
  process.exit(found.length ? 1 : 0)
}

else if (cmd === 'open') {
  const want = args[0]
  if (!want) { console.error('要望を渡してください: req-add.mjs open "<やりたいこと>"'); process.exit(2) }
  const found = inspect(want)
  writeState(STATE, { want, at: new Date().toISOString(), asked: [], findings: found })
  console.log(`下書きを開きました: ${want}`)
  if (found.length) {
    console.log(`\n先に決めることが ${found.length} 件あります。**1 つずつ本人に聞いてください。**`)
    found.forEach((f, i) => console.log(`  ${i + 1}. [${f.kind}] ${f.ask}`))
    console.log(`\n聞いて答えが返ったら記録します:`)
    console.log(`  node .claude/scripts/req-add.mjs answer "<聞いたこと>" "<返ってきた答え>"`)
  } else {
    console.log('  この文面には機械的に検出できる未確定点はありません。')
    console.log('  ただし**それは「設計できる」の保証ではありません。** 既存要件との矛盾は /audit design で見ます。')
  }
}

else if (cmd === 'answer') {
  const [q, a] = args
  if (!q || !a) { console.error('使い方: req-add.mjs answer "<聞いたこと>" "<返ってきた答え>"'); process.exit(2) }
  const s = readState(STATE, null)
  if (!s) { console.error('下書きがありません。先に open してください。'); process.exit(1) }
  s.asked = [...(s.asked || []), { q, a, at: new Date().toISOString() }]
  writeState(STATE, s)
  console.log(`記録しました（${s.asked.length} 件目）。残りの未確定点があれば続けて聞いてください。`)
}

else if (cmd === 'commit') {
  const [id, text] = args
  if (!id || !text) {
    console.error('使い方: req-add.mjs commit "<ID>" "<確定した要件文>" [--section "4.1"]')
    process.exit(2)
  }
  const found = inspect(text)
  if (found.length) {
    console.error(`まだ設計可能な文になっていません（未確定点 ${found.length} 件）。`)
    found.forEach(f => console.error(`  ✗ ${f.kind}${f.hits.length ? `  「${f.hits.join('」「')}」` : ''}\n      ${f.ask}`))
    console.error(`\n**推測で埋めないこと。** 本人に聞いて、答えを req-add.mjs answer で記録してから書き直してください。`)
    process.exit(1)
  }
  const s = readState(STATE, null)
  if (!s) { console.error('下書きがありません。先に open してください（質問の記録が要ります）。'); process.exit(1) }
  // 元の要望に未確定点があったなら、その数だけは聞いていること。
  // 「検出 0 件の文を最初から書く」経路は open で通っているので、ここは
  // **曖昧な要望を黙って自分で解釈した**場合だけを止める。
  const needed = (s.findings || []).length
  if ((s.asked || []).length < needed) {
    console.error(`最初の要望には未確定点が ${needed} 件ありましたが、記録された質問は ${(s.asked || []).length} 件です。`)
    console.error(`  差分はあなたが推測で埋めた分です。要件の推測は下位の全段へ伝播します。`)
    console.error(`  聞いてから: node .claude/scripts/req-add.mjs answer "<聞いたこと>" "<答え>"`)
    process.exit(1)
  }

  const cfg = config()
  const reqPath = cfg.paths?.requirements
  if (!reqPath) { console.error('project.json の paths.requirements が設定されていません。'); process.exit(2) }
  const abs = join(ROOT, reqPath)
  if (!existsSync(abs)) { console.error(`要件定義書が見つかりません: ${reqPath}`); process.exit(2) }

  const secIdx = rest.indexOf('--section')
  const section = secIdx >= 0 ? rest[secIdx + 1] : null
  const src = readFileSync(abs, 'utf8')
  if (src.includes(`| ${id} |`) || new RegExp(`^#+\\s*${id}\\b`, 'm').test(src)) {
    console.error(`${id} は既に要件定義書にあります。別の ID を使うか、既存を更新してください。`); process.exit(1)
  }

  const lines = src.split('\n')
  let at = lines.length
  if (section) {
    const h = lines.findIndex(l => new RegExp(`^#+\\s*${section.replace('.', '\\.')}\\b`).test(l))
    if (h < 0) { console.error(`節 ${section} が見つかりません。`); process.exit(1) }
    let i = h + 1
    while (i < lines.length && !/^#+\s/.test(lines[i])) i++
    while (i > h && !lines[i - 1].trim()) i--
    at = i
  }
  const row = `| ${id} | ${text} | 追加（${new Date().toISOString().slice(0, 10)}） |`
  lines.splice(at, 0, row)
  writeFileSync(abs, lines.join('\n'))

  s.committed = { id, text, section, at: new Date().toISOString() }
  writeState(STATE, s)
  console.log(`${reqPath} に追記しました:\n  ${row}\n`)
  console.log(`**まだ終わりではありません。** 足した要求はいまどの台帳にも載っていません。`)
  console.log(`  node .claude/scripts/split.mjs ${(cfg.tiers || [])[0]?.id || 'req'}`)
  ;(cfg.edges || []).filter(e => e.from === ((cfg.tiers || [])[0]?.id || 'req'))
    .forEach(e => console.log(`  node .claude/scripts/ledger.mjs sync "${e.from}->${e.to}"`))
  console.log(`  そのあと各段へ降ろす。**横（テスト）の段も edges にあります。**`)
}

// ── 既存の表・箇条へ書く（v31）────────────────────────────────────────
// 実測（2026-09-26、turn 72）: 「手戻りは要件から直す」と本人が決めたが、commit は
// 「| ID | 文 | 追加 |」の 3 列の行を節の末尾に入れる作りで、要件定義書の 5.6 節の
// 「| 項目 | 内容 |」の 2 列の表にも、4.2 節の箇条にも合わなかった。**合わない道具は、
// 手で書く（＝質問の記録と曖昧さの検査を飛ばす）方向へ押し出す。**
// そこで、既存の形に合わせて書く入口を足す。検査（未確定点 0・質問の記録）は commit と同じ。
// ── 書き換える（v33 T16）───────────────────────────────────────────────
// 実測（2026-09-26、turn 77）: 要件 4.6 の画面 11 の行（「エクスポートでPDFを選んだ場合のみ遷移」）と図の矢印を
// 書き換える必要が出たが、row／amend は「足す」だけで書き換えられず、本人が出先でパッチを当てられないため
// 本体が手で書き換えた（変更履歴も手で足した）。**合わない道具は、手で書く方向へ押し出す**（罠 23 と同じ型）。
else if (cmd === 'replace' || cmd === 'row' || cmd === 'amend') {
  const [key, text] = args
  const opt = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null }
  const section = opt('section'), history = opt('history')
  const before = cmd === 'replace' ? key : (opt('before') || (cmd === 'row' ? '（新規）' : null))
  const usage = cmd === 'replace'
    ? '使い方: req-add.mjs replace "<今の文の逐語>" "<書き換えた後の文>" --section "<節>" --history "<変更内容>"'
    : cmd === 'row'
    ? '使い方: req-add.mjs row "<項目>" "<確定した要件文>" --section "<節>" [--after "<前の行の項目>"] --history "<変更内容>" [--before "<変更前>"]'
    : '使い方: req-add.mjs amend "<既存の箇条・行の頭の逐語>" "<足す文>" --section "<節>" --history "<変更内容>" --before "<変更前>"'
  if (!key || !text || !section || !history || !before) { console.error(usage); process.exit(2) }
  const found = inspect(text)
  if (found.length) {
    console.error(`まだ設計可能な文になっていません（未確定点 ${found.length} 件）。`)
    found.forEach(f => console.error(`  ✗ ${f.kind}${f.hits.length ? `  「${f.hits.join('」「')}」` : ''}\n      ${f.ask}`))
    console.error(`\n**推測で埋めないこと。** 本人に聞いて、答えを req-add.mjs answer で記録してから書き直してください。`)
    process.exit(1)
  }
  const s = readState(STATE, null)
  if (!s) { console.error('下書きがありません。先に open してください（質問の記録が要ります）。'); process.exit(1) }
  const needed = (s.findings || []).length
  if ((s.asked || []).length < needed) {
    console.error(`最初の要望には未確定点が ${needed} 件ありましたが、記録された質問は ${(s.asked || []).length} 件です。`)
    console.error(`  聞いてから: node .claude/scripts/req-add.mjs answer "<聞いたこと>" "<答え>"`)
    process.exit(1)
  }
  const cfg = config()
  const reqPath = cfg.paths?.requirements
  if (!reqPath) { console.error('project.json の paths.requirements が設定されていません。'); process.exit(2) }
  const abs = join(ROOT, reqPath)
  if (!existsSync(abs)) { console.error(`要件定義書が見つかりません: ${reqPath}`); process.exit(2) }
  const lines = readFileSync(abs, 'utf8').split('\n')
  const h = lines.findIndex(l => new RegExp(`^#+\\s*${section.replace(/\./g, '\\.')}(\\s|$)`).test(l))
  if (h < 0) { console.error(`節 ${section} が見つかりません。`); process.exit(1) }
  let end = h + 1
  while (end < lines.length && !/^#+\s/.test(lines[end])) end++
  const cellsOf = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  // 日付は**PC の時計の日付**（toISOString は UTC なので、日本では朝 9 時まで前日になる）
  const d0 = new Date(), p2 = n => String(n).padStart(2, '0')
  const today = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}`
  let at = -1, wrote = ''
  if (cmd === 'replace') {
    // 節の中で逐語が 1 か所だけ当たること。**2 か所以上なら、どれを書き換えるかを推測しない。**
    const hits = []
    for (let i = h + 1; i < end; i++) {
      let from = 0, k
      while ((k = lines[i].indexOf(key, from)) >= 0) { hits.push(i); from = k + key.length }
    }
    if (hits.length !== 1) { console.error(`「${key}」は節 ${section} に ${hits.length} か所あります（1 か所でなければなりません）。書いていません。`); process.exit(1) }
    if (key === text) { console.error('書き換える前と後が同じです。書いていません。'); process.exit(1) }
    const i = hits[0]
    lines[i] = lines[i].replace(key, () => text)
    wrote = lines[i]; at = i
  } else if (cmd === 'row') {
    // 節の中の表（区切り行 |---| を持つもの）を探す。**複数あれば --after で指す。**
    const tables = []
    for (let i = h + 1; i < end; i++) {
      if (/^\|/.test(lines[i]) && i + 1 < end && /^\|\s*:?-{3,}/.test(lines[i + 1])) {
        let j = i + 2; while (j < end && /^\|/.test(lines[j])) j++
        tables.push({ head: i, first: i + 2, last: j - 1, cols: cellsOf(lines[i]).length })
      }
    }
    if (!tables.length) { console.error(`節 ${section} に表がありません。行を足す先がありません。`); process.exit(1) }
    const after = opt('after')
    let t = tables[tables.length - 1], pos = t.last + 1
    if (after) {
      const hits = []
      for (const tb of tables) for (let i = tb.first; i <= tb.last; i++) if (cellsOf(lines[i])[0] === after) hits.push({ tb, i })
      if (hits.length !== 1) { console.error(`--after の項目「${after}」に当たる行が ${hits.length} 行あります（1 行でなければなりません）。`); process.exit(1) }
      t = hits[0].tb; pos = hits[0].i + 1
    } else if (tables.length > 1) {
      console.error(`節 ${section} に表が ${tables.length} つあります。--after "<前の行の項目>" で足す場所を指してください。`); process.exit(1)
    }
    for (let i = t.first; i <= t.last; i++) if (cellsOf(lines[i])[0] === key) { console.error(`項目「${key}」は既にこの表にあります。変えるなら amend を使ってください。`); process.exit(1) }
    if (t.cols !== 2) {
      console.error(`この表は ${t.cols} 列です。row が足せるのは「| 項目 | 内容 |」の 2 列の表だけです（列の意味が分からない表に推測で書かない）。`); process.exit(1)
    }
    wrote = `| ${key} | ${text} |`
    lines.splice(pos, 0, wrote); at = pos
  } else {
    // 節の中で、頭が一致する箇条・表の行を 1 つだけ探す。
    const norm = l => l.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|\|\s*)/, '')
    const hits = []
    for (let i = h + 1; i < end; i++) if (lines[i].trim() && norm(lines[i]).startsWith(key)) hits.push(i)
    if (hits.length !== 1) { console.error(`「${key}」で始まる箇条・行が節 ${section} に ${hits.length} 行あります（1 行でなければなりません）。`); process.exit(1) }
    const i = hits[0], l = lines[i]
    // 足す文の前に「。」を補う（元の文が「。」か「）」で終わっていれば補わない）
    const isRow = /^\|/.test(l.trim())
    const body = isRow ? l.replace(/\s*\|\s*$/, '') : l.replace(/\s+$/, '')
    const sep = /[。）]$/.test(body.trim()) ? '' : '。'
    lines[i] = isRow ? `${body}${sep}${text} |` : `${body}${sep}${text}`
    wrote = lines[i]; at = i
  }
  // 変更履歴の表に 1 行足す。**履歴の無い要件の変更を作らない。**
  const hh = lines.findIndex(l => /^\|\s*#\s*\|\s*変更内容\s*\|\s*変更前\s*\|\s*変更後\s*\|/.test(l))
  if (hh < 0) { console.error('要件定義書に変更履歴の表（| # | 変更内容 | 変更前 | 変更後 |）が見つかりません。書いていません。'); process.exit(1) }
  let k = hh + 2, maxN = 0
  while (k < lines.length && /^\|/.test(lines[k])) { const n = parseInt(cellsOf(lines[k])[0], 10); if (n > maxN) maxN = n; k++ }
  // 表の中に「|」を入れると列が崩れる（図の矢印「-->|…|」を書き換えたときに起きる）。**エスケープして入れる。**
  const cell = v => String(v).replace(/\\?\|/g, '\\|')
  const hist = `| ${maxN + 1}（${today}追加） | ${cell(history)}（${section}節） | ${cell(before)} | ${cell(text)} |`
  lines.splice(k, 0, hist)
  writeFileSync(abs, lines.join('\n'))
  s.committed = { mode: cmd, key, text, section, history, at: new Date().toISOString() }
  writeState(STATE, s)
  console.log(`${reqPath} を書き換えました（${cmd === 'row' ? '表に行を足した' : cmd === 'replace' ? '逐語を書き換えた' : '既存の箇条に文を足した'}、${at + 1} 行目）:\n  ${wrote}\n変更履歴:\n  ${hist}\n`)
  console.log(`**まだ終わりではありません。** 変わった要求はいまどの台帳にも載っていません。`)
  console.log(`  node .claude/scripts/split.mjs ${(cfg.tiers || [])[0]?.id || 'req'}`)
  ;(cfg.edges || []).filter(e => e.from === ((cfg.tiers || [])[0]?.id || 'req'))
    .forEach(e => console.log(`  node .claude/scripts/ledger.mjs sync "${e.from}->${e.to}"`))
}

else {
  console.log('使い方: req-add.mjs check|open|answer|commit|row|amend|replace')
  console.log('  機能追加要望を、設計可能なところまで絞り切ってから要件に書き込む。')
  console.log('  未確定点が残っている間は commit できない。')
}
