#!/usr/bin/env node
// 水平展開の分母を機械が固定する。同型のヒット全件に判定を要求する。
//
// なぜこれがあるか:
//   `horizontal.mjs`（同型の検索）は v9 から在ったが、**どの hook からも呼ばれていなかった**。
//   `agents/impl.md` と `HOWTO.md` の散文に「使うこと」と書いてあるだけで、
//   使わずに「直しました」と言っても何も起きない。F8（SetTempoCommand を直したが
//   同型の欠落が 6 件残っていた）を防ぐために作った仕組みが、F51 と同じ理由で
//   作業に接続されていなかった。
//
//   対処は台帳・レビューと同じ形にする。検索ヒットを分母に固定し、1 件ずつ判定させる。
//   「他は大丈夫です」と書くことはできるが、**件数が見えるし 1 件ずつ理由が要る**。
//
// 判定は3つだけ:
//   是正済み … その箇所も直した。evidence（file / line / quote）が実ファイルと一致すること
//   別物     … 同じパターンに見えるが別の話。**なぜ別物かの理由**が必須（その箇所の語を含むこと）
//   繰越     … 今は直さない。**G 番号が必須**（番号・担当・判定条件は /gap が要求する）
//
// 「検査の省略」は用意しない。繰越が正規の判定なので、必ず有限で終わる。
//
// 使い方:
//   node .claude/scripts/spread.mjs scan "<正規表現>" [--in "<glob>"]
//   node .claude/scripts/spread.mjs pending [--json]
//   node .claude/scripts/spread.mjs next [件数] [--ids-only]
//   node .claude/scripts/spread.mjs show <id>
//   node .claude/scripts/spread.mjs verdict <id> <判定> '<evidence json>'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, readState, writeState, json, config, exists, read } from './lib/config.mjs'
import { checkEvidence } from './lib/evidence.mjs'

export const VERDICTS = ['是正済み', '別物', '繰越']
const STATE = 'spread.json'
const HERE = dirname(fileURLToPath(import.meta.url))

export function load() { return readState(STATE, { pattern: null, scope: null, at: null, hits: [] }) }
function save(s) { writeState(STATE, s) }

// その箇所に実際に現れる語。理由がこの中の 1 つも含まないなら、
// **その理由はその箇所について書かれていない**（diff-units と同じ判定）。
const GENERIC = new Set([
  'export', 'import', 'from', 'const', 'let', 'var', 'function', 'return', 'class',
  'interface', 'type', 'enum', 'public', 'private', 'static', 'readonly', 'async', 'await',
  'this', 'new', 'null', 'undefined', 'true', 'false', 'void', 'string', 'number', 'boolean',
  'if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'throw', 'console', 'log',
])
export function hitTokens(h) {
  const t = new Set()
  for (const m of String(h.text || '').matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const w = m[0].toLowerCase()
    if (!GENERIC.has(w)) t.add(w)
  }
  for (const m of String(h.text || '').matchAll(/[一-龥ぁ-んァ-ヶ][一-龥ぁ-んァ-ヶー]+/g)) t.add(m[0])
  const base = String(h.file || '').split('/').pop().replace(/\.[^.]*$/, '')
  if (base.length >= 3) t.add(base.toLowerCase())
  return t
}
export function reasonMentions(reason, h) {
  const t = hitTokens(h)
  if (!t.size) return true
  const r = String(reason).toLowerCase()
  for (const tok of t) if (r.includes(tok)) return true
  return false
}

const [, , cmd, ...rest] = process.argv
const args = rest.filter(a => !a.startsWith('--'))

