// evidence（ファイル:行＋逐語引用）を実ファイルと照合する。
//
// なぜ lib に切り出してあるか:
//   照合は 2 箇所で要る——レビュー／批評の出力（verify-evidence.mjs）と、
//   網羅台帳の判定（ledger.mjs judge）。同じ判定を 2 箇所に書くと必ず片方が腐る
//   （failures.md F7）。実装はここ 1 つに置き、両方から呼ぶ。
//
// なぜ台帳側でも照合するか:
//   coverage.js の判定プロンプトは「quote は後で実ファイルと機械照合され、
//   一致しない判定は無効になる」と書いていたが、照合する経路がどこにも無かった。
//   照合されないと分かっている主張は自己申告と同じで、レビューに報告文を渡して
//   PASS を出させていた F13 と同じ構造になる。書き込みの前に照合する。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

export function normalize(s) {
  return String(s).replace(/\r/g, '').replace(/[ \t　]+/g, ' ').trim()
}

// v40: 要求の印（<!-- req … -->）を取り除く。sep が '' なら印の前後の空白ごと、' ' なら印を空白 1 つにする
export function stripTags(s, sep) {
  return String(s).replace(/[ \t　]*<!--\s*req\b[^>]*?-->[ \t　]*/g, sep)
}

// 引用として認める最小の長さ。v22 は部分一致のみで長さの下限が無く、
// quote に「。」や見出し 1 行を入れても「一致」として記録できた（実測）。
// 4 文字の語や句読点は、どの下位文書にも在るので証拠にならない。
export const MIN_QUOTE = 12

// 見出しだけの引用を弾く。「# 基本設計」は、その節が在ることの証拠ではあっても
// 「上位の要求が降りていること」の証拠にはならない。
function isHeadingOnly(q) {
  const lines = q.split('\n').map(x => x.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(l => /^#{1,6}\s/.test(l) || /^[|\-=\s]+$/.test(l))
}

/**
 * { file, line, quote } を実ファイルと照合する。
 *
 * opts:
 *   strict     … 行番号のズレを警告ではなく**不合格**にする（台帳の判定・水平展開の是正済み）。
 *                レビューは hunk で行がずれるので既定（warn）のまま。
 *   requireQuote … method だけの evidence を受け付けない（「在る」と主張する判定）。
 *   allowFiles … 許容するファイルの glob 配列。台帳では **edge.to の段のソース**を渡す。
 *                v22 は evidence.file を見ていなかったので、上位文書自身や
 *                .claude/project.json を引用しても「一致」になった（実測）。
 *   matchAny   … glob 判定関数（呼び出し側から matchesAny を渡す。循環 import を避けるため）
 *
 * 返り値: { ok, reason?, warn?, actualLine? }
 */
export function checkEvidence(e, opts = {}) {
  if (!e || typeof e !== 'object') return { ok: false, reason: 'evidence がオブジェクトではない' }
  if (typeof e.file !== 'string' || !e.file) return { ok: false, reason: 'evidence.file が無い' }

  if (opts.allowFiles && opts.matchAny && !opts.matchAny(e.file, opts.allowFiles)) {
    return { ok: false, reason:
      `evidence.file がこの段の成果物ではない: ${e.file}\n` +
      `      この判定は「下位に降りていること」の証拠なので、引用元は下位の成果物でなければならない。\n` +
      `      対象: ${opts.allowFiles.join(' ')}` }
  }

  const p = join(ROOT, e.file)
  if (!existsSync(p)) return { ok: false, reason: `ファイルが存在しない: ${e.file}` }

  const q = e.quote == null ? '' : normalize(e.quote)
  if (!q) {
    if (opts.requireQuote) {
      return { ok: false, reason:
        'quote（逐語引用）が無い。method は「無いことを確かめた方法」なので、\n' +
        '      「在る」と判定するときの証拠には使えない。該当箇所を開いて逐語で引用すること。' }
    }
    // 「無い」ことの証拠は逐語を持てない。method（grep した語と件数）があれば
    // 「照合不能だが記載あり」として通し、absence を立てて区別する。
    if (typeof e.method === 'string' && e.method.trim()) return { ok: true, absence: true }
    return { ok: false, reason: 'quote も method も無い（在るなら逐語引用、無いなら確かめた方法を書く）' }
  }

  // v40: 印を除いた長さで数える（印だけ・印でかさ上げした引用を通さない）
  if (normalize(stripTags(q, '')).length < MIN_QUOTE) {
    return { ok: false, reason:
      `引用が短すぎる（${q.length} 文字 / 最低 ${MIN_QUOTE} 文字）: ${JSON.stringify(q)}\n` +
      `      短い語はどの文書にも在るので、照合しても何も確かめたことにならない。` }
  }
  if (isHeadingOnly(q)) {
    return { ok: false, reason:
      `引用が見出し・区切り行だけ: ${JSON.stringify(q.slice(0, 40))}\n` +
      `      節が在ることではなく、**要求が降りている本文**を引用すること。` }
  }

  const lines = readFileSync(p, 'utf8').split('\n')
  const n = Number(e.line) || 0

  // v40: 要求の印（<!-- req … -->）は照合で無視する。実測（turn 125）: 判定の後に印を行の中の言葉の間に足したら、
  // その行を引用していた 06 章の 4 件の根拠が「引用がファイル内に存在しない」になり、判定し直しになった。
  // 印の前後の空白ごと取った形と、印を 1 つの空白にした形の両方で照合する（日本語は空白なし・英語は空白ありで足されるため）
  const views = [l => normalize(stripTags(l, '')), l => normalize(stripTags(l, ' '))]
  const qs = [...new Set([q, normalize(stripTags(q, '')), normalize(stripTags(q, ' '))])].filter(Boolean)
  const hit = text => qs.some(x => text.includes(x))

  // 指定行の周辺（±3行）にあるか
  if (views.some(v => hit(lines.slice(Math.max(0, n - 4), n + 3).map(v).join('\n')))) return { ok: true }

  if (views.some(v => hit(lines.map(v).join('\n')))) {
    const at = lines.findIndex(l => views.some(v => qs.some(x => v(l).includes(x.split('\n')[0]))))
    if (opts.strict) {
      return { ok: false, reason:
        `引用は在るが行番号が違う（指定 ${n || '?'} 行目 / 実際は ${at + 1} 行目付近）。\n` +
        `      行番号を直して記録し直すこと。ずれたまま溜まると、後から照合できなくなる。`,
        actualLine: at + 1 }
    }
    return { ok: true, warn: `行番号がずれている（実際は ${at + 1} 行目付近）`, actualLine: at + 1 }
  }
  return { ok: false, reason: '引用がファイル内に存在しない（逐語ではない、または捏造）' }
}

// 任意の JSON から { file, quote } を持つオブジェクトをすべて拾う
export function collectEvidence(doc) {
  const out = []
  ;(function walk(node, path = '$') {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`))
    if (node && typeof node === 'object') {
      // quote か method のどちらかを持つ evidence を拾う（method だけの「無い」型も照合対象に含める）
      if (typeof node.file === 'string' && (typeof node.quote === 'string' || typeof node.method === 'string')) out.push({ path, ...node })
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }
  })(doc)
  return out
}
