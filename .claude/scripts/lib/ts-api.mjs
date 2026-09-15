// TypeScript の公開 API とテストを抽出する。
//
// 詳細設計 → 実装、実装 → 単体テストの段は、下位側の列挙を 100% 機械化できる。
// 正規表現でも大半は拾えるが、複数行シグネチャ・デコレータ・オーバーロードで
// 落ちるので、リポジトリに既にある `typescript` パッケージがあればそれを使う。
// 無ければ正規表現へフォールバックする（別依存は足さない）。
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from './config.mjs'

let ts = null, tsTried = false
export function loadTs() {
  if (tsTried) return ts
  tsTried = true
  // 解決先を 2 つ試す。
  //  1. リポジトリ側の node_modules（本来これ。.claude 側に依存を持たない）
  //  2. **この道具自身の置き場所から**（1 が無いときの保険）
  // typescript はここでは「パーサ」としてしか使っていないので、どちらの版でも結果は同じ。
  // 解決できないと正規表現へ落ち、**クラス名で修飾されない・private が検出されない**ので、
  // internal を分母から外す仕組みが production でも効かなくなる。落ちる範囲が大きい。
  for (const base of [join(ROOT, 'package.json'), fileURLToPath(import.meta.url)]) {
    try { ts = createRequire(base)('typescript'); if (ts) break } catch { ts = null }
  }
  return ts
}

export function extractorMode() { return loadTs() ? 'typescript-ast' : 'regexp-fallback' }

// ── 公開 API（export / class / interface / method / function）─────────────
export function extractApi(rel, src) {
  const t = loadTs()
  if (!t) return extractApiRegexp(rel, src)

  const sf = t.createSourceFile(rel, src, t.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? t.ScriptKind.TSX : t.ScriptKind.TS)
  const out = []
  const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const exported = n => !!(t.getCombinedModifierFlags(n) & t.ModifierFlags.Export)

  // **関数の中へは降りない。**
  // 以前は t.forEachChild で全ノードを走っていたので、関数内のローカル変数
  // （const total / count / tmp …）まで「単位」として台帳に載っていた。
  // impl->ut の分母が「全ローカル変数」になり、未判定の件数が意味を失っていた。
  // 段の対象は**モジュールが外へ出している API**なので、トップレベルと
  // namespace の中、それにクラス／インターフェースのメンバーだけを見る。
  const isPrivate = (m) => {
    const f = t.getCombinedModifierFlags(m)
    if (f & t.ModifierFlags.Private) return true
    const n = m.name
    return !!(n && (t.isPrivateIdentifier(n) || String(n.text || '').startsWith('#')))
  }

  const visit = (node, owner = null) => {
    // namespace / module の中身は「外へ出している API」なので降りる
    if (t.isModuleDeclaration(node)) { if (node.body) t.forEachChild(node.body, c => visit(c, owner)); return }
    if (t.isClassDeclaration(node) || t.isInterfaceDeclaration(node)) {
      const name = node.name?.text
      if (name) {
        out.push({ kind: t.isClassDeclaration(node) ? 'class' : 'interface', name, line: line(node), exported: exported(node) })
        node.members?.forEach(m => {
          const mn = m.name && t.isIdentifier(m.name) ? m.name.text : null
          if (!mn) return
          const priv = isPrivate(m)
          if (t.isMethodDeclaration(m) || t.isMethodSignature(m) || t.isConstructorDeclaration(m)) {
            out.push({ kind: 'method', name: `${name}.${mn}`, owner: name, line: line(m),
                       exported: !priv, signature: signatureOf(t, m, sf) })
          } else if (t.isPropertyDeclaration(m) || t.isPropertySignature(m)) {
            out.push({ kind: 'property', name: `${name}.${mn}`, owner: name, line: line(m), exported: !priv })
          } else if (t.isGetAccessor(m) || t.isSetAccessor(m)) {
            out.push({ kind: 'accessor', name: `${name}.${mn}`, owner: name, line: line(m), exported: !priv })
          }
        })
      }
      return
    } else if (t.isFunctionDeclaration(node) && node.name) {
      out.push({ kind: 'function', name: node.name.text, line: line(node), exported: exported(node),
                 signature: signatureOf(t, node, sf) })
      return
    } else if (t.isTypeAliasDeclaration(node) && node.name) {
      out.push({ kind: 'type', name: node.name.text, line: line(node), exported: exported(node) })
      return
    } else if (t.isEnumDeclaration(node) && node.name) {
      out.push({ kind: 'enum', name: node.name.text, line: line(node), exported: exported(node) })
      return
    } else if (t.isVariableStatement(node)) {
      const ex = exported(node)
      node.declarationList.declarations.forEach(d => {
        if (d.name && t.isIdentifier(d.name)) {
          const isFn = d.initializer && (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer))
          out.push({ kind: isFn ? 'function' : 'const', name: d.name.text, line: line(d), exported: ex })
        }
      })
      return
    }
    // それ以外（if / for / 式文など）の中に API は無い。降りない。
  }
  t.forEachChild(sf, visit)
  return out
}

function signatureOf(t, node, sf) {
  try {
    const params = (node.parameters || []).map(p => p.getText(sf)).join(', ')
    const ret = node.type ? `: ${node.type.getText(sf)}` : ''
    return `(${params})${ret}`.slice(0, 300)
  } catch { return undefined }
}

