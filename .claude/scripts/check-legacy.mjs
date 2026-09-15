#!/usr/bin/env node
// 旧 .claude の残骸を検出する。
//
// なぜこれがあるか:
//   移行手順に「旧 .claude を退避してから入れ替える」と書いたが、実際には
//   新ファイルが既存の上に追加され、.claude が 33 → 66 ファイルになった。
//   旧 quality.rule.md が「本ファイルは他の全ルールに優先する品質の憲法」と
//   自称したまま残り、新 CLAUDE.md と権威が競合していた。
//   同じ規則が2箇所にあると、1つ読んだ時点で「読んだ」感覚が成立してしまう。
//
//   手順書に書いても実行されないなら、機械が検出する。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, allFiles, matchesAny, json } from './lib/config.mjs'

// 旧構成のファイル。新構成には存在しないもの。
//
// **v23 で消したファイルもここに入れる。** `.claude` を上書きコピーで入れ替えると、
// 新しい版に無いファイルはそのまま残る（実機で selftest.mjs が残っていた）。
// 残骸が残っていること自体は無害に見えるが、「v22 の検査が今も効いている」と
// 誤解する材料になり、実際に selftest は新しい judge 仕様に追従しておらず
// 26 件失敗したままだった。**消したものが消えたことを機械が見る。**
const LEGACY = [
  { pat: '.claude/scripts/selftest.mjs',      now: '.claude/scripts/smoke.mjs（v23 で置換。selftest は新仕様に追従していないので消すこと）' },
  { pat: '.claude/failures.md',               now: '.claude/rationale.md（v23 で 1 ゲート 1 行に圧縮。元の記録は repo 外へ退避）' },
  { pat: '.claude/settings.meta.json',        now: '.claude/project.json' },
  { pat: '.claude/rules/*.rule.md',           now: '.claude/rules/*.md（.rule を外し、frontmatter を applyTo: → paths: に）' },
  { pat: '.claude/docs/**',                   now: '削除（docs/ の転記だった）。ゲートの理由は .claude/rationale.md へ' },
  { pat: '.claude/skills/phase-gate/**',      now: '.claude/commands/wp.md' },
  { pat: '.claude/agents/*.agent.md',         now: '.claude/agents/{design,impl,review,critic}.md' },
  { pat: '.claude/workflows/orchestrate.js',  now: '.claude/workflows/{coverage,audit}.js' },
  { pat: '.claude/commands/new-wp.md',        now: '/wp start' },
  { pat: '.claude/commands/check-phase.md',   now: '/wp start' },
  { pat: '.claude/commands/goal.md',          now: '/wp start ＋ hooks/gate.mjs（Stop でゴールを検査）' },
  { pat: '.claude/commands/append-gap.md',    now: '/gap' },
  { pat: '.claude/commands/run-tests.md',     now: '/verify' },
  { pat: '.claude/commands/trace-review.md',  now: '/trace' },
  { pat: '.claude/commands/audit-consistency.md', now: '/audit design' },
  { pat: '.claude/commands/audit-fidelity.md',    now: '/audit impl' },
  { pat: '.claude/commands/bump-version.md',  now: '削除' },
  { pat: 'scripts/check-docs-links.mjs',      now: '.claude/scripts/check-docs-links.mjs' },
  { pat: 'scripts/check-stub-wiring.mjs',     now: '.claude/scripts/check-stubs.mjs' },
  { pat: 'scripts/check-test-ids.mjs',        now: '.claude/scripts/check-tests.mjs' },
  { pat: 'scripts/check-traceability.mjs',    now: '削除（検証キー方式は破棄済み。作り直さない）' },
]

const files = allFiles()
const found = []
for (const l of LEGACY) {
  const hits = files.filter(f => matchesAny(f, [l.pat]))
  if (hits.length) found.push({ ...l, files: hits })
}

// .gitignore
// walk() はドットファイルを除外する（.claude 以外）ので allFiles() には
// .gitignore が絶対に現れない。旧実装はそれに依存していたため、
// 実際には全部書いてあっても「3 件不足」と誤報告し続けていた。
// 走査結果ではなく **実ファイルを直接読む**。
// MIGRATION.md / migrate.md が「3 行足せ」と書いている 3 つを全部見る（以前は 2 つしか見ていなかった）
const GITIGNORE_NEEDED = ['.claude/state/', '.claude/coverage/', '.claude/settings.local.json']
const gitignorePath = join(ROOT, '.gitignore')
let missingIgnore = [], gitignoreExists = existsSync(gitignorePath)
if (gitignoreExists) {
  const lines = readFileSync(gitignorePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
  const covered = e => lines.some(l => {
    // `**/.claude/state/` `/.claude/state/` の書き方も同じ意味として認める
    const a = l.replace(/\/$/, '').replace(/^\*\*\//, '').replace(/^\//, ''), b = e.replace(/\/$/, '')
    return a === b || a === '/' + b || b.startsWith(a + '/')
  })
  missingIgnore = GITIGNORE_NEEDED.filter(e => !covered(e))
} else {
  missingIgnore = GITIGNORE_NEEDED
}

const total = found.length + (missingIgnore.length ? 1 : 0)

if (json) console.log(JSON.stringify({ legacy: found, missingIgnore, gitignoreExists }, null, 2))
else {
  if (found.length) {
    console.log('旧構成のファイルが残っています。新旧が同時に読まれ、規則の権威が競合します。\n')
    found.forEach(l => {
      console.log(`  ${l.pat}`)
      l.files.slice(0, 6).forEach(f => console.log(`      ${f}`))
      if (l.files.length > 6) console.log(`      … 他 ${l.files.length - 6} 件`)
      console.log(`      → 移行先: ${l.now}`)
    })
    console.log('\n削除してください（内容は新構成へ移してあります。MIGRATION.md の対応表を参照）。')
  }
  if (missingIgnore.length) {
    console.log(`\n.gitignore に次の行が足りません（実行時状態がコミットに混入します）${gitignoreExists ? '' : '。.gitignore 自体が見つかりません'}:`)
    missingIgnore.forEach(e => console.log(`  ${e}`))
  }
  if (!total) console.log('check-legacy: 旧構成の残骸なし / .gitignore も揃っています')
  else console.log(`\ncheck-legacy: ${found.length} 種の残骸${missingIgnore.length ? ` ＋ .gitignore 不足 ${missingIgnore.length} 件` : ''}`)
}
process.exit(total ? 1 : 0)
