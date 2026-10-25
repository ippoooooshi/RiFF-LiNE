#!/usr/bin/env node
// レビューの分母を機械が固定する。git diff を hunk に切り、全 hunk に判定を要求する。
//
// なぜこれがあるか:
//   レビューは「全部見た」を保証する手段が無かった。`notVerified` は自己申告で、
//   差分の一部しか見ていなくても「レビューしました。問題ありません」で通ってしまう。
//   ブレイクダウンの漏れと同じ構造——**見ていないものは、見ていないこと自体が見えない**。
//
//   対処も同じにする。機械が差分を hunk に切って分母を固定し、1 hunk ずつ判定を書かせ、
//   未判定が残る限り終われなくする。まとめて「問題なし」と言うことはできるが、
//   **件数が見えるし、1 件ずつ理由を書く必要がある**ので、黙って飛ばすことはできない。
//
// 判定は3つだけ:
//   指摘あり … evidence（file / line / quote）と severity が必須
//   問題なし … **なぜ問題ないかの理由が必須**（これが「まとめて OK」を防ぐ）
//   対象外   … なぜ対象外かの理由が必須（生成物・フォーマットのみ等）
//
// 使い方:
//   node .claude/scripts/diff-units.mjs split [base]     # 差分を切って分母を固定
//   node .claude/scripts/diff-units.mjs pending [--json]
//   node .claude/scripts/diff-units.mjs next [件数] [--ids-only]
//   node .claude/scripts/diff-units.mjs show <id>
//   node .claude/scripts/diff-units.mjs verdict <id> <判定> '<evidence json>'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { ROOT, config, readState, writeState, json } from './lib/config.mjs'
import { checkEvidence } from './lib/evidence.mjs'

export const VERDICTS = ['指摘あり', '問題なし', '対象外']
const STATE = 'review.json'

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? (r.stdout || '') : null
}
// `git diff --no-index` は差分があると exit 1 を返すので、status で捨てない
function gitOut(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.error ? null : (r.stdout || '')
}

