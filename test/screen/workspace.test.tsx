import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { FOLDER, SPACE } from "../fake/workspace"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
let home: string | null = null
afterEach(async () => {
  await app.close()
  if (home) await rm(home, { recursive: true, force: true })
  home = null
})

const WIDE = { width: 160, height: 45 }

/** The lines of one pane between its borders, right-trimmed. Pane 0 is the nav pane, 1 the list. */
function pane(frame: string, index: number): string[] {
  return frame
    .split("\n")
    .slice(1, -3)
    .map((line) => (line.replace(/^│/, "").replace(/│$/, "").split("││")[index] ?? "").trimEnd())
    .filter((line) => line !== "")
}
const nav = (frame: string) => pane(frame, 0)
const list = (frame: string) => pane(frame, 1)

/** Opens the app with the nav pane focused and the cursor on the first space. */
async function atSpaces(options: Parameters<typeof openApp>[1] = {}, size = WIDE) {
  app = await openApp(size, options)
  await app.see("Enable SSO on sandbox", "Engineering")
  await app.press("1", "j", "j", "j")
  return app
}

/** Scopes the list to Engineering > Platform and moves the focus into the list. */
async function inPlatform(options: Parameters<typeof openApp>[1] = {}) {
  await atSpaces(options)
  await app.press("j", "space", "j", "enter", "l")
  await app.see("2 Platform  8 · status")
}

async function palette(...commands: string[]) {
  for (const command of commands) {
    await app.press(":")
    await app.see("─ Commands ─")
    await app.type(command)
    await app.press("enter")
  }
}

describe("The workspace tree", () => {
  test("lists every space that is not archived, Personal first, under the three views", async () => {
    app = await openApp(WIDE)
    const frame = await app.see("Enable SSO on sandbox", "Engineering")
    expect(nav(frame)).toEqual(["   Inbox                  6", "   My to-do               6", "   Search", " Spaces", " ▸ Sam's space", " ▸ Engineering", " ▸ Operations", " ▸ Support", " Sam Sample"])
    expect(frame).not.toContain("Archive 2019")
  })

  test("Enter scopes the list to a folder, opens the row and keeps the focus in the tree", async () => {
    await atSpaces()
    await app.press("j", "enter")
    const space = await app.see("2 Engineering  9 · status", "▸ Platform")
    expect(space).toContain("Draft the Q4 launch checklist")
    await app.press("j", "enter")
    const folder = await app.see("2 Platform  8 · status", "Runbooks")
    expect(nav(folder).slice(5, 11)).toEqual([" ▾ Engineering", "   ▾ Platform", "       Runbooks", "       Incidents", "       Shared docs", "   ▸ Q4 Launch"])
    expect(app.store.getState().focus).toBe("nav")
    expect(app.fake.requests).toContain(`GET /api/v4/folders/${FOLDER.platform}/tasks?descendants=true&subTasks=true&status=Active&pageSize=200&fields=%5B%22responsibleIds%22%2C%22parentIds%22%2C%22description%22%2C%22subTaskIds%22%2C%22superTaskIds%22%2C%22customFields%22%5D`)
  })

  test("the big space opens level by level and scrolls with the cursor", async () => {
    await atSpaces()
    await app.press("j", "j", "space")
    await app.see("Service Requests", "Catalog Reviews 1")
    for (let level = 0; level < 5; level++) await app.press("j", "j", "space")
    app.resize(160, 20)
    const deep = await app.frame()
    expect(nav(deep).some((line) => /^ {11}[▸▾ ] \S/.test(line))).toBe(true)
    for (let step = 0; step < 60; step++) await app.press("j")
    const scrolled = await app.frame()
    expect(nav(scrolled).at(-2)).toBe(" ▸ Support")
    expect(scrolled).toContain("Sam Sample")
    expect(app.fake.requests.filter((line) => line === `GET /api/v4/spaces/${SPACE.operations}/folders`)).toHaveLength(1)
  })

  test("under 100 columns the tree takes the details pane's place while it is focused", async () => {
    app = await openApp({ width: 80, height: 24 })
    await app.see("2 Inbox")
    await app.press("1", "j", "j", "j", "j", "space", "j", "enter")
    const frame = await app.see("2 Platform  8 · status", "1 Wrike")
    expect(frame).not.toContain("3 Details")
    expect(frame).toMatch(/! {3}Enable SSO on sandbox\s+Nov 11│/)
    await app.press("l")
    expect(await app.see("3 Details")).not.toContain("1 Wrike")
  })
})