if (cmd === 'scan') {
  const pattern = args[0]
  if (!pattern) {
    console.error('検索パターンが要ります: spread.mjs scan "<正規表現>" [--in "<glob>"]')
    console.error('  直した箇所の**型**を書くこと。1 箇所だけに当たる文字列では水平展開になりません。')
    process.exit(2)
  }
  const inIdx = rest.indexOf('--in')
  const scope = inIdx >= 0 ? rest[inIdx + 1] : null
  // **1 ファイルに絞った走査は水平展開ではない。**
  // v22 は `scan "^export class Tempo" --in packages/core/src/a.ts` → ヒット 1 件 →
  // 是正済み、で Stop hook の 3 条件（新しい・触ったファイルに当たる・未判定 0）を
  // 全部満たせた（実測）。いま直したファイルだけを見て「他に同型は無い」とは言えない。
  if (scope && !/[*?{]/.test(scope)) {
    console.error(`--in が 1 ファイルを指しています: ${scope}`)
    console.error('  水平展開は「直した型が**他のどこ**に在るか」を数える作業です。')
    console.error('  いま直したファイルだけを走査しても、他に無いことの確認にはなりません。')
    console.error('  範囲を広げるか、--in を外して全リポジトリを走査してください。')
    process.exit(2)
  }
  const a = [join(HERE, 'horizontal.mjs'), pattern, '--json']
  if (scope) a.push('--in', scope)
  const r = spawnSync('node', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                                   env: { ...process.env, CLAUDE_VERIFY_NESTED: '1' } })
  let out = null
  try { out = JSON.parse(r.stdout) } catch { /* fall through */ }
  if (!out) {
    console.error('水平展開検索に失敗しました。')
    console.error(((r.stdout || '') + (r.stderr || '')).split('\n').slice(-6).join('\n'))
    process.exit(2)
  }
  const hits = []
  for (const [file, hs] of Object.entries(out.byFile || {})) {
    for (const h of hs) {
      hits.push({ id: `${file}:${h.line}:${createHash('sha1').update(h.text).digest('hex').slice(0, 6)}`,
                  file, line: h.line, text: h.text,
                  hash: createHash('sha1').update(`${file}:${h.line}:${h.text}`).digest('hex').slice(0, 12) })
    }
  }
  const prev = load()
  const keep = new Map((prev.hits || []).map(h => [h.hash, h]))
  const next = hits.map(h => {
    const p = prev.pattern === pattern ? keep.get(h.hash) : null
    return p ? { ...h, verdict: p.verdict, evidence: p.evidence, reason: p.reason, gapId: p.gapId, at: p.at } : h
  })
  save({ pattern, scope: out.scope, at: new Date().toISOString(), scanned: out.scanned, hits: next })
  const carried = next.filter(h => h.verdict).length
  console.log(`水平展開の分母を固定しました: ${next.length} 箇所（パターン /${pattern}/ ・走査 ${out.scanned} ファイル）`)
  if (carried) console.log(`  うち ${carried} 件は前回の判定を引き継ぎ`)
  console.log(`  未判定 ${next.length - carried} 件。1 件ずつ判定してください。`)
  console.log(`    node .claude/scripts/spread.mjs next 1`)
  if (!next.length) {
    console.log(`\n  ⚠ ヒット 0 件です。**「同型は無い」と「パターンが当たっていない」は違います。**`)
    console.log(`     直した箇所そのものがヒットしないパターンなら、それは検索が外れています。`)
  }
  const files = new Set(next.map(h => h.file))
  if (next.length && files.size === 1) {
    console.log(`\n  ⚠ ヒットが 1 ファイル（${[...files][0]}）に閉じています。`)
    console.log(`     いま直した箇所しか当たっていない可能性があります。その場合、これは`)
    console.log(`     「他に同型が無い」ことの確認ではなく、**自分の変更を数えているだけ**です。`)
    console.log(`     型をもう一段抽象化して走査し直すか、他に無いと判断した根拠を判定の理由に書いてください。`)
  }
}

else if (cmd === 'pending') {
  const s = load()
  const un = (s.hits || []).filter(h => !h.verdict)
  const out = {
    pattern: s.pattern, at: s.at, files: [...new Set((s.hits || []).map(h => h.file))],
    hits: (s.hits || []).length, unjudged: un.length,
    judged: (s.hits || []).length - un.length,
    fixed: (s.hits || []).filter(h => h.verdict === '是正済み').length,
    carried: (s.hits || []).filter(h => h.verdict === '繰越').length,
    unjudgedIds: un.slice(0, 20).map(h => h.id),
  }
  if (json) console.log(JSON.stringify(out, null, 2))
  else if (!out.hits) {
    console.log('水平展開の分母が固定されていません。先に scan してください。')
    console.log('  node .claude/scripts/spread.mjs scan "<直した型の正規表現>"')
    console.log('  **やっていないことを「同型なし」と読まないこと。**')
  } else {
    console.log(`同型 ${out.hits}  判定済 ${out.judged}  未判定 ${out.unjudged}  是正 ${out.fixed}  繰越 ${out.carried}（パターン /${out.pattern}/）`)
    if (out.unjudged) console.log(`  残り: ${out.unjudgedIds.slice(0, 5).join(' ')}${out.unjudged > 5 ? ' …' : ''}`)
  }
  // 分母が無い状態は緑ではない（台帳の「単位 0 を漏れなしと読まない」と同じ）
  process.exit(!out.hits ? 2 : out.unjudged ? 1 : 0)
}

