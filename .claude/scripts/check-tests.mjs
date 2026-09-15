#!/usr/bin/env node
// テストの ID 付与・採番簿との整合、および「空振り」の静的検出。
//
// なぜこれがあるか:
//   ID の規約は以前から存在したが、採番簿も検査も無かったため
//   87 ファイル中 33 ファイルで守られておらず、誰も気づかなかった。
//   規約は書くだけでは守られない。
//
//   空振り（常に PASS で何も検証していないテスト）はレビュー観点として
//   書かれていたが、目視では検出できないため機能していなかった。
//   ここでは静的に取れる分だけを取る。本質的な検出は mutation testing
//   （パッケージ完了時に stryker）。
import { config, filesFor, read, exists, json } from './lib/config.mjs'

const cfg = config()
const testTiers = (cfg.tiers || []).filter(t => t.extractor === 'ts-test')
const testFiles = [...new Set(testTiers.flatMap(t => filesFor(t.sources, t.exclude || [])))]

// ── 採番簿 ──────────────────────────────────────────────────────────────
// 採番簿は "UT-UI-*" のようなワイルドカード表記を使う。旧実装は正規表現が
// [A-Z0-9] しか受けず "-*" を切り落としていたため、"UT-UI で始まる全部" が
// "UT-UI 完全一致" に化け、UT-UI-TAG-03 が未登録扱いになっていた（74 件の誤検知）。
// さらに書式説明文のプレースホルダ（UT-XXX / IT-XXX）を実在プレフィックスとして
// 拾っており、件数が「正解より多い」ため 0 件チェックでは気づけなかった。
//
// 対策は 3 つ:
//   1. ワイルドカードを前方一致として扱う
//   2. プレースホルダを除外する
//   3. **読み取った採番簿を必ず表示する**（件数だけでは誤りが見えないため）
// paths ごと持たないプロジェクトでも落ちない。
// PORTING.md は「採番簿が無いなら paths.testStrategy を存在しないパスにすれば
// スキップされる」と書いているが、paths キーごと消すと TypeError で落ち、
// tests は毎ターンのゲートに入っているので**移植先で全ターンが止まる**。
const registryPath = cfg.paths?.testStrategy || null
const registrySection = cfg.paths?.testRegistrySection || '3.1'
const PLACEHOLDER = /^(?:UT|IT)-(?:X+|N+|NN+|\d+|ID|PREFIX|対象|番号)$/i

const exactPrefixes = new Set()
const wildcardStems = new Set()
let registryScope = 'なし'

if (registryPath && exists(registryPath)) {
  const full = read(registryPath)
  const scoped = sliceSection(full, registrySection)
  registryScope = scoped ? `§${registrySection}` : '全文（該当節が見つからず）'
  const src = scoped || full
  // 表の行を優先する（採番簿は表で書かれる）。無ければ全文から拾う。
  const tableRows = src.split('\n').filter(l => /^\s*\|/.test(l))
  const target = tableRows.length >= 2 ? tableRows.join('\n') : src
  if (tableRows.length >= 2) registryScope += '・表の行'

  for (const m of target.matchAll(/\b((?:UT|IT)-[A-Z0-9]+(?:-(?:[A-Z0-9]+|\*))*)/g)) {
    const token = m[1]
    if (token.endsWith('-*')) { wildcardStems.add(token.slice(0, -2)); continue }
    const stem = token.replace(/-\d+$/, '')
    if (PLACEHOLDER.test(stem)) continue
    exactPrefixes.add(stem)
  }
}
const registered = new Set([...exactPrefixes, ...[...wildcardStems].map(s => s + '-*')])

