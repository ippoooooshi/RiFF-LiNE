#!/usr/bin/env node
// 相互参照が実在ファイル・実在節を指すか検証する。
//
// なぜこれがあるか:
//   人手の監査でしか見つからず、しかも「リンク切れを指摘する監査記録自身が
//   40本のリンク切れを持っていた」ことがあった。ファイル名だけの省略形は
//   参照元ディレクトリによって壊れたり壊れなかったりするため、書いた本人には
//   気づけない。走査対象は docs/** と .claude/** の両方（片側だけ直して
//   もう片側を腐らせるのを防ぐ）。
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, sep, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, read, allFiles, matchesAny, isUnder, toPosix, json } from './lib/config.mjs'

const TARGETS = ['docs/**/*.md', '.claude/**/*.md', 'CLAUDE.md']
const files = allFiles().filter(f => matchesAny(f, TARGETS))

const findings = []
const advisories = []   // エラーにしない体裁の指摘（終了コードに影響しない）

// 見出し番号の正規化。
// 旧実装は /^§?\s*([\d.]+)/ で「8. 運用ルール」から末尾ピリオド込みの "8." を
// 取っていたため、#8 のような整数アンカーが一致せず 465 件の誤検知になった。
// 番号は必ず末尾のピリオドを落とし、「8」「8.」「§8」の全形を登録する。
function numberForms(raw) {
  const n = String(raw).replace(/^§/, '').replace(/\.+$/, '').trim()
  if (!n) return []
  return [n, n + '.', '§' + n, '§' + n + '.']
}

function headingsOf(rel) {
  const src = read(rel)
  const hs = new Set()
  let fence = false
  src.split('\n').forEach(l => {
    if (/^```/.test(l)) { fence = !fence; return }
    if (fence) return
    const m = l.match(/^#{1,6}\s+(.*)$/)
    if (!m) return
    const t = m[1].trim()
    hs.add(t)
    hs.add(t.toLowerCase())
    // 「8. 運用ルール」「8.1 既知のギャップ」「§4.1 …」いずれの書き方も、
    // 「8」「8.」「§8」のどれで指されても一致させる
    const num = t.match(/^§?\s*([\d]+(?:\.[\d]+)*)\.?/)
    if (num) numberForms(num[1]).forEach(v => hs.add(v))
    hs.add(t.replace(/\s+/g, '-').toLowerCase())
  })
  return hs
}
const headingCache = new Map()
function headings(rel) {
  if (!headingCache.has(rel)) headingCache.set(rel, headingsOf(rel))
  return headingCache.get(rel)
}

function stripCode(src) {
  // コードスパン・コードフェンス内は記法の説明・引用なので検査対象外
  return src.replace(/```[\s\S]*?```/g, m => m.replace(/[^\n]/g, ' '))
            .replace(/`[^`\n]*`/g, m => ' '.repeat(m.length))
}

function resolveRel(fromFile, target) {
  const p = normalize(join(dirname(fromFile), target)).split(sep).join(posix.sep)
  return p
}

for (const f of files) {
  const src = stripCode(read(f))
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    const no = i + 1

    // Wikilink [[相対パス#見出し]]
    for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const raw = m[1]
      // リンクの直後に書いた番号（例 `[[13_design_decision_points.md#4]]C12`）を覚えておく（v34 T23）
      // L123 のような行番号の書き方は番号ではないので見ない
      const idAfter0 = (line.slice(m.index + m[0].length).match(/^\s*([A-Z]{1,3}-?\d{1,3})(?![0-9A-Za-z])/) || [])[1] || null
      const idAfter = idAfter0 && !/^L\d+$/.test(idAfter0) ? idAfter0 : null
      // 生の startsWith('docs/') は Windows（区切りが \\）で常に真になり、
      // docs 内の正しい Wikilink まで全部弾いていた（2311 件の誤検知）。
      // 比較は必ず isUnder() を通す。
      if (!isUnder(f, 'docs')) {
        findings.push({ file: f, line: no, kind: 'wikilink-outside-docs', link: raw,
          why: '.claude/ からは Markdown 相対リンクを使う。Wikilink は docs/rules/ に解決してしまい常に壊れる。' })
        continue
      }
      const [path, anchor] = raw.split('#')
      // 省略形（ファイル名だけ）は、まず解決するかどうかで分ける。
      // 旧実装は path.includes('/') の有無だけで弾いていたため、参照元と
      // 同じディレクトリに実在する正当な参照まで 1289 件誤検知していた。
      //   解決する   → 体裁の助言（エラーにしない。移動時に壊れうる点だけ伝える）
      //   解決しない → 通常の missing-file として扱う
      if (!path.includes('/')) {
        const resolved = resolveRel(f, path)
        if (existsSync(join(ROOT, resolved))) {
          advisories.push({ file: f, line: no, kind: 'shorthand-resolvable', link: raw, resolved,
            why: '同一ディレクトリのファイル名参照。いまは解決するが、どちらかを移動すると壊れる。' })
          if (anchor) check(f, no, resolved, anchor, raw, idAfter)
          continue
        }
        findings.push({ file: f, line: no, kind: 'shorthand-broken', link: raw, resolved,
          why: 'ファイル名だけの省略形で、参照元から解決できない。参照元からの相対パスで書く。' })
        continue
      }
      check(f, no, resolveRel(f, path), anchor, raw, idAfter)
    }

    // Markdown 相対リンク [text](path#anchor)
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = m[1]
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const [path, anchor] = raw.split('#')
      if (!path) continue
      check(f, no, resolveRel(f, path), anchor, raw)
    }
  })
}

