import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseHeadless } from "../../src/cli/headless"
import { run, type Io } from "../../src/cli/run"
import type { InboxLine, TaskLine } from "../../src/domain/headless"
import { ME, TASK } from "../fake/data"
import { createFakeWrike, type FakeWrike } from "../fake/wrike"

let fake: FakeWrike
let scratch: string
let lines: { out: string[]; err: string[] }

beforeEach(async () => {
  fake = createFakeWrike({ token: "good-token", today: "2026-11-12", now: "2026-11-12T16:00:00Z" })
  scratch = await mkdtemp(join(tmpdir(), "wrike-tui-headless-"))
  lines = { out: [], err: [] }
})
afterEach(() => rm(scratch, { recursive: true, force: true }))

function io(env: Io["env"] = loggedIn()): Io {
  return {
    env,
    tokens: { get: async () => null, set: async () => {}, delete: async () => {} },
    out: (line) => void lines.out.push(line),
    err: (line) => void lines.err.push(line),
    readSecret: async () => null,
    launch: async () => {},
    fetch: fake.fetch,
    sharedApp: null,
  }
}

const loggedIn = () => ({
  XDG_CONFIG_HOME: join(scratch, "config"),
  XDG_STATE_HOME: join(scratch, "state"),
  WRIKE_TOKEN: "good-token",
  WRIKE_BASE_URL: "http://fake.test/api/v4",
  WRIKE_MCP_URL: "http://fake.test/mcp",
})

const printed = <T>() => lines.out.map((line) => JSON.parse(line) as T)

describe("parsing", () => {
  test("names the three commands, with flags in any order", () => {
    expect(parseHeadless(["tasks", "--mine", "--json"])).toEqual({ kind: "tasks" })
    expect(parseHeadless(["tasks", "--json", "--mine"])).toEqual({ kind: "tasks" })
    expect(parseHeadless(["inbox", "--json"])).toEqual({ kind: "inbox" })
    expect(parseHeadless(["export", "4598459107"])).toEqual({ kind: "export", input: "4598459107", ref: { kind: "legacy", id: "4598459107" as never } })
  })

  test("leaves every other command to the rest of the CLI", () => {
    expect(parseHeadless([])).toBeNull()
    expect(parseHeadless(["auth", "status"])).toBeNull()
  })

  test("an unknown or missing flag is one line naming the usage", () => {
    expect(parseHeadless(["tasks", "--mine", "--json", "--all"])).toEqual({ error: "Unknown option for tasks: --all. Usage: wrike-tui tasks --mine --json" })
    expect(parseHeadless(["tasks", "--json"])).toEqual({ error: "tasks needs --mine. Usage: wrike-tui tasks --mine --json" })
    expect(parseHeadless(["tasks"])).toEqual({ error: "tasks needs --mine and --json. Usage: wrike-tui tasks --mine --json" })
    expect(parseHeadless(["inbox"])).toEqual({ error: "inbox needs --json. Usage: wrike-tui inbox --json" })
    expect(parseHeadless(["inbox", "--json", "unread"])).toEqual({ error: "Unknown option for inbox: unread. Usage: wrike-tui inbox --json" })
  })

  test("export takes exactly one task it can read", () => {
    expect(parseHeadless(["export"])).toEqual({ error: "export needs a task: its ID, its API ID or its permalink. Usage: wrike-tui export <task>" })
    expect(parseHeadless(["export", "1", "2"])).toEqual({ error: "export takes one task. Usage: wrike-tui export <task>" })
    expect(parseHeadless(["export", "--json", "1"])).toEqual({ error: "Unknown option for export: --json. Usage: wrike-tui export <task>" })
    expect(parseHeadless(["export", "login bug"])).toEqual({ error: "Not a task ID or permalink: login bug. Usage: wrike-tui export <task>" })
  })

  test("a parse error exits 2 with the line on stderr and nothing on stdout", async () => {
    expect(await run(["export"], io())).toBe(2)
    expect(lines).toEqual({ out: [], err: ["export needs a task: its ID, its API ID or its permalink. Usage: wrike-tui export <task>"] })
  })
})

