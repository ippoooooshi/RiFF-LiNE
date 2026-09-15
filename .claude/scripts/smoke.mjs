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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
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
      const concAgain = sh('ledger.mjs', ['concede', 'req->bd', `${U}#0`])
      ok('承認: 指摘を受けていない断片には同意させない',
        concAgain.status !== 0 && /「指摘」ではありません/.test(errOf(concAgain)),
        '承認済みのものを黙って対象外に落とせると、分母を自分で削れる')
      // 元に戻して反論の検査へ（同じ断片をもう一度「指摘」にする）
      dec2({ text: `${A} を満たすこと`, from: A }, { text: `${B} を満たすこと`, from: B })
      apr(`${U}#1`, '要求でない', { why: WHY, kind: 'ラベル・項目名' })

      // ── 反論 ────────────────────────────────────────────────────────
      const rNoExp = reb(`${U}#1`, { why: `${A} は独立した要求であり下位に無ければ不備になる` })
      ok('承認: expect の無い反論を拒否する',
        rNoExp.status !== 0 && /要求として維持するなら expect/.test(errOf(rNoExp)),
        '**反論を無料にしない。** 承認する側に課したのと同じ作文を、維持する側にも課す')
      const rThin = reb(`${U}#1`, { why: '要求だから', expect: `${B} を下位の設計で定める` })
      ok('承認: 中身の無い反論を拒否する',
        rThin.status !== 0 && /反論が不十分/.test(errOf(rThin)))
      const rOk = reb(`${U}#1`, { why: `${A} に続く記述であり下位に無ければ不備になる`, expect: `${B} を下位の設計で定める` })
      ok('承認: 作文つきの反論は「反論で維持」として通る', rOk.status === 0, errOf(rOk).slice(0, 200))
      const rAgain = reb(`${U}#0`, { why: `${A} は独立した要求であり下位に無ければ不備になる`, expect: EXPECT })
      ok('承認: 指摘を受けていない断片に反論させない',
        rAgain.status !== 0 && /「指摘」ではありません/.test(errOf(rAgain)),
        '全部に反論を貼って未解決を消す道を塞ぐ')
      const rep1 = jsonOf(sh('ledger.mjs', ['approval-report', 'req->bd', '--json']))
      ok('承認: 反論で通した件数が別枠で数えられる', (rep1?.counts?.heldOver || 0) >= 1,
        '**多いときは、承認する側ではなく分解のほうを疑うための数字。** 混ぜると見えなくなる')


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
      const e0 = (show3?.entries || []).find(x => x.entryId === `${U}#0`)
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
        ok('承認: 役の定義にファイルを開くツールが入っていない',
          !!toolsLine.trim() && !/\b(Read|Grep|Glob|Bash|Edit|Write)\b/.test(toolsLine),
          `tools: ${JSON.stringify(toolsLine)}\n` +
          `    **下位を開けるツールがあると「下位に無いものだけが要求でない」に落ちる。**\n` +
          `    空にすると起動に失敗するので、ファイルを読めないツール 1 つだけを置く`)

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
        const perCall = callsP.filter(c => /^apr:/.test(c.label || ''))
        ok('workflow: 承認は 1 断片ずつ独立に呼ばれる（既定）',
          perCall.length >= 3 && perCall.every(c => !/\+\d/.test(String(c.label))),
          `呼び出し ${perCall.length} 件。既定の perAgent は 1`)

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
        ok('workflow: 取得と書き戻しを親が別のエージェントにやらせている',
          callsP.some(c => /^fetch:/.test(c.label || '')) && callsP.some(c => /^write:/.test(c.label || '')),
          `fetch/write の呼び出しが要る: ${callsP.map(c => c.label).join(' ')}`)

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
        ok('smoke: 失敗ケースと食い違いケースの断片が在る', badP.size === 1 && disP.size === 1,
          `未承認 ${idsP.length} 件。**足りないとこの節が黙って空振りする**`)
        let resP2 = null
        try {
          const raw = await runWorkflow(wfP, { edge: 'req->bd', batch: 3 },
            { cwd: TMP, env: { ...process.env, CLAUDE_PROJECT_DIR: TMP, CLAUDE_VERIFY_NESTED: '1' },
              scriptsDir: HERE, failIds: badP, disagreeIds: disP })
          resP2 = raw?.result || null
        } catch { /* 落ちたら下で赤になる */ }
        ok('workflow: 書き戻しに失敗した断片を除外して先へ進む',
          !!resP2 && (resP2.failed || 0) === badP.size && (resP2.ledger?.ok || 0) >= 1,
          `失敗 ${resP2?.failed ?? '?'}（期待 ${badP.size}）/ 台帳の承認 ${resP2?.ledger?.ok ?? '?'}`)
        ok('workflow: 失敗を握り潰して complete と報告しない', resP2?.status === 'partial',
          `status=${resP2?.status}`)
        ok('workflow: 食い違いが指摘として報告に出る',
          (resP2?.ledger?.challenged || 0) >= 1 && (resP2?.challengedIds || []).length >= 1,
          `指摘 ${resP2?.ledger?.challenged ?? '?'} 件 / 一覧 ${(resP2?.challengedIds || []).length} 件\n` +
          `    **指摘は消えない。** 消えるなら、承認が漏れを作る側に回っている`)
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
