import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmod, mkdir, realpath } from "node:fs/promises"
import { join } from "node:path"
import { TASK } from "../test/fake/data"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Hands a task to a fake coding agent through the compiled binary in a
 * detached tmux session: `a`, a prompt, and the agent takes the terminal in
 * the configured workspace, then gives it back. The fake agent is TypeScript
 * run by Bun. It records its arguments and folder and exits. Herdr is never
 * reached: the harness drops its variables, and the config says terminal.
 */
setDefaultTimeout(60_000)

let e2e: E2e
let tmux: TmuxSession
let repo: string
let record: string

beforeAll(async () => {
  e2e = await startE2e("agent", WIDE, { WRIKE_TOKEN: TOKEN })
  tmux = e2e.tmux
  repo = join(e2e.work, "repo")
  record = join(e2e.work, "agent-run.json")
  await mkdir(repo)
  const agent = join(e2e.work, "fake-agent.ts")
  await Bun.write(
    agent,
    `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\nconsole.log("The fake agent ran.")\n`,
  )
  await chmod(agent, 0o755)
  const config = join(e2e.env.XDG_CONFIG_HOME!, "wrike-tui", "config.json")
  await mkdir(join(e2e.env.XDG_CONFIG_HOME!, "wrike-tui"), { recursive: true })
  await Bun.write(config, JSON.stringify({ agent: { command: [agent], open: "terminal", workspace: repo } }))
})
afterAll(() => e2e.stop())

describe("hand to an agent", () => {
  test("w and a prompt give the terminal to the agent in the workspace, with the task written for it, and the app comes back", async () => {
    await tmux.run(BINARY)
    await tmux.see("inbox", "Fix login redirect loop")
    await tmux.keys("j", "j", "a")
    await tmux.see("prompts", "─ Hand to an agent ─", "▸ Implement", "Context only")
    await tmux.keys("Down", "Enter")
    await tmux.see("back", "3 Details", "The session cookie is dropped", "Comments (1)")
    const run = (await Bun.file(record).json()) as { argv: string[]; cwd: string }
    expect(run.cwd).toBe(await realpath(repo))
    expect(run.argv).toHaveLength(1)
    const message = run.argv[0]!
    const taskFile = join(e2e.env.XDG_STATE_HOME!, "wrike-tui", "agent", TASK.login, "task.md")
    expect(message).toStartWith("Make a plan for this Wrike task. Do not change any code yet.\n\n")
    expect(message).toEndWith(`The Wrike task is in ${taskFile}. Read it first. Its screenshots are in the same folder: callback-loop.png, whiteboard.jpg.`)
    const markdown = await Bun.file(taskFile).text()
    expect(markdown).toStartWith("# Fix login redirect loop\n")
    expect(markdown).toContain("Repro steps attached, it loops after the callback.")
    expect(await Bun.file(join(taskFile, "..", "callback-loop.png")).exists()).toBe(true)
  })

  test("the app still answers keys after the agent exits", async () => {
    await tmux.keys("t")
    await tmux.see("todo", "2 My to-do")
    await tmux.keys("q")
  })
})