// 節の本文（その見出しから、同じか上の階層の次の見出しの手前まで）。コードフェンスの中も含める。
function sectionBody(rel, anchor) {
  const src = read(rel)
  if (src == null) return null
  const want = new Set(numberForms(anchor))
  const lines = src.split('\n')
  let start = -1, level = 0, fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^```/.test(l)) { fence = !fence; continue }
    if (fence) continue
    const h = l.match(/^(#{1,6})\s+(.*)$/)
    if (!h) continue
    if (start >= 0 && h[1].length <= level) return lines.slice(start, i).join('\n')
    if (start < 0) {
      const num = h[2].trim().match(/^§?\s*([\d]+(?:\.[\d]+)*)\.?/)
      if (num && numberForms(num[1]).some(v => want.has(v))) { start = i; level = h[1].length }
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : null
}

function numberedHeadings(rel) {
  const src = read(rel) || ''
  const out = []
  let fence = false
  for (const l of src.split('\n')) {
    if (/^```/.test(l)) { fence = !fence; continue }
    if (fence) continue
    const h = l.match(/^#{1,6}\s+§?\s*([\d]+(?:\.[\d]+)*)\.?(\s|$)/)
    if (h) out.push(h[1])
  }
  return out
}

function check(from, no, target, anchor, raw, idAfter = null) {
  if (!existsSync(join(ROOT, target))) {
    findings.push({ file: from, line: no, kind: 'missing-file', link: raw, resolved: target,
      why: '参照先ファイルが存在しない。' })
    return
  }
  if (!anchor) return
  if (!target.endsWith('.md')) return
  const hs = headings(target)
  const a = anchor.trim()
  const candidates = [a, a.toLowerCase(), '§' + a, a.replace(/^§/, ''), ...numberForms(a)]
  if (candidates.some(c => hs.has(c))) {
    // リンクの直後に番号があるなら、その番号が行き先の節に書かれているか（v34 T23）。
    // 実測（2026-09-28、turn 89 から 90）: `[[13_design_decision_points.md#5]]C11` のように、C11 が
    // 4 節（カテゴリC）にあるのに 5 節を指すリンクが 5 か所あり、節は実在するので検査を通っていた。
    // 判定役が「リンク先に C11 が無い」と読んで迷い、人が見つけるまで残った。
    // **番号が行き先の節の本文に 1 回も出てこないときだけ**指摘する（節の見出しに番号の範囲を書く形は見ない）。
    // **別の節に在るときだけ**エラーにする（番号の節の指し違いと言い切れる）。どこにも無いときは助言にとどめる
    // （「[[15_…#6]]C6運用」のように、別の文書の番号を行き先の節の話として書く形があるため）。
    if (idAfter && /^[\d.§]+$/.test(a)) {
      const idRe = new RegExp(`(^|[^A-Za-z0-9])${idAfter.replace('-', '\\-')}(?![0-9])`)
      const body = sectionBody(target, a)
      if (body != null && !idRe.test(body)) {
        const depth = a.replace(/^§/, '').split('.').length
        const other = numberedHeadings(target).filter(n => n.split('.').length === depth && n !== a.replace(/^§/, '').replace(/\.$/, ''))
          .find(n => idRe.test(sectionBody(target, n) || ''))
        if (other) {
          findings.push({ file: from, line: no, kind: 'id-in-other-section', link: raw + ']]' + idAfter, resolved: target, anchor: a,
            why: `リンクの直後の ${idAfter} は、行き先の ${a} 節ではなく ${other} 節にある。#${other} を指すこと。` })
        } else {
          advisories.push({ file: from, line: no, kind: 'id-not-in-target', link: raw + ']]' + idAfter, resolved: target,
            why: `リンクの直後の ${idAfter} が、行き先の文書に見当たらない（別の文書の番号を書いている形かもしれない）。` })
        }
      }
    }
    return
  }
  findings.push({ file: from, line: no, kind: 'missing-heading', link: raw, resolved: target, anchor: a,
    why: '参照先ファイルにその節が存在しない。「反映済み」と書く前にその節を開いて確認すること。' })
}

