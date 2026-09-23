#!/usr/bin/env node
// project.json の設定が、実際のファイル構成と噛み合っているかを見る。
//
// なぜ要るか:
//   台帳の「未判定 0」は、分母が正しいときにしか意味を持たない。実機で 2 種類の
//   ズレが見つかった。どちらも**それらしい数字が出るので気付けない**型。
//
//   1. 段のソースが 1 ファイルにも当たっていない（docs/test/ が存在しないのに
//      accept / system 段がそこを見ていた）→ その段は永久に 0 件で「完了」になる
//   2. 2 つの段が同じファイルを数えている（it が apps/ だけを見ていて、採番簿が
//      IT として挙げている packages/**/*.integration.test.ts が ut に吸われていた）
//      → dd->it と impl->ut が、どちらも違うものを数える
//
// 判定:
//   重なり     = 赤。**違うものを数えているのに数字は出る**ので、黙って通すと嘘になる
//   0 件の段   = 警告。「まだ書いていない」は正常な途中経過でもある（初日から赤にしない）
//   その他     = 実在しない参照先を赤
//
// 使い方: node .claude/scripts/check-config.mjs [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config, filesFor, json } from './lib/config.mjs'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const cfg = config()
const errors = []   // 赤（数字が嘘になる）
const warns = []    // 警告（途中経過としてありうる）

// ── 段のソース ──────────────────────────────────────────────────────────
const owners = new Map()   // ファイル → [tierId]
for (const t of cfg.tiers || []) {
  let files = []
  try { files = filesFor(t.sources || [], t.exclude || []) } catch { files = [] }
  if (!files.length) {
    warns.push(
      `段 ${t.id}（${t.name || ''}）のソースが 1 ファイルにも当たっていません。\n` +
      `    ${(t.sources || []).join('  ')}\n` +
      `  この段を含むエッジは**永久に 0 件**で、「未判定 0」が「漏れなし」を意味しません。\n` +
      `  書く予定が無いなら project.json の tiers と edges から外してください。`)
  }
  // idPrefix で分けている段は、同じファイルを見ていても別のものを数えている。
  // その場合はファイルの重なりを問題にしない（それが idPrefix の目的なので）。
  for (const f of files) {
    if (!owners.has(f)) owners.set(f, [])
    owners.get(f).push({ id: t.id, idPrefix: t.idPrefix || null })
  }
  if (t.idPrefix && t.extractor !== 'ts-test') {
    errors.push(`段 ${t.id} の idPrefix は ts-test の段でしか効きません（現在: ${t.extractor}）。`)
  }
}