describe("tasks --mine --json", () => {
  test("prints my active tasks without subtasks, latest change first, one JSON object a line", async () => {
    expect(await run(["tasks", "--mine", "--json"], io())).toBe(0)
    const tasks = printed<TaskLine>()
    const mine = fake.data.tasks.filter((task) => task.responsibleIds.includes(ME) && task.status === "Active" && task.superTaskIds.length === 0)
    expect(tasks.map((task) => task.taskId)).toEqual(mine.toSorted((a, b) => b.updatedDate.localeCompare(a.updatedDate)).map((task) => task.id))
    expect(tasks.find((task) => task.taskId === TASK.sso)).toEqual({
      id: "4598459101",
      taskId: TASK.sso,
      title: "Enable SSO on sandbox",
      link: "https://www.wrike.com/open.htm?id=4598459101",
      importance: "High",
      status: "In Progress",
      statusGroup: "Active",
      color: "Turquoise",
      due: "2026-11-11",
      updated: "2026-11-11",
      folders: ["Platform", "Q4 Launch"],
      subtasks: 0,
      description:
        "Goal\nStaff sign in to the sandbox with the same identity provider as production.\n\nSteps\n• Register the sandbox as a service provider\n• Map the staff and admin groups\n• Test with two pilot accounts\nSee the SSO runbook for the certificate rotation notes.",
      fields: [],
    })
  })

  test("names each custom field set on a task and shows its value as the details pane does", async () => {
    await run(["tasks", "--mine", "--json"], io())
    const { fields } = printed<TaskLine>().find((task) => task.taskId === TASK.flags)!
    expect(fields).toContainEqual({ title: "Labels", value: "auth, infra" })
    expect(fields).toContainEqual({ title: "Time Spent", value: "2h 30m" })
    expect(fields).toContainEqual({ title: "Customer Facing", value: "yes" })
  })

  test("names a status only a space's own workflow has", async () => {
    await run(["tasks", "--mine", "--json"], io())
    expect(printed<TaskLine>().find((task) => task.taskId === TASK.onboarding)).toMatchObject({ status: "Triage", color: "Orange" })
  })

  test("reads every page", async () => {
    const template = fake.data.tasks.find((task) => task.id === TASK.flags)!
    for (let n = 0; n < 250; n++) fake.data.tasks.push({ ...template, id: `IEAAAAAAKQAC${String(n).padStart(4, "0")}`, updatedDate: "2026-01-01T00:00:00Z" })
    expect(await run(["tasks", "--mine", "--json"], io())).toBe(0)
    expect(lines.out.length).toBeGreaterThan(250)
    expect(fake.requests.some((request) => request.includes("nextPageToken"))).toBe(true)
  })

  test("without a login it says how to log in and prints nothing", async () => {
    expect(await run(["tasks", "--mine", "--json"], io({ XDG_CONFIG_HOME: join(scratch, "config") }))).toBe(1)
    expect(lines).toEqual({ out: [], err: ["Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."] })
  })

  test("a failure on a later call leaves stdout empty", async () => {
    fake.fail({ path: "/api/v4/workflows", status: 500 })
    expect(await run(["tasks", "--mine", "--json"], io())).toBe(1)
    expect(lines.out).toEqual([])
    expect(lines.err).toHaveLength(1)
  })
})

describe("inbox --json", () => {
  test("prints every entry, read ones too, newest first", async () => {
    expect(await run(["inbox", "--json"], io())).toBe(0)
    const entries = printed<InboxLine>()
    expect(entries).toHaveLength(fake.data.inbox.length)
    expect(entries.map((entry) => entry.ts)).toEqual(entries.map((entry) => entry.ts).toSorted().reverse())
    expect(entries[0]).toEqual({
      id: "w:obj_chng:1057210601",
      kind: "Mention",
      label: "Mention",
      unread: true,
      ts: "2026-11-12T15:25:00Z",
      item: { id: "4598459101", title: "Enable SSO on sandbox", link: "https://www.wrike.com/open.htm?id=4598459101", type: "TASK" },
      author: "Pat Example",
      text: "@Sam Sample can we run trainings in the sandbox?",
    })
  })

  test("an Inbox that cannot load exits 1 with Wrike's reason", async () => {
    fake.failTool({ tool: "get_my_inbox", text: "Rate limit exceeded" })
    expect(await run(["inbox", "--json"], io())).toBe(1)
    expect(lines).toEqual({ out: [], err: ["Wrike is rate limiting requests. Wait a moment and retry."] })
  })
})

describe("export", () => {
  const taskDir = () => join(scratch, "state", "wrike-tui", "agent", TASK.login)

  test("writes task.md and the screenshots where the handoff does and prints the task.md path", async () => {
    expect(await run(["export", "https://www.wrike.com/open.htm?id=4598459107"], io())).toBe(0)
    expect(lines).toEqual({ out: [join(taskDir(), "task.md")], err: [] })
    expect((await readdir(taskDir())).sort()).toEqual(["callback-loop.png", "task.md", "whiteboard.jpg"])
    expect(await Bun.file(join(taskDir(), "task.md")).text()).toStartWith("# Fix login redirect loop\n")
  })

  test("takes the API task ID too", async () => {
    expect(await run(["export", TASK.login], io())).toBe(0)
    expect(lines.out).toEqual([join(taskDir(), "task.md")])
  })

  test("a task Wrike does not have exits 1 and writes nothing", async () => {
    expect(await run(["export", "4598400000"], io())).toBe(1)
    expect(lines).toEqual({ out: [], err: ["No Wrike task matches 4598400000."] })
    expect(await readdir(join(scratch, "state")).catch(() => [])).toEqual([])
  })
})
