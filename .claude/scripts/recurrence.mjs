#!/usr/bin/env node
// 同じ箇所への2回目以降の修正を「再発」として検出する。
//
// なぜこれがあるか:
//   是正だけして再発防止を足さないと、個別の不具合は直るが同じクラスが
//   別の場所・同じ場所で再発する。人間もAIも「前にもここを直した」を覚えていない。
//   git は覚えている。
//
// 使い方:
//   node .claude/scripts/recurrence.mjs [--since 60] [--min 2] [--json]
//     --since  遡る日数（既定 90）
//     --min    再発と見なす修正回数（既定 2）
import { spawnSync } from 'node:child_process'
import { ROOT, matchesAny, json, codeGlobs } from './lib/config.mjs'

const argv = process.argv.slice(2)
const num = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : dflt }
const SINCE = num('--since', 90)
const MIN = num('--min', 2)

// `\b` は ASCII の単語境界にしか立たない（`/\b修正\b/.test('再生の不具合を修正')` は false）。
// 日本語のコミットメッセージが 1 件も「修正」として拾えず、常に「再発なし」と出ていた。
// 英語は従来どおり単語境界、日本語は部分一致で見る。
const FIX = /(?<![A-Za-z0-9_])(fix|bugfix|hotfix|revert)(?![A-Za-z0-9_])|修正|不具合|バグ|是正/i
const CODE = codeGlobs()   // project.json の paths.code。固定しない

function git(...a) {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : ''
}

const raw = git('log', `--since=${SINCE}.days`, '--name-only', '--pretty=format:%x01%H%x02%ad%x02%s', '--date=short')
if (!raw.trim()) {
  console.log('git 履歴が読めません（リポジトリ外、または該当期間にコミットがありません）。')
  process.exit(0)
}

const commits = raw.split('\x01').filter(Boolean).map(chunk => {
  const [head, ...rest] = chunk.split('\n')
  const [hash, date, subject] = head.split('\x02')
  return { hash: (hash || '').slice(0, 8), date, subject: subject || '', files: rest.map(s => s.trim()).filter(Boolean) }
})

const fixes = commits.filter(c => FIX.test(c.subject))
const byFile = new Map()
for (const c of fixes) {
  for (const f of c.files) {
    if (!matchesAny(f, CODE)) continue
    if (!byFile.has(f)) byFile.set(f, [])
    byFile.get(f).push({ hash: c.hash, date: c.date, subject: c.subject })
  }
}

const recurrent = [...byFile.entries()]
  .filter(([, cs]) => cs.length >= MIN)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([file, cs]) => ({ file, count: cs.length, commits: cs }))

if (json) console.log(JSON.stringify({ sinceDays: SINCE, minFixes: MIN, fixCommits: fixes.length, recurrent }, null, 2))
else {
  if (!recurrent.length) {
    console.log(`再発なし（過去 ${SINCE} 日の修正コミット ${fixes.length} 件、同一ファイル ${MIN} 回以上の修正は 0）`)
  } else {
    console.log(`再発の疑い（過去 ${SINCE} 日、修正コミット ${fixes.length} 件）\n`)
    recurrent.forEach(r => {
      console.log(`${r.file}  ${r.count} 回`)
      r.commits.forEach(c => console.log(`   ${c.date}  ${c.hash}  ${c.subject}`))
      console.log()
    })
    console.log('同じ箇所を繰り返し直しているなら、対症療法になっている可能性があります。')
    console.log('  1. 過去の修正が何を直したのかを読む（git show <hash>）')
    console.log('  2. 今回と同じ原因なら、防止手段が足りていない。機械的に防ぐ手段を足す')
    console.log('  3. .claude/failures.md に失敗クラスとして1行足す')
  }
}
process.exit(recurrent.length ? 1 : 0)