// ── テストが分母から黙って落ちていないか ────────────────────────────────
// idPrefix は「ID でしか分けられない段」を分けるための仕掛けだが、
// 裏返すと「ID が付いていないテストを黙って捨てる」仕掛けでもある。
// 実測: ID をファイル冒頭にしか書いていない 33 本・it( 239 個が、
// **どの段にも入らないまま** 台帳の外にいた（check-tests.mjs は 0 件で通っていた。
// あちらは「ファイルに ID が 1 つ以上」しか見ないので、粒度が食い違っていた）。
// 分母の穴は、穴だと分かる形で赤にする。
//
// split.mjs を import すると、あちらの CLI 部分がこちらの argv で動く。子プロセスで数える。
{
  const tsTest = (cfg.tiers || []).filter(t => t.extractor === 'ts-test')
  if (tsTest.length) {
    const HERE = dirname(fileURLToPath(import.meta.url))
    const r = spawnSync(process.execPath, [join(HERE, 'split.mjs'), 'orphan-tests', '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, CLAUDE_VERIFY_NESTED: '1' } })
    let o = null
    try { o = JSON.parse(r.stdout) } catch { o = null }
    if (!o) {
      warns.push(
        `テストの分母を数えられませんでした（split.mjs orphan-tests が返しませんでした）。\n` +
        `  ${String(r.stderr || '').split('\n').slice(0, 3).join('\n  ')}`)
    } else {
      for (const t of o.tiers) {
        if (t.units === 0 && t.files > 0) {
          warns.push(
            `段 ${t.tier} は ${t.files} ファイルに当たっていますが、分母に入ったテストが 1 件もありません。\n` +
            `  idPrefix "${t.idPrefix || '(なし)'}" を持つ ID がテスト側に書かれていないか、採番簿と食い違っています。\n` +
            `  node .claude/scripts/check-tests.mjs で ID の付与状況を見てください。`)
        }
      }
      if (o.orphans) {
        errors.push(
          `テスト ${o.orphans} 件が**どの段の分母にも入っていません**（ファイル ${o.orphanFiles.length} 本）。\n` +
          o.orphanFiles.slice(0, 8).map(f => `    ${String(f.tests).padStart(4)} 件  ${f.file}${f.keys.length ? `  [${f.keys.join(' ')}]` : '  [ID なし]'}`).join('\n') +
          (o.orphanFiles.length > 8 ? `\n    … 他 ${o.orphanFiles.length - 8} ファイル` : '') + '\n' +
          `  **この分は最初から数えられていないので、台帳の「未判定 0」は漏れなしを意味しません。**\n` +
          `  一覧: node .claude/scripts/split.mjs orphan-tests\n` +
          `  直し方: テストに ID を書く（ファイル冒頭に「// UT-XXX-YYY: 説明」を 1 行、\n` +
          `          または各テストに「// UT-XXX-YYY-01」）か、project.json の idPrefix を採番簿に合わせる。`)
      }
    }
  }
}

// ── 段の id が重複していないか ──────────────────────────────────────────
// **これを先に見る。** 同じ id の段が 2 つあると、`tier(id)` は最初の 1 つしか返さない。
// 後から書いたほうの設定（skipSections など）は**一度も効かないまま、エラーも出ない**。
//
// 実際に踏んだ（2026-09-15）: 「既存の段に skipSections を足す」つもりの編集が
// 「同じ段をもう 1 セット足す」になっていた。`split --all` は 9 段ぶん出力し、
// 重なり検査は「段 req / req が同じファイルを数えています」と言ったが、
// **「id が重複している」とは言わなかった**ので、直し方が分からない形になった。
// 症状ではなく原因を言う。
{
  const seen = new Map()
  for (const t of cfg.tiers || []) {
    if (!t || !t.id) continue
    seen.set(t.id, (seen.get(t.id) || 0) + 1)
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1)
  if (dup.length) {
    errors.push(
      `同じ id の段が 2 つ以上あります: ${dup.map(([id, n]) => `${id} ×${n}`).join(' / ')}\n` +
      `  **後から書いたほうは一度も使われません。** 段の参照は id で行い、最初に見つかった 1 つを使います。\n` +
      `  設定（skipSections / idPrefix / exclude など）を足すつもりの編集が、\n` +
      `  **段そのものを足す編集になっていないか**を確かめてください。\n` +
      `  直し方: 重複した段を消し、残した段に設定の行を足す。`)
  }
}

// ── 段どうしの重なり ────────────────────────────────────────────────────
const overlaps = new Map()
for (const [f, list] of owners) {
  if (list.length < 2) continue
  // 全員が別々の idPrefix を持っているなら、同じファイルでも数えているものは別。
  const prefixes = list.map(x => x.idPrefix)
  const separated = prefixes.every(Boolean) && new Set(prefixes).size === prefixes.length
  if (separated) continue
  const k = list.map(x => x.id).sort().join(' / ')
  if (!overlaps.has(k)) overlaps.set(k, [])
  overlaps.get(k).push(f)
}
for (const [k, files] of overlaps) {
  errors.push(
    `段 ${k} が同じファイルを数えています（${files.length} 件）。\n` +
    files.slice(0, 5).map(f => `    ${f}`).join('\n') + (files.length > 5 ? `\n    … 他 ${files.length - 5} 件` : '') + '\n' +
    `  **どちらの段も違うものを数えたまま、それらしい件数を出します。**\n` +
    `  project.json の tiers[].sources / exclude を、重ならないように直してください。\n` +
    `  パスでは分けられない場合（同じフォルダに UT と IT が同居しているなど）は、\n` +
    `  段に "idPrefix": "IT-" を足すと、テストが持つ ID で分けられます。`)
}

// ── 設定から消えた段・エッジの残骸 ──────────────────────────────────────
// project.json から段やエッジを外しても、.claude/coverage に前の jsonl が残る。
// 中身は読まれないので害は無いが、**残っていると「その段はまだ数えている」ように見える**。
// 実機で accept / system を外したあとも units/accept.jsonl と system.jsonl が残っていた。
// 消したものが消えたことを機械が見る。
{
  const tierIds2 = new Set((cfg.tiers || []).map(t => t.id))
  const edgeIds = new Set((cfg.edges || []).map(e => `${e.from}-${e.to}`))
  const strays = []
  for (const [dir, live, what] of [
    [join(ROOT, '.claude', 'coverage', 'units'), tierIds2, '段'],
    [join(ROOT, '.claude', 'coverage', 'edges'), edgeIds, 'エッジ'],
  ]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const id = f.slice(0, -6)
      if (!live.has(id)) strays.push(`${what} ${id} … ${dir.replace(ROOT, '.').replace(/\\/g, '/')}/${f}`)
    }
  }
  if (strays.length) {
    warns.push(
      `project.json に無い${strays.length === 1 ? '' : ''}段／エッジの記録が残っています（${strays.length} 件）。\n` +
      strays.map(x => `    ${x}`).join('\n') + '\n' +
      `  読まれないので判定は狂いませんが、「まだ数えている」ように見えます。削除してください。`)
  }
}

// ── エッジが実在する段を指しているか ────────────────────────────────────
const tierIds = new Set((cfg.tiers || []).map(t => t.id))
for (const e of cfg.edges || []) {
  for (const side of ['from', 'to']) {
    if (!tierIds.has(e[side])) {
      errors.push(`エッジ ${e.from}->${e.to} の ${side} が tiers にありません: ${e[side]}`)
    }
  }
  // requireApproval は Stop を止めるかどうかの分かれ目なので、
  // **書き間違いを黙って「無効」に倒さない。**
  // "true"（文字列）や 1 を書いて立っているつもりになるのが一番まずい:
  // 止まらないのに止めたつもりになり、承認を通していない分解が通る。
  if ('requireApproval' in e && typeof e.requireApproval !== 'boolean') {
    errors.push(`エッジ ${e.from}->${e.to} の requireApproval は true / false で書いてください（いまは ${JSON.stringify(e.requireApproval)}）。\n` +
      `  文字列や数値は false 扱いになり、**止めているつもりで止まりません。**`)
  }
}

// ── 同じ上位段を持つエッジで、分解が食い違っていないか ──────────────────
// `dd->impl` と `dd->it` は上位がどちらも dd。
// **分解は上位だけを見て行う作業なので、エッジによって変わることはない。**
// 違っていたら、片方で要求・もう片方で対象外、が黙って成立している状態。
// decompose は書いた瞬間に伝播させるが、**先に別々に分解してしまった台帳**は
// それでは直らないので、毎ターン見る。
{
  const byFrom = {}
  for (const e of cfg.edges || []) (byFrom[e.from] ??= []).push(e)
  for (const [from, group] of Object.entries(byFrom)) {
    if (group.length < 2) continue
    const maps = group.map(e => {
      const f = join(ROOT, '.claude', 'coverage', 'edges', `${e.from}-${e.to}.jsonl`)
      if (!existsSync(f)) return null
      const m = new Map()
      try {
        readFileSync(f, 'utf8').split('\n').filter(Boolean).forEach(l => {
          const r = JSON.parse(l)
          if (Array.isArray(r.reqs)) m.set(r.unitId, r)
        })
      } catch { return null }
      return { edge: `${e.from}->${e.to}`, m }
    }).filter(Boolean)
    if (maps.length < 2) continue
    const key = r => JSON.stringify([
      (r.reqs || []).map(q => [q.text, q.from]),
      (r.skips || []).map(k => [k.skip, k.why]),
    ])
    const bad = []
    const base = maps[0]
    for (const [unitId, r] of base.m) {
      for (const other of maps.slice(1)) {
        const o = other.m.get(unitId)
        if (!o || o.hash !== r.hash) continue
        if (key(o) !== key(r)) bad.push({ unitId, a: base.edge, b: other.edge })
      }
    }
    if (bad.length) {
      errors.push(
        `同じ上位段（${from}）を持つエッジで、分解が食い違っています（${bad.length} 件）。\n` +
        bad.slice(0, 5).map(x => `    ${x.unitId}\n      ${x.a} と ${x.b}`).join('\n') + '\n' +
        `  分解は上位だけを見て行う作業なので、**どのエッジから見ても同じでなければなりません。**\n` +
        `  片方で要求・もう片方で対象外、が黙って成立している状態です。どちらかに揃えてください:\n` +
        `    node .claude/scripts/ledger.mjs show ${JSON.stringify(bad[0].a)} ${JSON.stringify(bad[0].unitId)}\n` +
        `    node .claude/scripts/ledger.mjs show ${JSON.stringify(bad[0].b)} ${JSON.stringify(bad[0].unitId)}`)
    }
  }
}

// ── 設定に書いてある参照先が実在するか ──────────────────────────────────
const refs = [
  ['paths.requirements', cfg.paths?.requirements],
  ['paths.crossReference', cfg.paths?.crossReference],
  ['paths.decisionCatalog', cfg.paths?.decisionCatalog],
  ['paths.processDoc', cfg.paths?.processDoc],
  ['paths.testStrategy', cfg.paths?.testStrategy],
  ['paths.statusLog', cfg.paths?.statusLog],
  ['gapLedger.file', cfg.gapLedger?.file],
  ['wpLedger.file', cfg.wpLedger?.file],
  ['paths.coverageSummary', cfg.paths?.coverageSummary],
]
for (const [name, v] of refs) {
  if (!v) continue   // 空は「使っていない」の意味なので検査しない
  if (!existsSync(join(ROOT, v))) {
    errors.push(`${name} が実在しません: ${v}\n  参照先が無い設定は、検査が黙って空振りします。`)
  }
}

// ── 出力 ────────────────────────────────────────────────────────────────
const stamp = 'check-config'
if (json) {
  console.log(JSON.stringify({ ok: !errors.length, errors: errors.length, warns: warns.length,
                               errorList: errors, warnList: warns }, null, 2))
} else {
  warns.forEach(w => console.log(`⚠ ${w}\n`))
  errors.forEach(e => console.log(`✗ ${e}\n`))
  console.log(`${stamp}: ${errors.length} 件${warns.length ? ` / 警告 ${warns.length} 件` : ''}`)
  if (!errors.length && !warns.length) console.log('  設定と実ファイルは噛み合っています。')
}
process.exit(errors.length ? 1 : 0)
