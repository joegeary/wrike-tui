import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { FOLDER, SPACE } from "../test/fake/workspace"
import { BINARY, NARROW, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary through every Phase 2 flow against the fake
 * Wrike: once on a wide terminal, with restarts that prove the session and
 * the cache come back, and once at 80 by 24. Captures are saved for a person
 * to read.
 */
setDefaultTimeout(120_000)

const ACCOUNT = "IEAAAAAA"
const DARK_BACKGROUND = "48;2;30;30;46"
const absent = (text: string) => new RegExp(`^(?![\\s\\S]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)

/** Runs a command from the palette by typing enough of its title. */
async function palette(tmux: TmuxSession, command: string) {
  await tmux.type(":")
  await tmux.type(command)
  await tmux.keys("Enter")
}

async function launch(tmux: TmuxSession, variables = "") {
  await tmux.run("clear")
  await tmux.run(`${variables}${variables ? " " : ""}${BINARY}`)
}

const stateFile = (e2e: E2e, name: string) => join(e2e.env.XDG_STATE_HOME!, "wrike-tui", ACCOUNT, name)

describe("a wide terminal", () => {
  let e2e: E2e
  let tmux: TmuxSession

  beforeAll(async () => {
    e2e = await startE2e("phase-2-wide", WIDE, { WRIKE_TOKEN: TOKEN })
    tmux = e2e.tmux
  })
  afterAll(() => e2e.stop())

  test("the nav pane lists the views and every space that is not archived", async () => {
    await launch(tmux)
    const first = await tmux.see("launch", "2 Inbox", "Enable SSO on sandbox", /│ ▸ Sam's space\s+│/, "▸ Engineering", "▸ Operations", "▸ Support")
    expect(first).not.toContain("Archive 2019")
    expect(first).toMatch(/│ Spaces\s+│/)
  })

  test("Space opens a space and Enter scopes the list to a folder, with the focus kept in the tree", async () => {
    await tmux.keys("1", "j", "j", "j", "j", "Space")
    await tmux.see("tree-space-open", /│ ▾ Engineering\s+│/, /│ {3}▸ Platform\s+│/, /│ {3}▸ Q4 Launch\s+│/, /│ {5}Parking lot\s+│/)
    await tmux.keys("j", "Enter")
    const scoped = await tmux.see("tree-folder-scoped", "2 Platform  8 · status", /│ {3}▾ Platform\s+│/, /│ {7}Runbooks\s+│/, "Enter show")
    expect(scoped).toMatch(/▾ New 4 ─+│/)
    expect(scoped).toMatch(/│! {3}Enable SSO on sandbox\s+Sam, Pat\s+\w{3} \d+│/)
    expect(scoped).toMatch(/│! ▸ Fix login redirect loop\s+Pat\s+\w{3} \d+│/)
  })

  test("a folder under two parents is drawn under each of them", async () => {
    await tmux.keys("j", "j", "j", "j", "Space")
    const both = await tmux.see("tree-multi-parent", /│ {3}▾ Q4 Launch\s+│/)
    expect(both.split("\n").filter((line) => /│ {7}Shared docs\s+│/.test(line))).toHaveLength(2)
    await tmux.keys("Enter")
    await tmux.see("tree-project-scoped", "2 Q4 Launch  2 · status", "Draft the Q4 launch checklist")
  })

  test("subtasks open under their parent with Space and close again", async () => {
    await tmux.keys("k", "k", "k", "k", "Enter", "l", "G", "Space")
    const open = await tmux.see("subtasks-open", "2 Platform  8 · status", /│! ▾ Fix login redirect loop/, /│ {6}Reproduce the redirect loop on s…\s+Pat/, /│ {6}Patch the callback handler\s+Riley/)
    expect(open).toMatch(/│↓ {3}List the macros agents use most\s+Riley/)
    await tmux.keys("Space")
    await tmux.see("subtasks-closed", /│! ▸ Fix login redirect loop/, absent("Patch the callback handler"))
  })

  test(": opens the palette for the focused pane, and typing ranks the commands", async () => {
    await tmux.type(":")
    const open = await tmux.see("palette-open", "─ Commands ─", /│ Navigate\s+│/, /▸ Focus the navigation pane\s+1 │/, "Type to find a command", "Enter run")
    expect(open).toMatch(/Go to the pane on the left\s+h ← │/)
    await tmux.type("group")
    await tmux.see("palette-typed", /│ : group▏/, /▸ Group by status/, "Group by assignee", "Subgroup by status", absent("│ Navigate"))
    await tmux.keys("Escape")
    await tmux.see("palette-closed", absent("─ Commands ─"), "2 Platform  8 · status")
  })

  test("the palette groups, subgroups and sorts, and the pane title says what is applied", async () => {
    await palette(tmux, "group by assignee")
    await tmux.see("group-assignee", "2 Platform  8 · assignee", /▾ Pat Example 2 ─/, /▾ Riley Demo 1 ─/, /▾ Sam Sample 4 ─/)
    await palette(tmux, "subgroup by importance")
    await tmux.see("subgroup-importance", /│ {2}▾ High 2 ─/, /│ {2}▾ Low 1 ─/)
    await palette(tmux, "subgroup by nothing")
    await palette(tmux, "group by due")
    await tmux.see("group-due", "2 Platform  8 · due", /▾ Overdue 1 ─/, /▾ No date 1 ─/)
    await palette(tmux, "group by nothing")
    await palette(tmux, "sort by title")
    const sorted = await tmux.see("sort-title", "2 Platform  8 ─", /│↓ {3}Archive last year's dashboards/)
    expect(sorted.indexOf("Archive last year")).toBeLessThan(sorted.indexOf("Clean up stale"))
    await palette(tmux, "reverse the sort")
    const reversed = await tmux.see("sort-title-reversed", "Rotate API keys")
    expect(reversed.indexOf("Rotate API keys")).toBeLessThan(reversed.indexOf("Archive last year"))
    await palette(tmux, "group by status")
    await tmux.see("group-status-again", "2 Platform  8 · status")
  })

  test("f filters by title, a filter picks its values in a picker, and the filters clear", async () => {
    await tmux.keys("f")
    await tmux.see("filter-input", "│f ", "title contains", "Shows tasks whose title contains this. Empty clears it.")
    await tmux.type("api")
    await tmux.keys("Enter")
    await tmux.see("filter-text", "2 Platform  8 · status · 1 filter", /▾ New 1 ─/, "Rotate API keys", absent("Enable SSO on sandbox"))
    await palette(tmux, "clear the filters")
    await tmux.see("filter-cleared", "Filters cleared", "2 Platform  8 · status ─")
    await palette(tmux, "filter by assignee")
    await tmux.see("filter-assignee-picker", "─ Filter by assignee ─", "[ ] Unassigned", "[ ] Riley Demo", "Space toggle")
    await tmux.type("ril")
    await tmux.keys("Space", "Enter")
    await tmux.see("filter-assignee", "2 Platform  8 · status · 1 filter", "List the macros agents use most", absent("Enable SSO on sandbox"))
    await palette(tmux, "filter by due")
    await tmux.see("filter-due-picker", "─ Filter by due date ─", /▸ Any date/, "Due this week", "No due date")
    await tmux.keys("Escape")
    await palette(tmux, "filter by status")
    await tmux.see("filter-status-picker", "─ Filter by status ─", /\[ \] ● New/, /\[ \] ● In Progress/)
    await tmux.keys("Escape")
    await palette(tmux, "clear the filters")
    await tmux.see("filter-cleared-again", "2 Platform  8 · status ─")
  })

  test("the columns are chosen in a picker", async () => {
    await palette(tmux, "choose the columns")
    await tmux.see("columns-picker", "─ Columns ─", "[x] Importance", "[ ] Status", "[x] Assignees", "[x] Due date", "[ ] ID")
    await tmux.keys("Down", "Space", "Down", "Space", "Enter")
    await tmux.see("columns-status", /│! {3}Enable SSO on sandbox\s+In Progress\s+\w{3} \d+│/)
    await palette(tmux, "choose the columns")
    await tmux.keys("Down", "Space", "Down", "Space", "Enter")
    await tmux.see("columns-back", /│! {3}Enable SSO on sandbox\s+Sam, Pat\s+\w{3} \d+│/)
  })

  test("x brings in completed, cancelled and deferred tasks", async () => {
    await tmux.keys("x")
    await tmux.see("completed-on", "2 Platform  10 · status · all statuses", /▾ Completed 1 ─/, "Fix flaky export test", /▾ On Hold 1 ─/)
    await tmux.keys("x")
    await tmux.see("completed-off", "2 Platform  8 · status ─", "Showing active tasks only", absent("Fix flaky export test"))
  })

  test("F keeps favorites in the nav pane and on disk, J and K move them, and Enter goes to one", async () => {
    await tmux.keys("g", "j", "F")
    await tmux.see("favorite-task", "Added Rotate API keys for the staging cluster to the favorites", /│ Favorites\s+│/, /│ ★ Rotate API keys for the/)
    await tmux.keys("1", "F")
    await tmux.see("favorite-folder", "Added Platform to the favorites", /│ ★ Platform\s+│/)
    await tmux.keys("k", "k", "k", "K")
    const moved = await tmux.see("favorite-moved", /│ ★ Platform\s+│/)
    expect(moved.indexOf("★ Platform")).toBeLessThan(moved.indexOf("★ Rotate API keys"))
    expect(((await Bun.file(stateFile(e2e, "favorites.json")).json()) as { favorites: { title: string }[] }).favorites.map((favorite) => favorite.title)).toEqual([
      "Platform",
      "Rotate API keys for the staging cluster",
    ])
    await tmux.keys("j", "Enter")
    await tmux.see("favorite-task-opened", "3 Details", "Rotate before the audit.")
    await tmux.keys("1", "k", "Enter")
    await tmux.see("favorite-folder-scoped", "2 Platform  8 · status")
  })

  test("a list of more than a thousand tasks loads a page at a time and stays quick", async () => {
    await tmux.keys("1")
    for (let step = 0; step < 11; step++) await tmux.keys("j")
    await tmux.keys("Space")
    await tmux.see("big-space-open", /│ ▾ Operations\s+│/, /│ {5}Service Requests\s+│/, /│ {3}▸ Catalog Reviews 1\s+│/)
    await tmux.keys("j", "Enter", "l")
    await tmux.see("big-folder-first-page", "2 Service Requests  200+ · status", /▾ New \d+ ─/)
    for (const loaded of ["400+", "600+", "800+", "1000+"]) {
      await tmux.keys("G")
      await tmux.see(`big-folder-${loaded.replace("+", "")}`, `2 Service Requests  ${loaded} · status`)
    }
    await tmux.keys("G")
    await tmux.see("big-folder-complete", "2 Service Requests  1040 · status", absent("Load more"))
    await tmux.keys("g")
    await tmux.type("j".repeat(300))
    await tmux.see("big-folder-held-j", "2 Service Requests  1040 · status")
    await palette(tmux, "group by assignee")
    await tmux.see("big-folder-regrouped", "2 Service Requests  1040 · assignee")
    await tmux.keys("g")
    await tmux.see("big-folder-regrouped-top", /▾ Jordan Placeholder \d+ ─/)
    await palette(tmux, "close every")
    const closed = await tmux.see("big-folder-collapsed", /▸ Jordan Placeholder \d+ ─/, /▸ Unassigned \d+ ─/)
    expect(closed.split("\n").filter((line) => /│▸ .* \d+ ─+│/.test(line))).toHaveLength(4)
    await palette(tmux, "group by status")
    expect(e2e.fake.requests.filter((line) => line.includes(`/folders/${FOLDER.requests}/tasks`))).toHaveLength(6)
  })

  test("the tree goes six levels down and scrolls with the cursor", async () => {
    await tmux.keys("1")
    for (let level = 0; level < 5; level++) await tmux.keys("j", "Space")
    const deep = await tmux.see("tree-deep", /│ {11}▾ \S/, /│ {15}\S/)
    expect(deep).toMatch(/│ {9}▾ \S/)
    for (let step = 0; step < 45; step++) await tmux.keys("j")
    await tmux.see("tree-scrolled", absent("│   My to-do"), "Sam Sample")
    for (let step = 0; step < 60; step++) await tmux.keys("k")
    await tmux.see("tree-top-again", "│   Inbox")
  })

  test("? shows the keys for the pane, read from the same registry", async () => {
    await tmux.keys("?")
    await tmux.see("legend-nav", "─ Keys ─", "Show it in the list", "Open or close the row", /F\s+Add or remove a favorite/, /:\s+Show the commands/, absent("Move the favorite down"))
    await tmux.keys("Escape", "2", "?")
    await tmux.see("legend-list", "─ Keys ─", /Space\s+Open or close the row/, /x\s+Completed tasks on or off/, /f\s+Filter by title/, absent("Toggle read notifications"))
    await tmux.keys("Escape")
  })

  test("a theme switches at once, and Save as default writes the config", async () => {
    expect(await tmux.styledScreen()).not.toContain("48;2;")
    await palette(tmux, "theme: dark")
    await tmux.see("theme-dark", "2 Service Requests")
    expect(await tmux.styledScreen()).toContain(DARK_BACKGROUND)
    await palette(tmux, "theme: light")
    await tmux.see("theme-light", "2 Service Requests")
    expect(await tmux.styledScreen()).toContain("48;2;239;241;245")
    await palette(tmux, "theme: high")
    await tmux.see("theme-high-contrast", "2 Service Requests")
    expect(await tmux.styledScreen()).toContain("38;2;255;255;0")
    await palette(tmux, "theme: dark")
    await palette(tmux, "group by importance")
    await palette(tmux, "save as default")
    await tmux.see("save-default", "Saved the theme and this list's shaping as the default")
    const config = (await Bun.file(join(e2e.env.XDG_CONFIG_HOME!, "wrike-tui", "config.json")).json()) as { theme: string; lists: { folder: { group: string } } }
    expect(config.theme).toBe("dark")
    expect(config.lists.folder.group).toBe("importance")
  })

  test("r reloads the list, the reference data, the spaces and the open trees, and waits out a Retry-After", async () => {
    const before = e2e.fake.requests.length
    e2e.fake.fail({ path: `/api/v4/folders/${FOLDER.requests}/tasks`, status: 429, retryAfter: "1" })
    const started = Date.now()
    await tmux.keys("r")
    await tmux.see("reloading", "2 Service Requests  1040 · importance (refreshing)")
    await tmux.see("reloaded", "2 Service Requests  200+ · importance ─")
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000)
    const paths = e2e.fake.requests.slice(before).map((line) => line.replace(/\?.*/, ""))
    for (const path of ["GET /api/v4/contacts", "GET /api/v4/workflows", "GET /api/v4/spaces", `GET /api/v4/spaces/${SPACE.operations}/folders`, `GET /api/v4/spaces/${SPACE.engineering}/folders`]) {
      expect(paths).toContain(path)
    }
    expect(paths.filter((path) => path === `GET /api/v4/folders/${FOLDER.requests}/tasks`)).toHaveLength(2)
  })

  test("a list that fails says why and r recovers, and an empty folder says how to see more", async () => {
    e2e.fake.fail({ path: `/api/v4/folders/${FOLDER.requests}/tasks`, status: 500 })
    await tmux.keys("r")
    await tmux.see("list-error", "Wrike failed with 500: Injected failure. Press r to retry.", /▾ High \d+ ─/)
    await tmux.keys("r")
    await tmux.see("list-recovered", absent("Wrike failed"), "2 Service Requests  200+")
    await tmux.keys("1")
    for (let step = 0; step < 80; step++) await tmux.keys("k")
    await tmux.keys("j", "j", "j", "j", "j", "j")
    await tmux.see("at-engineering", /│ ▾ Engineering\s+│/)
    for (let step = 0; step < 7; step++) await tmux.keys("j")
    await tmux.keys("Enter")
    await tmux.see("empty-folder", "2 Parking lot  0 · importance", "No active task here. Press x to show completed ones.")
  })

  test("quitting and starting again comes back to the same place, painted from the cache", async () => {
    await tmux.keys("k", "k", "k", "k", "k", "k", "Enter", "l", "G", "Enter")
    await tmux.see("before-quit", "2 Platform  8 · status", "3 Details", "Register the sandbox as a service provider")
    await tmux.keys("h")
    const left = await tmux.see("before-quit-list", "2 Platform  8 · status")
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell")
    await tmux.see("quit", /^back-in-the-shell$/m)
    const session = (await Bun.file(stateFile(e2e, "session.json")).json()) as { scope: { title: string }; openTaskId: string; focus: string }
    expect(session).toMatchObject({ scope: { kind: "folder", title: "Platform" }, focus: "list" })

    // Wrike is down for the spaces and the trees, so what the nav pane shows can only come from the cache.
    e2e.fake.fail({ path: "/api/v4/spaces", status: 500, times: 20 })
    await launch(tmux)
    const back = await tmux.see("restored", "2 Platform  8 · status", /│ {3}▾ Platform\s+│/, /│ {7}Runbooks\s+│/, "Register the sandbox as a service provider", /│ ★ Platform\s+│/, "Could not load, press r")
    const pane = (screen: string, index: number) => screen.split("\n").slice(1, -2).map((line) => line.split("│")[index])
    expect(pane(back, 3)).toEqual(pane(left, 3))
    expect(pane(back, 5)).toEqual(pane(left, 5))
    expect(await tmux.styledScreen()).toContain(DARK_BACKGROUND)
    e2e.fake.heal()
    await tmux.keys("r")
    await tmux.see("restored-and-reloaded", absent("Could not load"), "2 Platform  8 · status")
  })

  test("WRIKE_TUI_NO_RESTORE=1 starts on the Inbox, with the favorites and the theme kept", async () => {
    await tmux.keys("q")
    await launch(tmux, "WRIKE_TUI_NO_RESTORE=1")
    const fresh = await tmux.see("no-restore", "2 Inbox", "Enable SSO on sandbox", /│ ▸ Engineering\s+│/, /│ ★ Platform\s+│/, "Select a task and press Enter to open it here.")
    expect(fresh).not.toContain("Runbooks")
    await tmux.keys("q")
  })

  test("read-only mode refuses every write and says so", async () => {
    await launch(tmux, "WRIKE_TUI_NO_RESTORE=1 WRIKE_TUI_READ_ONLY=1")
    await tmux.see("read-only-launch", "2 Inbox", /q quit {2}read-only\s*$/m)
    const writes = e2e.fake.writes.length
    await tmux.keys("Enter")
    await tmux.see("read-only-task", "Comments (3)")
    await tmux.keys("p", "Down", "Enter")
    await tmux.see("read-only-refused", "read-only mode: not saved", /Importance\s+High/)
    await tmux.keys("c")
    await tmux.type("This must never be posted")
    await tmux.keys("Enter")
    await tmux.see("read-only-comment-refused", "read-only mode: not saved", "Comments (3)")
    expect(e2e.fake.writes).toHaveLength(writes)
    await tmux.keys("q")
  })

  test("a config file that does not parse is moved aside, and the status bar says so", async () => {
    const config = join(e2e.env.XDG_CONFIG_HOME!, "wrike-tui", "config.json")
    await Bun.write(config, '{ "theme": "sparkles" }')
    await launch(tmux, "WRIKE_TUI_NO_RESTORE=1")
    await tmux.see("config-moved-aside", "Could not read config.json. Kept as config.json.bad, using the defaults.", "2 Inbox")
    expect(await Bun.file(`${config}.bad`).text()).toBe('{ "theme": "sparkles" }')
    expect(await tmux.styledScreen()).not.toContain(DARK_BACKGROUND)
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell-again")
    await tmux.see("quit-again", /^back-in-the-shell-again$/m)
  })
})

describe("80 by 24", () => {
  let e2e: E2e
  let tmux: TmuxSession

  beforeAll(async () => {
    e2e = await startE2e("phase-2-narrow", NARROW, { WRIKE_TOKEN: TOKEN })
    tmux = e2e.tmux
  })
  afterAll(() => e2e.stop())

  const fits = (screen: string) => {
    for (const line of screen.split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(NARROW.width)
    return screen
  }

  test("the tree takes the details pane's place while it has the focus", async () => {
    await launch(tmux)
    fits(await tmux.see("launch", "2 Inbox", "3 Details", "Enable SSO on sandb", absent("1 Wrike")))
    await tmux.keys("1")
    fits(await tmux.see("nav", "1 Wrike", "2 Inbox", /│ ▸ Engineering\s+│/, absent("3 Details")))
    await tmux.keys("j", "j", "j", "j", "Space", "j", "Enter")
    const scoped = fits(await tmux.see("folder-scoped", "1 Wrike", "2 Platform  8 · status", /│ {7}Runbooks\s+│/))
    expect(scoped).toMatch(/│! {3}Enable SSO on sandbox\s+\w{3} \d+│/)
  })

  test("the list keeps its title and due date, and subtasks still nest", async () => {
    await tmux.keys("l")
    fits(await tmux.see("list", "2 Platform  8 · status", "3 Details", absent("1 Wrike")))
    await tmux.keys("G", "Space")
    const open = fits(await tmux.see("subtasks", /│! ▾ Fix login redirect loop\s+\w{3} \d+│/, /│ {6}Patch the callback/))
    expect(open).toMatch(/│ {6}Reproduce the re\S*…?\s+\w{3} \d+│/)
  })

  test("the palette, a picker and the legend fit", async () => {
    await tmux.type(":")
    fits(await tmux.see("palette", "─ Commands ─", /▸ Focus the navigation pane\s+1 │/))
    await tmux.type("filter by assignee")
    await tmux.keys("Enter")
    fits(await tmux.see("picker", "─ Filter by assignee ─", "[ ] Unassigned"))
    await tmux.keys("Escape", "?")
    const legend = fits(await tmux.see("legend", "─ Keys ─", "Add or remove a favorite", "Show the commands", "Quit"))
    expect(legend).not.toContain("…││")
    await tmux.keys("Escape")
  })

  test("grouping, a filter and the paged list read well in a narrow pane", async () => {
    await palette(tmux, "group by assignee")
    fits(await tmux.see("group-assignee", "2 Platform  8 · assignee", /▾ Sam Sample 4 ─/))
    await tmux.keys("f")
    await tmux.type("fix")
    await tmux.keys("Enter")
    fits(await tmux.see("filtered", "2 Platform  8 · assignee · 1 filter", "Fix login redirect loop", absent("Enable SSO")))
    await palette(tmux, "clear the filters")
    await tmux.keys("1")
    for (let step = 0; step < 6; step++) await tmux.keys("j")
    await tmux.keys("Space")
    fits(await tmux.see("big-space", /│ ▾ Operations\s+│/, /│ {5}Service Requests\s+│/))
    await tmux.keys("j", "Enter", "l", "G")
    fits(await tmux.see("big-folder", "2 Service Requests  400+ · status"))
    await tmux.keys("g", "j", "F")
    fits(await tmux.see("favorite", "Added "))
    await tmux.keys("1")
    fits(await tmux.see("favorite-in-nav", /│ Favorites\s+│/, /│ ★ \S/))
  })

  test("a restart restores the session at this size too", async () => {
    await tmux.keys("Enter", "q")
    await launch(tmux)
    fits(await tmux.see("restored", "2 Service Requests  200+ · status", /│ ★ \S/, "1 Wrike"))
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell")
    await tmux.see("quit", /^back-in-the-shell$/m)
  })
})
