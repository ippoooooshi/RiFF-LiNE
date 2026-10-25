// turn 105 §2：分解し直した 02 章の単位の印を、詳細設計の中で新しい断片の ID に付け替える。
// 文が同じ要求は前の印の場所に、新しく足した要求は受け先の注の後ろに置く（本文は §3 で直す）。使い方: node retag105.cjs（cwd はリポジトリ）
const fs = require('fs')
const D = 'docs/detailed_design/'
const swap = {
  'data-model-persistence.md': [
    ['02:1bcf1b71.c483', '02:93ed52ba.c483'], ['02:1bcf1b71.9ff1', '02:93ed52ba.9ff1'], ['02:1bcf1b71.a925', '02:93ed52ba.a925'],
    ['02:1bcf1b71.a718', '02:93ed52ba.a718'],
    ['<!-- req 02:1bcf1b71.6355 -->', '<!-- req 02:93ed52ba.936f --> <!-- req 02:4d79cf66.3726 --> <!-- req 02:4d79cf66.c15e --> <!-- req 02:4d79cf66.a8ab -->'],
    ['02:1bcf1b71.3b2f', '02:5d94c9b4.3b2f'], ['02:1bcf1b71.14d6', '02:5d94c9b4.14d6'],
    ['02:e0d93190.11a2', '02:ed7744dd.11a2'], ['02:e0d93190.0553', '02:ed7744dd.0553'], ['02:e0d93190.e01d', '02:ed7744dd.e01d'],
    ['02:e0d93190.633c', '02:ed7744dd.633c'],
    ['<!-- req 02:e0d93190.7522 -->', '<!-- req 02:ed7744dd.5884 --> <!-- req 02:ed7744dd.6ddf -->'],
  ],
  'editing-core.md': [
    ['02:b12a9f13.5dfb', '02:06ab5f73.5dfb'], ['02:b12a9f13.268f', '02:06ab5f73.268f'], ['02:b12a9f13.a059', '02:06ab5f73.a059'],
    ['**注（基本設計に無いもの）**：拍子の「直前を継ぐ」を', '<!-- req 02:06ab5f73.5999 --> **注（基本設計に無いもの）**：拍子の「直前を継ぐ」を'],
  ],
  'part-tuning-management.md': [
    ['02:668775f1.85b5', '02:c29ee1a3.85b5'], ['<!-- req 02:668775f1.6d3f -->', '<!-- req 02:c29ee1a3.33a7 --> <!-- req 02:c29ee1a3.823e -->'],
    ['02:668775f1.86bd', '02:c29ee1a3.86bd'],
    ['02:cd6ebe4e.d319', '02:bf9bd4c4.7e38'], ['02:cd6ebe4e.d0a5', '02:f23966da.d0a5'],
    ['- パート識別色の既定パレットの色の数と値（基本設計は「8色程度の既定パレット」と書く）', '- パート識別色の既定パレットの色の数と値（基本設計は「8色程度の既定パレット」と書く） <!-- req 02:bf9bd4c4.ef1e --> <!-- req 02:f23966da.c306 -->'],
    ['02:47daad26.40a4', '02:9caa0c41.40a4'], ['02:47daad26.c020', '02:9caa0c41.0369'], ['02:47daad26.817c', '02:9caa0c41.2029'],
    ['02:47daad26.2662', '02:9caa0c41.4b81'], [' <!-- req 02:47daad26.3990 -->', ''],
    ['02:f7f0fefb.055c', '02:2ce0f251.ddb6'], ['02:f7f0fefb.9d4d', '02:2ce0f251.9d4d'],
    ['02:427f3c14.9717', '02:148d83ee.3d94'],
  ],
}
for (const [f, pairs] of Object.entries(swap)) {
  let t = fs.readFileSync(D + f, 'utf8')
  for (const [a, b] of pairs) {
    const n = t.split(a).length - 1
    if (n !== 1) { console.error(`${f}：「${a.slice(0, 40)}」が ${n} 回`); process.exit(1) }
    t = t.replace(a, b)
  }
  fs.writeFileSync(D + f, t)
  console.log(`${f}：${pairs.length} か所`)
}
