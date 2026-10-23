#!/usr/bin/env node
// 決定論的ゲート。CLAUDE.md やルールは助言だが、ここは拒否できる。
//
// ── v23 の中心的な作り替え ─────────────────────────────────────────────
// v22 までの構造は「モデルが .claude/state/*.json に申告 → ゲートがその申告を検査」
// だった。申告を書き換えれば通るのは、この構造の必然だった（実測: turn.json を
// Write で空にすると、コードを編集したターンが exit 0 で素通りした）。
//
// v23 は判定材料を 2 つに分ける。
//
//   観測できる事実（何を編集したか／検証が緑か）
//     → state を読まない。ゲートが毎回 git と実行結果から自分で取る。
//       Bash の heredoc も sed -i も同じく捕まる。偽造しても実差分は変わらない。
//
//   観測できない意思（adhoc 宣言／ゴール／担当 edge／phase）
//     → state に書かせる。ただし scripts/state.mjs 経由でしか書けず（settings.json の
//       permissions.deny と下の pre-tool で担保）、書いた事実が journal.jsonl に残る。
//
// 「モデルが物理的にごまかせない」状態は作れない（node -e まではパターンで塞げない）。
// 到達点は (a) ごまかしても得がない (b) ごまかすなら明示的な操作が要る
// (c) 抜けたら痕跡が残る、の 3 つ。
//
// ── 失敗したときは通さない ─────────────────────────────────────────────
// v22 は stdin が読めない・project.json が壊れた・子スクリプトが JSON を返さない、
// のどれでも黙って pass していた。検査が死んでいることと、検査に通ったことを
// 区別できない状態だった。v23 は観測できないなら止める。
//
// イベント: session-start | pre-tool | post-tool | stop
import { spawnSync } from 'node:child_process'
import { statSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, relative, resolve, dirname, sep, posix, parse as parsePath } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  ROOT, config, readState, writeState, clearState, matchesAny,
  codeGlobs, goalGlobs, stateDir,
} from '../scripts/lib/config.mjs'
import { countOpenEnum } from '../scripts/lib/wording.mjs'

const event = process.argv[2]

// 未捕捉例外で exit 1 になると non-blocking エラー扱いになり、ターンは**終わる**。
// 検査中に落ちたことと、検査に通ったことを区別できないので 2 に倒す。
process.on('uncaughtException', err => {
  process.stderr.write(
    `ゲートが異常終了しました（${event}）。検査は完了していません。\n` +
    `  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : String(err)}\n` +
    `  この状態を「検査に通った」と読まないでください。本人に報告してください。\n`)
  process.exit(2)
})

const HERE = dirname(fileURLToPath(import.meta.url))
const script = n => join(HERE, '..', 'scripts', n)
const NODE = process.execPath   // nvm-windows / volta で `node` が .cmd のとき shell 無し spawn は ENOENT になる

// ── 出力ヘルパ ──────────────────────────────────────────────────────────
function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0) }
function block(reason) { process.stderr.write(reason); process.exit(2) }
function pass() { process.exit(0) }
function safe(fn, fallback) { try { return fn() } catch { return fallback } }

// ── 入力 ────────────────────────────────────────────────────────────────
// 読めなければ **止める**。pre-tool で読めないと編集ガードが全部消え、
// stop で読めると主張照合が消える。どちらも「検査が無い」であって「合格」ではない。
let input = {}
let inputError = null
try {
  const raw = readFileSync(0, 'utf8')
  if (raw.trim()) input = JSON.parse(raw)
} catch (e) { inputError = e }

if (inputError && (event === 'pre-tool' || event === 'stop')) {
  block(
    `ゲートが入力を読めませんでした（${event}）。検査を実行できていません。\n` +
    `  ${inputError.message}\n` +
    `  この状態では編集ガードも検証も掛かっていません。本人に報告してください。\n`)
}

const cfg = safe(() => config(), null)
if (!cfg) {
  const msg =
    `.claude/project.json を読めません（存在しないか JSON として壊れています）。\n` +
    `  この 1 ファイルが読めないと、パス・段・コマンドの定義がすべて失われ、\n` +
    `  ゲートは何も検査できません。**検査が無いことを合格と読まないでください。**\n` +
    `  確認:  node -e "JSON.parse(require('fs').readFileSync('.claude/project.json','utf8'))"\n`
  if (event === 'session-start') {
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `⚠ ${msg}` } })
  }
  if (event === 'post-tool') pass()
  block(msg)
}

