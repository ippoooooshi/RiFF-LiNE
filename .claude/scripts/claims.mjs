#!/usr/bin/env node
// そのターンで Claude が**言ったこと**を、ツール使用履歴と実ファイルに照合する。
//
// なぜこれがあるか:
//   これまでの検査はすべて「ファイルを書いたとき」にしか発火しなかった。
//   `gate.mjs` の Stop は `turn.edited` が空なら即 pass していたので、
//   「この仕様どこに書いてある？」に答えるだけのターン——最も頻度が高い使い方——には
//   検証が一つも掛かっていなかった。
//
//   `rules/core.md` §1 は「引用の書式は3つしかない」と定めているが、規約であって
//   強制ではなかった。ここがその強制にあたる。断定するなら裏を取れ、取っていないなら
//   「未確認」と書け、というルールを機械が見る。
//
// 照合するのは3種類だけ。**何が正しいかは判定しない**（切り分けは機械、判定は AI）。
//   1. 引用    `ファイル:行` ＋ 逐語 → 実ファイルと突き合わせる
//   2. 不在    「見つからなかった」「0 件」等 → そのターンに検索の記録が在るか
//   3. 実行    「確認しました」「実行しました」等 → そのターンに対応する記録が在るか
//
// 逃げ道は1つだけ、そして記録が残る形にしてある:
//   文中に「未確認」と書けば主張として扱わない（core.md §1 の2番目の形）。
//
// 使い方:
//   node .claude/scripts/claims.mjs --text "<本文>" [--json]
//   echo "<本文>" | node .claude/scripts/claims.mjs [--json]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readState, json } from './lib/config.mjs'
import { checkEvidence } from './lib/evidence.mjs'

// ── 入力 ────────────────────────────────────────────────────────────────
// 本文は **stdin で受けるのが既定**。--text で argv に積むと CreateProcess の
// 32,767 文字制限に当たり、長い報告ほど検査されないという逆転が起きる
// （超過すると spawnSync が error を返し、呼び出し側は空の stdout を受け取る）。
const ti = process.argv.indexOf('--text')
const text = ti >= 0 ? String(process.argv[ti + 1] || '')
  : (() => { try { return readFileSync(0, 'utf8') } catch { return '' } })()

const turn = readState('turn.json', { created: [], edited: [], commands: [], reads: [], searches: [] })
const reads = turn.reads || []
const searches = turn.searches || []
const commands = turn.commands || []

// Bash も検索・実行の記録として数える
const SEARCH_CMD = /\b(grep|rg|ripgrep|find|ag|ack|git\s+grep|ls\b)/
const searchRecords = [...searches, ...commands.filter(c => SEARCH_CMD.test(c))]
const readRecords = [...reads, ...commands.filter(c => /\b(cat|head|tail|sed -n|less|more|Get-Content)\b/.test(c))]
const anyRecord = reads.length + searches.length + commands.length > 0

// ── 文に割る ────────────────────────────────────────────────────────────
// コードブロックは対象外（例示・コマンド例であって主張ではない）
const prose = String(text).replace(/```[\s\S]*?```/g, ' ')
const sentences = prose.split(/\n+|(?<=。)/).map(s => s.trim()).filter(Boolean)

// 「未確認」と書いてあれば主張ではない（core.md §1 の2番目の形）
const HEDGED = /未確認/

const findings = []

