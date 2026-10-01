// turn 105 §4：items105.json から、298 行の 2 単位（次のターンに回す）を除き、受け先（最初の印のファイルと節。09 章の 1 件は 8 節）ごとに 10 件までに分ける
// 使い方: node groups105.cjs <scratchpad>（groups105.json を書く）
const fs = require('fs'), path = require('path')
const S = process.argv[2]
const items = JSON.parse(fs.readFileSync(path.join(S, 'items105.json'), 'utf8'))
const now = items.filter(o => !(o.unitLine === 298 && !o.rejudge))
const later = items.filter(o => o.unitLine === 298 && !o.rejudge)
const key = o => {
  const a = o.id.includes('630b9903') ? o.at.find(w => w.section.startsWith('8.')) : o.at[0]
  return `${a.file} ${a.section.split(' ')[0]}`
}
const by = new Map()
for (const o of now) { const k = key(o); if (!by.has(k)) by.set(k, []); by.get(k).push(o.id) }
const groups = []
for (const [k, ids] of by) {
  const n = Math.ceil(ids.length / 10), size = Math.ceil(ids.length / n)
  for (let i = 0; i < ids.length; i += size) { groups.push(ids.slice(i, i + size)); console.log(`${k}：${ids.slice(i, i + size).length} 件`) }
}
fs.writeFileSync(path.join(S, 'groups105.json'), JSON.stringify({ label: 'turn 105 §4 本人の決定で直した要求と区切り 5', groups }, null, 1))
console.log(`判定 ${now.length} 件・${groups.length} 体。次のターンに回す ${later.length} 件（${[...new Set(later.map(o => o.unit))].join('・')}）`)
const dist = {}; for (const g of groups) dist[g.length] = (dist[g.length] || 0) + 1
console.log('1 体あたりの件数の分かれ方', JSON.stringify(dist))
