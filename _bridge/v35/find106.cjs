// turn 106 §2：req->bd の判定のうち、引用が HEAD の本文で今回直した行（02:270・03:162）にあったもの、または recheck で無効のものの entryId を出す（読むだけ）
// 使い方: node find106.cjs <rbd.json>（cwd はリポジトリ）
const fs = require('fs'), { execFileSync } = require('child_process')
const changed = { 'docs/basic_design/02_data_model.md': [270], 'docs/basic_design/03_screens_ui_pc.md': [162] }
const head = {}
const hl = f => (head[f] ||= execFileSync('git', ['show', `HEAD:${f}`], { maxBuffer: 1 << 26 }).toString().split('\n'))
const invalid = new Set(fs.readFileSync(process.argv[2], 'utf8').match(/docs\/tab_app_requirements\.md:[0-9a-f]{8}~\d+#k[0-9a-f]+/g) || [])
const out = []
for (const l of fs.readFileSync('.claude/coverage/edges/req-bd.jsonl', 'utf8').split('\n').filter(Boolean)) {
  const u = JSON.parse(l)
  for (const r of u.reqs || []) {
    if (!r.verdict) continue
    const evs = Array.isArray(r.evidence) ? r.evidence : [r.evidence, ...((r.evidence && r.evidence.more) || [])]
    const on = evs.filter(e => e && e.file && changed[e.file] && e.quote).some(e => {
      const lines = hl(e.file)
      for (let d = 0; d <= 3; d++) for (const ln of [e.line + d, e.line - d]) if (lines[ln - 1] && lines[ln - 1].includes(e.quote)) return changed[e.file].includes(ln)
      return false
    })
    if (on) out.push({ unitId: u.unitId, text: r.text })
  }
}
const ids = new Set(invalid)
for (const o of out) {
  const j = JSON.parse(execFileSync('node', ['.claude/scripts/ledger.mjs', 'show', 'req-bd', o.unitId]).toString())
  const e = (j.entries || []).filter(x => x.text === o.text)
  if (e.length === 1) ids.add(e[0].entryId); else console.error(`決まらない ${o.unitId} ${o.text.slice(0, 30)}`)
}
for (const id of ids) console.log(`${invalid.has(id) ? '無効' : '直した行'} ${id}`)
console.error(`計 ${ids.size}（無効 ${invalid.size}）`)
