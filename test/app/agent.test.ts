import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handToAgent, writeContext, type AgentDeps } from "../../src/app/agent"
import type { Action, AgentHandoff } from "../../src/app/state"
import { agentSettings, type AgentConfig } from "../../src/domain/agent"
import { taskId } from "../../src/domain/ids"
import { createWrikeClient, type WrikeClient } from "../../src/wrike/client"
import { createMcpClient } from "../../src/wrike/mcp"
import { createTransport } from "../../src/wrike/transport"
import { PREVIEW_PNG, TASK } from "../fake/data"
import { createFakeWrike, type FakeWrike } from "../fake/wrike"

const TOKEN = "good-token"
let fake: FakeWrike
let client: WrikeClient
let scratch: string
let workspace: string

beforeEach(async () => {
  fake = createFakeWrike({ token: TOKEN, today: "2026-11-12", now: "2026-11-12T16:00:00Z" })
  client = createWrikeClient(
    createTransport({ baseUrl: "http://fake.test/api/v4", token: TOKEN, fetch: fake.fetch, sleep: async () => {} }),
    createMcpClient({ url: "http://fake.test/mcp", token: TOKEN, fetch: fake.fetch }),
  )
  scratch = await mkdtemp(join(tmpdir(), "wrike-tui-agent-"))
  workspace = join(scratch, "api")
  await mkdir(workspace)
})
afterEach(() => rm(scratch, { recursive: true, force: true }))

/** "Fix login redirect loop": a PNG and a JPEG Wrike stores, a text file, a Google doc, and one comment. */
async function loginHandoff(config: AgentConfig = {}): Promise<AgentHandoff> {
  const id = taskId(TASK.login)
  const [task, attachments, comments, contacts, workflows] = await Promise.all([client.task(id), client.attachments(id), client.comments(id), client.contacts(), client.workflows()])
  return {
    details: { task, attachments, comments, folders: await client.folders(task.parentIds) },
    prompt: { name: "Plan", prompt: "Make a plan. Do not change any code yet." },
    workspace,
    settings: agentSettings(config),
    contacts: new Map(contacts.map((contact) => [contact.id, contact])),
    workflows,
    fields: new Map(),
  }
}

function deps(extra: Partial<AgentDeps> = {}) {
  const runs: { kind: "terminal" | "herdr"; argv: string[]; cwd?: string }[] = []
  const made: AgentDeps = {
    dir: join(scratch, "state", "agent"),
    env: {},
    home: scratch,
    onPath: () => true,
    isDirectory: async (path) => path === workspace,
    terminal: async (argv, cwd) => void runs.push({ kind: "terminal", argv, cwd }),
    herdr: async (argv) => (runs.push({ kind: "herdr", argv }), null),
    ...extra,
  }
  return { deps: made, runs }
}

const record = () => {
  const actions: Action[] = []
  return { actions, dispatch: (action: Action) => void actions.push(action) }
}

describe("writeContext", () => {
  test("writes task.md and downloads only the screenshots Wrike stores, under their own names", async () => {
    const dir = join(scratch, "context")
    const written = await writeContext(client, dir, await loginHandoff())
    expect(written).toEqual({ taskFile: join(dir, "task.md"), screenshots: ["callback-loop.png", "whiteboard.jpg"] })
    expect((await readdir(dir)).sort()).toEqual(["callback-loop.png", "task.md", "whiteboard.jpg"])
    expect(new Uint8Array(await Bun.file(join(dir, "callback-loop.png")).arrayBuffer())).toEqual(new Uint8Array(PREVIEW_PNG))
    const markdown = await Bun.file(written.taskFile).text()
    expect(markdown).toStartWith("# Fix login redirect loop\n")
    expect(markdown).toContain("- Assignees: Pat Example\n")
    expect(markdown).toContain("- Folders: Platform\n")
    expect(markdown).toContain("The session cookie is dropped after the identity provider callback.")
    expect(markdown).toMatch(/### Pat Example, \d{4}-\d\d-\d\d \d\d:\d\d UTC\n\nRepro steps attached, it loops after the callback\./)
    expect(markdown).toContain(
      "## Attachments\n\n- callback-loop.png: saved in this folder\n- har-capture.txt: not downloaded, not an image\n- whiteboard.jpg: saved in this folder\n- Login flow notes: not downloaded, linked from Google\n",
    )
  })

  test("a failed download is listed in task.md and the rest still arrive", async () => {
    fake.fail({ path: "/api/v4/attachments/IEAAAAAAIYAAAA03/download", status: 500 })
    const dir = join(scratch, "context")
    const written = await writeContext(client, dir, await loginHandoff())
    expect(written.screenshots).toEqual(["callback-loop.png"])
    expect(await Bun.file(written.taskFile).text()).toMatch(/- whiteboard\.jpg: could not be downloaded, .+\n/)
  })

  test("a second handoff of the task empties its folder first", async () => {
    const dir = join(scratch, "context")
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, "left-over.png"), "old")
    await writeContext(client, dir, await loginHandoff())
    expect(await readdir(dir)).not.toContain("left-over.png")
  })
})

