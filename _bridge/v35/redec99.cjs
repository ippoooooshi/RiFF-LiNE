// turn 99 §4：01・02・08・09 章の未分解の単位ごとに、HEAD の台帳で同じ行にあった前の単位の分け方を写し、
// 引用の断片だけ今の本文に合わせた（前の台帳はこのターンの前のコミット 74ba0f1）分解の案を作る（台帳には書かない。書くのは scratchpad の redec99/*.json と一覧だけ）。
// 使い方: node redec99.cjs <scratchpad>（cwd はリポジトリ）
const fs = require('fs'), path = require('path'), { execSync } = require('child_process')
const S = process.argv[2]
const OUT = path.join(S, 'redec99'); fs.mkdirSync(OUT, { recursive: true })
const now = new Map(fs.readFileSync('.claude/coverage/edges/bd-dd.jsonl', 'utf8').split('\n').filter(Boolean).map(l => { const u = JSON.parse(l); return [u.unitId, u] }))
const head = execSync('git show 74ba0f1:.claude/coverage/edges/bd-dd.jsonl', { maxBuffer: 1 << 28 }).toString().split('\n').filter(Boolean).map(l => JSON.parse(l))
const applied = [...JSON.parse(fs.readFileSync(path.join(S, 'cite99_applied.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(S, 'cite99_applied2.json'), 'utf8'))]
const files = ['01_architecture', '02_data_model', '08_error_logging', '09_nonfunctional']
const cite = /[、（]?`docs\/tab_app_requirements\.md:\d+`[）]?/g
function carry(s, file, newText) {
  let t = s
  for (const a of applied.filter(a => a.file === file)) if (t.includes(a.before)) t = t.replace(a.before, a.after)
  if (newText.includes(t)) return { t, how: t === s ? 'そのまま' : '置き換えを当てた' }
  // 置き換えの一部だけを含む断片：引用そのものを消してみる
  const u = t.replace(cite, m => (m.startsWith('（') && m.endsWith('）')) ? '' : (m.startsWith('、') ? (m.endsWith('）') ? '）' : '') : ''))
  if (newText.includes(u) && u.trim()) return { t: u, how: '引用を消した' }
  return { t, how: '合わない' }
}
const report = []
for (const f of files) {
  const file = `docs/basic_design/${f}.md`
  const pend = [...now.values()].filter(u => u.file === file && !(u.reqs || []).length && !(u.skips || []).length)
  for (const u of pend) {
    // 前の単位：HEAD にあって今は無い（ハッシュが変わった）、同じ行・同じ種類で、分解済みのもの
    const cands = head.filter(h => h.file === file && h.line === u.line && h.kind === u.kind && ((h.reqs || []).length || (h.skips || []).length) && !now.has(h.unitId))
    if (!cands.length) { report.push(`${u.unitId} L${u.line} 前の単位なし（新しい単位）`); continue }
    // 同じ行に複数あるときは、置き換えを当てた前の本文が今の本文と一致するものを選ぶ
    let prev = cands.find(h => { let t = h.text; for (const a of applied.filter(a => a.file === f)) if (t.includes(a.before)) t = t.replace(a.before, a.after); return t === u.text }) || (cands.length === 1 ? cands[0] : null)
    if (!prev) { report.push(`${u.unitId} L${u.line} 前の単位が決まらない（候補 ${cands.length}）`); continue }
    const out = [], notes = []
    for (const r of prev.reqs || []) {
      const fr = carry(r.from, f, u.text); const ws = (r.with || []).map(w => carry(w, f, u.text))
      const x = { text: r.text, from: fr.t }; if (ws.length) x.with = ws.map(w => w.t)
      out.push(x); notes.push(`R from ${fr.how}${ws.some(w => w.how !== 'そのまま') ? ` / with ${ws.map(w => w.how).join(',')}` : ''}`)
    }
    for (const k of prev.skips || []) { const sk = carry(k.skip, f, u.text); out.push({ skip: sk.t, why: k.why }); notes.push(`S ${sk.how}`) }
    fs.writeFileSync(path.join(OUT, `${u.unitId.split(':')[1].replace('~0', '')}.json`), JSON.stringify(out, null, 1))
    report.push(`${u.unitId} L${u.line} ← ${prev.unitId.split(':')[1]}  要求 ${(prev.reqs || []).length}・skip ${(prev.skips || []).length}  ${notes.join(' | ')}`)
  }
}
console.log(report.join('\n'))