const CODE = safe(() => codeGlobs(), ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx'])
const TESTS = ['**/*.test.ts', '**/*.test.tsx']
const DOCS = ['docs/**']
const NEEDS_GOAL = safe(() => goalGlobs(), ['packages/**', 'apps/**', 'docs/**'])
// 機械が書く場所。観測した「編集」からは除く（毎ターン汚れているので、
// これを数えると全ターンが「編集あり」になる）。
const MACHINE = ['.claude/state/**', '.claude/coverage/**']
const PHASES = ['design', 'impl', 'test', 'review', 'adhoc']
// 止めずに知らせるもの（v34 T25）。Stop で合格したときに finish() が stderr に出す
const notices = []

// リダイレクトの検出。**`->` を `>` と読まないこと。**
// 素朴に />\s*[^\s|&]/ で見ると、`ledger.mjs pending "req->bd"` が
// 「リダイレクトしている」と判定される。この仕組みで最も頻度の高いコマンドが
// 丸ごとブロックされ、正直にやる道が消える。
// `=>`（アロー関数）も `>` と読まないこと（v34 T21）。ファイルに書くスクリプトの本文に
// `x => '.claude/...'` があるだけで「ゲートの場所へのリダイレクト」と判定していた。
const REDIRECT = /(^|[^-=\w])>>?\s*[^\s|&>]/
const WRITE_CMD = /(^|[\s;&|(])(tee|sed\s+-i|cp|mv|install|truncate|rm|rmdir|del|Remove-Item|Set-Content|Out-File|Add-Content|New-Item|Copy-Item|Move-Item)\b/i
const EVAL_CMD  = /\b(node\s+(-e|--eval)|python3?\s+-c|perl\s+-[a-z]*e)\b/
const GATE_PATH = /\.claude[\/\\](state|coverage|hooks|scripts|settings\.json|project\.json)/i

function looksLikeWrite(cmd) {
  const c = stripDataHeredocs(cmd)
  return REDIRECT.test(c) || WRITE_CMD.test(c) || EVAL_CMD.test(c)
}

// ── ファイルに書くだけの heredoc の本文は、コマンドとして読まない（v34 T21）──
// 実測（2026-09-27、turn 86 から 87）: 分解のスクリプトの写しを scratchpad に書こうとしたところ、
// 「ゲートが読む場所を書き換えようとしています」で止まった。`cat > <scratchpad>/dec.js <<'EOF'` の
// **本文**に `.claude/scripts/ledger.mjs` と、書き込みに見える語（アロー関数の `=>`、文面の「cp」「rm」）が
// 並んでいた。本文は改行で区間に割られ、1 行ずつコマンドとして読まれていた。
// 本文は**データ**で、実行されない。書き込み先は `cat` の行のリダイレクトだけが決める。
// **ただし、本文を実行するもの（bash・sh・node・python など）に渡す heredoc は外さない。**
// そちらは本文がコマンドそのもので、外すとサブエージェントの `bash <<EOF … rebut … EOF` が見えなくなる。
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
export function stripDataHeredocs(cmd) {
  const lines = String(cmd || '').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    const m = line.match(HEREDOC)
    if (!m) continue
    const head = line.slice(0, m.index).trim().split(/\s+/)[0] || ''
    const dataOnly = /^(cat|tee)$/.test(head.replace(/^.*[\/\\]/, ''))
    const tag = m[2]
    let j = i + 1
    while (j < lines.length && lines[j].replace(/^\t+/, '') !== tag) j++
    if (dataOnly) {
      if (j < lines.length) out.push(lines[j])      // 終わりの印の行は残す（区切りの確かめのため）
      i = j
    }
  }
  return out.join('\n')
}

// ── 段の名前を引用符なしで打つのを止める（v34 T20）─────────────────────
// 実測（2026-09-27、turn 83）: `ledger.mjs approval-report bd->dd …` を引用符なしで打ち、
// シェルが `>` をリダイレクトにしてリポジトリ直下に空の `dd` を作った（ledger.mjs は `bd-` を断ったが、
// **ファイルはコマンドが動く前にシェルが作る**ので、道具の側では防げない）。打つ前に止める。
// 引用符の中・ファイルに書くだけの heredoc の本文は見ない。`bd-dd` の形は `>` が無いので止めない。
export function bareEdgeArrow(cmd, tierIds) {
  if (!tierIds || !tierIds.length) return null
  const noQuote = stripDataHeredocs(cmd).replace(/'[^'\n]*'|"(?:\\.|[^"\\\n])*"/g, ' ')
  const ids = tierIds.map(x => String(x).replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean).join('|')
  const m = noQuote.match(new RegExp(`(^|[\\s=(])(${ids})->(${ids})?`))
  return m ? `${m[2]}->${m[3] || ''}` : null
}

// ゲートが読む場所への**書き込み**だけを止める。読み取り・スクリプトの実行は通す。
// `node .claude/scripts/ledger.mjs ...` は通り、`echo x > .claude/state/turn.json` は止まる。
//
// **判定はコマンド行全体ではなく、区切りで割った 1 区間ごとに行う。**
// 全体で見ると「どこかにゲートのパスがある」かつ「どこかに書き込み系コマンドがある」だけで
// 止まってしまい、`node .claude/scripts/verify.mjs > /tmp/out.txt; rm /tmp/out.txt` のように
// **検査結果をファイルに退避して後片付けする**という、この仕組み自身が求める作業が落ちる。
// 書き込み先を見ずに止めるのは、正直な経路を塞ぐのと同じ。
const SEGMENT = /\s*(?:\|\||&&|[;|\n])\s*/
// 宛先だけが書き込み対象になるコマンド（cp a b / mv a b）。読み出し元は見ない。
const DEST_ONLY = /^(cp|mv|install|Copy-Item|Move-Item)\b/i
// node -e / python -c の中身に書き込みの意図が見えるか。
// 完全には判定できない（fs['writeFileSync'] のような書き方は抜ける）が、
// **意図的な迂回までは守備範囲外**と決めてある。ここで防ぐのは事故のほう。
// 後ろに \b を置かないこと。writeFile\b は writeFileSync に当たらない（S が語中で続くため）。
const EVAL_WRITE = /\b(writeFile|appendFile|unlink|rmdir|rmSync|mkdir|copyFile|rename|truncate|createWriteStream|writeSync|openSync|execSync|spawnSync|shutil|os\.remove|os\.rename|fs\.rm)|\bopen\s*\([^)]*['"][wa]/

// ── 破壊的な削除の行き先 ────────────────────────────────────────────────
// v22/v23 前半は settings.json に `Bash(rm -rf /*)` のような**綴りの列挙**を置いていた。
// あれは効かない。`rm -rf /` は止まるが `rm -fr /` は前置き一致から外れ、
// `Bash(rm *)`（ask）に落ちて「人が『はい』を押せる」状態になる。
// **同じ破壊力のものが、書き方だけで扱いが変わっていた。**
// 狭めれば外れやすくなり、広げれば `rm -rf node_modules` が死ぬ。列挙という方式が合っていない。
//
// 代わりに**行き先を解決して比べる**。書き方に依存せず、怖い単語も並ばない。
//   プロジェクトの中 / OS の一時ディレクトリ → 通す（git が戻せる範囲）
//   その外                                   → 確認を出す（ask）
//   ルート・ドライブ直下・ホームそのもの      → 拒否（正当な用途が無い）
const DESTRUCTIVE = /^(rm|rmdir|unlink|shred|truncate|del|erase|Remove-Item|Clear-Content)\b/i
const RECURSIVE = /(^|\s)-{1,2}[a-zA-Z]*r/i

function expandHome(a) {
  if (a === '~' || a.startsWith('~/') || a.startsWith('~\\')) return join(homedir(), a.slice(1))
  return a
}
// 到達したら取り返しがつかない場所。ここを消す正当な理由は無い。
function isCatastrophic(abs) {
  const p = parsePath(abs)
  if (abs === p.root) return true                 // / や C:\
  if (abs === homedir()) return true              // ホームそのもの
  if (abs === join(homedir(), '..')) return true
  return false
}
// Windows でも、Bash から渡されるコマンドは POSIX 表記で来る。
// `/tmp/out.txt` を path.resolve に食わせると `C:\tmp\out.txt` になり、
// 実際の一時ディレクトリ（%LOCALAPPDATA%\Temp）と一致しない。
// 結果、**CLAUDE.md が求めている「一時ファイルは OS の一時ディレクトリへ」という
// 運用そのものが毎回確認ダイアログになっていた。** 正直な経路を塞いでいる。
const POSIX_TMP = /^\/(tmp|var\/tmp|private\/tmp)(\/|$)/

function destructiveVerdict(cmd) {
  const TMP = resolve(tmpdir())
  for (const seg0 of stripDataHeredocs(cmd).split(SEGMENT)) {
    const seg = seg0.trim()
    if (!DESTRUCTIVE.test(seg)) continue
    const recursive = RECURSIVE.test(seg)
    const args = seg.split(/\s+/).slice(1)
      .filter(a => a && !a.startsWith('-'))
      .map(a => expandHome(a.replace(/^["']|["']$/g, '')))
    for (const a of args) {
      // POSIX 表記の /tmp 扱い。**先に .. を畳む。**
      // 畳まないと `/tmp/../etc` が前置き一致で通り、一時ディレクトリの名を借りて
      // どこへでも出られる（前置き一致で守ろうとすると必ずこの穴が開く）。
      if (POSIX_TMP.test(posix.normalize(a.replace(/\\/g, '/')))) continue
      const abs = resolve(ROOT, a)
      if (isCatastrophic(abs)) {
        return { decision: 'deny', target: a, abs,
          why: `削除先がファイルシステムの最上位です（${abs}）。正当な用途がありません。` }
      }
      const inProject = !relative(ROOT, abs).startsWith('..')
      const inTmp = !relative(TMP, abs).startsWith('..')
      if (inProject || inTmp) continue
      return { decision: 'ask', target: a, abs, recursive,
        why: `削除先がプロジェクトの外です（${abs}）。` +
             (recursive ? '再帰削除なので、中身ごと消えます。' : '') +
             'プロジェクト内か OS の一時ディレクトリなら確認は出ません。' }
    }
  }
  return null
}

// 区間から「書き込み対象になりうる引数」だけを取り出す。
// **引数を素朴に空白で割ってはいけない。** 実機で踏んだ誤検知:
//   sed -i 's#旧#.claude/scripts/check-tests.mjs#' docs/foo.md
// 置換式の中に .claude/ が含まれているだけで「ゲートを書き換えようとしている」と
// 判定していた。実際の書き込み先は docs/foo.md で、ゲートとは無関係だった。
// **式はファイル名ではない。** 引用符を尊重し、sed のスクリプト引数は対象から外す。
function operandsOf(seg) {
  const toks = seg.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || []
  const cmd = (toks[0] || '').toLowerCase()
  const unquote = a => a.replace(/^["']|["']$/g, '')
  const rest = toks.slice(1)

  const out = []
  let sedScriptTaken = false
  const isSed = /(^|[\/\\])sed(\.exe)?$/.test(cmd)
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]
    if (t.startsWith('-')) {
      // **値を取るオプションの扱いは sed に限る。**
      // 一般化すると rm -f の -f を「ファイル名を取るオプション」と誤解し、
      // 直後の削除対象を引数から落としてしまう（実際に踏んだ）。
      if (isSed && /^--?(e|f|expression|file)$/.test(t)) { i++; sedScriptTaken = true }
      continue
    }
    // sed で -e / -f が無いとき、最初の非オプション引数は**スクリプト**であってファイルではない
    if (isSed && !sedScriptTaken) { sedScriptTaken = true; continue }
    out.push(unquote(t))
  }
  return out
}

// ── 単一引用符の中の文（データ）は、書き込みの語として読まない（v52）──────────
// 実測（2026-10-15、turn 149）: ダブルチェックの書き戻し係が `ledger.mjs approve … '{"why":"…npm install…"}'` を
// 40 本つないで 1 回で送り、「ゲートが読む場所を書き換えようとしています」で 2 回とも止まった。
// 理由の文（設計書の写し）の ` install` が書き込み系コマンドの語に当たり、同じ区間の `.claude/scripts/ledger.mjs` が
// 書き込み先に見えた。表の行の `|` でも区間が割れていた。v51 で書き戻しが base64 をやめ、文がそのままコマンドに載ったため。
// bash では単一引用符の中は文字のまま（実行されない）。**ゲートの場所を含まない単一引用符の中身だけ**を空にしてから読む。
// ゲートの場所を含む引用（`cp a '.claude/state/x'`）は残すので、引用した書き込み先は今までどおり止まる。
// 文字列をコマンドとして実行するもの（bash・sh・eval・node -e・python -c など）があるときは、何も空にしない。
const RUNS_STRING = /(^|[\s;&|(])(bash|sh|zsh|dash|eval|source|xargs|pwsh|powershell)(\.exe)?(\s|$)|\bnode\s+(-e|--eval|-p|--print)\b|\bpython3?\s+-c\b|\bperl\s+-[a-z]*e\b/i
export function blankQuotedData(cmd) {
  const s = String(cmd || '')
  let out = '', i = 0, dq = false
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') { out += s.slice(i, i + 2); i += 2; continue }
    if (ch === '"') { dq = !dq; out += ch; i++; continue }
    if (ch === "'" && !dq) {
      const j = s.indexOf("'", i + 1)
      if (j < 0) { out += s.slice(i); break }
      const body = s.slice(i + 1, j)
      out += GATE_PATH.test(body) ? s.slice(i, j + 1) : "''"
      i = j + 1; continue
    }
    out += ch; i++
  }
  return RUNS_STRING.test(out) ? s : out
}

// v54: git commit は確認なしで通す（settings.json、本人決定 2026-10-19）。かわりに、**履歴を書き換える・コミットの前の見張りを飛ばす**形はここで止める。
//   --amend（前のコミットを書き換える）・--no-verify と -n（husky の lint と型チェックを飛ばす）・
//   HUSKY=0 や -c core.hooksPath=…（見張りを外す）。コミットの文（引用符の中）は見ない。
//   止めるのは事故で落ちる経路で、間違ったコミットは「打ち消すコミット」（git revert）で戻す（履歴は消さない）。
function blankAllQuotes(s) {
  let out = '', i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') { out += '  '; i += 2; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < s.length && s[j] !== ch) { if (ch === '"' && s[j] === '\\') j++; j++ }
      out += ch + ch; i = j + 1; continue
    }
    out += ch; i++
  }
  return out
}
export function commitRewriteFlag(cmd0) {
  const s = blankAllQuotes(stripDataHeredocs(String(cmd0 || '')))
  for (const seg of s.split(/&&|\|\||[;|\n&]/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean)
    const gi = toks.findIndex(t => /^git(\.exe)?$/i.test(t))
    if (gi < 0) continue
    const envs = toks.slice(0, gi)
    let k = gi + 1
    const gopts = []
    while (k < toks.length && /^-/.test(toks[k])) {
      if (/^-(C|c)$/.test(toks[k])) { gopts.push(toks[k] + ' ' + (toks[k + 1] || '')); k += 2 } else { gopts.push(toks[k]); k += 1 }
    }
    if (toks[k] !== 'commit') continue
    const env = envs.find(t => /^HUSKY=/i.test(t) || /^GIT_/.test(t))
    if (env) return env
    const hp = gopts.find(t => /hooksPath/i.test(t))
    if (hp) return hp
    for (const t of toks.slice(k + 1)) {
      if (t === '--') break
      if (/^--(amend|no-verify)(=|$)/.test(t)) return t
      if (/^-[A-Za-z]+$/.test(t) && t.includes('n')) return t
    }
  }
  return null
}
export function writesIntoGate(cmd0) {
  const cmd = blankQuotedData(stripDataHeredocs(cmd0))
  if (!GATE_PATH.test(cmd)) return false
  for (const seg0 of String(cmd).split(SEGMENT)) {
    const seg = seg0.trim()
    if (!seg) continue

    // 1. リダイレクト先がゲートの場所か（区間内で完結する）
    for (const m of seg.matchAll(/(^|[^-=\w])>>?\s*["']?([^\s"'|&;]+)/g)) {
      if (GATE_PATH.test(m[2])) return true
    }

    // 2. この区間に書き込み系コマンドがあり、**その対象**がゲートの場所か
    if (WRITE_CMD.test(seg)) {
      const args = operandsOf(seg)
      const targets = DEST_ONLY.test(seg) ? args.slice(-1) : args
      if (targets.some(a => GATE_PATH.test(a))) return true
    }

    // 3. node -e / python -c は中身を読めないので保守的に止めていたが、
    //    **読み取りだけのワンライナーまで止まっていた**
    //    （実機で `node -e "require('./.claude/project.json')"` が拒否された）。
    //    設定を読んで確かめる、はこの仕組みが推奨している行為で、それを止めるのは
    //    正直な経路を塞ぐのと同じ。書き込みを示す語が在るときだけ止める。
    if (EVAL_CMD.test(seg) && GATE_PATH.test(seg) && EVAL_WRITE.test(seg)) return true
  }
  return false
}


function rel(p) {
  if (!p) return null
  const a = resolve(String(p))
  const r = relative(ROOT, a)
  if (r.startsWith('..')) return null
  return r.split(sep).join(posix.sep)
}

// 大文字小文字を無視して比較する（Windows の NTFS は case-insensitive。
// ツール入力の綴りと実ファイル走査の綴りが違うと誤判定する）。
const WIN = process.platform === 'win32'
const norm = p => WIN ? String(p).toLowerCase() : String(p)
const sameFile = (a, b) => norm(a) === norm(b)
const includesFile = (arr, f) => arr.some(x => sameFile(x, f))

// ── 子プロセス ──────────────────────────────────────────────────────────
function run(args, { timeout = 480_000 } = {}) {
  const r = spawnSync(NODE, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout,
    env: { ...process.env, CLAUDE_VERIFY_NESTED: '1' },
  })
  return r
}
// JSON を返すはずの子プロセス。返さなかったら **理由として積む**。
// v22 は claims と drift だけ fail-open で、そこだけ黙って通っていた。
function runJson(args, label, reasons, opts) {
  const r = run(args, opts)
  const j = safe(() => JSON.parse(r.stdout), null)
  if (!j) {
    reasons.push(
      `${label}を実行できませんでした。検査結果が無いので、このターンは終われません。\n` +
      `  ${r.error ? r.error.message : `exit=${r.status}`}\n` +
      `  ${((r.stderr || '').split('\n').filter(Boolean).slice(-4).join('\n  ')) || '(stderr なし)'}\n` +
      `  そのまま貼れます:  node ${args.slice(0, 3).map(a => a.includes(' ') ? JSON.stringify(a) : a).join(' ')}`)
    return null
  }
  return j
}

// ── journal（追記のみ。消しても git 差分に残る）────────────────────────
function journal(kind, data) {
  try {
    appendFileSync(join(stateDir(), 'journal.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n')
  } catch { /* 記録に失敗してもターンは止めない */ }
}

// ════════════════════════════════════════════════════════════════════════
// 観測: いま未コミットの変更は何か
// ════════════════════════════════════════════════════════════════════════
// turn.json（PostToolUse の記録）を判定に使わない。あれはモデルが Write で
// 上書きでき、Bash 経由の編集を取りこぼし、compact と並列ツール呼び出しで壊れる。
// git のワークツリーは、どの経路で書いても同じように見える。
function gitDirty() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000 })
  if (r.status !== 0 || r.error) return null
  const out = []
  const parts = String(r.stdout || '').split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (!e || e.length < 4) continue
    const xy = e.slice(0, 2)
    out.push(e.slice(3))
    if (xy[0] === 'R' || xy[0] === 'C') i++   // rename/copy は次の要素が元パス
  }
  return out.filter(p => p && !matchesAny(p, MACHINE))
}

// ════════════════════════════════════════════════════════════════════════
if (event === 'session-start') {
  // 起動・resume・clear・compact のたびに検証一式（typecheck / lint / test）が
  // 走っていた。現在地の表示に数分掛ける必要は無い。
  const r = run([script('status.mjs'), '--no-verify'], { timeout: 120_000 })
  const text = (r.stdout && r.stdout.trim())
    ? r.stdout
    : `⚠ 現在地を取得できませんでした（status.mjs が起動しなかったか、出力が空です）。\n` +
      `   exit=${r.status} ${r.error ? `error=${r.error.message}` : ''}\n` +
      `   ${((r.stderr || '').split('\n').filter(Boolean).slice(-5).join('\n   ')) || '(stderr なし)'}\n` +
      `   **この状態では進捗・ギャップ件数・台帳の状態が一切分かりません。**\n` +
      `   作業を始める前に \`node .claude/scripts/status.mjs --no-verify\` を手で実行して確認してください。\n`

  // compact は「会話の途中」であって「新しいセッション」ではない。
  // ここで turn.json を消すと、最も長い（＝最も検査が要る）ターンの読み取り記録が消える。
  if (input.source !== 'compact') clearState('turn.json')

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        text +
        '\n\n上記はコマンド実行による実測値です。ドキュメントに書かれた進捗より、こちらを信用してください。\n' +
        'ただし **セッション開始時点のスナップショット** です。作業中に状況が変わったら、\n' +
        'この内容を根拠にせず `node .claude/scripts/status.mjs --no-verify` を実行して取り直してください。\n' +
        'ここに無い情報が必要になったら、docs/ の該当箇所を開いて確認してください（推測しない）。\n\n' +
        '`.claude/state/` と `.claude/coverage/` は直接編集できません（ゲートが読む場所です）。\n' +
        'ゴール・担当段・adhoc 宣言は `node .claude/scripts/state.mjs` から書いてください。\n',
    },
  })
}

