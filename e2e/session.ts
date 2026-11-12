import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { localDay } from "../src/domain/dates"
import { createFakeWrike, type FakeWrike } from "../test/fake/wrike"
import { TmuxSession } from "./tmux"

export const BINARY = resolve(import.meta.dir, "../dist/wrike-tui")
export const TOKEN = "e2e-secret-token"
export const WIDE = { width: 160, height: 45 }
export const NARROW = { width: 80, height: 24 }

export type E2e = {
  /** A scratch directory that holds the config, state and cache homes, the scripts and what they record. */
  work: string
  fake: FakeWrike
  origin: string
  tmux: TmuxSession
  /** The variables the shell in tmux starts with. No real Wrike variable is among them. */
  env: Record<string, string>
  stop(): Promise<void>
}

/**
 * One fake Wrike on a port, one scratch home, and one detached tmux session on
 * a private socket. Captures go to `$WRIKE_TUI_E2E_CAPTURES/<name>`.
 */
export async function startE2e(name: string, size: { width: number; height: number }, extra: Record<string, string> = {}): Promise<E2e> {
  const work = await mkdtemp(join(tmpdir(), `wrike-tui-e2e-${name}-`))
  const now = new Date()
  const fake = createFakeWrike({ token: TOKEN, today: localDay(now), now: now.toISOString() })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fake.handle })
  const origin = `http://127.0.0.1:${server.port}`
  const script = async (file: string, body: string) => {
    const path = join(work, file)
    await Bun.write(path, `#!/usr/bin/env zsh\n${body}\n`)
    await chmod(path, 0o755)
    return path
  }
  const env = {
    WRIKE_BASE_URL: `${origin}/api/v4`,
    WRIKE_MCP_URL: `${origin}/mcp`,
    XDG_CONFIG_HOME: join(work, "config"),
    XDG_STATE_HOME: join(work, "state"),
    XDG_CACHE_HOME: join(work, "cache"),
    EDITOR: await script("editor", 'print -r -- "" >> "$1"\nprint -r -- "Edited in the e2e editor." >> "$1"'),
    // A recorder, never a real browser.
    BROWSER: await script("browser", `print -r -- "$1" >> "${join(work, "opened-urls")}"`),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...extra,
  }
  const captures = join(process.env.WRIKE_TUI_E2E_CAPTURES ?? join(work, "captures"), name)
  const tmux = new TmuxSession(join(work, "tmux.sock"), captures)
  await tmux.start(size, env)
  return {
    work,
    fake,
    origin,
    tmux,
    env,
    async stop() {
      await tmux.kill()
      server.stop(true)
      await rm(work, { recursive: true, force: true })
    },
  }
}
