#!/usr/bin/env node
// 検査スクリプト自身が壊れていないかを見る。
//
// なぜ selftest.mjs を置き換えたか:
//   v22 の selftest は 120KB・子プロセス 302 本・実測 23 秒（Windows ではさらに）で、
//   しかも毎回の verify に入っていた。Stop hook がタイムアウトすると non-blocking 扱いで
//   ターンが通るので、**重すぎる検査は、検査が無いのと同じ**ところまで行っていた。
//   ここは主要経路を 1 回ずつ通すだけにする。目標 10 秒・子プロセス 30 本以内。
//
// 何を見るか:
//   各経路につき「通るべき入力が通る」と「**通らないべき入力が弾かれる**」を 1 本ずつ。
//   後者がそのまま、v23 で塞いだ穴の回帰テストになる。塞いだはずの穴が開いたら赤になる。
//
// 使い方:
//   node .claude/scripts/smoke.mjs [--verbose]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'hooks', 'gate.mjs')
const NODE = process.execPath
const verbose = process.argv.includes('--verbose')
const json = process.argv.includes('--json')

const results = []
let TMP = null
// uphold / 本人待ちへの concede は本人の端末でしか通らない（ledger.mjs）。smoke は非対話なので外す。
// **外さない場合（本人の端末でない場合）に止まること**は、下で変数を消して別に確かめる。
process.env.CLAUDE_LEDGER_ALLOW_NON_TTY = '1'

// ── 出力ゼロで落ちないようにする ────────────────────────────────────────
// 2026-09-15、実機で **出力ゼロ・プロセスごと終了** が起きた。
// 結果は最後にまとめて出す作りなので、途中で落ちると**何も出ない**。
// どの検査で落ちたのかも分からず、赤 1 件より切り分けが難しい。
//
// 対策は 2 つ。どちらも「落ちたことが見える」ようにするためだけのもの。
//   1. 開始行を先に出す（0 バイトという状態を無くす）
//   2. 正常経路を通らずに終わったら、**直前に通過した印**を exit で出す
// `process.on('exit')` は同期処理しか走れないので、出すのは 1 行だけにする。
let lastMark = 'モジュールの読み込み'
let printed = false
function mark(label) { lastMark = label }
// v35：承認・settle の 1 呼び出しに入った断片を、本文の JSON から数える（件数・単位の数・受け先〈ファイルと節〉の数）
function groupsOfCall(c) {
  const m = String(c.body || '').match(/## 断片\n```json\n([\s\S]*?)```/)
  if (!m) return null
  let arr = null
  try { arr = JSON.parse(m[1]) } catch { return null }
  if (!Array.isArray(arr)) return null
  const unit = id => String(id).slice(0, String(id).lastIndexOf('#'))
  return { n: arr.length, units: new Set(arr.map(x => unit(x.entryId))).size,
    parts: new Set(arr.map(x => `${x.file || ''}|${x.section || ''}`)).size,
    files: new Set(arr.map(x => x.file || '')).size }
}

function ok(name, pass, detail = '') { results.push({ name, pass, detail }); lastMark = name }

process.on('exit', code => {
  if (printed) return
  // ここに来るのは「結果を出す前に終わった」ときだけ。
  console.log(`\n**smoke が結果を出す前に終了しました（exit ${code}）。**`)
  console.log(`  最後に通過したところ: ${lastMark}`)
  console.log(`  ここまでに済んだ検査: ${results.length} 件（うち赤 ${results.filter(r => !r.pass).length} 件）`)
  console.log('  **この状態では、以降の検査結果は存在しません。** 上の位置を報告してください。')
})
function sh(script, args, opts = {}) {
  return spawnSync(NODE, [join(HERE, script), ...args], {
    cwd: TMP, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' }, ...opts,
  })
}
function hook(event, input) {
  return spawnSync(NODE, [HOOK, event], {
    cwd: TMP, encoding: 'utf8', timeout: 60_000, input: JSON.stringify(input || {}),
    env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
  })
}
function git(...a) {
  return spawnSync('git', a, { cwd: TMP, encoding: 'utf8', timeout: 30_000 })
}
function jsonOf(r) { try { return JSON.parse(r.stdout) } catch { return null } }

// ════════════════════════════════════════════════════════════════════════
// 最小の偽プロジェクトを作る
// ════════════════════════════════════════════════════════════════════════
function setup() {
  TMP = mkdtempSync(join(tmpdir(), 'claude-smoke-'))
  const w = (p, body) => { mkdirSync(dirname(join(TMP, p)), { recursive: true }); writeFileSync(join(TMP, p), body) }

  w('.claude/project.json', JSON.stringify({
    project: { name: 'smoke' },
    commands: { typecheck: `"${NODE}" -e "process.exit(0)"` },
    verifyOnCodeChange: ['typecheck'], verifyOnDocChange: ['docs'],
    tiers: [
      { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
      { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
    ],
    edges: [{ kind: 'down', from: 'req', to: 'bd' }],
    paths: {
      coverageSummary: '', code: ['packages/**/*.ts'], stubTargets: ['packages/**/*.ts'],
      goalScope: ['packages/**', 'docs/**'], requirements: 'docs/req.md', crossReference: 'docs/bd.md',
    },
    gapLedger: { file: 'docs/bd.md', section: '9', prefix: 'G', resolvedMarker: '解消済み' },
    wpLedger: { file: '', section: '2', prefix: 'WP' },
    reviewBase: '', claimsRequired: true, ledgerRequired: 'phase', goalRequired: 'phase',
    guards: { implPhaseReadonly: ['**/*.test.ts', 'docs/**'], designPhaseReadonly: ['packages/**'] },
  }, null, 2))

  w('docs/req.md',
    '# 要件\n\n## 1 テンポ\n\n' +
    'テンポは 20 から 300 の範囲で指定できる。範囲外の値は拒否する。\n\n' +
    '## 2 ループ再生\n\n' +
    '小節範囲を指定してループ再生できる。終了小節の後は開始小節へ戻る。\n\n' +
    // 実機の要件定義書にあった形。区切りを含むので下限は 2 になるが、**要求は 0 件**。
    // 旧版はここに架空の要求 2 件を書かせ、それが「判定済」として台帳に載っていた。
    '## 3 改訂履歴\n\n' +
    '- **作成日**：2026-08-27（初版）／同日 改訂\n')
  w('docs/bd.md',
    '# 基本設計\n\n## 1 テンポ\n\n' +
    'setTempo は 20 以上 300 以下の整数のみを受け付け、範囲外は RangeError を投げる。\n\n' +
    '## 2 ループ再生\n\n' +
    'PlaybackService はループ終端で開始小節へ再シークする。\n\n' +
    '## 3 メトロノームとカウントインの表示設計\n\n' +
    'カウントインは 1 小節分を既定とする。\n\n' +
    '## 9 ギャップ\n\n' +
    '- G1 ループ再生の実機確認が未実施\n')
  w('packages/core/src/tempo.ts',
    'export class SetTempoCommand {\n  constructor(private bpm: number) {}\n' +
    '  run(): number {\n    if (this.bpm < 20 || this.bpm > 300) throw new RangeError("tempo")\n' +
    '    return this.bpm\n  }\n}\n')
  // 採番簿の実例と同じ形: 1 つのフォルダに UT と IT が同居し、ファイル名では分けられない
  // ID はテスト本体の中に書く（.claude/rules/tests.md の例と同じ形）。
  // 1 行テストの直後に次のテストの ID コメントを置くと、抽出が後ろの行も見るので取り違える。
  w('packages/core/src/win.test.ts',
    "it('WindowManager_単体_生成する', () => {\n  // UT-WIN-01 §1\n})\n\n" +
    "it('WindowManager_通し_開いて閉じる', () => {\n  // IT-WIN-01 §2\n})\n")
  w('packages/core/src/loop.ts',
    'export class SetLoopCommand {\n  constructor(private from: number) {}\n' +
    '  run(): number {\n    return this.from\n  }\n}\n')

  git('init', '-q')
  git('config', 'user.email', 'smoke@example.invalid')
  git('config', 'user.name', 'smoke')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

// ════════════════════════════════════════════════════════════════════════
// **最初に 1 行出す。** 0 バイトで落ちるという状態を作らない。
console.log(`smoke 開始（node ${process.version} / ${process.platform}）`)

try {
  mark('版の照合（check-version.mjs の起動）')
  // ── いちばん先に見るもの: 道具一式が揃っているか ─────────────────────
  // 2026-09-15、差分配布で **変更したファイルを 1 つ入れ忘れた**。
  // 新しい smoke が古い gate を検査して 2 件落ち、原因の切り分けに時間を使わせた。
  // 配布物には「入れたファイルのハッシュ」しか付いておらず、
  // **入れ忘れたファイルはそのリストにも載らない**ので照合できなかった。
  // ここが赤のときは、以降の結果はすべて「新しい検査 × 古い実装」なので信用できない。
  {
    const r = spawnSync(NODE, [join(HERE, 'check-version.mjs'), '--json'],
      { encoding: 'utf8', timeout: 60_000 })
    const v = (() => { try { return JSON.parse(r.stdout) } catch { return null } })()
    ok('版: .claude の道具が配布されたものと一致している', !!v && v.ok === true,
      !v ? `check-version.mjs が結果を返しませんでした\n    ${String(r.stderr || '').split('\n')[0]}`
         : [v.stale.length ? `内容が違う: ${v.stale.join(' ')}` : '',
            v.missing.length ? `存在しない: ${v.missing.join(' ')}` : '',
            '**当て漏れがあると、新しい検査が古い実装を検査して無関係な場所が赤くなります。**',
           ].filter(Boolean).join('\n    '))
  }

  // 機械が書くファイルを「旧版の残骸」と誤検知しないこと。
  // 当たっていない警告は、警告そのものを無視する癖をつける。
  //
  // **本物の .claude を丸ごとコピーして試さない。**（2026-09-15、実機で踏んだ）
  //   初版は cpSync(.claude, temp, { recursive: true }) で複製していた。
  //   実機のリポジトリは OneDrive 配下で、`.claude/coverage` には数 MB の jsonl があり、
  //   さらに機械が書きかけの state もある。再帰コピーは環境に強く依存する操作で、
  //   実機では **出力ゼロ・exit 127** でプロセスごと落ちた（JS の例外ではない）。
  //   検査したいのは「除外リストに載っているファイルを extra に数えないか」だけ。
  //   そのために本物を複製する必要は無い。**最小の偽 .claude を 3 ファイルで作る。**
  {
    const vd = mkdtempSync(join(tmpdir(), 'claude-ver-'))
    mkdirSync(join(vd, '.claude', 'scripts'), { recursive: true })
    const cv = readFileSync(join(HERE, 'check-version.mjs'), 'utf8')
    writeFileSync(join(vd, '.claude/scripts/check-version.mjs'), cv)
    const h = createHash('sha256').update(cv).digest('hex')
    writeFileSync(join(vd, '.claude/MANIFEST.sha256'), `${h}  scripts/check-version.mjs\n`)
    // 機械が書くファイル。マニフェストに無いが、残骸ではない。
    writeFileSync(join(vd, '.claude/baseline.json'), '{"checks":{}}')
    const r = spawnSync(NODE, [join(vd, '.claude/scripts/check-version.mjs'), '--json'],
      { encoding: 'utf8', timeout: 60_000 })
    const v = (() => { try { return JSON.parse(r.stdout) } catch { return null } })()
    rmSync(vd, { recursive: true, force: true })
    ok('版: 機械が書くファイルを残骸と誤検知しない',
      !!v && v.ok === true && !(v.extra || []).includes('baseline.json'),
      `extra: ${JSON.stringify(v?.extra || [])}（baseline.json は lib/baseline.mjs が書く記録）`)
  }

  mark('偽プロジェクトの作成（setup）')
  setup()

  // ── split は書くことを黙らない ─────────────────────────────────────
  // 実測（2026-09-23、turn 39）: `split.mjs bd` は数を見るだけのつもりで打たれ、
  // 分母のファイルを書き換えていた。出力のどこにも「書いた」と出ていなかった。
  {
    const uf = join(TMP, '.claude', 'coverage', 'units', 'req.jsonl')
    const before = existsSync(uf)
    const dry = sh('split.mjs', ['req', '--dry-run'])
    ok('split: --dry-run は分母のファイルを書かない',
      !before && !existsSync(uf) && dry.status === 0 && /--dry-run/.test(String(dry.stdout || '')),
      `**見るだけのつもりで分母を書き換える経路を、見るだけの経路と分ける。** ` +
      `前 ${before} / 後 ${existsSync(uf)} / exit ${dry.status}`)
    const wet = sh('split.mjs', ['req'])
    ok('split: 付けなければ書き、書いたファイルを出力に出す',
      existsSync(uf) && /書いたファイル: \.claude\/coverage\/units\/req\.jsonl/.test(String(wet.stdout || '')),
      `**逆対照。書く経路が書かなくなっていたら、drift の作り直しが効かない。** ` +
      String(wet.stdout || '').split('\n').slice(-2).join(' / '))
    try { rmSync(uf) } catch {}
  }

  // ── 静的: settings.json と hooks の整合 ─────────────────────────────
  {
    const sp = join(HERE, '..', 'settings.json')
    const cfg = JSON.parse(readFileSync(sp, 'utf8'))
    const hooks = cfg.hooks || {}
    ok('settings: 4 イベントが揃っている',
      ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'].every(k => hooks[k]?.length))
    const post = hooks.PostToolUse?.[0]?.matcher || ''
    ok('settings: PostToolUse が Read/Grep/Glob を含む',
      ['Read', 'Grep', 'Glob'].every(t => post.includes(t)),
      '抜けていると「読みました」「0 件でした」の裏取りが読み取り専用ターンで必ず誤検出になる')
    ok('settings: Stop に timeout が明示されている',
      Number(hooks.Stop?.[0]?.hooks?.[0]?.timeout) > 0,
      'タイムアウトすると hook は kill され、non-blocking 扱いでターンが通る（＝無検査で完了）')
    ok('settings: hook のスクリプトが実在する', existsSync(HOOK))
    // Remote Control を殺す環境変数が混ざっていないか。
    // v23 で実際に踏んだ: v22 の CLAUDE_CODE_DISABLE_TELEMETRY は**存在しない名前**で
    // 効いていなかった。それを正しい DISABLE_TELEMETRY に「直した」ところ初めて効き、
    // /remote-control が 'Remote Control initialization failed' で失敗した。
    // 公式: この 4 つはいずれも Remote Control が依存するフィーチャーフラグ評価を止める。
    const KILLS_REMOTE = ['DISABLE_TELEMETRY', 'DO_NOT_TRACK',
                          'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_GROWTHBOOK']
    const bad = KILLS_REMOTE.filter(k => cfg.env && k in cfg.env)
    ok('settings: Remote Control を止める env が無い', bad.length === 0,
      bad.length ? `env に ${bad.join(' / ')} が入っている。/remote-control が初期化に失敗する`
                 : 'DISABLE_TELEMETRY / DO_NOT_TRACK / CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC / DISABLE_GROWTHBOOK')

    // 綴りの列挙に戻っていないか。戻すと「書き方で扱いが変わる」状態が再発する。
    const enumerated = [...(cfg.permissions?.deny || []), ...(cfg.permissions?.ask || [])]
      .filter(x => /Bash\((rm -rf|format |Format-Volume|reg delete|shutdown|dd |shred)/.test(x))
    ok('settings: 破壊的コマンドを綴りで列挙していない', enumerated.length === 0,
      enumerated.length ? `列挙が復活: ${enumerated.join(' / ')}\n    判定は gate.mjs のパス解決で行う（rationale.md 参照）` : '')

    const deny = JSON.stringify(cfg.permissions?.deny || [])
    ok('settings: state / coverage が deny されている',
      deny.includes('.claude/state/**') && deny.includes('.claude/coverage/**'),
      'ここが空いていると、ゲートが読む場所を検査される側が書ける')
  }

  // ── 設定と実ファイルのズレ ──────────────────────────────────────────
  // 実機で 2 種類のズレが見つかった。どちらも「それらしい数字が出る」ので気付けない。
  {
    ok('config: 噛み合っている設定は緑', sh('check-config.mjs', ['--json']).status === 0)

    const cfgPath = join(TMP, '.claude/project.json')
    const orig = readFileSync(cfgPath, 'utf8')
    const c = JSON.parse(orig)

    // (a) ソースが 1 ファイルにも当たらない段 → 警告（赤にはしない）
    const c1 = JSON.parse(orig)
    c1.tiers.push({ id: 'accept', name: '受入', sources: ['docs/test/acceptance/*.md'], extractor: 'markdown' })
    c1.edges.push({ kind: 'across', from: 'req', to: 'accept' })
    writeFileSync(cfgPath, JSON.stringify(c1, null, 2))
    const r1 = jsonOf(sh('check-config.mjs', ['--json']))
    ok('config: 0 ファイルの段を警告する', !!r1 && r1.warns >= 1 && r1.ok === true,
      'その段は永久に 0 件で「未判定 0」になる。ただし「まだ書いていない」は正常な途中経過でもある')

    // (b) 2 つの段が同じファイルを数える → 赤
    // 実機で起きた型: 広い glob の段が、狭い glob の段のファイルを吸ってしまう
    // （ut = packages/**/*.test.ts が it = packages/**/*.integration.test.ts を飲む）。
    const c2 = JSON.parse(orig)
    c2.tiers.push({ id: 'wide', name: '広すぎる段', sources: ['docs/*.md'], extractor: 'markdown' })
    c2.edges.push({ kind: 'across', from: 'bd', to: 'wide' })
    writeFileSync(cfgPath, JSON.stringify(c2, null, 2))
    const r2 = jsonOf(sh('check-config.mjs', ['--json']))
    ok('config: 段どうしの重なりを赤にする', !!r2 && r2.ok === false && r2.errors >= 1,
      '両方の段が違うものを数えたまま、それらしい件数を出す')

    // (a-2) 同じ id の段が 2 つ — **後から書いたほうは一度も使われない**
    // 「既存の段に設定を足す」つもりの編集が「段をもう 1 セット足す」になっていた実例。
    // 重なり検査は「同じファイルを数えています」としか言わず、**原因を言わなかった**。
    const cDup = JSON.parse(orig)
    cDup.tiers.push({ id: 'req', name: '要件定義', sources: ['docs/req.md'],
                      extractor: 'markdown', skipSections: ['テンポ'] })
    writeFileSync(cfgPath, JSON.stringify(cDup, null, 2))
    const rDup = jsonOf(sh('check-config.mjs', ['--json']))
    const dupTxt = sh('check-config.mjs', []).stdout || ''
    ok('config: 同じ id の段が 2 つあることを赤にする',
      !!rDup && rDup.ok === false && /同じ id の段/.test(dupTxt),
      `**症状（同じファイルを数えている）ではなく原因（id が重複）を言うこと。**\n` +
      `    後から書いた段の設定は一度も効かないのに、エラーも出ない`)
    writeFileSync(cfgPath, orig)

    // (b-2) パスで分けられない段を idPrefix で分ける
    const c4 = JSON.parse(orig)
    c4.tiers.push({ id: 'ut', name: '単体', sources: ['packages/**/*.test.ts'], extractor: 'ts-test', idPrefix: 'UT-' })
    c4.tiers.push({ id: 'it', name: '結合', sources: ['packages/**/*.test.ts'], extractor: 'ts-test', idPrefix: 'IT-' })
    c4.edges.push({ kind: 'across', from: 'bd', to: 'ut' }, { kind: 'across', from: 'bd', to: 'it' })
    writeFileSync(cfgPath, JSON.stringify(c4, null, 2))
    const r4 = jsonOf(sh('check-config.mjs', ['--json']))
    ok('config: idPrefix で分けた段は重なりとしない', !!r4 && r4.ok === true,
      '同じファイルを見ていても、ID で別のものを数えているなら重なりではない')
    sh('split.mjs', ['ut']); sh('split.mjs', ['it'])
    const utN = jsonOf(sh('split.mjs', ['ut', '--json']))?.units
    const itN = jsonOf(sh('split.mjs', ['it', '--json']))?.units
    ok('idPrefix: 同じファイルから UT と IT を別々に数える', utN === 1 && itN === 1,
      `ut ${utN} 件 / it ${itN} 件（どちらも 1 件が正。パスでは分けられない形）`)

    // (b-3) ID がテストごとに書かれていないとき ─────────────────────────
    // 採番簿に沿った書き方は 2 通りある（テストごと / ファイル冒頭に 1 行）。
    // 冒頭だけの形を拾えなかった版は、実機で 33 ファイル・239 テストを
    // **どの段にも入れないまま黙って捨てていた**。check-tests.mjs は
    // 「ファイルに ID が 1 つ以上」しか見ないので 0 件で通り、両方緑だった。
    const wf = (rel, body) => writeFileSync(join(TMP, rel), body)
    const rmf = rel => { try { rmSync(join(TMP, rel)) } catch {} }

    wf('packages/core/src/hist.test.ts',
      '// UT-EDIT-HIST: CommandHistory（元に戻す／やり直し）\n' +
      '// 検証節: docs/bd.md §1\n\n' +
      "it('CommandHistory_undo_直前の操作を戻す', () => {\n})\n\n" +
      "it('CommandHistory_redo_戻した操作を進める', () => {\n})\n")
    const utN2 = jsonOf(sh('split.mjs', ['ut', '--json']))?.units
    const itN2 = jsonOf(sh('split.mjs', ['it', '--json']))?.units
    ok('idPrefix: ファイル冒頭にしか ID が無いテストも分母に入る', utN2 === 3 && itN2 === 1,
      `ut ${utN2} 件（1 + 冒頭 ID のファイルの 2 件が正）/ it ${itN2} 件\n` +
      '    ここが 1 のままなら、ID をファイル冒頭に書いたテストが丸ごと分母の外にいる')
    const orphA = jsonOf(sh('split.mjs', ['orphan-tests', '--json']))
    ok('orphan: ID が在るテストは全件どこかの段に属する', !!orphA && orphA.orphans === 0,
      `どの段にも入らなかったテスト ${orphA?.orphans} 件`)
    ok('config: 全件が段に属していれば緑のまま', jsonOf(sh('check-config.mjs', ['--json']))?.ok === true)

    // 冒頭の 1 行を消すと、同じ 2 件が行き場を失う。**それが赤で出ること**が本題。
    wf('packages/core/src/hist.test.ts',
      "it('CommandHistory_undo_直前の操作を戻す', () => {\n})\n\n" +
      "it('CommandHistory_redo_戻した操作を進める', () => {\n})\n")
    const orphB = jsonOf(sh('split.mjs', ['orphan-tests', '--json']))
    ok('orphan: ID の無いテストを「どの段にも入っていない」と数える',
      !!orphB && orphB.orphans === 2 && orphB.orphanFiles.some(f => f.file.endsWith('hist.test.ts')),
      `${orphB?.orphans} 件（2 件が正）。0 なら、消えたことが誰にも見えない状態に戻っている`)
    ok('orphan: 分母に穴があるとき終了コードが 0 でない',
      sh('split.mjs', ['orphan-tests']).status !== 0)
    const rOrph = jsonOf(sh('check-config.mjs', ['--json']))
    ok('config: 分母から落ちたテストを赤にする', !!rOrph && rOrph.ok === false && rOrph.errors >= 1,
      '警告ではなく赤。落ちた分は「未判定 0」に一切現れないので、警告では見落とす')
    ok('split --all: 落ちたテストを一覧の直後に出す',
      /どの段にも入っていません/.test(sh('split.mjs', ['--all']).stdout || ''),
      '毎回見る表の隣に出ないと、専用コマンドを叩いた人しか気付けない')

    // 冒頭に族が 2 つあるファイルは、どちらのものか決められない。
    // **推測して片方へ寄せない。** 寄せると、寄せた先の件数が静かに増える。
    wf('packages/core/src/hist.test.ts',
      '// UT-EDIT-HIST: CommandHistory\n// IT-EDIT-HIST: 通し\n\n' +
      "it('CommandHistory_undo_直前の操作を戻す', () => {\n})\n")
    const orphC = jsonOf(sh('split.mjs', ['orphan-tests', '--json']))
    ok('orphan: 冒頭の族が 2 つあるファイルは推測せず穴として出す',
      !!orphC && orphC.orphans === 1,
      `${orphC?.orphans} 件（1 件が正）。片方へ寄せると、寄せた段の件数だけが静かに増える`)
    rmf('packages/core/src/hist.test.ts')

    // (c) 実在しない参照先 → 赤
    const c3 = JSON.parse(orig)
    c3.gapLedger = { ...(c3.gapLedger || {}), file: 'docs/does-not-exist.md' }
    writeFileSync(cfgPath, JSON.stringify(c3, null, 2))
    ok('config: 実在しない参照先を赤にする', sh('check-config.mjs', ['--json']).status !== 0,
      '参照先が無い設定は、検査が黙って空振りする')

    // (d) 設定から外した段の記録が残っている → 警告
    // 実機で accept / system を tiers から外したあと、units/accept.jsonl が残っていた。
    // 判定は狂わないが、「その段はまだ数えている」ように見える。
    writeFileSync(cfgPath, orig)
    mkdirSync(join(TMP, '.claude/coverage/units'), { recursive: true })
    writeFileSync(join(TMP, '.claude/coverage/units/ghost.jsonl'), '')
    const rGhost = jsonOf(sh('check-config.mjs', ['--json']))
    ok('config: 設定から消した段の記録が残っていると警告する',
      !!rGhost && rGhost.warns >= 1 && rGhost.ok === true,
      '消したものが消えたことを機械が見る。赤にはしない（読まれないので判定は狂わない）')
    rmSync(join(TMP, '.claude/coverage/units/ghost.jsonl'), { force: true })

    writeFileSync(cfgPath, orig)
  }

  // ── 入れ替えの残骸 ──────────────────────────────────────────────────
  // `.claude` を上書きコピーで入れ替えると、新版に無いファイルは残る。
  // 残っていても動かないが、「v22 の検査が今も効いている」という誤解の元になる。
  {
    mkdirSync(join(TMP, '.claude/scripts'), { recursive: true })
    writeFileSync(join(TMP, '.claude/scripts/selftest.mjs'), '// v22 の残骸\n')
    const r = sh('check-legacy.mjs', ['--json'])
    const j = jsonOf(r)
    const hit = JSON.stringify(j || {}).includes('selftest.mjs')
    rmSync(join(TMP, '.claude/scripts/selftest.mjs'), { force: true })
    ok('check-legacy: v22 の残骸（selftest.mjs）を検出する', hit,
      '上書きコピーで入れ替えたときに残る。実機で実際に残っていた')
  }

  // ── 分母を作る ──────────────────────────────────────────────────────
  ok('split: 全段を切り出せる', sh('split.mjs', ['--all']).status === 0)
  ok('ledger: sync できる', sh('ledger.mjs', ['sync', 'req->bd']).status === 0)

  const pend = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
  ok('ledger: 分母に単位が在る', !!pend && pend.units > 0, pend ? `単位 ${pend.units}` : '取得失敗')
  const unitId = pend?.undecomposedIds?.[0]
  ok('ledger: 未分解の単位を取れる', !!unitId)

  // 分解に渡す `from` は原文の逐語でなければならないので、原文を取ってから組み立てる。
  const unitShow = unitId ? jsonOf(sh('ledger.mjs', ['show', 'req->bd', unitId])) : null
  const SRC = String(unitShow?.text || '')
  // **next の payload を見る。** show には元から章が入っているので、show で検査すると
  // next から章を外しても緑のまま通る（逆対照で判明）。AI が受け取るのは next のほう。
  const nx = jsonOf(sh('ledger.mjs', ['next', 'req->bd', '1']))
  ok('ledger: 分解フェーズの AI に章が渡る', !!nx?.units?.[0]?.section,
    '章が見えないと「変更履歴の行だから要求ではない」を判断できない（実機で要求の 30% がこの型）')
  const dec = (...entries) => sh('ledger.mjs', ['decompose', 'req->bd', unitId, JSON.stringify(entries)])

  if (unitId && SRC) {
    // 原文から重ならない 2 つの断片を取る（前半・後半）。
    const half = Math.floor(SRC.length / 2)
    const A = SRC.slice(0, half).trim(), B = SRC.slice(half).trim()

    // 逆対照で分かったこと: 下の各検査は、**他の検査が先に弾くせいで緑に見える**。
    // 1 つずつ「その検査だけが理由で落ちる」形に整え、メッセージまで照合する。
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')

    // ── 塞いだ穴: 文字列の配列（出どころ無し）──────────────────────────
    // 旧形式は「件数・重複・語の共有」しか見ておらず、実機の要件定義書で
    // **正直な分解が 5/5 弾かれ、数合わせが 5/5 通った**。出どころを必須にする。
    const oldForm = sh('ledger.mjs', ['decompose', 'req->bd', unitId,
      JSON.stringify([`${A} を満たすこと`, `${B} を満たすこと`])])
    ok('ledger: 出どころの無い分解（旧形式）を拒否する',
      oldForm.status !== 0 && /書式が変わりました/.test(errOf(oldForm)),
      '文字列だけの分解は、原文のどこから来たのか誰も見ていない')

    // ── 塞いだ穴: 言い換えを並べて件数を埋める ────────────────────────
    // **取り残しでは落ちない形にする**（B は skip で覆う）。落ちる理由を取り合いだけにする。
    const overlap = dec({ text: `${A} を満たすこと`, from: A },
                        { text: `${A} が成立すること`, from: A },
                        { skip: B, why: `${B.slice(0, 10)} は後半の記述であり今回の対象ではない` })
    ok('ledger: 原文の同じ部分を 2 件が取り合ったら拒否する',
      overlap.status !== 0 && /取り合って/.test(errOf(overlap)),
      '**これが水増しの本体。** 同じ内容を言い換えて件数を埋める道を塞ぐ')

    // ── 塞いだ穴: 原文に無い出どころ ──────────────────────────────────
    // 要求の文とは語を共有させ、覆いも満たす。落ちる理由を「原文に無い」だけにする。
    const ghost = dec({ text: `${A} を満たすこと`, from: `${A}該当なし` },
                      { skip: SRC, why: `${A.slice(0, 10)} を含む行の残りは対象外とする` })
    ok('ledger: 原文に無い出どころを拒否する',
      ghost.status !== 0 && /原文に無い/.test(errOf(ghost)),
      '出どころは原文からそのまま切り出したものでなければならない')

    // ── 塞いだ穴: 要求の文と出どころのすり替え ────────────────────────
    const swap = dec({ text: 'ネットワーク越しに同期できること', from: A },
                     { skip: B, why: `${B.slice(0, 10)} は後半の記述であり今回の対象ではない` })
    ok('ledger: 要求の文と出どころが無関係なら拒否する',
      swap.status !== 0 && /1 語も共有していません/.test(errOf(swap)),
      '出どころだけ原文から借りて、中身は別物、を通さない')

    // ── 塞いだ穴: 複合語の部分一致（カタカナ）──────────────────────────
    // 実地の分解で出た偽陽性: 要求「ピンチハーモニクスに対応すること」／
    // 出どころ「・ピンチ）」が「1 語も共有していない」で弾かれた。
    // 漢字の複合語（再生位置 ⊃ 再生）は部分一致を許していたのに、カタカナだけ外れていた。
    // **正直に書いたものが弾かれるのは、水増しを通すのと同じくらい悪い。**
    ok('smoke: カタカナ複合語の検査に使える原文が在る', /テンポ/.test(A),
      `原文の前半にカタカナ語が要る: ${JSON.stringify(A)}`)
    const kana = dec({ text: 'テンポパレットを用意すること', from: A },
                     { skip: B, why: `${B.slice(0, 10)} は後半の記述であり今回の対象ではない` })
    ok('ledger: カタカナの複合語を部分一致で結びつける', kana.status === 0,
      `「テンポパレット」は「テンポ」を含む。漢字だけ部分一致を許すのは筋が通らない\n    ${String(kana.stderr || '').split('\n')[0]}`)


    const skipped = dec({ text: `${A} を満たすこと`, from: A })
    ok('ledger: どこにも割り当てていない部分があれば拒否する',
      skipped.status !== 0 && /割り当てられていない/.test(errOf(skipped)),
      '**飛ばした部分が見えるのはここだけ。** 件数の検査では絶対に見えない')

    // ── 塞いだ穴: 同じ文を並べて件数を埋める（v22 由来）────────────────
    // 出どころを別々にしても、要求の文が同じなら分母を固定したことにはならない。
    const dupd = dec({ text: `${A} を満たすこと`, from: A }, { text: `${A} を満たすこと`, from: B })
    ok('ledger: 同じ要求の文を 2 件並べたら拒否する',
      dupd.status !== 0 && /重複/.test(errOf(dupd)),
      'v22 は ["x","x","x","x"] が下限 4 件を満たして通った')

    ok('ledger: 短すぎる要求を拒否する',
      dec({ text: 'テンポ', from: A }, { text: '範囲外', from: B }).status !== 0,
      '判定できない粒度の断片を並べても、分母を固定したことにはならない')

    // ── 通るべき: 原文を覆う正直な分解 ────────────────────────────────
    ok('ledger: 原文を覆う正直な分解は通る',
      dec({ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }).status === 0)

    // ── 通るべき: 何も要求していない行 ────────────────────────────────
    // 実機の要件定義書には日付やステータスの行があり、**要求は 0 件**。
    // 旧版はそれでも件数の下限を満たせと言うので、架空の要求を書かされ、
    // それが「判定済」として台帳に載っていた。0 件と言える口を開ける。
    // **ただし逃げ道なので、使ったら必ず数に出す。**
    // **下限 2 以上の単位を選ぶ。** 下限 1 の単位で試すと、1 個の skip が下限を満たして
    // しまい、「行全体の skip は下限を免除する」という肝心の仕掛けを通らない（逆対照で判明）。
    let show2 = null
    for (const cand of (pend?.undecomposedIds || []).slice(0, 8)) {
      if (cand === unitId) continue
      const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
      if (v?.text && v.minReq >= 2) { show2 = v; break }
    }
    ok('smoke: 下限 2 以上の単位がフィクスチャに在る', !!show2,
      '**無いとこの節が黙って走らない。** docs/req.md に区切りを含む行を置いてある')
    const unit2 = show2?.unitId
    if (show2?.text) {
      const r0 = sh('ledger.mjs', ['decompose', 'req->bd', unit2,
        JSON.stringify([{ skip: show2.text, why: `${String(show2.text).slice(0, 12)} は記録であって要求ではない` }])])
      ok('ledger: 行全体を skip すれば「要求ゼロ」として通る', r0.status === 0,
        '架空の要求を書かせない。0 件は正当な答え')
      const p2 = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      ok('ledger: 「要求ゼロ」の単位数が表に出る', (p2?.unitsNoRequirement || 0) >= 1,
        '数えないと、全単位を要求ゼロにした台帳が「完了」と表示される')
    }

    const reqId = `${unitId}#0`
    const Q = 'setTempo は 20 以上 300 以下の整数のみを受け付け'
    // ── 塞いだ穴: method だけ / 短い引用 / 上位文書の引用 ──────────────
    ok('ledger: 「一致」を method だけで記録させない',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致', '{"method":"grep した"}']).status !== 0,
      'v22 はこれで 25 要求すべてを「完了」にできた')
    // 引用は **行が合っている状態で** 短さだけを問う（行がずれていると別の検査で落ち、
    // 長さの検査を通っていなくても緑になってしまう）。docs/bd.md の 5 行目に実在する語を使う。
    ok('ledger: 短すぎる引用を拒否する',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致',
        '{"file":"docs/bd.md","line":5,"quote":"RangeError"}']).status !== 0,
      '短い語はどの文書にも在るので、照合しても何も確かめたことにならない')
    ok('ledger: 行番号がずれた引用を拒否する',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致',
        `{"file":"docs/bd.md","line":99,"quote":${JSON.stringify(Q)}}`]).status !== 0)
    ok('ledger: 見出しだけの引用を拒否する',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致',
        '{"file":"docs/bd.md","line":9,"quote":"## 3 メトロノームとカウントインの表示設計"}']).status !== 0,
      '節が在ることは、要求が降りていることの証拠ではない')
    ok('ledger: 下位以外のファイルからの引用を拒否する',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致',
        `{"file":"docs/req.md","line":5,"quote":"テンポは 20 から 300 の範囲で指定できる"}`]).status !== 0,
      '上位文書自身を引用して「降りている」とは言えない')
    ok('ledger: 正当な判定は通る',
      sh('ledger.mjs', ['judge', 'req->bd', reqId, '一致',
        `{"file":"docs/bd.md","line":5,"quote":${JSON.stringify(Q)}}`]).status === 0)
    ok('ledger: 「対象外」の薄い理由を拒否する',
      sh('ledger.mjs', ['judge', 'req->bd', `${unitId}#1`, '対象外', '{"reason":"テンポ"}']).status !== 0,
      'v22 は {"reason":"."} が通っていた')
  }

  // ── 単位の同一性（行がずれても引き継ぐ／本文が変わったら再判定）─────────
  // v22 は id が `file:line:hash6` だったので、上位に空行を 1 つ足すだけで
  // 以降の全単位の id が変わり、判定が丸ごと消えた。設計フェーズは文書に行を
  // 挿入し続ける作業なので、これは日常的に起きていた。
  {
    const before = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
    const judgedBefore = (before?.units || 0) - (before?.undecomposed || 0)

    // (a) 先頭に空行を 1 つ挿入する ＝ 全部の行番号がずれる
    const req = join(TMP, 'docs/req.md')
    writeFileSync(req, '\n' + readFileSync(req, 'utf8'))
    sh('split.mjs', ['--all'])
    sh('ledger.mjs', ['sync', 'req->bd'])
    const after = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
    ok('id: 行がずれただけでは判定を失わない',
      !!after && after.units === before?.units && (after.units - after.undecomposed) === judgedBefore,
      before ? `分解済み ${judgedBefore} → ${after ? after.units - after.undecomposed : '?'}（単位 ${before.units} → ${after?.units}）` : '')

    // (a-2) **同じ id が、行がずれた後も引ける。**
    // 台帳の id は報告やギャップに書かれて後から参照される。行番号が混ざっていると、
    // 文書を 1 行編集しただけで過去の報告の id がどこも指さなくなる。
    ok('id: 行がずれても同じ id で引ける',
      !!unitId && sh('ledger.mjs', ['show', 'req->bd', unitId]).status === 0,
      `分解に使った ${unitId} が、空行挿入後もそのまま解決すること`)

    // (b) drift の「変化」列が動くか（v22 は常に 0 だった）
    writeFileSync(req, readFileSync(req, 'utf8').replace('範囲外の値は拒否する', '範囲外の値は 20 か 300 に丸める'))
    const d = jsonOf(sh('split.mjs', ['drift', '--json']))
    const row = (d?.rows || []).find(r => r.tier === 'req')
    ok('drift: 本文の変更を「変化」として数える', !!row && row.changed >= 1,
      row ? `新規 ${row.added} / 変化 ${row.changed} / 消失 ${row.removed}` : '取得失敗')

    // (c) 本文が変わった単位だけが再判定に落ち、stale として見える
    sh('split.mjs', ['--all'])
    sh('ledger.mjs', ['sync', 'req->bd'])
    const st = jsonOf(sh('ledger.mjs', ['stale', 'req->bd', '--json']))
    ok('stale: 本文が変わった単位を返す', Array.isArray(st) && st.length >= 1,
      'v22 は本文が変わると id も変わるため、この分岐に一度も到達できなかった')
    ok('stale: 変更前の本文を保持している',
      Array.isArray(st) && st.some(r => String(r.staleText || '').includes('拒否する')),
      '何がどう変わったのかを後から追えるようにする')
  }

  // ── v22 の台帳からの移行 ─────────────────────────────────────────────
  // 既存の判定は id の形式が変わっても失われてはいけない。旧 id（file:line:hash6）を
  // file:hash6 で寄せて拾い直す経路が生きているかを見る。
  {
    const edgeFile = join(TMP, '.claude/coverage/edges/req-bd.jsonl')
    const rows = readFileSync(edgeFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const judged = rows.find(r => Array.isArray(r.reqs) && r.reqs.some(q => q.verdict))
    if (judged) {
      // 旧形式へ巻き戻す（anchor を落とし、id を行番号込みにする）
      const legacy = rows.map(r => {
        const c = { ...r, unitId: `${r.file}:${r.line}:${String(r.hash).slice(0, 6)}` }
        delete c.anchor
        return c
      })
      writeFileSync(edgeFile, legacy.map(r => JSON.stringify(r)).join('\n') + '\n')
      sh('ledger.mjs', ['sync', 'req->bd'])
      const after = readFileSync(edgeFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      const stillJudged = after.filter(r => Array.isArray(r.reqs) && r.reqs.some(q => q.verdict)).length
      ok('移行: v22 形式の台帳から判定を引き継ぐ', stillJudged >= 1,
        `判定済みの単位 ${stillJudged} 件（0 なら、入れ替えた瞬間に過去の判定が全部消える）`)
      ok('移行: 新形式の id と anchor が付く',
        after.every(r => !/:\d+:[0-9a-f]{6}$/.test(r.unitId)) && after.every(r => !!r.anchor))
    } else ok('移行: 判定済みの単位を用意できた', false, 'この時点で判定済みが 1 件も無い')
  }


  mark('承認（分解が「そもそも要求か」を別の目に通す）')
  // ── 承認（③）────────────────────────────────────────────────────────────
  // 形の検査（from が逐語か・区間が重なっていないか・取り残しが無いか）は
  // **嘘の紐付け**を全部捕まえるが、「紐付けは正しいが、そもそも要求ではない」は
  // 原理的に見えない。`（PC版）` → 「（PC版）を対象とした利用シーンである」は形として満点。
  // ここでは、その別の目が **ちゃんと仕事を課されているか** を見る。
  {
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const ef = join(TMP, '.claude/coverage/edges/req-bd.jsonl')
    const rows0 = readFileSync(ef, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    // 下位（docs/bd.md）と語を共有する単位を選ぶ。**覗きの検査にそれが要る。**
    const target = rows0.find(r => /テンポ/.test(String(r.text)) && String(r.text).length >= 24)
    ok('smoke: 承認の検査に使える単位が在る', !!target,
      '**無いとこの節が黙って走らない。** docs/req.md のテンポの行を使う')
    if (target) {
      const U = target.unitId, S = String(target.text)
      const half = Math.floor(S.length / 2)
      const A = S.slice(0, half).trim(), B = S.slice(half).trim()
      const errOf = r => String(r.stderr || '') + String(r.stdout || '')
      const decT = (...e) => sh('ledger.mjs', ['decompose', 'req->bd', U, JSON.stringify(e)])
      const dec2 = decT
      const apr = (id, v, body) => sh('ledger.mjs', ['approve', 'req->bd', id, v, JSON.stringify(body)])
      const reb = (id, body) => sh('ledger.mjs', ['rebut', 'req->bd', id, JSON.stringify(body)])
      const WHY = `原文「${S.slice(0, 16)}」のこの部分についての判断`
      const EXPECT = `${A} を下位の設計で定める`

      const base = decT({ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B })
      ok('承認: 土台になる分解が通る', base.status === 0, errOf(base).slice(0, 200))

      const an = jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all']))
      const mine = (an?.entries || []).filter(x => String(x.entryId).startsWith(U + '#'))
      ok('承認: 未承認の断片が一覧に出る', mine.length === 2,
        `この単位の断片 ${mine.length} 件（分解した 2 件が出るはず）`)
      ok('承認: 一覧に原文・断片・分解した側の扱いが揃っている',
        !!mine[0]?.source && !!mine[0]?.span && !!mine[0]?.wrote?.as,
        '原文が無いと「この断片だけで判断せよ」が成立しない')
      // **下位を開けと書いていないこと。** judge の payload をそのまま渡すと、
      // 承認する側に下位を開く経路をこちらから教えることになる。
      ok('承認: 一覧が下位を開くように指示していない',
        !/下位を実際に開/.test(JSON.stringify(an || {})) && /下位の文書は開かない/.test(String(an?.note || '')),
        '下位を見ると「下位に書いてあるから要求だ」になり、**漏れが漏れでなくなる**')

      // ── 塞いだ穴: 感想で通す ────────────────────────────────────────
      // 「要求」と答えるには、**下位に現れるはずの一文**を書かせる。
      // 「（PC版）を対象とした利用シーンである」を満たす設計書の一文は書けない。
      const noExpect = apr(`${U}#0`, '要求', { why: WHY })
      // **メッセージまで照合する。** ただ `/expect/` で見ると、expect を空のまま通しても
      // 次の「1 語も共有していません」が代わりに落としてくれるので**緑のまま通る**
      // （逆対照で判明）。落ちた理由がこの検査であることまで確かめる。
      ok('承認: expect の無い「要求」を拒否する',
        noExpect.status !== 0 && /と答えるときは expect/.test(errOf(noExpect)),
        '**ここが承認の本体。** 作文を課さないと「なんとなく良さそう」で通る')
      const farExpect = apr(`${U}#0`, '要求', { why: WHY, expect: 'ネットワーク越しに同期する機能を用意する' })
      ok('承認: 断片と無関係な expect を拒否する',
        farExpect.status !== 0 && /1 語も共有していません/.test(errOf(farExpect)),
        '別の断片の話を書いて作文したことにする道を塞ぐ')
      const thinWhy = apr(`${U}#0`, '要求', { why: '要求である', expect: EXPECT })
      ok('承認: どの断片にも貼れる理由を拒否する',
        thinWhy.status !== 0 && /承認の理由が不十分/.test(errOf(thinWhy)),
        '「対象外」の理由に掛けているのと同じ検査。片方だけ緩いと、緩いほうへ流れる')
      const noKind = apr(`${U}#1`, '要求でない', { why: WHY })
      ok('承認: kind の無い「要求でない」を拒否する',
        noKind.status !== 0 && /kind が必須/.test(errOf(noKind)),
        '7 種のどれでもないなら、要求である可能性を疑わせる')
      const noResolve = apr(`${U}#1`, '判断できない', { why: WHY })
      ok('承認: resolvesBy の無い「判断できない」を拒否する',
        noResolve.status !== 0 && /resolvesBy/.test(errOf(noResolve)),
        '決着のしかたを書けない保留は、ただの棄権')

      // ── 通るべき: 分解した側と一致 ──────────────────────────────────
      const good = apr(`${U}#0`, '要求', { why: WHY, expect: EXPECT })
      ok('承認: 一致した判定は「承認」になる', good.status === 0 && /承認/.test(errOf(good)),
        errOf(good).slice(0, 200))
      const an2 = jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all']))
      ok('承認: 承認済みの断片は一覧から消える',
        !(an2?.entries || []).some(x => x.entryId === `${U}#0`),
        '消えないと、同じ断片を何度も承認し直すことになる')

      // ── 食い違い ────────────────────────────────────────────────────
      const before = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      const ch = apr(`${U}#1`, '要求でない', { why: WHY, kind: 'ラベル・項目名' })
      ok('承認: 食い違いは「指摘」になる', ch.status === 0 && /指摘/.test(errOf(ch)), errOf(ch).slice(0, 200))
      const after = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      // **ここが一番大事な検査。** 承認する側が誤って「要求でない」と言ったとき
      // 黙って消すと、網羅台帳が存在する理由そのもの——落ちが無いこと——が壊れる。
      ok('承認: 指摘を受けても要求は台帳から消えない',
        !!after && after.requirements === before?.requirements,
        `要求 ${before?.requirements} → ${after?.requirements}。**減っていたら、承認が漏れを作る側に回っている**`)
      ok('承認: 指摘が未解決として数えられる', (after?.approval?.challenged || 0) >= 1,
        `指摘 ${after?.approval?.challenged ?? '?'} 件`)

      // ── 同意（concede）────────────────────────────────────────────
      // **同意するのを一番安くしておく。** 手で分解を書き直すと、
      // 指摘を受けていない断片を 1 文字変えただけでその承認まで消える。
      // 直すのが高いと、承認を通す最短経路が「反論して押し切る」になる。
      const conc = sh('ledger.mjs', ['concede', 'req->bd', `${U}#1`])
      ok('承認: 指摘に同意して対象外へ移せる', conc.status === 0, errOf(conc).split('\n')[0])
      const showC = jsonOf(sh('ledger.mjs', ['show', 'req->bd', U]))
      const movedC = (showC?.entries || []).find(x => x.span === B)
      ok('承認: 同意した断片は承認を引き継ぐ（承認し直させない）',
        movedC?.as === '対象外' && movedC?.approval === '承認',
        `${movedC?.as} / ${movedC?.approval}。**引き継がないと、直すのが一番高くつく**`)
      ok('承認: 同意した件数が別に数えられる',
        (jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))?.conceded || 0) >= 1,
        '指摘を丸呑みしているだけになっていないかを、後から見るための数字')
      // **同意の出力に、起きていないことを書かせない。**
      // 「本人待ちは終わりです」「反論の記録は…」は、実際にそうだったときだけ出ること。
      ok('承認: 何も無い同意に、本人待ち・反論の断り書きを出さない',
        !/本人待ち/.test(conc.stdout || '') && !/反論の記録/.test(conc.stdout || ''),
        '**出力が状態を説明していないなら、読んだ人は台帳を読み違える。** ' +
        String(conc.stdout || '').replace(/\n/g, ' / ').slice(0, 160))
      const concAgain = sh('ledger.mjs', ['concede', 'req->bd', `${U}#0`])
      ok('承認: 承認された断片には同意させない',
        concAgain.status !== 0 && /「承認」です/.test(errOf(concAgain))
          && /同意できるのは/.test(errOf(concAgain)),
        '承認済みのものを黙って対象外に落とせると、分母を自分で削れる')
      // 元に戻して反論の検査へ（同じ断片をもう一度「指摘」にする）
      dec2({ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B })
      apr(`${U}#1`, '要求でない', { why: WHY, kind: 'ラベル・項目名' })

      // ── 反論 ────────────────────────────────────────────────────────
      // **理由はその断片（B）に触れていること。** 単位の原文に触れているだけだと、
      // 同じ単位のどの断片にも貼れる（2026-09-17 に足した検査）。
      const rNoExp = reb(`${U}#1`, { why: `${B} は独立した要求であり下位に無ければ不備になる` })
      ok('承認: expect の無い反論を拒否する',
        rNoExp.status !== 0 && /要求として維持するなら expect/.test(errOf(rNoExp)),
        '**反論を無料にしない。** 承認する側に課したのと同じ作文を、維持する側にも課す')
      const rThin = reb(`${U}#1`, { why: `${B} だから`, expect: `${B} を下位の設計で定める` })
      ok('承認: 中身の無い反論を拒否する',
        rThin.status !== 0 && /反論が不十分/.test(errOf(rThin)))
      const rOk = reb(`${U}#1`, { why: `${B} は独立した記述であり下位に無ければ不備になる`, expect: `${B} を下位の設計で定める` })
      ok('承認: 作文つきの反論は「反論で維持」として通る', rOk.status === 0, errOf(rOk).slice(0, 200))
      const rAgain = reb(`${U}#0`, { why: `${A} は独立した要求であり下位に無ければ不備になる`, expect: EXPECT })
      // ↑ #0 の断片は A なので、この理由は当たっている（拒否理由は「指摘ではない」であること）
      ok('承認: 指摘を受けていない断片に反論させない',
        rAgain.status !== 0 && /「指摘」ではありません/.test(errOf(rAgain)),
        '全部に反論を貼って未解決を消す道を塞ぐ')
      const rep1 = jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))
      ok('承認: 反論で通した件数が別枠で数えられる', (rep1?.counts?.heldOver || 0) >= 1,
        '**多いときは、承認する側ではなく分解のほうを疑うための数字。** 混ぜると見えなくなる')

      // ── 決着（2 周目）───────────────────────────────────────────────
      // 指摘を落とすか残すかを決める前に、**同じ問いを盲でもう一度**投げる。
      // 「この断片は根拠・前提の説明です。同意しますか」と聞けば、まず同意が返る。
      // **同意の件数が、判断ではなく聞き方の結果になる。**
      {
        const settle = (id, v, body) => sh('ledger.mjs', ['settle', 'req->bd', id, v, JSON.stringify(body)])
        const reset = () => {
          dec2({ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B })
          apr(`${U}#1`, '要求でない', { why: WHY, kind: 'ラベル・項目名' })
        }
        reset()

        const nx = jsonOf(sh('ledger.mjs', ['settle-next', 'req->bd', 'all']))
        // **在ることと、余計なものが無いことの両方を見る。**
        // 「在る」だけだと、絞り込みを外しても緑のまま（逆対照で判明）。
        ok('決着: 指摘だけを 2 周目に回す',
          (nx?.entries || []).length === 1 && nx.entries[0].span === B,
          `**未承認や承認済みまで混ざると、2 周目が 1 周目の焼き直しになる。** ` +
          `実際: ${nx?.count} 件 ${JSON.stringify((nx?.entries || []).map(x => x.entryId))}`)
        // **entries だけを見る。** payload の nonReqKinds は答えの選択肢（1 周目にも同じものを渡す）
        // なので、そこに「ラベル・項目名」が在るのは当然。**見るのは断片に付いてきた情報。**
        const nxRaw = JSON.stringify(nx?.entries || [])
        ok('決着: 2 周目に 1 周目の判定を渡さない',
          !nxRaw.includes(WHY) && !nxRaw.includes('approval') && !nxRaw.includes('verdict'),
          '**見せてから「同意しますか」と聞くと、まず同意が返る。** ' +
          'そうやって集めた同意は判断ではなく聞き方の結果')

        const sNoWhy = settle(`${U}#1`, '要求でない', {})
        ok('決着: 理由の無い答えを拒む', sNoWhy.status !== 0 && /理由が不十分/.test(errOf(sNoWhy)),
          '**落とすほうを無料にしない。** 無料だと、黙って落とすのが最短経路になる')
        const sNoExp = settle(`${U}#1`, '要求', { why: `${A} は下位へ降ろす内容を含む記述である` })
        ok('決着: 「要求」なのに expect が無い答えを拒む',
          sNoExp.status !== 0 && /expect/.test(errOf(sNoExp)),
          '承認する側に課したのと同じ作文を、2 周目にも課す')

        // 割れる側。**落とさない。**
        const sSplit = settle(`${U}#1`, '要求',
          { why: `${A} は下位へ降ろす内容を含む記述である`, expect: `${B} を下位の設計で定める` })
        ok('決着: 割れたら落とさない', sSplit.status === 0 && /割れました/.test(String(sSplit.stdout || '')),
          `**2 対 1 を真実と呼ばない。** 出力: ${String(sSplit.stdout || '').split('\n')[0]}`)
        const rpS = jsonOf(sh('ledger.mjs', ['settle-report', 'req->bd', '--json']))
        ok('決着: 割れた件を本人の判断へ回す',
          rpS?.split === 1 && rpS?.conceded === 0,
          `実際: 割れた ${rpS?.split} / 落とした ${rpS?.conceded}`)
        const stillReq = (jsonOf(sh('ledger.mjs', ['show', 'req->bd', U, '--json']))?.entries || [])
          .filter(x => x.as === '要求')
        ok('決着: 割れた断片は分母から消えない', stillReq.length === 2,
          `**落ちるより残るほうが安全な側に倒す。** 要求 ${stillReq.length} 件`)
        const sAgain = settle(`${U}#1`, '要求でない', { why: `${A} は説明であり要求を含まない記述である` })
        ok('決着: 二度目は聞かない', sAgain.status !== 0 && /2 周目が済んでいます/.test(errOf(sAgain)),
          '答えが気に入らないから聞き直す、を塞ぐ')

        // 一致する側。**落とす。**
        reset()
        const sOk = settle(`${U}#1`, '要求でない', { why: `${A} は説明であり下位へ降ろす要求を含まない` })
        ok('決着: 一致したら対象外へ移す', sOk.status === 0 && /対象外へ移しました/.test(String(sOk.stdout || '')),
          errOf(sOk).slice(0, 200))
        const after = (jsonOf(sh('ledger.mjs', ['show', 'req->bd', U, '--json']))?.entries || [])
        const moved = after.find(x => x.as === '対象外' && x.span === B)
        ok('決着: 同意のとき 1 周目の承認を引き継ぐ', moved?.approval === '承認',
          '**同意したのに承認し直させない。** 直すのが一番高くつくと、押し切るのが最短経路になる。' +
          ` 実際: ${JSON.stringify(moved?.approval)}`)
        const rpC = jsonOf(sh('ledger.mjs', ['settle-report', 'req->bd', '--json']))
        ok('決着: 落とした件を数える', (rpC?.conceded || 0) >= 1,
          `**落とした件が 0 と出ると、2 周目を回したこと自体が記録に残らない。** 実際: ${rpC?.conceded}`)
        const notChallenged = settle(`${U}#0`, '要求でない', { why: `${A} は説明であり要求を含まない記述である` })
        ok('決着: 指摘でない断片を 2 周目に回させない',
          notChallenged.status !== 0 && /「指摘」ではありません/.test(errOf(notChallenged)),
          '承認済みのものまで落とせると、分母を自分で削れる')
      }


      // ── 塞いだ穴: 範囲が空振りしても 0 件が静かに返る ────────────────
      // `--file` / `--section` が当たるのは**上位側**の文書。下位側の章名を渡すと
      // 1 件も当たらないのに、一覧系のコマンドは空の配列を返すだけだった。
      // 実地で踏んだ: req->bd に `--file 04_editing`（基本設計の章名）を渡して
      // `count: 0` が返り、**「もう承認するものが無い」と読めた。**
      // 台帳の他の場所では `単位 0` を「漏れなし」と読ませない検査を入れてあるのに、
      // ここだけ抜けていた。
      const miss = jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all', '--file', 'zzz-存在しない']))
      ok('承認: 範囲が空振りしたら 0 件と一緒に警告を返す',
        miss?.count === 0 && /空振り/.test(String(miss?.warning || '')),
        `**0 件は「もう無い」ではなく「数えていない」ことがある。** warning=${JSON.stringify(String(miss?.warning || '').slice(0, 40))}`)
      ok('承認: 空振りの警告が「上位側に当たる」ことを伝える',
        /上位側/.test(String(miss?.warning || '')),
        '下位側の章名を渡したことに気付けないと、同じ打ち間違いを繰り返す')
      ok('承認: 当たっている範囲では警告を出さない',
        !jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all']))?.warning,
        '**当たっていない警告は、警告そのものを無視する癖をつける**')
      const missN = jsonOf(sh('ledger.mjs', ['next', 'req->bd', 'all', '--file', 'zzz-存在しない']))
      ok('分解/判定: 範囲が空振りしたら警告を返す',
        /空振り/.test(String(missN?.warning || '')),
        'approve-next だけ直しても、同じ型が next に残る')

      // ── 引き継ぎ: 直しても承認し直させない ──────────────────────────
      // 引き継がないと、「指摘に従って直す」が一番高くつき、
      // **承認を通す最短経路が「反論して押し切る」になる。** そこは絶対に逆にしない。
      const fixed = decT({ text: `${A} を満たすこと`, from: A },
                         { skip: B, why: `${B.slice(0, 10)} はラベルであり要求ではない` })
      ok('承認: 指摘に従って直せる', fixed.status === 0, errOf(fixed).slice(0, 200))
      const show3 = jsonOf(sh('ledger.mjs', ['show', 'req->bd', U]))
      const e0 = (show3?.entries || []).find(x => x.span === A)
      const e1 = (show3?.entries || []).find(x => x.span === B)
      ok('承認: 変えていない断片の承認は引き継がれる', e0?.approval === '承認',
        `${e0?.approval}。直すたびに全部承認し直すなら、直すことが一番高くつく`)
      ok('承認: 指摘に従って対象外にした断片は承認し直させない', e1?.approval === '承認',
        `${e1?.approval}。**ここが未承認に戻ると、反論して押し切るほうが安くなる**`)

      // 逆向き（「要求である」と言われて対象外から要求へ移した）は引き継がない。
      // 承認する側は**新しく書かれた要求文を見ていない**ので、承認済みにはできない。
      const back = decT({ text: `${A} を満たすこと`, from: A }, { text: `${B} も満たすこと`, from: B })
      ok('承認: 新しく書き直した要求文は承認し直させる',
        back.status === 0 && (jsonOf(sh('ledger.mjs', ['show', 'req->bd', U]))?.entries || [])
          .find(x => x.span === B)?.approval === '未承認',
        '見ていない文を承認済みにはできない')

      // ── 覗きの検出 ──────────────────────────────────────────────────
      // 承認は「下位に無ければ不備か」を**上位だけを見て**答える作業。
      // 下位を開くと、下位に無いものだけが「要求でない」に落ちる＝**漏れを漏れでなくする**。
      // **止めない。** 偶然の一致はあるし、当たっていない検査で止めると警告を無視する癖がつく。
      // expect は「この断片の話であること」も要る。原文の切れ目は単位によって変わるので、
      // **下位の文のほうをこの断片から作って置く。** 固定の文字列を使うと、
      // フィクスチャが少し変わるだけで「1 語も共有していません」で落ち、
      // **覗きの検査が一度も走らないまま緑になる**（実際に空振りした）。
      const bdPath = join(TMP, 'docs/bd.md')
      const bdOrig = readFileSync(bdPath, 'utf8')
      const BELOW = `${A} を下位の設計で定める`
      writeFileSync(bdPath, bdOrig + `\n${BELOW}\n`)
      ok('smoke: 覗きの検査に使える下位の文が在る',
        readFileSync(bdPath, 'utf8').includes(BELOW),
        '**無いとこの節が黙って空振りする**')
      const peek = apr(`${U}#0`, '要求', { why: WHY, expect: BELOW })
      ok('承認: 下位から写した expect を記録して警告する',
        peek.status === 0 && /逐語一致/.test(errOf(peek)),
        `止めないが、数える。多いなら承認そのものが当てにならない\n    ${errOf(peek).split('\n')[0]}`)
      const rep2 = jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))
      ok('承認: 覗きの疑いが集計に出る', (rep2?.expectVerbatimBelow || 0) >= 1,
        `${rep2?.expectVerbatimBelow ?? '?'} 件。出さないと誰も気付けない`)

      writeFileSync(bdPath, bdOrig)

      // ── 語尾の型は承認する側に渡さない ──────────────────────────────
      // 「非要求は語尾で見分けられる」という仮説を**あとから**測るための列。
      // 先に見せると仮説が答えを作ってしまい、測定にならない。
      ok('承認: 語尾の型を承認する側に渡していない',
        !/規範形|説明形/.test(JSON.stringify(an || {})),
        '見せた時点で、その列は仮説の検証ではなく仮説の押し付けになる')
      ok('承認: 語尾の型と判定の対照表が出る', !!rep2?.endingVsVerdict,
        '全件に回し続けるか、語尾で絞るかを決めるための数字')

      // ── ask: 本人に聞くことをまとめる ──────────────────────────────
      // 「等」のような未閉鎖の列挙は、**分解のしかたの問題ではなく原文の問題**。
      // 1 件ずつ割り込まず、最後にまとめて質問にする。
      {
        // 原文に「等」を含む単位を作り、保留にする
        const openUnit = [...(jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.noRequirementIds || []), U][0]
        const askEmpty = sh('ledger.mjs', ['ask', 'req->bd'])
        ok('ask: 聞くことが無ければそう言う',
          askEmpty.status === 0 && /聞くことは残っていません/.test(String(askEmpty.stdout || '')),
          '**当たっていない質問を混ぜると、質問そのものが読まれなくなる**')

        // 「等」を含む行を作って分解し、保留にする
        const req = join(TMP, 'docs/req.md')
        writeFileSync(req, readFileSync(req, 'utf8') + '\n## 9 音色とサウンドフォントの取り扱い\n\n対応する音色はアコースティックギター等とする。\n')
        sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
        const newId = (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])
          .find(x => { const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', x])); return /アコースティックギター等/.test(String(v?.text || '')) })
        ok('smoke: ask の検査に使う「等」の単位が在る', !!newId,
          '**無いとこの節が黙って走らない**')
        if (newId) {
          const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', newId]))
          const SA = String(v.text)
          // **原文を前後に割る。** 真ん中を抜いた文字列は原文に現れないので from にできない。
          const cut5 = SA.indexOf('等')
          const HA = SA.slice(0, cut5), TA = SA.slice(cut5)
          const d5 = sh('ledger.mjs', ['decompose', 'req->bd', newId, JSON.stringify(
            [{ text: 'アコースティックギターの音色に対応すること', from: HA },
             { skip: TA, why: `原文「${SA.slice(0, 18)}」の末尾は接続と述語であり要求ではない` }])])
          ok('smoke: ask の検査の土台になる分解が通る', d5.status === 0, String(d5.stderr || '').split('\n')[0])
          sh('ledger.mjs', ['approve', 'req->bd', `${newId}#0`, '判断できない',
            JSON.stringify({ why: `原文「${SA.slice(0, 18)}」の音色の列挙が閉じていない`,
                             resolvesBy: '「等」が指す音色を列挙して閉じる' })])
          const ask = sh('ledger.mjs', ['ask', 'req->bd'])
          const out5 = String(ask.stdout || '')
          ok('ask: 保留を質問としてまとめる',
            /決めてほしいこと/.test(out5) && /未閉鎖の列挙/.test(out5),
            `**「等」は分解のしかたではなく原文の問題。** 出力の先頭: ${out5.split('\n')[0]}`)
          ok('ask: 何を聞けばよいかまで出す',
            /聞くこと:/.test(out5) && /中身を全部挙げて/.test(out5),
            '**聞くべきことを AI に当てさせない。** 質問文は機械が作る')
          ok('ask: 決め方の選択肢と、決めないとどうなるかを出す',
            /A\) 列挙を書き足して閉じる/.test(out5) && /そのままにはできません/.test(out5),
            'rules/core.md §2「選択肢には結果を書く」')
          const askJson = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json']))
          ok('ask: 同じ行から出た断片は 1 つにまとめる',
            (askJson?.count || 0) >= 1 && (askJson?.groups || []).every(g => Array.isArray(g.entryIds)),
            '本人が直すのは行なので、行でまとめる')
        }

        // **指摘を集める引き金は「未閉鎖の列挙」だけ。**
        // 「数値のない閾値」で拾うと、閾値を語っていない文にも当たる。実測で出たのは
        //   「隙間時間でコツコツ進める」（「時間」）／「以下の理由から選択」（「以下」）。
        // どちらも本人に聞くことが無い。**当たっていない質問は、当たっている質問まで読ませなくする。**
        {
          const req2 = join(TMP, 'docs/req.md')
          writeFileSync(req2, readFileSync(req2, 'utf8') + '\n## 10 体制\n\n一人開発であり、隙間時間でコツコツ進める。\n')
          sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
          const tid = (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])
            .find(x => { const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', x])); return /隙間時間/.test(String(v?.text || '')) })
          ok('smoke: 閾値語だけを含む単位が在る', !!tid, '**無いとこの検査が黙って走らない**')
          if (tid) {
            const v2 = jsonOf(sh('ledger.mjs', ['show', 'req->bd', tid]))
            const SB = String(v2.text)
            const cut6 = SB.indexOf('隙間時間')
            const HB = SB.slice(0, cut6), TB = SB.slice(cut6)
            // 断片そのものに「時間」が入る側を要求として立て、承認する側が「要求でない」と答える＝指摘
            const d6 = sh('ledger.mjs', ['decompose', 'req->bd', tid, JSON.stringify(
              [{ text: '隙間時間での作業を前提とした開発体制とすること', from: TB },
               { skip: HB, why: `原文「${SB.slice(0, 18)}」の前半は前提の説明であり要求ではない` }])])
            ok('smoke: 閾値語の検査の土台になる分解が通る', d6.status === 0, String(d6.stderr || '').split('\n')[0])
            sh('ledger.mjs', ['approve', 'req->bd', `${tid}#0`, '要求でない',
              JSON.stringify({ kind: '根拠・前提の説明',
                               why: `原文「${SB.slice(0, 18)}」は開発の前提であり、下位に書かれていなくても不備にならない` })])
            const aj = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json']))
            const hitT = (aj?.groups || []).some(g => /隙間時間/.test(String(g.source || '')))
            ok('ask: 閾値語だけの指摘は本人に聞かない', hitT === false,
              '「時間」「以下」は語形で当たるので、**閾値を語っていない文にも当たる**。閾値の不足は judge で拾う')
            const stillEnum = (aj?.groups || []).some(g => /アコースティックギター等/.test(String(g.source || '')))
            ok('ask: 絞り込んでも「等」は取りこぼさない', stillEnum,
              '**絞り込みが効きすぎて本体まで消えていないか。** 消えていたら 0 件が「もう無い」に見える')
          }
        }

        // ── ask-record / ask-report: 答えを残す ──────────────────────
        // **答えの側にも「等」が入る。** 実測で 2 回やられた（L80 / L123）。
        // 人間が気づいたから聞き直せただけで、機械は見ていなかった。ここで見る。
        {
          const aj2 = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json']))
          const g0 = (aj2?.groups || []).find(g => /アコースティックギター等/.test(String(g.source || '')))
          ok('ask: 質問に key と見出しが付く',
            !!g0?.key && typeof g0?.header === 'string' && g0.header.length > 0 && g0.header.length <= 12,
            `**見出しは機械が作る**（質問ツールの header は 12 文字まで）。` +
            `節名をわざと長くしてあるので、詰めていなければここで超える。実際: ${JSON.stringify(g0?.header)}`)
          if (g0) {
            const SRC = String(g0.source)
            const GOODQ = `原文「${SRC.slice(0, 20)}」の「等」の中身を挙げてください`

            const r1 = sh('ledger.mjs', ['ask-record', 'req->bd', g0.key,
              '--question', GOODQ, '--answer', 'アコースティックギターやガットギターなど'])
            ok('ask-record: 答えの中の「など」を拒む', r1.status !== 0 &&
              /閉じたつもりで閉じていません/.test(String(r1.stderr || '')),
              '**これが実測で 2 回すり抜けた穴。** 答えが閉じていなければ記録しない')

            const r2 = sh('ledger.mjs', ['ask-record', 'req->bd', g0.key,
              '--question', 'この件はどうしますか', '--answer', 'アコースティックギターの1種類だけ'])
            ok('ask-record: 原文を引かない質問を拒む', r2.status !== 0 &&
              /逐語で引いていません/.test(String(r2.stderr || '')),
              'rules/core.md §2。**原文を見せずに聞くと、本人は何について答えているか分からない**')

            const r3 = sh('ledger.mjs', ['ask-record', 'req->bd', 'deadbeef0000',
              '--question', GOODQ, '--answer', 'アコースティックギターの1種類だけ'])
            ok('ask-record: 聞かれていない key を拒む', r3.status !== 0 &&
              /一覧にありません/.test(String(r3.stderr || '')),
              '**聞かれていないことに答えを付けさせない**')

            const r4 = sh('ledger.mjs', ['ask-record', 'req->bd', g0.key,
              '--question', GOODQ, '--answer', 'アコースティックギターの1種類だけとする'])
            ok('ask-record: 閉じた答えは記録する', r4.status === 0,
              String(r4.stderr || '').split('\n')[0])

            const aj3 = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json']))
            ok('ask: 答え済みは既定で出さない',
              !(aj3?.groups || []).some(g => g.key === g0.key),
              '**切れて掛け直したとき、同じ件をもう一度聞かれるとどこまで答えたか分からなくなる**')
            const ajAll = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json', '--all']))
            ok('ask: --all なら答え済みも出す',
              (ajAll?.groups || []).some(g => g.key === g0.key),
              '**消えたのではなく隠れているだけ**だと確かめられること')

            const rep1 = jsonOf(sh('ledger.mjs', ['ask-report', 'req->bd', '--json']))
            ok('ask-report: 答えたが未適用として数える',
              rep1?.recorded === 1 && rep1?.applied === 0,
              `**答えただけでは直っていない。** 実際: 記録 ${rep1?.recorded} / 適用 ${rep1?.applied}`)

            // **適用済みは申告ではなく原文で決まる。** 原文を直して消えるか。
            const reqP = join(TMP, 'docs/req.md')
            writeFileSync(reqP, readFileSync(reqP, 'utf8')
              .replace('対応する音色はアコースティックギター等とする。',
                       '対応する音色はアコースティックギターの1種類とする。'))
            sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
            const rep2 = jsonOf(sh('ledger.mjs', ['ask-report', 'req->bd', '--json']))
            ok('ask-report: 原文を直すと「適用済み」へ移る',
              rep2?.applied === 1 && rep2?.recorded === 0,
              `**申告ではなく原文の存在で見ている。** 実際: 記録 ${rep2?.recorded} / 適用 ${rep2?.applied}`)
          }
        }

        // ── refs: 「出典・参照」として落とした断片の参照先が実在するか ──
        // 実測（2026-09-16）: 要件定義書のこの 1 行が、承認 2 周とも「出典・参照」で落ちた。
        //   「該当する『不要』判定は本文書の各表内に個別に記載されている（例：…）」
        // **判定は正しい。** 実体が各表に在るなら所在を指しているだけだから。
        // ところが例に挙がった 3 つは各表に無く、**その「不要」判定は分母から静かに消えた。**
        // 落とす判断は機械で検査できないが、**参照先が解決するかは検査できる。**
        {
          const reqR = join(TMP, 'docs/req.md')
          const BEFORE = readFileSync(reqR, 'utf8')
          writeFileSync(reqR, BEFORE +
            '\n## 20 設計原則\n\n' +
            // 名指しのファイル参照を**同じ文に**入れる。別の文にすると別の単位になり、
            // 「出典・参照」として承認した断片の外に出てしまって検査が空振りする。
            // **下位の成果物（bd.md）は実在する。** 初版は探し先が上位側だけだったので、
            // 実在するのに全部「見つからない」と言った（実測 23 件中 23 件が誤検出）。
            '不要と判定した機能は各表（bd.md と missing-doc.md）に個別に記載している（例：ダークモード、移調機能、依存ライブラリの定期脆弱性スキャン）。\n' +
            '\n## 21 その他\n\n' +
            '| ダークモード | 不要 |\n' +
            '| 依存ライブラリの脆弱性対応 | 問題が判明した都度対応する |\n' +
            // **「出典・参照」以外の kind でも例示を拾っていないか**を見るための単位。
            // 無いと、kind の絞り込みを外しても緑のまま（逆対照で判明）。
            '\n## 22 補足\n\n' +
            '補足として挙げる（例：架空機能アルファ、架空機能ベータ）。\n')
          sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
          const rid = (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])
            .find(x => /例：ダークモード/.test(String(jsonOf(sh('ledger.mjs', ['show', 'req->bd', x]))?.text || '')))
          ok('smoke: refs の検査に使う参照文の単位が在る', !!rid, '**無いとこの節が黙って走らない**')
          if (rid) {
            const SR = String(jsonOf(sh('ledger.mjs', ['show', 'req->bd', rid]))?.text || '')
            const d7 = sh('ledger.mjs', ['decompose', 'req->bd', rid, JSON.stringify(
              [{ skip: SR, why: `原文「${SR.slice(0, 18)}」は各表の所在を指す参照であり要求ではない` }])])
            ok('smoke: refs の土台になる分解が通る', d7.status === 0, String(d7.stderr || '').split('\n')[0])
            sh('ledger.mjs', ['approve', 'req->bd', `${rid}#s0`, '要求でない',
              JSON.stringify({ why: `原文「${SR.slice(0, 18)}」は各表の所在を指す参照`, kind: '出典・参照' })])

            const rf = jsonOf(sh('ledger.mjs', ['refs', 'req->bd', '--json']))
            const miss = (rf?.rows || []).filter(x => x.state === '見つからない').map(x => x.target)
            const fz = (rf?.rows || []).filter(x => x.state === '表記ゆれの疑い').map(x => x.target)
            ok('refs: 参照先の無い名前を出す', miss.includes('移調機能'),
              `**ここが空だと、正しい判定のまま中身が分母から消える。** 実際: ${JSON.stringify(miss)}`)
            ok('refs: 実体のある名前は出さない', !miss.includes('ダークモード') && !fz.includes('ダークモード'),
              '**当たっていない指摘を混ぜると、当たっている指摘まで読まれなくなる**')
            ok('refs: 下位の成果物への参照を誤検出しない', !miss.includes('bd.md'),
              `**当たっていない指摘しか出ない検査は、当たっている指摘まで読まれなくする。** ` +
              `実測で 23 件中 23 件が誤検出だった。実際: ${JSON.stringify(miss)}`)
            ok('refs: 実在しないファイル参照は出す', miss.includes('missing-doc.md'),
              '**誤検出を消したついでに、当たる側まで消していないか**')
            ok('refs: 表記ゆれは「見つからない」に混ぜない',
              fz.includes('依存ライブラリの定期脆弱性スキャン') &&
              !miss.includes('依存ライブラリの定期脆弱性スキャン'),
              `**言い換えのたびに赤が出ると、検査ごと無視される側に回る。** ` +
              `見つからない=${JSON.stringify(miss)} ゆれ=${JSON.stringify(fz)}`)

            // **「出典・参照」以外の kind は見ない。** 判定の範囲を勝手に広げない。
            const oid = (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])
              .find(x => /架空機能アルファ/.test(String(jsonOf(sh('ledger.mjs', ['show', 'req->bd', x]))?.text || '')))
            ok('smoke: kind の絞り込みを試す単位が在る', !!oid, '**無いとこの逆対照が空振りする**')
            if (oid) {
              const SO = String(jsonOf(sh('ledger.mjs', ['show', 'req->bd', oid]))?.text || '')
              sh('ledger.mjs', ['decompose', 'req->bd', oid, JSON.stringify(
                [{ skip: SO, why: `原文「${SO.slice(0, 18)}」は補足の見出し語であり要求ではない` }])])
              sh('ledger.mjs', ['approve', 'req->bd', `${oid}#s0`, '要求でない',
                JSON.stringify({ why: `原文「${SO.slice(0, 18)}」は補足の見出し語`, kind: 'ラベル・項目名' })])
              const rfK = jsonOf(sh('ledger.mjs', ['refs', 'req->bd', '--json']))
              const tgt = (rfK?.rows || []).map(x => x.target)
              ok('refs: 「出典・参照」以外の kind は見ない', !tgt.includes('架空機能アルファ'),
                `**参照先が在る前提で落としたのは「出典・参照」だけ。** 他まで見ると当たらない指摘が混ざる。` +
                ` 実際: ${JSON.stringify(tgt)}`)
            }

            // **参照文そのものの行を実体と数えない。** 数えると全部「実体あり」になる。
            const selfOnly = (rf?.rows || []).filter(x => x.line === jsonOf(sh('ledger.mjs', ['show', 'req->bd', rid]))?.line)
            ok('refs: 参照文の行を実体と数えない', selfOnly.length >= 1,
              '自分の行で一致を取ると、どんな参照文も「実体あり」になる')
          }
          // **後始末。** 残すと後続の分母に混ざる。
          writeFileSync(reqR, BEFORE)
          sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
          const rf2 = jsonOf(sh('ledger.mjs', ['refs', 'req->bd', '--json']))
          ok('smoke: refs の検査に使った節を後始末できている', (rf2?.rows || []).length === 0,
            '**後始末を怠ると、次の検査が別の理由で赤くなる**')
        }
      }

      // ── requireApproval ─────────────────────────────────────────────
      const cfgPath = join(TMP, '.claude/project.json')
      const orig = readFileSync(cfgPath, 'utf8')
      // 「承認待ち」は未分解が片付いた後の状態なので、残りを行ごと対象外にして分母を閉じる。
      // 閉じないと state は（正しく）「進行中」のままで、**この検査は何も確かめない**。
      for (const cand of (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])) {
        const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
        if (!v?.text) continue
        sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
          [{ skip: v.text, why: `原文「${String(v.text).slice(0, 20)}」は承認の検査のため対象外として記録する` }])])
      }
      const pdAll = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      ok('smoke: 承認待ちの検査の前に未分解が残っていない', (pdAll?.undecomposed || 0) === 0,
        `未分解 ${pdAll?.undecomposed ?? '?'} 件。**残っていると state は「進行中」のままで、この節は何も確かめない**`)
      const stAll = jsonOf(sh('ledger.mjs', ['stats', '--json'])) || []
      const st0 = stAll.find(x => x.edge === 'req->bd')
      ok('承認: 既定では承認が完了を止めない', st0?.state !== '承認待ち',
        `${st0?.state}。当たり方を測る前に全段を止めると、当たっていない検査で作業が止まる`)
      ok('承認: 止めない設定でも承認の数字は stats に出る', (st0?.approval?.entries || 0) >= 1,
        '出さないと「機構はあるが誰も見ていない」状態が緑のまま続く')
      {
        const c = JSON.parse(orig)
        c.edges.find(e => e.from === 'req' && e.to === 'bd').requireApproval = true
        writeFileSync(cfgPath, JSON.stringify(c, null, 2))
        const st1 = (jsonOf(sh('ledger.mjs', ['stats', '--json'])) || []).find(x => x.edge === 'req->bd')
        ok('承認: requireApproval を立てると未解決が完了を止める', st1?.state === '承認待ち',
          `${st1?.state}（未解決 ${st1?.approvalPending}）`)
        c.edges.find(e => e.from === 'req' && e.to === 'bd').requireApproval = 'true'
        writeFileSync(cfgPath, JSON.stringify(c, null, 2))
        const cc = jsonOf(sh('check-config.mjs', ['--json']))
        ok('config: requireApproval の書き間違いを赤にする', cc?.ok === false && cc?.errors >= 1,
          '**文字列は false 扱いになる。止めているつもりで止まらないのが一番まずい**')
        writeFileSync(cfgPath, orig)
      }
    }
  }


  mark('兄弟エッジ（同じ上位段を持つエッジ）')
  // ── 同じ上位段を持つエッジ ────────────────────────────────────────────
  // `dd->impl` と `dd->it` は上位がどちらも dd。sync は edge.from を分母にするので、
  // 同じ 2,350 単位が 2 つの台帳に載る。
  // **分解は上位だけを見て行う作業で、下位を見ない。** それがこの仕組みの土台なので、
  // 同じ単位の分解はどのエッジから見ても同じでなければならない——
  // 2 回やるのは二度手間であり、**結果が違ったらそれは不整合**である。
  {
    const cfgPath = join(TMP, '.claude/project.json')
    const orig = readFileSync(cfgPath, 'utf8')
    const c = JSON.parse(orig)
    writeFileSync(join(TMP, 'docs/bd2.md'), '# 基本設計2\n\n## 1 テンポ\n\nsetTempo2 は数値入力を受ける。\n')
    c.tiers.push({ id: 'bd2', name: '基本設計2', sources: ['docs/bd2.md'], extractor: 'markdown' })
    c.edges.push({ kind: 'across', from: 'req', to: 'bd2' })
    writeFileSync(cfgPath, JSON.stringify(c, null, 2))
    sh('split.mjs', ['--all'])
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('ledger.mjs', ['sync', 'req->bd']); sh('ledger.mjs', ['sync', 'req->bd2'])

    const p0 = jsonOf(sh('ledger.mjs', ['pending', 'req->bd2', '--json']))
    const uid = (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
    ok('smoke: 兄弟エッジの検査に使える単位が在る', !!uid && (p0?.undecomposed || 0) >= 1,
      `**無いとこの節が黙って走らない**（req->bd2 の未分解 ${p0?.undecomposed ?? '?'}）`)
    if (uid) {
      const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', uid]))
      const S2 = String(v?.text || ''), h2 = Math.floor(S2.length / 2)
      const A2 = S2.slice(0, h2).trim(), B2 = S2.slice(h2).trim()
      const d = sh('ledger.mjs', ['decompose', 'req->bd', uid, JSON.stringify(
        [{ text: `${A2} を満たすこと`, from: A2 }, { text: `${B2} を満たすこと`, from: B2 }])])
      ok('兄弟: 分解が同じ上位段のエッジへ伝わる',
        d.status === 0 && /にも同じ分解を書きました/.test(String(d.stdout || '')),
        `**同じでなければならないものを 2 回作らせない。** ${String(d.stdout || '').split('\n')[1] || ''}`)
      const p1 = jsonOf(sh('ledger.mjs', ['pending', 'req->bd2', '--json']))
      ok('兄弟: 伝わった先で未分解が減る', (p1?.undecomposed || 0) === (p0?.undecomposed || 0) - 1,
        `未分解 ${p0?.undecomposed} → ${p1?.undecomposed}`)

      // 承認は運ぶ（「この断片は要求か」は下位に依存しない問いだから）
      const WHY2 = `原文「${S2.slice(0, 16)}」のこの部分についての判断`
      sh('ledger.mjs', ['approve', 'req->bd', `${uid}#0`, '要求',
        JSON.stringify({ why: WHY2, expect: `${A2} を下位の設計で定める` })])
      sh('ledger.mjs', ['decompose', 'req->bd', uid, JSON.stringify(
        [{ text: `${A2} を満たすこと`, from: A2 }, { text: `${B2} を満たすこと`, from: B2 }])])
      // **判定を先に入れてから引き継がせる。**
      // 引き継いだ後に判定すると、判定が運ばれるかどうかを一度も試さないまま緑になる
      // （逆対照で判明: decompositionOf が判定を落とさなくても検査が通った）。
      sh('ledger.mjs', ['judge', 'req->bd', `${uid}#1`, '対象外',
        JSON.stringify({ reason: `${B2.slice(0, 10)} は本エッジの対象外とする` })])
      const pjBefore = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      ok('smoke: 引き継ぎの前に判定が 1 件入っている',
        (pjBefore?.requirements || 0) - (pjBefore?.unjudged ?? 0) >= 1,
        `判定済 ${(pjBefore?.requirements || 0) - (pjBefore?.unjudged ?? 0)} 件。**0 だと「判定は運ばない」を試せない**`)
      rmSync(join(TMP, '.claude/coverage/edges/req-bd2.jsonl'), { force: true })
      const sy = sh('ledger.mjs', ['sync', 'req->bd2'])
      ok('兄弟: あとから作ったエッジにも sync で引き継ぐ',
        /同じ上位段から引き継ぎ/.test(String(sy.stdout || '')),
        '伝播だけだと、**後から足したエッジが空のまま**になる')
      const sh2 = jsonOf(sh('ledger.mjs', ['show', 'req->bd2', uid]))
      ok('兄弟: 承認も一緒に運ぶ',
        (sh2?.entries || []).some(x => x.approval === '承認'),
        '「この断片は要求か」は下位に依存しない問い。運ばないと同じ承認を 2 回払う')

      // **判定は運ばない。** 判定だけは下位ごとに違う。
      const pj2 = jsonOf(sh('ledger.mjs', ['pending', 'req->bd2', '--json']))
      ok('兄弟: 判定は運ばない',
        (pj2?.requirements || 0) >= 1 && pj2?.unjudged === pj2?.requirements,
        `req->bd2 の要求 ${pj2?.requirements} / 未判定 ${pj2?.unjudged}。` +
        `**下位が違うので判定は共有できない。** 運ぶと、見てもいない下位を「判定済」にする`)

      // 食い違いは毎ターン赤にする（先に別々に分解してしまった台帳は伝播では直らない）
      const div = sh('ledger.mjs', ['decompose', 'req->bd2', uid, JSON.stringify(
        [{ text: `${A2} を満たすこと`, from: A2 }, { skip: B2, why: `${B2.slice(0, 10)} はラベルであり要求ではない` }])])
      ok('smoke: 食い違いを作れた', div.status === 0, String(div.stderr || '').split('\n')[0])
      const cc = sh('check-config.mjs', [])
      ok('config: 同じ上位段のエッジで分解が食い違っていたら赤にする',
        cc.status !== 0 && /分解が食い違っています/.test(String(cc.stdout || '') + String(cc.stderr || '')),
        '**片方で要求・もう片方で対象外、が黙って成立する。** decompose 時の伝播だけでは既存の食い違いは直らない')
    }
    writeFileSync(cfgPath, orig)
    rmSync(join(TMP, '.claude/coverage/edges/req-bd2.jsonl'), { force: true })
    rmSync(join(TMP, '.claude/coverage/units/bd2.jsonl'), { force: true })
    rmSync(join(TMP, 'docs/bd2.md'), { force: true })
    sh('split.mjs', ['--all'])
  }


  // ── 未確定点の語彙は 1 か所だけ ────────────────────────────────────
  // split.mjs と req-add.mjs が**別々の定義**で同じ「列挙が閉じていない」を見ていた。
  // 「といった」「のような」は split では数えられず、「〜」は req-add では数えられない——
  // **同じ語を数えているつもりで、違う数を出していた**（罠 3 と同じ型）。
  {
    const src = [join(HERE, 'split.mjs'), join(HERE, 'req-add.mjs'), join(HERE, 'ledger.mjs'),
                 join(HERE, '..', 'hooks', 'gate.mjs')]
      .map(f => readFileSync(f, 'utf8'))
    ok('語彙: 未確定点の定義を各スクリプトが持っていない',
      src.every(t => !/const\s+(OPEN|OPEN_ENUM|VAGUE)\s*=\s*\//.test(t)),
      '**定義が 2 つあると、同じ語を数えているつもりで違う数が出る**')
    ok('語彙: 共有の定義を使っている',
      src.every(t => /from '\.{1,2}\/(scripts\/)?lib\/wording\.mjs'/.test(t)),
      'lib/wording.mjs から取ること')
    // **本文で照合しない。実際に検出させる。**
    // 最初はファイルの文字列一致で見ていたが、語彙はコメントにも書いてあるので
    // **正規表現から語を消しても緑のまま**だった（逆対照で判明）。
    const { inspect: inspectW } = await import(pathToFileURL(join(HERE, 'lib', 'wording.mjs')).href)
    const words = ['等', 'など', 'その他', 'といった', 'のような']
    const missed = words.filter(x =>
      !inspectW(`対応する形式はPDF${x}の形式とする`).some(f => f.kind === '未閉鎖の列挙'))
    ok('語彙: 統合した語がすべて検出される', missed.length === 0,
      `検出できなかった語: ${missed.join(' ') || '(なし)'}\n` +
      `    **片方にしか無かった語を、統合のときに落とさないこと**`)
    ok('語彙: 数値範囲の「〜」を列挙の未閉鎖と数えない',
      !inspectW('テンポは 20〜300 の範囲とする').some(f => f.kind === '未閉鎖の列挙'),
      '20〜300 は範囲であって列挙ではない。数えると全域で誤検出が出る')

    // ── 引用の中の「等」を数えない ──────────────────────────────────
    // 下位が上位の原文を逐語で引くと「等」が入る。**引用は下位の発言ではなく証拠**なので
    // 数えない。「引用しただけで閉じていない」場合は判定（judge）が捕まえる。
    // 逆対照を 4 本付ける。**除外が効きすぎていないこと**を、これで固定する。
    {
      const { stripQuoted: sq } = await import(pathToFileURL(join(HERE, 'lib', 'wording.mjs')).href)
      const enumOf = x => inspectW(x).some(f => f.kind === '未閉鎖の列挙')

      ok('語彙: 引用の中の「等」を未閉鎖と数えない',
        !enumOf('要件5.6「コピー／削除等」の「等」をここで解消する'),
        '**「等」を閉じると宣言するために「等」を引いている。** 数えると閉じる手段が無くなる')

      // 逆対照 1: 引用の外の「等」は今までどおり数える
      ok('逆対照: 引用の外の「等」は数える',
        enumOf('要件5.6「コピー／削除」等に対応する'),
        '**除外が「」の外まで効いたら、検査そのものが無意味になる**')

      // 逆対照 2: 引用の中と外に両方あるときは数える（外があるので赤）
      ok('逆対照: 引用の外にもある場合は数える',
        enumOf('要件5.6「コピー／削除等」など'),
        '引用が 1 つ在るだけで行全体が免除されてはいけない')

      // 逆対照 3: 入れ子でも、外に出ている語は数える
      ok('逆対照: 入れ子の外に出た「等」は数える',
        enumOf('既定のステータスタグ（「未着手」等）は置かない'),
        '「未着手」は引用だが、その外の「等」は書き手自身の言葉')

      // 逆対照 4: 程度語には広げていない（範囲を固定する）
      ok('逆対照: 程度語は引用の中でも数える',
        inspectW('要件は「適切に処理する」と書いている').some(f => f.kind === '未定義の程度'),
        '**除外は未閉鎖の列挙だけに効かせている。** 広げるときは意識して広げること')

      ok('語彙: stripQuoted が「」の外を消さない',
        sq('a「b」c') === 'ac' && sq('外「内」外') === '外外',
        '消しすぎると、消えた側に在った語を見落とす')

      // ── 数え方も 1 か所だけ ────────────────────────────────────────
      // **実測（2026-09）**: stripQuoted を入れてもゲートは止まり続けた。
      // gate.mjs:952 が OPEN_ENUM を生で import して**自前で数えて**おり、
      // ledger.mjs:589 も同じだった。このファイルは「正規表現の再定義」は禁じていたが、
      // **正規表現を受け取って数え方を書く**ほうは素通りだった。
      // 生で配らなければ再実装しようがないので、export をやめて関数だけ出す。
      {
        const wsrc = readFileSync(join(HERE, 'lib', 'wording.mjs'), 'utf8')
        ok('語彙: OPEN_ENUM を export していない',
          !/export\s+const\s+OPEN_ENUM/.test(wsrc),
          '**生の正規表現を配ると、受け取った側が自分で数え方を書ける。** 実際に 2 か所が書いていた')

        const users = [join(HERE, 'split.mjs'), join(HERE, 'req-add.mjs'), join(HERE, 'ledger.mjs'),
                       join(HERE, '..', 'hooks', 'gate.mjs')].map(f => readFileSync(f, 'utf8'))
        ok('語彙: 利用側に OPEN_ENUM の名前が残っていない',
          users.every(t => !/\bOPEN_ENUM\b/.test(t)),
          'export を外したので、残っていれば読み込みごと失敗する。**名前の段階で止める**')

        const { countOpenEnum: cnt, openEnumWords: wds } =
          await import(pathToFileURL(join(HERE, 'lib', 'wording.mjs')).href)
        ok('語彙: countOpenEnum が引用の中を数えない',
          cnt('要件5.6「コピー／削除等」の「等」をここで解消する') === 0,
          'hasOpenEnum と同じ除外が効いていること。**ゲートはこちらを使う**')
        // 逆対照: 引用の外は数える。個数まで合っていること
        ok('逆対照: countOpenEnum が引用の外を数える',
          cnt('A等、B など、C その他') === 3 && wds('A等、B など').join('/') === '等/など',
          '**除外が効きすぎたら、ゲートは何も止めなくなる**')
      }
    }

    // ── 判定役へ渡す指示そのものが閉じているか ──────────────────────
    // **文書に課している規律を、AI へ渡す指示にも課す。**
    //
    // 実測（2026-09-22）: `03_screens_ui_pc.md` に足した注記の「…等）」を
    // Stop hook が止めたので外した。**ところが同じ文を project.json の judgeNote にも
    // 書いていて、そちらは直し忘れた。** しかも列挙の中身が古くなっていて
    // （「iOS 標準の共有シート」は判定し直して `一致` になっていた）、
    // **「表に行が無い例」として毎回の判定役に配られ続けていた。**
    // 表に行があるものを対象外にしかねない。
    //
    // 文書は hook が見ている。**指示は誰も見ていなかった。**
    //
    // 限界: judgeNote が空のときは「対象外」として緑になる。
    // 任意の設定なので空を赤にはできない。**空にすれば黙らせられる**ことは承知のうえ。
    {
      const pjPath = join(HERE, '..', 'project.json')
      const jn = existsSync(pjPath)
        ? String((JSON.parse(readFileSync(pjPath, 'utf8')) || {}).judgeNote || '') : ''
      if (!jn) {
        ok('語彙: judgeNote は未設定（この検査は対象外）', true, '')
      } else {
        const found = inspectW(jn).filter(f => f.kind === '未閉鎖の列挙')
        ok('語彙: 判定役へ渡す指示に未閉鎖の列挙が無い', found.length === 0,
          '**指示が「等」で閉じていないと、判定役ごとに中身の解釈が変わる。** ' +
          `見つかった語: ${found.flatMap(f => f.hits).join(' ') || '(なし)'}`)
      }
    }


    // ── 手順書が呼んでいるサブコマンドが実在するか ──────────────────
    // commands/*.md と rules/*.md は「こう打て」と書いてあるだけで、
    // **打てるかどうかは誰も見ていない。** サブコマンドを 1 つ改名すると、
    // 手順書は静かに腐り、AI はそこに書いてある通りに打って失敗する。
    // **「そう書いてあるか」ではなく「そう動くか」で見る**——ここでは
    // 使い方の一覧に載っているかで見る（実行すると副作用が出るので）。
    {
      const lg = readFileSync(join(HERE, 'ledger.mjs'), 'utf8')
      const usage = (lg.match(/使い方: ledger\.mjs ([a-z|-]+)/) || [])[1] || ''
      const known = new Set(usage.split('|').filter(Boolean))
      ok('手順書: ledger.mjs の使い方一覧が読める', known.size > 5,
        `**これが読めないと以下の検査が空振りする。** 拾えた数: ${known.size}`)
      const docs = []
      for (const d of ['commands', 'rules']) {
        const dir = join(HERE, '..', d)
        if (!existsSync(dir)) continue
        for (const f of readdirSync(dir).filter(x => x.endsWith('.md')))
          docs.push([`${d}/${f}`, readFileSync(join(dir, f), 'utf8')])
      }
      const cm = join(HERE, '..', '..', 'CLAUDE.md')
      if (existsSync(cm)) docs.push(['CLAUDE.md', readFileSync(cm, 'utf8')])
      ok('手順書: 走査対象の文書が在る', docs.length > 0, '**0 件なら以下は何も見ていない**')
      const unknown = []
      for (const [name, body] of docs)
        for (const m of body.matchAll(/ledger\.mjs\s+"?([a-z][a-z-]*)/g))
          if (!known.has(m[1])) unknown.push(`${name}: ${m[1]}`)
      ok('手順書: 書いてあるサブコマンドがすべて実在する', unknown.length === 0,
        `使い方一覧に無いもの: ${unknown.join(', ') || '(なし)'}\n` +
        `    **改名したら手順書も直す。** 直さないと、そこに書いてある通りに打って失敗する`)
    }
  }

  mark('断片の識別子と理由')
  // ── 他の断片を落としても識別子がずれないか ──────────────────────────
  // 実測（2026-09-17）: `#<番号>` は reqs 配列の添字だったので、concede が 1 件
  // 抜くたびに以降が繰り上がった。1 つの一覧から作った 5 件の concede を順に
  // 流したら 2 件目が**別の断片に当たり**、「クリーンエレキ」についての理由が
  // 「歪みエレキ」に付いた。**concede は元に戻せないので、その付け違いは消せない。**
  //
  // **位置で照合して壊れたのはこれで 3 回目**（anchor の連鎖、書き戻しの出力、これ）。
  {
    const K = mkdtempSync(join(tmpdir(), 'claude-entryid-'))
    try {
      mkdirSync(join(K, 'docs'), { recursive: true }); mkdirSync(join(K, '.claude'), { recursive: true })
      writeFileSync(join(K, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd' }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(K, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      writeFileSync(join(K, 'docs/req.md'),
        '# 要件\n\n## 1 音色\n\n対応する音色はアコースティックギターと打ち込みドラムと歪みエレキとする。\n')
      const rk = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: K, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: K } })
      const jk = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      rk('split.mjs', ['--all']); rk('ledger.mjs', ['sync', 'req->bd'])
      const uid = (jk(rk('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 識別子の検査に使う単位が在る', !!uid, '**無いとこの節が黙って走らない**')
      if (uid) {
        const TT = String(jk(rk('ledger.mjs', ['show', 'req->bd', uid]))?.text || '')
        // **語を共有しない 3 つを選ぶ。** 「クリーンエレキ」と「歪みエレキ」は
        // カタカナの部分一致（sharesToken）で「エレキ」が共有され、
        // **理由の照合をすり抜ける**——実測の事故そのものはこの検査では捕まらない。
        // 捕まるのは語を共有しない断片どうしのときだけ。弱点として rationale に記録した。
        const A1 = 'アコースティックギター', A2 = '打ち込みドラム', A3 = '歪みエレキ'
        const d = rk('ledger.mjs', ['decompose', 'req->bd', uid, JSON.stringify([
          { text: `${A1} の音色に対応すること`, from: A1 },
          { text: `${A2} の音色に対応すること`, from: A2 },
          { text: `${A3} の音色に対応すること`, from: A3 },
          { skip: 'とする。', why: `原文「${TT.slice(0, 16)}」の末尾は述語であり要求ではない` }])])
        ok('smoke: 3 断片に分解できる', d.status === 0, String(d.stderr || '').split('\n')[0])

        const ents = () => (jk(rk('ledger.mjs', ['show', 'req->bd', uid]))?.entries || [])
        const idOf = sp => ents().find(x => x.span === sp)?.entryId
        const id2 = idOf(A2), id3 = idOf(A3)
        ok('smoke: 2 つめ・3 つめの識別子が取れる', !!id2 && !!id3, `${id2} / ${id3}`)

        // 1 つめを指摘にして落とす
        rk('ledger.mjs', ['approve', 'req->bd', idOf(A1), '要求でない',
          JSON.stringify({ why: `原文「${TT.slice(0, 16)}」の ${A1} は音色名のラベルである`, kind: 'ラベル・項目名' })])
        const c = rk('ledger.mjs', ['concede', 'req->bd', idOf(A1),
          '--why', `${A1} は音色名のラベルであり下位へ降ろす要求を含まない`])
        ok('smoke: 1 つめを落とせる', c.status === 0, String(c.stderr || '').split('\n')[0])

        // **ここが本体。** 落とした後も id2 / id3 が同じ断片を指しているか。
        const e2 = ents().find(x => x.entryId === id2)
        const e3 = ents().find(x => x.entryId === id3)
        ok('台帳: 他の断片を落としても識別子は同じ断片を指したまま',
          e2?.span === A2 && e3?.span === A3,
          `**添字だと 1 件落とすたびに以降がずれる。** ` +
          `id2→${JSON.stringify(String(e2?.span || '(消えた)'))} id3→${JSON.stringify(String(e3?.span || '(消えた)'))}`)

        // ── 理由がその断片に触れているか ──────────────────────────────
        rk('ledger.mjs', ['approve', 'req->bd', id3, '要求でない',
          JSON.stringify({ why: `原文「${TT.slice(0, 16)}」の ${A3} は音色名のラベルである`, kind: 'ラベル・項目名' })])
        const bad = rk('ledger.mjs', ['concede', 'req->bd', id3,
          '--why', `${A2} は音色名のラベルであり下位へ降ろす要求を含まない`])
        ok('台帳: その断片に触れていない理由を拒む',
          bad.status !== 0 && /この断片.*に触れていません/.test(String(bad.stderr || '')),
          `**同じ単位のどの断片にも貼れる理由は、その断片を落とす理由にならない。** ` +
          `実測では「クリーンエレキ」の理由が「歪みエレキ」に付いたまま通った`)
        const good = rk('ledger.mjs', ['concede', 'req->bd', id3,
          '--why', `${A3} は音色名のラベルであり下位へ降ろす要求を含まない`])
        ok('台帳: その断片に触れている理由は通る', good.status === 0,
          String(good.stderr || '').split('\n')[0])

        // 断片が語を持たないとき（記号・助詞）は、この検査を掛けない。
        // 掛けると正当な同意まで通らなくなる（過剰検出）。
        const idS = ents().find(x => x.span === 'とする。')?.entryId
        rk('ledger.mjs', ['approve', 'req->bd', idS, '要求',
          JSON.stringify({ why: `原文「${TT.slice(0, 16)}」の末尾は要求である`, expect: `${A1} を下位の設計で定める` })])
        const sym = rk('ledger.mjs', ['rebut', 'req->bd', idS,
          JSON.stringify({ why: `原文「${TT.slice(0, 16)}」の末尾は述語であり、下位へ降ろす内容を持たない` })])
        ok('台帳: 語を持たない断片には理由の照合を掛けない', sym.status === 0,
          `**掛けると「＋」「を含む）」のような断片で正当な判断まで通らなくなる。** ` +
          String(sym.stderr || '').split('\n')[0])
      }
    } finally { rmSync(K, { recursive: true, force: true }) }
  }

  mark('判定の入口（承認と同じ識別子で指し、決着していないものは通さない）')
  // ── 判定だけが配列の添字のままだった ────────────────────────────────
  // 実測（2026-09-17）: 断片の識別子を中身の鍵（#k…）に移したとき、
  // approve / settle / concede / rebut は移ったが、**judge と、判定向けの show
  // だけが `Number()` で添字を読んだまま**残った。結果:
  //
  //   ・`next --phase judge` は `#<番号>` を配る
  //   ・その形で show を呼ぶと `x.id === id` に 1 件も当たらず、
  //     **承認の状態が黙って落ちる**（「指摘されています」の警告が一度も出ない）
  //   ・指摘のままの断片を、警告も無く「一致」と判定できる
  //
  // 検査が無かったのではなく、**在るように見えて一度も動いていなかった。**
  // **位置で照合して壊れたのはこれで 4 回目**（anchor の連鎖、書き戻しの出力、
  // 断片の識別子、これ）。同じ型が 4 回出たので、型として記録する。
  {
    const J = mkdtempSync(join(tmpdir(), 'claude-judge-'))
    try {
      mkdirSync(join(J, 'docs'), { recursive: true }); mkdirSync(join(J, '.claude'), { recursive: true })
      writeFileSync(join(J, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd' }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
        // プロジェクト固有の読み替え先。**道具側には文書名を埋めない。**
        judgeNote: 'ここでは docs/bd.md の読み替え表を先に開くこと。',
      }, null, 2))
      writeFileSync(join(J, 'docs/bd.md'),
        '# 基本設計\n\n## 1 再生\n\n再生速度は0.5倍から1.5倍まで10%刻みで指定できる。\n\nメトロノームはクリック音で拍頭を鳴らす。\n')
      writeFileSync(join(J, 'docs/req.md'),
        '# 要件\n\n## 1 再生\n\n再生速度の変更と、メトロノームの発音と、区間ループの指定に対応すること。\n')
      const rj = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: J, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: J } })
      const jj = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      rj('split.mjs', ['--all']); rj('ledger.mjs', ['sync', 'req->bd'])
      const uj = (jj(rj('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 判定の検査に使う単位が在る', !!uj, '**無いとこの節が黙って走らない**')
      if (uj) {
        const TJ = String(jj(rj('ledger.mjs', ['show', 'req->bd', uj]))?.text || '')
        const d = rj('ledger.mjs', ['decompose', 'req->bd', uj, JSON.stringify([
          { text: '再生速度を変更できること', from: '再生速度の変更' },
          { text: 'メトロノームを発音できること', from: 'メトロノームの発音' },
          { text: '区間ループを指定できること', from: '区間ループの指定' },
          { skip: 'に対応すること。', why: `原文「${TJ.slice(0, 14)}」の末尾は述語であり要求ではない` }])])
        ok('smoke: 3 要求 + 1 対象外に分解できる', d.status === 0, String(d.stderr || '').split('\n')[0])

        const ents = () => (jj(rj('ledger.mjs', ['show', 'req->bd', uj]))?.entries || [])
        const idOf = sp => ents().find(x => x.span === sp)?.entryId
        const kSoku = idOf('再生速度の変更'), kMet = idOf('メトロノームの発音')
        const kLoop = idOf('区間ループの指定'), kSkip = idOf('に対応すること。')
        ok('smoke: 4 断片の識別子が取れる', !!kSoku && !!kMet && !!kLoop && !!kSkip,
          `${kSoku} / ${kMet} / ${kLoop} / ${kSkip}`)

        // 1 件を指摘に、1 件を承認に、1 件は未承認のまま残す
        rj('ledger.mjs', ['approve', 'req->bd', kSoku, '要求でない',
          JSON.stringify({ why: `原文「${TJ.slice(0, 14)}」の再生速度の変更は項目名である`, kind: 'ラベル・項目名' })])
        rj('ledger.mjs', ['approve', 'req->bd', kMet, '要求',
          JSON.stringify({ why: `原文「${TJ.slice(0, 14)}」はメトロノームの発音を求めている`,
                           expect: 'メトロノームが拍頭でクリック音を鳴らすこと' })])

        // ── 判定の一覧が配る識別子の形 ──────────────────────────────
        const nx = jj(rj('ledger.mjs', ['next', 'req->bd', '10', '--phase', 'judge']))
        const ids = (nx?.requirements || []).map(x => x.reqId)
        ok('台帳: 判定の一覧も中身の鍵で配る',
          ids.length > 0 && ids.every(x => /#k[0-9a-f]{12}(\.\d+)?$/.test(x)),
          `**承認と判定で識別子の形が違うと、片方を動かしたとき他方が黙って別のものを指す。** ` +
          `配られた形: ${JSON.stringify(ids)}`)

        // ── 指摘のままのものを一覧から外す ──────────────────────────
        ok('台帳: 指摘のままの要求は判定の一覧に出ない',
          nx?.blocked === 1 && !ids.some(x => x === kSoku),
          `**要求でないと言われている断片を下位と突き合わせても意味を持たない。** ` +
          `外した件数: ${nx?.blocked ?? '(数えていない)'} / 一覧: ${JSON.stringify(ids)}`)

        // ── 逆対照: 承認済み・未承認は一覧に**残る** ────────────────
        ok('台帳: 承認済みと未承認の要求は判定の一覧に残る',
          ids.includes(kMet) && ids.includes(kLoop),
          `**絞り込みすぎて、判定すべきものまで消していないか。** ` +
          `承認済み ${ids.includes(kMet)} / 未承認 ${ids.includes(kLoop)}`)

        // ── 判定役に渡す制約 ────────────────────────────────────────
        // 実測（2026-09-21）: 上位が iPhone 版の形で書かれ、下位が「PC版での翻訳」表を
        // 持っていた。**表を開いた判定役だけが一致を出し、開かなかった側は
        // 「上位の言葉どおりの記述が下位に無い」で不一致・対象外にした。**
        // 同じ 121 行目の「長押しして削除」が一致、「タップして削除」が不一致で同居していた。
        // 制約に「読み替えの表を先に探せ」が無かったので、開くかどうかが個体差になっていた。
        //
        // **同じ文字列を 2 か所に書いていたのも直した。** 片方だけ直すと、
        // 同じ判定が 2 通りの制約で動く（`next` と `show` で違う注意書きが出る）。
        const noteN = String(nx?.note || '')
        ok('台帳: 判定の制約に「読み替えの表を先に探せ」が入っている',
          /読み替え/.test(noteN) && /対象外にする理由になりません/.test(noteN),
          '**無いと、表を開くかどうかが判定役の個体差になる（実測でそうなった）。** ' +
          noteN.slice(0, 120))
        ok('台帳: プロジェクト固有の言い足しが制約に載る',
          /docs\/bd\.md の読み替え表を先に開くこと/.test(noteN),
          '**道具に文書名を埋めない。** project.json の judgeNote が載らないと、' +
          'プロジェクト固有の読み替え先を判定役に渡す先が無くなる')
        {
          // kMet は「承認」なので、show の note に指摘の但し書きは付かない。
          // **だから完全一致で比べられる。** 前方一致で書いたら逆対照が鳴らなかった
          // （show を古い短い文字列に戻しても、それが next の note の接頭辞なので通った。
          //  逆対照が鳴らなかったのはこれで 11 回目）。**片方が短いことこそ検出したいのに。**
          const shN = String(jj(rj('ledger.mjs', ['show', 'req->bd', kMet]))?.note || '')
          ok('台帳: 判定の制約が next と show で完全に同じ',
            shN === noteN && shN.length > 0,
            '**2 か所に書くと、片方だけ直ったとき同じ判定が 2 通りの制約で動く。** ' +
            `next: ${noteN.length} 文字 / show: ${shN.length} 文字`)
        }

        // ── show が承認の状態を出すか（添字の形で呼ばれても）─────────
        const sh0 = jj(rj('ledger.mjs', ['show', 'req->bd', `${uj}#0`]))
        ok('台帳: 判定向けの show は、添字の形で呼ばれても承認の状態を出す',
          sh0?.approval?.state === '指摘' && /決着/.test(String(sh0?.note || '')),
          `**識別子の形が合わないと、この警告は一度も出ない（実測でそうなっていた）。** ` +
          `approval=${JSON.stringify(sh0?.approval?.state ?? null)}`)

        // ── 指摘のまま判定できないこと ──────────────────────────────
        const jBad = rj('ledger.mjs', ['judge', 'req->bd', `${uj}#0`, '一致',
          JSON.stringify({ file: 'docs/bd.md', line: 5, quote: '再生速度は0.5倍から1.5倍まで10%刻みで指定できる。' })])
        ok('台帳: 指摘のままの要求は判定を受け付けない',
          jBad.status !== 0 && /指摘.*のままです/.test(String(jBad.stderr || '')),
          `**承認が食い違ったままの断片は、一致と出ようが不一致と出ようが意味を持たない。** ` +
          String(jBad.stderr || '').split('\n')[0])

        // ── 逆対照 1: 承認済みは中身の鍵で判定できる ────────────────
        const jOk = rj('ledger.mjs', ['judge', 'req->bd', kMet, '一致',
          JSON.stringify({ file: 'docs/bd.md', line: 7, quote: 'メトロノームはクリック音で拍頭を鳴らす。' })])
        ok('台帳: 承認済みの要求は中身の鍵で判定できる', jOk.status === 0,
          `**止めすぎていないか。** ` + String(jOk.stderr || '').split('\n')[0])

        // ── 逆対照 2: 未承認でも判定できる（承認を回していない段を止めない）──
        //    あわせて、古い添字の形でも引けること（当たった断片を必ず表示する）
        const jLegacy = rj('ledger.mjs', ['judge', 'req->bd', `${uj}#2`, '部分',
          JSON.stringify({ file: 'docs/bd.md', line: 5, quote: '再生速度は0.5倍から1.5倍まで10%刻みで指定できる。' })])
        ok('台帳: 未承認の要求は判定できる（承認を必須にしない）', jLegacy.status === 0,
          `**承認を回していないエッジで判定が始まらなくなる。** ` + String(jLegacy.stderr || '').split('\n')[0])
        ok('台帳: 添字の形で判定したら、当たった断片を表示する',
          /配列の添字/.test(String(jLegacy.stderr || '')),
          `**黙って受けると、ずれていても気づけない。** ` + String(jLegacy.stderr || '').split('\n')[0])

        // ── 対象外の断片は判定できない ──────────────────────────────
        const jSkip = rj('ledger.mjs', ['judge', 'req->bd', kSkip, '一致',
          JSON.stringify({ file: 'docs/bd.md', line: 7, quote: 'メトロノームはクリック音で拍頭を鳴らす。' })])
        ok('台帳: 対象外の断片は判定できない',
          jSkip.status !== 0 && /対象外の断片/.test(String(jSkip.stderr || '')),
          `**識別子を取り違えたまま判定が通ると、要求でないものに判定が付く。** ` +
          String(jSkip.stderr || '').split('\n')[0])
      }
    } finally { rmSync(J, { recursive: true, force: true }) }
  }

  mark('判定のあとの分類（どちらを直すか）')
  // ── 分類は台帳の要求そのものに持たせる ──────────────────────────────
  // 実測（2026-09-19）: 146 件ぶんの分類を受け渡し用の Markdown に置いたところ、
  // **毎ターン上書きされる場所**だったために危うく消えた。作業用ディレクトリの
  // 残骸から拾えたのは偶然で、次は復旧できない。
  //
  // 台帳に置くと、もう 1 つの性質が手に入る。**上位を直せばその単位は陳腐化して消え、
  // 分類も一緒に消える。** 別ファイルに reqId で持たせると、
  // **消えた要求の分類だけが生き残る**——直したのに古い判断が残る腐り方をする。
  // この節の本体は「上位を直したら分類も消えるか」。
  {
    const P = mkdtempSync(join(tmpdir(), 'claude-plan-'))
    try {
      mkdirSync(join(P, 'docs'), { recursive: true }); mkdirSync(join(P, '.claude'), { recursive: true })
      writeFileSync(join(P, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd' }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(P, 'docs/bd.md'), '# 基本設計\n\n## 1 再生\n\n再生速度は0.5倍から1.5倍まで10%刻みで指定できる。\n')
      writeFileSync(join(P, 'docs/req.md'), '# 要件\n\n## 1 再生\n\n再生速度の変更と、メトロノームの発音に対応すること。\n')
      const rp = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: P, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: P } })
      const jp = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      rp('split.mjs', ['--all']); rp('ledger.mjs', ['sync', 'req->bd'])
      const up = (jp(rp('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 分類の検査に使う単位が在る', !!up, '**無いとこの節が黙って走らない**')
      if (up) {
        rp('ledger.mjs', ['decompose', 'req->bd', up, JSON.stringify([
          { text: '再生速度を変更できること', from: '再生速度の変更' },
          { text: 'メトロノームを発音できること', from: 'メトロノームの発音' },
          { skip: 'に対応すること。', why: '原文「再生速度の変更と、メ」の末尾は述語であり要求ではない' }])])
        const ents = () => (jp(rp('ledger.mjs', ['show', 'req->bd', up]))?.entries || [])
        const kMet = ents().find(x => x.span === 'メトロノームの発音')?.entryId
        const kSkip = ents().find(x => x.as === '対象外')?.entryId
        ok('smoke: 分類の検査に使う断片が取れる', !!kMet && !!kSkip, `${kMet} / ${kSkip}`)

        rp('ledger.mjs', ['judge', 'req->bd', kMet, '不一致',
          JSON.stringify({ method: 'メトロノーム を docs/bd.md で grep → 0件' })])

        // ── 未分類を数えるか ────────────────────────────────────────
        const r0 = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
        ok('台帳: 一致以外なのに分類が無い要求を数える', r0?.missing === 1,
          `**直す必要があるのに、どちらを直すか決まっていないものが見えないと積み残る。** ` +
          `未分類 ${r0?.missing ?? '(数えていない)'} 件`)

        const WHY = 'メトロノームの発音が基本設計に降りていないため下位に追記する'
        const good = rp('ledger.mjs', ['plan', 'req->bd', kMet, '下位を直す', '--why', WHY])
        ok('台帳: 分類を付けられる', good.status === 0, String(good.stderr || '').split('\n')[0])

        const sh = jp(rp('ledger.mjs', ['show', 'req->bd', kMet]))
        ok('台帳: 分類が show に出る', sh?.plan?.kind === '下位を直す',
          `**出ないと、判定だけ見て「で、どうするんだっけ」に戻る。** ${JSON.stringify(sh?.plan ?? null)}`)

        const r1 = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
        ok('台帳: 分類を付けたら未分類から外れる', r1?.missing === 0 && r1?.byKind?.['下位を直す'] === 1,
          `**逆対照。数えっぱなしで減らないなら、数えていることにならない。** ` +
          `未分類 ${r1?.missing} / 下位を直す ${r1?.byKind?.['下位を直す']}`)

        // ── 受け付けてはいけないもの ────────────────────────────────
        const bad1 = rp('ledger.mjs', ['plan', 'req->bd', kMet, 'なおす', '--why', WHY])
        ok('台帳: 決めていない分類名を拒む', bad1.status !== 0 && /分類は次のいずれか/.test(String(bad1.stderr || '')),
          String(bad1.stderr || '').split('\n')[0])

        const bad2 = rp('ledger.mjs', ['plan', 'req->bd', kMet, '下位を直す', '--why', '無い'])
        ok('台帳: 分類の理由が短すぎるものを拒む', bad2.status !== 0 && /短すぎます/.test(String(bad2.stderr || '')),
          `**「無い」だけでは、後から読んだ人が何も判断できない。** ` + String(bad2.stderr || '').split('\n')[0])

        const bad3 = rp('ledger.mjs', ['plan', 'req->bd', kMet, '下位を直す', '--why', 'abcdefghijklmnop qrstuvwx'])
        ok('台帳: その要求に触れていない理由を拒む',
          bad3.status !== 0 && /1 語も共有していません/.test(String(bad3.stderr || '')),
          `**どの要求にも貼れる一文は理由にならない。** ` + String(bad3.stderr || '').split('\n')[0])

        const bad4 = rp('ledger.mjs', ['plan', 'req->bd', kSkip, '下位を直す', '--why', WHY])
        ok('台帳: 対象外の断片には分類を付けられない',
          bad4.status !== 0 && /対象外の断片/.test(String(bad4.stderr || '')),
          String(bad4.stderr || '').split('\n')[0])

        // ── 一致に動いたのに分類が残っているのを数えるか ──────────
        // 実測（2026-09-22）: 判定を通し直して 15 件が `一致` へ動いたが、
        // 15 件とも `スコープ外` の分類を持ったまま残り、`plan-report` は **0 件**と出した。
        // 検査には `&& q.plan.kind !== 'スコープ外'` と書いてあった。**1 語の例外のせいで、
        // 一番効いてほしいところで効いていなかった。**
        // 「この階層に降りている（一致）」と「この階層の担当ではない（スコープ外）」が
        // 同じ要求に同居して、どこにも見えなかった。
        {
          const r2a = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
          ok('smoke: いまは消し忘れが 0 件', (r2a?.staleCount || 0) === 0, JSON.stringify(r2a?.staleCount))
          // 分類が付いたまま 一致 へ動かす
          rp('ledger.mjs', ['judge', 'req->bd', kMet, '一致',
            JSON.stringify({ file: 'docs/bd.md', line: 5, quote: '再生速度は0.5倍から1.5倍まで10%刻みで指定できる' })])
          const r2 = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
          ok('台帳: 一致に動いたのに分類が残っているものを数える',
            (r2?.staleCount || 0) === 1 && (r2?.staleList || [])[0]?.kind === '下位を直す',
            '**一致したものに「どちらを直すか」は要らない。残っているのは消し忘れ。** ' +
            `消し忘れ ${r2?.staleCount ?? '(数えていない)'} 件`)

          // **種類で例外を作らない。** 「スコープ外」だけ見逃していたのが実際の事故。
          rp('ledger.mjs', ['plan', 'req->bd', kMet, 'スコープ外', '--why',
            'メトロノームの発音はこの階層の担当ではないため分類を置き換える'])
          const r3 = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
          ok('台帳: 「スコープ外」も消し忘れとして数える',
            (r3?.staleCount || 0) === 1 && (r3?.staleList || [])[0]?.kind === 'スコープ外',
            '**ここが抜けていた。** 一致と「この階層の担当ではない」が同居して見えなくなる。 ' +
            `消し忘れ ${r3?.staleCount ?? '(数えていない)'} 件 / ` +
            `種類 ${JSON.stringify((r3?.staleList || [])[0]?.kind ?? null)}`)

          // **`対象外` も同じ。** 例外を 1 つ外したら、同じ形が他に無いかをその場で見る。
          // 実測（2026-09-22）: `スコープ外` の例外を外した直後、その 1 つ隣——
          // **`対象外` に分類が付いた 6 件**——が `missing` にも `stale` にも出ず、
          // どちらからも見えないまま残っていた。
          rp('ledger.mjs', ['judge', 'req->bd', kMet, '対象外',
            JSON.stringify({ reason: 'メトロノームの発音はこの階層では判定しないため対象外とする' })])
          const r3b = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
          ok('台帳: 対象外に動いたのに分類が残っているものも数える',
            (r3b?.staleCount || 0) === 1 && (r3b?.staleList || [])[0]?.verdict === '対象外',
            '**直す先が要るのは「この階層で直す」ものだけ。一致と対象外に分類は要らない。** ' +
            `消し忘れ ${r3b?.staleCount ?? '(数えていない)'} 件 / ` +
            `判定 ${JSON.stringify((r3b?.staleList || [])[0]?.verdict ?? null)}`)

          // 逆対照: 外したら消し忘れも 0 に戻る
          rp('ledger.mjs', ['plan', 'req->bd', kMet, '--clear'])
          const r4 = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))
          ok('台帳: 分類を外すと消し忘れから外れる', (r4?.staleCount || 0) === 0,
            '**数えっぱなしで減らないなら、数えていることにならない。** ' +
            `消し忘れ ${r4?.staleCount ?? '?'} 件`)

          // 元へ戻す（この下の検査が「不一致＋分類あり」を前提にしている）
          rp('ledger.mjs', ['judge', 'req->bd', kMet, '不一致',
            JSON.stringify({ method: 'メトロノーム を docs/bd.md で grep → 0件' })])
          rp('ledger.mjs', ['plan', 'req->bd', kMet, '下位を直す', '--why', WHY])

          // ── 直す先が要るものから分類を外させない ────────────────
          // 実測（2026-09-22）: `judge ...; plan --clear` と 1 行に繋いで流したところ、
          // **judge が引用の検査で拒まれたのに、後段の `--clear` だけが通った。**
          // 判定は `部分` のまま、分類は無し——`plan-report` が即座に
          // 「一致以外なのに分類が無い」と数える状態が、誰も意図せずにできた。
          // **気づいたのは報告を書いたからで、道具は止めていない。**
          const clrNo = rp('ledger.mjs', ['plan', 'req->bd', kMet, '--clear'])
          ok('台帳: 判定が「不一致」のままの要求から分類を外せない',
            clrNo.status !== 0 && /直す先が要るものから分類を外せません/.test(String(clrNo.stderr || '')),
            '**繋いだコマンドの前段が拒まれても、後段だけ通ってしまう。** ' +
            String(clrNo.stderr || '').split('\n')[0])
          ok('台帳: 拒まれたときに分類は残っている',
            jp(rp('ledger.mjs', ['show', 'req->bd', kMet]))?.plan?.kind === '下位を直す',
            '**拒むだけで、途中まで書いてしまわないこと。**')
        }

        // ── ここが本体。上位を直したら分類も消えるか ──────────────
        const before = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))?.planned
        writeFileSync(join(P, 'docs/req.md'),
          '# 要件\n\n## 1 再生\n\n再生速度の変更と、メトロノームの発音と、区間ループの指定に対応すること。\n')
        rp('split.mjs', ['--all']); rp('ledger.mjs', ['sync', 'req->bd'])
        const after = jp(rp('ledger.mjs', ['plan-report', 'req->bd', '--json']))?.planned
        // **この検査を壊して確かめるときは、anchor の枝（`reqs: null`）を壊すこと。**
        // 最初 `prev.hash === u.hash` の条件を外して試したが**空振りした**（7 回目）。
        // 単位 id は本文のハッシュなので、本文が変われば id ごと別物になり、
        // id で引き継ぐ枝はそもそも当たらない。陳腐化は「位置は同じで本文が変わった」
        // の枝が作っている。**壊す場所を間違えると、検査が在ることの確認にならない。**
        ok('台帳: 上位を直すと、その要求の分類も一緒に消える',
          before === 1 && after === 0,
          `**分類を別ファイルに reqId で持たせると、消えた要求の分類だけが生き残る。** ` +
          `直したのに古い判断が残るのが、いちばん質の悪い腐り方。前 ${before} → 後 ${after}`)
      }
    } finally { rmSync(P, { recursive: true, force: true }) }
  }

  mark('割れたものを本人へ回す（決めない、という決め方）')
  // ── ゲートに「待つ」という終わり方が無いと、待つ代わりに決めてしまう ──
  //
  // 実測（2026-09-20）: 決着（settle）は「割れたら落とさず本人へ回す」設計だが、
  // **Stop hook はそれを終わりとして認めていなかった。** 指摘が 1 件でも残ると止まり、
  // 許されるのは「分解を直す」か「反論を記録する」の 2 つだけ。結果、
  // **本人へ回すはずだった判断が、その場で `rebut` として置かれた。**
  // ゲートが、設計が意図した経路を塞いで、判断を書かせた。
  //
  // だから状態として持たせる。ただし**黙って通す逃げ道にはしない**——
  // 2 周目を回す前には回せず、理由が要り、数えて見えるところに残る。
  {
    const H = mkdtempSync(join(tmpdir(), 'claude-hold-'))
    try {
      mkdirSync(join(H, 'docs'), { recursive: true }); mkdirSync(join(H, '.claude'), { recursive: true })
      writeFileSync(join(H, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd', requireApproval: true }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(H, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      writeFileSync(join(H, 'docs/req.md'),
        '# 要件\n\n## 1 画面\n\nモーダルパネルのサイズは内容の重さで使い分ける。\n')
      const rh = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: H, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: H } })
      const jh = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      rh('split.mjs', ['--all']); rh('ledger.mjs', ['sync', 'req->bd'])
      const uh = (jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 本人待ちの検査に使う単位が在る', !!uh, '**無いとこの節が黙って走らない**')
      if (uh) {
        const TH = String(jh(rh('ledger.mjs', ['show', 'req->bd', uh]))?.text || '')
        rh('ledger.mjs', ['decompose', 'req->bd', uh, JSON.stringify([
          { text: 'モーダルパネルのサイズを内容の重さで使い分けること', from: 'モーダルパネルのサイズは内容の重さで使い分ける' }])])
        const kh = (jh(rh('ledger.mjs', ['show', 'req->bd', uh]))?.entries || [])[0]?.entryId
        const WHY = 'モーダルパネルのサイズの区分が割れており、枠組みの宣言か要求かで判断が分かれる'

        // 承認されている断片は回せない（逆対照を先に）
        rh('ledger.mjs', ['approve', 'req->bd', kh, '要求',
          JSON.stringify({ why: `原文「${TH.slice(0, 14)}」はサイズの使い分けを求めている`,
                           expect: 'モーダルパネルのサイズを内容の重さで使い分ける区分が下位に在ること' })])
        const hOk0 = rh('ledger.mjs', ['hold', 'req->bd', kh, '--why', WHY])
        ok('台帳: 承認済みの断片は本人へ回せない',
          hOk0.status !== 0 && /本人へ回すのは/.test(String(hOk0.stderr || '')),
          `**逃げ道にしない。食い違っているものだけが対象。** ` + String(hOk0.stderr || '').split('\n')[0])

        // 指摘にする
        rh('ledger.mjs', ['approve', 'req->bd', kh, '要求でない',
          JSON.stringify({ why: `原文「${TH.slice(0, 14)}」は枠組みの宣言であり具体は次の文が定める`,
                           kind: '枠組み・位置づけ' })])
        const ap1 = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('smoke: 指摘が 1 件立っている', (ap1?.approval?.challenged || 0) === 1,
          `指摘 ${ap1?.approval?.challenged ?? '?'} 件`)

        // **2 周目を回す前には回せない。**
        const hEarly = rh('ledger.mjs', ['hold', 'req->bd', kh, '--why', WHY])
        ok('台帳: 2 周目を回す前は本人へ回せない',
          hEarly.status !== 0 && /2 周目/.test(String(hEarly.stderr || '')),
          `**「割れた」と言うには 2 回見ていることが要る。** ` + String(hEarly.stderr || '').split('\n')[0])

        // 2 周目（1 周目と違う答え＝割れる）
        rh('ledger.mjs', ['settle', 'req->bd', kh, '要求',
          JSON.stringify({ why: `原文「${TH.slice(0, 14)}」は単一サイズで済ませないことを課している`,
                           expect: 'サイズの区分と割り当てが下位に在ること' })])

        // 理由がこの断片に触れていないものは拒む
        const hBad = rh('ledger.mjs', ['hold', 'req->bd', kh, '--why', '判断が難しいので本人に見てもらう'])
        ok('台帳: 本人へ回す理由が原文に触れていないものを拒む', hBad.status !== 0,
          `**何が割れているのかを書かせる。本人はそれを読んで決める。** ` +
          String(hBad.stderr || '').split('\n')[0])

        // ── ここが本体 ────────────────────────────────────────────
        const hOk = rh('ledger.mjs', ['hold', 'req->bd', kh, '--why', WHY])
        ok('台帳: 割れた断片を本人へ回せる', hOk.status === 0, String(hOk.stderr || '').split('\n')[0])

        const ap2 = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('台帳: 本人へ回したら、AI 側の未解決から外れる',
          (ap2?.approvalUnresolved || 0) === 0,
          `**外れないと、本人の返事を待つ間ずっと Stop が止まり、待つ代わりに決めることになる。** ` +
          `未解決 ${ap2?.approvalUnresolved ?? '?'} 件`)
        ok('台帳: ただし「本人待ち」として数えられ、消えない',
          (ap2?.approval?.waiting || 0) === 1 && (ap2?.approval?.challenged || 0) === 0,
          `**黙って消すのと、待っていると記録するのは別のこと。** ` +
          `本人待ち ${ap2?.approval?.waiting ?? '?'} / 指摘 ${ap2?.approval?.challenged ?? '?'}`)

        // **本人待ちの要求に判定を書かせない。**
        // 実測（2026-09-23、turn 45）: 本人待ちの要求に judge を打ったら「一致」が書き込まれた。
        // 入口が「指摘」「保留」しか見ていなかった。判定は、本人が決めたあとに置く。
        const jW = rh('ledger.mjs', ['judge', 'req->bd', kh, '不一致',
          JSON.stringify({ method: '基本設計を「モーダル」で検索して 0 件' })])
        let jWwritten = null
        try {
          jWwritten = readFileSync(join(H, '.claude/coverage/edges/req-bd.jsonl'), 'utf8')
            .split('\n').filter(Boolean).map(l => JSON.parse(l))
            .some(u => (u.reqs || []).some(q => q.verdict))
        } catch { jWwritten = null }
        ok('台帳: 本人待ちの要求には判定を書かない',
          jW.status !== 0 && /本人待ち/.test(String(jW.stderr || '')) && jWwritten === false,
          `**本人が決める前の判定は、concede されたら捨てることになる。** ` +
          `exit ${jW.status}  ` + String(jW.stderr || '').split('\n')[0])

        // **本人のコマンドは、本人の端末からしか通らない。**
        // 実測（2026-09-24、turn 54）: 承認のワークフローの書き戻し役が concede を打った。約束でしかなかった。
        const rhNoTty = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
          { cwd: H, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: H, CLAUDE_LEDGER_ALLOW_NON_TTY: '' } })
        const cNT = rhNoTty('ledger.mjs', ['concede', 'req->bd', kh, '--why', WHY])
        const uNT = rhNoTty('ledger.mjs', ['uphold', 'req->bd', kh, '--why', WHY])
        const apNT = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('台帳: 本人待ちへの concede と uphold は、端末でなければ通らない',
          cNT.status !== 0 && /本人のコマンド/.test(String(cNT.stderr || '')) &&
          uNT.status !== 0 && /本人のコマンド/.test(String(uNT.stderr || '')) &&
          (apNT?.approval?.waiting || 0) === 1,
          `**「本人が打つ」を約束ではなく仕組みにする。** concede exit ${cNT.status} / uphold exit ${uNT.status} / ` +
          `本人待ち ${apNT?.approval?.waiting ?? '?'}  ` + String(cNT.stderr || '').split('\n')[0])

        const hClr = rh('ledger.mjs', ['hold', 'req->bd', kh, '--clear'])
        const ap3 = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('台帳: 本人待ちを外すと指摘に戻る',
          hClr.status === 0 && (ap3?.approval?.challenged || 0) === 1 && (ap3?.approval?.waiting || 0) === 0,
          `指摘 ${ap3?.approval?.challenged ?? '?'} / 本人待ち ${ap3?.approval?.waiting ?? '?'}`)

        // ── 反論で維持からも本人待ちへ戻せるか ──────────────────────
        // 実測（2026-09-20）: Stop hook に「待つ」終わり方が無かったせいで、
        // 本人へ回すはずの判断が `rebut` として置かれた。あとから戻そうとしたら、
        // **入口が「反論で維持」を受けず、状態の判定も rebuttal を先に返すため戻せなかった。**
        // **直す道具が、直す対象に届かない。** 足した当日に踏んだ。
        const rb = rh('ledger.mjs', ['rebut', 'req->bd', kh, JSON.stringify(
          { expect: 'モーダルパネルのサイズの区分と割り当てが下位に在ること',
            why: `原文「${TH.slice(0, 14)}」はモーダルパネルのサイズを単一で済ませないことを課している` })])
        const apR = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('smoke: 反論で維持の状態を作れる',
          rb.status === 0 && (apR?.approval?.heldOver || 0) === 1,
          `反論で維持 ${apR?.approval?.heldOver ?? '?'} 件  ` + String(rb.stderr || '').split('\n')[0])

        // **反論を取り消して指摘に戻せる。記録は消えない。**
        // 実測（2026-09-24、turn 54）: 判断する役ではない書き戻し役が反論を 4 件置き、戻す道が無かった。
        const clrBad = rh('ledger.mjs', ['rebut', 'req->bd', kh, '--clear', '--why', '戻す'])
        const clrOk = rh('ledger.mjs', ['rebut', 'req->bd', kh, '--clear', '--why', '判断する役ではない書き戻し役が置いた反論なので無効にする'])
        const apC = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        let keptRec = false
        try {
          keptRec = readFileSync(join(H, '.claude/coverage/edges/req-bd.jsonl'), 'utf8')
            .split('\n').filter(Boolean).map(l => JSON.parse(l))
            .some(u => (u.reqs || []).some(q => Array.isArray(q.clearedRebuttals) && q.clearedRebuttals.length === 1))
        } catch { keptRec = false }
        ok('台帳: 反論を取り消すと指摘に戻り、前の反論は記録に残る',
          clrBad.status !== 0 && clrOk.status === 0 &&
          (apC?.approval?.challenged || 0) === 1 && (apC?.approval?.heldOver || 0) === 0 && keptRec,
          `**戻す道が無いと、誰も決めていない反論が確定扱いで残る。** 理由の短いもの exit ${clrBad.status} / ` +
          `指摘 ${apC?.approval?.challenged ?? '?'} / 反論で維持 ${apC?.approval?.heldOver ?? '?'} / 記録 ${keptRec}  ` +
          String(clrOk.stderr || '').split('\n')[0])
        // 以降の検査のために、反論で維持へ戻しておく
        rh('ledger.mjs', ['rebut', 'req->bd', kh, JSON.stringify(
          { expect: 'モーダルパネルのサイズの区分と割り当てが下位に在ること',
            why: `原文「${TH.slice(0, 14)}」はモーダルパネルのサイズを単一で済ませないことを課している` })])

        const hr = rh('ledger.mjs', ['hold', 'req->bd', kh, '--why', WHY])
        ok('台帳: 反論で維持からも本人へ回せる', hr.status === 0,
          `**ゲートに押されて置いた判断を戻せないなら、道具を足した意味がない。** ` +
          String(hr.stderr || '').split('\n')[0])
        const apH = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('台帳: 本人待ちは反論で維持より先に見える',
          (apH?.approval?.waiting || 0) === 1 && (apH?.approval?.heldOver || 0) === 0,
          `**先に反論が返ると、待っていることが見えない（実測でそうなった）。** ` +
          `本人待ち ${apH?.approval?.waiting ?? '?'} / 反論で維持 ${apH?.approval?.heldOver ?? '?'}`)

        const hr2 = rh('ledger.mjs', ['hold', 'req->bd', kh, '--clear'])
        const apB = jh(rh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('台帳: 本人待ちを外すと反論で維持に戻る（記録は消えていない）',
          hr2.status === 0 && (apB?.approval?.heldOver || 0) === 1,
          `**状態を移しただけで、何があったかの記録は残る。** ` +
          `反論で維持 ${apB?.approval?.heldOver ?? '?'}`)

        // ── 台帳への書き込みは、どのコマンドで書いたかが必ず残る ────────────
        // 実測（2026-09-24、turn 54）: ワークフローの役が台本に無い rebut / concede を打ったが、
        // 台帳側には何も残っておらず、エージェントの記録を人が読んで初めて分かった。
        const opsAll = jh(rh('ledger.mjs', ['ops', '--json']))
        const cmdsSeen = new Set((opsAll?.rows || []).map(o => o.cmd))
        ok('台帳: 書き込んだコマンドが ops に残る',
          (opsAll?.total || 0) > 0 && ['decompose', 'approve', 'settle', 'hold', 'rebut'].every(c => cmdsSeen.has(c)),
          `**残っていないと、台本に無い書き込みを後から拾えない。** 記録 ${opsAll?.total ?? '?'} 件 / ` +
          `コマンド ${[...cmdsSeen].join(',')}`)
        const lastHold = [...(opsAll?.rows || [])].reverse().find(o => o.cmd === 'hold')
        const opsOk = rh('ledger.mjs', ['ops', '--since', String(lastHold?.at || ''), '--expect', 'hold'])
        const opsNg = rh('ledger.mjs', ['ops', '--since', String(lastHold?.at || ''), '--expect', 'approve'])
        ok('台帳: ops --expect は、想定外のコマンドの書き込みがあれば終了コード 1',
          !!lastHold && opsOk.status === 0 && opsNg.status === 1 && /想定外の書き込みが/.test(String(opsNg.stdout || '')),
          `**ワークフローのあとに本体が打つ照合。** 想定どおり exit ${opsOk.status} / 想定外 exit ${opsNg.status}`)
        // **時刻は数として比べる。** 実測（2026-09-24、turn 55）: PC の時計（+09:00）で渡したら 1 件も拾わず、
        // 空のまま「想定外 0」で通った（記録は UTC）。
        const at0 = String(lastHold?.at || '')
        const jst = at0 ? new Date(Date.parse(at0) + 9 * 3600e3).toISOString().replace('Z', '+09:00') : ''
        const opsJ = jh(rh('ledger.mjs', ['ops', '--since', jst, '--json']))
        const opsZ = jh(rh('ledger.mjs', ['ops', '--since', at0, '--json']))
        ok('台帳: ops --since は +09:00 で渡しても UTC と同じものを拾う',
          !!jst && (opsJ?.count || 0) >= 1 && opsJ?.count === opsZ?.count,
          `**文字列で比べると、空のまま「想定外 0」で通る（実測）。** +09:00 ${opsJ?.count ?? '?'} 件 / Z ${opsZ?.count ?? '?'} 件（${jst}）`)
        const opsEmpty = rh('ledger.mjs', ['ops', '--since', '2099-01-01T00:00:00Z', '--expect', 'approve'])
        const opsBadT = rh('ledger.mjs', ['ops', '--since', 'きのう', '--expect', 'approve'])
        ok('台帳: 照合する書き込みが 0 件、または時刻が読めないときは通さない（終了コード 2）',
          opsEmpty.status === 2 && /0 件です/.test(String(opsEmpty.stdout || '')) && opsBadT.status === 2,
          `**空振りを「想定外 0」と読ませない。** 0 件 exit ${opsEmpty.status} / 読めない exit ${opsBadT.status}`)
      }
    } finally { rmSync(H, { recursive: true, force: true }) }
  }

  mark('本人が分解側を支持して閉じられるか（concede の裏返し）')
  // ── 同じ型の 4 回目 ────────────────────────────────────────────────
  //
  // 実測（2026-09-20 → 22）:
  //   1. Stop hook に「待つ」終わり方が無く、本人へ回すはずの判断が `rebut` で置かれた
  //   2. `hold` が「反論で維持」を受けなかった
  //   3. `concede` が「反論で維持」「本人待ち」を受けなかった
  //   4. **本人が分解側を支持して閉じる道が、そもそも無かった。**
  //
  // いちばん近いのが `hold --clear` で、これは `反論で維持` に戻るだけ。
  // その記録は「**分解役が反論した**」であって「**本人が決めた**」ではない。
  // 台帳を後から読む人に、本人が見て決めたことが残らない。
  {
    const V = mkdtempSync(join(tmpdir(), 'claude-uphold-'))
    try {
      mkdirSync(join(V, 'docs'), { recursive: true }); mkdirSync(join(V, '.claude'), { recursive: true })
      writeFileSync(join(V, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd', requireApproval: true }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(V, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      writeFileSync(join(V, 'docs/req.md'),
        '# 要件\n\n## 1 画面\n\nモーダルパネルのサイズは内容の重さで使い分け、ダイアログの幅は固定する。\n')
      const rv = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: V, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: V } })
      const jv = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      const apv = () => jv(rv('ledger.mjs', ['pending', 'req->bd', '--json']))?.approval || {}
      const rawV = () => {
        const f = join(V, '.claude/coverage/edges/req-bd.jsonl')
        if (!existsSync(f)) return []
        return readFileSync(f, 'utf8').split('\n').filter(Boolean)
          .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      }
      rv('split.mjs', ['--all']); rv('ledger.mjs', ['sync', 'req->bd'])
      const uv = (jv(rv('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 本人裁定の検査に使う単位が在る', !!uv, '**無いとこの節が黙って走らない**')
      if (uv) {
        const A3 = 'モーダルパネルのサイズは内容の重さで使い分け'
        const B3 = 'ダイアログの幅は固定する'
        rv('ledger.mjs', ['decompose', 'req->bd', uv, JSON.stringify([
          { text: 'モーダルパネルのサイズを内容の重さで使い分けること', from: A3 },
          { text: 'ダイアログの幅を固定すること', from: B3 }])])
        const ents = () => (jv(rv('ledger.mjs', ['show', 'req->bd', uv]))?.entries || [])
        const idOf = sp => (ents().find(x => x.span === sp) || {}).entryId
        const kA = idOf(A3), kB = idOf(B3)
        ok('smoke: 断片が 2 つ取れている', !!kA && !!kB && kA !== kB, `${kA} / ${kB}`)

        // ── 逆対照を先に: 承認済みには本人裁定を掛けられない ──────────
        rv('ledger.mjs', ['approve', 'req->bd', kB, '要求',
          JSON.stringify({ why: `原文「${B3.slice(0, 10)}」は幅を固定することを求めている`,
                           expect: 'ダイアログの幅の値が下位に在ること' })])
        const upNo = rv('ledger.mjs', ['uphold', 'req->bd', kB, '--why',
          'ダイアログの幅は下位で定めるべき要求なので残す'])
        ok('台帳: 承認済みの断片には本人裁定を掛けられない',
          upNo.status !== 0 && /本人が決められるのは/.test(String(upNo.stderr || '')),
          '**食い違っているものだけが対象。全件に貼れる道にしない。** ' +
          String(upNo.stderr || '').split('\n')[0])

        // ── 指摘 → 2 周目で割れる → 本人へ回す ───────────────────────
        rv('ledger.mjs', ['approve', 'req->bd', kA, '要求でない',
          JSON.stringify({ why: `原文「${A3.slice(0, 12)}」は枠組みの宣言であり具体は次の文が定める`,
                           kind: '枠組み・位置づけ' })])
        rv('ledger.mjs', ['settle', 'req->bd', kA, '要求',
          JSON.stringify({ why: `原文「${A3.slice(0, 12)}」は単一の形で済ませないことを課している`,
                           expect: `${A3} の区分と割り当てが下位に在ること` })])
        rv('ledger.mjs', ['rebut', 'req->bd', kA, JSON.stringify(
          { expect: `${A3} の区分と割り当てが下位に在ること`,
            why: `原文「${A3.slice(0, 12)}」は単一で済ませないことを課している` })])
        rv('ledger.mjs', ['hold', 'req->bd', kA, '--why',
          `${A3} が割れており、枠組みの宣言か要求かで判断が分かれる`])
        ok('smoke: 本人待ちを作れた', (apv().waiting || 0) === 1, JSON.stringify(apv()))

        // ── 理由の検査（concede と同じ厳しさ）────────────────────────
        const upThin = rv('ledger.mjs', ['uphold', 'req->bd', kA, '--why', '要求だと思う'])
        ok('台帳: 本人裁定の理由が短すぎるものを拒む', upThin.status !== 0,
          '**承認側を覆すのだから、何を見て覆したかが要る。** ' + String(upThin.stderr || '').split('\n')[0])
        const upOther = rv('ledger.mjs', ['uphold', 'req->bd', kA, '--why',
          'ダイアログの幅は下位で定めるべき要求なので残すことにした'])
        ok('台帳: この断片に触れていない理由を拒む',
          upOther.status !== 0 && /この断片/.test(String(upOther.stderr || '')),
          '**同じ単位の別の断片にも貼れる理由は、この断片を残す理由にならない。** ' +
          String(upOther.stderr || '').split('\n')[0])

        // ── ここが本体 ───────────────────────────────────────────────
        const upOk = rv('ledger.mjs', ['uphold', 'req->bd', kA, '--why',
          `${A3} の区分は下位で定めるべき要求なので、本人の判断として要求のまま残す`])
        ok('台帳: 本人待ちから「要求である」と決めて閉じられる', upOk.status === 0,
          '**concede の裏返しが無いと、本人が分解側を支持した記録が台帳に入らない。** ' +
          String(upOk.stderr || '').split('\n')[0])
        ok('台帳: 本人裁定で決着する（本人待ち・反論で維持から外れる）',
          (apv().waiting || 0) === 0 && (apv().heldOver || 0) === 0 && (apv().ok || 0) === 2,
          `**宙ぶらりんを残さない。** ` + JSON.stringify(apv()))
        ok('台帳: 要求は台帳から消えていない',
          (jv(rv('ledger.mjs', ['pending', 'req->bd', '--json']))?.requirements || 0) === 2,
          '**本人が「要求である」と決めたのだから、分母に残る。**')
        {
          const q = (rawV().find(x => x.unitId === uv)?.reqs || []).find(x => x.from === A3)
          ok('台帳: 承認側の言い分と反論が priorRecords に残る',
            !!q?.priorRecords?.approval && !!q?.priorRecords?.rebuttal && !!q?.priorRecords?.hold,
            '**覆したことと、何を覆したかの両方が残ること。** ' +
            JSON.stringify(Object.keys(q?.priorRecords || {})))
          ok('台帳: 本人が決めたことが承認の記録に残る（viaOwner）',
            q?.approval?.viaOwner === true && q?.approval?.verdict === '要求',
            '**「承認」とだけ書くと、誰が決めたのか分からなくなる。** ' +
            JSON.stringify({ verdict: q?.approval?.verdict, viaOwner: q?.approval?.viaOwner }))
        }
        // **判定済みのものに「未判定です」と出さない。**
        // 実測（2026-09-22）: 実物の台帳で試したら、判定済みの要求に「未判定です」と出た。
        // uphold が動かすのは承認の側だけで、判定（verdict）には触れない。
        {
          rv('ledger.mjs', ['judge', 'req->bd', kA, '対象外',
            JSON.stringify({ reason: 'モーダルパネルのサイズはこの階層では判定しないため対象外とする' })])
          rv('ledger.mjs', ['approve', 'req->bd', kA, '要求でない',
            JSON.stringify({ why: '原文「モーダルパネルのサイ」は枠組みの宣言である', kind: '枠組み・位置づけ' })])
          rv('ledger.mjs', ['settle', 'req->bd', kA, '要求',
            JSON.stringify({ why: '原文「モーダルパネルのサイ」は単一の形で済ませないことを課している',
                             expect: 'モーダルパネルのサイズの区分が下位に在ること' })])
          const up2 = rv('ledger.mjs', ['uphold', 'req->bd', kA, '--why',
            'モーダルパネルのサイズの区分は下位で定めるべき要求なので、本人の判断として要求のまま残す'])
          ok('台帳: 判定済みの要求に「未判定です」と出さない',
            up2.status === 0 && !/未判定として pending に出ます/.test(up2.stdout || '')
              && /判定は「対象外」のままです/.test(up2.stdout || ''),
            '**uphold が動かすのは承認の側だけ。出力が状態を言い違えると、読んだ人が判定し直す。** ' +
            String(up2.stdout || '').replace(/\n/g, ' / ').slice(0, 160))
        }

        ok('台帳: 本人裁定の件数が別枠で数えられる',
          (jv(rv('ledger.mjs', ['approval-report', 'req->bd', '--json']))?.upheld || 0) === 1,
          '**多いときは、承認する側の基準がずれていることを疑うための数字。** 混ぜると見えなくなる')
      }
    } finally { rmSync(V, { recursive: true, force: true }) }
  }

  // ── 対象外にした断片が本人待ちになったとき、「対象外のまま」と決められるか ──────
  // 実測（2026-09-24、turn 55）: 本人待ち 3 件のうち 2 件は対象外の断片だった。
  // uphold は要求にしか使えず、concede は要求を外すだけなので、**「対象外のまま」と決めるコマンドが無かった。**
  {
    const W = mkdtempSync(join(tmpdir(), 'claude-uphold-skip-'))
    try {
      mkdirSync(join(W, 'docs'), { recursive: true }); mkdirSync(join(W, '.claude'), { recursive: true })
      writeFileSync(join(W, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd', requireApproval: true }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(W, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      writeFileSync(join(W, 'docs/req.md'),
        '# 要件\n\n## 1 画面\n\nフリーズの検知について、ダイアログの幅は固定する。\n')
      const rw = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: W, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: W } })
      const jw = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      const apw = () => jw(rw('ledger.mjs', ['pending', 'req->bd', '--json']))?.approval || {}
      rw('split.mjs', ['--all']); rw('ledger.mjs', ['sync', 'req->bd'])
      const uw = (jw(rw('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 対象外の本人裁定の検査に使う単位が在る', !!uw, '**無いとこの節が黙って走らない**')
      if (uw) {
        const S = 'フリーズの検知について、', R = 'ダイアログの幅は固定する'
        rw('ledger.mjs', ['decompose', 'req->bd', uw, JSON.stringify([
          { skip: S, why: '「フリーズの検知について」は段落の見出しで、要求は後ろの文が持つ' },
          { text: 'ダイアログの幅を固定すること', from: R }])])
        const ents = jw(rw('ledger.mjs', ['show', 'req->bd', uw]))?.entries || []
        const kS = (ents.find(x => x.span === S) || {}).entryId
        const kR = (ents.find(x => x.span === R) || {}).entryId
        rw('ledger.mjs', ['approve', 'req->bd', kR, '要求',
          JSON.stringify({ why: `原文「${R}」は幅を固定することを求めている`, expect: 'ダイアログの幅の値が下位に在ること' })])
        rw('ledger.mjs', ['approve', 'req->bd', kS, '要求',
          JSON.stringify({ why: '原文「フリーズの検知について」はフリーズの検知を求めている', expect: 'フリーズの検知の仕組みが下位に在ること' })])
        rw('ledger.mjs', ['settle', 'req->bd', kS, '要求でない',
          JSON.stringify({ why: '原文「フリーズの検知について」は見出しで、検知の中身を定めていない', kind: 'ラベル・項目名' })])
        rw('ledger.mjs', ['hold', 'req->bd', kS, '--why', 'フリーズの検知についての見出しを要求とするかで 1 周目と 2 周目が割れた'])
        ok('smoke: 対象外の断片の本人待ちを作れた', (apw().waiting || 0) === 1, JSON.stringify(apw()))
        const upS = rw('ledger.mjs', ['uphold', 'req->bd', kS, '--why', 'フリーズの検知についての部分は見出しなので、本人の判断で対象外のまま残す'])
        const raw = (() => { try { return readFileSync(join(W, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } })()
        const node = (raw.find(u => u.unitId === uw)?.skips || []).find(x => x.skip === S)
        ok('台帳: 対象外の断片を、本人の判断で「対象外のまま」と決めて閉じられる',
          upS.status === 0 && (apw().waiting || 0) === 0 && (apw().ok || 0) === 2 &&
          node?.approval?.viaOwner === true && node?.approval?.verdict === '要求でない' && !!node?.priorRecords?.hold,
          `**決めるコマンドが無いと、本人待ちが永久に残るか、決めていない誰かが決めることになる。** ` +
          `exit ${upS.status} / ${JSON.stringify(apw())} / ${JSON.stringify(node?.approval || null).slice(0, 120)}  ` +
          String(upS.stderr || '').split('\n')[0])
      }
    } finally { rmSync(W, { recursive: true, force: true }) }
  }

  mark('同意したときに、割れた記録が消えていないか')
  // ── 直す道具が、直す対象に届かない ──────────────────────────────────
  //
  // 実測（2026-09-20 → 21）、**同じ型を 3 回踏んだ**:
  //   1. Stop hook に「待つ」終わり方が無く、本人へ回すはずの判断が `rebut` で置かれた
  //   2. 戻そうとしたら `hold` が「反論で維持」を受けなかった
  //   3. 本人が「1 周目が正しい」と決めたのに、`concede` が同じ理由で受けなかった
  //
  // **決めたことを取り消す道が、決めた状態からは通っていなかった。**
  // 入口を足すときは、同じ状態から入る他のコマンドも一緒に見ること。
  //
  // そしてもう 1 つ。**同意は reqs から節点ごと抜いて skips に別の節点を作る。**
  // 承認だけを引き継いでいたので、2 周目の答え・反論・本人へ回した理由が
  // 同意した瞬間に台帳から消えていた。画面には「反論の記録が在りました」と
  // 出ていたが、**その直後に消していた。** 後から読むと
  // 「同意で片付いた 1 件」にしか見えない——割れたことも、本人が見たことも残らない。
  {
    const C = mkdtempSync(join(tmpdir(), 'claude-conc-'))
    try {
      mkdirSync(join(C, 'docs'), { recursive: true }); mkdirSync(join(C, '.claude'), { recursive: true })
      writeFileSync(join(C, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd', requireApproval: true }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(C, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      writeFileSync(join(C, 'docs/req.md'),
        '# 要件\n\n## 1 画面\n\nモーダルパネルのサイズは内容の重さで使い分け、ダイアログの幅は固定する。\n')
      const rc = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: C, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: C } })
      const jc = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      const apc = () => jc(rc('ledger.mjs', ['pending', 'req->bd', '--json']))?.approval || {}
      // 台帳の生の中身を読む。**画面の文言ではなく、残ったものを見る。**
      const rawOf = () => {
        const f = join(C, '.claude/coverage/edges/req-bd.jsonl')
        if (!existsSync(f)) return []
        return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      }
      rc('split.mjs', ['--all']); rc('ledger.mjs', ['sync', 'req->bd'])
      const uc = (jc(rc('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 同意の検査に使う単位が在る', !!uc, '**無いとこの節が黙って走らない**')
      if (uc) {
        const A2 = 'モーダルパネルのサイズは内容の重さで使い分け'
        const B2 = 'ダイアログの幅は固定する'
        const dec = () => rc('ledger.mjs', ['decompose', 'req->bd', uc, JSON.stringify([
          { text: 'モーダルパネルのサイズを内容の重さで使い分けること', from: A2 },
          { text: 'ダイアログの幅を固定すること', from: B2 }])])
        dec()
        const ents = () => (jc(rc('ledger.mjs', ['show', 'req->bd', uc]))?.entries || [])
        const idOf = span => (ents().find(x => x.span === span) || {}).entryId
        const kA = idOf(A2), kB = idOf(B2)
        ok('smoke: 断片が 2 つ取れている', !!kA && !!kB && kA !== kB, `${kA} / ${kB}`)

        // 割れるところまで持っていく（承認 要求でない → 2 周目 要求）
        const toSplit = (k, span) => {
          rc('ledger.mjs', ['approve', 'req->bd', k, '要求でない',
            JSON.stringify({ why: `原文「${span.slice(0, 12)}」は枠組みの宣言であり具体は次の文が定める`,
                             kind: '枠組み・位置づけ' })])
          rc('ledger.mjs', ['settle', 'req->bd', k, '要求',
            JSON.stringify({ why: `原文「${span.slice(0, 12)}」は単一の形で済ませないことを課している`,
                             expect: `${span} の区分と割り当てが下位に在ること` })])
        }

        // ── A: 反論で維持 → 同意 ──────────────────────────────────
        toSplit(kA, A2)
        const rbA = rc('ledger.mjs', ['rebut', 'req->bd', kA, JSON.stringify(
          { expect: `${A2} の区分と割り当てが下位に在ること`,
            why: `原文「${A2.slice(0, 12)}」は単一で済ませないことを課している` })])
        ok('smoke: 反論で維持を作れた', rbA.status === 0 && (apc().heldOver || 0) === 1,
          `反論で維持 ${apc().heldOver ?? '?'}  ` + String(rbA.stderr || '').split('\n')[0])

        const cA = rc('ledger.mjs', ['concede', 'req->bd', kA, '--why',
          `${A2} の具体的な区分は次の文が定めており、この一文は枠組みの宣言で下位へ降ろす要求を含まない`])
        ok('台帳: 反論で維持からも同意できる', cA.status === 0,
          '**反論を撤回する道が無いと、いちど反論した断片は永久に未解決のまま残る。** ' +
          String(cA.stderr || '').split('\n')[0])
        ok('台帳: 同意したら、反論で維持として数えられなくなる',
          (apc().heldOver || 0) === 0,
          `**同意のほうが後の判断。両方が立っていると、どちらが結論か分からない。** ` +
          `反論で維持 ${apc().heldOver ?? '?'}`)
        ok('台帳: 同意の出力が、反論が在ったことを断っている',
          /反論の記録/.test(cA.stdout || ''),
          '**黙って上書きすると、反論した側から見て何が起きたか分からない。** ' +
          String(cA.stdout || '').replace(/\n/g, ' / ').slice(0, 160))
        {
          const sk = (rawOf().find(x => x.unitId === uc)?.skips || []).find(x => x.skip === A2)
          ok('台帳: 同意しても、2 周目の答えと反論の記録が台帳に残る',
            !!sk?.priorRecords?.second && !!sk?.priorRecords?.rebuttal,
            '**消すと「同意で片付いた 1 件」にしか見えなくなる。割れたことが残らない。** ' +
            JSON.stringify(Object.keys(sk?.priorRecords || {})))
          // **「残した記録が数に戻ってこない」という検査は置きませんでした。**
          // 書いてみて、逆対照が鳴らなかったからです（逆対照が鳴らなかったのはこれで 10 回目）。
          // 記録をわざと数えられる名前（node.rebuttal / node.hold）に戻しても、緑のままでした。
          // 理由は entryApproval の作りで、同意した断片は kind と verdict が一致するので
          // **`agrees` で「承認」を返して、その先の hold / rebuttal を見ないから**です。
          // つまりこの検査は、どこに何を置いても通る——**何も守っていない。**
          // 置いておくと「数に戻らないことは検査済み」という誤った安心だけが残るので、外します。
        }

        // ── B: 本人待ち → 同意 ────────────────────────────────────
        toSplit(kB, B2)
        rc('ledger.mjs', ['rebut', 'req->bd', kB, JSON.stringify(
          { expect: `${B2} の値が下位に在ること`,
            why: `原文「${B2.slice(0, 10)}」は幅を固定することを課している` })])
        const hB = rc('ledger.mjs', ['hold', 'req->bd', kB, '--why',
          `${B2} が割れており、枠組みの宣言か要求かで判断が分かれる`])
        ok('smoke: 本人待ちを作れた', hB.status === 0 && (apc().waiting || 0) === 1,
          `本人待ち ${apc().waiting ?? '?'}  ` + String(hB.stderr || '').split('\n')[0])

        const cB = rc('ledger.mjs', ['concede', 'req->bd', kB, '--why',
          `${B2} 幅の具体的な値は次の文が定めており、この一文は枠組みの宣言で下位へ降ろす要求を含まない`])
        ok('台帳: 本人待ちからも同意できる（本人の判断を台帳に入れられる）', cB.status === 0,
          '**本人が決めたのに入れる口が無いと、決定が台帳の外に置き去りになる。** ' +
          String(cB.stderr || '').split('\n')[0])
        ok('台帳: 同意したら本人待ちが終わる', (apc().waiting || 0) === 0,
          `**終わらないと、決まったものを待ち続けているように見える。** 本人待ち ${apc().waiting ?? '?'}`)
        ok('台帳: 同意の出力が、本人待ちの終わりを断っている',
          /本人待ちは終わり/.test(cB.stdout || ''),
          String(cB.stdout || '').replace(/\n/g, ' / ').slice(0, 160))
        {
          const sk = (rawOf().find(x => x.unitId === uc)?.skips || []).find(x => x.skip === B2)
          ok('台帳: 本人へ回した理由も台帳に残る',
            !!sk?.priorRecords?.hold && /割れており/.test(String(sk.priorRecords.hold.why || '')),
            '**本人が何を見て決めたのかが、決めたあとに消える。** ' +
            JSON.stringify(Object.keys(sk?.priorRecords || {})))
        }
        ok('台帳: 同意しても要求は台帳から消えない（対象外として残る）',
          (rawOf().find(x => x.unitId === uc)?.skips || []).length === 2,
          '**分母を自分で削っていないこと。** 要求から外すのではなく、理由つきの対象外へ移すだけ')
      }
    } finally { rmSync(C, { recursive: true, force: true }) }
  }

  mark('通し直しで要求が消えていないか')
  // ── 上位を直すと、分解からやり直しになる ────────────────────────────
  // 実測（2026-09-20）: 表の 1 行に限定を足して通し直したら、要求が 3 件 → 1 件になった。
  // 消えた 1 件は前回 `一致` が付いていたもので、新しい分解役はそこを
  // 「ラベル・項目名」として対象外にした。**文書は壊れていない。台帳の網が 1 目粗くなっただけ。**
  // だから誰も気づかない——気づいたのは、そのとき指示で控えていたからだった。
  //
  // **どれが消えたかは機械には決められない**（言い換えただけかもしれない）。
  // 決めるのは人で、**前後を必ず並べて出すところまで**を機械がやる。
  {
    const D = mkdtempSync(join(tmpdir(), 'claude-recut-'))
    try {
      mkdirSync(join(D, 'docs'), { recursive: true }); mkdirSync(join(D, '.claude'), { recursive: true })
      writeFileSync(join(D, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd' }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(D, 'docs/bd.md'),
        '# 基本設計\n\n## 1 画面\n\nミキサーパネルは非モーダルのドッキングパネルとして常時表示できる。\n')
      writeFileSync(join(D, 'docs/req.md'),
        '# 要件\n\n## 1 画面\n\nミキサー画面を備え、編集画面からモーダルで開けるようにする。\n')
      const rd = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: D, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: D } })
      const jd = r => { try { return JSON.parse(r.stdout) } catch { return null } }
      rd('split.mjs', ['--all']); rd('ledger.mjs', ['sync', 'req->bd'])
      const ud = (jd(rd('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
      ok('smoke: 通し直しの検査に使う単位が在る', !!ud, '**無いとこの節が黙って走らない**')
      if (ud) {
        rd('ledger.mjs', ['decompose', 'req->bd', ud, JSON.stringify([
          { text: 'ミキサー画面を備えること', from: 'ミキサー画面を備え' },
          { text: 'ミキサー画面を編集画面からモーダルで開けること', from: '編集画面からモーダルで開けるようにする' }])])
        const k0 = (jd(rd('ledger.mjs', ['show', 'req->bd', ud]))?.entries || [])[0]?.entryId
        rd('ledger.mjs', ['judge', 'req->bd', k0, '一致', JSON.stringify(
          { file: 'docs/bd.md', line: 5, quote: 'ミキサーパネルは非モーダルのドッキングパネルとして常時表示できる。' })])
        rd('ledger.mjs', ['plan', 'req->bd', k0, '上位を直す',
          '--why', 'ミキサー画面の提示形式が上位で曖昧なため上位を直す'])

        // **逆対照が先。** まだ通し直していないうちは何も出ないこと。
        const d0 = jd(rd('ledger.mjs', ['stale-diff', 'req->bd', '--json']))
        ok('台帳: 通し直していないうちは、減った単位として出ない', d0?.shrunk === 0,
          `**何もしていないのに出るなら、数えているのは別のもの。** 減った単位 ${d0?.shrunk ?? '?'} 件`)
        ok('台帳: 通し直していないうちは、入れ替わった単位としても出ない', d0?.replaced === 0,
          `入れ替わった単位 ${d0?.replaced ?? '?'} 件`)

        // 上位を直す → 陳腐化 → 分解し直す（前より 1 件少なく切る）
        writeFileSync(join(D, 'docs/req.md'),
          '# 要件\n\n## 1 画面\n\nミキサー画面を備え、編集画面からモーダルで開けるようにする（iPhone版の提示形式）。\n')
        rd('split.mjs', ['--all']); rd('ledger.mjs', ['sync', 'req->bd'])
        const ud2 = (jd(rd('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
        ok('smoke: 上位を直したら陳腐化して、分解し直す対象になる', !!ud2, `unitId=${ud2}`)

        // **通し直す前に「確認済み」にできないこと。**
        const ackEarly = rd('ledger.mjs', ['stale-diff', 'req->bd', '--ack', ud2, '--why', 'ミキサー画面の件は確認した'])
        ok('台帳: 通し直す前に確認済みにはできない',
          ackEarly.status !== 0 && /まだ分解し直していません/.test(String(ackEarly.stderr || '')),
          `**先に外せると、前後を見ないまま前の分解が消える。** ` + String(ackEarly.stderr || '').split('\n')[0])

        rd('ledger.mjs', ['decompose', 'req->bd', ud2, JSON.stringify([
          { text: 'iPhone版においてミキサー画面を編集画面からモーダルで開けること',
            from: '編集画面からモーダルで開けるようにする（iPhone版の提示形式）' },
          { skip: 'ミキサー画面を備え、', why: '原文「ミキサー画面を備え」は画面名のラベルであり要求ではない' }])])

        // ── ここが本体 ──────────────────────────────────────────────
        const d1 = jd(rd('ledger.mjs', ['stale-diff', 'req->bd', '--json']))
        ok('台帳: 通し直して要求が減った単位を出す',
          d1?.shrunk === 1 && d1?.droppedTotal === 1,
          `**減ったことに誰も気づかないのが、いちばん静かな壊れ方。** ` +
          `減った単位 ${d1?.shrunk ?? '?'} 件 / 要求 ${d1?.droppedTotal ?? '?'} 件ぶん`)
        // **逆対照を先に。** 本文を書き換えただけの通し直しには印が付かないこと。
        // これが無いと「全部に印を付ける」でも緑のままになる（実際、一度そうなった）。
        ok('台帳: 主題が同じ通し直しには、別の行という疑いの印を付けない',
          d1?.suspect === 0,
          `**付けすぎると、印そのものが読まれなくなる。** 疑い ${d1?.suspect ?? '?'} 件\n` +
          `    この単位は前も今も「ミキサー画面」の話で、語を共有している`)
        ok('台帳: 前に付いていた判定と分類も一緒に出す',
          d1?.prevAgreeInShrunk === 1 &&
          (d1?.rows || []).some(r => (r.prev || []).some(q => q.verdict === '一致' && q.plan === '上位を直す')),
          `**「前は一致だった」が見えないと、減ってよいのか判断できない。** ` +
          `前に一致 ${d1?.prevAgreeInShrunk ?? '?'} 件`)

        // ── 全件判定しても、前後を見比べるまで「完了」にしない ──────────
        // 実測（2026-09-23、turn 47）: req->bd は全件判定済みで「完了」と出ていたが、
        // 前後を見比べていない単位が 25 残っていた。完了の条件に入っていなかった。
        const k2 = (jd(rd('ledger.mjs', ['show', 'req->bd', ud2]))?.entries || []).find(x => x.as === '要求')?.entryId
        rd('ledger.mjs', ['judge', 'req->bd', k2, '一致', JSON.stringify(
          { file: 'docs/bd.md', line: 5, quote: 'ミキサーパネルは非モーダルのドッキングパネルとして常時表示できる。' })])
        const stR = (jd(rd('ledger.mjs', ['stats', '--json'])) || []).find(x => x.edge === 'req->bd')
        ok('台帳: 全件判定済みでも、前後を見比べていない単位があれば完了にしない',
          stR?.unjudged === 0 && stR?.state === '前後確認待ち' && stR?.recutPending === 1,
          `**分母から要求が黙って落ちたかを誰も見ていないのに「完了」と出していた。** ` +
          `未判定 ${stR?.unjudged ?? '?'} / 状態 ${stR?.state ?? '?'} / 見比べていない ${stR?.recutPending ?? '?'}`)

        // ── 確認済みにすると消える。ただし理由が要る ──────────────────
        const ackBad = rd('ledger.mjs', ['stale-diff', 'req->bd', '--ack', ud2, '--why', 'よい'])
        ok('台帳: 確認済みにする理由が短すぎるものを拒む',
          ackBad.status !== 0 && /理由が不十分/.test(String(ackBad.stderr || '')),
          String(ackBad.stderr || '').split('\n')[0])
        const ackOk = rd('ledger.mjs', ['stale-diff', 'req->bd', '--ack', ud2,
          '--why', 'ミキサー画面を備えることは新しい要求に畳み込まれたと確認した'])
        ok('台帳: 理由を付ければ確認済みにできる', ackOk.status === 0, String(ackOk.stderr || '').split('\n')[0])
        const d2 = jd(rd('ledger.mjs', ['stale-diff', 'req->bd', '--json']))
        ok('台帳: 確認済みにしたら一覧から消える', d2?.shrunk === 0,
          `**消えないと、毎回同じものを読み直すことになって誰も読まなくなる。** ` +
          `減った単位 ${d2?.shrunk ?? '?'} 件`)
        const stA = (jd(rd('ledger.mjs', ['stats', '--json'])) || []).find(x => x.edge === 'req->bd')
        ok('台帳: 見比べて確認済みにしたら完了になる',
          stA?.state === '完了' && stA?.recutPending === 0,
          `**逆対照。確認しても完了にならないなら、止めているのは別の条件。** 状態 ${stA?.state ?? '?'}`)

        // ── 前の記録が「別の行のもの」であることに印が付くか ──────────
        // 実測（2026-09-20）: 16 件のうち 8 件で前の分解が隣の行のものだった。
        // `staleAt` が 8 件とも 2026-09-16T23:45:57 に揃っていて、
        // **陳腐化の連鎖を直す前日**——表に 1 行増えて以降がずれた事故の残り。
        // そのまま読むと「消えた要求」を多く見積もる。
        //
        // 直前の逆対照が効いている: いま `--ack` した行 170 相当の 1 件は
        // 主題（ミキサー画面）を共有しているので**印が付かなかった**。
        // ここでは主題ごと入れ替えて、**付くほう**を見る。
        writeFileSync(join(D, 'docs/req.md'),
          '# 要件\n\n## 1 画面\n\nテンポは1分あたり40から240までの範囲で指定できるようにする。\n')
        rd('split.mjs', ['--all']); rd('ledger.mjs', ['sync', 'req->bd'])
        const ud3 = (jd(rd('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])[0]
        if (ud3) {
          rd('ledger.mjs', ['decompose', 'req->bd', ud3, JSON.stringify([
            { text: 'テンポを1分あたり40から240まで指定できること',
              from: 'テンポは1分あたり40から240までの範囲で指定できるようにする' }])])
        }
        const d3 = jd(rd('ledger.mjs', ['stale-diff', 'req->bd', '--json']))
        ok('台帳: 数が同じでも、前の文が今に無い単位を出す',
          d3?.shrunk === 0 && d3?.replaced === 1 && d3?.lostInReplaced === 1,
          `**減った単位しか並べないと、入れ替わった単位は誰も読まない。** ` +
          `減った ${d3?.shrunk ?? '?'} / 入れ替わった ${d3?.replaced ?? '?'} / 前の要求 ${d3?.lostInReplaced ?? '?'} 件`)
        const sus = (d3?.rows || []).filter(x => x.suspect)
        ok('台帳: 前の記録が別の行のものである疑いに印が付く',
          (d3?.suspect || 0) >= 1 && sus.length >= 1,
          `**印が無いと、隣の行の記録を「消えた要求」として数えてしまう。** ` +
          `疑い ${d3?.suspect ?? '?'} 件`)

        // ── 回ごとにまとめて畳めること ────────────────────────────────
        // 実測（2026-09-20）: 語の共有で付ける「疑い」の印は **取りこぼす**。
        // 事故は 23 単位だったのに、印が付いたのは 16 件だけだった。
        // `staleAt` は**同じ sync の回なら完全に一致する**ので、当て推量ではない。
        // ただし**まとめて畳むのは 1 件ずつ見ていないということ**なので、
        // 記録に残し、報告でも別に数える。
        const atOf = (d3?.rows || [])[0]?.staleAt
        ok('smoke: 陳腐化した時刻が記録されている', !!atOf,
          `**無いと回ごとにまとめられない。** staleAt=${JSON.stringify(atOf ?? null)}`)
        if (atOf) {
          const bBad = rd('ledger.mjs', ['stale-diff', 'req->bd', '--ack-batch', atOf, '--why', '連鎖の残り'])
          ok('台帳: まとめて畳む理由が不十分なものを拒む',
            bBad.status !== 0 && /理由が不十分/.test(String(bBad.stderr || '')),
            `**1 件ずつ見ていないことを記録に残すための理由なので、短いものは受けない。** ` +
            String(bBad.stderr || '').split('\n')[0])
          const bOk = rd('ledger.mjs', ['stale-diff', 'req->bd', '--ack-batch', atOf,
            '--why', `${atOf.slice(0, 10)} の陳腐化の連鎖で、この回の単位に付いている前の分解は隣の行のものである`])
          ok('台帳: 回ごとにまとめて畳める', bOk.status === 0, String(bOk.stderr || '').split('\n')[0])
          const d4 = jd(rd('ledger.mjs', ['stale-diff', 'req->bd', '--json']))
          ok('台帳: まとめて畳んだ件数を、別に数えて出す',
            (d4?.batched || 0) >= 1,
            `**まとめて畳んだものと、1 件ずつ見たものを混ぜない。** ` +
            `まとめて ${d4?.batched ?? '?'} 件`)
          ok('台帳: まとめて畳んだら一覧から消える', (d4?.rows || []).every(x => x.staleAt !== atOf),
            `**消えないと、毎回同じものを読み直すことになる。**`)
        }
      }
    } finally { rmSync(D, { recursive: true, force: true }) }
  }

  mark('行の挿入で陳腐化が連鎖しないか')
  // ── 表の途中に 1 行足したとき ────────────────────────────────────────
  // 単位 id は**本文のハッシュ**なので、行が動いても変わらない。
  // ところが sync が「id で拾えなければ anchor（節内の出現順）で拾う」を
  // **1 行ずつ交互に**やっていたため、挿入された行が**次の行の anchor を
  // 先に取り**、取られた行はさらに次へ流れた。
  // **1 行の挿入が、以降の行を全部「本文が変わった」に落とす。**
  //
  // 実測（2026-09-17）: 表に 1 行挿入して、本文が変わっていない 22 行まで
  // 作り直しになった（想定 8 件 → 実際 24 件）。
  {
    const V = mkdtempSync(join(tmpdir(), 'claude-anchor-'))
    try {
      mkdirSync(join(V, 'docs'), { recursive: true }); mkdirSync(join(V, '.claude'), { recursive: true })
      writeFileSync(join(V, '.claude/project.json'), JSON.stringify({
        vcs: 'none',
        tiers: [
          { id: 'req', name: '要件', sources: ['docs/req.md'], extractor: 'markdown' },
          { id: 'bd', name: '基本設計', sources: ['docs/bd.md'], extractor: 'markdown' },
        ],
        edges: [{ kind: 'down', from: 'req', to: 'bd' }],
        paths: { code: [], stubTargets: [], goalScope: [], requirements: 'docs/req.md', crossReference: 'docs/bd.md' },
      }, null, 2))
      writeFileSync(join(V, 'docs/bd.md'), '# 基本設計\n\n## 1 方針\n\nあとで書く。\n')
      const TBL = ['# 要件', '', '## 1 一覧', '',
        '- 項目Aの内容を満たすこと。',
        '- 項目Bの内容を満たすこと。',
        '- 項目Cの内容を満たすこと。',
        '- 項目Dの内容を満たすこと。',
        '- 項目Eの内容を満たすこと。', '']
      const run = (script, a) => spawnSync(NODE, [join(HERE, script), ...a],
        { cwd: V, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: V } })
      const syncJson = () => { const r = run('ledger.mjs', ['sync', 'req->bd', '--json']);
        try { return JSON.parse(r.stdout)[0] } catch { return null } }

      writeFileSync(join(V, 'docs/req.md'), TBL.join('\n'))
      run('split.mjs', ['--all']); syncJson()
      const before = jsonOf(run('ledger.mjs', ['pending', 'req->bd', '--json']))
      ok('smoke: 挿入の検査に使う表の単位が在る', (before?.units || 0) >= 5,
        `単位 ${before?.units ?? '?'} 件。**5 行に満たないと連鎖が起きず空振りする**`)

      // 真ん中に 1 行足す
      const ins = [...TBL]
      ins.splice(5, 0, '- 項目Xの内容を満たすこと。')
      writeFileSync(join(V, 'docs/req.md'), ins.join('\n'))
      run('split.mjs', ['--all'])
      const sy = syncJson()
      ok('台帳: 行を挿入しても、本文が変わっていない行は陳腐化しない',
        sy?.staled === 0 && sy?.added === 1 && sy?.carried >= 5,
        `**挿入した 1 行だけが新規であるべき。** 実際: 引き継ぎ ${sy?.carried} / 陳腐化 ${sy?.staled} / 新規 ${sy?.added}\n` +
        `    連鎖すると、本文が変わっていない行まで分解と承認をやり直すことになる`)

      // **本文が変わったときは、ちゃんと陳腐化すること。**（絞り込みすぎの逆対照）
      const edited = [...ins]
      edited[6] = '- 項目Bの内容を満たすこと。ただし例外がある。'
      writeFileSync(join(V, 'docs/req.md'), edited.join('\n'))
      run('split.mjs', ['--all'])
      const sy2 = syncJson()
      ok('台帳: 本文が変わった行は陳腐化する',
        sy2?.staled === 1 && sy2?.added === 0,
        `**連鎖を止めたつもりで、変化の検出まで消していないか。** ` +
        `実際: 引き継ぎ ${sy2?.carried} / 陳腐化 ${sy2?.staled} / 新規 ${sy2?.added}`)
    } finally { rmSync(V, { recursive: true, force: true }) }
  }

  mark('台帳の同時書き込み')
  // ── 同時に書いても変更が消えないか ────────────────────────────────────
  // decompose / judge / approve はどれも jsonl を丸ごと読んで丸ごと書き戻す。
  // 排他が無いと、同時に走った 2 つのうち**後に書いたほうが前の変更を消す。**
  // 実測（2026-09-16）: 20 件を同時に approve して、**3 件しか残らなかった。**
  //
  // decompose でこれが表に出なかったのは、coverage が未分解が無くなるまで
  // 回し続けるので**消えた分を勝手に拾い直していた**から。ループが不具合を隠していた。
  {
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    for (const cand of (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])) {
      const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
      if (!v?.text) continue
      const S4 = String(v.text), h4 = Math.floor(S4.length / 2)
      const A4 = S4.slice(0, h4).trim(), B4 = S4.slice(h4).trim()
      const r4 = sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
        [{ text: `${A4} を満たすこと`, from: A4 }, { text: `${B4} を満たすこと`, from: B4 }])])
      if (r4.status !== 0) sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
        [{ skip: S4, why: `原文「${S4.slice(0, 20)}」は同時書き込みの検査のため対象外とする` }])])
    }
    const targets = (jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all']))?.entries || [])
    ok('smoke: 同時書き込みの検査に使える断片が在る', targets.length >= 4,
      `未承認 ${targets.length} 件。**足りないとこの節が黙って空振りする**`)
    if (targets.length >= 4) {
      const { spawn } = await import('node:child_process')
      const run = a => new Promise(res => {
        const c = spawn(NODE, [join(HERE, 'ledger.mjs'), ...a], {
          cwd: TMP, stdio: 'ignore',
          env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
        })
        c.on('exit', code => res(code))
        c.on('error', () => res(-1))
      })
      // **同時に投げる。** 1 つずつ待ったらこの検査は何も確かめない。
      await Promise.all(targets.map(t => run(['approve', 'req->bd', t.entryId, '要求でない',
        JSON.stringify({ why: `原文「${String(t.source).slice(0, 20)}」のこの部分についての判断`, kind: 'ラベル・項目名' })])))
      const after = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      ok('台帳: 同時に書いても変更が消えない', (after?.approval?.unseen ?? -1) === 0,
        `${targets.length} 件を同時に書いて、未承認 ${after?.approval?.unseen ?? '?'} 件（期待 0）\n` +
        `    **ここが 0 でないと、並列で回すたびに黙って記録が消える**`)
      ok('台帳: ロックファイルを残さない',
        !readdirSync(join(TMP, '.claude/coverage/edges')).some(f => f.endsWith('.lock') || f.includes('.tmp')),
        `残っているもの: ${readdirSync(join(TMP, '.claude/coverage/edges')).join(' ')}\n` +
        `    **残ると次のコマンドが待たされ続ける**`)
    }
  }

  // ── レビュー: 行がずれただけの hunk は判定を引き継ぐ ────────────────────
  {
    // 2 つの変更が別 hunk になるだけの距離を空ける（既定の文脈行は 3 行）。
    const loop = join(TMP, 'packages/core/src/loop.ts')
    const base = ['export class SetLoopCommand {',
      ...Array.from({ length: 14 }, (_, i) => `  // 行 ${i + 1}`),
      '  run(n: number): number { return n + 1 }', '}', ''].join('\n')
    writeFileSync(loop, base)
    git('add', '-A'); git('commit', '-q', '-m', 'base')

    // 末尾の 1 行だけを変える → hunk は 1 つ
    writeFileSync(loop, base.replace('return n + 1', 'return n + 2'))
    sh('diff-units.mjs', ['split'])
    const id0 = jsonOf(sh('diff-units.mjs', ['next', '1', '--json']))?.units?.[0]?.id
    if (id0) {
      sh('diff-units.mjs', ['verdict', id0, '問題なし',
        '{"reason":"SetLoopCommand の戻り値の調整のみで、呼び出し側の契約は変わらない"}'])
      // **離れた場所に 1 行足す** → 下の hunk は行番号だけがずれ、変更行は同一のまま
      writeFileSync(loop, base.replace('return n + 1', 'return n + 2')
                              .replace('export class SetLoopCommand {', 'export class SetLoopCommand {\n  // 先頭に足したコメント'))
      sh('diff-units.mjs', ['split'])
      const pend = jsonOf(sh('diff-units.mjs', ['pending', '--json']))
      ok('hunk: 行がずれただけの判定を引き継ぐ',
        !!pend && pend.units === 2 && pend.judged >= 1,
        pend ? `hunk ${pend.units} / 判定済 ${pend.judged}（v22 は @@ ヘッダごとハッシュしていたので 0 に戻った）` : '取得失敗')
    } else ok('hunk: 判定用の id を取れる', false)
  }

  // ── 分母の質（v23 で閉じた既知の弱点）─────────────────────────────────
  {
    // (a) 関数内のローカル変数を単位にしない
    mkdirSync(join(TMP, 'packages/core/src'), { recursive: true })
    writeFileSync(join(TMP, 'packages/core/src/api.ts'),
      'export class A {\n  private hidden = 1\n' +
      '  run(n: number): number { const total = n + 1; const tmp = total * 2; return tmp }\n}\n' +
      'export function f(x: number) { const local = x; return local }\n' +
      'const moduleLevel = 3\n')
    const cfgPath = join(TMP, '.claude/project.json')
    const orig = readFileSync(cfgPath, 'utf8')
    const c = JSON.parse(orig)
    c.tiers.push({ id: 'impl', name: '実装', sources: ['packages/**/api.ts'], extractor: 'ts-api' })
    // impl を **上位側** に置いたエッジを作る。sync は edge.from の段を分母にするので、
    // impl の単位が台帳にどう載るかを見るにはこの向きが要る（内容の正しさではなく件数の検査）。
    c.edges.push({ kind: 'down', from: 'bd', to: 'impl' }, { kind: 'across', from: 'impl', to: 'bd' })
    writeFileSync(cfgPath, JSON.stringify(c, null, 2))
    const r = jsonOf(sh('split.mjs', ['impl', '--json']))
    // **抽出モードを先に確かめる。** 正規表現フォールバックだとクラス名で修飾されず
    // private も検出されないので、この節の検査は全部「空振りの緑」になる。
    // 静かに弱くなるのが一番よくないので、モード自体を検査対象にする。
    ok('分母: TypeScript の AST で抽出できている', r?.mode === 'typescript-ast',
      `抽出モード: ${r?.mode ?? '不明'}。フォールバックだと private を internal にできず、` +
      `分母から外す仕組みが production でも効かない`)
    const names = (r?.unitList || []).map(u => u.text)
    ok('分母: 関数内のローカル変数を単位にしない',
      !!r && !names.some(n => ['total', 'tmp', 'local'].includes(n)),
      names.length ? `単位: ${names.join(' ')}` : '取得失敗')
    ok('分母: private メンバーを internal として印を付ける',
      (r?.unitList || []).some(u => u.text === 'A.hidden' && u.internal === true))
    // (a-2) コードの単位でも分解できるか。
    // **上位段がコードのエッジ（impl->ut）は、まだ一度も分解していない。**
    // 単位の本文はメソッド名なので、文書の行とは形がまるで違う。
    // 出どころ（from）を必須にした書式が、ここでも成り立つことを確かめる。
    sh('ledger.mjs', ['sync', 'impl->bd'])
    {
      const pi = jsonOf(sh('ledger.mjs', ['pending', 'impl->bd', '--json']))
      const cid = pi?.undecomposedIds?.[0]
      const cs = cid ? jsonOf(sh('ledger.mjs', ['show', 'impl->bd', cid])) : null
      ok('分母: コードの単位を取れる', !!cs?.text, `単位: ${cs?.text ?? '(取れない)'}`)
      if (cs?.text) {
        const r1 = sh('ledger.mjs', ['decompose', 'impl->bd', cid,
          JSON.stringify([{ text: `${cs.text} が公開されていること`, from: cs.text }])])
        ok('分母: コードの単位も新しい書式で分解できる', r1.status === 0,
          `${cs.text}\n    ${String(r1.stderr || '').split('\n')[0]}`)
        const r2 = sh('ledger.mjs', ['decompose', 'impl->bd', cid,
          JSON.stringify([{ text: `${cs.text} が公開されていること`, from: `${cs.text}存在しない` }])])
        ok('分母: コードの単位でも、原文に無い出どころは拒否される', r2.status !== 0,
          'メソッド名でも逐語照合が効いていること')
        // **④ の検査だけが理由で落ちる形。** from は原文に在るので ② は通る。
        // 要求の文が出どころをまったく含んでいないので、ここで落ちなければならない。
        const r3 = sh('ledger.mjs', ['decompose', 'impl->bd', cid,
          JSON.stringify([{ text: 'ネットワーク越しに同期できること', from: cs.text }])])
        ok('分母: 短い名前でも、出どころと無関係な要求は拒否される', r3.status !== 0,
          `語に分けられない断片（${cs.text}）を無条件に通すと、すり替えが素通りする`)
      }
    }
    sh('ledger.mjs', ['sync', 'impl->bd'])
    const pend = jsonOf(sh('ledger.mjs', ['pending', 'impl->bd', '--json']))
    ok('分母: internal を台帳に載せない',
      !!pend && pend.units > 0 && pend.units === (r?.unitList || []).filter(u => !u.internal && u.minReq > 0).length,
      pend ? `台帳 ${pend.units} 単位 / 抽出 ${(r?.unitList || []).length}（うち internal ${(r?.unitList || []).filter(u => u.internal).length}）` : '取得失敗')
    writeFileSync(cfgPath, orig)

    // (b) 言語指定の無いフェンスの中身を落とさない
    writeFileSync(join(TMP, 'docs/fence.md'),
      '# 図\n\n## 1 構成\n\n```\n[Webコア]\n└─ Windows上でビルド・実行可能\n（Mac不要）\n```\n')
    const c2 = JSON.parse(orig)
    c2.tiers.push({ id: 'fence', name: '図', sources: ['docs/fence.md'], extractor: 'markdown' })
    writeFileSync(cfgPath, JSON.stringify(c2, null, 2))
    const rf = jsonOf(sh('split.mjs', ['fence', '--json']))
    const texts = (rf?.unitList || []).filter(u => u.judge).map(u => u.text)
    ok('分母: 言語指定の無いフェンス内の要求を落とさない',
      texts.some(x => x.includes('Windows上でビルド')) && texts.some(x => x.includes('Mac不要')),
      `判定対象: ${texts.join(' / ') || '(なし)'}`)
    ok('分母: 図の罫線は判定対象にしない', !texts.some(x => /^[─│└┌]+$/.test(x)))

    // (b-2) mermaid の中身は図であって要求ではない。**構造で対象外にする。**
    // 実測: mermaid フェンス内 1,061 行が判定対象になり、「、」「切替」が区切りとして
    // 数えられて、図の 1 行に「最低 2 件に分解せよ」が出ていた。
    writeFileSync(join(TMP, 'docs/fence.md'),
      '# 図\n\n## 1 構成\n\n' +
      '```mermaid\nflowchart TD\n  EDIT1 -->|パネル表示切替| MIXER["ミキサーパネル(非モーダル)"]\n  subgraph UI["UI層（画面群、既存）"]\n  end\n```\n\n' +
      '## 2 要求\n\n編集ウィンドウからミキサーパネルを開けること。\n')
    const rmm = jsonOf(sh('split.mjs', ['fence', '--json']))
    const mmJudged = (rmm?.unitList || []).filter(u => u.judge).map(u => u.text)
    const mmSkipped = (rmm?.unitList || []).filter(u => u.judge === false && /図の記述/.test(u.skipReason || ''))
    ok('分母: mermaid の中身を判定対象にしない',
      !mmJudged.some(x => /subgraph|-->/.test(x)) && mmSkipped.length >= 3,
      `判定対象に残った図の行: ${mmJudged.filter(x => /subgraph|-->/.test(x)).join(' / ') || 'なし'} / 対象外にした行 ${mmSkipped.length}`)
    ok('分母: mermaid を外しても本文の要求は残る',
      mmJudged.some(x => x.includes('ミキサーパネルを開けること')),
      'フェンスごと落として本文まで消すのは別の穴')
    ok('分母: 対象外にした図の行も単位としては残る',
      (rmm?.unitList || []).some(u => /subgraph/.test(u.text)),
      '**消すのではなく理由つきで外す。** 消すと --coverage の全行の覆いが嘘になる')

    // (c) skipSections で「要求ではない節」を外せる
    writeFileSync(join(TMP, 'docs/meta.md'),
      '# 文書\n\n## 1 要求\n\nテンポは 20 から 300 の範囲で指定できる。\n\n' +
      '## 9 変更履歴\n\n2026-09-01 初版を作成し、あわせて章立てを見直した。\n')
    const c3 = JSON.parse(orig)
    c3.tiers.push({ id: 'meta', name: 'メタ', sources: ['docs/meta.md'], extractor: 'markdown',
                    skipSections: ['変更履歴'] })
    writeFileSync(cfgPath, JSON.stringify(c3, null, 2))
    const rm2 = jsonOf(sh('split.mjs', ['meta', '--json']))
    const judged = (rm2?.unitList || []).filter(u => u.judge).map(u => u.text)
    ok('分母: skipSections で対象外の節を外せる',
      judged.some(x => x.includes('テンポ')) && !judged.some(x => x.includes('初版')),
      `判定対象: ${judged.join(' / ') || '(なし)'}`)
    // **節ごと外すのは分母をまるごと消す操作。** 外した量が表に出ないと、
    // 外しすぎても「判定対象が少ない」としか見えず、気付けない。
    ok('分母: 節ごと外した量が数字で出る', (rm2?.sectionSkipped || 0) >= 1,
      `節ごと対象外 ${rm2?.sectionSkipped ?? '(出ていない)'} 単位`)
    ok('分母: どの節をどれだけ外したかが出る',
      Object.keys(rm2?.sectionSkippedBy || {}).some(k => /変更履歴/.test(k)),
      `内訳: ${JSON.stringify(rm2?.sectionSkippedBy || {})}`)
    const txt = sh('split.mjs', ['meta']).stdout || ''
    ok('分母: 節ごと外した量が既定の表示にも出る', /節ごと対象外/.test(txt),
      '--json を見た人しか気付けない、では見えたことにならない')
    writeFileSync(cfgPath, orig)
  }

  // ── split.mjs を import しても CLI が動かない ──────────────────────────
  {
    // **Windows の絶対パスをそのまま import() に渡さない。**
    // Node の ESM ローダは file:// URL を要求し、`C:\...` は protocol 'c:' として拒否される。
    // 治具が壊れていたせいで、split.mjs は無実なのに赤になっていた。
    const url = pathToFileURL(join(HERE, 'split.mjs')).href
    const r = spawnSync(NODE, ['--input-type=module', '-e',
      `import(${JSON.stringify(url)}).then(()=>process.stdout.write('QUIET'))`],
      { cwd: TMP, encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: TMP } })
    ok('split: import しても CLI を実行しない', (r.stdout || '').trim() === 'QUIET',
      'check-config が import した瞬間に split の CLI が呼び出し側の argv で動き、検査が丸ごと落ちた')
  }

  // ── state.mjs ───────────────────────────────────────────────────────
  ok('state: 未知の phase を拒否する', sh('state.mjs', ['phase', 'foo']).status !== 0,
    'v22 は {"phase":"foo"} で台帳もゴールも全部外れた')
  ok('state: phase test に理由を要求する', sh('state.mjs', ['phase', 'test']).status !== 0,
    '既存テストの書き換えを解禁する最も強い宣言')
  ok('state: 短い adhoc を拒否する', sh('state.mjs', ['adhoc', 'loop 修正']).status !== 0,
    '触ったファイルに言及していても、どの修正にも貼れる長さなら理由にならない')
  ok('state: 薄いゴールを拒否する',
    sh('state.mjs', ['goal', '--unit', 'x', '--goal', '直す',
                     '--verify-by', 'node .claude/scripts/verify.mjs が緑']).status !== 0,
      '「何が在る状態になれば完了か」が書けないゴールは、一番早く終わる基準に収束する')
  ok('state: 正当なゴールは通る',
    sh('state.mjs', ['goal', '--unit', 'テンポ', '--goal', 'setTempo が範囲外を拒否する状態',
                     '--verify-by', 'node .claude/scripts/verify.mjs が緑', '--edge', 'req->bd']).status === 0)

  // ── 水平展開 ────────────────────────────────────────────────────────
  ok('spread: 1 ファイルに絞った走査を拒否する',
    sh('spread.mjs', ['scan', 'SetTempoCommand', '--in', 'packages/core/src/tempo.ts']).status !== 0,
    '自分が直したファイルだけを数えても「他に同型は無い」とは言えない')
  ok('spread: 全体走査は通る', sh('spread.mjs', ['scan', 'class Set\\w+Command']).status === 0)
  {
    const sp = jsonOf(sh('spread.mjs', ['pending', '--json']))
    ok('spread: 複数ファイルにヒットしている', !!sp && sp.hits >= 2, sp ? `ヒット ${sp.hits}` : '取得失敗')
    const id = jsonOf(sh('spread.mjs', ['next', '1']))?.hits?.[0]?.id
    if (id) {
      ok('spread: 実在しない G 番号への繰越を拒否する',
        sh('spread.mjs', ['verdict', id, '繰越', '{"gapId":"G999","reason":"あとで対応するため"}']).status !== 0,
        'v22 は番号の形だけを見ていたので G999 でも通った')
      ok('spread: 実在する G 番号への繰越は通る',
        sh('spread.mjs', ['verdict', id, '繰越', '{"gapId":"G1","reason":"ループ再生の作業単位で対応するため"}']).status === 0)
    }
  }

  // ── レビューの分母 ──────────────────────────────────────────────────
  writeFileSync(join(TMP, 'packages/core/src/loop.ts'),
    'export class SetLoopCommand {\n  constructor(private from: number, private to: number) {}\n' +
    '  run(): number {\n    if (this.to <= this.from) throw new RangeError("loop")\n' +
    '    return this.from\n  }\n}\n')
  ok('diff-units: 差分を hunk に切れる', sh('diff-units.mjs', ['split']).status === 0)
  {
    const id = jsonOf(sh('diff-units.mjs', ['next', '1', '--json']))?.units?.[0]?.id
      || jsonOf(sh('diff-units.mjs', ['next', '1']))?.units?.[0]?.id
    if (id) {
      ok('diff-units: 汎用的な「問題なし」を拒否する',
        sh('diff-units.mjs', ['verdict', id, '問題なし', '{"reason":"特に問題ありません"}']).status !== 0)
    } else ok('diff-units: hunk を取れる', false, 'next の出力から id を取れなかった')
  }

  // ── hook 本体 ───────────────────────────────────────────────────────
  ok('gate: .claude/state への Bash 書き込みを拒否する',
    hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'echo "{}" > .claude/state/turn.json' } }).status === 2,
    'Edit/Write は permissions で止まるが、Bash はそこを通らない')
  ok('gate: --human を AI が打つのを拒否する',
    hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'node .claude/scripts/ledger.mjs judge req:bd x 一致 "{}" --human' } }).status === 2,
    '人が実物を見た印を AI が付けられると、印の意味が無くなる')
  ok('gate: 無関係な Bash は通す',
    hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'node .claude/scripts/status.mjs --no-verify' } }).status === 0)
  ok('gate: edge を含む台帳コマンドを誤ってブロックしない',
    hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'node .claude/scripts/ledger.mjs pending "req->bd" --file docs' } }).status === 0,
    '`->` をリダイレクトと誤読すると、この仕組みで最も頻度の高いコマンドが丸ごと止まる')
  // ── 書き込み判定は「区間ごと・対象を見て」────────────────────────────
  // 実機で見つかった誤検知: 「どこかにゲートのパス」かつ「どこかに rm」だけで
  // 止めていたため、検査結果を退避して後片付けする作業が落ちた。
  {
    const bash = c => hook('pre-tool', { tool_name: 'Bash', tool_input: { command: c } }).status
    ok('gate: ゲート外への rm を、同じ行にパス名があるだけで止めない',
      bash('echo .claude/scripts/foo.mjs; rm -f zzz_not_a_gate_file.txt') === 0,
      '実機で報告された誤検知。rm の対象はゲート外')
    ok('gate: 検査結果の退避と後片付けを止めない',
      bash('node .claude/scripts/verify.mjs > /tmp/out.txt; rm /tmp/out.txt') === 0,
      'この仕組み自身が求める作業（/migrate の手順）が落ちていた')
    ok('gate: ゲートの場所への rm は拒否する',
      bash('rm -f .claude/state/turn.json') === 2)
    ok('gate: ゲートの場所へのコピーは拒否する',
      bash('cp /tmp/x .claude/state/turn.json') === 2)
    ok('gate: ゲートの場所からの読み出しコピーは通す',
      bash('cp .claude/scripts/ledger.mjs /tmp/backup.mjs') === 0,
      '読み出しは書き込みではない')
    ok('gate: ゲートの場所への sed -i は拒否する',
      bash('sed -i s/a/b/ .claude/scripts/ledger.mjs') === 2)
    // 実機で踏んだ誤検知。置換式の中の .claude/ に反応し、書き込み先（docs/）を見ていなかった。
    ok('gate: sed の置換式に含まれるパスで誤検知しない',
      bash(`sed -i 's#old#.claude/scripts/check-tests.mjs#' docs/req.md`) === 0,
      '式はファイル名ではない。書き込み先は docs/req.md')
    ok('gate: sed -e でも置換式で誤検知しない',
      bash(`sed -i -e 's#a#.claude/state/x#' docs/req.md`) === 0)
    ok('gate: sed -e でも書き込み先がゲートなら拒否する',
      bash(`sed -i -e 's#a#b#' .claude/state/turn.json`) === 2)
    ok('gate: 設定を読むだけの node -e は通す',
      bash('node -e "require(\'./.claude/project.json\')"') === 0,
      '実機で報告された誤検知。設定を開いて確かめるのは、この仕組みが推奨している行為')
    ok('gate: 設定を書き換える node -e は拒否する',
      bash('node -e "require(\'fs\').writeFileSync(\'.claude/project.json\',\'{}\')"') === 2)
  }

  // ── 削除先を解決して判定する（綴りの列挙ではない）──────────────────────
  {
    const bash = c => hook('pre-tool', { tool_name: 'Bash', tool_input: { command: c } })
    const dec = c => { const r = bash(c); if (r.status === 2) return 'deny'
      try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision } catch { return 'pass' } }

    ok('削除: プロジェクト内の再帰削除は通す', dec('rm -rf node_modules') === 'pass',
      'git が戻せる範囲。ここを止めると実作業が死ぬ')
    ok('削除: OS の一時ディレクトリは通す', dec(`rm -f ${join(tmpdir(), 'out.txt')}`) === 'pass',
      'Windows では /tmp は OS の一時ディレクトリではない。実際の場所で試す')
    ok('削除: POSIX 表記の /tmp も通す', dec('rm -f /tmp/out.txt') === 'pass',
      'Bash から来るコマンドは Windows でも /tmp 表記。C:\\tmp と解決して確認を出していた')
    ok('削除: プロジェクト外は確認を出す', dec('rm -rf /var/lib/something') === 'ask')
    ok('削除: /tmp の名を借りて外へ出るのを許さない', dec('rm -rf /tmp/../etc') === 'ask',
      '前置き一致で守ろうとすると必ずこの穴が開く。.. を畳んでから判定する')
    ok('削除: 最上位は拒否する', dec('rm -rf /') === 'deny')
    // **綴りを変えても同じ扱いになること。** これが列挙方式では成立しなかった。
    ok('削除: フラグの順序を変えても同じ扱い', dec('rm -fr /') === 'deny',
      'v23 前半は rm -rf / だけを拒否し、rm -fr / は人が「はい」を押せた')
    ok('削除: 長いフラグでも同じ扱い', dec('rm --recursive --force /') === 'deny')
    ok('削除: 複合コマンドの中でも見る', dec('cd /tmp && rm -rf /') === 'deny')
    ok('削除: ホームそのものは拒否する', dec(`rm -rf ~`) === 'deny')
  }

  ok('gate: ゲートの場所への node -e を拒否する',
    hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'node -e "require(\'fs\').writeFileSync(\'.claude/state/verify.json\',\'{}\')"' } }).status === 2)
  ok('gate: レビューエージェントが台帳を読むのは通す',
    hook('pre-tool', { tool_name: 'Bash', agent_type: 'review',
      tool_input: { command: 'node .claude/scripts/diff-units.mjs pending "req->bd"' } }).status === 0,
    'レビューは読み取り専用だが、読み取りまで止めると判定そのものができなくなる')
  ok('gate: レビューエージェントの書き込みを拒否する',
    hook('pre-tool', { tool_name: 'Write', agent_type: 'review', tool_input: { file_path: join(TMP, 'packages/core/src/tempo.ts') } }).status === 2)
  // ── サブエージェントに、決める役の書き込みをさせない（turn 54 の越権）──────
  {
    const L = 'node .claude/scripts/ledger.mjs'
    const sub = (command, extra = {}) => hook('pre-tool', { tool_name: 'Bash', agent_id: 'a1b2c3', agent_type: 'general-purpose', tool_input: { command }, ...extra }).status
    const main = command => hook('pre-tool', { tool_name: 'Bash', tool_input: { command } }).status
    ok('gate: サブエージェントの rebut / concede / hold / sync / 分類を拒否する',
      [`${L} rebut "req->bd" "u#k1" '{}'`, `${L} concede "req->bd" "u#k1"`, `${L} hold "req->bd" "u#k1" --why x`,
       `${L} sync "req->bd"`, `${L} plan "req->bd" "u#k1" 下位を直す --why x`,
       `${L} approve "req->bd" "u#k1" 要求 '{}' && ${L} rebut "req->bd" "u#k2" '{}'`].every(c => sub(c) === 2),
      '**書き戻し役が台本に無い決着を打った（実測）。決めるのは本体か本人。**')
    ok('gate: サブエージェントのゴール設定（state.mjs）を拒否し、show は通す',
      sub('node .claude/scripts/state.mjs goal --unit x --goal y --verify-by z') === 2 &&
      sub('node .claude/scripts/state.mjs show') === 0)
    ok('gate: サブエージェントの正規の仕事（approve / settle / 読み取り）は通す',
      [`${L} approve "req->bd" "u#k1" 要求 '{"why":"hold の話ではない","expect":"x"}'`, `${L} settle "req->bd" "u#k1" 要求 '{}'`,
       `${L} approve-next "req->bd" 5`, `${L} ops --json`, `${L} decompose "req->bd" "u" '[]'`].every(c => sub(c) === 0),
      '**逆対照。正規の役まで止めると、ワークフローが回らなくなる。**')
    ok('gate: 本体の rebut は通す（分解した側の権利）', main(`${L} rebut "req->bd" "u#k1" '{}'`) === 0)
    ok('gate: agent_type だけでは止めない（本体を --agent で起動した場合）',
      hook('pre-tool', { tool_name: 'Bash', agent_type: 'design', tool_input: { command: `${L} sync "req->bd"` } }).status === 0,
      '**本体にも agent_type が付く起動方法がある。** それで本体の書き込みまで止めると、台帳が動かせなくなる')
    ok('gate: サブエージェントが _bridge/ を書くのを拒否する',
      hook('pre-tool', { tool_name: 'Write', agent_id: 'a1b2c3', tool_input: { file_path: join(TMP, '_bridge/from-cc.md') } }).status === 2 &&
      hook('pre-tool', { tool_name: 'Write', tool_input: { file_path: join(TMP, '_bridge/from-cc.md') } }).status === 0,
      '報告を書くのは本体。サブエージェントが書くと、本体の知らない報告が相手に届く（実測）')
    ok('gate: 本人コマンドを非対話で通す変数を、AI が付けて打つのを拒否する',
      main(`CLAUDE_LEDGER_ALLOW_NON_TTY=1 ${L} uphold "req->bd" "u#k1" --why x`) === 2)
  }
  // 書き戻し・取得・集計の役の指示に、役の範囲が必ず付いているか（静的）
  {
    const wf = n => readFileSync(join(HERE, '..', 'workflows', n), 'utf8')
    const chk = n => {
      const src = wf(n)
      const calls = src.split('await agent(').length - 1
      const guarded = (src.match(/await agent\(\s*ROLE_GUARD \+/g) || []).length
      // 承認役（schema つきで材料だけを見る役）だけは、コマンドを打たないので前置きが要らない
      const judges = (src.match(/parallel\(groups\.map\(g => \(\) => agent\(/g) || []).length
      return { calls, guarded, judges, haiku: /model: 'haiku'/.test(src) }
    }
    const a = chk('approve.js'), st = chk('settle.js')
    ok('workflow: コマンドを打つ役には、すべて役の範囲の前置きが付いている',
      a.guarded === a.calls && st.guarded === st.calls && a.guarded >= 5 && st.guarded >= 5 && !a.haiku && !st.haiku,
      `approve ${a.guarded}/${a.calls}（haiku ${a.haiku}）/ settle ${st.guarded}/${st.calls}（haiku ${st.haiku}）`)
    // v28 T1・T2: coverage.js にも同じ前置きを。判定・分解の役には「書くのは 1 回だけ」を
    const cv = chk('coverage.js'), cvSrc = wf('coverage.js')
    ok('workflow: coverage.js の一覧・集計の役に前置き、判定・分解の役に「書くのは 1 回だけ」、haiku なし（v28 T1・T2）',
      cv.guarded === cv.calls && cv.calls >= 3 && !cv.haiku &&
      /WRITE_GUARD\('judge'\)/.test(cvSrc) && /WRITE_GUARD\('decompose'\)/.test(cvSrc) &&
      /印は探す手がかりにすぎない/.test(cvSrc),
      `coverage ${cv.guarded}/${cv.calls}（haiku ${cv.haiku}）。**判定の役は下位を開いて読むので、読むだけと書いていないと直してしまう**`)
    ok('check-stubs: G 台帳の置き場所を決め打ちしない（v28 T6）',
      !/00_reference\.md §8\.1/.test(readFileSync(join(HERE, 'check-stubs.mjs'), 'utf8')))
  }
  ok('gate: 入力が壊れていたら止まる（pre-tool）',
    spawnSync(NODE, [HOOK, 'pre-tool'], { cwd: TMP, encoding: 'utf8', input: '{ broken',
      env: { ...process.env, CLAUDE_PROJECT_DIR: TMP } }).status === 2,
    'v22 は読めないと pass していたので、編集ガードが全部消えていた')

  // ── 塞いだ穴: turn.json を空にしても、git の実差分で捕まる ───────────
  {
    mkdirSync(join(TMP, '.claude/state'), { recursive: true })
    writeFileSync(join(TMP, '.claude/state/turn.json'), JSON.stringify({ created: [], edited: [], commands: [] }))
    const r = hook('stop', { last_assistant_message: '完了しました。' })
    ok('gate: turn.json を空にしても未コミットの変更を検知する', r.status === 2,
      'v22 はこれでコードを編集したターンが exit 0 で素通りした')
  }

  // ── 塞いだ穴: ゲートが自分で制御していない挙動を約束していた（2026-09）──
  // 連続 6 回目から「上限に達すると、このゲートは無効化されてターンが通ります」と告げていたが、
  // gate.mjs 自身は回数で通さず、実測では 20 回連続でも通らなかった（本人が Esc で中断）。
  // **振る舞いと文面を、同じ実行で確かめる。** どちらか片方だけ直すと赤になる。
  {
    const uvPath = join(TMP, '.claude/state/unverified.json')
    const saved = existsSync(uvPath) ? readFileSync(uvPath, 'utf8') : null
    writeFileSync(uvPath, JSON.stringify({ at: new Date().toISOString(), count: 30,
      reason: 'smoke', reasons: ['smoke'], edited: [] }))
    const r = hook('stop', { stop_hook_active: true, last_assistant_message: '完了しました。' })
    const said = String(r.stderr || '') + String(r.stdout || '')
    ok('gate: 連続 31 回目でも止める（回数では通さない）', r.status === 2,
      '回数で通すゲートは、失敗を繰り返せば通れるゲートになる')
    ok('gate: 止めるときに「通ります」「無効化」と約束しない', r.status === 2 && !/通ります|無効化/.test(said),
      '**自分が制御していない仕組みの挙動を、文面で約束しない。** 旧版は 6 回目から「無効化されて通ります」と告げていた')
    if (saved === null) { try { rmSync(uvPath) } catch { /* 無ければよい */ } } else writeFileSync(uvPath, saved)
  }

  // ── 塞いだ穴: 宣言した範囲を、書いたものと照合する ───────────────────
  // `--file` は検証される側が自分で選ぶ自由文で、ledger では単なる部分一致。
  // **狭く宣言すれば、分母の小さい（既に分解済みの）範囲で Stop を通せる。**
  // adhoc には「触ったファイルに言及すること」の検査があるのに、goal --file には無かった。
  {
    const cfgPath = join(TMP, '.claude/project.json')
    const orig = readFileSync(cfgPath, 'utf8')
    const c = JSON.parse(orig)
    c.tiers.push(
      { id: 'impl', name: '実装', sources: ['packages/*/src/**/*.ts'], exclude: ['**/*.test.ts'], extractor: 'ts-api' },
      { id: 'ut', name: '単体テスト', sources: ['packages/*/src/**/*.test.ts'], extractor: 'ts-test', idPrefix: 'UT-' })
    // **impl を「どの段の to にもなっていない段」にしない。**
    // 実際の project.json には dd->impl が在る。ここで impl が最上位になると、
    // 「最上位だけは上位側の編集を通す」規則に引っ掛かって、この検査が空振りする。
    c.edges.push({ kind: 'down', from: 'bd', to: 'impl' })
    c.edges.push({ kind: 'across', from: 'impl', to: 'ut' })
    writeFileSync(cfgPath, JSON.stringify(c, null, 2))

    const declare = (edge, file) => sh('state.mjs', ['goal',
      '--unit', 'ループ再生の単体テスト', '--goal', 'SetLoopCommand の単体テストが在る',
      '--verify-by', 'pnpm test', '--edge', edge, '--file', file])
    const stopErr = () => {
      const r = hook('stop', { last_assistant_message: 'テストを書きました。' })
      return String(r.stderr || '') + String(r.stdout || '')
    }

    git('add', '-A'); git('commit', '-q', '-m', 'base')
    writeFileSync(join(TMP, 'packages/core/src/loop.test.ts'),
      '// UT-LOOP: SetLoopCommand（ループ範囲）\n// 検証節: docs/bd.md §2\n\n' +
      "it('SetLoopCommand_開始小節_そのまま返す', () => {\n})\n")
    sh('split.mjs', ['impl']); sh('split.mjs', ['ut'])
    sh('ledger.mjs', ['sync', 'impl->ut'])

    // (1) 範囲を狭く宣言して、その外の実装のテストを書く → 止まる
    declare('impl->ut', 'tempo')
    ok('gate: 宣言範囲の外にある実装のテストを書いたら止まる',
      /範囲（--file/.test(stopErr()),
      'ここが通ると、分母を自分で小さくして「未分解 0」を作れる')

    // (2) 範囲を書いたものに合わせれば、この理由では止まらない
    declare('impl->ut', 'loop')
    ok('gate: 範囲が書いたものと合っていれば、この理由では止めない',
      !/範囲（--file/.test(stopErr()),
      '正しく宣言しているのに止まるなら、adhoc が既定の経路になる')

    // (3) 宣言した段の下位側を 1 つも書いていない → 止まる
    git('add', '-A'); git('commit', '-q', '-m', 'tests')
    writeFileSync(join(TMP, 'packages/core/src/loop.ts'),
      'export class SetLoopCommand {\n  constructor(private from: number) {}\n' +
      '  run(): number {\n    return this.from + 0\n  }\n}\n')
    declare('impl->ut', 'loop')
    ok('gate: 宣言した段と無関係なものだけを書いたら止まる',
      /下位側に当たるファイルを 1 つも書いていません/.test(stopErr()),
      '実装だけ書いて impl->ut を宣言すれば、テストの分母で Stop を通せてしまう')

    // (4) 下位側を 1 つでも書いていれば通す。
    //     テストを書くついでに実装を触るのは普通なので、全件を要求すると adhoc が既定になる。
    writeFileSync(join(TMP, 'packages/core/src/loop.test.ts'),
      '// UT-LOOP: SetLoopCommand（ループ範囲）\n// 検証節: docs/bd.md §2\n\n' +
      "it('SetLoopCommand_開始小節_そのまま返す', () => {\n  // 追記\n})\n")
    ok('gate: 下位側を 1 つでも書いていれば、この理由では止めない',
      !/下位側に当たるファイルを 1 つも書いていません/.test(stopErr()),
      'テストと実装を同じターンで触るのは普通の作業。ここで止めると逃げ道が既定の経路になる')

    let REQ_ORIG = ''
    // (4-b) **V 字の最上位（req）は、上位側を直すのがその段の作業。**
    //   実測（2026-09-16）: /ask の答えを要件定義書に反映するターンが 2 回続けて
    //   adhoc に落ちた。req を `to` に持つ段は無いので、**どの段を宣言しても
    //   「下位側を書いていない」で弾かれ、adhoc しか経路が無かった。**
    {
      // **commit しない。** ここで commit すると loop.ts / loop.test.ts の
      // 未コミット状態が消え、後続の検査が「編集なし」で素通りする。
      REQ_ORIG = readFileSync(join(TMP, 'docs/req.md'), 'utf8')
      writeFileSync(join(TMP, 'docs/req.md'), REQ_ORIG + '\n## 11 表示\n\n譜面は運指のまま表示する。\n')
      // **宣言が通ったことを確かめる。** 通らないと current.ledger が前の宣言
      // （impl->ut）のまま残り、**この検査は別の段を見て緑になる。**
      // 実際にそうなった: --goal が 10 文字未満で state.mjs に弾かれていたのに、
      // 戻り値を見ていなかったので気付けなかった。
      const gd = sh('state.mjs', ['goal',
        '--unit', '要件の未確定点を閉じる',
        '--goal', '要件定義書に未閉鎖の列挙が 1 件も残っていない状態',
        '--verify-by', 'node .claude/scripts/ledger.mjs ask "req->bd"',
        '--edge', 'req->bd', '--file', 'req.md'])
      ok('smoke: req->bd の宣言が通る', gd.status === 0, String(gd.stderr || '').split('\n')[0])
      const cur = JSON.parse(readFileSync(join(TMP, '.claude/state/current.json'), 'utf8'))
      ok('smoke: 宣言した段が req->bd になっている', cur?.ledger?.edge === 'req->bd',
        `**別の段のまま緑になっていないか。** 実際: ${JSON.stringify(cur?.ledger?.edge)}`)
      ok('gate: 最上位の文書を直すのは、その段の作業として通す',
        !/下位側に当たるファイルを 1 つも書いていません/.test(stopErr()),
        '**req を to に持つ段は無い。** ここで止めると adhoc しか経路が無くなる')
    }

    // (5) 承認が要る段は、承認を通すまで止まる。
    //     形の検査は「紐付けが嘘でないか」しか見ない。「そもそも要求か」は別の目でしか見えない。
    //     **既定では止めない**ので、ここでは requireApproval を立てて止まることを見る。
    {
      sh('split.mjs', ['impl']); sh('split.mjs', ['ut']); sh('ledger.mjs', ['sync', 'impl->ut'])
      const pu = jsonOf(sh('ledger.mjs', ['pending', 'impl->ut', '--json', '--file', 'loop']))
      const uid = (pu?.undecomposedIds || [])[0]
      ok('smoke: 承認で止める検査に使う実装の単位が在る', !!uid,
        `未分解 ${pu?.undecomposed ?? '?'} 件。**無いとこの節が黙って空振りする**`)
      if (uid) {
        const v = jsonOf(sh('ledger.mjs', ['show', 'impl->ut', uid]))
        const T = String(v?.text || '')
        const d = sh('ledger.mjs', ['decompose', 'impl->ut', uid,
          JSON.stringify([{ text: `${T} を単体テストで検証すること`, from: T }])])
        ok('smoke: 承認で止める検査の土台になる分解が通る', d.status === 0,
          String(d.stderr || '').split('\n')[0])

        declare('impl->ut', 'loop')
        ok('gate: 承認が要らない段は、未承認でも止めない',
          !/承認を通っていません/.test(stopErr()),
          '**既定で止めると、当たり方を測る前に作業が止まる。** 当たっていない警告は無視する癖をつける')

        const c2 = JSON.parse(readFileSync(cfgPath, 'utf8'))
        c2.edges.find(e => e.from === 'impl' && e.to === 'ut').requireApproval = true
        writeFileSync(cfgPath, JSON.stringify(c2, null, 2))
        declare('impl->ut', 'loop')
        ok('gate: 承認が要る段は、未承認のまま終われない',
          /承認を通っていません/.test(stopErr()),
          'ラベル・目的・経緯を要求として載せると、**水増しされた分母のまま固定される**')

        // **台帳しか動いていないターンでは止めない。**
        // 承認やワークフローを回すだけのターン（コードも設計書も触っていない）で止まると、
        // 「止まる → 直そうとする → また止まる」で**無人実行が夜通し空回りする。**
        // 逃がしているのではなく、分母の検査は「書いたターン」に掛けるものだから。
        git('add', '-A'); git('commit', '-q', '-m', 'ledger only')
        sh('ledger.mjs', ['pending', 'impl->ut', '--json'])
        ok('gate: 台帳しか動いていないターンは承認で止めない',
          !/承認を通っていません/.test(stopErr()),
          '**ここで止まると、無人で回したときに止まり続ける**')
      }
    }

    // ── 上位文書に**新しい**未確定点を持ち込んでいないか ──────────────
    //   実測で 2 回やられた形: 「等」を閉じるための答えのほうに「など」が入っていた
    //   （L80「DADGADやFAG・・・など」、L123「アーティスト名なども」）。
    //   ask-record は**答え**を見るが、**文書に実際に何が書かれたか**は見ていない。
    //
    //   **ここまでの検査がすべてコミット済みになった後に置く。** 前に置くと、
    //   ここで打つ commit が loop.ts の未コミット状態を消し、後続が素通りする
    //   （実際にそうなった）。
    {
      const reqPath = join(TMP, 'docs/req.md')
      const REQ_BEFORE = readFileSync(reqPath, 'utf8')
      // HEAD 側に「等」を 1 つ持たせる。**無いと「増えていない」側の検査が空振りする**
      //   ——実測で空振りした。個数で見ているつもりが、0 → 0 を見ていた。
      const withEnum = readFileSync(reqPath, 'utf8') + '\n## 13 書き出し\n\n書き出しはPDF等に対応する。\n'
      writeFileSync(reqPath, withEnum)
      git('add', '-A'); git('commit', '-q', '-m', 'req with enum')
      const headCount = (readFileSync(reqPath, 'utf8').match(/(など|等|その他|といった|のような)/g) || []).length
      ok('smoke: 比較の基になる「等」が HEAD に在る', headCount > 0,
        `**0 だと「増えていない」側の検査が空振りする。** 実際: ${headCount} 個`)

      writeFileSync(reqPath, withEnum + '\n## 14 音源\n\n対応する音源はSoundFontなどとする。\n')
      ok('gate: 上位文書に新しい未閉鎖の列挙を足したら止まる',
        /新しい未確定点/.test(stopErr()),
        '**閉じるための作業で新しく開くと差し引きゼロ。** 実測で 2 回すり抜けた形')

      // 個数が増えていなければ止めない。**行ごとに見ると、「等」を含む既存行を
      // 別の理由で触っただけで当たる**（過剰検出）。個数で見ているかをここで見る。
      writeFileSync(reqPath, withEnum.replace('書き出しはPDF等に対応する。', '書き出しはPDF等に対応すること。'))
      ok('gate: 個数が増えていなければ止めない',
        !/新しい未確定点/.test(stopErr()),
        '**「等」を含む行を触っただけで止まるなら、この検査は無視される側に回る**')

      // adhoc なら通る。**引用のように正当な場合があるから**で、通したことは残る。
      writeFileSync(reqPath, withEnum + '\n## 14 音源\n\n対応する音源はSoundFontなどとする。\n')
      sh('state.mjs', ['adhoc', '原文を引用するため docs/req.md に「など」を含む行を足す'])
      ok('gate: adhoc を宣言すれば未確定点の持ち込みを通す',
        !/新しい未確定点/.test(stopErr()),
        '逃げ道を塞ぐのではなく、**黙って通る道を塞ぐ**')

      // **元の req.md に戻して、分母も戻す。** 戻さないと、ここで足した節が
      // 後続（ワークフローの検査）の分母に混ざり、別の検査が赤くなる。実際になった。
      writeFileSync(reqPath, REQ_BEFORE)
      git('add', '-A'); git('commit', '-q', '-m', 'req restore')
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const left = jsonOf(sh('ledger.mjs', ['ask', 'req->bd', '--json']))
      ok('smoke: 検査に使った節を後始末できている',
        !(left?.groups || []).some(g => /SoundFont|書き出しはPDF等/.test(String(g.source || ''))),
        '**後始末を怠ると、次の検査が別の理由で赤くなる**')
    }

    writeFileSync(cfgPath, orig)
    rmSync(join(TMP, 'packages/core/src/loop.test.ts'), { force: true })
    rmSync(join(TMP, '.claude/coverage/edges/impl-ut.jsonl'), { force: true })
    git('add', '-A'); git('commit', '-q', '-m', 'cleanup')
  }

  mark('ワークフローの制御構造（coverage.js / audit.js）')
  // ── ワークフローの制御構造 ──────────────────────────────────────────
  // `.claude/workflows/coverage.js` は台帳を回す本体だが、Claude Code の Workflow
  // ツールでしか走らないので、直接は検査できない。そのために
  // `lib/workflow-sim.mjs`（偽のエージェントでワークフローを走らせる）が置いてある。
  //
  // **ところが、それを呼ぶ側が無かった。** 使い方には「selftest から」と書いてあるが、
  // selftest は v23 で smoke に置き換えられ、こちらからは一度も呼んでいなかった。
  // 台帳を回す本体が、v23 のあいだ**まったく検査されていなかった**ことになる。
  // 2026-09-15 に分解の書式を変えたときも、誰も気付かないまま壊れていた。
  //
  // ここで見るのは**制御構造**（失敗 ID の除外・ウィンドウ送り・件数の集計）であって、
  // 分解や判定の中身の質ではない。中身は上の ledger の節で見ている。
  {
    const simPath = join(HERE, 'lib', 'workflow-sim.mjs')
    const wf = join(HERE, '..', 'workflows', 'coverage.js')
    ok('workflow: シミュレータと coverage.js が在る', existsSync(simPath) && existsSync(wf))
    if (existsSync(simPath) && existsSync(wf)) {
      // 台帳を作り直してから回す。
      // **sync だけでは足りない。** sync は既存の分解を引き継ぐので、前の節（承認）で
      // 全単位を分解し終えていると未分解が 0 になり、**このワークフローの検査は
      // 「分解 0 件」で赤くなる**（実際にそうなった）。jsonl ごと消してから作り直す。
      rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const { runWorkflow } = await import(pathToFileURL(simPath).href)
      let res = null, err = null
      try {
        // runWorkflow は { result, calls, logs } を返す。result がワークフローの返り値。
        const raw = await runWorkflow(wf, { edge: 'req->bd', limit: 6, batch: 3 },
          { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
            scriptsDir: HERE })
        res = raw?.result || null
      } catch (e) { err = e }
      ok('workflow: coverage.js が最後まで走る', !err && !!res,
        err ? String(err && err.message).slice(0, 200) : '')
      ok('workflow: 分解が書き戻される', (res?.decomposed || 0) >= 1,
        `分解 ${res?.decomposed ?? '?'} 件 / 失敗 ${res?.failed?.decompose ?? '?'} 件\n` +
        `    **ここが 0 なら、偽のエージェントの書式が本物と食い違っている**（書式を変えたのに\n` +
        `    シミュレータを直していない、が典型）。制御構造の検査が書式エラーの検査に化ける`)
      ok('workflow: 書き戻しの失敗が握り潰されない', (res?.failed?.decompose || 0) === 0,
        `失敗 ${res?.failed?.decompose ?? '?'} 件: ${JSON.stringify(res?.failures?.slice(0, 1) || [])}`)

      // 失敗する ID を混ぜたとき、**除外して先へ進む**（同じ ID で無限に粘らない）。
      // 上の走行で分解済みになっているので、台帳を作り直してから回す。
      // sync は既存の分解を引き継ぐので、jsonl を消してからでないと未分解が 0 のまま。
      rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
      sh('ledger.mjs', ['sync', 'req->bd'])
      const pd = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
      const bad = new Set((pd?.undecomposedIds || []).slice(0, 2))
      ok('smoke: 失敗ケースに使う未分解の単位が在る', bad.size === 2,
        `未分解 ${pd?.undecomposed ?? '?'} 件。**0 だとこの節が黙って空振りする**`)
      let res2 = null
      try {
        const raw2 = await runWorkflow(wf, { edge: 'req->bd', limit: 6, batch: 3 },
          { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
            scriptsDir: HERE, failIds: bad })
        res2 = raw2?.result || null
      } catch { /* 落ちたら下で赤になる */ }
      ok('workflow: 書き戻しに失敗した単位を除外して先へ進む',
        !!res2 && (res2.failed?.decompose || 0) === bad.size && (res2.decomposed || 0) >= 1,
        `失敗 ${res2?.failed?.decompose ?? '?'}（期待 ${bad.size}）/ 分解 ${res2?.decomposed ?? '?'}\n` +
        `    同じ ID を延々と拾い直すと、1 件の失敗でワークフローが終わらなくなる`)
      ok('workflow: 失敗した単位が報告に残る',
        (res2?.failures || []).length >= 1 && res2?.status === 'partial',
        `status=${res2?.status} / failures=${(res2?.failures || []).length}\n` +
        `    **失敗を握り潰して complete と報告するのが、いちばん質の悪い型**`)


      // ── approve.js（承認の本体）──────────────────────────────────────
      // 承認は「1 断片ずつ独立に、下位を開かずに答える」ことが前提なので、
      // **同じ単位から切り出された断片を同じ呼び出しに混ぜてはいけない。**
      // 混ざると隣の答えが次に効き、独立という前提が黙って崩れる。
      const wfP = join(HERE, '..', 'workflows', 'approve.js')
      ok('workflow: approve.js が在る', existsSync(wfP))
      if (existsSync(wfP)) {
        // 役の定義そのものを見る。**ここにファイル系のツールが入ると前提が消える。**
        const aprMd = readFileSync(join(HERE, '..', 'agents', 'approver.md'), 'utf8')
        const toolsLine = (aprMd.match(/^tools:\s*(.*)$/m) || [])[1] || ''
        // **この検査は「書いてある値」しか見ていなかった。**
        // 実測（2026-09-20）: `tools: TodoWrite` はこの条件を満たすので緑のままだったが、
        // 実機では `TodoWrite` が解決できず **ツール 0 個のエージェントになって起動を拒否された**
        // （`Agent 'approver' would be spawned with zero tools — refusing.`）。
        // 役が起動できないので、承認は汎用エージェントに文面で制約を渡す形に落ちた——
        // **道具で保証していた隔離が、文面のお願いに落ちた。**
        //
        // ツールが 1 つだけの役は、その 1 つが解決できなかった瞬間に 0 個になる。
        // 名前を綴りで検査しても「実機で解決できるか」は分からないので、
        // **実機で動いている他の役が使っている名前に限る**という形にした。
        // `Glob` はファイル名の一覧しか返さず、下位文書の中身は読めない。
        ok('承認: 役の定義にファイルの中身を読むツールが入っていない',
          !!toolsLine.trim() && !/\b(Read|Grep|Bash|Edit|Write)\b/.test(toolsLine),
          `tools: ${JSON.stringify(toolsLine)}\n` +
          `    **下位を開けるツールがあると「下位に無いものだけが要求でない」に落ちる。**`)
        ok('承認: 役のツールが、実機で動いている他の役も使っている名前だけになっている',
          toolsLine.split(',').map(x => x.trim()).filter(Boolean).length === 1 &&
          /^\s*Glob\s*$/.test(toolsLine),
          `tools: ${JSON.stringify(toolsLine)}\n` +
          `    **空にも、綴りだけ無害な名前にもできない。** 0 個になると起動が拒否され、\n` +
          `    承認が汎用エージェントに落ちて隔離が消える（実測）。\n` +
          `    変えるなら、その名前で実際に役が起動することを確かめてから変えること`)

        rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
        sh('ledger.mjs', ['sync', 'req->bd'])
        // まず分解する（承認の対象を作る）
        for (const cand of (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])) {
          const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
          if (!v?.text) continue
          const S2 = String(v.text), h2 = Math.floor(S2.length / 2)
          const A2 = S2.slice(0, h2).trim(), B2 = S2.slice(h2).trim()
          let r2 = sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
            [{ text: `${A2} を満たすこと`, from: A2 }, { text: `${B2} を満たすこと`, from: B2 }])])
          if (r2.status !== 0) sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
            [{ skip: S2, why: `原文「${S2.slice(0, 20)}」は承認の検査のため対象外として記録する` }])])
        }
        const pa0 = jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))
        ok('smoke: 承認ワークフローに回す断片が在る', (pa0?.approval?.unseen || 0) >= 3,
          `未承認 ${pa0?.approval?.unseen ?? '?'} 件。**0 だとこの節が黙って空振りする**`)

        let resP = null, errP = null, callsP = []
        try {
          const rawP = await runWorkflow(wfP, { edge: 'req->bd', batch: 3 },
            { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
              scriptsDir: HERE })
          resP = rawP?.result || null; callsP = rawP?.calls || []
        } catch (e) { errP = e }
        ok('workflow: approve.js が最後まで走る', !errP && !!resP,
          errP ? String(errP && errP.message).slice(0, 200) : '')
        // **件数は台帳から見る。** ワークフローの自己申告（attempted）は「試した数」で、
        // 実際に台帳へ入った数ではない。混ぜると、1 件も書けていないのに緑になる。
        ok('workflow: 承認が実際に台帳へ入る', (resP?.ledger?.ok || 0) >= 3,
          `台帳の承認 ${resP?.ledger?.ok ?? '?'} 件 / 試した ${resP?.attempted ?? '?'} 件 / 失敗 ${resP?.failed ?? '?'} 件\n` +
          `    **ここが 0 なら、判定はできても書き戻せていない**（実機で踏んだ型）`)
        ok('workflow: 件数は台帳から取る（自己申告ではない）', (resP?.ledger?.entries || 0) >= 3,
          `台帳の断片 ${resP?.ledger?.entries ?? '?'} 件`)
        ok('workflow: 未承認が残っていない', (resP?.ledger?.unseen ?? -1) === 0,
          `未承認 ${resP?.ledger?.unseen ?? '?'} 件`)

        // **1 呼び出しに同じ単位の断片が 2 つ入っていないこと。**
        // v35：既定は 1 体 10 断片まで、受け先（ファイルと節）ごと（本人の案 2026-10-01）。
        // 断片は呼び出しの本文の JSON から取る（ラベルの +n では、混ざった単位や節が分からない）
        const perCall = callsP.filter(c => /^apr:/.test(c.label || ''))
        const ok35 = perCall.map(c => groupsOfCall(c)).filter(Boolean)
        // v36：同じファイルの隣り合う短い節はつなぐ（ファイルはまたがない）
        ok('workflow: 承認の 1 呼び出しは 10 断片まで・同じ単位を混ぜない・ファイルをまたがない（v36 の既定）',
          perCall.length >= 2 && ok35.length === perCall.length && ok35.every(g => g.n >= 1 && g.n <= 10 && g.units === g.n && g.files === 1) &&
            ok35.some(g => g.n >= 2),   // 既定で 1 体に複数渡している（v34 までの 1 件ずつでは赤）
          `呼び出し ${perCall.length} 件 / 中身 ${JSON.stringify(ok35.slice(0, 6))}`)

        // **承認する側にコマンドを渡していないこと。**
        // 承認は「下位を開かない」が前提で、そのために approver からファイル系のツールを
        // 外してある。外すと自分では書き戻せないので、取得と書き戻しは親がやる。
        // ここで承認する側のプロンプトにコマンドが載っていたら、その前提が崩れている
        // （実機で全 20 件が「No such tool available: Bash」で落ちた型）。
        // **body（全文）を見る。** prompt は頭 80 字しか無く、
        // それで見ていたせいでこの逆対照は一度空振りした。
        const aprPrompts = callsP.filter(c => /^apr:/.test(c.label || '')).map(c => String(c.body || ''))
        ok('workflow: 承認する側にコマンドを実行させていない',
          aprPrompts.length >= 3 && aprPrompts.every(p2 => !/ledger\.mjs/.test(p2)),
          '**ツールを持たない役にコマンドを渡すと、判定はできても 1 件も書き戻せない**')
        // **一度に取る件数に上限があること。**
        // approve-next は断片の本文ごと返すので、件数を大きくすると payload が肥大し、
        // 受け渡しの途中で切れる（8,000 断片ある段では数 MB になる）。
        const fetchCounts = callsP.filter(c => /^fetch:/.test(c.label || ''))
          .flatMap(c => [...String(c.body || '').matchAll(/approve-next\s+\S+\s+(\d+)/g)].map(m => Number(m[1])))
        ok('workflow: 一度に取る断片の件数に上限がある',
          fetchCounts.length >= 1 && fetchCounts.every(n => n <= 200),
          `要求した件数: ${fetchCounts.join(' ')}\n` +
          `    **上限が無いと、断片が数千ある段で payload ごと切れる**`)
        ok('workflow: 取得と書き戻しを親が別のエージェントにやらせている',
          callsP.some(c => /^fetch:/.test(c.label || '')) && callsP.some(c => /^write:/.test(c.label || '')),
          `fetch/write の呼び出しが要る: ${callsP.map(c => c.label).join(' ')}`)

        // **予算（limit）で打ち切ったとき、最後のラウンドの成功を失敗と数えないこと。**
        // ループを抜けた時点の一覧は書き戻しより「前」に取ったものなので、
        // それをそのまま使うと最後のラウンドが丸ごと失敗に見える
        // （実機で 7 件の失敗のうち 3 件が、実際には承認が入っていた）。
        {
          rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
          sh('ledger.mjs', ['sync', 'req->bd'])
          for (const cand of (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])) {
            const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
            if (!v?.text) continue
            const S3 = String(v.text), h3 = Math.floor(S3.length / 2)
            const A3 = S3.slice(0, h3).trim(), B3 = S3.slice(h3).trim()
            const r3 = sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
              [{ text: `${A3} を満たすこと`, from: A3 }, { text: `${B3} を満たすこと`, from: B3 }])])
            if (r3.status !== 0) sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
              [{ skip: S3, why: `原文「${S3.slice(0, 20)}」は承認の検査のため対象外として記録する` }])])
          }
          const avail = (jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all', '--ids-only']))?.ids || []).length
          ok('smoke: 予算切れの検査に使える未承認が在る', avail >= 4,
            `未承認 ${avail} 件。**足りないとこの節が黙って空振りする**`)
          let resQ = null
          try {
            const raw = await runWorkflow(wfP, { edge: 'req->bd', batch: 2, limit: 2 },
              { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
                scriptsDir: HERE })
            resQ = raw?.result || null
          } catch { /* 下で赤になる */ }
          ok('workflow: 予算切れで止めても、成功を失敗と数えない',
            !!resQ && (resQ.failed || 0) === 0 && (resQ.attempted || 0) === 2,
            `失敗 ${resQ?.failed ?? '?'}（期待 0）/ 試した ${resQ?.attempted ?? '?'}（期待 2）\n` +
            `    **ここが 0 でないと、予算で区切って回すたびに偽の失敗が積み上がる**`)
        }

        // 失敗 ID を混ぜても、除外して先へ進む（同じ ID で無限に粘らない）。
        rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
        sh('ledger.mjs', ['sync', 'req->bd'])
        for (const cand of (jsonOf(sh('ledger.mjs', ['pending', 'req->bd', '--json']))?.undecomposedIds || [])) {
          const v = jsonOf(sh('ledger.mjs', ['show', 'req->bd', cand]))
          if (!v?.text) continue
          const S2 = String(v.text), h2 = Math.floor(S2.length / 2)
          const A2 = S2.slice(0, h2).trim(), B2 = S2.slice(h2).trim()
          let r2 = sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
            [{ text: `${A2} を満たすこと`, from: A2 }, { text: `${B2} を満たすこと`, from: B2 }])])
          if (r2.status !== 0) sh('ledger.mjs', ['decompose', 'req->bd', cand, JSON.stringify(
            [{ skip: S2, why: `原文「${S2.slice(0, 20)}」は承認の検査のため対象外として記録する` }])])
        }
        const idsP = (jsonOf(sh('ledger.mjs', ['approve-next', 'req->bd', 'all', '--ids-only']))?.ids || [])
        const badP = new Set(idsP.slice(0, 1))
        const disP = new Set(idsP.slice(1, 2))
        const wfailP = new Set(idsP.slice(2, 3))   // 台帳側に弾かれる判定を返す断片
        const btP = new Set(idsP.slice(3, 4))      // 理由文にバッククォートが混ざる断片
        ok('smoke: 失敗ケースと食い違いケースの断片が在る',
          badP.size === 1 && disP.size === 1 && wfailP.size === 1 && btP.size === 1,
          `未承認 ${idsP.length} 件。**足りないとこの節が黙って空振りする**`)
        let resP2 = null
        try {
          const raw = await runWorkflow(wfP, { edge: 'req->bd', batch: 3 },
            { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
              scriptsDir: HERE, failIds: badP, disagreeIds: disP, writeFailIds: wfailP, backtickIds: btP })
          resP2 = raw?.result || null
        } catch { /* 落ちたら下で赤になる */ }
        ok('workflow: 書き戻しに失敗した断片を除外して先へ進む',
          !!resP2 && (resP2.failed || 0) === badP.size + wfailP.size && (resP2.ledger?.ok || 0) >= 1,
          `失敗 ${resP2?.failed ?? '?'}（期待 ${badP.size + wfailP.size}）/ 台帳の承認 ${resP2?.ledger?.ok ?? '?'}`)
        ok('workflow: 失敗を握り潰して complete と報告しない', resP2?.status === 'partial',
          `status=${resP2?.status}`)
        // **なぜ書けなかったかが報告に載ること。**
        // 書き戻しの出力を捨てていたせいで、実機で 2 件が「未承認のまま残っている」としか
        // 言えない状態になった。件数は台帳から取るが、**理由はここからしか出ない。**
        // 台帳に弾かれた断片は「未承認のまま残っている」として数えられ、
        // **そのとき approve が返したメッセージが付いていること。**
        //
        // **この検査は対応づけの検査でもある。** 偽物は出力を entryId と対にして
        // **わざと逆順で**返す（workflow-sim.mjs）。親が順番で突き合わせていると、
        // ここで理由が別の断片に付いて赤くなる。実機で 16 件中 14 件が
        // 「原因不明」になったのがこの型で、**件数の検査では見つからない**——
        // 長さは合っていて、中身だけがずれるから。
        const rejected = (resP2?.failures || []).filter(f => /未承認のまま/.test(String(f.why || '')))
        ok('workflow: 書き戻せなかった理由が報告に載る',
          rejected.length >= 1 && rejected.some(f => /承認の理由が不十分/.test(String(f.output || ''))),
          `failures=${JSON.stringify(rejected[0] || (resP2?.failures || [])[0] || {}).slice(0, 200)}\n` +
          `    **理由が無いと、上限で落ちたのか中身が弾かれたのか区別できない**（実機で 2 件がそうなった）`)
        // **理由文にバッククォートが入っても書き戻せること。**
        // コマンドは `…` で囲んで渡すので、落とさないと囲みが途中で閉じて切れる。
        // 原文にコードスパン（`02_data_model.md` など）があると、承認する側の理由文に
        // 引き写されて混入しうる。
        const btId = [...btP][0]
        const btShow = btId ? jsonOf(sh('ledger.mjs', ['approve-show', 'req->bd', btId])) : null
        ok('workflow: 理由文にバッククォートが入っても書き戻せる',
          !!btId && btShow?.state !== '未承認',
          `${btId} の状態: ${btShow?.state}\n` +
          `    **落とさないと、コマンドが途中で切れて黙って書き戻せない**`)
        ok('workflow: 食い違いが指摘として報告に出る',
          (resP2?.ledger?.challenged || 0) >= 1 && (resP2?.challengedIds || []).length >= 1,
          `指摘 ${resP2?.ledger?.challenged ?? '?'} 件 / 一覧 ${(resP2?.challengedIds || []).length} 件\n` +
          `    **指摘は消えない。** 消えるなら、承認が漏れを作る側に回っている`)

        // ── settle.js（決着の 2 周目）──────────────────────────────────
        // 指摘を落とすか残すかを決める前に、**同じ問いを盲でもう一度**投げる。
        // 1 周目の判定を見せてから「同意しますか」と聞けば、まず同意が返る。
        const wfS = join(HERE, '..', 'workflows', 'settle.js')
        ok('workflow: settle.js が在る', existsSync(wfS))
        if (existsSync(wfS)) {
          const chal = (jsonOf(sh('ledger.mjs', ['settle-next', 'req->bd', 'all', '--ids-only']))?.ids || [])
          ok('smoke: 2 周目に回す指摘が在る', chal.length >= 1,
            `**0 件だとこの節が黙って空振りする。** 実際: ${chal.length} 件`)

          let resS = null, callsS = [], errS = null
          try {
            const rawS = await runWorkflow(wfS, { edge: 'req->bd', batch: 3 },
              { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
                scriptsDir: HERE })
            resS = rawS?.result || null; callsS = rawS?.calls || []
          } catch (e) { errS = e }
          // **status が error でないこと。** 一覧の phase 名が合っていないと、
          // 判定は動いているのに listedOk が立たず全部 error になる（実際に踏んだ）。
          ok('workflow: settle.js が最後まで走る',
            !errS && !!resS && resS.status !== 'error',
            errS ? String(errS && errS.message).slice(0, 200)
                 : `status=${resS?.status} listFailure=${JSON.stringify(String(resS?.listFailure || '').slice(0, 120))}`)

          // 既定の偽エージェントは分解側の扱い（wrote）に合わせるので「要求」と答える。
          // 1 周目は「要求でない」だったので**割れる**。割れたら落とさない。
          ok('workflow: 割れたら落とさずに本人へ回す',
            (resS?.split || 0) >= 1 && (resS?.conceded || 0) === 0,
            `割れた ${resS?.split ?? '?'} / 落とした ${resS?.conceded ?? '?'}\n` +
            `    **2 対 1 を真実と呼ばない。** 落としていたら、票を足すほど機械が決めたことになる`)
          ok('workflow: 割れを握り潰して complete と報告しない', resS?.status === 'partial',
            `status=${resS?.status}`)
          ok('workflow: 割れた断片の中身が報告に載る',
            (resS?.splitRows || []).length >= 1 &&
            (resS.splitRows[0]?.first === '要求でない') && (resS.splitRows[0]?.second === '要求'),
            `**両方の答えが並んでいないと、本人が判断できない。** ` +
            `実際: ${JSON.stringify((resS?.splitRows || [])[0] || {}).slice(0, 160)}`)

          // **2 周目に 1 周目の判定を渡していないこと。**
          // 渡すとほぼ必ず同意が返り、同意の件数は判断ではなく聞き方の結果になる。
          // prompt の頭 80 字では足りないので body（全文）の断片 JSON を見る。
          const setCalls = callsS.filter(c => /^set:/.test(String(c.label || '')))
          const entriesJson = setCalls.map(c => {
            const m = String(c.body || '').match(/## 断片\n```json\n([\s\S]*?)```/)
            return m ? m[1] : ''
          })
          ok('workflow: 2 周目のプロンプトに 1 周目の判定が入っていない',
            setCalls.length >= 1 && entriesJson.every(t => t && !/verdict|approval|concededFrom|"kind"/.test(t)),
            `呼び出し ${setCalls.length} 件。**選択肢の一覧ではなく、断片に付いてきた情報を見ている**\n` +
            `    断片 JSON の先頭: ${JSON.stringify((entriesJson[0] || '').slice(0, 120))}`)
          const set35 = setCalls.map(c => groupsOfCall(c)).filter(Boolean)
          ok('workflow: 2 周目も 10 断片まで・同じ単位を混ぜない・ファイルをまたがない（v36 の既定）',
            setCalls.length >= 1 && set35.length === setCalls.length && set35.every(g => g.n >= 1 && g.n <= 10 && g.units === g.n && g.files === 1),
            '隣の断片をどう答えたかが次に効くと、独立という前提が崩れる。' + JSON.stringify(set35.slice(0, 6)))
        }
      }

      // ── audit.js（レビューの本体）────────────────────────────────────
      // 3 観点を並列に回し、批評者が反論し、引用を実ファイルと照合して
      // 一致しないものを無効化する——という構造そのものを見る。
      // レビューが「指摘 0 件」で通る型の穴は、ここが効かないと全部素通りする。
      const wfA = join(HERE, '..', 'workflows', 'audit.js')
      if (existsSync(wfA)) {
        // evidence は**オブジェクト 1 個**（audit.js のスキーマがそう定めている）。
        // 配列で渡すと collectEvidence が拾わず、照合は「0 件中 0 件不正」で緑になる——
        // **検査が空振りしていることに気付けない形**なので、下で件数まで見る。
        const reqLine = 1 + (readFileSync(join(TMP, 'docs/req.md'), 'utf8')
          .split('\n').findIndex(l => l.includes('テンポは 20 から 300')))
        const REV = k => ({ perspective: k, checked: ['tempo'], notVerified: [],
          findings: [{ id: `${k}-1`, severity: 'Blocking', summary: `${k} の指摘`, why: '原文どおりの引用',
                       evidence: { file: 'docs/req.md', line: reqLine, quote: 'テンポは 20 から 300 の範囲で指定できる' } },
                     { id: `${k}-2`, severity: 'Major', summary: `${k} の作り話`, why: '実在しない引用',
                       evidence: { file: 'docs/req.md', line: reqLine, quote: 'この文はどこにも書かれていない' } }] })
        let ra = null
        try {
          const rawA = await runWorkflow(wfA, 'design',
            { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
              scriptsDir: HERE,
              reviews: [REV('a'), REV('b'), REV('c')],
              critics: null })
          ra = rawA?.result || null
        } catch (e) { ra = { _err: String(e && e.message) } }
        ok('workflow: audit.js が最後まで走る', !!ra && !ra._err,
          ra?._err ? String(ra._err).slice(0, 200) : '')
        ok('workflow: 引用の照合が実際に走っている',
          (ra?.evidenceSummary?.total || 0) >= 2,
          `照合した引用 ${ra?.evidenceSummary?.total ?? '?'} 件。**0 なら検査が空振りしている**`)
        ok('workflow: 実ファイルと一致しない引用を無効化する',
          (ra?.droppedByEvidence || 0) >= 1,
          `無効化 ${ra?.droppedByEvidence ?? '?'} 件。**引用を照合しないレビューは自己申告と同じ**\n` +
          `    （各観点に「原文どおりの引用」と「作り話の引用」を 1 件ずつ入れてある）`)
        ok('workflow: 実在する引用の指摘は残る',
          (ra?.raised || 0) >= 1 && (ra?.raised || 0) > (ra?.droppedByEvidence || 0),
          `raised ${ra?.raised ?? '?'} / 無効化 ${ra?.droppedByEvidence ?? '?'}\n` +
          `    全部落とすなら照合が厳しすぎる。正しい指摘まで消える`)
      }
    }
  }

  // ── v28：詳細設計の作り直しの準備（T3 分解し直しの引き継ぎ・T4 要求 ID の印・T5 拾い上げ）──
  mark('v28: 分解し直しでも 2 周目と本人待ちを失わない／要求 ID の印／拾い上げ')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const rows0 = readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const target = rows0.find(r => /テンポ/.test(String(r.text)) && String(r.text).length >= 24)
    ok('v28: 検査に使う単位が在る', !!target)
    if (target) {
      const U = target.unitId, S = String(target.text)
      const half = Math.floor(S.length / 2)
      const A = S.slice(0, half).trim(), B = S.slice(half).trim()
      const decAB = () => rx('decompose', 'req->bd', U, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
      ok('v28: 土台の分解が通る', decAB().status === 0)
      const ents = () => jsonOf(rx('show', 'req->bd', U))?.entries || []
      const idOf = span => (ents().find(x => x.span === span) || {}).entryId
      const WHY = `原文「${S.slice(0, 16)}」のこの部分についての判断`
      const idA = idOf(A), idB = idOf(B)
      rx('approve', 'req->bd', idA, '要求', JSON.stringify({ why: WHY, expect: `${A} を下位の設計で定める` }))
      rx('approve', 'req->bd', idB, '要求でない', JSON.stringify({ why: WHY, kind: 'ラベル・項目名' }))
      const sp = rx('settle', 'req->bd', idB, '要求', JSON.stringify({ why: `${B} は下位へ降ろす内容を含む記述である`, expect: `${B} を下位の設計で定める` }))
      ok('v28 T3: 土台として 2 周目が割れる', sp.status === 0 && /割れました/.test(String(sp.stdout || '')), errOf(sp).slice(0, 200))
      decAB()   // 中身を変えずに分解し直す
      const again = rx('settle', 'req->bd', idOf(B), '要求でない', JSON.stringify({ why: `${B} は説明であり要求を含まない記述である` }))
      ok('v28 T3: 中身を変えずに分解し直しても 2 周目の記録が残る（聞き直さない）',
        again.status !== 0 && /2 周目が済んでいます/.test(errOf(again)),
        '**分解し直すだけで 2 周目が外れると、答えが気に入らないときの聞き直しの道になる**（turn 61 の実測）')
      const h = rx('hold', 'req->bd', idOf(B), '--why', `${B} についての判断が 2 周で割れたため本人へ回す`)
      ok('v28 T3: 土台として本人待ちにできる', h.status === 0, errOf(h).slice(0, 200))
      decAB()
      const st = (ents().find(x => x.span === B) || {}).approval
      ok('v28 T3: 中身を変えずに分解し直しても本人待ちが外れない', st === '本人待ち',
        `実際: ${st}。**分解し直すだけで本人の判断を待つ断片から抜けられてはいけない**`)
      const ap = rx('approve', 'req->bd', idOf(B), '要求', JSON.stringify({ why: WHY, expect: `${B} を下位の設計で定める` }))
      ok('v28 T3: 本人待ちの断片を承認し直させない', ap.status !== 0 && /本人待ち/.test(errOf(ap)),
        '承認を置き換えると、答えが合った瞬間に「承認」へ変わり本人待ちから抜ける')
      // 逆対照：中身を変えたら引き継がない（別物）
      rx('decompose', 'req->bd', U, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を必ず満たすこと`, from: B }]))
      const st2 = (ents().find(x => x.span === B) || {}).approval
      ok('v28 T3: 中身が変わったら引き継がない（未承認に戻る）', st2 === '未承認', `実際: ${st2}`)

      // ── T4 要求 ID の印 ──
      const tg = jsonOf(sh('ledger.mjs', ['tags', 'req->bd', '--json']))
      const mineT = (tg?.tags || []).filter(t => String(t.entryId).startsWith(U + '#'))
      ok('v28 T4: 範囲の要求に印の ID が付く', mineT.length === 2 && mineT.every(t => /^[^\s:]+:[0-9a-f]{1,8}(~\d+)?\.[0-9a-f]{4,12}(-\d+)?$/.test(t.tag)),
        JSON.stringify(mineT.map(t => t.tag)))
      const tc0 = sh('ledger.mjs', ['tag-check', 'req->bd', '--json'])
      const j0 = jsonOf(tc0)
      ok('v28 T4: 印が無ければ tag-check が数えて赤になる', tc0.status === 1 && (j0?.untagged || 0) >= 2,
        `untagged ${j0?.untagged} / exit ${tc0.status}`)
      const bdPath = join(TMP, 'docs/bd.md')
      const bd0 = readFileSync(bdPath, 'utf8')
      const all = (tg?.tags || [])
      writeFileSync(bdPath, bd0 + '\n' + all.map(t => `印のついた段落 <!-- req ${t.tag} -->`).join('\n') + '\n')
      const tc1 = sh('ledger.mjs', ['tag-check', 'req->bd', '--json'])
      ok('v28 T4: 全部に印があれば緑', tc1.status === 0 && jsonOf(tc1)?.untagged === 0, errOf(tc1).slice(0, 300))
      writeFileSync(bdPath, bd0 + '\n' + all.map(t => `<!-- req ${t.tag} -->`).join('\n') + '\n<!-- req 99:deadbeef.abcd -->\n<!-- req こわれた -->\n')
      const j2 = jsonOf(sh('ledger.mjs', ['tag-check', 'req->bd', '--json']))
      ok('v28 T4: 行き先の無い印と形の壊れた印を数える', j2?.orphan === 1 && j2?.broken === 1,
        `orphan ${j2?.orphan} / broken ${j2?.broken}。**上位が変わって古くなった印は、行き先の無い印として見える**`)
      const shw = jsonOf(sh('ledger.mjs', ['show', 'req->bd', mineT[0]?.entryId || '']))
      ok('v28 T4: show が判定役に印の ID を渡す', !!shw?.tag && shw.tag === mineT[0]?.tag)
      writeFileSync(bdPath, bd0)

      // ── T5 拾い上げ（git の履歴の版から）──
      git('add', '-A'); git('commit', '-q', '-m', 'v28 fixture')
      const head = String(git('rev-parse', 'HEAD').stdout || '').trim()
      const sc = sh('ledger.mjs', ['harvest', 'scan', '--ref', head, '--dir', 'docs'])
      const hl = jsonOf(sh('ledger.mjs', ['harvest', 'list', '--json'])) || []
      ok('v28 T5: 履歴の版から拾う行を洗い出す（G 番号の行を拾う）',
        sc.status === 0 && hl.some(r => /G1/.test(r.text)), errOf(sc).slice(0, 200))
      const g1 = hl.find(r => /G1/.test(r.text))
      const rp0 = sh('ledger.mjs', ['harvest', 'report', '--strict', '--json'])
      ok('v28 T5: 行き先の無い行が残っていれば --strict で赤', rp0.status === 1 && (jsonOf(rp0)?.pending || 0) >= 1)
      const bad = sh('ledger.mjs', ['harvest', 'set', g1?.id || '', 'bd', '--why', 'G1 は基本設計に在る', '--in', 'docs/bd.md', '--quote', 'ここには存在しない文章を引用しようとしている'])
      ok('v28 T5: 実在しない引用では行き先を付けさせない', bad.status !== 0 && /逐語で見つかりません/.test(errOf(bad)))
      const drop0 = sh('ledger.mjs', ['harvest', 'set', g1?.id || '', 'drop', '--why', 'もう要らないと判断した'])
      ok('v28 T5: その行に触れない「要らない」は拒む', drop0.status !== 0)
      for (const r of hl) sh('ledger.mjs', ['harvest', 'set', r.id, 'bd', '--why', `${r.file} の行は基本設計に在る`, '--in', 'docs/bd.md', '--quote', r.text.replace(/^[-#\s]+/, '')])
      const rp1 = jsonOf(sh('ledger.mjs', ['harvest', 'report', '--json']))
      ok('v28 T5: 全部に行き先が付けば残り 0', rp1?.pending === 0 && rp1?.invalid === 0, JSON.stringify(rp1?.perFile || {}).slice(0, 200))
      writeFileSync(bdPath, bd0.replace(/G1 ループ再生の実機確認が未実施/, 'G1 は別の文に変わった'))
      const rp2 = sh('ledger.mjs', ['harvest', 'report', '--strict', '--json'])
      ok('v28 T5: 引用先の文が消えたら無効として数える', rp2.status === 1 && (jsonOf(rp2)?.invalid || 0) >= 1,
        '**行き先を付けたあとで書き換えられても、拾った決定が消えたことに気づける**')
      writeFileSync(bdPath, bd0)
      rmSync(join(TMP, '.claude/coverage/harvest.jsonl'), { force: true })
    }
  }

  // ── v29 T7：上位の本文が変わっても・単位が消えても、本人待ちを本人を通さずに落とさない ──
  mark('v29: 本文が変わっても本人待ちを落とさない')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md')
    const req0 = readFileSync(reqPath, 'utf8')
    const rows = () => readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const ar = () => jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))
    // 単位を 2 つに割って、後ろ半分を「割れた → 本人待ち」にする
    const holdOn = (re, minLen = 20) => {
      const t = rows().find(r => re.test(String(r.text)) && String(r.text).length >= minLen)
      if (!t) return null
      const S = String(t.text), half = Math.floor(S.length / 2), A = S.slice(0, half).trim(), B = S.slice(half).trim()
      rx('decompose', 'req->bd', t.unitId, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
      const ents = jsonOf(rx('show', 'req->bd', t.unitId))?.entries || []
      const idA = (ents.find(x => x.span === A) || {}).entryId, idB = (ents.find(x => x.span === B) || {}).entryId
      const WHY = `原文「${S.slice(0, 16)}」のこの部分についての判断`
      rx('approve', 'req->bd', idA, '要求', JSON.stringify({ why: WHY, expect: `${A} を下位の設計で定める` }))
      rx('approve', 'req->bd', idB, '要求でない', JSON.stringify({ why: WHY, kind: 'ラベル・項目名' }))
      rx('settle', 'req->bd', idB, '要求', JSON.stringify({ why: `${B} は下位へ降ろす内容を含む記述である`, expect: `${B} を下位の設計で定める` }))
      const h = rx('hold', 'req->bd', idB, '--why', `${B} についての判断が 2 周で割れたため本人へ回す`)
      return h.status === 0 ? { unitId: t.unitId, A, B } : null
    }
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    rmSync(join(TMP, '.claude/coverage/orphan-holds.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const h1 = holdOn(/テンポ/)
    ok('v29 T7: 土台として本人待ちが 1 件', !!h1 && ar()?.counts?.waiting === 1, `waiting ${ar()?.counts?.waiting}`)
    if (h1) {
      // 本文を変える（位置は同じ）→ 陳腐化
      writeFileSync(reqPath, req0.replace('テンポは 20 から 300 の範囲で指定できる。', 'テンポは 20 から 300 までの範囲で指定できる。'))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const a1 = ar()
      ok('v29 T7: 本文が変わっても、前の本人待ちが数えられている', a1?.counts?.waiting === 1 && (a1?.carriedHolds || []).length === 1,
        `waiting ${a1?.counts?.waiting} / carried ${(a1?.carriedHolds || []).length}。**文が変わると本人待ちが外れる、を塞ぐ**（turn 70 の実測）`)
      // 新しい単位を分解して承認しきっても、本人が外すまで残る
      const nu = rows().find(r => /までの範囲/.test(String(r.text)))
      if (nu) {
        const S = String(nu.text)
        rx('decompose', 'req->bd', nu.unitId, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
        const e1 = (jsonOf(rx('show', 'req->bd', nu.unitId))?.entries || [])[0]
        rx('approve', 'req->bd', e1?.entryId || '', '要求', JSON.stringify({ why: `原文「${S.slice(0, 16)}」の判断`, expect: `${S.slice(0, 20)} を下位の設計で定める` }))
      }
      ok('v29 T7: 分解し直して承認しても、前の本人待ちは本人が外すまで残る', ar()?.counts?.waiting === 1)
      const hid = (ar()?.carriedHolds || [])[0]?.holdId || ''
      const byAi = spawnSync(NODE, [join(HERE, 'ledger.mjs'), 'release-hold', 'req->bd', hid, '--why', 'AI が勝手に外そうとしている理由の文'],
        { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_LEDGER_ALLOW_NON_TTY: '' } })
      ok('v29 T7: release-hold は本人の端末からだけ', byAi.status !== 0 && /本人のコマンド/.test(errOf(byAi)))
      const byMe = rx('release-hold', 'req->bd', hid, '--why', '本人が前の本人待ちを見て、今の断片で決め直した')
      ok('v29 T7: 本人が外すと本人待ちが 0 になり、記録は残る', byMe.status === 0 && ar()?.counts?.waiting === 0 &&
        rows().some(r => (r.releasedHolds || []).length === 1), errOf(byMe).slice(0, 200))
    }
    // 単位そのものが消えたとき
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const h2 = holdOn(/ループ/, 10)
    if (h2) {
      writeFileSync(reqPath, req0.replace(/小節範囲を指定してループ再生できる。終了小節の後は開始小節へ戻る。\n/, ''))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const a2 = ar()
      ok('v29 T7: 単位が消えても、その本人待ちを別に残して数える', a2?.counts?.waiting === 1 && (a2?.carriedHolds || [])[0]?.lost === true,
        `waiting ${a2?.counts?.waiting} / ${JSON.stringify((a2?.carriedHolds || [])[0] || {}).slice(0, 120)}`)
      const hid2 = (a2?.carriedHolds || [])[0]?.holdId || ''
      const rel = rx('release-hold', 'req->bd', hid2, '--why', '本人が見て、消えた段落の判断は要らないと決めた')
      ok('v29 T7: 消えた単位の本人待ちも本人が外せる', rel.status === 0 && ar()?.counts?.waiting === 0, errOf(rel).slice(0, 200))
    } else ok('v29 T7: 土台（ループの単位）が作れる', false)
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/coverage/orphan-holds.jsonl'), { force: true })
    rmSync(join(TMP, '.claude/coverage/orphan-holds.released.jsonl'), { force: true })
  }

  // ── v30 T9：語の無い原文（「**」だけ等）も、原文を逐語で含む理由なら対象外にできる ──
  mark('v30: 語の無い単位・含む（with）・分解し直しの本人待ち')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md')
    const req0 = readFileSync(reqPath, 'utf8')
    const rows = () => readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const ar = () => jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))
    const reset = (text) => {
      writeFileSync(reqPath, text)
      rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
      rmSync(join(TMP, '.claude/coverage/orphan-holds.jsonl'), { force: true })
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    }
    // 行ごと太字にすると、最後の「。」の後ろに「**」だけが残る（01:54 と同じ形）
    reset(req0.replace(/^(テンポは 20 から 300 の範囲で指定できる。.*)$/m, '**$1**'))
    const star = rows().find(r => String(r.text).trim() === '**')
    ok('v30 T9: 土台として「**」だけの単位ができる', !!star, rows().map(r => r.text).join(' | ').slice(0, 200))
    if (star) {
      const bad = rx('decompose', 'req->bd', star.unitId, JSON.stringify([{ skip: '**', why: '太字の終わりの印だけの切れ端で、要求を含まない' }]))
      ok('v30 T9: 原文を含まない理由は、語の無い単位でも通さない', bad.status !== 0 && /語がありません/.test(errOf(bad)), errOf(bad).slice(0, 200))
      const good = rx('decompose', 'req->bd', star.unitId, JSON.stringify([{ skip: '**', why: '「**」だけの切れ端で、前の文の太字の終わりの印。要求を含まない' }]))
      ok('v30 T9: 原文そのものを逐語で含む理由なら、語の無い単位を対象外にできる', good.status === 0, errOf(good).slice(0, 200))
      const e0 = (jsonOf(rx('show', 'req->bd', star.unitId))?.entries || [])[0]
      const ap = rx('approve', 'req->bd', e0?.entryId || '', '要求でない', JSON.stringify({ why: '「**」は太字の印の切れ端で、下位に現れるべき内容が無い', kind: '書式・記号の切れ端' }))
      ok('v30 T9: 承認の理由も同じ扱い（原文を逐語で含めば通る）', ap.status === 0, errOf(ap).slice(0, 200))
    }

    // ── v30 T11：要求に「含む」（with）を付けられる ──
    reset(req0)
    const tu = rows().find(r => String(r.text) === 'テンポは 20 から 300 の範囲で指定できる。')
    ok('v30 T11: 土台（テンポの単位）がある', !!tu)
    if (tu) {
      const R = { text: 'テンポを 20 から 300 の範囲で指定できること', from: '20 から 300 の範囲で指定できる' }
      const notVerb = rx('decompose', 'req->bd', tu.unitId, JSON.stringify([{ ...R, with: ['テンポの値は'] }]))
      ok('v30 T11: 含むは原文の逐語でなければ拒む', notVerb.status !== 0 && /原文に無い/.test(errOf(notVerb)), errOf(notVerb).slice(0, 160))
      const overlap = rx('decompose', 'req->bd', tu.unitId, JSON.stringify([{ ...R, with: ['300 の範囲'] }]))
      ok('v30 T11: 含むがほかの断片と重なれば拒む', overlap.status !== 0 && /取り合って/.test(errOf(overlap)), errOf(overlap).slice(0, 160))
      const onSkip = rx('decompose', 'req->bd', tu.unitId, JSON.stringify([R, { skip: 'テンポは ', why: 'テンポの主語を示す前置きで要求ではない', with: ['。'] }]))
      ok('v30 T11: 含むは対象外（skip）には付けられない', onSkip.status !== 0 && /要求にだけ/.test(errOf(onSkip)), errOf(onSkip).slice(0, 160))
      // 含むなしで分解 → 承認 → 含むを足して分解し直す → 承認は引き継がない（別の断片）
      const plain = rx('decompose', 'req->bd', tu.unitId, JSON.stringify([R, { skip: 'テンポは ', why: 'テンポという主語を示す前置きで、要求ではない' }]))
      const ents0 = jsonOf(rx('show', 'req->bd', tu.unitId))?.entries || []
      const rq0 = ents0.find(x => x.as === '要求')
      rx('approve', 'req->bd', rq0?.entryId || '', '要求', JSON.stringify({ why: 'テンポの範囲を 20 から 300 に決める要求', expect: 'テンポの範囲 20〜300 を下位に書く' }))
      const withIt = rx('decompose', 'req->bd', tu.unitId, JSON.stringify([{ ...R, with: ['テンポは '] }]))
      const ents1 = jsonOf(rx('show', 'req->bd', tu.unitId))?.entries || []
      const rq1 = ents1.find(x => x.as === '要求')
      ok('v30 T11: 含むを付けて分解できる（前置きを対象外に分けなくてよい）', plain.status === 0 && withIt.status === 0 && ents1.length === 1 &&
        JSON.stringify(rq1?.with) === JSON.stringify(['テンポは ']), errOf(withIt).slice(0, 200))
      ok('v30 T11: 含むを足すと別の断片になり、承認し直しになる', rq0 && rq1 && rq0.entryId !== rq1.entryId && rq1.approval === '未承認',
        `${rq0?.entryId} → ${rq1?.entryId} / ${rq1?.approval}`)
      const nx = jsonOf(rx('approve-next', 'req->bd', 'all'))
      ok('v30 T11: 確かめ役には含むも一緒に渡る', (nx?.entries || []).some(x => x.entryId === rq1?.entryId && Array.isArray(x.with) && x.with[0] === 'テンポは ') &&
        /含む/.test(String(nx?.note || '')))
      // 含むごと「要求でない」に同意したら、含むの断片も対象外へ運ぶ
      rx('approve', 'req->bd', rq1?.entryId || '', '要求でない', JSON.stringify({ why: 'テンポの範囲の記述は例示で要求ではないという判断', kind: 'ラベル・項目名' }))
      const cc = rx('concede', 'req->bd', rq1?.entryId || '', '--why', 'テンポの範囲は例示なので対象外にする')
      const after = rows().find(r => r.unitId === tu.unitId)
      ok('v30 T11: 同意すると、含むの断片も対象外へ運ばれる', cc.status === 0 && (after?.skips || []).some(k => k.skip === 'テンポは ') &&
        (after?.skips || []).some(k => k.skip === R.from), errOf(cc).slice(0, 200))
      // 運んだあと同じ分解をもう一度書いても、取り残しで止まらない
      const again = rx('decompose', 'req->bd', tu.unitId, JSON.stringify((after?.skips || []).map(k => ({ skip: k.skip, why: k.why }))))
      ok('v30 T11: 運んだ対象外だけで分解し直しても通る', again.status === 0, errOf(again).slice(0, 200))
    }

    // ── v30 T10：分解し直しで断片が変わっても、本人待ちを本人を通さずに落とさない ──
    reset(req0)
    const lu = rows().find(r => /ループ再生できる/.test(String(r.text)))
    if (lu) {
      const S = String(lu.text), half = Math.floor(S.length / 2), A = S.slice(0, half).trim(), B = S.slice(half).trim()
      rx('decompose', 'req->bd', lu.unitId, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
      const ents = jsonOf(rx('show', 'req->bd', lu.unitId))?.entries || []
      const idA = (ents.find(x => x.span === A) || {}).entryId, idB = (ents.find(x => x.span === B) || {}).entryId
      const WHY = `原文「${S.slice(0, 12)}」のこの部分についての判断`
      rx('approve', 'req->bd', idA, '要求', JSON.stringify({ why: WHY, expect: `${A} を下位の設計で定める` }))
      rx('approve', 'req->bd', idB, '要求でない', JSON.stringify({ why: WHY, kind: 'ラベル・項目名' }))
      rx('settle', 'req->bd', idB, '要求', JSON.stringify({ why: `${B} は下位へ降ろす内容を含む記述である`, expect: `${B} を下位の設計で定める` }))
      const h = rx('hold', 'req->bd', idB, '--why', `${B} についての判断が 2 周で割れたため本人へ回す`)
      ok('v30 T10: 土台として本人待ちが 1 件', h.status === 0 && ar()?.counts?.waiting === 1, errOf(h).slice(0, 200))
      // 同じ断片のまま分解し直す → 普通に引き継ぐ（前の版の扱いにしない）
      rx('decompose', 'req->bd', lu.unitId, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
      const a0 = ar()
      ok('v30 T10: 断片が同じなら本人待ちはそのまま（前の版に回さない）', a0?.counts?.waiting === 1 && (a0?.carriedHolds || []).length === 0,
        `waiting ${a0?.counts?.waiting} / carried ${(a0?.carriedHolds || []).length}`)
      // 区切りを変えて分解し直す → 本人待ちは単位に残る
      const re = rx('decompose', 'req->bd', lu.unitId, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
      const a1 = ar()
      ok('v30 T10: 区切りを変えて分解し直しても、前の本人待ちが数えられている', re.status === 0 && a1?.counts?.waiting === 1 &&
        (a1?.carriedHolds || []).length === 1 && /本人待ち/.test(errOf(re)),
        `waiting ${a1?.counts?.waiting} / carried ${(a1?.carriedHolds || []).length}。**分解し直すだけで本人待ちが外れる、を塞ぐ**`)
      const hid = (a1?.carriedHolds || [])[0]?.holdId || ''
      const rel = rx('release-hold', 'req->bd', hid, '--why', '本人が見て、前後をまとめて 1 つの要求にすると決めた')
      ok('v30 T10: 本人が release-hold で外せる', rel.status === 0 && ar()?.counts?.waiting === 0, errOf(rel).slice(0, 200))
    } else ok('v30 T10: 土台（ループの単位）が作れる', false)
    reset(req0)
    rmSync(join(TMP, '.claude/coverage/orphan-holds.released.jsonl'), { force: true })
  }

  // ── v31 T12：分解し直す前にもう一度変わっても、最後に分解した版を前の分解として残す ──
  // ── v31 T13：要件定義書の既存の表・箇条へ書く（req-add row / amend）と、変更履歴の行 ──
  mark('v31: 陳腐化の連鎖・要件の既存の形への追記')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const ra = (...a) => spawnSync(NODE, [join(HERE, 'req-add.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md')
    const req0 = readFileSync(reqPath, 'utf8')
    const rows = () => readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const lu = rows().find(r => /ループ再生できる/.test(String(r.text)))
    if (lu) {
      const S = String(lu.text)
      rx('decompose', 'req->bd', lu.unitId, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
      // 1 回目の直し → 分解し直さずに 2 回目の直し
      writeFileSync(reqPath, req0.replace(S, S.replace('ループ再生できる', 'ループ再生ができる')))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      writeFileSync(reqPath, req0.replace(S, S.replace('ループ再生できる', 'ループして再生ができる')))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const now = rows().find(r => /ループして再生/.test(String(r.text)))
      ok('v31 T12: 2 回続けて変わっても、最後に分解した版の要求が前の分解として残る',
        (now?.stalePrevReqs || []).length === 1 && String(now?.staleText) === S,
        `stalePrevReqs ${(now?.stalePrevReqs || []).length} / staleText ${JSON.stringify(String(now?.staleText || '').slice(0, 30))}。**分解し直す前の 2 回目の直しで前の要求が消える、を塞ぐ**`)
      // 分解し直すと stale-diff に出る（前の要求を読んで --ack する対象になる）
      if (now) rx('decompose', 'req->bd', now.unitId, JSON.stringify([{ text: `${now.text} を満たすこと`, from: String(now.text) }]))
      const sd = jsonOf(rx('stale-diff', 'req->bd', '--json'))
      ok('v31 T12: 分解し直すと stale-diff に前の要求が出る', JSON.stringify(sd || {}).includes('ループ再生できる'), JSON.stringify(sd || {}).slice(0, 200))
    } else ok('v31 T12: 土台（ループの単位）が作れる', false)
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])

    // T13
    rmSync(join(TMP, '.claude/state/req-draft.json'), { force: true })
    const fx = '# 要件\n\n## 4.2 パート\n\n- 曲の途中でもパートの追加を自由に行える\n- チューニングはパートごとに設定する\n\n' +
      '## 5.6 開発\n\n| 項目 | 内容 |\n|---|---|\n| ウィンドウサイズ（PC版） | 最小800×600とする |\n| 右クリック（PC版） | コピーに対応する |\n\n' +
      '## 10. 変更履歴\n\n| # | 変更内容 | 変更前 | 変更後 |\n|---|---|---|---|\n| 1 | 保存先 | 固定 | 選択 |\n| 2（2026-09-03追加） | 上限 | 無制限 | 80MB |\n'
    writeFileSync(reqPath, fx)
    const W = '編集ウィンドウは曲ごとに、前に閉じたときの位置と大きさで開く'
    const noDraft = ra('row', 'ウィンドウの位置（PC版）', W, '--section', '5.6', '--history', '窓の位置を足した')
    ok('v31 T13: 下書き（質問の記録）が無ければ row も書かない', noDraft.status !== 0 && /下書きがありません/.test(errOf(noDraft)))
    ra('open', '窓の位置を曲ごとに覚えたい')
    const vague = ra('row', 'ウィンドウの位置（PC版）', `${W}など`, '--section', '5.6', '--history', '窓の位置を足した')
    ok('v31 T13: 未確定点のある文は row でも書かない', vague.status !== 0 && readFileSync(reqPath, 'utf8') === fx)
    const good = ra('row', 'ウィンドウの位置（PC版）', W, '--section', '5.6', '--after', 'ウィンドウサイズ（PC版）', '--history', '窓の位置を足した')
    const t1 = readFileSync(reqPath, 'utf8').split('\n')
    const wi = t1.findIndex(l => l.startsWith('| ウィンドウサイズ'))
    ok('v31 T13: 既存の 2 列の表の指した行の後ろに、同じ列の数で足す', good.status === 0 && t1[wi + 1] === `| ウィンドウの位置（PC版） | ${W} |`, errOf(good).slice(0, 200))
    ok('v31 T13: 変更履歴の表に次の番号で 1 行足す', t1.some(l => /^\| 3（\d{4}-\d{2}-\d{2}追加） \| 窓の位置を足した（5\.6節） \| （新規） \| /.test(l)))
    const dupe = ra('row', 'ウィンドウの位置（PC版）', W, '--section', '5.6', '--history', '窓の位置を足した')
    ok('v31 T13: 同じ項目の行は二重に足さない', dupe.status !== 0 && /既にこの表にあります/.test(errOf(dupe)))
    const four = ra('row', '新しい行', W, '--section', '10.', '--history', '履歴に書こうとした')
    ok('v31 T13: 2 列でない表には推測で書かない', four.status !== 0 && /2 列の表だけ/.test(errOf(four)))
    const am = ra('amend', '曲の途中でも', '最後の1パートも削除でき、そのとき小節の骨組みは残す', '--section', '4.2', '--history', 'パートの削除を明確にした', '--before', '最後の1パートの扱いが未規定')
    const t2 = readFileSync(reqPath, 'utf8')
    ok('v31 T13: amend は 1 つだけ当たる箇条の末尾に文を足し、履歴も足す', am.status === 0 &&
      t2.includes('- 曲の途中でもパートの追加を自由に行える。最後の1パートも削除でき、そのとき小節の骨組みは残す') &&
      /^\| 4（.*） \| パートの削除を明確にした（4\.2節） \| 最後の1パートの扱いが未規定 \| /m.test(t2), errOf(am).slice(0, 200))
    const miss = ra('amend', '存在しない箇条', '何か足す文としての内容', '--section', '4.2', '--history', 'x の変更', '--before', 'y')
    ok('v31 T13: 当たる箇条が 1 つでなければ書かない', miss.status !== 0 && /0 行あります/.test(errOf(miss)))
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/state/req-draft.json'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
  }

  // ── v32 T14：語の無い断片への答えは、断片の逐語を含む理由でも通す（単位の本文に語があっても）──
  mark('v32: 罫線だけの断片の理由')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md')
    const req0 = readFileSync(reqPath, 'utf8')
    const rows = () => readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    writeFileSync(reqPath, req0.replace('## 2 ループ再生\n', '## 2 ループ再生\n\n│  ├─ ui/  画面の部品を置く\n'))
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    const u = rows().find(r => String(r.text).includes('画面の部品'))
    ok('v32 T14: 土台（罫線と語が同じ行の単位）がある', !!u, rows().map(r => r.text).join(' | ').slice(0, 160))
    if (u) {
      const d = rx('decompose', 'req->bd', u.unitId, JSON.stringify([
        { text: 'ui フォルダに画面の部品を置くこと', from: 'ui/  画面の部品を置く' },
        { skip: '│  ├─', why: '「│  ├─」はフォルダの図を描く罫線で、画面の部品の要求は含まない' }]))
      const ents = jsonOf(rx('show', 'req->bd', u.unitId))?.entries || []
      const sk = ents.find(x => x.as === '対象外'), rq = ents.find(x => x.as === '要求')
      const ap = rx('approve', 'req->bd', sk?.entryId || '', '要求でない', JSON.stringify({ why: '「│  ├─」は罫線記号だけの切れ端で、要求を含まない', kind: '書式・記号の切れ端' }))
      ok('v32 T14: 語の無い断片は、断片を逐語で含む理由で承認できる（単位の本文に語があっても）', d.status === 0 && ap.status === 0, errOf(ap).slice(0, 200))
      const ap2 = rx('approve', 'req->bd', rq?.entryId || '', '要求でない', JSON.stringify({ why: '「│  ├─」は罫線記号だけの切れ端で、要求を含まない', kind: 'ラベル・項目名' }))
      ok('v32 T14: 語のある断片には、今までどおり単位の本文との語の共有を求める', ap2.status !== 0 && /原文の語/.test(errOf(ap2)), errOf(ap2).slice(0, 200))
    }
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true })
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
  }

  // ── v33 T16：要件の逐語を書き換える（req-add replace）／T17：台帳の差し替えを打ち直す ──
  mark('v33: 要件の書き換え・差し替えの打ち直し')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' }
    const ra = (...a) => spawnSync(NODE, [join(HERE, 'req-add.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md')
    const req0 = readFileSync(reqPath, 'utf8')
    rmSync(join(TMP, '.claude/state/req-draft.json'), { force: true })
    const fx = '# 要件\n\n## 4.6 画面\n\n| # | 画面 | 形式 |\n|---|---|---|\n| 11 | 印刷プレビュー画面 | エクスポートでPDFを選んだ場合のみ遷移 |\n\n' +
      '```mermaid\nflowchart TD\n    L -->|PDF選択時のみ| M[印刷プレビュー画面]\n```\n\n' +
      '## 10. 変更履歴\n\n| # | 変更内容 | 変更前 | 変更後 |\n|---|---|---|---|\n| 1 | 保存先 | 固定 | 選択 |\n'
    writeFileSync(reqPath, fx)
    ra('open', '印刷プレビューを印刷の入口から開く形に変えたい')
    const r1 = ra('replace', 'エクスポートでPDFを選んだ場合のみ遷移', '印刷の入口から開く。エクスポート画面からは遷移しない', '--section', '4.6', '--history', '印刷プレビューの開き方を変えた')
    const t1 = readFileSync(reqPath, 'utf8')
    ok('v33 T16: 節の中で 1 か所だけ当たる逐語を書き換え、変更前の文を履歴に残す', r1.status === 0 &&
      t1.includes('| 11 | 印刷プレビュー画面 | 印刷の入口から開く。エクスポート画面からは遷移しない |') &&
      /^\| 2（.*） \| 印刷プレビューの開き方を変えた（4\.6節） \| エクスポートでPDFを選んだ場合のみ遷移 \| 印刷の入口から開く/m.test(t1), errOf(r1).slice(0, 200))
    const r2 = ra('replace', 'L -->|PDF選択時のみ| M[印刷プレビュー画面]', 'C -->|印刷| M[印刷プレビュー画面]', '--section', '4.6', '--history', '図の矢印を変えた')
    const t2 = readFileSync(reqPath, 'utf8')
    const row3 = t2.split('\n').find(l => l.startsWith('| 3（')) || ''
    ok('v33 T16: 「|」を含む文を書き換えても、履歴の表の列が崩れない', r2.status === 0 && t2.includes('    C -->|印刷| M[印刷プレビュー画面]') &&
      row3.split(/(?<!\\)\|/).length === 6, row3)
    const r3 = ra('replace', '印刷プレビュー画面', '別の名前', '--section', '4.6', '--history', '名前を変えた')
    ok('v33 T16: 2 か所以上当たる逐語は、どれを書き換えるか推測しない', r3.status !== 0 && /2 か所/.test(errOf(r3)) && readFileSync(reqPath, 'utf8') === t2)
    const r4 = ra('replace', '無い文字列', '何か', '--section', '4.6', '--history', 'x の変更')
    ok('v33 T16: 当たらない逐語は書かない', r4.status !== 0 && /0 か所/.test(errOf(r4)))
    writeFileSync(reqPath, req0)
    rmSync(join(TMP, '.claude/state/req-draft.json'), { force: true })

    // T17：差し替えの打ち直し（rename を差し替えて試す）
    const probe = `
      import { replaceFile } from ${JSON.stringify(pathToFileURL(join(HERE, 'ledger.mjs')).href)}
      import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
      const d = ${JSON.stringify(join(TMP, 'rf'))}
      const out = {}
      writeFileSync(d + '.dest', 'old'); writeFileSync(d + '.tmp', 'new')
      let n = 0
      out.retried = replaceFile(d + '.tmp', d + '.dest', { rename: (a, b) => { if (n++ < 2) { const e = new Error('x'); e.code = 'EPERM'; throw e } renameSync(a, b) } })
      out.after = readFileSync(d + '.dest', 'utf8')
      writeFileSync(d + '.tmp', 'new2')
      try { replaceFile(d + '.tmp', d + '.dest', { tries: 3, rename: () => { const e = new Error('x'); e.code = 'EPERM'; throw e } }) } catch (e) { out.msg = e.message }
      out.tmpLeft = existsSync(d + '.tmp'); out.kept = readFileSync(d + '.dest', 'utf8')
      writeFileSync(d + '.tmp', 'new3'); let m = 0
      try { replaceFile(d + '.tmp', d + '.dest', { rename: () => { m++; const e = new Error('x'); e.code = 'ENOENT'; throw e } }) } catch (e) { out.enoentCalls = m }
      console.log(JSON.stringify(out))`
    const pr = spawnSync(NODE, ['--input-type=module', '-e', probe], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const po = jsonOf(pr) || {}
    ok('v33 T17: EPERM は少し待って打ち直し、通れば差し替わる', po.retried === 2 && po.after === 'new', errOf(pr).slice(0, 200))
    ok('v33 T17: 打ち直しても駄目なら一時ファイルを消し、台帳は前のままで止まる', po.tmpLeft === false && po.kept === 'new' && /前のまま/.test(String(po.msg || '')))
    ok('v33 T17: 打ち直すのは EPERM などだけ（ほかの失敗はすぐ止める）', po.enoentCalls === 1)
  }

  // ── v34：段の名前（T18・T20）／区切り（T25）／heredoc（T21）／リンクの断片（T22）／節の番号（T23）／図の注記（T24）／単位の指定（T19）──
  mark('v34: 段の名前・区切り・heredoc・リンクの断片・節の番号・図の注記・単位の指定')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const st = (...a) => spawnSync(NODE, [join(HERE, 'state.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const bash = cmd => hook('pre-tool', { tool_name: 'Bash', tool_input: { command: cmd } })
    const reqPath = join(TMP, 'docs/req.md'), bdPath = join(TMP, 'docs/bd.md')
    const req0 = readFileSync(reqPath, 'utf8'), bd0 = readFileSync(bdPath, 'utf8')
    const rows = () => readFileSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const fresh = () => { rmSync(join(TMP, '.claude/coverage/edges/req-bd.jsonl'), { force: true }); sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd']) }
    const cur0 = existsSync(join(TMP, '.claude/state/current.json')) ? readFileSync(join(TMP, '.claude/state/current.json'), 'utf8') : null
    fresh()

    // T18：`req-bd` も同じ段として読む。切れた `req-` は今までどおり止める
    const p1 = jsonOf(rx('pending', 'req->bd', '--json')), p2 = jsonOf(rx('pending', 'req-bd', '--json'))
    ok('v34 T18: 段の名前は req-bd の形でも req->bd と同じ段として読む', !!p1 && !!p2 && p1.units === p2.units && p2.edge === 'req->bd', JSON.stringify(p2 || {}).slice(0, 160))
    const p3 = rx('pending', 'req-', '--json')
    ok('v34 T18: 切れた段の名前（req-）は、引用符を案内して止める', p3.status !== 0 && /引用符/.test(errOf(p3)))
    const g1 = st('goal', '--unit', '段の名前の形', '--goal', 'req-bd の形でゴールを置ける状態', '--verify-by', 'state.mjs show', '--edge', 'req-bd')
    const c1 = JSON.parse(readFileSync(join(TMP, '.claude/state/current.json'), 'utf8'))
    ok('v34 T18: state.mjs goal --edge req-bd は req->bd として置く', g1.status === 0 && c1.ledger?.edge === 'req->bd', errOf(g1).slice(0, 200))
    const wfSrc = n => readFileSync(join(HERE, '..', 'workflows', n), 'utf8')
    ok('v34 T18: ワークフローが子に渡す段の名前は - の形（> を含まない）', ['approve.js', 'settle.js', 'coverage.js'].every(n =>
      /const E = JSON\.stringify\(String\(EDGE\)\.includes\('->'\) \? String\(EDGE\)\.replace\('->', '-'\)/.test(wfSrc(n)) && /EDGE_NOTE/.test(wfSrc(n))))

    // T20：引用符なしの段の名前を打つ前に止める／直下に生えたファイルを終わるときに知らせる
    const b1 = bash('node .claude/scripts/ledger.mjs pending req->bd --json')
    ok('v34 T20: 段の名前を引用符なしで打つコマンドは止める', b1.status === 2 && /引用符で囲まれていません/.test(errOf(b1)), errOf(b1).slice(0, 200))
    const b2 = bash('node .claude/scripts/ledger.mjs pending "req->bd" --json'), b3 = bash("node .claude/scripts/ledger.mjs pending 'req->bd'")
    const b4 = bash('node .claude/scripts/ledger.mjs pending req-bd'), b5 = bash('git commit -m "req->bd の台帳を更新"')
    ok('v34 T20: 引用符の中・- の形・コミットの文は止めない', [b2, b3, b4, b5].every(r => r.status === 0), [b2, b3, b4, b5].map(r => r.status).join(','))
    writeFileSync(join(TMP, 'bd'), '')
    const s1 = hook('stop', { last_assistant_message: '確かめました。' })
    ok('v34 T20: リポジトリ直下に段の名前のファイルがあれば、終わるときに知らせて止める', s1.status === 2 && /段の名前と同じファイル/.test(errOf(s1)), errOf(s1).slice(0, 200))
    rmSync(join(TMP, 'bd'), { force: true })

    // T21：ファイルに書くだけの heredoc の本文はコマンドとして読まない。書き込み先と、実行する heredoc は今までどおり見る
    const h1 = bash("cat > /tmp/smoke-v34/dec.js <<'EOF'\nconst L = 'node .claude/scripts/ledger.mjs'\nconst f = x => '.claude/state/turn.json'\n- cp で .claude/scripts/ledger.mjs を写さない\nEOF")
    ok('v34 T21: scratchpad へ書く heredoc の本文にゲートの場所や => があっても止めない', h1.status === 0, errOf(h1).slice(0, 200))
    const h2 = bash("cat > .claude/state/x.json <<'EOF'\n{}\nEOF")
    ok('v34 T21: heredoc でもゲートの場所へ書くものは止める', h2.status === 2 && /ゲートが読む場所/.test(errOf(h2)))
    const h3 = bash("bash <<'EOF'\nrm -rf /\nEOF")
    ok('v34 T21: シェルに渡す heredoc の本文は、今までどおりコマンドとして読む', h3.status === 2)
    const h4 = bash("node -e \"const f = () => 1\" && echo x => .claude/state/turn.json")
    ok('v34 T21: => の後ろにゲートの場所があっても、> のリダイレクトとは読まない（書き込みの語が無いとき）', h4.status === 0, errOf(h4).slice(0, 200))

    // T25：--lines で区切る。狭めるときは残りの扱いを書かせ、範囲の外は止めずに数を知らせる
    const lines0 = rows().filter(r => r.file === 'docs/req.md').map(r => r.line).sort((a, b) => a - b)
    const L1 = lines0[0]
    const pl = jsonOf(rx('pending', 'req->bd', '--file', 'req.md', '--lines', `${L1}-${L1}`, '--json'))
    const pa = jsonOf(rx('pending', 'req->bd', '--file', 'req.md', '--json'))
    ok('v34 T25: --lines はその行の単位だけを数える', !!pl && !!pa && pl.units >= 1 && pl.units < pa.units, `範囲 ${pl?.units} / 全体 ${pa?.units}`)
    const bad1 = rx('pending', 'req->bd', '--lines', '1-9'), bad2 = rx('pending', 'req->bd', '--file', 'req.md', '--lines', '9')
    ok('v34 T25: --lines は --file と一緒に、「開始-終了」の形でだけ受ける', bad1.status !== 0 && bad2.status !== 0 && /--file/.test(errOf(bad1)) && /開始-終了/.test(errOf(bad2)))
    const gNo = st('goal', '--unit', '区切り', '--goal', '区切りの単位を分解した状態', '--verify-by', 'ledger pending', '--edge', 'req->bd', '--file', 'req.md', '--lines', `${L1}-${L1}`)
    ok('v34 T25: --lines で区切るときは --later（残りの扱い）が要る', gNo.status !== 0 && /--later/.test(errOf(gNo)))
    // 範囲の中の単位を分解してから、範囲だけを宣言して終わる → 止めずに、範囲の外の数を知らせる
    for (const u of rows().filter(r => r.file === 'docs/req.md' && r.line === L1)) {
      rx('decompose', 'req->bd', u.unitId, JSON.stringify([{ skip: u.text, why: `${u.text} は smoke の区切りの検査のために対象外として扱う` }]))
    }
    git('add', '-A'); git('commit', '-q', '-m', 'v34 base')
    writeFileSync(bdPath, bd0 + '\n区切りの検査のための 1 行。\n')
    sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
    writeFileSync(join(TMP, '.claude/state/current.json'), '{}')   // 前の節の adhoc の宣言を持ち越さない
    const later = 'req.md の残りの単位は次のターンで分解する（smoke）'
    const gOk = st('goal', '--unit', '区切り', '--goal', '区切りの単位を分解した状態', '--verify-by', 'ledger pending', '--edge', 'req->bd', '--file', 'req.md', '--lines', `${L1}-${L1}`, '--later', later)
    const s2 = hook('stop', { last_assistant_message: '区切りの単位を分解しました。' })
    ok('v34 T25: 区切りを宣言したときは、範囲の外の未分解で止めない', gOk.status === 0 && !/分母が固定されていません/.test(errOf(s2)), errOf(gOk).slice(0, 100) + ' / ' + errOf(s2).slice(0, 300))
    ok('v34 T25: 範囲の外の未分解の数と、宣言した扱いを知らせる', (/区切り（req\.md の/.test(errOf(s2)) && errOf(s2).includes(later)), `exit ${s2.status}: ${errOf(s2).slice(0, 1500)}`)
    st('goal', '--unit', '区切り', '--goal', '区切りの単位を分解した状態', '--verify-by', 'ledger pending', '--edge', 'req->bd', '--file', 'req.md')
    const s3 = hook('stop', { last_assistant_message: '区切りの単位を分解しました。' })
    ok('v34 T25: 区切りを外せば、今までどおり未分解で止める', s3.status === 2 && /分母が固定されていません/.test(errOf(s3)), errOf(s3).slice(0, 200))
    writeFileSync(bdPath, bd0); git('add', '-A'); git('commit', '-q', '-m', 'v34 restore')

    // T22：リンクだけの断片の expect は、単位の本文との語の共有でも通す（別の話は今までどおり弾く）
    writeFileSync(reqPath, req0 + '\n## 5 参照\n\nループの範囲の決め方は [[bd.md#2]]\n')
    fresh()
    const lu = rows().find(r => String(r.text).includes('[[bd.md#2]]'))
    ok('v34 T22: 土台（リンクで終わる単位）がある', !!lu, rows().map(r => r.text).join(' | ').slice(0, 160))
    if (lu) {
      const d = rx('decompose', 'req->bd', lu.unitId, JSON.stringify([
        { text: 'ループの範囲の決め方を定めること', from: 'ループの範囲の決め方は' },
        { skip: '[[bd.md#2]]', why: '[[bd.md#2]] は決め方が書かれた場所を指すリンク' }]))
      const ents = jsonOf(rx('show', 'req->bd', lu.unitId))?.entries || []
      const sk = ents.find(x => x.as === '対象外')
      const ap = rx('approve', 'req->bd', sk?.entryId || '', '要求', JSON.stringify({ why: 'ループの範囲の決め方は [[bd.md#2]] の中身そのものなので要求', expect: 'ループの範囲の決め方（開始小節と終了小節の選び方）が下位に書かれている' }))
      ok('v34 T22: リンクだけの断片の expect は、同じ単位の本文と語を共有すれば通す', d.status === 0 && ap.status === 0, errOf(ap).slice(0, 200))
      const ap2 = rx('approve', 'req->bd', sk?.entryId || '', '要求', JSON.stringify({ why: 'ループの範囲の決め方は [[bd.md#2]] の中身そのものなので要求', expect: 'テンポの上限を三百に定める一文が下位にある' }))
      ok('v34 T22: 単位の本文とも語を共有しない expect は、今までどおり弾く', ap2.status !== 0 && /1 語も共有していません/.test(errOf(ap2)), errOf(ap2).slice(0, 200))
    }
    writeFileSync(reqPath, req0); fresh()

    // T23：リンクの直後の番号が、行き先の別の節にあるなら指摘する
    writeFileSync(join(TMP, 'docs/dec.md'), '# 決定\n\n## 1. カテゴリA\n\n| A1 | 何か |\n\n## 2. カテゴリB\n\n| B3 | 何か |\n')
    writeFileSync(join(TMP, 'docs/uses.md'), '# 使う側\n\n誤り [[dec.md#1]]B3 と、正しい [[dec.md#2]]B3 と、別の文書の番号 [[dec.md#2]]C9。\n')
    const cl = jsonOf(sh('check-docs-links.mjs', ['--json'])) || { findings: [], advisories: [] }
    const mine = cl.findings.filter(x => x.file === 'docs/uses.md')
    ok('v34 T23: 番号が別の節にあるリンクだけをエラーにし、正しい節を示す', mine.length === 1 && mine[0].kind === 'id-in-other-section' && /2 節にある/.test(mine[0].why), JSON.stringify(mine).slice(0, 200))
    ok('v34 T23: 行き先の文書に無い番号は、エラーにせず助言にとどめる', cl.advisories.some(x => x.file === 'docs/uses.md' && x.kind === 'id-not-in-target'))
    rmSync(join(TMP, 'docs/dec.md'), { force: true }); rmSync(join(TMP, 'docs/uses.md'), { force: true })

    // T24：図にだけある注記（範囲・項目名）を知らせる。本文に同じ範囲があれば知らせない
    writeFileSync(bdPath, bd0 + '\n## 4 パート\n\n```mermaid\nerDiagram\n    PART {\n        int volume "0-100"\n    }\n```\n\nパートは volume を持つ。上限は 100 文字。\n')
    const f1 = jsonOf(sh('check-figure-notes.mjs', ['--json']))
    const v1 = (f1?.report || []).find(r => r.attr === 'volume')
    ok('v34 T24: 図にだけある範囲（0-100）を、数字が本文に散らばっていても知らせる', !!v1 && v1.suspect && v1.missingRanges.length === 1, JSON.stringify(f1 || {}).slice(0, 200))
    writeFileSync(bdPath, bd0 + '\n## 4 パート\n\n```mermaid\nerDiagram\n    PART {\n        int volume "0-100"\n    }\n```\n\nパートの volume は 0 から 100 の整数。\n')
    const f2 = jsonOf(sh('check-figure-notes.mjs', ['--json']))
    ok('v34 T24: 本文に同じ範囲があれば知らせない（終了コードは常に 0）', (f2?.report || []).every(r => r.attr !== 'volume') && sh('check-figure-notes.mjs', []).status === 0)
    writeFileSync(bdPath, bd0)

    // T19：coverage.js は単位を ID で選べ、渡した分け方を子への文面に載せる。子に渡す段の名前は - の形
    const simPath = join(HERE, 'lib', 'workflow-sim.mjs'), wf = join(HERE, '..', 'workflows', 'coverage.js')
    fresh()
    const und = jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || []
    if (existsSync(simPath) && und.length >= 2) {
      const { runWorkflow } = await import(pathToFileURL(simPath).href)
      let raw = null
      try {
        raw = await runWorkflow(wf, { edge: 'req->bd', units: [und[0]], rules: ['前置きの句は支える要求の with に入れる（smoke の決まり）'] },
          { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' }, scriptsDir: HERE })
      } catch (e) { raw = { error: String(e && e.message) } }
      const after = jsonOf(rx('pending', 'req->bd', '--json'))
      const prompts = (raw?.calls || []).map(c => String(c.body || c.prompt || ''))
      const decP = prompts.filter(p => p.includes('# 要求分解'))
      ok('v34 T19: units で選んだ単位だけを分解する', raw?.result?.decomposed === 1 && (after?.undecomposed ?? 0) === und.length - 1,
        `分解 ${raw?.result?.decomposed} / 未分解 ${after?.undecomposed}（前 ${und.length}）${raw?.error ? ' ' + raw.error : ''}`)
      ok('v34 T19: 渡した分け方（rules）が分解の文面と結果に載る', decP.length === 1 && decP[0].includes('smoke の決まり') && (raw?.result?.rules || []).length === 1)
      ok('v34 T18: 子に渡すコマンドの段の名前は "req-bd"（"req->bd" を渡さない）', prompts.length > 0 && prompts.every(p => !p.includes('"req->bd"')) && prompts.some(p => p.includes('"req-bd"')))
    } else ok('v34 T19: 土台（シミュレータと未分解 2 単位以上）がある', false, `未分解 ${und.length}`)
    fresh()
    if (cur0 === null) rmSync(join(TMP, '.claude/state/current.json'), { force: true }); else writeFileSync(join(TMP, '.claude/state/current.json'), cur0)
  }

  // ── v35：判定を受け先ごとにまとめる（judge-groups・judge.js）／承認を受け先ごとにまとめる／章を回す手順書 ──
  mark('v35: 判定の受け先ごとのまとめ・judge.js・承認のまとめ方・手順書')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const bdPath = join(TMP, 'docs/bd.md')
    const bd0 = readFileSync(bdPath, 'utf8')
    const edgeFile = join(TMP, '.claude/coverage/edges/req-bd.jsonl')
    const rows = () => readFileSync(edgeFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const judgedN = () => rows().reduce((a, r) => a + (Array.isArray(r.reqs) ? r.reqs.filter(q => q && q.verdict).length : 0), 0)
    const fresh = () => { rmSync(edgeFile, { force: true }); sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd']) }
    fresh()
    // 判定の対象を作る：全単位を 2 つに分ける（承認の節と同じ作り方）
    for (const cand of (jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || [])) {
      const v = jsonOf(rx('show', 'req->bd', cand))
      if (!v?.text) continue
      const S = String(v.text), h = Math.floor(S.length / 2)
      const A = S.slice(0, h).trim(), B = S.slice(h).trim()
      const r = rx('decompose', 'req->bd', cand, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
      if (r.status !== 0) rx('decompose', 'req->bd', cand, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
    }
    const all0 = jsonOf(rx('judge-groups', 'req->bd', '--max', '10'))
    const ids0 = (all0?.groups || []).flatMap(g => g.ids)
    ok('v35 T1: judge-groups は未判定の要求を全部、1 体 10 件までにまとめて返す', !!all0 && ids0.length >= 4 && ids0.length === all0.count &&
      new Set(ids0).size === ids0.length && all0.groups.every(g => g.ids.length >= 1 && g.ids.length <= 10),
      JSON.stringify(all0 || {}).slice(0, 200))
    ok('v35 T1: 印の無い要求は上位の節でまとめる（鍵が「（印なし）」で始まる）', (all0?.groups || []).length >= 2 && (all0?.groups || []).every(g => /^（印なし）docs\/req\.md/.test(g.key)),
      JSON.stringify((all0?.groups || []).map(g => g.key)).slice(0, 200))
    const two = jsonOf(rx('judge-groups', 'req->bd', '--max', '2'))
    const byKey2 = new Map()
    for (const g of (two?.groups || [])) { if (!byKey2.has(g.key)) byKey2.set(g.key, []); byKey2.get(g.key).push(g.ids.length) }
    ok('v35 T1: --max を超える受け先は等分に割る（どのまとまりも max 以下、同じ受け先の中で差は 1 以下）',
      !!two && two.count === ids0.length && [...byKey2.values()].every(ns => ns.every(n => n <= 2) && Math.max(...ns) - Math.min(...ns) <= 1),
      JSON.stringify([...byKey2.entries()]).slice(0, 200))
    const lim = jsonOf(rx('judge-groups', 'req->bd', '--limit', '3'))
    ok('v35 T1: --limit で件数を絞る', lim?.count === 3, `count=${lim?.count}`)

    // 印で受け先をまとめる：下位（bd.md）の 2 つの節に印を置く
    const tg = jsonOf(rx('tags', 'req->bd', '--json'))
    const tags = (tg?.tags || []).filter(t => ids0.includes(t.entryId))
    if (tags.length >= 4) {
      writeFileSync(bdPath, bd0 + `\n## 甲 一つ目\n\n印 <!-- req ${tags[0].tag} -->\n印 <!-- req ${tags[1].tag} -->\n\n## 乙 二つ目\n\n印 <!-- req ${tags[2].tag} -->\n`)
      const tj = jsonOf(rx('judge-groups', 'req->bd', '--max', '10'))
      const gOf = id => (tj?.groups || []).find(g => g.ids.includes(id))
      ok('v35 T1: 印が当たった要求は、下位のファイルと見出しの最初の語でまとめる',
        gOf(tags[0].entryId)?.key === 'docs/bd.md 甲' && gOf(tags[0].entryId) === gOf(tags[1].entryId) &&
        gOf(tags[2].entryId)?.key === 'docs/bd.md 乙' && /^（印なし）/.test(gOf(tags[3].entryId)?.key || ''),
        JSON.stringify((tj?.groups || []).map(g => [g.key, g.ids.length])).slice(0, 240))
      writeFileSync(bdPath, bd0)
    } else ok('v35 T1: 印を置く土台（要求 4 件以上の印）がある', false, `印 ${tags.length}`)
    const bad = rx('judge-groups', 'req->bd', '--ids', `${ids0[0]},docs/req.md#kdeadbeef`)
    ok('v35 T1: --ids に台帳に無い ID があれば、名前を出して止める', bad.status !== 0 && /台帳に無い要求 ID/.test(errOf(bad)), errOf(bad).slice(0, 200))

    // judge.js：一覧 → 判定（まとまりごとに 1 体）→ 台帳。名前で呼ばずパスで回す
    const simPath = join(HERE, 'lib', 'workflow-sim.mjs'), wfJ = join(HERE, '..', 'workflows', 'judge.js')
    ok('v35 T2: workflows/judge.js が在る', existsSync(wfJ))
    if (existsSync(simPath) && existsSync(wfJ) && ids0.length >= 4) {
      const { runWorkflow } = await import(pathToFileURL(simPath).href)
      const opt = { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' }, scriptsDir: HERE }
      // 書かない（dryRun）＋確かめ（review）
      const j0 = judgedN()
      let rd = null
      try { rd = await runWorkflow(wfJ, { edge: 'req->bd', limit: 4, max: 2, dryRun: true, review: true, segment: ['smoke の範囲の一行'] }, opt) } catch (e) { rd = { error: String(e && e.message) } }
      ok('v35 T2: dryRun は台帳に書かず、判定と根拠を返す', judgedN() === j0 && rd?.result?.dryRun === true && (rd?.result?.results || []).length === 4 &&
        (rd?.calls || []).filter(c => /^jdg:/.test(c.label || '')).every(c => !/ ledger\.mjs judge /.test(String(c.body))),
        `判定 ${j0}→${judgedN()} / ${JSON.stringify(rd?.result || rd).slice(0, 200)}`)
      const revCalls = (rd?.calls || []).filter(c => /^rev:/.test(c.label || ''))
      ok('v35 T2: review は「一致」を opus が根拠の逐語だけで確かめ、疑義を返す（文書を開かせない）',
        (rd?.result?.reviews || []).length === 4 && rd.result.reviews.some(x => x.doubt === true) && rd.result.reviews.some(x => x.doubt === false) &&
        revCalls.length >= 1 && revCalls.every(c => c.model === 'opus' && /文書を開かないこと/.test(String(c.body))),
        JSON.stringify(rd?.result?.reviews || []).slice(0, 200))
      // 書く
      let rj = null
      try { rj = await runWorkflow(wfJ, { edge: 'req->bd', limit: 5, max: 2, segment: ['smoke の範囲の一行'] }, opt) } catch (e) { rj = { error: String(e && e.message) } }
      const jc = (rj?.calls || []).filter(c => /^jdg:/.test(c.label || ''))
      const idsIn = c => [...String(c.body).matchAll(/^\d+\. (\S+#k[0-9a-f]+)$/gm)].map(m => m[1])
      ok('v35 T2: judge.js は渡した件数を判定して台帳に書く', rj?.result?.written === 5 && judgedN() === j0 + 5 && rj?.result?.status === 'complete',
        `書いた ${rj?.result?.written} / 台帳 ${j0}→${judgedN()} ${rj?.error || JSON.stringify(rj?.result?.failed || []).slice(0, 200)}`)
      ok('v35 T2: 判定役 1 体に渡すのは max 件まで、まとまりごとに 1 体', jc.length >= 3 && jc.every(c => idsIn(c).length >= 1 && idsIn(c).length <= 2) &&
        jc.reduce((a, c) => a + idsIn(c).length, 0) === 5, jc.map(c => idsIn(c).length).join(','))
      ok('v35 T2: 判定役の既定は opus、運び役は sonnet', jc.every(c => c.model === 'opus') &&
        (rj?.calls || []).filter(c => /^jgroups:/.test(c.label || '')).every(c => c.model === 'sonnet'))
      ok('v35 T2: 判定役の文面に、grep してから読む・1 件ずつ独立・この回の範囲の行・書くのは judge だけ、が載る',
        jc.every(c => /grep -n/.test(c.body) && /1 件ずつ独立に判定する/.test(c.body) && /smoke の範囲の一行/.test(c.body) && /書くのは `judge` だけ/.test(c.body)))
      ok('v35 T2: 判定役に渡す段の名前は "req-bd" の形', jc.every(c => c.body.includes('"req-bd"') && !c.body.includes('"req->bd"')))
      // 判定し直し（ids）：判定済みの要求も渡せば判定し直す
      const done = jc.flatMap(idsIn)   // いま判定して書いたもの（show の verdict は承認の答えなので使わない）
      let rr = null
      try { rr = await runWorkflow(wfJ, { edge: 'req->bd', ids: done.slice(0, 2) }, opt) } catch (e) { rr = { error: String(e && e.message) } }
      ok('v35 T2: ids を渡すと、判定済みのものも判定し直す', done.length >= 2 && rr?.result?.written === 2, `判定済み ${done.length} / 書いた ${rr?.result?.written} ${rr?.error || ''}`)
    } else ok('v35 T2: 土台（シミュレータと要求 4 件以上）がある', false, `要求 ${ids0.length}`)

    // 承認と settle：既定は 1 体 10 断片まで・受け先ごと・文字数の予算。文面に expect の語の決まり
    const wsrc = n => readFileSync(join(HERE, '..', 'workflows', n), 'utf8')
    ok('v35 T3: 承認・settle の既定は 1 体 10 断片まで、受け先（ファイルと節）ごとに組む（v36：窓 30・取り違えは 1 件ずつ）', ['approve.js', 'settle.js'].every(n =>
      /cfg\.perAgent \|\| 10\)/.test(wsrc(n)) && /function partOf\(e\) \{ return `\$\{e\.file \|\| ''\}\|\$\{e\.section \|\| ''\}` \}/.test(wsrc(n)) &&
      /groupEntries\(take\.filter\(e => !singles\.has\(e\.entryId\)\), PER_AGENT, CHAR_BUDGET\)/.test(wsrc(n)) && /cfg\.window\) \|\| 30/.test(wsrc(n))))
    ok('v35 T3: 承認・settle の文面に、expect に断片の語を入れる決まりと、リポジトリにファイルを作らない決まりが載る', ['approve.js', 'settle.js'].every(n =>
      wsrc(n).includes('\\`expect\\` には、断片の文に出てくる語（2 文字以上の漢字・カタカナの語か、3 文字以上の英字の語）を 1 つ以上そのまま入れる') &&
      wsrc(n).includes('リポジトリの中にファイルを作らない。コマンドを書くときは段の名前を引用符で囲む')))

    // T5：`` ` `` で囲んだ識別子は、長さによらず語に数える（turn 106 の `id`）
    {
      const reqP = join(TMP, 'docs/req.md'), r0 = readFileSync(reqP, 'utf8')
      writeFileSync(reqP, r0 + '\n曲のファイルは識別子 `id` を持つ。\n')
      fresh()
      const u = (jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || []).find(id => String(jsonOf(rx('show', 'req->bd', id))?.text || '').includes('`id`'))
      const S = u ? String(jsonOf(rx('show', 'req->bd', u)).text) : ''
      const rest = S.split('`id`').map(x => x.trim()).filter(Boolean).map(x => ({ skip: x, why: `「${x}」は識別子の前置きと述部なので対象外` }))
      const bad5 = u ? rx('decompose', 'req->bd', u, JSON.stringify([{ text: '曲に番号を持たせること', from: '`id`' }, ...rest])) : { status: 0 }
      const ok5 = u ? rx('decompose', 'req->bd', u, JSON.stringify([{ text: '曲に id を持たせること', from: '`id`' }, ...rest])) : { status: 1 }
      ok('v35 T5: 囲んだ識別子（`id`）は、もう一方の文に名前が語の境で現れれば共有とみなす', !!u && ok5.status === 0, errOf(ok5).slice(0, 240))
      ok('v35 T5: 名前が現れないもの（逆対照）は、今までどおり拒む', !!u && bad5.status !== 0 && /1 語も共有していません/.test(errOf(bad5)), errOf(bad5).slice(0, 200))
      writeFileSync(reqP, r0); fresh()
    }

    // 章を回す手順書：毎ターン新しいセッションで読む
    const chP = join(HERE, '..', 'commands', 'chapter.md')
    const ch = existsSync(chP) ? readFileSync(chP, 'utf8') : ''
    ok('v35 T4: 章を回す手順書（commands/chapter.md）が在り、3 段・上限・最初に読むものが書いてある',
      !!ch && /段 ①/.test(ch) && /段 ②/.test(ch) && /段 ③/.test(ch) && /判定 300/.test(ch) && /承認 450/.test(ch) &&
      /最初に読むもの/.test(ch) && /judge\.js/.test(ch) && /honnin-queue/.test(ch))
    ok('v35 T4: 手順書に実ファイルのフルパスを書かない', !!ch && !/[A-Za-z]:\\|\/Users\/|\/home\//.test(ch))
    fresh()
  }

  // ── v36：答えの取り違え（span の写し・approval-audit・approval-reset）／窓と取り直し／分解をまとめる ──
  mark('v36: 答えの取り違え・承認の洗い直し・窓・一覧の取り直し・分解のまとめ')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md'), req0 = readFileSync(reqPath, 'utf8')
    const edgeFile = join(TMP, '.claude/coverage/edges/req-bd.jsonl')
    const rows = () => readFileSync(edgeFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const fresh = () => { rmSync(edgeFile, { force: true }); sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd']) }
    const next = () => jsonOf(rx('approve-next', 'req->bd', '200'))?.entries || []
    const halves = () => {
      for (const cand of (jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || [])) {
        const v = jsonOf(rx('show', 'req->bd', cand))
        if (!v?.text) continue
        const S = String(v.text), h = Math.floor(S.length / 2)
        const A = S.slice(0, h).trim(), B = S.slice(h).trim()
        const r = rx('decompose', 'req->bd', cand, JSON.stringify([{ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B }]))
        if (r.status !== 0) rx('decompose', 'req->bd', cand, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
      }
    }

    // T1・T2・T3：同じ節に語の違う 2 つの単位を置き、片方に隣の断片の答えを書く
    writeFileSync(reqPath, req0 + '\n## 7 音色\n\n音色の一覧はギター系とベース系に分けて表示する。\n\nミキサーの音量スライダーは右端に置く。\n')
    fresh()
    for (const cand of (jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || [])) {
      const v = jsonOf(rx('show', 'req->bd', cand))
      const S = String(v?.text || '')
      if (/音色の一覧|ミキサーの音量/.test(S)) rx('decompose', 'req->bd', cand, JSON.stringify([{ text: `${S} を満たすこと`, from: S }]))
    }
    const es = next()
    const xE = es.find(e => /音色の一覧/.test(e.span)), yE = es.find(e => /ミキサーの音量/.test(e.span))
    if (xE && yE) {
      // T1：答えに写した span が断片と合わなければ、台帳が書かない（写しを付けない呼び出しは今までどおり）
      const yWhy = 'ミキサーの音量スライダーの置き場所を決める原文なので要求である'
      const bad1 = rx('approve', 'req->bd', yE.entryId, '要求', JSON.stringify({ why: yWhy, expect: 'ミキサーの音量スライダーを右端に置く', span: xE.span }))
      ok('v36 T1: 答えに写した span が別の断片なら、承認を書かない', bad1.status !== 0 && /別の断片のもの/.test(errOf(bad1)), errOf(bad1).slice(0, 200))
      const ok1 = rx('approve', 'req->bd', yE.entryId, '要求', JSON.stringify({ why: yWhy, expect: 'ミキサーの音量スライダーを右端に置く', span: yE.span }))
      ok('v36 T1: 写しが合えば書く（引用符の置き換えと空白の違いは見逃す）', ok1.status === 0, errOf(ok1).slice(0, 200))
      // T2：隣の断片の答え（音色の断片に、ミキサーの理由）を写しなしで書き、approval-audit が疑いとして出す
      const w2 = rx('approve', 'req->bd', xE.entryId, '要求でない', JSON.stringify({ why: '原文の「音色」の行だが、ミキサーの音量スライダーは右端に置くという配置の話', kind: 'ラベル・項目名' }))
      const au = jsonOf(rx('approval-audit', 'req->bd', '--json'))
      const sus = (au?.rows || []).map(x => x.entryId)
      ok('v36 T2: approval-audit は、隣の断片の語で書かれた答えを疑いとして出し、自分の断片に触れた答えは出さない',
        w2.status === 0 && sus.includes(xE.entryId) && !sus.includes(yE.entryId), `書き込み ${w2.status} / 疑い ${JSON.stringify(sus)} ${errOf(w2).slice(0, 120)}`)
      // T3：approval-reset で未承認へ戻す。記録は残す。本人待ちと、答えの無いものは戻さない。サブエージェントには打たせない
      const rs = rx('approval-reset', 'req->bd', xE.entryId, '--why', 'approval-audit で隣の断片の語の答えと出たので聞き直す')
      const back = next().some(e => e.entryId === xE.entryId)
      const node = rows().flatMap(r => [...(r.reqs || [])]).find(q => /音色の一覧/.test(String(q.from || '')))
      ok('v36 T3: approval-reset は承認役の答えを外して未承認に戻し、外した答えを残す', rs.status === 0 && back &&
        (node?.priorRecords?.resetApprovals || []).length === 1 && node.priorRecords.resetApprovals[0].approval?.verdict === '要求でない', errOf(rs).slice(0, 200))
      const rs2 = rx('approval-reset', 'req->bd', xE.entryId, '--why', 'もう一度戻そうとしても答えが無いので断られるはず')
      ok('v36 T3: 答えの無い断片は戻さない', rs2.status !== 0 && /戻す答えがありません/.test(errOf(rs2)))
      const subR = hook('pre-tool', { tool_name: 'Bash', agent_id: 'a1b2c3', agent_type: 'general-purpose',
        tool_input: { command: `node .claude/scripts/ledger.mjs approval-reset "req-bd" "${yE.entryId}" --why "サブエージェントが戻そうとしている"` } })
      ok('v36 T3: サブエージェントには approval-reset を打たせない（ゲート）', subR.status === 2)
    } else ok('v36 T1: 土台（同じ節の 2 つの断片）がある', false, JSON.stringify(es.map(e => e.span)).slice(0, 200))
    writeFileSync(reqPath, req0)

    // T4：approve.js は、取り違えた答え（entryId がずれた）を書かずに 1 件ずつ聞き直す。窓は既定 30、読めなければ半分にして取り直す
    const simPath = join(HERE, 'lib', 'workflow-sim.mjs')
    const wfP = join(HERE, '..', 'workflows', 'approve.js'), wfC = join(HERE, '..', 'workflows', 'coverage.js')
    if (existsSync(simPath)) {
      const { runWorkflow } = await import(pathToFileURL(simPath).href)
      const opt = extra => ({ cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' }, scriptsDir: HERE, ...extra })
      fresh(); halves()
      let r4 = null
      try { r4 = await runWorkflow(wfP, { edge: 'req->bd', batch: 3 }, opt({ shiftOnce: true })) } catch (e) { r4 = { error: String(e && e.message) } }
      const appr = rows().flatMap(r => [...(r.reqs || []).map(q => ({ span: String(q.from || ''), a: q.approval })), ...(r.skips || []).map(k => ({ span: String(k.skip || ''), a: k.approval }))]).filter(x => x.a)
      const wrong = appr.filter(x => !String(x.a.why || '').includes(x.span))
      const singlesCalls = (r4?.calls || []).filter(c => /^apr:/.test(c.label || '') && groupsOfCall(c)?.n === 1)
      ok('v36 T4: approve.js は取り違えた体の答えを書かず、その断片を 1 件ずつ聞き直す', (r4?.result?.misattributed || 0) >= 1 &&
        (r4?.result?.ledger?.unseen ?? -1) === 0 && appr.length >= 4 && wrong.length === 0 && singlesCalls.length >= 2,
        `取り違え ${r4?.result?.misattributed} / 未承認 ${r4?.result?.ledger?.unseen} / 自分の断片でない理由 ${wrong.length} / 1 件の体 ${singlesCalls.length} ${r4?.error || ''}`)
      const aprBodies = (r4?.calls || []).filter(c => /^apr:/.test(c.label || '')).map(c => String(c.body))
      ok('v36 T4: 承認役の文面に、span を写す決まりと、委ねられた値を expect に決めて書かない決まりが載る',
        aprBodies.length > 0 && aprBodies.every(b => /その断片の `span` をそのまま写す/.test(b) && /expect に値を決めて書かない/.test(b)))
      fresh(); halves()
      let r5 = null
      try { r5 = await runWorkflow(wfP, { edge: 'req->bd', batch: 1 }, opt({ fetchFailAt: 'fetch:1' })) } catch (e) { r5 = { error: String(e && e.message) } }
      ok('v36 T4: 一覧が読めなければ窓を半分にして取り直し、理由を報告に残す（黙って止めない）', (r5?.result?.ledger?.unseen ?? -1) === 0 &&
        (r5?.result?.stopReasons || []).some(x => /取り直します/.test(x)) && r5?.result?.window === 10,   // batch 1 × perAgent 10 と既定の 30 の小さいほう
        JSON.stringify({ unseen: r5?.result?.ledger?.unseen, stop: r5?.result?.stopReasons, window: r5?.result?.window, err: r5?.error }).slice(0, 240))

      // T5：coverage.js は分解を 1 体に複数の単位で渡す（既定 5、perAgent で変える）。一覧が読めなければ 1 回だけ取り直す
      fresh()
      const und = jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || []
      let r6 = null
      try { r6 = await runWorkflow(wfC, { edge: 'req->bd', perAgent: 2 }, opt({ listFailOnce: true })) } catch (e) { r6 = { error: String(e && e.message) } }
      const decCalls = (r6?.calls || []).filter(c => /^dec:/.test(c.label || ''))
      const idsIn = c => [...String(c.body).matchAll(/^\d+\. (\S+:\S+)$/gm)].map(m => m[1])
      const after = jsonOf(rx('pending', 'req->bd', '--json'))
      ok('v36 T5: 分解は 1 体に perAgent 個までの単位を渡し、渡した単位を全部書く', und.length >= 3 && decCalls.length === Math.ceil(und.length / 2) &&
        decCalls.every(c => idsIn(c).length >= 1 && idsIn(c).length <= 2) && r6?.result?.decomposed === und.length && (after?.undecomposed ?? -1) === 0,
        `単位 ${und.length} / 体 ${decCalls.length}（${decCalls.map(c => idsIn(c).length).join(',')}）/ 分解 ${r6?.result?.decomposed} / 未分解 ${after?.undecomposed} ${r6?.error || ''} ${JSON.stringify(idsIn(decCalls[0] || {}))}`)
      ok('v36 T5: 分解役の文面に、1 単位ずつ独立に・単位ごとに show で読み直す、が載る', decCalls.some(c => idsIn(c).length === 2) &&
        decCalls.filter(c => idsIn(c).length === 2).every(c => /1 単位ずつ独立に分解する/.test(c.body) && /単位ごとに show で原文を読み直し/.test(c.body)))
      ok('v36 T5: 一覧役が JSON を返さなかったら、別の役で 1 回だけ取り直して続ける', r6?.result?.listRetries === 1 && (r6?.result?.decomposed || 0) >= 1,
        `取り直し ${r6?.result?.listRetries} / 分解 ${r6?.result?.decomposed}`)
      ok('v36 T5: 一覧・取り出しの役の前置きに「最初に読むもの・前提の確かめはあなたに当たらない」が載る', ['approve.js', 'settle.js', 'coverage.js'].every(n =>
        /あなたには当たりません/.test(readFileSync(join(HERE, '..', 'workflows', n), 'utf8'))))
      fresh()
    } else ok('v36 T4: シミュレータがある', false)

    // T6：手順書に v36 の手順（洗い直し・分類器の一時的なエラー・settle の再分解）が書いてある
    const ch = readFileSync(join(HERE, '..', 'commands', 'chapter.md'), 'utf8')
    ok('v36 T6: 手順書に、承認の洗い直し・分類器の一時的なエラー・settle の再分解の手順が書いてある',
      /approval-audit/.test(ch) && /approval-reset/.test(ch) && /一時的なエラー/.test(ch) && /再分解が要る/.test(ch))
  }

  // ── v37：上位の本文が変わっても同じ断片の承認と本人待ちを引き継ぐ／前の対象外を残す／写しの全角と半角 ──
  mark('v37: 承認の引き継ぎ・前の対象外・写しの全角と半角・手順書のリンク')
  {
    const X = { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1', CLAUDE_LEDGER_ALLOW_NON_TTY: '1' }
    const rx = (...a) => spawnSync(NODE, [join(HERE, 'ledger.mjs'), ...a], { cwd: TMP, encoding: 'utf8', timeout: 60_000, env: X })
    const errOf = r => String(r.stderr || '') + String(r.stdout || '')
    const reqPath = join(TMP, 'docs/req.md'), req0 = readFileSync(reqPath, 'utf8')
    const edgeFile = join(TMP, '.claude/coverage/edges/req-bd.jsonl')
    const fresh = () => { rmSync(edgeFile, { force: true }); sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd']) }
    const und = () => jsonOf(rx('pending', 'req->bd', '--json'))?.undecomposedIds || []
    const unitWith = s => und().find(id => String(jsonOf(rx('show', 'req->bd', id))?.text || '').includes(s))
    const ents = u => jsonOf(rx('show', 'req->bd', u))?.entries || []
    const counts = () => jsonOf(rx('approval-report', 'req->bd', '--json'))?.counts || {}
    fresh()

    // T1：要求と対象外の両方を承認してから、上位の本文の別の所を直す → 同じ断片は承認を引き継ぎ、前の分け方が show に出る
    const u1 = unitWith('小節範囲を指定してループ再生できる')
    if (u1) {
      const D = [{ text: '小節範囲を指定できること', from: '小節範囲を指定して' }, { skip: 'ループ再生できる。', why: 'ループ再生できるは 2 節の見出しの言い直しなので対象外' }]
      rx('decompose', 'req->bd', u1, JSON.stringify(D))
      const e1 = ents(u1)
      const r1 = e1.find(x => x.as === '要求'), k1 = e1.find(x => x.as === '対象外')
      rx('approve', 'req->bd', r1.entryId, '要求', JSON.stringify({ why: '小節範囲を指定するという原文の操作なので要求', expect: '小節範囲を指定してループの区間を決める', span: r1.span }))
      rx('approve', 'req->bd', k1.entryId, '要求でない', JSON.stringify({ why: 'ループ再生できるは見出しの言い直しで要求ではない', kind: 'ラベル・項目名', span: k1.span }))
      writeFileSync(reqPath, req0.replace('小節範囲を指定してループ再生できる。', '小節範囲を指定して、ループ再生できる。'))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const n1 = unitWith('小節範囲を指定して、ループ再生できる')
      const sh1 = n1 ? jsonOf(rx('show', 'req->bd', n1)) : null
      ok('v37 T1: 分け直す単位の show に、前の分け方（要求と対象外）が出る', !!sh1 && (sh1.prevEntries || []).length === 2 &&
        sh1.prevEntries.some(x => x.as === '対象外' && x.span === 'ループ再生できる。'), JSON.stringify(sh1?.prevEntries || null).slice(0, 200))
      const d1 = n1 ? rx('decompose', 'req->bd', n1, JSON.stringify(D)) : { status: 1 }
      const after = n1 ? ents(n1) : []
      ok('v37 T1: 上位の本文が変わっても、前と同じ断片（要求も対象外も）は承認を引き継ぐ', d1.status === 0 && after.length === 2 &&
        after.every(x => x.approval === '承認') && /承認を引き継ぎました/.test(errOf(d1)), errOf(d1).slice(0, 200))
      const D2 = [{ text: '小節範囲を指定して区間を決めること', from: '小節範囲を指定して' }, { skip: 'ループ再生できる。', why: 'ループ再生できるは 2 節の見出しの言い直しなので対象外' }]
      const d2 = rx('decompose', 'req->bd', n1, JSON.stringify(D2))
      ok('v37 T1: 要求の文を変えた断片は引き継がない（未承認に戻る）', d2.status === 0 && ents(n1).find(x => x.as === '要求')?.approval === '未承認', errOf(d2).slice(0, 200))
    } else ok('v37 T1: 土台（ループ再生の単位）がある', false)
    writeFileSync(reqPath, req0); fresh()

    // T2：本人待ちの断片も、同じ断片なら本人待ちのまま引き継ぎ、前の版の本人待ちとして二重に数えない
    const u2 = unitWith('テンポは 20 から 300 の範囲で指定できる')
    if (u2) {
      rx('decompose', 'req->bd', u2, JSON.stringify([{ text: 'テンポは 20 から 300 の範囲に限ること', from: 'テンポは 20 から 300 の範囲' }, { text: 'テンポを画面で指定できること', from: 'で指定できる' }]))
      const a = ents(u2).find(x => x.span === 'テンポは 20 から 300 の範囲')
      rx('approve', 'req->bd', a.entryId, '要求でない', JSON.stringify({ why: 'テンポは 20 から 300 の範囲という数の範囲の前置きで、要求ではない', kind: '根拠・前提の説明' }))
      rx('settle', 'req->bd', a.entryId, '要求', JSON.stringify({ why: 'テンポは 20 から 300 の範囲に限るという原文の決まりなので要求', expect: 'テンポは 20 から 300 の範囲に限る' }))
      const h = rx('hold', 'req->bd', a.entryId, '--why', 'テンポの範囲の断片で 1 周目と 2 周目が割れた')
      writeFileSync(reqPath, req0.replace('テンポは 20 から 300 の範囲で指定できる。', 'テンポは 20 から 300 の範囲で、画面から指定できる。'))
      sh('split.mjs', ['--all']); sh('ledger.mjs', ['sync', 'req->bd'])
      const n2 = unitWith('画面から指定できる')
      const before = counts()
      const d = n2 ? rx('decompose', 'req->bd', n2, JSON.stringify([{ text: 'テンポは 20 から 300 の範囲に限ること', from: 'テンポは 20 から 300 の範囲' }, { text: 'テンポを画面から指定できること', from: 'で、画面から指定できる' }])) : { status: 1 }
      const c = counts()
      const st = n2 ? ents(n2).map(x => x.approval) : []
      ok('v37 T2: 本人待ちの断片は、同じ断片なら本人待ちのまま引き継ぎ、前の版の本人待ちとは二重に数えない',
        h.status === 0 && before.waitingCarried === 1 && d.status === 0 && st.includes('本人待ち') && st.includes('未承認') && c.waiting === 1 && !c.waitingCarried,
        `前 ${JSON.stringify(before)} / 後 ${JSON.stringify(c)} / ${st.join(',')} ${errOf(d).slice(0, 120)}`)
    } else ok('v37 T2: 土台（テンポの単位）がある', false)
    writeFileSync(reqPath, req0); fresh()

    // T3：答えに写した span は、全角と半角・強調の ** の違いを見逃す（別の断片の写しは今までどおり弾く）
    const u3 = unitWith('範囲外の値は 20 か 300 に丸める')
    if (u3) {
      rx('decompose', 'req->bd', u3, JSON.stringify([{ text: '範囲外の値は 20 か 300 に丸めること', from: '範囲外の値は 20 か 300 に丸める' }]))
      const e3 = ents(u3)[0]
      const w = '範囲外の値を 20 か 300 に丸めるという原文の決まりなので要求'
      const z = rx('approve', 'req->bd', e3.entryId, '要求', JSON.stringify({ why: w, expect: '範囲外の値は 20 か 300 に丸める', span: '**範囲外の値は ２０ か ３００ に丸める**' }))
      ok('v37 T3: 写しの全角と半角・** の違いは見逃す', z.status === 0, errOf(z).slice(0, 200))
      const y = rx('approve', 'req->bd', e3.entryId, '要求', JSON.stringify({ why: w, expect: '範囲外の値は 20 か 300 に丸める', span: 'テンポは 20 から 300 の範囲' }))
      ok('v37 T3: 別の断片の写しは今までどおり弾く', y.status !== 0 && /別の断片のもの/.test(errOf(y)))
      const src = n => readFileSync(join(HERE, '..', 'workflows', n), 'utf8')
      ok('v37 T3: approve.js・settle.js の写しの照らし合わせも NFKC と ** を見逃す', ['approve.js', 'settle.js'].every(n => /normalize\('NFKC'\)\.replace\(\/\\\*\\\*\/g, ''\)/.test(src(n))))
    } else ok('v37 T3: 土台（丸めの単位）がある', false)
    fresh()

    // T4：手順書（.claude/commands/chapter.md）に、コードの外の [[…]] を書かない（check-docs-links が .claude/ の Wikilink をエラーにする）
    const ch = readFileSync(join(HERE, '..', 'commands', 'chapter.md'), 'utf8')
    const bare = ch.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    ok('v37 T4: 手順書のコードの外に [[ が無い（Stop hook の検証を赤にしない）', !/\[\[/.test(bare), (bare.match(/.{0,20}\[\[.{0,20}/) || [''])[0])
    ok('v37 T4: 手順書に、前の分け方（prevEntries）と承認の引き継ぎと本人のコマンドの材料の書き方がある',
      /prevEntries/.test(ch) && /承認と本人待ちを引き継ぐ/.test(ch) && /honnin_run\.mjs/.test(ch))
  }

  // ── 塞いだ穴: verify.json を偽造しても検証は走る ─────────────────────
  {
    writeFileSync(join(TMP, '.claude/state/verify.json'), JSON.stringify({
      at: new Date(Date.now() + 86400000).toISOString(), mode: 'code', ok: true, results: [],
      hash: 'ffffffffffffffff', entries: { typecheck: { ok: true } },
    }))
    const r = sh('verify.mjs', ['--json'])
    const v = jsonOf(r)
    const used = (v?.results || []).find(x => x.name === 'typecheck')
    ok('verify: 偽造したキャッシュを使わない', !!used && used.cached !== true,
      '鍵は verify.mjs が自分で計算した内容ハッシュなので、書き換えても一致しない')
  }
} catch (e) {
  ok('smoke 自体が例外で停止', false, String(e && e.stack || e))
} finally {
  if (TMP && !process.env.SMOKE_KEEP) { try { rmSync(TMP, { recursive: true, force: true }) } catch { /* 後始末の失敗は結果に影響しない */ } }
  if (process.env.SMOKE_KEEP) console.error('TMP=' + TMP)
}

// ════════════════════════════════════════════════════════════════════════
printed = true    // ここから先は正常経路。exit の保険を黙らせる
const failed = results.filter(r => !r.pass)
if (json) {
  console.log(JSON.stringify({ ok: !failed.length, total: results.length, failed: failed.length, results }, null, 2))
} else {
  for (const r of results) {
    if (!r.pass || verbose) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? `\n    ${r.detail}` : ''}`)
  }
  console.log(`\nsmoke: ${results.length - failed.length}/${results.length} 緑`)
  if (failed.length) {
    console.log('\n**検査スクリプト自身が壊れています。これ以降の検査結果を信用しないでください。**')
  }
}
process.exit(failed.length ? 1 : 0)
