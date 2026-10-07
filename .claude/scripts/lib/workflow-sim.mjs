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
          disagreeIds = new Set(),
          // 判定は返すが、**台帳側に弾かれる**内容で返す（理由が短すぎる）。
          // 「書き戻しに失敗したときに理由が報告へ出るか」を試すために要る。
          writeFailIds = new Set(),
          // 理由文にバッククォートを混ぜる。コマンドは `…` で囲んで渡すので、
          // 落としていないと**囲みが途中で閉じてコマンドが切れる。**
          backtickIds = new Set(),
          // v36: true なら、2 断片以上の承認の体の答えを 1 回目だけ 1 つずつずらす（span は答えた断片のまま＝取り違えの再現）
          shiftOnce = false,
          // v36: 一覧役が 1 回目だけ JSON を返さない（turn 110 の越権の再現）／承認の取り出し役が指定のラベルで 1 回だけ JSON を返さない（窓が大きすぎた再現）
          listFailOnce = false, fetchFailAt = null,
          // v38: judge.js の一覧役が壊れた JSON を返す（turn 118 の再現）。'once' は 1 回目だけ、'always' は毎回
          jgroupsFail = null,
          // v39: approve.js・settle.js の中身の取り出し役が 1 回目だけ読めない JSON を返す
          bodyFailOnce = false, tailFail = false,
          // v40: judge.js の一覧役が 1 回目だけ ID を 1 件写し落とす（turn 125 の再現）
          jgroupsDropOnce = false,
          // v41: 書き戻し役が、指定の断片のコマンドを 1 回目だけ写し崩す／一覧役が最初の 1 回だけ JSON を返さない
          writeCorruptOnce = new Set(), firstFetchFailOnce = false,
          // v41: bd-audit.js の確かめ役が作り話の引用を返す
          audBadQuote = false } = opts
  const corrupted = new Set()
  let firstFetchFailed = false
  let shifted = false, listFailed = false, fetchFailed = false, jgroupsFailed = 0, bodyFailed = false, jgroupsDropped = false

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
    calls.push({ label: o.label, phase: o.phase, model: o.model, prompt: String(prompt).slice(0, 80), body: String(prompt) })
    const cmds = cmdsIn(prompt)
    const label = o.label || ''

    // ── coverage.js ────────────────────────────────────────────────────
    if (/^list-[dj]:/.test(label)) {
      if (listFailOnce && !listFailed) { listFailed = true; return '先に前提を確かめます。check-version を打ちます。' }
      const r = sh(cmds[0])
      try { return JSON.parse(r.out) } catch { return null }
    }
    // v36: 1 体に複数の単位（「1. <単位 ID>」の並び）。show・decompose は "<単位 ID>" の型で渡ってくる
    if (/^dec:/.test(label) && /"<単位 ID>"/.test(String(prompt))) {
      const ids = [...String(prompt).matchAll(/^\d+\. (\S+:\S+)$/gm)].map(m => m[1])
      const showT = cmds.find(c => / show /.test(c)), decT = cmds.find(c => / decompose /.test(c))
      const results = []
      for (const id of ids) {
        if (failIds.has(id)) { results.push({ unitId: id, requirements: [], written: false, cliOutput: 'simulated failure' }); continue }
        const show = JSON.parse(sh(showT.replace('"<単位 ID>"', JSON.stringify(id))).out || '{}')
        const src = String(show.text || '')
        const n = Math.max(1, show.minReq || 1)
        const size = Math.max(1, Math.ceil(src.length / n))
        const entries = []
        for (let i = 0; i < n && i * size < src.length; i++) {
          const frag = src.slice(i * size, Math.min(src.length, (i + 1) * size))
          entries.push({ text: `${frag} を満たすこと`, from: frag })
        }
        const dec = decT.replace('"<単位 ID>"', JSON.stringify(id)).replace(/'<JSON 配列>'/, `'${JSON.stringify(entries).replace(/'/g, "'\\''")}'`)
        const r = sh(dec)
        results.push({ unitId: id, requirements: entries.map(e => e.text), written: r.code === 0, cliOutput: (r.out + r.err).slice(0, 300) })
      }
      return { results }
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
    // ── judge.js（v35）────────────────────────────────────────────────
    // 一覧の役：judge-groups を打って JSON を返す
    if (/^jgroups:/.test(label)) {
      if (jgroupsFail === 'always' || (jgroupsFail === 'once' && jgroupsFailed === 0)) {
        jgroupsFailed++
        return 'claude-sonnet (the safety classifier) was unavailable (timed out)\n{"groups":[{"key":"x","ids":["a"]}],"sizes":{"1":{"2":3}'
      }
      const r = sh(cmds[0])
      let j = null
      try { j = JSON.parse(r.out) } catch { return null }
      if (jgroupsDropOnce && !jgroupsDropped && Array.isArray(j?.groups)) {
        const g = j.groups.find(x => Array.isArray(x.ids) && x.ids.length)
        if (g) { g.ids.pop(); j.groups = j.groups.filter(x => x.ids.length); jgroupsDropped = true }
      }
      return j
    }
    // 判定の役（まとまり）：文面の「1. <ID>」の並びを取り、ID ごとに show → judge（または書かずに返す）
    // 書くときは「不一致」＋無いことを確かめた方法（逐語を持たずに通る判定）
    if (/^jdg:g\d+/.test(label)) {
      const ids = [...String(prompt).matchAll(/^\d+\. (\S+#k[0-9a-f]+)$/gm)].map(m => m[1])
      const dry = /台帳には書かない。\*\* 判定と evidence/.test(String(prompt))
      const showT = cmds.find(c => / show /.test(c))
      const judgeT = cmds.find(c => / judge /.test(c))
      const results = []
      for (const id of ids) {
        const show = JSON.parse(sh(showT.replace('"<要求の ID>"', JSON.stringify(id))).out || '{}')
        if (failIds.has(id)) { results.push({ reqId: id, verdict: '一致', detail: '', written: false, cliOutput: 'simulated failure' }); continue }
        const ev = JSON.stringify({ file: show.file || 'docs/bd.md', method: 'simulated grep, 0 件' })
        if (dry) { results.push({ reqId: id, verdict: '一致', detail: 'simulated', evidence: ev, written: false, cliOutput: '' }); continue }
        const cmd = judgeT.replace('"<要求の ID>"', JSON.stringify(id)).replace(/<判定>/, '不一致').replace(/'<evidence JSON>'/, `'${ev}'`)
        const r = sh(cmd)
        results.push({ reqId: id, verdict: '不一致', detail: 'simulated', evidence: ev, written: r.code === 0, cliOutput: (r.out + r.err).slice(0, 300) })
      }
      return { results }
    }
    // 確かめの役：渡された ID ごとに返す（2 件目・4 件目……だけ疑義あり）
    if (/^rev:g\d+/.test(label)) {
      const ids = [...String(prompt).matchAll(/^## \d+\. (\S+#k[0-9a-f]+)$/gm)].map(m => m[1])
      return { reviews: ids.map((id, i) => ({ reqId: id, doubt: i % 2 === 1, why: 'simulated' })) }
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
    if (firstFetchFailOnce && !firstFetchFailed && label === 'fetch:0') { firstFetchFailed = true; return '（JSON を返さなかった）' }
    if (label === 'final' || /^(fetch|body):/.test(label) || /^final:/.test(label)) {
      if (fetchFailAt && label === fetchFailAt && !fetchFailed) { fetchFailed = true; return '出力が大きすぎて繰り返せません' }
      if (bodyFailOnce && /^body:/.test(label) && !bodyFailed) { bodyFailed = true; return '出力が大きすぎて繰り返せません' }
      const r = sh(cmds[0])
      try { return JSON.parse(r.out) } catch { return null }
    }
    // set: は settle.js の 2 周目。**apr: とまったく同じ問いに答える役**なので、
    // 偽物も同じ分岐で扱う。分けると、片方だけ直して挙動が食い違う。
    if (/^(apr|set):/.test(label)) {
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
        // **台帳側に弾かれる判定を返す。** 親がコマンドを組み立てて実行し、approve が拒否する。
        // 「書き戻しに失敗したときに理由が報告へ出るか」は、これでしか試せない。
        if (writeFailIds.has(id)) {
          verdicts.push({ entryId: id, span, verdict: '要求', why: '短い', expect: `${span} を下位で定める` })
          continue
        }
        // why は 15 文字以上で原文の語を共有する必要がある。原文の一部を含めれば必ず満たす。
        const why = backtickIds.has(id)
          ? `原文「${src.slice(0, 24)}」のうち \`${span}\` についての判断`
          : `原文「${src.slice(0, 24)}」のうち ${span} についての判断`
        verdicts.push(asReq
          ? { entryId: id, span, verdict: '要求', why, expect: `${String(e.wrote?.text || span)} を下位で定める` }
          : { entryId: id, span, verdict: '要求でない', why, kind: 'ラベル・項目名' })
      }
      // 取り違えの再現（v36）：答えの中身（span も含む）はそのままに、entryId だけを 1 つずつずらす
      if (shiftOnce && !shifted && verdicts.length >= 2) {
        shifted = true
        const ids = verdicts.map(v => v.entryId)
        return { verdicts: verdicts.map((v, i) => ({ ...v, entryId: ids[(i + 1) % ids.length] })) }
      }
      return { verdicts }
    }
    if (/^write:/.test(label)) {
      // 親が組み立てたコマンドをそのまま実行する。**書き換えない。**
      // ここで組み立て直すと、引用の組み立て（shellJson）が検査されない。
      //
      // 出力は entryId と対にして返し、**わざと逆順にする。**
      // 親が順番で突き合わせていたら、ここで理由が別の断片に付く。
      // 実機でそれが起き、16 件のうち 14 件が「原因不明」になった。
      const results = []
      for (const c0 of cmds) {
        // v41: writeCorruptOnce の断片は、1 回目の書き戻しだけ写し崩す（turn 127 の --sum 不一致の再現）
        let c = c0
        const idm = String(c0).match(/"([^"]*#(?:k[0-9a-f]+(?:\.\d+)?|s?\d+))"/)
        if (idm && writeCorruptOnce.has(idm[1]) && !corrupted.has(idm[1])) {
          corrupted.add(idm[1])
          c = /--sum [0-9a-f]{8}/.test(c0) ? c0.replace(/--sum [0-9a-f]{8}/, '--sum 00000000') : c0.replace(/\}'\s*$/, "'")
        }
        const r = sh(c)
        // entryId はコマンドの 3 つめの引数（"…#0" の形）。
        // entryId は中身の鍵（#k<hash>）。古い添字の形（#3 / #s2）も一応拾う。
        const m = String(c).match(/"([^"]*#(?:k[0-9a-f]+(?:\.\d+)?|s?\d+))"/)
        results.push({ entryId: m ? m[1] : '', output: (r.out + r.err).slice(0, 300) })
      }
      return { results: results.reverse() }
    }
    if (label === 'report' || label === 'pending') {
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return null }
    }
    // v39: 終わりの 3 つを束ねる wf-tail。tailFail で「読めなかった」を作り、3 回に分ける道を試す
    if (label === 'tail') {
      if (tailFail) return '出力が大きすぎて繰り返せません'
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return null }
    }

    // ── bd-audit.js（v41）──────────────────────────────────────────────
    if (/^closures:/.test(label)) {
      const r = sh(cmds[0]); try { return JSON.parse(r.out) } catch { return null }
    }
    // 確かめ役：渡した閉じる文の 1 件目だけ「食い違い」にし、その行の文を（逐語のまま／audBadQuote なら作り話で）引く。ほかは none
    if (/^aud:g\d+/.test(label)) {
      const its = [...String(prompt).matchAll(/id=(\S+)  (\S+):(\d+)\n   (.*)/g)].map(m => ({ id: m[1], file: m[2], line: Number(m[3]), text: m[4] }))
      return { results: its.map((x, i) => i === 0
        ? { id: x.id, verdict: 'conflict', closes: '試しの閉じる文', method: 'smoke', conflicts: [{ file: x.file, line: x.line, quote: audBadQuote ? 'どこにも無い作り話の引用の文です' : x.text.slice(0, 30), why: '試し' }] }
        : { id: x.id, verdict: 'none', method: 'smoke：grep 0 件' }) }
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