else if (cmd === 'next') {
  const s = load()
  const n = args[0] && args[0] !== 'all' ? Number(args[0]) : Infinity
  const un = (s.hits || []).filter(h => !h.verdict).slice(0, n === Infinity ? undefined : n)
  if (rest.includes('--ids-only')) { console.log(JSON.stringify({ count: un.length, ids: un.map(h => h.id) }, null, 2)); }
  else console.log(JSON.stringify({
    verdicts: VERDICTS, pattern: s.pattern, count: un.length,
    note: '1 件ずつ判定する。直した型と同じ欠陥がここにも在るかを、実ファイルを開いて確かめること。',
    hits: un.map(h => ({ id: h.id, file: h.file, line: h.line, text: h.text })),
  }, null, 2))
}

else if (cmd === 'show') {
  const s = load()
  const h = (s.hits || []).find(x => x.id === args[0])
  if (!h) { console.error(JSON.stringify({ error: `${args[0]} が分母にありません` })); process.exit(1) }
  console.log(JSON.stringify({ ...h, verdicts: VERDICTS, pattern: s.pattern }, null, 2))
}

else if (cmd === 'verdict') {
  const s = load()
  const h = (s.hits || []).find(x => x.id === args[0])
  if (!h) { console.error(`${args[0]} が分母にありません`); process.exit(1) }
  const verdict = args[1]
  if (!VERDICTS.includes(verdict)) { console.error(`判定は次のいずれか: ${VERDICTS.join(' / ')}`); process.exit(1) }
  const ev = args[2] ? JSON.parse(args[2]) : null

  if (verdict === '是正済み') {
    if (!ev?.quote) { console.error('「是正済み」には evidence（file / line / quote）が必須です。直したあとの実コードを逐語で引用してください。'); process.exit(1) }
    const v = checkEvidence(ev, { strict: true, requireQuote: true })
    if (!v.ok) { console.error(`evidence が実ファイルと一致しません: ${v.reason}`); process.exit(1) }
  } else if (verdict === '繰越') {
    // 無期限・無責任の繰り越しを作らない（F4）。番号・担当・判定条件は /gap が要求する。
    const gapId = String(ev?.gapId || '')
    if (!/^[A-Za-z]+-?\d+$/.test(gapId)) {
      console.error('「繰越」には evidence.gapId（G 番号）が必須です。')
      console.error('  先に起票してください:  /gap <一言サマリ>')
      console.error('  番号・担当作業単位・判定条件の 3 つが揃わないものは繰り越せません。')
      process.exit(1)
    }
    // **番号の形だけを見ていると、存在しない番号へ繰り越せる。**
    // v22 は G999 でも通った（実測）。繰越先が実在しないと、繰り越しは
    // 「あとでやる」ではなく「無かったことにする」になる。
    const gl = config().gapLedger
    if (gl?.file && exists(gl.file)) {
      const body = read(gl.file)
      const re = new RegExp(`(^|[^A-Za-z0-9])${gapId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`, 'm')
      if (!re.test(body)) {
        console.error(`繰越先の ${gapId} が ${gl.file} に見つかりません。`)
        console.error('  先に起票してください:  /gap <一言サマリ>')
        console.error('  実在しない番号への繰り越しは、記録ではなく消去です。')
        process.exit(1)
      }
    }
    if (!ev?.reason || String(ev.reason).trim().length < 8) {
      console.error('「繰越」には evidence.reason（なぜ今やらないか）も必須です。'); process.exit(1)
    }
  } else {
    if (!ev?.reason || String(ev.reason).trim().length < 8) {
      console.error('「別物」には evidence.reason（なぜ同型ではないか）が必須です。8 文字以上。'); process.exit(1)
    }
    if (!reasonMentions(ev.reason, h)) {
      console.error(`理由がこの箇所の中身に触れていません（${h.file}:${h.line}）。`)
      console.error(`  どのヒットにも貼れる文は、判定ではなく通過の手続きです。`)
      console.error(`  この箇所に現れる語を最低 1 つ含めてください: ${[...hitTokens(h)].slice(0, 8).join(' ')}`)
      process.exit(1)
    }
  }
  h.verdict = verdict; h.evidence = ev; h.reason = ev?.reason; h.gapId = ev?.gapId
  h.at = new Date().toISOString()
  save(s)
  const left = (s.hits || []).filter(x => !x.verdict).length
  console.log(`OK ${h.id} = ${verdict}（残り ${left} 件）`)
}

else {
  console.log('使い方: spread.mjs scan|pending|next|show|verdict')
  console.log('  直した型の同型をリポジトリ全体から数えて分母に固定し、全件に判定を要求する。')
  console.log('  判定は 是正済み / 別物 / 繰越（G 番号つき）の 3 つ。省略は用意しない。')
}
