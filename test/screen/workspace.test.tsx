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

  test("Space opens a space, which loads its tree once, and closes it again", async () => {
    await atSpaces()
    await app.press("j", "space")
    const open = await app.see("Q4 Launch")
    expect(nav(open).slice(5, 9)).toEqual([" ▾ Engineering", "   ▸ Platform", "   ▸ Q4 Launch", "     Parking lot"])
    expect(app.store.getState().scope).toEqual({ kind: "inbox" })
    await app.press("space")
    expect(nav(await app.frame())).not.toContain("   ▸ Platform")
    await app.press("space")
    await app.see("Parking lot")
    expect(app.fake.requests.filter((line) => line === `GET /api/v4/spaces/${SPACE.engineering}/folders`)).toHaveLength(1)
  })

  test("a space with no folders says so by having nothing to open", async () => {
    await atSpaces()
    await app.press("space")
    await app.see(/│ {3}Sam's space/)
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
    expect(app.fake.requests).toContain(`GET /api/v4/folders/${FOLDER.platform}/tasks?descendants=true&subTasks=true&status=Active&pageSize=200&fields=%5B%22responsibleIds%22%2C%22parentIds%22%2C%22description%22%2C%22subTaskIds%22%2C%22superTaskIds%22%5D`)
  })

  test("a folder under two parents is drawn under each, and a project scopes like a folder", async () => {
    await atSpaces()
    await app.press("j", "space", "j", "space", "j", "j", "j", "j", "enter")
    const frame = await app.see("2 Q4 Launch  2 · status")
    expect(nav(frame).filter((line) => line.includes("Shared docs"))).toEqual(["       Shared docs", "       Shared docs"])
    expect(app.store.getState().scope).toMatchObject({ kind: "folder", project: true })
    expect(list(frame)).toEqual([
      expect.stringMatching(/^▾ In Progress 1 ─+$/),
      expect.stringMatching(/^! Enable SSO on sandbox\s+Sam, Pat\s+Nov 11$/),
      expect.stringMatching(/^▾ In Review 1 ─+$/),
      expect.stringMatching(/^ {2}Draft the Q4 launch checklist\s+Sam, Riley\s+Nov 13$/),
    ])
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

  test("a tree that fails to load says so under its space, and r loads it", async () => {
    await atSpaces()
    app.fake.fail({ path: `/api/v4/spaces/${SPACE.engineering}/folders`, status: 500 })
    await app.press("j", "space")
    const failed = await app.see("Wrike failed with 500: Injected failure")
    expect(nav(failed)[6]).toBe("     Could not load, press r")
    await app.press("r")
    await app.see("Parking lot")
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

  test("going back to a list just left draws it at once", async () => {
    await inPlatform()
    await app.press("t")
    await app.see("2 My to-do  6 · due")
    app.fake.fail({ path: `/api/v4/folders/${FOLDER.platform}/tasks`, status: 500 })
    await app.press("1", "enter")
    const back = await app.see("Wrike failed with 500")
    expect(back).toContain("Fix login redirect loop")
    expect(back).toContain("2 Platform  8 · status")
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

  test("expand all and collapse all come from the palette", async () => {
    await inPlatform()
    await palette("open every")
    await app.see("Patch the callback handler")
    await palette("close every")
    const closed = await app.frame()
    expect(list(closed)).toEqual([expect.stringMatching(/^▸ New 4 ─+$/), expect.stringMatching(/^▸ In Progress 2 ─+$/)])
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

  test("a filter picks its values in the picker", async () => {
    await inPlatform()
    await palette("filter by assignee")
    const picker = await app.see("─ Filter by assignee ─", "[ ] Unassigned", "[ ] Riley Demo")
    expect(picker).toContain("Space toggle")
    await app.type("ril")
    await app.press("space", "enter")
    const filtered = await app.see("2 Platform  8 · status · 1 filter")
    expect(filtered).toContain("List the macros agents use most")
    expect(filtered).not.toContain("Enable SSO on sandbox")
    await palette("filter by due")
    await app.see("─ Filter by due date ─", "Due this week")
    await app.press("down", "down", "down", "enter")
    await app.see("2 Platform  8 · status · 2 filters")
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

  test("it offers only what applies where it was opened", async () => {
    await atSpaces()
    await app.press(":")
    await app.type("group by")
    await app.see("No command matches.")
    await app.press("esc", ":")
    await app.type("favorite")
    await app.see("▸ Add or remove a favorite")
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

  test("a favorite Wrike no longer has is marked not found, and a renamed one takes its new title", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-fav-"))
    await atSpaces({ home })
    await app.press("j", "space", "j", "F", "j", "F")
    await app.see("Added Q4 Launch to the favorites")
    await app.close()

    app = await openApp(WIDE, { home, restore: false })
    await app.see("★ Q4 Launch")
    app.fake.data.folders.find((folder) => folder.id === FOLDER.launch)!.title = "Q4 Launch (moved to January)"
    const { folders } = app.fake.data
    folders.splice(folders.findIndex((folder) => folder.id === FOLDER.platform), 1)
    for (const folder of folders) folder.childIds = folder.childIds.filter((id) => id !== FOLDER.platform)
    await app.press("1", "j", "j", "j", "enter")
    const gone = await app.see("★ Platform (not found)", "Wrike could not find that item. Press r to retry.")
    expect(gone).toContain("2 Platform · status")
    await app.press("1", "j", "j", "j", "space")
    await app.see("★ Q4 Launch (moved to Janu…")
  })
})

describe("Files on disk", () => {
  async function put(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, content)
  }

  test("the nav pane paints from the cache while Wrike is unreachable", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-cache-"))
    await atSpaces({ home })
    await app.press("j", "space")
    await app.see("Parking lot")
    await app.close()
    expect(await Bun.file(app.paths.spaces).exists()).toBe(true)
    expect(await Bun.file(app.paths.tree(SPACE.engineering as never)).exists()).toBe(true)

    app = await openApp(WIDE, { home })
    app.fake.fail({ path: "/api/v4/spaces", status: 500, times: 10 })
    const offline = await app.see("Engineering", "Operations")
    expect(offline).toContain("Wrike failed with 500")
    await app.press("1", "j", "j", "j", "j", "space")
    const cached = await app.see("Parking lot", "Q4 Launch")
    expect(nav(cached)).toContain("   ▸ Platform")
  })

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

  test("a launch told not to restore starts on the Inbox with the tree closed", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-session-"))
    await inPlatform({ home })
    await app.close()
    app = await openApp(WIDE, { home, restore: false })
    const frame = await app.see("2 Inbox", "Enable SSO on sandbox", "Engineering")
    expect(nav(frame)).toContain(" ▸ Engineering")
    expect(frame).toContain("Select a task and press Enter to open it here.")
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

  test("a config file that does not parse is moved aside and the status bar says so once", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-config-"))
    const config = join(home, "config", "wrike-tui", "config.json")
    await put(config, '{ "theme": "sparkles" }')
    app = await openApp(WIDE, { home })
    await app.see("Could not read config.json. Kept as config.json.bad, using the defaults.")
    expect(await Bun.file(`${config}.bad`).text()).toBe('{ "theme": "sparkles" }')
    expect(app.store.getState().settings.theme).toBe("terminal")
    await app.press("j")
    expect(await app.frame()).not.toContain("Could not read")
  })

  test("a theme switches at once, and Save as default writes it with this list's shaping", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-config-"))
    await inPlatform({ home })
    await palette("theme: high", "group by due", "save as default")
    await app.see("Saved the theme and this list's shaping as the default")
    const written = (await Bun.file(app.paths.config).json()) as { theme: string; lists: { folder: { group: string } } }
    expect(written.theme).toBe("high-contrast")
    expect(written.lists.folder.group).toBe("due")
    await app.close()

    app = await openApp(WIDE, { home, restore: false })
    await app.see("Enable SSO on sandbox", "Engineering")
    expect(app.store.getState().settings.theme).toBe("high-contrast")
    await app.press("1", "j", "j", "j", "j", "space", "j", "j", "j", "enter")
    await app.see("2 Parking lot  0 · due")
  })
})

describe("Reloading and read-only mode", () => {
  test("r reloads the list and the reference data, the spaces and the open trees", async () => {
    await inPlatform()
    const before = app.fake.requests.length
    await app.press("r")
    await app.see("2 Platform  8 · status")
    const after = app.fake.requests.slice(before).map((line) => line.replace(/\?.*/, ""))
    expect(after.sort()).toEqual(
      ["GET /api/v4/contacts", "GET /api/v4/workflows", "GET /api/v4/spaces", `GET /api/v4/spaces/${SPACE.engineering}/folders`, `GET /api/v4/folders/${FOLDER.platform}/tasks`].sort(),
    )
  })

  test("read-only mode refuses a save before it is sent and says so", async () => {
    app = await openApp(WIDE, { readOnly: true })
    const frame = await app.see("Enable SSO on sandbox")
    expect(frame).toContain("Sam Sample · read-only")
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
