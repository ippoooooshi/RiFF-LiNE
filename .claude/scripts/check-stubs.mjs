#!/usr/bin/env node
// ダミー配線・仮実装・放棄マーカーを検出する。
//
// なぜこれがあるか:
//   15 画面が () => undefined のまま「シェル段階だから非ブロッキング」と
//   分類され、実 UI で初めて何も動かないことが判明した（G23）。
//   「完成」とは、設計が定めた接続先へ実結線され、その経路が自動テストで
//   検証されている状態を指す。シェルは完成ではない。
//
// 意図的な繰り越しは // quality-allow-stub: <理由と、いつどの作業単位で解消するか>
// を直前行か同一行に書く。理由が空のマーカーは許可として扱わない。
import { filesFor, read, json, codeGlobs, config } from './lib/config.mjs'

// project.json の paths.stubTargets（無ければ paths.code）。PORTING.md が「ここだけ固有」と書いていた箇所
const TARGETS = (Array.isArray(config().paths?.stubTargets) && config().paths.stubTargets.length) ? config().paths.stubTargets : codeGlobs()
const EXCLUDE = ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts']

// 何を「ダミー配線」と呼ぶかは文脈で決まる。旧実装は行に部分一致するだけで、
// 20 件中 12 件が誤検知だった:
//   - JSDoc の説明文に出てくる「未実装」（Phase 2 未実装の…）
//   - return () => undefined（対象が無い場合の正当な no-op undo）
//   - run.catch(() => undefined)（意図的な Promise チェーン切り）
// ダミー配線の本体は「接続先に渡される値が何もしない関数であること」なので、
// **プロパティ／引数への代入位置に限定**する。
const ASSIGN_NOOP = /(?:^|[\s,{(])[A-Za-z_$][A-Za-z0-9_$]*\s*(?:=\s*\{|=|:)\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:undefined\b|\{\s*\}|null\b)/
const ASSIGN_NOOP_ARGS = /(?:^|[\s,{(])[A-Za-z_$][A-Za-z0-9_$]*\s*(?:=\s*\{|=|:)\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*\}/
// これらの位置に現れる no-op は正当なので除外する
// return そのものを一律に除外すると、return <X prop={() => undefined} /> という
// 典型的なダミー配線まで見逃す。除外するのは「no-op 関数を直接返している」形だけ。
const LEGIT_NOOP_CONTEXT = /\.(catch|then|finally|forEach|on|once|off|addEventListener|removeEventListener)\s*\(\s*(?:async\s*)?\(|^\s*return\s*(?:async\s*)?\(\s*\)\s*=>|\bdefault\s*:\s*(?:async\s*)?\(\s*\)\s*=>/

const CODE_PATTERNS = [
  { kind: 'noop-handler', test: l => (ASSIGN_NOOP.test(l) || ASSIGN_NOOP_ARGS.test(l)) && !LEGIT_NOOP_CONTEXT.test(l),
    why: '接続先へ何もしない関数を渡している。設計が定めたサービス／コントローラ／IPC へ実結線する。' },
  { kind: 'throw-stub', test: l => /throw new Error\(\s*['"`](未実装|not implemented|TODO)/i.test(l),
    why: '未実装 throw。' },
]

// コメント内で拾うのは「専用マーカー」だけ。自然言語（未実装・仮実装）は
// 説明文にも普通に出るので、行コメントに限り、かつ JSDoc は除外する。
const MARKER = /\b(TODO|FIXME|XXX|HACK)\b/
const ABANDON = /(未実装|とりあえず|仮実装|not implemented|NotImplemented)/i

const findings = []
for (const f of filesFor(TARGETS, EXCLUDE)) {
  const lines = read(f).split('\n')
  let inBlockComment = false, inJsDoc = false

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const wasJsDoc = inJsDoc
    // コメント開始の判定は文字列リテラルを消してから行う。
    // `const pattern = 'src/*.ts'` の `/*` でブロックコメント状態に入り、
    // 以降の行のコード検査が丸ごと飛んでいた（glob・URL・正規表現で日常的に起きる）。
    const noStr = line.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
    if (!inBlockComment && /\/\*\*/.test(noStr)) { inBlockComment = true; inJsDoc = true }
    else if (!inBlockComment && /\/\*/.test(noStr)) { inBlockComment = true; inJsDoc = false }
    const openedHere = inBlockComment && !wasJsDoc
    const isJsDocLine = inJsDoc || (openedHere && /\/\*\*/.test(line))
    const wasInBlock = inBlockComment
    if (inBlockComment && /\*\//.test(noStr)) { inBlockComment = false; inJsDoc = false }

    const allow = /quality-allow-stub:\s*\S+/.test(line) || (i > 0 && /quality-allow-stub:\s*\S+/.test(lines[i - 1]))
    if (allow) return

    const push = (kind, why) => findings.push({ file: f, line: i + 1, kind, why, text: trimmed.slice(0, 120) })

    // 専用マーカーはコメント内でも拾う（それが目的の記法なので）
    if (MARKER.test(line)) { push('todo', '未処理マーカー。'); return }

    // 自然言語の放棄マーカーは、行コメント（// …）に限る。JSDoc の説明文は除外
    const lineComment = trimmed.startsWith('//') ? trimmed : (line.match(/(?<![:'"`])\/\/.*$/) || [''])[0]
    if (lineComment && !isJsDocLine && ABANDON.test(lineComment)) {
      push('not-impl', '放棄マーカー。'); return
    }

    // コード側の判定はコメント行を除いて行う
    if (wasInBlock || trimmed.startsWith('//') || trimmed.startsWith('*')) return
    const codeOnly = line.replace(/\/\/.*$/, '')
    for (const p of CODE_PATTERNS) {
      if (p.test(codeOnly)) { push(p.kind, p.why); return }
    }
  })
}

// 許可付き繰り越しも数えて出す（無期限に増えていないかを見るため）
const allowed = []
for (const f of filesFor(TARGETS, EXCLUDE)) {
  read(f).split('\n').forEach((line, i) => {
    const m = line.match(/quality-allow-stub:\s*(.+)$/)
    if (m) allowed.push({ file: f, line: i + 1, reason: m[1].trim() })
  })
}

// v65: 繰り越しの注が指す G の行が、ギャップ台帳（project.json の gapLedger）に在るかを機械で見る。
//   rules/ui.md は「注と G の行の片方だけでは通らない」と決めているのに、今までは「確認すること」と出すだけだった（turn 188 の指摘）。
//   注に G 番号が無いもの・台帳に無い G 番号を指すものは、繰り越しとして認めず findings に入れる。
//   G の行の「解消済み」は見ない（一部だけ解消済みと書く行があり、誤って赤にするため）
{
  const gl = config().gapLedger || {}
  if (gl.file && allowed.length) {
    let ledgerText = ''
    try { ledgerText = read(gl.file) } catch { /* 無ければ下で全部を台帳に無いとする */ }
    const prefix = gl.prefix || 'G'
    const have = new Set((ledgerText.split('\n').filter(l => new RegExp(`^\\|\\s*${prefix}\\d+`).test(l.trim()))
      .map(l => (l.match(new RegExp(`${prefix}\\d+`)) || [])[0]).filter(Boolean)))
    for (const a of allowed) {
      const refs = [...new Set(String(a.reason).match(new RegExp(`\\b${prefix}\\d+\\b`, 'g')) || [])]
      if (!refs.length) findings.push({ file: a.file, line: a.line, kind: 'allow-no-gap', why: `繰り越しの注に ${prefix} 番号が無い。${gl.file} の §${gl.section || '?'} に ${prefix} の行を起こし、その番号を注に書く。`, text: a.reason.slice(0, 120) })
      else for (const r of refs.filter(r => !have.has(r))) findings.push({ file: a.file, line: a.line, kind: 'allow-gap-missing', why: `繰り越しの注が指す ${r} が ${gl.file} の §${gl.section || '?'} に無い。`, text: a.reason.slice(0, 120) })
    }
  }
}

if (json) console.log(JSON.stringify({ findings, allowed }, null, 2))
else {
  findings.forEach(x => console.log(`${x.file}:${x.line}  [${x.kind}]  ${x.text}\n    ${x.why}`))
  console.log(`\ncheck-stubs: ${findings.length} 件`)
  if (allowed.length) {
    // **置き場所は project.json の gapLedger から出す。** ファイル名を決め打ちすると、
    // 詳細設計を作り直してファイルや節を動かしたとき、ここだけ古い場所を指し続ける（v28 T6）。
    const gl = config().gapLedger || {}
    const where = gl.file ? `${String(gl.file).split('/').pop()}${gl.section ? ` §${gl.section}` : ''}` : 'G 台帳'
    console.log(`\n意図的な繰り越し ${allowed.length} 件（指す ${gl.prefix || 'G'} 番号が ${where} に在ることは機械で確かめた。v65）:`)
    allowed.forEach(a => console.log(`  ${a.file}:${a.line}  ${a.reason}`))
  }
}
process.exit(findings.length ? 1 : 0)