describe("handToAgent", () => {
  test("outside Herdr the agent takes the terminal in the workspace, told where the task and screenshots are, and the app redraws after", async () => {
    const { deps: made, runs } = deps()
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff(), dispatch)
    const taskFile = join(scratch, "state", "agent", TASK.login, "task.md")
    expect(runs).toEqual([
      {
        kind: "terminal",
        argv: ["claude", `Make a plan. Do not change any code yet.\n\nThe Wrike task is in ${taskFile}. Read it first. Its screenshots are in the same folder: callback-loop.png, whiteboard.jpg.`],
        cwd: workspace,
      },
    ])
    expect(actions).toEqual([{ type: "agent-returned" }])
  })

  test("inside Herdr a tab opens with the agent, and the status bar names the program", async () => {
    const { deps: made, runs } = deps({ env: { HC_TERMINAL_ID: "t2" } })
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff({ command: ["codex", "--full-auto"] }), dispatch)
    expect(runs).toHaveLength(1)
    const [run] = runs
    expect(run!.argv.slice(0, 7)).toEqual(["herdr-app", "do", "tab.new", "--name", "Fix login redirect loop", "--folder", workspace])
    const agent = JSON.parse(run!.argv[8]!) as string[]
    expect(agent.slice(0, 2)).toEqual(["codex", "--full-auto"])
    expect(agent[2]).toEndWith("Its screenshots are in the same folder: callback-loop.png, whiteboard.jpg.")
    expect(actions).toEqual([{ type: "flash", flash: { tone: "info", text: "Codex started in a new Herdr tab" } }])
  })

  test("Herdr's error ends in the status bar", async () => {
    const { deps: made } = deps({ env: { HC_TERMINAL_ID: "t2" }, herdr: async () => "no window is open" })
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff(), dispatch)
    expect(actions).toEqual([{ type: "flash", flash: { tone: "error", text: "Herdr did not open a tab: no window is open" } }])
  })

  test("a command not on the PATH launches nothing and writes nothing", async () => {
    const { deps: made, runs } = deps({ onPath: (program) => program !== "claude" })
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff(), dispatch)
    expect(runs).toEqual([])
    expect(actions).toEqual([{ type: "flash", flash: { tone: "error", text: "claude is not on your PATH" } }])
    expect(await Bun.file(join(scratch, "state", "agent", TASK.login, "task.md")).exists()).toBe(false)
  })

  test("a workspace that does not exist launches nothing", async () => {
    const { deps: made, runs } = deps({ isDirectory: async () => false })
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff(), dispatch)
    expect(runs).toEqual([])
    expect(actions).toEqual([{ type: "flash", flash: { tone: "error", text: "The workspace ~/api does not exist" } }])
  })

  test("an agent that cannot start is reported, and the app does not wait on it", async () => {
    const { deps: made } = deps({ terminal: async () => Promise.reject(new Error("ENOENT")) })
    const { actions, dispatch } = record()
    await handToAgent(client, made, await loginHandoff(), dispatch)
    expect(actions).toEqual([{ type: "flash", flash: { tone: "error", text: "Could not start claude: ENOENT" } }])
  })
})