// 未追跡ファイルの差分。**これを入れないと新規ファイルが分母から丸ごと落ちる。**
// git diff HEAD は未追跡を出さないので、新規作成したファイル——最もレビューが要るもの——が
// 「レビュー済み」の件数に一度も現れないまま通ってしまう。
// 台帳自身の state ファイルは分母に入れない。.gitignore に入っていない
// プロジェクトでは未追跡として現れ、**判定を 1 件書くたびに分母が増える**。
// （.gitignore の不足は check-legacy が別に警告する。そちらに依存しない。）
const NEVER_REVIEW = [/^\.claude\/state\//, /^\.claude\/baseline\.json$/, /^coverage\//, /^\.claude\/coverage\//]

function untrackedDiff() {
  const list = (git('ls-files', '--others', '--exclude-standard') || '')
    .split('\n').filter(Boolean)
    .filter(f => !NEVER_REVIEW.some(re => re.test(f)))
  return list.map(f => {
    const d = gitOut('diff', '--no-index', '--', '/dev/null', f)
    if (!d) return ''
    // --no-index のヘッダは a=/dev/null なので、b 側のパスに揃える
    return d.replace(/^diff --git a\/dev\/null b\/(.+)$/m, `diff --git a/$1 b/$1`)
  }).filter(Boolean).join('\n')
}

// git diff を hunk へ切る。**これが分母**。
export function splitDiff(raw) {
  const units = []
  let file = null, header = null, body = []
  const flush = () => {
    if (!file || !header) return
    // 末尾の空行を落としてから同一性を決める。
    // git diff の出力どうしを連結すると、**最後の hunk にだけ**継ぎ目の空行が付く。
    // そのままハッシュすると、他のファイルを触って hunk が増えただけで
    // 「最後だった hunk」の id が変わり、判定済みが黙って未判定へ戻っていた。
    while (body.length && body[body.length - 1].trim() === '') body.pop()
    const text = [header, ...body].join('\n')
    const newStart = Number((header.match(/\+(\d+)/) || [])[1] || 0)
    // 同一性は **@@ ヘッダと文脈行を除いた、変更行そのもの** から取る。
    // v22 は [header, ...body] をハッシュしていたので、上に 1 行挿入して
    // 行番号がずれただけで（＝中身が 1 文字も変わっていなくても）判定済みの
    // hunk が未判定に戻った。「変わった hunk だけが未判定に戻る」という
    // コメントが実際には成立していなかった。
    const changed = body.filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    const idBase = `${file}\n${changed.join('\n')}`
    const h = createHash('sha1').update(idBase).digest('hex')
    const dup = units.filter(u => u.hash === h.slice(0, 12)).length
    units.push({
      id: `${file}:${h.slice(0, 8)}~${dup}`,
      file, line: newStart, header, text,
      added: body.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
      removed: body.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
      hash: h.slice(0, 12),
    })
    header = null; body = []
  }
  for (const l of String(raw).split('\n')) {
    const f = l.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (f) { flush(); file = f[2]; continue }
    if (/^@@ /.test(l)) { flush(); header = l; continue }
    if (header) body.push(l)
  }
  flush()
  return units
}

function baseRef(arg) {
  if (arg) return arg
  const cfgBase = config().reviewBase
  if (cfgBase) return cfgBase
  if (git('rev-parse', '--verify', 'main') !== null) return 'main'
  if (git('rev-parse', '--verify', 'master') !== null) return 'master'
  return null
}

// その hunk に実際に現れる語。理由がこの中の 1 つも含まないなら、
// **その理由は「この hunk について」書かれていない。**
//
// 長さ 8 文字以上という条件だけでは、同じ 1 文字列が全 hunk を通る
// （実測: 5 hunk を「特に問題ありません」1 本で緑にできた）。
// 分母を固定した意味は、1 件ずつ**別の判断**をさせることにある。
// ほぼ全 hunk に現れる語は「この hunk の語」ではない。これを除かないと
// 「export の変更なので問題なし」のような雛形が全件を通ってしまう。
// ただし削りすぎると本来の検出まで消える（F30）ので、言語のキーワードと
// 総称的な型名だけに留め、識別子は残す。
const GENERIC = new Set([
  'export', 'import', 'from', 'const', 'let', 'var', 'function', 'return', 'class',
  'interface', 'type', 'enum', 'extends', 'implements', 'public', 'private', 'protected',
  'static', 'readonly', 'async', 'await', 'this', 'new', 'null', 'undefined', 'true', 'false',
  'void', 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'default',
  'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'throw', 'finally', 'typeof', 'instanceof', 'delete', 'yield', 'require', 'module',
  'exports', 'console', 'log',
])

export function hunkTokens(u) {
  const body = String(u.text || '').split('\n')
    .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n')
  const t = new Set()
  for (const m of body.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const w = m[0].toLowerCase()
    if (!GENERIC.has(w)) t.add(w)
  }
  for (const m of body.matchAll(/[一-龥ぁ-んァ-ヶ][一-龥ぁ-んァ-ヶー]+/g)) t.add(m[0])
  // ファイル名（拡張子を除く）。3 文字未満は総称語と衝突するので入れない
  const base = String(u.file || '').split('/').pop().replace(/\.[^.]*$/, '')
  if (base.length >= 3) t.add(base.toLowerCase())
  return t
}

// 理由がその hunk に紐づいているか。トークンが 1 つも無い hunk
// （空白だけの差分など）には要求できないので、そのときは課さない。
export function reasonMentionsHunk(reason, u) {
  const t = hunkTokens(u)
  if (!t.size) return true
  const r = String(reason).toLowerCase()
  for (const tok of t) if (r.includes(tok)) return true
  return false
}

const norm = x => String(x || '').replace(/\s+/g, '').toLowerCase()

// 理由から**その hunk 由来の語を伏せた**残り。雛形に語を 1 つ差し替えただけの
// 理由は、伏せると全部同じ形になる。
//   「counter1 の変更なので問題ありません」→「・の変更なので問題ありません」
// 文字列そのものを数えると、差し替え分だけ「全部違う理由」に見えてしまう
// （実測: 6 hunk を 1 つの雛形で埋めて「理由 6 種類」と表示された）。
// 何を数えているかを間違えた指標は、無いより悪い——緑の根拠になるから。
export function reasonSkeleton(reason, u) {
  let r = norm(reason)
  const toks = [...hunkTokens(u)].sort((a, b) => b.length - a.length)
  for (const t of toks) r = r.split(t).join('・')
  return r.replace(/[0-9０-９]+/g, '#').replace(/・+/g, '・')
}

export function load() { return readState(STATE, { base: null, at: null, units: [] }) }
function save(s) { writeState(STATE, s) }

// ── コマンド ─────────────────────────────────────────────────────────────
const [, , cmd, ...rest] = process.argv
const args = rest.filter(a => !a.startsWith('--'))

if (cmd === 'split') {
  const base = baseRef(args[0])
  // 作業ツリーの変更も含める（コミット前にレビューすることが多いため）
  const committed = base ? git('diff', `${base}...HEAD`) : null
  const working = git('diff', 'HEAD')
  const untracked = untrackedDiff()
  if (committed === null && working === null) {
    console.error('git の差分を取得できません（リポジトリ外、または base が解決できません）。')
    console.error('base を明示してください: node .claude/scripts/diff-units.mjs split <base>')
    process.exit(2)
  }
  const units = splitDiff([committed || '', working || '', untracked || ''].join('\n'))
    .filter(u => !NEVER_REVIEW.some(re => re.test(u.file)))
  const prev = load()
  const keep = new Map((prev.units || []).map(u => [u.hash, u]))
  const next = units.map(u => {
    const p = keep.get(u.hash)
    // 中身が変わっていない hunk の判定は引き継ぐ。変わったものは未判定に戻す。
    return p ? { ...u, verdict: p.verdict, evidence: p.evidence, reason: p.reason, severity: p.severity, at: p.at } : u
  })
  save({ base, at: new Date().toISOString(), units: next })
  const carried = next.filter(u => u.verdict).length
  const untrackedFiles = new Set(splitDiff(untracked).map(u => u.file))
  console.log(`レビューの分母を固定しました: ${next.length} hunk（base: ${base || '(作業ツリーのみ)'}）`)
  if (untrackedFiles.size) console.log(`  うち未追跡の新規ファイル ${untrackedFiles.size} 件を含む: ${[...untrackedFiles].slice(0, 5).join(' ')}`)
  if (carried) console.log(`  うち ${carried} 件は前回の判定を引き継ぎ（中身が変わっていない hunk）`)
  console.log(`  未判定 ${next.length - carried} 件。1 hunk ずつ判定してください。`)
  console.log(`    node .claude/scripts/diff-units.mjs next 1`)
  if (!next.length) console.log(`\n  ⚠ hunk が 0 件です。**「レビューする差分が無い」と「base の指定が外れている」は違います。**`)
}

else if (cmd === 'pending') {
  const s = load()
  const un = s.units.filter(u => !u.verdict)
  // 同じ理由が何 hunk を覆っているか。**止めはしないが見せる。**
  // 語の要求（reasonMentionsHunk）で定型文の全件貼りは塞げるが、
  // hunk から語を 1 つ borrow した雛形までは塞げない。塞げない残りは
  // 件数として見えるようにする——台帳が「取りこぼしを件数で見せる」のと同じ。
  // 機械的な一括リネームのように**正当に理由が同じ**場合もあるので、
  // 差異を強制しない（無意味な書き分けを強いる検査は信用されなくなる＝F21）。
  const passed = s.units.filter(u => u.verdict && u.verdict !== '指摘あり' && u.reason)
  const reasons = passed.map(u => reasonSkeleton(u.reason, u))
  const byReason = {}
  reasons.forEach(r => byReason[r] = (byReason[r] || 0) + 1)
  const distinct = Object.keys(byReason).length
  const topReason = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0] || null
  const out = {
    base: s.base, at: s.at, units: s.units.length, unjudged: un.length,
    judged: s.units.length - un.length,
    findings: s.units.filter(u => u.verdict === '指摘あり').length,
    passes: reasons.length, distinctReasons: distinct,
    topReasonCount: topReason ? topReason[1] : 0,
    unjudgedIds: un.slice(0, 20).map(u => u.id),
  }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    if (!s.units.length) {
      console.log('レビューの分母が固定されていません。先に split してください。')
      console.log('  node .claude/scripts/diff-units.mjs split')
      console.log('  **分母が無いことを「指摘 0 件」と読まないこと。** 何も見ていない状態です。')
    } else {
      console.log(`hunk ${out.units}  判定済 ${out.judged}  未判定 ${out.unjudged}  指摘 ${out.findings}（base: ${out.base}）`)
      if (out.passes) {
        console.log(`  指摘なしの判定 ${out.passes} 件 → 理由は ${out.distinctReasons} 種類（最多の 1 文が ${out.topReasonCount} 件を覆っています）`)
        if (out.passes >= 5 && out.distinctReasons * 3 <= out.passes) {
          console.log(`  ⚠ 1 種類の理由が広く使われています。正当な場合（同じ一括リネーム等）もありますが、`)
          console.log(`     雛形に語を差し替えているだけなら、それは判定ではなく通過の手続きです。`)
        }
      }
      if (out.unjudged) console.log(`  残り: ${out.unjudgedIds.slice(0, 5).join(' ')}${out.unjudged > 5 ? ' …' : ''}`)
    }
  }
  // 分母が固定されていない状態は緑ではない（exit 2）。台帳の「単位 0 は漏れなしではない」と同じ。
  // ここを 0 で返すと、split を一度も呼ばずに「未判定 0 件」でレビューを終われてしまう。
  process.exit(!s.units.length ? 2 : out.unjudged ? 1 : 0)
}

