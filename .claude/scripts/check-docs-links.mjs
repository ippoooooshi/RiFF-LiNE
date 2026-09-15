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
          if (anchor) check(f, no, resolved, anchor, raw)
          continue
        }
        findings.push({ file: f, line: no, kind: 'shorthand-broken', link: raw, resolved,
          why: 'ファイル名だけの省略形で、参照元から解決できない。参照元からの相対パスで書く。' })
        continue
      }
      check(f, no, resolveRel(f, path), anchor, raw)
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

function check(from, no, target, anchor, raw) {
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
  if (candidates.some(c => hs.has(c))) return
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
process.exit(findings.length ? 1 : 0)