function sliceSection(src, num) {
  const lines = src.split('\n')
  const start = lines.findIndex(l => new RegExp(`^#{1,6}\\s+§?\\s*${num.replace('.', '\\.')}(?![\\d])`).test(l.trim()))
  if (start === -1) return null
  const level = (lines[start].match(/^#+/) || ['#'])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#+)\s/)
    if (h && h[1].length <= level) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

function isRegistered(stem) {
  if (exactPrefixes.has(stem)) return true
  for (const w of wildcardStems) if (stem === w || stem.startsWith(w + '-')) return true
  return false
}

// テスト 1 件の範囲を切り出す。
// 旧実装は `{` `}` の数だけで、しかも「2 行目以降で深さ 0」を終了条件にしていたため、
//   - 1 行の arrow テスト `it('x', () => expect(1).toBe(1))` が閉じず、次のテストを本文として丸呑み
//   - `test.todo('x')` も同じく閉じない
//   - 文字列中の `{`（`'{'`）で深さが狂う
//   - `it.each([...])('name', …)` が見出し正規表現に掛からず、検査から消える
// 空振り検出（F10 / core.md §4「テスト空振り」）が、実際のテストコードでは大半を素通ししていた。
// 括弧・波括弧・角括弧をまとめて数え、文字列とコメントを消してから数える。
const TEST_HEAD = /^\s*(?:it|test)(?:\s*\.\s*\w+)?\s*(?:\((?:[^()]|\([^()]*\))*\)\s*)?\(\s*['"`](.+?)['"`]/
function stripCode(l) {
  return l
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$/, '')
}
function splitTests(lines) {
  const out = []; let cur = null, depth = 0
  lines.forEach((l, i) => {
    const m = !cur && l.match(TEST_HEAD)
    if (m) { cur = { name: m[1], line: i + 1, head: l, body: [] }; depth = 0 }
    if (cur) {
      cur.body.push(l)
      const s = stripCode(l)
      depth += (s.match(/[{(\[]/g) || []).length - (s.match(/[})\]]/g) || []).length
      if (depth <= 0) { out.push(cur); cur = null }
    }
  })
  if (cur) out.push(cur)
  return out
}

const idFindings = [], substanceFindings = []

for (const f of testFiles) {
  const src = read(f)
  const lines = src.split('\n')

  // ID
  const ids = [...src.matchAll(/\b((?:UT|IT)-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g)].map(m => m[1])
  if (ids.length === 0) {
    idFindings.push({ file: f, kind: 'no-id', why: 'テスト ID が1つも無い。ファイル先頭にプレフィックス行、各テストに連番 ID を書く。' })
  } else if (registered.size) {
    const prefixes = [...new Set(ids.map(i => i.replace(/-\d+$/, '')))]
    prefixes.filter(p => !isRegistered(p)).forEach(p =>
      idFindings.push({ file: f, kind: 'unregistered-prefix', prefix: p,
        why: `プレフィックス ${p} が採番簿（${registryPath} ${registrySection}）に無い。予約せずに使わない。` }))
  }

  // 検証節の併記
  if (!/検証節\s*[:：]/.test(src) && !/§\s*[\d.]+/.test(src)) {
    idFindings.push({ file: f, kind: 'no-section-ref',
      why: 'どの設計書のどの節を検証しているかが書かれていない。トレーサビリティが切れる。' })
  }

  // ── 空振りの静的検出 ────────────────────────────────────────────────
  const blocks = splitTests(lines)
  for (const b of blocks) {
    const body = b.body.join('\n')
    // skip / todo は本文を持たないのが正常。理由コメントの有無だけを見る。
    if (/\b(?:it|test)\s*\.\s*(skip|todo)\b/.test(b.head)) {
      if (!/\/\/.*理由|\/\*[\s\S]*理由/.test(b.head + body)) {
        substanceFindings.push({ file: f, line: b.line, name: b.name, kind: 'skip-without-reason',
          why: 'skip / todo の理由コメントが無い。' })
      }
      continue
    }
    // expect(...) / assert(...) / assert.strictEqual(...) / expect.assertions(...) を assertion と数える
    const asserts = [...body.matchAll(/\b(expect|assert)(?:\s*\.\s*\w+)*\s*\(/g)].length
    if (asserts === 0) {
      substanceFindings.push({ file: f, line: b.line, name: b.name, kind: 'no-assertion',
        why: 'assertion が 1 つも無い。何も検証していない。' })
      continue
    }
    if (/expect\s*\(\s*(true|1|!!\s*\w+)\s*\)\s*\.\s*toBe(Truthy)?\s*\(\s*(true)?\s*\)/.test(body)) {
      substanceFindings.push({ file: f, line: b.line, name: b.name, kind: 'tautology',
        why: '常に真になる assertion。' })
    }
    // モックの戻り値をそのまま assert している疑い
    const mocked = [...body.matchAll(/mockReturnValue(?:Once)?\s*\(\s*([A-Za-z0-9_$]+)/g)].map(m => m[1])
    for (const v of mocked) {
      if (new RegExp(`toBe\\w*\\(\\s*${v}\\b`).test(body)) {
        substanceFindings.push({ file: f, line: b.line, name: b.name, kind: 'mock-echo', symbol: v,
          why: `モックに設定した値 ${v} をそのまま assert している。実装の振る舞いを検証していない。` })
      }
    }
  }
}

const total = idFindings.length + substanceFindings.length
const registryReport = {
  path: registryPath, scope: registryScope,
  exact: [...exactPrefixes].sort(),
  wildcard: [...wildcardStems].sort().map(s => s + '-*'),
  count: exactPrefixes.size + wildcardStems.size,
}
if (json) console.log(JSON.stringify({ testFiles: testFiles.length, registry: registryReport, idFindings, substanceFindings }, null, 2))
else {
  // 件数だけでは採番簿の読み違いに気づけない（正解 23 に対し 25 と出ても健全に見えた）。
  // 読み取った中身を必ず見せる。
  console.log(`── 採番簿として読み取ったもの（${registryPath} / ${registryScope}）──`)
  console.log(`  前方一致 ${registryReport.wildcard.length} 件: ${registryReport.wildcard.join('  ') || '(なし)'}`)
  console.log(`  完全一致 ${registryReport.exact.length} 件: ${registryReport.exact.join('  ') || '(なし)'}`)
  console.log(`  ここに実在しないプレフィックスが混ざっていたら、採番簿の書式か本スクリプトの読み取りが誤っています。`)
  console.log()
  if (idFindings.length) {
    console.log('── ID・トレーサビリティ ──')
    idFindings.forEach(x => console.log(`${x.file}  [${x.kind}]${x.prefix ? ' ' + x.prefix : ''}\n    ${x.why}`))
  }
  if (substanceFindings.length) {
    console.log('\n── 空振りの疑い ──')
    substanceFindings.forEach(x => console.log(`${x.file}:${x.line}  [${x.kind}]  ${x.name}\n    ${x.why}`))
  }
  console.log(`\ncheck-tests: ${total} 件 / テストファイル ${testFiles.length}・採番簿 ${registryReport.count} 種`)
  if (!registryReport.count) console.log(`  ※ 採番簿（${registryPath} ${registrySection}）からプレフィックスを1つも読めていません。節番号と表の書式を確認してください。`)
}
process.exit(total ? 1 : 0)
