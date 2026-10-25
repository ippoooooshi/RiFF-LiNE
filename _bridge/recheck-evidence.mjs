// 台帳に記録済みの evidence が、いまの下位文書とまだ噛み合っているかを機械で見る。
//
// なぜ要るか:
//   下位（docs/basic_design/*.md）を 1 行足すと、それより下の行番号が全部ずれる。
//   記録済みの evidence は `ファイル:行＋逐語` で、照合は ±3 行しか許さない。
//   ずれても台帳は何も言わない——**黙って腐る**。直す前と後でこれを走らせて、
//   「どの判定の証拠が生きているか」を件数で見るための道具。
//
// なぜ .claude/scripts/ ではなく _bridge/ に在るか:
//   .claude/ は検査される側が書けない場所（ゲートが読む）。この道具は検査の補助で、
//   台帳にも docs/ にも 1 バイトも書かない読み取り専用。
//
// 判定そのものは**書いていない**。`.claude/scripts/lib/evidence.mjs` の checkEvidence を
// import して呼ぶだけ。同じ照合を 2 か所に書くと必ず片方が腐る（lib 側の冒頭コメント参照）。
//
// 使い方:
//   node _bridge/recheck-evidence.mjs                 全段（既定は req->bd）
//   node _bridge/recheck-evidence.mjs "bd->dd"        別の段
//   node _bridge/recheck-evidence.mjs --json          機械可読
//   node _bridge/recheck-evidence.mjs --all           定義済みの全 edge を順に

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config, matchesAny, tier } from '../.claude/scripts/lib/config.mjs'
import { checkEvidence } from '../.claude/scripts/lib/evidence.mjs'
import { entriesOf } from '../.claude/scripts/ledger.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const doAll = args.includes('--all')
const edgeArgs = args.filter(a => !a.startsWith('--'))

// ledger.mjs judge と同じ扱い:
//   - 「対象外」は evidence.reason だけで quote を持たない → 照合の対象外
//   - 「一致」「部分」は**在ること**の主張なので quote が要る（requireQuote / allowFiles を掛ける）
//   - それ以外（不一致・陳腐化・申し送り先が不在・対応先が誤り）は「無い」ことの主張も含むので
//     quote があれば照合するが、method だけでも通す
const ASSERTS_PRESENCE = ['一致', '部分']

function edgesToCheck() {
  const defined = (config().edges || []).map(e => `${e.from}->${e.to}`)
  if (doAll) return defined
  if (edgeArgs.length) return edgeArgs
  return ['req->bd']
}

