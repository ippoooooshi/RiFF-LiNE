// ワークフロー（.claude/workflows/*.js）を、本物のエージェントを使わずに実行する。
//
// なぜこれがあるか:
//   coverage.js / audit.js の制御構造（失敗 ID の除外、ウィンドウ送り、照合結果の適用、
//   NOT_REVIEWED の分離）は、Claude Code の Workflow ツールでしか走らないため
//   selftest で一度も検査できず、F32・F45 が回帰ケース無しのまま残っていた。
//   エージェントを「プロンプト中のコマンドを実行して型どおりの答えを返す」偽物に
//   置き換えれば、制御構造だけを決定論的に検査できる。
//
//   偽物が検査するのは **スクリプトの制御構造**であって、判定の質ではない。
//   判定の質は実走行（req->bd のベンチマーク）で見る。
//
// 使い方（selftest から）:
//   const { runWorkflow } = await import('./lib/workflow-sim.mjs')
//   const result = await runWorkflow(path, args, { cwd, env, failIds: new Set([...]), reviews: [...], critics: [...] })
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// コマンド文字列を argv へ切る。**シェルを通さない。**
//
// 以前は spawnSync(cmd, { shell: true }) だった。Windows では既定のシェルが cmd.exe で、
// cmd.exe は POSIX の単一引用符を引用符として扱わない。coverage.js のプロンプトは
// JSON 配列を '…' で囲んで渡す規約なので、Windows ではトークン分割が壊れ、
// decompose / judge への書き戻しが失敗する——**回帰検査 4 件が Windows でだけ空振りしていた**。
// 実運用の報告で判明（本物のエージェントは git-bash 経由なので影響を受けていなかった）。
//
// ここが模しているのは「エージェントが bash でコマンドを実行する」ことなので、
// ホストのシェルの引用規則に依存させない。POSIX の引用規則で自前に切る。
export function argvOf(cmd) {
  const out = []
  let cur = '', q = null, started = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q === "'") { if (c === "'") q = null; else cur += c; continue }
    if (q === '"') {
      if (c === '\\' && i + 1 < cmd.length && '"\\$`'.includes(cmd[i + 1])) { cur += cmd[++i]; continue }
      if (c === '"') q = null; else cur += c
      continue
    }
    if (c === "'" || c === '"') { q = c; started = true; continue }
    if (/\s/.test(c)) { if (cur || started) { out.push(cur); cur = ''; started = false } continue }
    cur += c
  }
  if (cur || started) out.push(cur)
  if (q) throw new Error(`引用符が閉じていません: ${cmd}`)
  return out
}