// ════════════════════════════════════════════════════════════════════════
if (event === 'pre-tool') {
  const t = input.tool_name || input.toolName || ''
  const ti = input.tool_input || input.toolInput || {}
  const agent = String(input.agent_type || input.agentType || '')
  const phase = safe(() => readState('current.json')?.phase, null) || null

  // ── レビュー系エージェントは読み取り専用 ──────────────────────────────
  // v22 は「hook にはどのエージェントかが来ない」として agents/*.md の tools だけで
  // 担保していたが、hook 入力には agent_type がある。しかも review / critic は
  // Bash を持っているので、tools から Edit/Write を外しても `echo > file` で書けた。
  if (/^(review|critic)$/i.test(agent)) {
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) {
      block(
        `拒否: ${agent} エージェントはファイルを変更できません。\n` +
        `  指摘だけを返してください。修正するのは impl / design の役割です。\n`)
    }
    if (t === 'Bash' && looksLikeWrite(String(ti.command || ''))) {
      block(
        `拒否: ${agent} エージェントは書き込みを伴うコマンドを実行できません。\n` +
        `  ${String(ti.command || '').slice(0, 160)}\n` +
        `  読み取りと検索だけで判定してください。\n`)
    }
  }

  // ── サブエージェントに、決める役の書き込みをさせない ────────────────────
  // 実測（2026-09-24、turn 54）: 承認のワークフローの書き戻し役（渡されたコマンドを上から打つだけの役）が、
  // 中継された本人の依頼を自分への指示と読み、台本に無い `rebut` 4 件・`concede` 1 件を打ち、
  // `state.mjs goal` でゴールを上書きし、`_bridge/` の報告を書き換えた。
  // これらは**分解した側（本体）か本人が決めること**で、ワークフローの中の役がやることではない。
  // サブエージェントの呼び出しには agent_id が付く（本体の呼び出しには付かない）ので、それで見分ける。
  // **agent_type では見分けない。** 本体を `--agent` 付きで起動すると本体にも agent_type が付き、
  // 本体の rebut・sync・ゴール設定まで止めてしまう。
  // **ワークフローの役が正規に打つもの（approve / settle / decompose / judge と読み取り系）は止めない。**
  const subagent = !!(input.agent_id || input.agentId)
  if (subagent && t === 'Bash') {
    const cmd = String(ti.command || '')
    const DECIDE = /ledger\.mjs["']?\s+(?:["'][^"']*["']\s+)*?(rebut|concede|uphold|hold|plan|sync|ask-record|approval-reset|defer(?!-))\b|ledger\.mjs["']?\s+stale-diff\b[\s\S]*--ack/
    const m = cmd.match(DECIDE)
    if (m || /state\.mjs["']?\s+(?!show\b|--help\b)\S/.test(cmd)) {
      block(
        `拒否: この書き込みは、サブエージェント（${agent || 'agent_id ' + (input.agent_id || input.agentId)}）には許していません。\n` +
        `  ${cmd.slice(0, 200)}\n\n` +
        `  反論・同意・本人待ち・分類・同期・ゴールの設定は、分解した側（本体）か本人が決めることです。\n` +
        `  渡された作業（承認の書き戻しなど）だけを行い、それ以外は結果として返してください。\n`)
    }
  }
  if (subagent && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t) && /(^|[\\/])_bridge[\\/]/.test(String(ti.file_path || ti.filePath || ti.path || ''))) {
    block(
      `拒否: _bridge/ の指示・報告は、サブエージェント（${agent || 'agent_id ' + (input.agent_id || input.agentId)}）には書かせません。\n` +
      `  報告を書くのは本体です。結果は返り値で返してください。\n`)
  }
  // 本人のコマンドを非対話で通すための環境変数（smoke 用）を、AI が付けて打つのを止める。
  if (t === 'Bash' && /CLAUDE_LEDGER_ALLOW_NON_TTY/.test(String(ti.command || ''))) {
    block(
      `拒否: CLAUDE_LEDGER_ALLOW_NON_TTY は smoke のためだけの変数です。\n` +
      `  uphold / 本人待ちへの concede は本人のコマンドです。本人に端末から打ってもらってください。\n`)
  }

  // ── Bash 経由のゲート改変 ────────────────────────────────────────────
  // Edit/Write は settings.json の permissions.deny で止まるが、Bash の
  // heredoc / sed -i / cp はそこを通らない。完全には塞げない（node -e まで
  // 潰すのは無理）ので、**事故で落ちる経路**だけを塞ぐ。
  if (t === 'Bash') {
    const cmd = String(ti.command || '')
    const bare = bareEdgeArrow(cmd, (cfg.tiers || []).map(x => x.id))
    if (bare) {
      block(
        `拒否: 段の名前 ${bare} が引用符で囲まれていません。\n` +
        `  ${cmd.slice(0, 200)}\n\n` +
        `  シェルは \`>\` をリダイレクトにして、リポジトリ直下に空のファイルを作ります（turn 83 の \`dd\`）。\n` +
        `  **ファイルはコマンドが動く前にできる**ので、道具の側では防げません。次のどちらかで打ち直してください:\n` +
        `    - 引用符で囲む: "${bare}"\n` +
        `    - \`-\` の形で書く: ${bare.replace('->', '-')}（ledger.mjs・state.mjs は同じ段として読みます）\n`)
    }
    const rw = commitRewriteFlag(cmd)
    if (rw) {
      block(
        `拒否: git commit に「${rw}」が付いています。\n` +
        `  ${cmd.slice(0, 200)}\n\n` +
        `  コミットは確認なしで通す代わりに、前のコミットを書き換える形（--amend）と、\n` +
        `  コミットの前の見張り（lint・型チェック）を飛ばす形（--no-verify・-n・HUSKY=0・core.hooksPath）は止めます（v54）。\n` +
        `  新しいコミットとして打ち直してください。見張りで止まったら、直してから打ち直します。\n` +
        `  前のコミットを取り消すときは、書き換えずに打ち消すコミット（git revert）にします。\n`)
    }
    if (writesIntoGate(cmd)) {
      block(
        `拒否: ゲートが読む場所を書き換えようとしています。\n` +
        `  ${cmd.slice(0, 200)}\n\n` +
        `  .claude/state/ と .claude/coverage/ はゲートの判定材料です。ここを書き換えると、\n` +
        `  検査に通ったことと、検査を消したことが区別できなくなります。\n` +
        `  ゴール・担当段・adhoc 宣言:  node .claude/scripts/state.mjs --help\n` +
        `  台帳の判定:                  node .claude/scripts/ledger.mjs judge ...\n`)
    }
    // 削除の行き先を見る（綴りの列挙ではなく、解決したパスで判定する）
    const dv = destructiveVerdict(cmd)
    if (dv?.decision === 'deny') {
      block(`拒否: ${dv.why}\n  ${cmd.slice(0, 200)}\n`)
    }
    if (dv?.decision === 'ask') {
      emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
        permissionDecisionReason: `${dv.why}\n  対象: ${dv.abs}` } })
    }

    // 人間判定はモデルが付けられない。--human は humanJudged の段（要件→受入シナリオ）を
    // 「人が見た」ことにする印なので、AI が打てると印の意味が無くなる。
    if (/ledger\.mjs[\s\S]*\bjudge\b/.test(cmd) && /--human\b/.test(cmd)) {
      block(
        `拒否: --human（人間判定）は AI が付けられません。\n` +
        `  この印は「人が実物を見て判定した」ことを表します。本人にターミナルから\n` +
        `  直接実行してもらってください。AI の判定は --human 無しで記録します。\n`)
    }
  }

  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) pass()

  const path = rel(ti.file_path || ti.filePath || ti.path || ti.notebook_path)
  if (!path) pass()

  const turn = readState('turn.json', { created: [], edited: [], commands: [] })
  const existedBefore = existsSync(join(ROOT, path)) && !includesFile(turn.created || [], path)

  // 1. 実装中に、このターンより前から在るテストを書き換えない
  if (matchesAny(path, TESTS) && existedBefore && phase !== 'test') {
    block(
      `拒否: 既存のテストファイルは変更できません。\n` +
      `  ${path}\n\n` +
      `テストを通すためにテストを直すことを防いでいます。\n` +
      `このターンで新しく作ったテストは編集できます。既存テストの変更が本当に必要なら:\n\n` +
      `  node .claude/scripts/state.mjs phase test --why "<仕様がどう変わったか。設計書の根拠を添える>"\n\n` +
      `この宣言は journal.jsonl に残り、セッション冒頭に出ます。\n` +
      `仕様が変わったのなら、先に設計を更新して承認を得るのが順序です。\n`)
  }

  // 2. 実装フェーズ中に設計書・要件書を書き換えない
  if (phase === 'impl' && matchesAny(path, DOCS)) {
    block(
      `拒否: 実装フェーズ中は設計ドキュメントを変更できません。\n` +
      `  ${path}\n\n` +
      `実装が設計を書き換えて辻褄を合わせることを防いでいます。\n` +
      `設計と実装が食い違うなら、実装を止めて「設計起因ブロック」として報告してください。\n`)
  }

  // 3. 設計フェーズ中にコードを書き換えない
  if (phase === 'design' && matchesAny(path, cfg.guards?.designPhaseReadonly || [])) {
    block(
      `拒否: 設計フェーズ中はコードを変更できません。\n` +
      `  ${path}\n\n` +
      `設計が固まる前に実装が先行し、設計書が後追いで辻褄を合わせるのを防いでいます。\n` +
      `実装に入るなら /wp impl でフェーズを切り替えてから行ってください。\n`)
  }

  pass()
}