// ── 1. 引用（ファイル:行 ＋ 逐語）────────────────────────────────────────
// `docs/a.md:12` 「本文」 / docs/a.md:12 「本文」 / "本文" の形を拾う
const CITE = /`?([A-Za-z0-9_./\-]+\.[A-Za-z0-9]+):(\d+)`?\s*[（(]?\s*[「"']([^」"'\n]{4,})[」"']/g
for (const m of prose.matchAll(CITE)) {
  const [, file, line, quote] = m
  const v = checkEvidence({ file, line: Number(line), quote })
  if (!v.ok) {
    findings.push({ kind: 'cite-mismatch', file, line: Number(line), quote, why: v.reason })
  } else if (v.warn) {
    findings.push({ kind: 'cite-line-shift', file, line: Number(line), quote, why: v.warn, advisory: true })
  }
}

// 逐語を伴わない `ファイル:行` は、行が実在するかだけ見る
const CITE_BARE = /`([A-Za-z0-9_./\-]+\.[A-Za-z0-9]+):(\d+)`/g
for (const m of prose.matchAll(CITE_BARE)) {
  const [, file, lineStr] = m
  const line = Number(lineStr)
  const p = join(ROOT, file)
  if (!existsSync(p)) {
    // ディレクトリを含まないファイル名は、引用ではなく**言及**のことが多い
    // （版スタンプ、`foo.mjs:42` のような口頭の指し示し）。実ファイルが無いうえに
    // パスでもないものを「捏造した引用」と呼ぶと、正しい報告が止まる。
    // 実運用で、現在地の行を引用しただけで 3 ターン続けて止まった。
    // 実在するパスなら下の行数検査が効くので、本物の壊れた参照は見逃さない。
    if (!file.includes('/')) continue
    findings.push({ kind: 'cite-missing-file', file, line, why: 'このファイルは存在しない' }); continue
  }
  const n = readFileSync(p, 'utf8').split('\n').length
  if (line > n) findings.push({ kind: 'cite-out-of-range', file, line, why: `このファイルは ${n} 行しかない` })
}

// ── 2. 不在の主張 ───────────────────────────────────────────────────────
// 「〜は無い」と断定するなら、そのターンに探した記録が要る。
// 対象を絞るため、同じ文に**パスか引用符つきの語**が在るものだけを主張として扱う
// （「問題ありません」「副作用はありません」を拾わないため）。
// 「0 件」は直前に数字が来ていないときだけ不在の主張として扱う。
// v22 は「リンク切れは 20 件あります」を `0\s*件` で拾って止めていた——
// 正直な報告が止まる検査は、止まらない書き方を学習させるだけで終わる。
const ABSENCE = /見つかりませんでした|見つからなかった|見当たりませんでした|存在しません|存在しない|一件もありません|1 ?件もありません|ヒット\s*(?<![0-9０-９])0|(?<![0-9０-９])0\s*件|ゼロ件/
const TARGETED = /[A-Za-z0-9_./\-]+\.[A-Za-z0-9]+|[「"`][^」"`\n]{2,}[」"`]/
for (const s of sentences) {
  if (HEDGED.test(s)) continue
  if (!ABSENCE.test(s) || !TARGETED.test(s)) continue
  if (!searchRecords.length) {
    findings.push({ kind: 'absence-unsearched', sentence: s.slice(0, 120),
      why: 'このターンに検索（Grep / Glob / grep / rg / find）の記録が無い' })
  }
}

// ── 3. 実行・確認の主張 ─────────────────────────────────────────────────
// 一人称の完了形だけを見る。記録が **1 件も無い** ときにだけ鳴らす
// （どのコマンドが対応するかを機械が当てにいくと必ず誤検出するため）。
const DID_READ   = /読みました|読み返しました|開いて確認しました|目を通しました/
const DID_SEARCH = /grep\s*(し|を)?ました|検索しました|探しました|洗い出しました/
const DID_RUN    = /実行しました|走らせました|叩きました|動かしました|テストしました|実行済み/
const DID_CHECK  = /確認しました|確かめました|検証しました|突き合わせました|照合しました|確認済み|確認できました/
for (const s of sentences) {
  if (HEDGED.test(s)) continue
  const push = (kind, need) => findings.push({ kind, sentence: s.slice(0, 120), why: `このターンに${need}の記録が無い` })
  if (DID_READ.test(s)   && !readRecords.length   && !reads.length) push('claimed-read', '読み取り（Read / cat / sed -n）')
  else if (DID_SEARCH.test(s) && !searchRecords.length)             push('claimed-search', '検索（Grep / Glob / grep / rg / find）')
  else if (DID_RUN.test(s)    && !commands.length)                  push('claimed-run', 'コマンド実行（Bash）')
  else if (DID_CHECK.test(s)  && !anyRecord)                        push('claimed-check', 'ツール使用')
}

// ── 出力 ────────────────────────────────────────────────────────────────
const blocking = findings.filter(f => !f.advisory)
const summary = {
  checked: { sentences: sentences.length, reads: reads.length, searches: searches.length, commands: commands.length },
  findings, blocking: blocking.length,
}
if (json) console.log(JSON.stringify(summary, null, 2))
else {
  findings.forEach(f => {
    const head = f.file ? `${f.file}:${f.line}` : `「${f.sentence}」`
    console.log(`${f.advisory ? '△' : '✗'} [${f.kind}] ${head}\n    ${f.why}${f.quote ? `\n    引用: ${f.quote.slice(0, 80)}` : ''}`)
  })
  console.log(`\nclaims: 文 ${sentences.length} / 不一致 ${blocking.length} 件` +
    `（記録: 読み ${reads.length} 検索 ${searches.length} 実行 ${commands.length}）`)
}
process.exit(blocking.length ? 1 : 0)
