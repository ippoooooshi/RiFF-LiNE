#!/usr/bin/env node
// レビュー・批評が出した evidence（ファイル:行＋逐語引用）を実ファイルと照合する。
//
// なぜこれがあるか:
//   「主張は検証を伴う」を規約として書いても、書いた本人が確認しない限り効かない。
//   引用を機械照合すれば、確認していない主張はその場で落ちる。
//   実際、リンク切れを指摘する監査記録自身が 40 本のリンク切れを持っていた。
//
// 使い方:
//   cat review-output.json | node .claude/scripts/verify-evidence.mjs
//   node .claude/scripts/verify-evidence.mjs review-output.json
//
// 入力の中の { file, line, quote } を持つオブジェクトをすべて拾って照合する。
// 形はレビュー出力でも批評出力でも構わない。
// 照合そのものは lib/evidence.mjs に置いてある（ledger.mjs judge と共用。
// 同じ判定を 2 箇所に書くと片方が腐る）。
import { readFileSync } from 'node:fs'
import { json } from './lib/config.mjs'
import { checkEvidence, collectEvidence } from './lib/evidence.mjs'

const src = process.argv[2] && !process.argv[2].startsWith('--')
  ? readFileSync(process.argv[2], 'utf8')
  : readFileSync(0, 'utf8')

let doc
try { doc = JSON.parse(src) }
catch (e) { console.error('入力が JSON として読めません: ' + e.message); process.exit(2) }

const evidences = collectEvidence(doc)
const results = evidences.map(e => ({ ...e, ...checkEvidence(e) }))

const bad = results.filter(r => !r.ok)
const warn = results.filter(r => r.ok && r.warn)
const absence = results.filter(r => r.ok && r.absence)

if (json) console.log(JSON.stringify({ total: results.length, invalid: bad.length, absence: absence.length, results }, null, 2))
else {
  bad.forEach(r => console.log(`✗ ${r.path}\n    ${r.file}:${r.line}\n    quote: ${String(r.quote ?? '').slice(0, 100)}\n    → ${r.reason}`))
  warn.forEach(r => console.log(`△ ${r.path}  ${r.file}:${r.line}  ${r.warn}`))
  absence.forEach(r => console.log(`○ ${r.path}  ${r.file}  「無い」型（method のみ・機械照合不能）: ${String(r.method).slice(0, 80)}`))
  console.log(`\nverify-evidence: 照合 ${results.length} 件 / 無効 ${bad.length} 件 / 「無い」型 ${absence.length} 件（人が method を読むこと）`)
  if (bad.length) console.log('無効な evidence を持つ指摘は、指摘ごと無効として扱うこと。')
  if (!results.length) console.log('evidence が1件も含まれていません。証拠のない指摘は出さない規約です。')
}
process.exit(bad.length || !results.length ? 1 : 0)