else if (cmd === 'next') {
  const s = load()
  const n = args[0] && args[0] !== 'all' ? Number(args[0]) : Infinity
  const un = s.units.filter(u => !u.verdict).slice(0, n === Infinity ? undefined : n)
  const idsOnly = rest.includes('--ids-only')
  console.log(JSON.stringify(idsOnly
    ? { count: un.length, ids: un.map(u => u.id) }
    : { verdicts: VERDICTS, count: un.length,
        note: '1 hunk ずつ判定する。「問題なし」にも理由が要る。差分だけでなく、必要なら周辺の実ファイルを開いて読むこと。',
        units: un.map(u => ({ id: u.id, file: u.file, line: u.line, added: u.added, removed: u.removed })) },
    null, 2))
}

else if (cmd === 'show') {
  const s = load()
  const u = s.units.find(x => x.id === args[0])
  if (!u) { console.error(JSON.stringify({ error: `${args[0]} が分母にありません` })); process.exit(1) }
  console.log(JSON.stringify({ id: u.id, file: u.file, line: u.line, verdicts: VERDICTS, diff: u.text,
    note: 'この hunk が製品として出せる状態かを判定する。完成度を理由に重大度を下げない（rules/core.md §4）。' }, null, 2))
}

else if (cmd === 'verdict') {
  const s = load()
  const u = s.units.find(x => x.id === args[0])
  if (!u) { console.error(`${args[0]} が分母にありません`); process.exit(1) }
  const verdict = args[1]
  if (!VERDICTS.includes(verdict)) { console.error(`判定は次のいずれか: ${VERDICTS.join(' / ')}`); process.exit(1) }
  const ev = args[2] ? JSON.parse(args[2]) : null

  if (verdict === '指摘あり') {
    if (!ev?.severity || !['Blocking', 'Major', 'Minor'].includes(ev.severity)) {
      console.error('「指摘あり」には severity（Blocking / Major / Minor）が必須です。'); process.exit(1)
    }
    if (!ev?.quote) { console.error('「指摘あり」には evidence（file / line / quote）が必須です。'); process.exit(1) }
    const v = checkEvidence(ev)
    if (!v.ok) { console.error(`evidence が実ファイルと一致しません: ${v.reason}`); process.exit(1) }
    if (ev.severity !== 'Blocking' && !ev.whyNotBlocking) {
      // core.md §4: 非ブロッキングと判定したら「なぜブロッキングでないか」を1行つける
      console.error('Blocking 以外と判定したときは evidence.whyNotBlocking（なぜブロッキングでないか）が必須です。'); process.exit(1)
    }
  } else {
    if (!ev?.reason || String(ev.reason).trim().length < 8) {
      console.error(`「${verdict}」には evidence.reason（なぜそう判定したか）が必須です。8 文字以上。`)
      console.error('  理由を書かせるのは、まとめて「問題なし」と流すことを防ぐためです。')
      process.exit(1)
    }
    // 長さだけでは同じ 1 文字列が全 hunk を通る。**この hunk に現れる語**を
    // 1 つ以上含むことを求める。定型文を全件に貼る経路をここで塞ぐ。
    if (!reasonMentionsHunk(ev.reason, u)) {
      // **貼れる語を列挙して教えない。**
      // v22 はここで「この hunk に現れる語: bpm error range …」と出していた。
      // 検査を通す方法を検査自身が教えていたことになり、語を 1 つ借りた雛形を
      // 全件に貼る経路を、こちらから開いていた。
      console.error(`理由がこの hunk の中身に触れていません（${u.file}:${u.line}）。`)
      console.error(`  どの hunk にも貼れる文は、判定ではなく通過の手続きです。`)
      console.error(`  この hunk を実際に開いて、**何を見て何が問題ないと言えるのか**を書いてください。`)
      console.error(`  差分を見る:  node .claude/scripts/diff-units.mjs show ${JSON.stringify(u.id)}`)
      process.exit(1)
    }
  }
  u.verdict = verdict; u.evidence = ev; u.severity = ev?.severity; u.reason = ev?.reason
  u.at = new Date().toISOString()
  save(s)
  const left = s.units.filter(x => !x.verdict).length
  console.log(`OK ${u.id} = ${verdict}（残り ${left} 件）`)
}

else {
  console.log('使い方: diff-units.mjs split|pending|next|show|verdict')
  console.log('  レビューの分母を git diff の hunk で固定し、全件に判定を要求する。')
}