// ════════════════════════════════════════════════════════════════════════
if (event === 'post-tool') {
  // 記録は claims.mjs の裏取り（「読みました」「0 件でした」）にだけ使う。
  // **編集の有無の判定には使わない**（それは git で観測する）。
  const t = input.tool_name || input.toolName || ''
  const ti = input.tool_input || input.toolInput || {}
  const turn = readState('turn.json', { created: [], edited: [], commands: [], reads: [], searches: [], startedAt: new Date().toISOString() })
  turn.reads ??= []; turn.searches ??= []; turn.created ??= []; turn.edited ??= []; turn.commands ??= []

  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) {
    const path = rel(ti.file_path || ti.filePath || ti.path || ti.notebook_path)
    if (path) {
      if (t === 'Write' && !includesFile(turn.edited, path) && !includesFile(turn.created, path)) turn.created.push(path)
      if (!includesFile(turn.edited, path)) turn.edited.push(path)
    }
  } else if (t === 'Bash') {
    const cmd = String(ti.command || '')
    if (cmd) turn.commands.push(cmd.slice(0, 400))
  } else if (t === 'Read' || t === 'NotebookRead') {
    const path = rel(ti.file_path || ti.filePath || ti.path || ti.notebook_path)
    if (path && !includesFile(turn.reads, path)) turn.reads.push(path)
  } else if (t === 'Grep' || t === 'Glob') {
    const pat = String(ti.pattern || ti.query || '')
    if (pat) turn.searches.push(`${t}:${pat.slice(0, 200)}`)
  }
  writeState('turn.json', turn)
  pass()
}

