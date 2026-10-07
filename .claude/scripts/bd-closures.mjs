#!/usr/bin/env node
// 基本設計の「閉じる文」を拾う（v41、読むだけ）。
//
// なぜ要るか（turn 126・127 の実測）:
//   基本設計の中で、範囲を閉じる文・既定に任せる文と、後から別の章に足した決定がぶつかっていた。
//   - 03:224「Ctrl+W／Alt+F4 は Electron と OS の既定挙動をそのまま使い、アプリ側で再定義しない」と、
//     01 章 4 節「メニューバーは Menu.buildFromTemplate で自前で作る」（自前のメニューを置くと Electron の既定の Ctrl+W は消える）
//   - 04:143「範囲を確定したあとにできることは次の一式で閉じる。ここに無い操作を選択範囲へ足さない」と、
//     03 章の範囲の複製（Ctrl+D）・範囲の音価のまとめ変更・04 章 5 節の範囲へのスラー付与
//   どちらも、詳細設計を書く段になって初めて見つかった。網羅台帳は上位と下位を突き合わせるが、
//   **同じ段の中どうし**は突き合わせない。閉じる文を先に拾い、ほかの箇所と両立するかを確かめる材料にする
//   （workflows/bd-audit.js が使う）。
//
// 拾う形（2 つ。行ごと、見出しとコードの区切りは除く）:
//   strong … 「ここに無い」「ほかに〜足さない」「で閉じる」「一式で」「に限る」「以外は〜しない」「再定義しない」
//            「既定挙動・既定のまま・既定に任せる」「OS／Electron に任せる」「当てない」「提供しない」
//   only   … 「のみを／のみで…」「だけを〜する」のような限定
//   実測（2026-10-08 の基本設計 16 章）：strong 46 行・only 86 行
//
//   node .claude/scripts/bd-closures.mjs [--tier bd] [--file <部分一致>] [--kind strong|only|all] [--json]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT, tierFiles } from './lib/config.mjs'

const argv = process.argv.slice(2)
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null }
const asJson = argv.includes('--json')
const tierId = opt('tier') || 'bd'
const fileFilter = opt('file')
const kindOpt = opt('kind') || 'all'

export const PATTERNS = {
  strong: /(ここに無い|ほかに?.{0,8}(足さない|設けない|持たない|置かない|加えない)|で閉じ|一式で|に限(る|り|定)|だけ(で|に|を)?閉じ|以外(は|の)[^。]{0,15}(しない|不可|禁止|足さない|受け付けない)|再定義しない|既定(挙動|の動き|のまま|に任せ|に委ね)|(OS|Electron)[^。]{0,10}(任せ|委ね)|当てない|提供しない)/,
  only: /(のみ(を|に|で|と|が)|だけ(を|に|で|が|は)[^。]{0,6}(する|とする|扱う|置く|持つ|受け付ける))/,
}

let files = []
try { files = tierFiles(tierId) } catch (e) { console.error(`段 ${tierId} のファイルが引けません: ${e.message}`); process.exit(1) }
if (fileFilter) files = files.filter(f => f.includes(fileFilter))

const items = []
for (const f of files) {
  let lines = []
  try { lines = readFileSync(join(ROOT, f), 'utf8').split('\n') } catch { continue }
  let inCode = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { inCode = !inCode; return }
    if (inCode || /^#{1,6}\s/.test(l) || !l.trim()) return
    for (const kind of ['strong', 'only']) {
      if (kindOpt !== 'all' && kindOpt !== kind) continue
      if (!PATTERNS[kind].test(l)) continue
      const text = l.trim()
      items.push({ id: createHash('sha256').update(`${f}\u0000${text}`).digest('hex').slice(0, 10), file: f, line: i + 1, kind, text: text.slice(0, 400) })
      break
    }
  })
}

const byFile = {}
for (const x of items) byFile[x.file] = (byFile[x.file] || 0) + 1
if (asJson) console.log(JSON.stringify({ tier: tierId, count: items.length, byFile, items }, null, 2))
else {
  console.log(`閉じる文の候補：${items.length} 行（段 ${tierId}）`)
  for (const [f, n] of Object.entries(byFile)) console.log(`  ${f}: ${n}`)
}
