import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TASK } from "../fake/data"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
afterEach(() => app.close())

const WIDE = { width: 160, height: 45 }

/** A home with config.json holding this `agent` block. */
async function homeWith(agent: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "wrike-tui-agent-screen-"))
  await mkdir(join(home, "config", "wrike-tui"), { recursive: true })
  await Bun.write(join(home, "config", "wrike-tui", "config.json"), JSON.stringify({ agent }))
  return home
}

const taskFile = (home: string) => join(home, "state", "wrike-tui", "agent", TASK.login, "task.md")

describe("Hand to an agent", () => {
  test("w on a list row opens the task, offers the prompts, then the folders, and the agent takes the terminal there", async () => {
    app = await openApp(WIDE)
    await app.see("Fix login redirect loop")
    await app.press("j", "j", "w")
    const prompts = await app.see("─ Hand to an agent ─", "▸ Implement", "Plan", "Investigate", "Context only")
    expect(prompts).toMatch(/  Plan +Make a plan for this Wrike/)
    await app.press("down", "enter")
    await app.see("─ Plan: run the agent in ─", /▸ ~ +where wrike-tui started/)
    expect(app.outside.agents).toEqual([])
    await app.press("enter")
    await app.see("Fix login redirect loop", "The session cookie is dropped")
    await app.store.idle()
    expect(app.outside.agents).toEqual([
      {
        kind: "terminal",
        argv: ["claude", `Make a plan for this Wrike task. Do not change any code yet.\n\nThe Wrike task is in ${taskFile(app.home)}. Read it first. Its screenshots are in the same folder: callback-loop.png, whiteboard.jpg.`],
        cwd: app.home,
      },
    ])
    const markdown = await Bun.file(taskFile(app.home)).text()
    expect(markdown).toStartWith("# Fix login redirect loop\n")
    expect(markdown).toContain("Repro steps attached, it loops after the callback.")
    // The agent may have changed the task, so the app fetched it again once the terminal came back.
    expect(app.store.getState().flash).toBeNull()
    expect(app.fake.requests.filter((request) => request === `GET /api/v4/tasks/${TASK.login}`).length).toBeGreaterThan(1)
  })

  test("a task in a folder the config names starts in that folder's path, and inside Herdr in a new tab", async () => {
    const home = await homeWith({ folders: { platform: "~/dev/platform" } })
    await mkdir(join(home, "dev", "platform"), { recursive: true })
    app = await openApp(WIDE, { home, env: { HC_TERMINAL_ID: "t2" } })
    await app.see("Fix login redirect loop")
    await app.press("j", "j", "enter", "w")
    await app.see("─ Hand to an agent ─")
    await app.press("enter")
    await app.see("Claude started in a new Herdr tab")
    const [run] = app.outside.agents
    expect(run?.argv.slice(0, 7)).toEqual(["herdr-app", "do", "tab.new", "--name", "Fix login redirect loop", "--folder", join(home, "dev", "platform")])
    expect(JSON.parse(run!.argv[8]!)[1]).toStartWith("Implement this Wrike task.")
  })

  test("Esc closes the prompts and starts nothing, and the palette finds the command", async () => {
    app = await openApp(WIDE)
    await app.see("Fix login redirect loop")
    await app.press("j", "j", "w")
    await app.see("─ Hand to an agent ─")
    await app.press("esc")
    expect(await app.frame()).not.toContain("─ Hand to an agent ─")
    expect(app.outside.agents).toEqual([])
    await app.press(":")
    await app.type("agent")
    await app.see("Hand to an agent")
  })
})
