#!/usr/bin/env node
// 図（mermaid）の中にだけ書かれた決まりを拾い出す。**知らせるだけで、終了コードは 0。**（v34 T24）
//
// なぜこれがあるか:
//   split.mjs は mermaid の図を「図の記述」として台帳の対象から外す。図の中の注記
//   （例 `int volume "0-100"`、`string label "イントロ/Aメロ/サビ等自由文字列"`）に決まりが書いてあっても、
//   本文に同じことが無ければ、**台帳の分母に入らず、詳細設計に書き漏らしても漏れとして見えない。**
//   実測（2026-09-28、turn 91 から 93）: 02 章の ER 図にだけ、音量 0-100・パン -50-50・セクションマーカーの
//   名前・既定の表示モードの値・filePath・音価の範囲・ボイスは通常 1 つ・slurGroupId は空でよい、が在った。
//   01 章の図にだけ contextBridge が在った。本体が 1 行ずつ grep して見つけていた。
//
// 何を見るか:
//   図の中で引用符 "…" を持つ行ごとに、注記の語（と、その行の項目名）が図の外の本文に在るかを数える。
//   **数字は 1 つでも本文に無ければ**知らせる（範囲・既定値は数字で書かれ、語の一致では拾えないため）。
//   本文に在るかどうかは語の一致で見るだけで、意味が同じかは見ない。**最後は人が読んで決める。**
//
// 使い方:
//   node .claude/scripts/check-figure-notes.mjs                 基本設計（tiers の bd）の全章
//   node .claude/scripts/check-figure-notes.mjs --file 02_data  その章だけ
//   node .claude/scripts/check-figure-notes.mjs --tier req      要件定義書
//   node .claude/scripts/check-figure-notes.mjs --all           本文に在る見込みのものも出す
//   node .claude/scripts/check-figure-notes.mjs --json
import { config, allFiles, matchesAny, read } from './lib/config.mjs'

const argv = process.argv.slice(2)
const opt = (name, fb = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb }
const json = argv.includes('--json')
const showAll = argv.includes('--all')
const tierId = opt('tier', 'bd')
const filePart = opt('file')

const cfg = config()
const tier = (cfg.tiers || []).find(t => t.id === tierId)
if (!tier) {
  console.error(`tier ${JSON.stringify(tierId)} が project.json にありません。使えるのは: ${(cfg.tiers || []).map(t => t.id).join(' / ')}`)
  process.exit(1)
}
const files = allFiles().filter(f => matchesAny(f, tier.sources || []) && !matchesAny(f, tier.exclude || []) && f.endsWith('.md'))
  .filter(f => !filePart || f.includes(filePart)).sort()

// ledger.mjs の tokensOf と同じ切り方（ledger.mjs は読み込むとコマンドとして動くので写す）
function tokensOf(text) {
  const t = String(text || '')
  const out = new Set()
  for (const m of t.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[ァ-ヴー]{2,}/g)) out.add(m[0])
  for (const m of t.matchAll(/[一-龥]{2,}/g)) out.add(m[0])
  return out
}
const numbersOf = text => [...String(text || '').matchAll(/-?\d+(?:\.\d+)?/g)].map(m => m[0])

