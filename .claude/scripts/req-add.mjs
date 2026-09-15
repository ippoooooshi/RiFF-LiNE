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
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config, readState, writeState, json } from './lib/config.mjs'

const STATE = 'req-draft.json'

// ── 設計可能性の検査 ──────────────────────────────────────────────────
// 「曖昧そうな語」を無限に並べない。**判定が割れない4種類**だけに絞る。
// 過剰検出は「守られていない規約を検査で強制する」ことになり、検査の出力が
// 信用されなくなる（F21）。
const OPEN_ENUM = /(など|等|その他|といった|のような)(?![0-9０-９])/g
const VAGUE = /(適切に|適切な|高速に|十分な|十分に|柔軟に|必要に応じて|うまく|きちんと|なるべく|可能な限り|わかりやすく|使いやすく)/g
const THRESHOLD_WORD = /(上限|下限|以内|以上|以下|まで|最大|最小|長さ|件数|回数|時間|秒|ミリ秒)/
const HAS_NUMBER = /[0-9０-９]/
const CAN_DO = /(できる|可能|する|行う|対応)/

export function inspect(text) {
  const t = String(text || '')
  const found = []

  const enums = [...t.matchAll(OPEN_ENUM)].map(m => m[1])
  if (enums.length) found.push({
    kind: '未閉鎖の列挙', hits: [...new Set(enums)],
    why: '列挙が閉じていないので、何が対象で何が対象外かが決まっていない',
    ask: `「${[...new Set(enums)].join('」「')}」の中身を全部挙げてください。挙げ切れないなら、この要件はまだ分割できます。`,
  })

  const vague = [...t.matchAll(VAGUE)].map(m => m[1])
  if (vague.length) found.push({
    kind: '未定義の程度', hits: [...new Set(vague)],
    why: '程度を表す語に判定条件が無いので、満たしたかどうかを誰も確かめられない',
    ask: `「${[...new Set(vague)].join('」「')}」は、何がどうなっていれば満たしたことになりますか。数値か、誰が見ても同じ判定になる条件で書いてください。`,
  })

  if (THRESHOLD_WORD.test(t) && !HAS_NUMBER.test(t)) found.push({
    kind: '数値のない閾値', hits: [t.match(THRESHOLD_WORD)[1]],
    why: '上限・範囲を語っているのに数値が無いので、実装も試験も値を決められない',
    ask: `「${t.match(THRESHOLD_WORD)[1]}」の具体的な数値を決めてください。範囲外のときにどうするか（拒否／丸める／警告）も一緒に。`,
  })

  // 「〜できる」だけで終わっていて、受入条件（どうなれば満たしたか）が無い
  const hasAccept = /(とき|場合|ならば|以外|する(と|たら)|表示され|記録され|保存され|拒否|例外|エラー)/.test(t)
  if (CAN_DO.test(t) && !hasAccept) found.push({
    kind: '受入条件が無い', hits: [],
    why: '「できる」とだけ書かれていて、何をもって満たしたと見なすかが無い。テストが書けない',
    ask: 'この機能が「できている」ことを、どんな操作をしてどうなったら確認できますか。境界（できない条件・失敗したときの挙動）も決めてください。',
  })

  return found
}

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

else {
  console.log('使い方: req-add.mjs check|open|answer|commit')
  console.log('  機能追加要望を、設計可能なところまで絞り切ってから要件に書き込む。')
  console.log('  未確定点が残っている間は commit できない。')
}