export async function runWorkflow(file, args, opts = {}) {
  const src = readFileSync(file, 'utf8').replace(/^export\s+const\s+meta/m, 'const meta')
  const calls = []                      // 全 agent 呼び出しの記録（label / prompt の先頭）
  const logs = []
  const { cwd, env = process.env, failIds = new Set(), reviews = null, critics = null,
          evidenceCheck = null, scriptsDir = null,
          // approve.js 用。ここに入れた entryId は「分解した側と逆の答え」を返す＝指摘になる。
          disagreeIds = new Set() } = opts

  function sh(cmd0) {
    // プロンプトはコマンドを `…` で囲んで渡す規約。バッククォート内の node コマンドを取る。
    // フィクスチャには scripts が無いので、`.claude/scripts/` を本体の場所へ差し替える。
    const cmd = scriptsDir ? cmd0.replaceAll('.claude/scripts/', scriptsDir.replaceAll('\\', '/') + '/') : cmd0
    const argv = argvOf(cmd)
    const r = spawnSync(argv[0], argv.slice(1),
      { cwd, shell: false, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 })
    return { out: (r.stdout || ''), err: (r.stderr || ''), code: r.status }
  }
  const cmdsIn = prompt => [...String(prompt).matchAll(/`(node [^`]+)`/g)].map(m => m[1])

  async function agent(prompt, o = {}) {
    // prompt は表示用の頭 80 字、body は全文。
    // **全文を残さないと「プロンプトに何が載っているか」を検査できない。**
    // 頭だけで見ていたせいで、承認する側にコマンドを渡す逆対照が空振りした（2026-09-15）。
    calls.push({ label: o.label, phase: o.phase, prompt: String(prompt).slice(0, 80), body: String(prompt) })
    const cmds = cmdsIn(prompt)
    const label = o.label || ''

    // ── coverage.js ────────────────────────────────────────────────────
    if (/^list-[dj]:/.test(label)) {
      const r = sh(cmds[0])
      try { return JSON.parse(r.out) } catch { return null }
    }
    if (/^dec:/.test(label)) {
      // show → 原文を下限ぶんに切って decompose
      //
      // **文字列の配列ではない。** 2026-09-15 に分解の書式が変わり、要求ごとに
      // 「原文のどこから読み取ったか」を逐語で添えることになった。
      // 偽物のエージェントも同じ書式で書き戻さないと、ここは「本物なら通る入力」を
      // 作らないことになり、制御構造の検査が**書式エラーの検査に化ける**。
      // 原文を下限ぶんの重ならない区間へ機械的に切り、各区間を 1 要求に充てる。
      const show = JSON.parse(sh(cmds[0]).out)
      const id = show.unitId
      if (failIds.has(id)) return { unitId: id, requirements: [], written: false, cliOutput: 'simulated failure' }
      const src = String(show.text || '')
      const n = Math.max(1, show.minReq || 1)
      const size = Math.max(1, Math.ceil(src.length / n))
      const entries = []
      for (let i = 0; i < n && i * size < src.length; i++) {
        const frag = src.slice(i * size, Math.min(src.length, (i + 1) * size))
        // 要求の文は 8 文字以上・出どころと 1 語以上を共有する必要がある。
        // 区間そのものを含めておけば、どちらも必ず満たす。
        entries.push({ text: `${frag} を満たすこと`, from: frag })
      }
      const reqs = entries.map(e => e.text)
      const dec = cmds[1].replace(/'<JSON 配列>'/, `'${JSON.stringify(entries).replace(/'/g, "'\\''")}'`)
      const r = sh(dec)
      return { unitId: id, requirements: reqs, written: r.code === 0, cliOutput: (r.out + r.err).slice(0, 300) }
    }
    if (/^jdg:/.test(label)) {
      const show = JSON.parse(sh(cmds[0]).out)
      const id = show.reqId
      if (failIds.has(id)) return { reqId: id, verdict: '一致', detail: '', written: false, cliOutput: 'simulated failure' }
      // 「無い」型で記録する（下位ファイルを開かずに済む決定論的な形）
      const ev = JSON.stringify({ file: show.file, method: `simulated grep, 0 件` })
      const judge = cmds[1].replace(/<判定>/, '部分').replace(/'<evidence JSON>'/, `'${ev}'`)
      const r = sh(judge)
      return { reqId: id, verdict: '部分', detail: 'simulated', written: r.code === 0, cliOutput: (r.out + r.err).slice(0, 300) }
    }
    if (label === 'approval-gate') {
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return null }
    }
    if (label === 'final-stats') {
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return r.out }
    }

    // ── approve.js ─────────────────────────────────────────────────────
    // 取得と書き戻しは親（ワークフロー）がやる形になったので、
    // 偽物も 3 役に分かれる: fetch（一覧）/ apr（判定だけ）/ write（コマンド実行）。
    if (/^fetch:/.test(label)) {
      const r = sh(cmds[0])
      try { return JSON.parse(r.out) } catch { return null }
    }
    if (/^apr:/.test(label)) {
      // 断片はプロンプトに JSON で埋まっている。**コマンドは実行しない**
      // （承認する側にツールが無いことを、偽物でも守る）。
      const m = String(prompt).match(/## 断片\n```json\n([\s\S]*?)\n```/)
      if (!m) return { verdicts: [] }
      let entries = []
      try { entries = JSON.parse(m[1]) } catch { return { verdicts: [] } }
      const verdicts = []
      for (const e of entries) {
        const id = e.entryId
        if (failIds.has(id)) continue   // 判定を返さない＝親が失敗として数える
        const src = String(e.source || ''), span = String(e.span || '')
        const wroteReq = e.wrote?.as === '要求'
        const asReq = disagreeIds.has(id) ? !wroteReq : wroteReq
        // why は 15 文字以上で原文の語を共有する必要がある。原文の一部を含めれば必ず満たす。
        const why = `原文「${src.slice(0, 24)}」のうち ${span} についての判断`
        verdicts.push(asReq
          ? { entryId: id, verdict: '要求', why, expect: `${String(e.wrote?.text || span)} を下位で定める` }
          : { entryId: id, verdict: '要求でない', why, kind: 'ラベル・項目名' })
      }
      return { verdicts }
    }
    if (/^write:/.test(label)) {
      // 親が組み立てたコマンドをそのまま実行する。**書き換えない。**
      // ここで組み立て直すと、引用の組み立て（shellJson）が検査されない。
      const outputs = []
      for (const c of cmds) { const r = sh(c); outputs.push((r.out + r.err).slice(0, 300)) }
      return { outputs }
    }
    if (label === 'report' || label === 'pending') {
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return null }
    }

    // ── audit.js ───────────────────────────────────────────────────────
    if (label === 'machine') return 'simulated machine output'
    if (/^review:/.test(label)) {
      const key = label.slice('review:'.length)
      const i = calls.filter(c => /^review:/.test(c.label)).length - 1
      return reviews ? (reviews[i] ?? null) : { perspective: key, checked: [], notVerified: [], findings: [] }
    }
    if (/^critic:/.test(label)) {
      const i = calls.filter(c => /^critic:/.test(c.label)).length - 1
      return critics ? (critics[i] ?? null) : { verdicts: [] }
    }
    if (label === 'verify-evidence') {
      if (evidenceCheck) return evidenceCheck
      // 本物と同じ照合を実行する（プロンプトの JSON を verify-evidence.mjs に渡す）
      const m = String(prompt).match(/```json\n([\s\S]*?)\n```/)
      if (!m) return null
      const r = spawnSync('node', [fileURLToPath(new URL('../verify-evidence.mjs', import.meta.url)), '--json'],
        { cwd, input: m[1], encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 })
      try { return JSON.parse(r.stdout) } catch { return null }
    }
    return null
  }

  async function parallel(thunks) {
    return Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)))
  }
  async function pipeline(items, ...stages) {
    return Promise.all(items.map(async (item, idx) => {
      let v = item
      for (const st of stages) { try { v = await st(v, item, idx) } catch { return null } }
      return v
    }))
  }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', src)
  const result = await fn(args, agent, parallel, pipeline, () => {}, m => logs.push(String(m)), budget, async () => { throw new Error('nested workflow unsupported in sim') })
  return { result, calls, logs }
}