const report = []
for (const f of files) {
  const src = read(f)
  if (src == null) continue
  const lines = src.split('\n')
  const figure = new Set()
  let inFence = false, isMermaid = false
  lines.forEach((l, i) => {
    const fm = l.match(/^\s*```\s*(\S*)/)
    if (fm) {
      if (!inFence) { inFence = true; isMermaid = /^mermaid$/i.test(fm[1]) }
      else { inFence = false; if (isMermaid) figure.add(i) ; isMermaid = false; return }
    }
    if (inFence && isMermaid) figure.add(i)
  })
  const body = lines.filter((_, i) => !figure.has(i)).join('\n')
  const bodyLower = body.toLowerCase()
  const bodyNumbers = new Set(numbersOf(body.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))))

  for (const i of [...figure].sort((a, b) => a - b)) {
    const l = lines[i]
    const notes = [...l.matchAll(/"([^"]{2,})"/g)].map(m => m[1])
    if (!notes.length) continue
    // 項目名（ER 図の属性の行なら「型 名前 "注記"」の名前）
    // ER 図の属性の行（「型 名前 "注記"」）のときだけ。flowchart の subgraph やノードの ID は項目名ではない
    const am = l.replace(/"[^"]*"/g, ' ').trim().match(/^([a-z][\w<>\[\]]*)\s+([A-Za-z_]\w*)(\s|$)/)
    const attr = am && !/^(subgraph|direction|class|classdef|style|click|graph|flowchart|participant|note|end|linkstyle)$/i.test(am[1]) ? am[2] : null
    for (const note of notes) {
      const toks = [...tokensOf(note)]
      const miss = toks.filter(x => /^[a-z_]/.test(x) ? !bodyLower.includes(x) : !body.includes(x))
      // 数字: 範囲（0-100）の前の数を負と読まないよう、前の数字に続く「-」は区切りとして扱う
      const nums = [...note.matchAll(/(?<![\d])-?\d+(?:\.\d+)?/g)].map(m => m[0])
        .map((n, k, arr) => (k > 0 && n.startsWith('-') && /\d-\d/.test(note)) ? n : n)
      const missNum = nums.filter(n => !bodyNumbers.has(n) && !bodyNumbers.has(n.replace(/^-/, '')))
      const attrMissing = attr ? !bodyLower.includes(attr.toLowerCase()) : false
      // 範囲（0-100・1/1..1/32・-50-50）は、両端の数字が本文のどこかに散らばっているだけでは足りない。
      // 本文に「a から b」「a-b」「a〜b」の形で並んでいるかを見る（実測: 音量 0-100 は「100文字」の 100 に当たって見逃しうる）
      const missRange = []
      for (const m of note.matchAll(/(-?\d+(?:\/\d+)?)\s*(?:\.\.|-|〜|~|から)\s*(-?\d+(?:\/\d+)?)/g)) {
        const a = m[1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), b = m[2].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
        const re = new RegExp(`(^|[^\\d/])${a}[）)]?\\s*(?:\\.\\.|-|〜|~|から|以上)\\s*[^\\n]{0,12}?${b}(?![\\d/])`)
        if (!re.test(body)) missRange.push(`${m[1]}から${m[2]}`)
      }
      const covered = toks.length ? (toks.length - miss.length) / toks.length : 1
      const suspect = missNum.length > 0 || missRange.length > 0 || covered < 0.5 || attrMissing
      if (!suspect && !showAll) continue
      report.push({ file: f, line: i + 1, attr, note, covered: Math.round(covered * 100) / 100,
        missingWords: miss, missingNumbers: missNum, missingRanges: missRange, attrMissing, suspect })
    }
  }
}

if (json) {
  console.log(JSON.stringify({ tier: tierId, files: files.length, notes: report.length,
    suspect: report.filter(r => r.suspect).length, report }, null, 2))
} else {
  let cur = null
  for (const r of report) {
    if (r.file !== cur) { console.log(`\n${r.file}`); cur = r.file }
    const why = [
      r.attrMissing ? `項目名 ${r.attr} が本文に無い` : '',
      r.missingNumbers.length ? `数字 ${r.missingNumbers.join('・')} が本文に無い` : '',
      r.missingRanges.length ? `範囲 ${r.missingRanges.join('・')} が本文に無い` : '',
      r.missingWords.length ? `本文に無い語 ${r.missingWords.slice(0, 6).join('・')}（語の ${Math.round((1 - r.covered) * 100)}%）` : '',
    ].filter(Boolean).join(' / ')
    console.log(`  ${r.suspect ? '△' : '・'} ${r.line}: ${r.attr ? r.attr + ' ' : ''}"${r.note}"${why ? `\n      ${why}` : ''}`)
  }
  console.log(`\ncheck-figure-notes: 図の注記のうち本文に無い見込み ${report.filter(r => r.suspect).length} 件 / 走査 ${files.length} ファイル（tier ${tierId}）`)
  console.log('  知らせるだけです（終了コード 0）。本文に同じ決まりが在るかを読んで確かめ、無ければ本文の対応する行に写してください。')
  console.log('  **図は台帳の分母に入りません。** 図にだけある決まりは、詳細設計に書き漏らしても漏れとして見えません。')
}