// ════════════════════════════════════════════════════════════════════════
if (event === 'stop') {
  const reasons = []
  const current = readState('current.json')
  const prevUnverified = readState('unverified.json', null)

  // ── まずマーカーを置く ──────────────────────────────────────────────
  // v22 は最後に置いていたので、タイムアウト・未捕捉例外・上限到達・ユーザーの
  // 割り込みで抜けると痕跡が残らなかった。先に置いて、合格が確定したときだけ消す。
  const stopHookActive = input.stop_hook_active === true || input.stopHookActive === true
  const count = (stopHookActive && prevUnverified ? (prevUnverified.count || 0) : 0) + 1
  // 上限の数は持たない（2026-09）。**このゲートは回数では通さない。** finish() の文面を参照

  // ── 観測 ────────────────────────────────────────────────────────────
  const dirty = gitDirty()
  if (dirty === null && cfg.vcs !== 'none') {
    writeState('unverified.json', { at: new Date().toISOString(), count, reason: 'git から実差分を取得できない', edited: [] })
    block(
      `このターンの変更内容を観測できませんでした（git status が使えません）。\n` +
      `  ゲートは「何を編集したか」を git のワークツリーから取ります。取れないと、\n` +
      `  何も検査できないまま「合格」になってしまいます。\n\n` +
      `  リポジトリではない場所で作業しているなら、project.json に "vcs": "none" を\n` +
      `  書いてください（その場合はツール使用履歴からの推定に落ちます。精度は下がります）。\n`)
  }
  const edited = dirty || (readState('turn.json', { edited: [] }).edited || []).filter(f => !matchesAny(f, MACHINE))

  // ── リポジトリ直下に段の名前のファイルが生えていないか（v34 T20）──────────
  // `bd->dd` を引用符なしで打つと、シェルが直下に `dd` を作る（turn 83）。打つ前に止めているが（pre-tool）、
  // 別の経路（ワークフローの子・人の手）で生えたときに気づけるよう、終わるときにも見る。
  // **消すかどうかは決めない。** 中身と経緯を確かめて報告する（空で履歴に無ければ本人に消してよいか聞く）。
  {
    const tierIds = new Set((cfg.tiers || []).map(x => String(x.id).toLowerCase()))
    const stray = (dirty || []).filter(f => !/[\/\\]/.test(f) && tierIds.has(f.toLowerCase()))
    if (stray.length) {
      reasons.push(
        `リポジトリ直下に、段の名前と同じファイルがあります: ${stray.join(' ')}\n` +
        `  \`bd->dd\` のような段の名前を引用符なしで打つと、シェルが \`>\` をリダイレクトにして作ります。\n` +
        `  中身（多くは 0 バイト）・git の履歴に無いこと・できた時刻を確かめ、**消さずに報告してください**。\n` +
        `  段の名前は "bd->dd" と引用符で囲むか、bd-dd の形で書いてください。`)
    }
  }

  writeState('unverified.json', {
    at: new Date().toISOString(), count, reason: '検査中に終了した', edited: edited.slice(0, 50),
  })

  const touchedCode = edited.some(f => matchesAny(f, CODE))
  const touchedDocs = edited.some(f => matchesAny(f, DOCS))
  const needsGoal = edited.some(f => matchesAny(f, NEEDS_GOAL))

  // ── 言ったことを、ツール使用履歴と実ファイルに照合する ────────────────
  // 本文は **stdin で渡す**。argv に積むと CreateProcess の 32,767 文字制限に当たり、
  // 長い最終報告ほど検査されなくなっていた（超過すると spawnSync が error を返し、
  // stdout が空 → JSON パース失敗 → v22 はそれを黙って通していた）。
  const said = input.last_assistant_message || input.lastAssistantMessage || ''
  if (said && (cfg.claimsRequired ?? true) !== false) {
    const r = spawnSync(NODE, [script('claims.mjs'), '--stdin', '--json'], {
      cwd: ROOT, encoding: 'utf8', input: String(said), maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, CLAUDE_VERIFY_NESTED: '1' },
    })
    const c = safe(() => JSON.parse(r.stdout), null)
    if (!c) {
      reasons.push(
        `主張の照合を実行できませんでした。検査結果が無いので、このターンは終われません。\n` +
        `  ${r.error ? r.error.message : `exit=${r.status}`}\n` +
        `  ${((r.stderr || '').split('\n').filter(Boolean).slice(-4).join('\n  ')) || '(stderr なし)'}`)
    } else if (c.blocking) {
      const lines = c.findings.filter(f => !f.advisory).map(f =>
        f.file ? `  ✗ ${f.file}:${f.line}  ${f.why}${f.quote ? `\n      引用: ${f.quote.slice(0, 80)}` : ''}`
               : `  ✗ 「${f.sentence}」\n      ${f.why}`)
      reasons.push(
        `裏の取れていない主張が ${c.blocking} 件あります。\n` +
        lines.join('\n') + '\n\n' +
        `  引用は実ファイルと一致していること。「無い」と書くなら探した記録が要ります。\n` +
        `  確かめていないなら **「未確認（推測）」と書いてください**——そう書けば主張として扱いません。\n` +
        `  規約は .claude/rules/core.md §1（引用の書式は3つしかない）。ここはその強制です。`)
    }
  }

  // ── レビューの分母 ──────────────────────────────────────────────────
  // レビューエージェントは読み取り専用でファイルを 1 つも編集しないので、
  // 「編集があったターン」だけを見る位置に置くと一度も発火しない。早期 return より前に置く。
  if (current?.phase === 'review') {
    const rv = runJson([script('diff-units.mjs'), 'pending', '--json'], 'レビューの分母の取得', reasons)
    if (rv && !rv.units) {
      reasons.push(
        `レビューの分母が固定されていません。\n` +
        `  何 hunk あるかを機械に数えさせてから読み始めてください。\n` +
        `    node .claude/scripts/diff-units.mjs split\n` +
        `    node .claude/scripts/diff-units.mjs next 1\n` +
        `  **分母が無い状態の「指摘 0 件」は、問題が無いことではなく、何も見ていないことです。**`)
    }
  }

  if (!edited.length) {
    finish(reasons, edited, current, count, prevUnverified)
  }

  // ── 作業の種類は、宣言ではなく**触ったもの**から決める ─────────────────
  // 宣言は「より厳しい側へ」だけ効く。宣言しなければ検査が掛からない状態を無くす。
  const declaredPhase = current?.phase || null
  if (declaredPhase && !PHASES.includes(declaredPhase)) {
    reasons.push(
      `.claude/state/current.json の phase が不正です: ${JSON.stringify(declaredPhase)}\n` +
      `  使えるのは ${PHASES.join(' / ')} だけです。未知の値を書くと、台帳もゴールも\n` +
      `  「作業ではない」と判定されて全部外れます。state.mjs から設定し直してください。\n` +
      `    node .claude/scripts/state.mjs phase design|impl|test|review`)
  }
  const derivedPhase = touchedCode ? 'impl' : touchedDocs ? 'design' : null
  const workPhase = (declaredPhase === 'design' || declaredPhase === 'impl') ? declaredPhase : derivedPhase
  const inWork = workPhase === 'design' || workPhase === 'impl'

  // ── 逃げ道は 1 つだけ。ただし必ず記録が残る ────────────────────────────
  // current.json は state.mjs 経由でしか書けないので、ここでは「宣言が在るか」だけを見る。
  // 検査（理由の長さ・触ったファイルへの言及・連続使用）は state.mjs 側で行う。
  let adhoc = null
  if (declaredPhase === 'adhoc') {
    const why = String(current?.why || '').trim()
    if (!why) {
      reasons.push(
        `adhoc の宣言に理由がありません。state.mjs から宣言し直してください。\n` +
        `    node .claude/scripts/state.mjs adhoc "<何をなぜ台帳なしで直すか。触ったファイル名を含める>"`)
    } else {
      adhoc = { why, edited: edited.slice(0, 20) }
    }
  }

  // ── ゴールが置かれているか ──────────────────────────────────────────
  const mode0 = cfg.goalRequired || 'phase'
  const goalApplies = mode0 === 'off' ? false : mode0 === 'always' ? needsGoal : needsGoal && inWork && !adhoc
  if (goalApplies) {
    const missing = ['unit', 'goal', 'verifyBy'].filter(k => !current?.[k])
    if (missing.length) {
      reasons.push(
        `ゴールが置かれていません（不足: ${missing.join(', ')}）。\n` +
        `    node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<何が在れば完了か>" \\\n` +
        `         --verify-by "<誰が見ても同じ判定になる手段。できればコマンド>"\n` +
        `  ゴールが無い作業は、一番早く終わる基準に収束します。`)
    }
  }

  // ── 担当範囲の分母が固定されているか ────────────────────────────────
  const lmode = cfg.ledgerRequired || 'phase'
  const ledgerApplies = lmode === 'off' ? false
    : lmode === 'always' ? (touchedCode || touchedDocs) && !adhoc
    : (touchedCode || touchedDocs) && inWork && !adhoc
  if (ledgerApplies) {
    const lg = current?.ledger
    if (!lg?.edge) {
      reasons.push(
        `担当範囲の台帳が置かれていません。\n` +
        (declaredPhase ? '' :
          `  作業の宣言が無いので、触ったファイルから **${derivedPhase}** と判定しました（${edited.slice(0, 3).join(' ')}${edited.length > 3 ? ' …' : ''}）。\n` +
          `  宣言しなければ検査が掛からない、という状態を無くすためです。\n`) +
        `  A) この作業のブレイクダウンとして進める:\n` +
        `     node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" \\\n` +
        `          --verify-by "<検証手段>" --edge "<段>" --file "<対象ファイル名の一部>"\n` +
        `     段は project.json の edges にあるもの: ${(safe(() => (cfg.edges || []).map(e => `${e.from}->${e.to}`).join(' / '), '?'))}\n` +
        `  B) 台帳を使わない小修正として通す（記録が残る）:\n` +
        `     node .claude/scripts/state.mjs adhoc "<何をなぜ台帳なしで直すか。触ったファイル名を含める>"\n` +
        `  分母を固定しないまま書くと、書いた側が「全部やった」と思った時点で漏れが確定します。\n` +
        `  **B を選んでも構いません。選んだことが残るのが要点です。**`)
    } else {
      const a = [script('ledger.mjs'), 'pending', lg.edge, '--json']
      if (lg.file) a.push('--file', lg.file)
      if (lg.section) a.push('--section', lg.section)
      if (lg.lines) a.push('--lines', lg.lines)
      const pend = runJson(a, `台帳の状態の取得（${lg.edge}）`, reasons)
      // 区切りに分けて進めている（v34 T25）。範囲の外の未分解は止めずに、数と宣言した扱いを毎回知らせる。
      // **知らせるだけで、数えるのをやめたわけではない。** 範囲を外せば、今までどおり止まる。
      if (lg.lines && pend) {
        const b = [script('ledger.mjs'), 'pending', lg.edge, '--json']
        if (lg.file) b.push('--file', lg.file)
        const whole = runJson(b, `台帳の状態の取得（${lg.edge}・区切りの外を含む）`, [])
        const rest = whole ? Math.max(0, (whole.undecomposed || 0) - (pend.undecomposed || 0)) : null
        if (rest) notices.push(`区切り（${lg.file} の ${lg.lines} 行）の外に未分解 ${rest} 単位があります。宣言した扱い: ${lg.later || '（無し）'}`)
      }
      if (pend && pend.units === 0) {
        reasons.push(
          `台帳のこの範囲に単位が 1 つもありません（${pend.edge}${lg.file ? ` / ${lg.file}` : ''}）。\n` +
          `  範囲の指定が実ファイルに当たっていないか、split / sync が未実行です。\n` +
          `    node .claude/scripts/split.mjs --all\n` +
          `    node .claude/scripts/ledger.mjs sync ${JSON.stringify(pend.edge)}\n` +
          `  **0 件を「漏れなし」と読まないこと。** 分母が空なのと、漏れが無いのは違います。`)
      } else if (pend && pend.undecomposed > 0) {
        reasons.push(
          `担当範囲の分母が固定されていません（${pend.edge}${lg.file ? ` / ${lg.file}` : ''}）。\n` +
          `  未分解 ${pend.undecomposed} / ${pend.units} 単位。上位が何を要求しているかを列挙してから書いてください。\n` +
          `    node .claude/scripts/ledger.mjs next ${JSON.stringify(pend.edge)} --phase decompose${lg.file ? ` --file ${JSON.stringify(lg.file)}` : ''}\n` +
          `  **分解のときは下位を開かないこと。** 下位を見ながら列挙すると、下位に無いものが列挙から漏れます。\n` +
          `  残り: ${pend.undecomposedIds.slice(0, 5).join(' ')}${pend.undecomposed > 5 ? ' …' : ''}`)
      }

      // ── 承認（③）─────────────────────────────────────────────────────
      // 分解の**形**は機械が見ているが、「そもそも要求か」は見ていない。
      // そこを別の目に通したかどうかを、ここで止める。
      //
      // **既定では止めない。** project.json の edge に requireApproval: true を
      // 書いた段だけが対象。承認がどのくらい当たるかを測る前に全段を止めると、
      // 当たっていない検査で作業が止まる——「当たっていない警告は、警告そのものを
      // 無視する癖をつける」のと同じことが Stop でも起きる。
      if (pend && pend.requireApproval && pend.approvalUnresolved > 0) {
        const a = pend.approval || {}
        reasons.push(
          `担当範囲の分解が承認を通っていません（${pend.edge}${lg.file ? ` / ${lg.file}` : ''}）。
` +
          `  未承認 ${a.unseen || 0}  指摘 ${a.challenged || 0}  保留 ${a.deferred || 0}（承認済 ${a.ok || 0} / ${a.entries || 0}）
` +
          (a.unseen ? `  まだ見ていない分:
    node .claude/scripts/ledger.mjs approve-next ${JSON.stringify(pend.edge)}${lg.file ? ` --file ${JSON.stringify(lg.file)}` : ''}
` : '') +
          ((a.challenged || a.deferred) ? `  食い違った分（**消えません**。次の 3 つのどれか）:
    1. 分解を直す  2. 反論を記録する（rebut）  3. **本人の判断へ回す（hold）**
       node .claude/scripts/ledger.mjs hold ${JSON.stringify(pend.edge)} <entryId> --why "…"
       **決められないものを、その場で決めないこと。** 2 周目（settle）が割れたなら 3 番です。
` +
            `    ${(pend.challengedIds || []).slice(0, 5).join(' ')}${(a.challenged + a.deferred) > 5 ? ' …' : ''}
` : '') +
          `  形の検査は「紐付けが嘘でないか」しか見ません。**「そもそも要求か」は別の目でしか見えません。**
` +
          `  ラベル・目的・経緯・出典を要求として台帳に載せると、分母が水増しされたまま固定されます。`)
      }

      // ── 宣言した範囲が、実際に書いたものと関係しているか ──────────────
      // `--file` は**検証される側が自分で選ぶ自由文**で、ledger 側では
      // 単なる部分一致にしかならない。狭く宣言すれば、分母の小さい
      // （既に分解済みの）範囲で Stop を通せる。
      // `adhoc` には「触ったファイルに言及すること」の検査があるのに、
      // `goal --edge --file` には無かった。**分母の範囲を、測られる側が選べる。**
      //
      // 上位段が文書のエッジ（dd->impl など）は、編集したコードと設計書の
      // 対応がパスでは決まらないので、ここでは判定しない（別の手が要る）。
      // **決められないものを決めたことにしない。** 下の 2 つだけを見る。
      const tierOf = f => (cfg.tiers || []).filter(t =>
        matchesAny(f, t.sources || []) && !matchesAny(f, t.exclude || []))
      const owned = edited.filter(f => tierOf(f).length)
      const e = (cfg.edges || []).find(x => `${x.from}->${x.to}` === lg.edge)

      if (e && owned.length) {
        // (1) 宣言したエッジと、書いたものが無関係でないか。
        //     「そのエッジの下位段のファイルを 1 つも書いていない」なら、
        //     宣言が作業と噛み合っていない（別のエッジか adhoc が正しい）。
        //     1 つでも噛み合っていれば通す——テストを書くついでに実装を触るのは普通なので、
        //     全件を要求すると adhoc が既定の経路になる。
        const inTo = owned.filter(f => tierOf(f).some(t => t.id === e.to))
        // **V 字の最上位だけは、上位側を直すのもその段の作業として通す。**
        //
        // 「上位側を書いていれば通す」に広げてはいけない。実装を書きながら
        // `impl->ut` を宣言できてしまい、**分母がテスト側のものになる**。
        // 通すのは「他に宣言しようが無い」場合に限る——どの段の `to` にもなっていない
        // 段（= 最上位）の source を書いたときだけ。
        const topTiers = new Set((cfg.tiers || []).map(t => t.id)
          .filter(id => !(cfg.edges || []).some(x => x.to === id)))
        const inFrom = owned.filter(f => tierOf(f).some(t => t.id === e.from && topTiers.has(t.id)))
        //
        // 実測（2026-09-16）: `/ask` の答えを要件定義書に反映するターンが、
        // 2 回続けて adhoc に落ちた。要件定義書は req 段の source だが、
        // req を `to` に持つ段は無い（V 字の最上位なので当然）。
        // つまり**どの段を宣言しても「下位側を書いていない」で弾かれ、
        // adhoc しか経路が無かった。** 検査が下位側しか見ていなかったのが原因で、
        // 上位を直す作業が不正だったわけではない。
        //
        // 上位を直したときの歯止めは別に掛かっている:
        //   分母のズレ（split drift）  … 再切り出ししないと終われない
        //   未分解（ledger pending）   … 増えた分を分解しないと終われない
        //   未確定点の持ち込み（下記） … 「等」を閉じながら新しい「等」を足せない
        // **ここで止めても、その 3 つの代わりにはならない。**
        if (!inTo.length && !inFrom.length) {
          reasons.push(
            `宣言した段（${lg.edge}）の下位側に当たるファイルを 1 つも書いていません。\n` +
            `  書いたもの: ${owned.slice(0, 5).join(' ')}${owned.length > 5 ? ' …' : ''}\n` +
            `  この宣言では、いま書いたものが分母のどこにも対応しません。**範囲を自分で選べる以上、噛み合いは機械が見ます。**\n` +
            `  A) 正しい段を宣言し直す: node .claude/scripts/state.mjs goal --edge "<段>" --file "<範囲>" …\n` +
            `  B) 台帳を使わない小修正として通す: node .claude/scripts/state.mjs adhoc "<理由。触ったファイル名を含める>"`)
        }

        // (2) 上位段が**コードそのもの**のエッジ（impl->ut）に限り、
        //     書いたテストが検証している実装ファイルが、宣言範囲に入っているかを照合する。
        //     `X.test.ts` ↔ `X.ts` は規約なので、対応する実装が実在するときだけ判定する。
        //     実在しない・規約から外れている場合は**何も言わない**（偽陽性を作らない）。
        if (lg.file) {
          const fromT = (cfg.tiers || []).find(t => t.id === e.from)
          const outside = []
          for (const f of inTo) {
            const sib = f.replace(/\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/, '.$2')
            if (sib === f) continue                                   // 規約から外れている
            if (!fromT || !matchesAny(sib, fromT.sources || []) ||
                matchesAny(sib, fromT.exclude || [])) continue        // 上位段のものではない
            if (!existsSync(join(ROOT, sib))) continue                // 実在しない
            if (!sib.includes(lg.file)) outside.push({ test: f, impl: sib })
          }
          if (outside.length) {
            reasons.push(
              `宣言した範囲（--file ${JSON.stringify(lg.file)}）の外にある実装のテストを書いています。\n` +
              outside.slice(0, 5).map(x => `    ${x.test}\n      → 検証対象 ${x.impl}（範囲に入っていない）`).join('\n') +
              (outside.length > 5 ? `\n    … 他 ${outside.length - 5} 件` : '') + '\n' +
              `  **範囲を狭く宣言すると、分母も小さくなります。** 狭い分母で「未分解 0」を作れてしまうので、\n` +
              `  書いたものが範囲に入っているかを照合しています。\n` +
              `  範囲を書いたものに合わせて宣言し直してください:\n` +
              `    node .claude/scripts/state.mjs goal --unit "<作業名>" --goal "<達成状態>" \\\n` +
              `         --verify-by "<検証手段>" --edge ${JSON.stringify(lg.edge)} --file "<全部を含む範囲。空にすると段の全体>"`)
          }
        }
      }
    }
  }

  // ── 上位文書を編集したのに分母を作り直していないか ──────────────────
  {
    const touchedTiers = (cfg.tiers || []).filter(t => edited.some(f => matchesAny(f, t.sources || [])))
    if (touchedTiers.length) {
      const d = runJson([script('split.mjs'), 'drift', '--json'], '分母のズレの確認', reasons)
      const names = new Set(touchedTiers.map(t => t.id))
      const bad = (d?.rows || []).filter(x => names.has(x.tier) && x.state === 'ズレあり')
      if (bad.length) {
        reasons.push(
          `編集した文書の分母が作り直されていません（${bad.map(b => b.tier).join(' ')}）。\n` +
          bad.map(b => `  ${b.tier}: 新規 ${b.added} / 変化 ${b.changed} / 消失 ${b.removed}`).join('\n') + '\n' +
          `  **増えた分は、いまどの台帳にも載っていません。**足した要求が誰にも見えないまま完了になります。\n` +
          bad.map(b => `    node .claude/scripts/split.mjs ${b.tier}`).join('\n') + '\n' +
          `    node .claude/scripts/ledger.mjs sync "<edge>"`)
      }
    }
  }

  // ── 上位文書に**新しい**未確定点を持ち込んでいないか ──────────────────
  {
    // 実測で 2 回やられた形: 「等」を閉じるための答えのほうに「など」が入っていた
    // （L80「DADGADやFAG・・・など」、L123「アーティスト名なども」）。
    // `ask-record` は**答え**を見るが、**要件定義書に実際に何が書かれたか**は見ていない。
    // ここで文書側を見る。
    //
    // **行ごとではなく、ファイル全体の個数で見る。** 行で見ると、
    // 「等」を含む既存行を別の理由で触っただけで当たる（過剰検出。wording.mjs の F21）。
    // 個数なら、並べ替え・字句の直しでは動かず、**増やしたときだけ**動く。
    //
    // adhoc を宣言していれば通す。**引用のように正当な場合があるから**で、
    // 通したことは journal に残る。drift（再切り出し）に逃げ道が無いのとは
    // 性質が違う——あちらは「やらないと分母が古いまま」で、代わりが無い。
    const touched = adhoc ? [] : edited.filter(f => (cfg.tiers || []).some(t =>
      matchesAny(f, t.sources || []) && !matchesAny(f, t.exclude || [])))
    const grew = []
    for (const f of touched) {
      const before = gitHead(f)
      if (before === null) continue                       // 新規ファイルは比較対象が無い
      let after; try { after = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
      const b = countOpenEnum(before), a = countOpenEnum(after)
      if (a > b) grew.push({ f, b, a })
    }
    if (grew.length) {
      reasons.push(
        `上位文書に**新しい未確定点**を足しています（未閉鎖の列挙）。\n` +
        grew.map(x => `  ${x.f}: ${x.b} → ${x.a} 個（+${x.a - x.b}）`).join('\n') + '\n' +
        `  「等」「など」「その他」「といった」「のような」は、何が対象で何が対象外かを決めていません。\n` +
        `  **閉じるための作業で新しく開くと、差し引きゼロになります。** 実測で 2 回これが起きました——\n` +
        `  「等」の中身を聞いた答えのほうに「など」が入っていた（L80「DADGADやFAG…など」ほか）。\n` +
        `  A) 中身を全部挙げて閉じる／「これ以外は対象外」と言い切る\n` +
        `  B) 本人に聞く: node .claude/scripts/ledger.mjs ask "<edge>"（Claude Code からは /ask）\n` +
        `  C) 引用など、どうしても必要なら記録を残して通す:\n` +
        `     node .claude/scripts/state.mjs adhoc "<なぜ未閉鎖の列挙を足すのか。触ったファイル名を含める>"`)
    }
  }

  // ── 水平展開 ────────────────────────────────────────────────────────
  if (touchedCode) {
    const sp = runJson([script('spread.mjs'), 'pending', '--json'], '同型走査の状態の取得', reasons)
    if (sp) {
      const newest = Math.max(0, ...edited.map(f => safe(() => statSync(join(ROOT, f)).mtimeMs, 0)))
      const fresh = sp.at && Date.parse(sp.at) >= newest
      const hitsEdited = (sp.files || []).some(f => includesFile(edited, f))
      const suggest = suggestPatterns(edited)

      if (!sp.hits) {
        reasons.push(
          `コードを変更したターンでは、同じ型が他に無いかを全件確認します。\n` +
          `  直した／書いた「型」で全リポジトリを検索し、ヒット全件に判定を付けてください。\n` +
          `    node .claude/scripts/spread.mjs scan "<型の正規表現>"\n` +
          `    node .claude/scripts/spread.mjs next 1\n` +
          (suggest.length ? `  今回の差分に出てくる語（パターンの候補）: ${suggest.join('  ')}\n` : '') +
          `  判定は 是正済み / 別物（理由）/ 繰越（G 番号）の 3 つ。**省略は用意していません。**`)
      } else if (!fresh) {
        reasons.push(
          `同型の走査が、このターンの変更より古いです（走査 ${String(sp.at).slice(0, 19)}）。\n` +
          `  前の走査の緑を使い回すと、セッション冒頭に 1 回スキャンするだけで以降ずっと緑になります。\n` +
          `    node .claude/scripts/spread.mjs scan "<型の正規表現>"` +
          (suggest.length ? `\n  差分に出てくる語: ${suggest.join('  ')}` : ''))
      } else if (!hitsEdited) {
        reasons.push(
          `走査したパターン /${sp.pattern}/ が、今回触ったファイルのどれにも当たっていません。\n` +
          `  触ったファイル: ${edited.slice(0, 5).join(' ')}${edited.length > 5 ? ' …' : ''}\n` +
          `  当たっていないなら、それは**今回の変更の型ではない別のもの**を数えています。\n` +
          (suggest.length ? `  差分に出てくる語: ${suggest.join('  ')}\n` : '') +
          `    node .claude/scripts/spread.mjs scan "<今回の変更に当たる型>"`)
      } else if (sp.unjudged > 0) {
        reasons.push(
          `同型の未判定が ${sp.unjudged} / ${sp.hits} 件残っています（パターン /${sp.pattern}/）。\n` +
          `    node .claude/scripts/spread.mjs next 1\n` +
          `  残り: ${(sp.unjudgedIds || []).slice(0, 5).join(' ')}${sp.unjudged > 5 ? ' …' : ''}`)
      }
    }
  }

  // ── 検証コマンド ────────────────────────────────────────────────────
  // キャッシュの判断は verify.mjs 側に寄せた。あそこは対象ファイルの内容から
  // ハッシュを自分で計算して突き合わせるので、**verify.json を書き換えても通らない**。
  // v22 はゲート側で cached.ok と時刻だけを見ていたので、ok:true を書けば素通りした。
  if (touchedCode || touchedDocs) {
    const args = [script('verify.mjs'), '--json']
    if (!touchedCode) args.splice(1, 0, 'docs')
    const r = run(args, { timeout: 1_500_000 })
    const v = safe(() => JSON.parse(r.stdout), null)
    if (!v) {
      reasons.push(
        `検証を実行できませんでした。緑かどうかが分からないので、このターンは終われません。\n` +
        `  ${r.error ? `${r.error.message}${r.error.code === 'ETIMEDOUT' ? '（時間切れ）' : ''}` : `exit=${r.status}`}\n` +
        `  ${((r.stderr || '').split('\n').filter(Boolean).slice(-6).join('\n  ')) || '(stderr なし)'}\n` +
        `  そのまま貼れます:  node .claude/scripts/verify.mjs`)
    } else if (!v.ok) {
      const bad = (v.results || []).filter(x => !x.ok && !x.skipped)
      reasons.push(
        `検証が緑ではありません。緑でない状態を「完了」と呼ばない規約です。\n` +
        bad.map(b => `  ✗ ${b.name}: ${b.cmd}\n${(b.tail || '').split('\n').slice(-8).map(l => '      ' + l).join('\n')}`).join('\n') +
        `\n  そのまま貼れます:  node .claude/scripts/verify.mjs`)
    }
  }

  finish(reasons, edited, current, count, prevUnverified, adhoc)
}