function loadEdge(edgeId) {
  const p = join(ROOT, '.claude', 'coverage', 'edges', edgeId.replace('->', '-') + '.jsonl')
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

function allowFilesFor(edgeId) {
  const to = edgeId.split('->')[1]
  try { return tier(to)?.sources?.length ? tier(to).sources : null } catch { return null }
}

function checkOne(edgeId) {
  const units = loadEdge(edgeId)
  if (!units) return { edge: edgeId, error: `台帳が無い: .claude/coverage/edges/${edgeId.replace('->', '-')}.jsonl` }
  const allowFiles = allowFilesFor(edgeId)

  const stat = { checked: 0, ok: 0, drift: 0, notFound: 0, absence: 0, other: 0, skippedOutOfScope: 0 }
  const bad = []

  for (const r of units) {
    if (!Array.isArray(r.reqs)) continue
    // id は台帳と同じ作り方（entriesOf）に任せる。ここで作り直すとズレる。
    const byIdx = new Map(entriesOf(r).filter(x => x.kind === 'req').map(x => [x.idx, x.id]))
    r.reqs.forEach((q, i) => {
      if (!q.verdict) return
      if (q.verdict === '対象外') { stat.skippedOutOfScope++; return }
      const items = Array.isArray(q.evidence) ? q.evidence : (q.evidence ? [q.evidence] : [])
      const needsQuote = ASSERTS_PRESENCE.includes(q.verdict)
      const reqId = byIdx.get(i) || `${r.unitId}#${i}`

      // **ledger.mjs judge と同じ切り分けにする。**
      //   judge は quote を持つ項目だけを checkEvidence に掛け、method だけの項目は
      //   「無いことの証拠」として素通しする。ここを judge より厳しくすると、
      //   「部分」の判定に付いている**不足側の記録**（method だけ）が全部無効に見える。
      //   実測: 最初そう書いたところ 2 件が無効に出たが、どちらも壊れてはいなかった。
      //   requireQuote が効くのは「在る」と言いながら quote が 1 つも無いときだけ。
      const quoted = items.filter(x => x && typeof x.quote === 'string' && x.quote.trim())
      const methodOnly = items.filter(x => x && !(typeof x.quote === 'string' && x.quote.trim()) &&
                                            typeof x.method === 'string' && x.method.trim())
      stat.absence += methodOnly.length

      if (!quoted.length && needsQuote) {
        stat.checked++; stat.other++
        bad.push({ reqId, verdict: q.verdict, file: null, line: null, kind: '逐語引用が無い',
                   reason: '「在る」と主張する判定なのに quote を 1 つも持たない', req: q.text, unitLine: r.line })
        return
      }
      if (!items.length) {
        stat.checked++; stat.other++
        bad.push({ reqId, verdict: q.verdict, file: null, line: null, kind: 'evidence が無い',
                   reason: 'evidence が 1 件も記録されていない', req: q.text, unitLine: r.line })
        return
      }

      for (const e of quoted) {
        stat.checked++
        const v = checkEvidence(e, {
          strict: true,
          requireQuote: needsQuote,
          allowFiles: needsQuote ? allowFiles : null,
          matchAny: matchesAny,
        })
        if (v.ok) { stat.ok++; continue }
        const kind = v.actualLine ? '行番号がずれた'
          : /引用がファイル内に存在しない/.test(v.reason) ? '引用が見つからない'
          : /ファイルが存在しない/.test(v.reason) ? 'ファイルが無い'
          : 'その他'
        if (kind === '行番号がずれた') stat.drift++
        else if (kind === '引用が見つからない') stat.notFound++
        else stat.other++
        bad.push({ reqId, verdict: q.verdict, file: e.file || null, line: e.line ?? null,
                   kind, reason: String(v.reason).split('\n')[0].trim(),
                   actualLine: v.actualLine ?? null, req: q.text, unitLine: r.line })
      }
    })
  }
  return { edge: edgeId, allowFiles, stat, bad }
}

// ── 自己テスト ─────────────────────────────────────────────────────────
// 「無効 0 件」は、壊れを見つけられる道具が 0 を出したときだけ意味がある。
// 検出器が黙っているのか壊れを検出できないのかを区別するため、
// **実在する下位文書に対して、わざと壊した evidence** を通して分類を確かめる。
// docs/ には 1 バイトも書かない（読むだけ）。
if (args.includes('--selftest')) {
  const units = loadEdge('req->bd') || []
  let real = null
  outer: for (const r of units) for (const q of (r.reqs || [])) {
    const items = Array.isArray(q.evidence) ? q.evidence : (q.evidence ? [q.evidence] : [])
    const hit = items.find(e => e && e.quote && e.file && e.line)
    if (hit) { real = hit; break outer }
  }
  if (!real) { console.error('自己テスト不能: quote 付きの evidence が台帳に 1 件も無い'); process.exit(1) }
  const allow = allowFilesFor('req->bd')
  const opts = { strict: true, requireQuote: true, allowFiles: allow, matchAny: matchesAny }
  const cases = [
    ['そのまま（有効であるべき）', real, true, null],
    ['行番号を 200 行ずらす', { ...real, line: Number(real.line) + 200 }, false, '行番号がずれた'],
    ['引用を捏造する', { ...real, quote: real.quote + 'この文字列は実在しない捏造です' }, false, '引用が見つからない'],
    ['段外のファイルを引く', { ...real, file: 'docs/tab_app_requirements.md' }, false, 'その他'],
    ['引用を短くする', { ...real, quote: '短い' }, false, 'その他'],
  ]
  let failed = 0
  console.log('自己テスト（実在する evidence をわざと壊して、検出できるかを見る）')
  console.log(`  題材: ${real.file}:${real.line}`)
  for (const [name, ev, wantOk, wantKind] of cases) {
    const v = checkEvidence(ev, opts)
    const kind = v.ok ? null
      : v.actualLine ? '行番号がずれた'
      : /引用がファイル内に存在しない/.test(v.reason) ? '引用が見つからない'
      : /ファイルが存在しない/.test(v.reason) ? 'ファイルが無い'
      : 'その他'
    const pass = (v.ok === wantOk) && (wantOk || kind === wantKind)
    if (!pass) failed++
    console.log(`  ${pass ? 'PASS' : '**FAIL**'}  ${name} … ok=${v.ok}${kind ? ` / ${kind}` : ''}${pass ? '' : `（期待: ok=${wantOk}${wantKind ? ` / ${wantKind}` : ''}）`}`)
  }
  console.log(failed ? `\n**${failed} 件の自己テストが落ちました。この道具の「無効 0 件」は信用できません。**`
                     : '\n自己テスト全件 PASS。壊れは検出できる状態です。')
  process.exit(failed ? 1 : 0)
}

const results = edgesToCheck().map(checkOne)

if (asJson) {
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 1))
} else {
  for (const r of results) {
    console.log(`\n=== ${r.edge} ===`)
    if (r.error) { console.log('  ' + r.error); continue }
    const s = r.stat
    console.log(`  照合 ${s.checked} 件 / 有効 ${s.ok} / 行番号がずれた ${s.drift} / 引用が見つからない ${s.notFound} / 「無い」型 ${s.absence} / その他の無効 ${s.other}`)
    console.log(`  （「対象外」の判定 ${s.skippedOutOfScope} 件は evidence.reason だけなので照合の対象外）`)
    const invalid = s.drift + s.notFound + s.other
    if (!invalid) { console.log('  無効 0 件。記録済みの証拠はすべていまの下位文書と噛み合っています。'); continue }
    console.log(`\n  無効 ${invalid} 件:`)
    for (const b of r.bad) {
      console.log(`    [${b.kind}] ${b.reqId}`)
      console.log(`        判定 ${b.verdict} / ${b.file ?? '(file なし)'}:${b.line ?? '?'}${b.actualLine ? ` → 実際は ${b.actualLine} 行目付近` : ''}`)
      console.log(`        ${b.reason}`)
      console.log(`        要求: ${String(b.req || '').slice(0, 60)}`)
    }
  }
  const anyInvalid = results.some(r => r.stat && (r.stat.drift + r.stat.notFound + r.stat.other) > 0)
  console.log(anyInvalid
    ? '\n**無効が出ています。** 下位文書を直したなら、その判定の evidence を記録し直してください（ledger.mjs judge）。'
    : '\nすべて有効です。')
}
