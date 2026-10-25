// recheck-evidence の --json の結果を、前の結果と組（要求 ID・ファイル・種類）で比べる（読むだけ）
// 使い方: node recheck_cmp.cjs <後の json> <前の json>
const after = require(process.argv[2]).results[0]
const before = require(process.argv[3]).results[0]
console.log(JSON.stringify(after.stat))
const by = {}
for (const x of after.bad) { const m = JSON.stringify(x).match(/basic_design\/(\d\d)/); const k = m ? m[1] : '?'; by[k] = (by[k] || 0) + 1 }
console.log(by)
const key = x => x.reqId + '|' + x.file + '|' + x.kind
const a = new Set(before.bad.map(key)), b = new Set(after.bad.map(key))
console.log('後だけ', [...b].filter(x => !a.has(x)), '前だけ', [...a].filter(x => !b.has(x)).length)
