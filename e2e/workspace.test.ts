import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { BINARY, NARROW, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary against the fake Wrike where a real terminal or
 * a real launch matters: theme colors in the escape codes, restarts that
 * prove the session and the cache come back from disk, the launch variables,
 * and the panes at 80 by 24. Captures are saved for a person to read.
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

  test("a theme switches at once, and Save as default writes the config", async () => {
    await launch(tmux)
    await tmux.see("launch", "2 Inbox", "Engineering")
    await tmux.keys("1", "j", "j", "j", "j", "Space")
    await tmux.see("tree-space-open", /│ {3}▸ Platform\s+│/)
    await tmux.keys("j", "Enter", "l")
    await tmux.see("platform", "2 Platform  8 · status")
    expect(await tmux.styledScreen()).not.toContain("48;2;")
    await palette(tmux, "theme: dark")
    await tmux.see("theme-dark", "2 Platform")
    expect(await tmux.styledScreen()).toContain(DARK_BACKGROUND)
    await palette(tmux, "theme: light")
    await tmux.see("theme-light", "2 Platform")
    expect(await tmux.styledScreen()).toContain("48;2;239;241;245")
    await palette(tmux, "theme: high")
    await tmux.see("theme-high-contrast", "2 Platform")
    expect(await tmux.styledScreen()).toContain("38;2;255;255;0")
    await palette(tmux, "theme: dark")
    await palette(tmux, "group by importance")
    await palette(tmux, "save as default")
    await tmux.see("save-default", "Saved the theme, field history and this list's shaping as the default")
    const config = (await Bun.file(join(e2e.env.XDG_CONFIG_HOME!, "wrike-tui", "config.json")).json()) as { theme: string; lists: { folder: { group: string } } }
    expect(config.theme).toBe("dark")
    expect(config.lists.folder.group).toBe("importance")
    await palette(tmux, "group by status")
    await tmux.see("group-status-again", "2 Platform  8 · status")
  })

  test("quitting and starting again comes back to the same place, painted from the cache", async () => {
    await tmux.keys("G", "k", "Enter")
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
    const back = await tmux.see("restored", "2 Platform  8 · status", /│ {3}▾ Platform\s+│/, /│ {7}Runbooks\s+│/, "Register the sandbox as a service provider", "Could not load, press r")
    const pane = (screen: string, index: number) => screen.split("\n").slice(1, -2).map((line) => line.split("│")[index])
    expect(pane(back, 3)).toEqual(pane(left, 3))
    expect(pane(back, 5)).toEqual(pane(left, 5))
    expect(await tmux.styledScreen()).toContain(DARK_BACKGROUND)
    e2e.fake.heal()
    await tmux.keys("r")
    await tmux.see("restored-and-reloaded", absent("Could not load"), "2 Platform  8 · status")
  })

  test("WRIKE_TUI_NO_RESTORE=1 starts on the Inbox with the tree closed", async () => {
    await tmux.keys("q")
    await launch(tmux, "WRIKE_TUI_NO_RESTORE=1")
    const fresh = await tmux.see("no-restore", "2 Inbox", "Enable SSO on sandbox", /│ ▸ Engineering\s+│/, "Select a task and press Enter to open it here.")
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

  test("the list keeps its title and due date, and subtasks still nest", async () => {
    await launch(tmux)
    fits(await tmux.see("launch", "2 Inbox", "3 Details", absent("1 Wrike")))
    await tmux.keys("1", "j", "j", "j", "j", "Space", "j", "Enter")
    fits(await tmux.see("folder-scoped", "1 Wrike", "2 Platform  8 · status", /│ {7}Runbooks\s+│/))
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
    fits(await tmux.see("filtered", "2 Platfo…  8 · assignee · 1 filter", "Fix login redirect loop", absent("Enable SSO")))
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
})