// ── ドキュメントが案内するスクリプトが実在するか ────────────────────────
// リンク検査はコードブロックの中を見ない。そこに `node .claude/scripts/<名前>` と
// 書いてあれば、AI も人もそのまま実行する。実在しない名前を書いた実例が F60。
// **「もっともらしい API 名を書かない」（core.md §3）を、配っている側で機械化する。**
{
  // 実在判定は**このファイル自身の隣**を見る。ROOT 側の走査に頼ると、
  // .claude を別の場所から動かしている構成で全件が「存在しない」になる。
  const HERE = dirname(fileURLToPath(import.meta.url))
  const existing = new Set(readdirSync(HERE).filter(n => n.endsWith('.mjs')))
  const re = /node\s+(?:"[^"]*\.claude\/scripts\/|'[^']*\.claude\/scripts\/|(?:[^\s"']*\/)?\.claude\/scripts\/)([A-Za-z0-9_.-]+\.mjs)/g
  for (const f of files) {
    const src = read(f)
    if (src == null) continue
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const name = m[1]
        // <名前> のような明示的なプレースホルダは対象外
        if (/^<.*>$/.test(name)) continue
        if (!existing.has(name)) {
          findings.push({ file: f, line: i + 1, kind: 'missing-script', link: m[0], resolved: `.claude/scripts/${name}`,
            why: `そのスクリプトは存在しない。実在する名前: ${[...existing].sort().join(' ')}` })
        }
      }
    })
  }
}

if (json) console.log(JSON.stringify({ scanned: files.length, findings, advisories }, null, 2))
else {
  findings.forEach(x => console.log(`${x.file}:${x.line}  [${x.kind}]  ${x.link}\n    ${x.why}`))
  console.log(`\ncheck-docs-links: ${findings.length} 件 / 走査 ${files.length} ファイル`)
  if (advisories.length) {
    const byKind = {}
    advisories.forEach(a => byKind[a.kind] = (byKind[a.kind] || 0) + 1)
    console.log(`\n助言（終了コードには影響しません）:`)
    Object.entries(byKind).forEach(([k, n]) => console.log(`  ${k}: ${n} 件`))
    console.log(`  --show-advisories で全件表示`)
    if (process.argv.includes('--show-advisories')) {
      advisories.forEach(a => console.log(`    ${a.file}:${a.line}  ${a.link} → ${a.resolved}`))
    }
  }
}
// process.exit() は、パイプへ書いている途中の大きな出力（--json）を切ってしまう（v34 で実測：64KB で切れた）。
// 終了コードだけ置いて、出力を書き終えてから終わる。
process.exitCode = findings.length ? 1 : 0