// ════════════════════════════════════════════════════════════════════════
function finish(reasons, edited, current, count, prevUnverified, adhoc) {
  if (!reasons.length) {
    for (const n of notices) process.stderr.write(`（${n}）\n`)
    if (adhoc) {
      journal('adhoc-used', { why: adhoc.why, edited: adhoc.edited })
      const c = readState('current.json') || {}
      delete c.phase; delete c.why
      writeState('current.json', c)
    }
    clearState('turn.json')

    // ── マーカーを消してよいか ────────────────────────────────────────
    // v22 は編集ゼロのターンで無条件に消していた。割り込み → 「ありがとう」の
    // 一言 → 消滅、で「抜けても記録が残る」が成立していなかった。
    // 前回記録した未検証ファイルが、いま検証済みか、もう汚れていない場合だけ消す。
    const stale = (prevUnverified?.edited || []).filter(f => !includesFile(edited, f) && existsSync(join(ROOT, f)))
    const stillDirty = stale.filter(f => (gitDirty() || []).some(d => sameFile(d, f)))
    if (!stillDirty.length) clearState('unverified.json')
    else {
      writeState('unverified.json', { ...prevUnverified, note: '未検証のまま残っている変更があります', edited: stillDirty })
      process.stderr.write(
        `（前のターンで検証を通っていない変更が残っています: ${stillDirty.slice(0, 5).join(' ')}）\n`)
    }
    process.exit(0)
  }

  writeState('unverified.json', {
    at: new Date().toISOString(), count,
    reason: reasons[0].split('\n')[0],
    reasons: reasons.map(r => r.split('\n')[0]),
    edited: edited.slice(0, 50),
  })
  journal('stop-blocked', { count, first: reasons[0].split('\n')[0], edited: edited.slice(0, 10) })

  let msg = `このターンはまだ終われません。\n\n${reasons.join('\n\n')}\n`

  if (prevUnverified?.note) {
    msg += `\n（前のターンで検証を通っていない変更も残っています: ${(prevUnverified.edited || []).slice(0, 5).join(' ')}）\n`
  }
  // **このゲートは回数では通さない。**（2026-09 是正、rationale.md「踏んだ罠 14」）
  // 以前は「Claude Code 本体が連続 8 回で hook を止める（CLAUDE_CODE_STOP_HOOK_BLOCK_CAP）」を
  // 前提に、6 回目から「上限で本体が hook を外すのでターンは終わる」と告げていた。
  // 実測では 20 回連続でも通らず、本人が Esc で止めるまで続いた。公式ドキュメントでも確認できていない。
  // **自分が制御していない仕組みの挙動を、文面で約束しない。**
  // 自前の上限も持たない。回数で通すゲートは「失敗を繰り返せば通れる」ゲートになる。
  // 行き詰まったときにターンを終えるかどうかは本人が決める（Esc）。
  if (count >= 3) {
    msg += `\n**${count} 回連続でブロックされています。このゲートは回数では通りません。**\n` +
           `同じ理由で止まり続けているなら、**修正を繰り返さず、いま本人に報告してください。**\n` +
           `報告に含めること: 何が通らないのか／指示と衝突しているか（原因が設計側にあるか）。\n` +
           `ターンを終えるかどうかは本人が決めます（Esc）。\n`
  }
  msg += `\nなお、本人の中断や Claude Code 側の都合でこのターンが終わっても、この記録は ` +
         `.claude/state/unverified.json と journal.jsonl に残り、次のセッション開始時に必ず表示されます。\n`
  block(msg)
}

// 編集前（HEAD）の中身。無ければ null（新規ファイル）。
function gitHead(path) {
  const r = spawnSync('git', ['show', `HEAD:${path}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
  return (r.status === 0 && !r.error) ? r.stdout : null
}
// 自前で数えていたものを lib/wording.mjs へ移した（2026-09）。
// **ここで数えると、共有の定義に入れた除外がゲートに届かない。** 実際に届かなかった。

// 走査パターンの候補を、実際の差分から拾う。**緩めずに軽くする**ための補助。
function suggestPatterns(edited) {
  const r = spawnSync('git', ['diff', '-U0', '--', ...edited],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
  const body = (r.stdout || '').split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n')
  const GEN = new Set(['export', 'import', 'const', 'let', 'var', 'function', 'return', 'class',
                       'interface', 'type', 'public', 'private', 'static', 'async', 'await', 'this',
                       'new', 'null', 'undefined', 'true', 'false', 'void', 'string', 'number', 'boolean',
                       'if', 'else', 'for', 'while', 'try', 'catch', 'throw', 'console', 'log'])
  const count = new Map()
  for (const m of body.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
    const w = m[0]
    if (GEN.has(w.toLowerCase())) continue
    count.set(w, (count.get(w) || 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w)
}

pass()