describe("A paged list", () => {
  test("shows how much is loaded, loads the next page near the end, and ends complete", async () => {
    await atSpaces()
    await app.press("j", "j", "space", "j", "enter", "l")
    const first = await app.see("2 Service Requests  200+ · status")
    expect(first).toMatch(/▾ New \d+ ─/)
    const tasks = () => app.fake.requests.filter((line) => line.includes(`/folders/${FOLDER.requests}/tasks`))
    expect(tasks()).toHaveLength(1)
    await app.press("G")
    await app.see("2 Service Requests  400+ · status")
    expect(tasks()).toHaveLength(2)
    expect(tasks()[1]).toContain("nextPageToken=")
    expect(tasks()[1]).toContain("fields=")
    for (const loaded of ["600+", "800+", "1000+"]) {
      await app.press("G")
      await app.see(`2 Service Requests  ${loaded} · status`)
    }
    await app.press("G")
    const all = await app.see("2 Service Requests  1040 · status")
    expect(all).not.toContain("Load more")
    await app.press("G")
    await app.frame()
    expect(tasks()).toHaveLength(6)
  })

  test("x brings in completed, cancelled and deferred tasks, and takes them out again", async () => {
    await inPlatform()
    await app.press("x")
    const everything = await app.see("2 Platform  10 · status · all statuses", "Showing completed, cancelled and deferred tasks too")
    expect(everything).toMatch(/▾ Completed 1 ─/)
    expect(everything).toContain("Fix flaky export test")
    expect(everything).toMatch(/▾ On Hold 1 ─/)
    await app.press("x")
    expect(await app.see("2 Platform  8 · status", "Showing active tasks only")).not.toContain("Fix flaky export test")
  })

  test("an empty folder says how to see more", async () => {
    await atSpaces()
    await app.press("j", "space", "j", "j", "j", "enter")
    await app.see("2 Parking lot  0 · status", "No active task here. Press x to show completed ones.")
  })
})

describe("Subtasks", () => {
  test("nest under their parent, closed until Space opens them, and one whose parent is elsewhere stands alone", async () => {
    await inPlatform()
    const closed = await app.see("▸ Fix login redirect loop")
    expect(closed).not.toContain("Reproduce the redirect loop on staging")
    expect(closed).toMatch(/↓ {3}List the macros agents use most/)
    await app.press("G", "space")
    const open = await app.see("▾ Fix login redirect loop")
    expect(list(open).slice(-4)).toEqual([
      expect.stringMatching(/^! {3}Enable SSO on sandbox\s+Sam, Pat\s+Nov 11$/),
      expect.stringMatching(/^! ▾ Fix login redirect loop\s+Pat\s+Nov 14$/),
      expect.stringMatching(/^ {6}Reproduce the redirect loop on s…\s+Pat\s+Nov 13$/),
      expect.stringMatching(/^ {6}Patch the callback handler\s+Riley$/),
    ])
    await app.press("j", "j", "enter")
    await app.see("3 Details", /Patch the callback handler/, /Assignees\s+Riley Demo/)
    await app.press("h", "k", "k", "space")
    expect(list(await app.see("▸ Fix login redirect loop")).join("\n")).not.toContain("Patch the callback handler")
  })
})

