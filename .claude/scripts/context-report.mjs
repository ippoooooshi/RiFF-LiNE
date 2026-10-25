#!/usr/bin/env node
// CC の会話の記録（Claude Code が残す .jsonl）から、1 ターンで何にどれだけ使ったかを出す（v62、読むだけ）。
//
// なぜ要るか（2026-10-24 本人の指摘「v61 の後も全然変わらん」）:
//   turn 184 の終わりの /context は 613k / 1M、そのうち会話（Messages）が 576k、決まって載る分は 4 万ほどだった。
//   CC はコマンドを 1 本打つたびに、それまでの会話を全部読み直す。v61 で減らした始まりの読み物（数万）は、
//   ターンの中で積もる会話（50 万を超える）に比べて小さかった。
//   **何が会話を太らせているか**（どのコマンドの出力・どのファイルの読み込みか）を測らないと、次に何を減らすか決められない。
//
// 使い方:
//   node .claude/scripts/context-report.mjs                 # このリポジトリの、いちばん新しい会話
//   node .claude/scripts/context-report.mjs --file <.jsonl>  # 会話の記録を名指し
//   node .claude/scripts/context-report.mjs --since <ISO>    # その時刻より後だけ
//   node .claude/scripts/context-report.mjs --top 15 --json
//
// 出すもの:
//   - 呼び出しの回数・最後とピークの会話の大きさ・読み直した量の合計（キャッシュから読んだ分）・書いた量
//   - 会話に足された量を、道具ごと・コマンドごとにまとめた上位（文字数と、推定のトークン）
//   - 大きかった出力の上位
//   - 作業用の AI（ワークフロー・サブエージェント）の記録が見つかれば、その合計
//   - 「会話を途中で 1 回区切っていたら」読み直した量がどれだけ減ったかの見積もり
// 何も書かない。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { ROOT } from './lib/config.mjs'

const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null }
const asJson = argv.includes('--json')
const TOP = Math.max(1, Math.min(50, Number(opt('top')) || 12))
const since = opt('since') ? Date.parse(opt('since')) : null

export function projectsBase(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, 'projects') : join(homedir(), '.claude', 'projects')
}
// Claude Code は、開いたフォルダのパスの英数字以外を "-" にした名前のフォルダに会話を残す（ドライブ文字の大小は揺れる）
export function projectDirName(root) { return String(root).replace(/[^A-Za-z0-9]/g, '-') }
export function findSessionFile(root = ROOT, env = process.env) {
  const base = projectsBase(env)
  if (!existsSync(base)) return { error: `会話の記録のフォルダがありません: ${base}` }
  const want = projectDirName(root).toLowerCase()
  const dirs = readdirSync(base).filter(d => d.toLowerCase() === want)
  if (!dirs.length) return { error: `このリポジトリの会話の記録が見つかりません（${base} の中に ${projectDirName(root)} が無い）` }
  const dir = join(base, dirs[0])
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
  if (!files.length) return { error: `会話の記録（.jsonl）がありません: ${dir}` }
  return { file: files[0].f, dir }
}

const lenOf = c => {
  if (c == null) return 0
  if (typeof c === 'string') return c.length
  if (Array.isArray(c)) return c.reduce((n, x) => n + lenOf(x), 0)
  if (typeof c === 'object') {
    if (typeof c.text === 'string') return c.text.length
    if (c.type === 'image') return 0
    if ('content' in c) return lenOf(c.content)
    return JSON.stringify(c).length
  }
  return String(c).length
}
// コマンドの「種類」（引数を落とす）。node の台本は台本の名前と最初の語まで
export function commandKind(cmd) {
  const s = String(cmd || '').trim().replace(/^cd\s+\S+\s*&&\s*/, '').replace(/^MSYS_NO_PATHCONV=1\s+/, '')
  const w = s.split(/\s+/)
  if (w[0] === 'node' && w[1]) {
    const script = w[1].replace(/^.*[\\/]/, '')
    const sub = w[2] && !w[2].startsWith('-') && !w[2].startsWith('"') ? ` ${w[2]}` : ''
    return `node ${script}${sub}`
  }
  if (w[0] === 'git' || w[0] === 'pnpm' || w[0] === 'npx') return `${w[0]} ${w[1] || ''}`.trim()
  return w[0] || '(空)'
}
function labelOf(tu) {
  const n = tu.name, i = tu.input || {}
  if (n === 'Bash') return { group: `Bash: ${commandKind(i.command)}`, detail: String(i.command || '').slice(0, 120) }
  if (n === 'Read') return { group: 'Read', detail: `${String(i.file_path || '').replace(/^.*?[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…/')}${i.offset ? `:${i.offset}` : ''}${i.limit ? `+${i.limit}` : ''}` }
  if (n === 'Grep' || n === 'Glob') return { group: n, detail: String(i.pattern || '').slice(0, 80) }
  if (n === 'Edit' || n === 'Write' || n === 'MultiEdit') return { group: n, detail: String(i.file_path || '').replace(/^.*[\\/]/, '') }
  return { group: n, detail: JSON.stringify(i).slice(0, 100) }
}

