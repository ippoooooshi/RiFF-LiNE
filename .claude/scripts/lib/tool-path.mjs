// 子のプロセスに渡す環境変数の PATH に、pnpm などの置き場所を足す（v64）。
//
// なぜ（2026-10-25、turn 185・186）: 見張り（Stop hook）の中の verify で `pnpm` が見つからず、
//   「'pnpm' は内部コマンドまたは外部コマンド…として認識されていません」で赤になった。
//   CC の Bash の道具では pnpm は利用者のホームの bin フォルダにあり、その PATH が見張りの環境には入っていない見込み。
// 足すのは、在るフォルダで、まだ PATH に入っていないものだけ。Windows では環境変数の名前が "Path" のことがあるので、在る名前をそのまま使う。
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { homedir } from 'node:os'

export function toolDirs(env = process.env, home = homedir()) {
  const c = [env.PNPM_HOME, join(home, 'bin'), join(home, '.local', 'bin'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'pnpm'), env.APPDATA && join(env.APPDATA, 'npm')]
  return c.filter(Boolean)
}

export function envWithTools(env = process.env, { home = homedir(), exists = existsSync } = {}) {
  const out = { ...env }
  const key = Object.keys(out).find(k => k.toUpperCase() === 'PATH') || 'PATH'
  const cur = String(out[key] || '')
  const have = new Set(cur.split(delimiter).filter(Boolean).map(p => p.replace(/[\\/]+$/, '').toLowerCase()))
  const add = toolDirs(env, home).filter(d => exists(d) && !have.has(d.replace(/[\\/]+$/, '').toLowerCase()))
  if (add.length) out[key] = [cur, ...add].filter(Boolean).join(delimiter)
  return out
}