describe("Shaping a list", () => {
  test("the palette groups, subgroups and sorts, and the title says what is applied", async () => {
    await inPlatform()
    await palette("group by assignee")
    const byPerson = await app.see("2 Platform  8 · assignee")
    expect(list(byPerson).filter((line) => line.startsWith("▾"))).toEqual([
      expect.stringMatching(/^▾ Pat Example 2 ─/),
      expect.stringMatching(/^▾ Riley Demo 1 ─/),
      expect.stringMatching(/^▾ Sam Sample 4 ─/),
    ])
    await palette("subgroup by importance")
    const nested = await app.see(/ {2}▾ High 2 ─/)
    expect(nested).toMatch(/▾ Pat Example 2 ─/)
    await palette("group by nothing", "sort by title")
    const flat = await app.see("2 Platform  8 ─")
    expect(list(flat).map((line) => line.slice(4, 14))).toEqual(["Archive la", "Clean up s", "Enable SSO", "Fix login ", "List the m", "Rotate API"])
    await palette("reverse the sort")
    expect(list(await app.frame())[0]).toContain("Rotate API keys")
  })

  test("f filters by title and the title counts the filters", async () => {
    await inPlatform()
    await app.press("f")
    await app.see("title contains", "Shows tasks whose title contains this.")
    await app.type("api")
    await app.press("enter")
    const filtered = await app.see("2 Platform  8 · status · 1 filter")
    expect(list(filtered)).toEqual([expect.stringMatching(/^▾ New 1 ─/), expect.stringMatching(/^ {2}Rotate API keys for the staging cl/)])
    await app.press("f")
    await app.type("zzz")
    await app.press("enter")
    await app.see("No loaded task matches the filters. Press : and clear them.")
    await palette("clear the filters")
    await app.see("2 Platform  8 · status ─", "Filters cleared")
  })

  test("the columns are chosen in a picker and drop off when the pane is narrow", async () => {
    await inPlatform()
    app.resize(220, 45)
    await palette("choose the columns")
    await app.see("─ Columns ─", "[x] Importance", "[ ] Status", "[x] Due date")
    await app.press("down", "space", "down", "down", "down", "down", "down", "down", "space", "enter")
    const wide = await app.see(/Enable SSO on sandbox\s+In Progress\s+Sam, Pat\s+Nov 11\s+4598459101/)
    expect(wide).toBeDefined()
    app.resize(160, 45)
    const narrower = await app.see(/Enable SSO on sandbox\s+In Progress\s+Nov 11/)
    expect(narrower).not.toContain("4598459101")
    app.resize(110, 30)
    const narrow = await app.see(/! {3}Enable SSO on sandbox\s+Nov 11/)
    expect(narrow).not.toContain("In Progress  ")
  })

  test("My to-do and search keep their own defaults", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t")
    await app.see("2 My to-do  6 · due", /Enable SSO on sandbox\s+In Progress\s+Nov 11/)
    await app.press("/")
    await app.type("fix")
    await app.press("enter")
    const found = await app.see("2 Search: fix  2 ─")
    expect(found).toMatch(/! Fix login redirect loop\s+In Progress\s+Nov 5/)
    expect(found).toMatch(/Fix flaky export test\s+Completed\s+Nov 4/)
  })
})

describe("The palette", () => {
  test(": lists the commands for the focused pane under headings, with their keys", async () => {
    await inPlatform()
    await app.press(":")
    const open = await app.see("─ Commands ─", "Type to find a command")
    expect(open).toMatch(/Navigate\s/)
    expect(open).toMatch(/▸ Focus the navigation pane\s+1 /)
    expect(open).toMatch(/Go to the pane on the left\s+h ← /)
    await app.type("group")
    const ranked = await app.see("Group by status")
    expect(ranked).not.toMatch(/Navigate\s/)
    expect(ranked).toMatch(/▸ Group by status/)
    await app.press("down", "ctrl+n", "up")
    expect(await app.frame()).toMatch(/▸ Group by importance/)
    await app.press("esc")
    expect(await app.frame()).not.toContain("─ Commands ─")
    expect(app.store.getState().views.get("folder:IEAAAAAAI4AAAA01" as never)?.spec.group).toBe("status")
  })

  test("the legend and the status bar read the same registry", async () => {
    await inPlatform()
    await app.press("?")
    const legend = await app.see("─ Keys ─")
    expect(legend).toMatch(/Space\s+Open or close the row/)
    expect(legend).toMatch(/x\s+Completed tasks on or off/)
    expect(legend).toMatch(/f\s+Filter by title/)
    expect(legend).toMatch(/F\s+Add or remove a favorite/)
    expect(legend).toMatch(/:\s+Show the commands/)
    expect(legend).not.toContain("Toggle read notifications")
    await app.press("esc", "1", "?")
    const tree = await app.see("─ Keys ─", "Show it in the list")
    expect(tree).not.toContain("Move the favorite down")
    await app.press("esc")
    expect(await app.frame()).toMatch(/Enter show {2}Space open {2}\/ search {2}: commands {2}\? keys {2}q quit/)
  })

  test("the legend fits an 80 by 24 terminal, and scrolls on a shorter one", async () => {
    app = await openApp({ width: 80, height: 24 })
    await app.see("2 Inbox")
    await app.press("?")
    expect(await app.see("─ Keys ─", "Move down")).toContain("Add or remove a favorite")
    await app.press("esc")
    app.resize(80, 16)
    await app.press("?")
    const top = await app.see("─ Keys ─", "Move down")
    expect(top).not.toContain("Add or remove a favorite")
    await app.press("j", "j")
    await app.see("Add or remove a favorite")
  })
})