export function analyze(lines, { sidechain = false } = {}) {
  const calls = new Map()   // message.id → usage（同じ id の行が分かれて書かれる）
  const order = []
  const toolUse = new Map() // id → { name, input }
  const added = []          // 会話に足されたもの { t, kind, group, detail, chars, afterCall }
  let callIdx = -1
  for (const raw of lines) {
    if (!raw.trim()) continue
    let o; try { o = JSON.parse(raw) } catch { continue }
    // 作業用の AI の行（isSidechain）は、本体とは別に数える
    if (!!o.isSidechain !== sidechain) continue
    const t = o.timestamp ? Date.parse(o.timestamp) : null
    if (since && t && t < since) continue
    const msg = o.message
    if (!msg) continue
    if (o.type === 'assistant' || msg.role === 'assistant') {
      const id = msg.id || o.uuid
      if (msg.usage && !calls.has(id)) { calls.set(id, { u: msg.usage, t }); order.push(id); callIdx = order.length - 1 }
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b.type === 'tool_use') {
          toolUse.set(b.id, { name: b.name, input: b.input })
          added.push({ t, kind: 'call', group: `（呼び出しの引数）${b.name}`, detail: '', chars: JSON.stringify(b.input || {}).length, afterCall: callIdx })
        } else if (b.type === 'text') added.push({ t, kind: 'text', group: '（CC の文）', detail: '', chars: (b.text || '').length, afterCall: callIdx })
      }
    } else if (o.type === 'user' || msg.role === 'user') {
      const content = msg.content
      if (typeof content === 'string') { added.push({ t, kind: 'user', group: '（本人・注入された文）', detail: content.slice(0, 80), chars: content.length, afterCall: callIdx }); continue }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'tool_result') {
          const tu = toolUse.get(b.tool_use_id) || { name: '?', input: {} }
          const { group, detail } = labelOf(tu)
          added.push({ t, kind: 'result', group, detail, chars: lenOf(b.content), afterCall: callIdx })
        } else if (b.type === 'text') added.push({ t, kind: 'user', group: '（本人・注入された文）', detail: String(b.text || '').slice(0, 80), chars: (b.text || '').length, afterCall: callIdx })
      }
    }
  }
  const us = order.map(id => calls.get(id).u)
  const ctx = us.map(u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0))
  const sum = k => us.reduce((n, u) => n + (u[k] || 0), 0)
  const totalChars = added.reduce((n, a) => n + a.chars, 0)
  const growth = ctx.length > 1 ? Math.max(0, ctx[ctx.length - 1] - ctx[0]) : 0
  const ratio = totalChars ? growth / totalChars : 0
  const groups = {}
  for (const a of added) { const g = groups[a.group] || (groups[a.group] = { group: a.group, count: 0, chars: 0 }); g.count++; g.chars += a.chars }
  const groupList = Object.values(groups).sort((a, b) => b.chars - a.chars).map(g => ({ ...g, tokensEst: Math.round(g.chars * ratio) }))
  const big = added.filter(a => a.kind === 'result').sort((a, b) => b.chars - a.chars).slice(0, TOP).map(a => ({ group: a.group, detail: a.detail, chars: a.chars, tokensEst: Math.round(a.chars * ratio), atCall: a.afterCall + 1 }))
  // 途中で 1 回区切っていたら：真ん中の呼び出しで会話を始めの大きさに戻したとみなす
  const reread = ctx.reduce((n, x) => n + x, 0)
  let splitReread = reread
  if (ctx.length > 4) {
    const mid = Math.floor(ctx.length / 2), base = ctx[0], drop = Math.max(0, ctx[mid] - base)
    splitReread = ctx.reduce((n, x, i) => n + (i >= mid ? Math.max(base, x - drop) : x), 0)
  }
  return {
    calls: us.length,
    contextFirst: ctx[0] || 0, contextLast: ctx[ctx.length - 1] || 0, contextPeak: ctx.length ? Math.max(...ctx) : 0,
    rereadTotal: reread, cacheRead: sum('cache_read_input_tokens'), cacheWrite: sum('cache_creation_input_tokens'), input: sum('input_tokens'), output: sum('output_tokens'),
    splitOnceReread: splitReread,
    addedChars: totalChars, tokensPerChar: Math.round(ratio * 1000) / 1000,
    groups: groupList.slice(0, TOP), biggest: big,
    from: us.length ? new Date(calls.get(order[0]).t || 0).toISOString() : null, to: us.length ? new Date(calls.get(order[order.length - 1]).t || 0).toISOString() : null,
  }
}