function extractApiRegexp(rel, src) {
  const out = []
  // `export async function` を落としていた（async を許していなかった）
  const reApi = /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|type|enum|const|let|function)\s+([A-Za-z0-9_$]+)/
  const reMember = /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+)*([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/
  src.split('\n').forEach((raw, i) => {
    const a = raw.match(reApi)
    if (a) { out.push({ kind: a[1] === 'const' || a[1] === 'let' ? 'const' : a[1], name: a[2], line: i + 1, exported: true }); return }
    const b = raw.match(reMember)
    // 関数本体の中の呼び出し文（`setTimeout(tick, 1)` / `emit('x')`）は `)` か `);` で終わる。
    // メソッド宣言は `{`（本体）か `;`（interface）か、複数行なら `(` `,` で終わる。
    // 呼び出し文を method として数えると dd→impl の分母が水増しされる。
    const callLike = /\)\s*;?\s*(?:\/\/.*)?$/.test(raw) && !/\)\s*(?::\s*[^;{]+)?\s*[{;]\s*(?:\/\/.*)?$/.test(raw)
    if (b && !callLike && !/^\s*(if|for|while|switch|catch|return|await|new|else|do|try|throw)\b/.test(raw)) {
      out.push({ kind: 'method', name: b[1], line: i + 1 })
    }
  })
  return out
}

// ── テスト（it / test と ID）──────────────────────────────────────────────
//
// ID の在り処は 2 通りある。どちらも採番簿（basic_design/11_test_strategy.md §3.1）
// に沿った正しい書き方で、実機のリポジトリには両方が混在していた。
//
//   (a) テストごとのコメント … `it('…', () => { // UT-PLAY-SVC-07 §4.6.2「…」`
//   (b) ファイル冒頭の 1 行  … `// UT-EDIT-HIST: CommandHistory（元に戻す／やり直し）`
//
// v23 の最初の版は (a) しか見ていなかった。(b) だけのファイルは全テストが id=null に
// なり、split.mjs の idPrefix 絞り込み（testId が "UT-" で始まるもの）に掛からず、
// **1 件も分母に入らないまま黙って消えていた**。
// 実測: テストファイル 86 本のうち 33 本・it( 239 個が台帳の外にいた。
// しかも check-tests.mjs は「ファイルが予約プレフィックスの ID を 1 つ以上持つこと」
// しか見ないので 0 件で通る。**2 つの検査が違う粒度を見ていたので、どちらも緑だった。**
//
// 直し方: (b) の族（family）をファイル単位で拾い、(a) を持たないテストがそれを継ぐ。
// **番号は捏造しない。** 継ぐのは族（UT-EDIT-HIST）までで、id は null のまま置く。
// 勝手に UT-EDIT-HIST-01 を作ると、採番簿に無い ID が台帳に載って検査が嘘になる。
const TEST_ID_RE = /\b((?:UT|IT)-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)\b/
const TEST_FAM_RE = /\b((?:UT|IT)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\b/g

// ファイル冒頭（最初の describe / it / test より上、最大 40 行）のコメント行に在る族。
// 2 つ以上あるファイルは、どのテストがどちらのものか決められない。
// そのときは **推測せず null を返す**。落ちた分は split.mjs の orphan 検査が赤にする。
export function fileFamily(src) {
  const lines = Array.isArray(src) ? src : String(src).split('\n')
  let end = Math.min(lines.length, 40)
  for (let i = 0; i < end; i++) {
    if (/^\s*(?:describe|it|test)\s*[.(]/.test(lines[i] || '')) { end = i; break }
  }
  const fams = new Set()
  for (let i = 0; i < end; i++) {
    const raw = lines[i] || ''
    if (!/^\s*(?:\/\/|\/\*|\*)/.test(raw)) continue   // コメント行だけを見る
    for (const m of raw.matchAll(TEST_FAM_RE)) fams.add(m[1].replace(/-\d+$/, ''))
  }
  return fams.size === 1 ? [...fams][0] : null
}

export function extractTests(rel, src) {
  const t = loadTs()
  const lines = src.split('\n')
  const family = fileFamily(lines)
  const idOf = ln => {
    for (let i = ln - 1; i >= Math.max(0, ln - 4); i--) {
      const m = (lines[i] || '').match(TEST_ID_RE)
      if (m) return m[1]
    }
    return null
  }
  if (!t) {
    const out = []
    lines.forEach((raw, i) => {
      // `it.each([...])('name', …)` の形も拾う（テーブル引数の括弧を 1 段だけ許す）
      const m = raw.match(/^\s*(?:it|test)(?:\s*\.\s*\w+)?\s*(?:\((?:[^()]|\([^()]*\))*\)\s*)?\(\s*['"`](.+?)['"`]/)
      if (m) out.push({ kind: 'test', name: m[1], line: i + 1, id: idOf(i + 2), family, skipped: /\.\s*(skip|todo)\b/.test(raw) })
    })
    return out
  }
  const sf = t.createSourceFile(rel, src, t.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? t.ScriptKind.TSX : t.ScriptKind.TS)
  const out = []
  const visit = node => {
    if (t.isCallExpression(node)) {
      let head = node.expression.getText(sf)
      // `it.each([...])('name', …)` は外側の呼び出しの expression が CallExpression。
      // head が `it.each([...])` になって正規表現に掛からず、台帳と検査の両方から消えていた。
      if (t.isCallExpression(node.expression) && /^(it|test)\.each$/.test(node.expression.expression.getText(sf))) {
        head = node.expression.expression.getText(sf)
      }
      if (/^(it|test)(\.(skip|only|todo|concurrent|each))?$/.test(head)) {
        const arg = node.arguments[0]
        if (arg && (t.isStringLiteral(arg) || t.isNoSubstitutionTemplateLiteral(arg))) {
          const ln = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
          out.push({ kind: 'test', name: arg.text, line: ln, id: idOf(ln + 1), family,
                     skipped: /\.(skip|todo)$/.test(head) })
        }
      }
    }
    t.forEachChild(node, visit)
  }
  t.forEachChild(sf, visit)
  return out
}