describe("Favorites", () => {
  test("F adds a folder, a space and a task, they are kept on disk, and a new session shows them", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-fav-"))
    await atSpaces({ home })
    await app.press("j", "space", "j", "F")
    await app.see("Added Platform to the favorites", " Favorites")
    await app.press("j", "j", "j", "F")
    await app.see("Added Operations to the favorites")
    await app.press("t", "F")
    const added = await app.see("Added Enable SSO on sandbox to the favorites")
    expect(nav(added).slice(3, 7)).toEqual([" Favorites", " ★ Platform", " ★ Operations", " ★ Enable SSO on sandbox"])
    expect(await Bun.file(app.paths.favorites).json()).toEqual({
      version: 1,
      favorites: [
        { kind: "folder", id: FOLDER.platform, title: "Platform", project: false },
        { kind: "space", id: SPACE.operations, title: "Operations" },
        { kind: "task", id: "IEAAAAAAKQAAAA01", title: "Enable SSO on sandbox" },
      ],
    })
    await app.close()

    app = await openApp(WIDE, { home, restore: false })
    const again = await app.see("Enable SSO on sandbox", "★ Platform")
    expect(nav(again).slice(3, 7)).toEqual([" Favorites", " ★ Platform", " ★ Operations", " ★ Enable SSO on sandbox"])
    await app.press("1", "j", "j", "j", "enter")
    await app.see("2 Platform  8 · status")
    expect(app.store.getState().focus).toBe("list")
    await app.press("1", "j", "j", "enter")
    await app.see("3 Details", "Register the sandbox as a service provider")
    await app.press("1", "K")
    expect(nav(await app.frame()).slice(4, 7)).toEqual([" ★ Platform", " ★ Enable SSO on sandbox", " ★ Operations"])
    await app.press("F")
    const removed = await app.see("Removed Enable SSO on sandbox from the favorites")
    expect(nav(removed).slice(4, 6)).toEqual([" ★ Platform", " ★ Operations"])
  })
})

describe("Files on disk", () => {
  async function put(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, content)
  }

  test("a new session comes back to the scope, the tree, the shaping, the cursor and the open task", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-session-"))
    await inPlatform({ home })
    await palette("group by assignee")
    await app.press("G", "enter")
    await app.see("3 Details", "Comments (0)", /Keep anything opened in the last 90 days/)
    await app.press("h")
    const left = await app.frame()
    await app.close()
    expect(((await Bun.file(app.paths.session).json()) as { scope: unknown }).scope).toEqual({ kind: "folder", id: FOLDER.platform, title: "Platform", project: false })

    app = await openApp(WIDE, { home })
    const first = await app.frame()
    expect(nav(first).slice(5, 9)).toEqual([" ▾ Engineering", "   ▾ Platform", "       Runbooks", "       Incidents"])
    const back = await app.see("2 Platform  8 · assignee", "Comments (0)", /Keep anything opened in the last 90 days/)
    expect(list(back)).toEqual(list(left))
    expect(nav(back)).toEqual(nav(left))
    expect(app.store.getState()).toMatchObject({ focus: "list", scope: { kind: "folder", id: FOLDER.platform } })
    await app.press("enter")
    await app.see("3 Details", /Keep anything opened in the last 90 days/)
    expect(app.store.getState().focus).toBe("details")
  })

  test("a config file sets the theme, the nav width and a list default", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-config-"))
    await put(join(home, "config", "wrike-tui", "config.json"), JSON.stringify({ theme: "light", navWidth: 40, lists: { todo: { group: "importance", columns: ["title", "due"] } } }))
    app = await openApp(WIDE, { home })
    const frame = await app.see("Enable SSO on sandbox")
    expect(frame.split("\n")[0]).toStartWith(`╭─ 1 Wrike ${"─".repeat(28)}╮`)
    expect(app.store.getState().settings.theme).toBe("light")
    await app.press("t")
    const todo = await app.see("2 My to-do  6 · importance")
    expect(todo).toMatch(/▾ High 1 ─/)
    expect(todo).not.toContain("In Progress")
  })
})

describe("Reloading and read-only mode", () => {
  test("read-only mode refuses a save before it is sent and says so", async () => {
    app = await openApp(WIDE, { readOnly: true })
    const frame = await app.see("Enable SSO on sandbox")
    expect(frame.trimEnd()).toEndWith("q quit  read-only")
    app.resize(80, 24)
    expect((await app.see("2 Inbox")).trimEnd()).toEndWith("c comment  read-only")
    app.resize(WIDE.width, WIDE.height)
    await app.see("1 Wrike")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("p", "down", "enter")
    const refused = await app.see("read-only mode: not saved")
    expect(refused).toMatch(/Importance\s+High/)
    await app.press("c")
    await app.type("A comment that must not be posted")
    await app.press("enter")
    await app.see("read-only mode: not saved")
    expect(app.fake.writes).toEqual([])
    expect(app.fake.requests.filter((line) => !line.startsWith("GET ") && !line.includes("/mcp"))).toEqual([])
  })
})