function walkJsonl(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n); let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walkJsonl(p, out)
    else if (n.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function main() {
  let file = opt('file'), dir = null
  if (!file) {
    const f = findSessionFile()
    if (f.error) { console.error(f.error); process.exit(1) }
    file = f.file; dir = f.dir
  }
  const lines = readFileSync(file, 'utf8').split('\n')
  const res = analyze(lines)
  // 作業用の AI：<会話の id>/ の下の .jsonl（サブエージェント・ワークフロー）
  const subDir = join(file.replace(/\.jsonl$/, ''))
  const subs = walkJsonl(subDir)
  let sub = null
  const side = analyze(lines, { sidechain: true })
  if (subs.length || side.calls) {
    sub = { files: subs.length, calls: side.calls, rereadTotal: side.rereadTotal, output: side.output }
    for (const p of subs) { const a = analyze(readFileSync(p, 'utf8').split('\n'), { sidechain: true }); const b = analyze(readFileSync(p, 'utf8').split('\n')); for (const x of [a, b]) { sub.calls += x.calls; sub.rereadTotal += x.rereadTotal; sub.output += x.output } }
  }
  const out = { file: basename(file), ...res, subagents: sub }
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return }
  const k = n => n >= 10000 ? `${Math.round(n / 1000) / 10} 万` : String(n)
  console.log(`会話の記録 ${out.file}（${out.from || '?'} 〜 ${out.to || '?'}）`)
  console.log(`  呼び出し ${out.calls} 回・会話の大きさ 始め ${k(out.contextFirst)} → 最後 ${k(out.contextLast)}（ピーク ${k(out.contextPeak)}）`)
  console.log(`  読み直した量の合計 ${k(out.rereadTotal)}（キャッシュから ${k(out.cacheRead)}・キャッシュへ書いた ${k(out.cacheWrite)}・そのほか ${k(out.input)}）・CC が書いた量 ${k(out.output)}`)
  console.log(`  途中で 1 回区切っていたら（見積もり）：読み直し ${k(out.splitOnceReread)}（${out.rereadTotal ? Math.round(100 - out.splitOnceReread / out.rereadTotal * 100) : 0}% 減）`)
  if (sub) console.log(`  作業用の AI：記録 ${sub.files}・呼び出し ${sub.calls} 回・読み直し ${k(sub.rereadTotal)}・書いた量 ${k(sub.output)}`)
  console.log(`  会話に足された量（道具・コマンドごと、上位 ${TOP}。トークンは文字数からの推定・1 文字 ${out.tokensPerChar}）`)
  for (const g of out.groups) console.log(`    ${String(k(g.tokensEst)).padStart(7)}  ${String(g.count).padStart(4)} 回  ${g.group}`)
  console.log(`  大きかった出力（上位 ${TOP}）`)
  for (const b of out.biggest) console.log(`    ${String(k(b.tokensEst)).padStart(7)}  ${b.group}  ${b.detail}`)
}

if (process.argv[1] && basename(process.argv[1]) === 'context-report.mjs') main()
