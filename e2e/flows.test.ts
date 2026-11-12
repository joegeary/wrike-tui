import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { localDay } from "../src/domain/dates"
import { ME, STATUS, TASK } from "../test/fake/data"
import { createFakeWrike, type FakeWrike } from "../test/fake/wrike"
import { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary in a detached tmux session against the fake
 * Wrike, through every Phase 1 flow. Run it with `bun run e2e`, which builds
 * first. Every screen is saved to $WRIKE_TUI_E2E_CAPTURES for a person to read.
 * The tests share one session and run in order.
 */
const BINARY = resolve(import.meta.dir, "../dist/wrike-tui")
const TOKEN = "e2e-secret-token"
const KEYRING_SERVICE = `wrike-tui-e2e-${process.pid}`
const WIDE = { width: 160, height: 45 }
/** The theme's selection color, #313244, as tmux reports a truecolor background. */
const SELECTION_BG = "48;2;49;50;68"

setDefaultTimeout(60_000)

let work: string
let fake: FakeWrike
let server: ReturnType<typeof Bun.serve>
let tmux: TmuxSession
let env: Record<string, string>

async function script(name: string, body: string): Promise<string> {
  const path = join(work, name)
  await Bun.write(path, `#!/usr/bin/env zsh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const lastWrite = () => fake.writes.at(-1)

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "wrike-tui-e2e-"))
  const now = new Date()
  fake = createFakeWrike({ token: TOKEN, today: localDay(now), now: now.toISOString() })
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fake.handle })
  const origin = `http://127.0.0.1:${server.port}`
  env = {
    WRIKE_BASE_URL: `${origin}/api/v4`,
    WRIKE_MCP_URL: `${origin}/mcp`,
    WRIKE_TUI_KEYRING_SERVICE: KEYRING_SERVICE,
    XDG_CONFIG_HOME: join(work, "config"),
    EDITOR: await script("editor", 'print -r -- "" >> "$1"\nprint -r -- "Edited in the e2e editor." >> "$1"'),
    BROWSER: await script("browser", `print -r -- "$1" >> "${join(work, "opened-urls")}"`),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  }
  tmux = new TmuxSession(join(work, "tmux.sock"), process.env.WRIKE_TUI_E2E_CAPTURES ?? join(work, "captures"))
  await tmux.start(WIDE, env)
})

afterAll(async () => {
  await tmux.kill()
  server.stop(true)
  await Bun.secrets.delete({ service: KEYRING_SERVICE, name: "token" })
  await rm(work, { recursive: true, force: true })
})

describe("auth", () => {
  test("opening the client before login explains what to do", async () => {
    await tmux.run(BINARY)
    await tmux.see("not-logged-in", "Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN.")
  })

  test("auth login prompts without echo, verifies the token and stores it in the keyring", async () => {
    await tmux.run("clear")
    await tmux.run(`${BINARY} auth login`)
    await tmux.see("auth-login-prompt", "Wrike access token:")
    await tmux.type(TOKEN)
    expect(await tmux.screen()).not.toContain(TOKEN)
    await tmux.keys("Enter")
    const done = await tmux.see("auth-login-done", `Logged in as Sam Sample on 127.0.0.1:${server.port}. The token is in the OS keyring.`)
    expect(done).not.toContain(TOKEN)
    expect(await Bun.secrets.get({ service: KEYRING_SERVICE, name: "token" })).toBe(TOKEN)
    expect(await Bun.file(join(env.XDG_CONFIG_HOME!, "wrike-tui", "profile.json")).json()).toEqual({
      host: `127.0.0.1:${server.port}`,
      accountId: "IEAAAAAA",
      userId: ME,
      name: "Sam Sample",
    })
  })

  test("auth status names the user and the token source", async () => {
    await tmux.run(`${BINARY} auth status`)
    await tmux.see("auth-status", "The token comes from the OS keyring.")
  })

  test("a wrong token is refused and nothing changes", async () => {
    await tmux.run("clear")
    await tmux.run(`${BINARY} auth login`)
    await tmux.see("auth-login-prompt-again", "Wrike access token:")
    await tmux.type("not-the-token")
    await tmux.keys("Enter")
    await tmux.see("auth-login-refused", "No Wrike data center accepted that token. Nothing was stored.")
    expect(await Bun.secrets.get({ service: KEYRING_SERVICE, name: "token" })).toBe(TOKEN)
  })
})

describe("the client", () => {
  test("opens on the Inbox with the stored token", async () => {
    await tmux.run("clear")
    await tmux.run(BINARY)
    const inbox = await tmux.see("inbox", "2 Inbox", "Enable SSO on sandbox", /▸ Inbox\s+6 /, /My to-do\s+6 /, "Sam Sample")
    expect(inbox).toMatch(/● Other\s+Approval requested/)
    expect(inbox).toMatch(/● Mention\s+Enable SSO on sandbox\s+35m/)
    expect(inbox).toContain("Pat Example: @Sam Sample can we run trainings in the")
  })

  test("the selected row is highlighted and the highlight follows j", async () => {
    // Between the pane borders a row reads: "", nav, "", list, "", details, "".
    const highlighted = async () =>
      (await tmux.styledScreen())
        .split("\n")
        .map((line) => line.split("│")[3] ?? "")
        .filter((list) => list.includes(SELECTION_BG))
        .map(Bun.stripANSI)
    expect((await highlighted()).join("\n")).toMatch(/Mention\s+Enable SSO on sandbox[\s\S]*Pat Example: @Sam Sample/)
    await tmux.keys("j")
    await tmux.see("inbox-second-row", "2 Inbox")
    const moved = (await highlighted()).join("\n")
    expect(moved).toMatch(/Assign\s+Rotate API keys/)
    expect(moved).not.toContain("Enable SSO on sandbox")
    await tmux.keys("k")
  })

  test("Enter opens the task behind a notification", async () => {
    await tmux.keys("Enter")
    const details = await tmux.see("inbox-open-task", "Register the sandbox as a service provider", "Comments (3)")
    expect(details).toMatch(/Status\s+● In Progress/)
    expect(details).toMatch(/Assignees\s+Sam Sample, Pat Example/)
    expect(details).toMatch(/Folders\s+Platform, Q4 Launch/)
    expect(details).toContain("overdue")
  })

  test("j scrolls the details and v zooms them", async () => {
    await tmux.keys("G")
    await tmux.see("details-scrolled", "can we run trainings in the sandbox?", "Riley Demo")
    await tmux.keys("g", "v")
    const zoomed = await tmux.see("details-zoomed", "3 Details", "Register the sandbox")
    expect(zoomed).not.toContain("2 Inbox")
    await tmux.keys("v", "h")
  })

  test("a shows read notifications and a project notification opens in the browser", async () => {
    await tmux.keys("a")
    await tmux.see("inbox-with-read", "2 Inbox (with read)", "Added the escalation matrix.")
    await tmux.keys("a")
    await tmux.see("inbox-unread-again", "Showing unread notifications only")
    await tmux.keys("G", "Enter")
    await tmux.see("inbox-project-in-browser", "Opening the project in the browser")
    await tmux.keys("k", "Enter")
    await tmux.see("inbox-nothing-to-open", "This notification has nothing to open")
    expect((await Bun.file(join(work, "opened-urls")).text()).trim()).toBe("https://www.wrike.com/open.htm?id=4598459002")
  })

  test("t shows My to-do in its buckets", async () => {
    await tmux.keys("t")
    const todo = await tmux.see("todo", "2 My to-do", "Overdue 1", "Today 1", "Later 2", "No date 1")
    expect(todo.indexOf("Overdue 1")).toBeLessThan(todo.indexOf("Today 1"))
    expect(todo.indexOf("Later 2")).toBeLessThan(todo.indexOf("No date 1"))
    expect(todo).toMatch(/! Enable SSO on sandbox/)
  })

  test("/ searches titles", async () => {
    await tmux.keys("/")
    await tmux.see("search-input", "title, permalink or task ID")
    await tmux.type("fix")
    await tmux.see("search-typing", "/ fix")
    await tmux.keys("Enter")
    await tmux.see("search-results", "2 Search: fix", "Fix login redirect loop", "Fix flaky export test")
  })

  test("/ with a permalink opens that task, and a numeric ID does too", async () => {
    await tmux.keys("/")
    await tmux.type("https://www.wrike.com/open.htm?id=4598459107")
    await tmux.keys("Enter")
    await tmux.see("search-permalink", "The session cookie is dropped", "Comments (1)")
    await tmux.keys("/")
    await tmux.type("4598459105")
    await tmux.keys("Enter")
    await tmux.see("search-numeric-id", "Clean up stale feature flags", "No description.", "No comments yet.")
    await tmux.keys("/")
    await tmux.type("no such task anywhere")
    await tmux.keys("Enter")
    await tmux.see("search-empty", 'No task matches "no such task anywhere".')
  })

  test("m assigns a task to me", async () => {
    await tmux.keys("/")
    await tmux.type("login")
    await tmux.keys("Enter")
    await tmux.see("search-login", "Fix login redirect loop")
    await tmux.keys("m")
    const taken = await tmux.see("assign-to-me", "Assigned to you", /Assignees\s+Pat Example, Sam Sample/, /My to-do\s+7 /)
    expect(taken).toContain("3 Details")
    expect(lastWrite()).toEqual({ method: "PUT", path: `/tasks/${TASK.login}`, params: { addResponsibles: `["${ME}"]` } })
  })

  test("s changes the status through the picker", async () => {
    await tmux.keys("t", "Enter")
    await tmux.see("todo-open-task", "Comments (3)")
    await tmux.keys("s")
    await tmux.see("status-picker", "─ Status ─", /▸ ● In Progress/, "On Hold")
    await tmux.type("rev")
    await tmux.see("status-picker-filtered", "Filter: rev", /▸ ● In Review/)
    await tmux.keys("Enter")
    await tmux.see("status-saved", "Status set to In Review", /Status\s+● In Review/)
    expect(lastWrite()).toEqual({ method: "PUT", path: `/tasks/${TASK.sso}`, params: { customStatus: STATUS.inReview } })
  })

  test("e walks the fields: title, importance, assignees and dates", async () => {
    await tmux.keys("e")
    await tmux.see("edit-mode", "Edit mode", /▸ Enable SSO on sandbox/, "Enter opens it in $EDITOR")
    await tmux.keys("Enter")
    await tmux.type(" for staff")
    await tmux.see("edit-title-typing", "Enable SSO on sandbox for staff")
    await tmux.keys("Enter")
    await tmux.see("edit-title-saved", "Title saved", /▸ Enable SSO on sandbox for staff/)
    expect(lastWrite()?.params).toEqual({ title: "Enable SSO on sandbox for staff" })

    await tmux.keys("j", "j", "Enter")
    await tmux.see("importance-picker", "─ Importance ─", /▸ High/)
    await tmux.keys("Down", "Enter")
    await tmux.see("importance-saved", "Importance set to Normal", /▸ Importance\s+Normal/)

    await tmux.keys("j", "Enter")
    await tmux.see("assignees-picker", "─ Assignees ─", /\[x\] Pat Example/, /\[ \] Riley Demo/)
    await tmux.type("riley")
    await tmux.keys("Space")
    await tmux.see("assignees-picker-toggled", /\[x\] Riley Demo/)
    await tmux.keys("Enter")
    await tmux.see("assignees-saved", "Assignees updated", /Assignees\s+Sam Sample, Pat Example, Riley Demo/)
    expect(lastWrite()?.params).toEqual({ addResponsibles: '["KUAAAA03"]' })

    await tmux.keys("j", "j", "Enter", "C-u")
    await tmux.type("tomorrow")
    await tmux.keys("Enter")
    await tmux.see("due-date-refused", "Use YYYY-MM-DD, or leave it empty to clear")
    await tmux.keys("C-u")
    await tmux.type("2027-01-15")
    await tmux.keys("Enter")
    await tmux.see("due-date-saved", "Due date set to 2027-01-15", /Due\s+2027-01-15 {2}Jan 15 2027/)
    expect(JSON.parse(lastWrite()!.params.dates!)).toMatchObject({ type: "Planned", due: "2027-01-15" })
  })

  test("the description opens in $EDITOR as markdown and is saved as HTML", async () => {
    await tmux.keys("j", "Enter")
    await tmux.see("description-saved", "Description saved from markdown", "Edited in the e2e editor.")
    expect(lastWrite()?.params.description).toEndWith("for the certificate rotation notes.<br /><br />Edited in the e2e editor.")
    await tmux.keys("Escape")
    await tmux.see("edit-mode-left", /^(?![\s\S]*Edit mode)/)
  })

  test("c posts a comment, and Ctrl+E finishes one in $EDITOR", async () => {
    await tmux.keys("c")
    await tmux.see("comment-compose", "─ New comment ─", "Write a comment")
    await tmux.type("The sandbox is ready for trainings.")
    await tmux.see("comment-typing", "The sandbox is ready for trainings.")
    await tmux.keys("Enter")
    await tmux.see("comment-posted", "Comment posted", "Comments (4)", "The sandbox is ready for trainings.")
    expect(lastWrite()).toEqual({
      method: "POST",
      path: `/tasks/${TASK.sso}/comments`,
      params: { text: "The sandbox is ready for trainings.", plainText: "true" },
    })
    await tmux.keys("c")
    await tmux.type("Longer note.")
    await tmux.keys("C-e")
    await tmux.see("comment-from-editor", "Comment posted", "Comments (5)", "Edited in the e2e editor.")
    expect(lastWrite()?.params.text).toBe("Longer note.\n\nEdited in the e2e editor.")
  })

  test("o opens the browser, y copies the URL and Y the ID", async () => {
    await tmux.keys("o")
    await tmux.see("open-in-browser", "Opening in the browser")
    await tmux.keys("y")
    await tmux.see("copy-url", "Copied the URL")
    expect(await tmux.clipboard()).toBe("https://www.wrike.com/open.htm?id=4598459101")
    await tmux.keys("Y")
    await tmux.see("copy-id", "Copied the ID 4598459101")
    expect(await tmux.clipboard()).toBe("4598459101")
    expect((await Bun.file(join(work, "opened-urls")).text()).trim().split("\n").at(-1)).toBe("https://www.wrike.com/open.htm?id=4598459101")
  })

  test("? shows the keys for the focused pane", async () => {
    await tmux.keys("?")
    await tmux.see("legend-details", "─ Keys ─", "Scroll down", "Change the status", "Zoom the details pane")
    await tmux.keys("Escape")
    await tmux.see("legend-closed", /^(?![\s\S]*─ Keys ─)/)
    await tmux.keys("i", "?")
    await tmux.see("legend-inbox", "─ Keys ─", "Toggle read notifications")
    await tmux.keys("q")
    await tmux.see("legend-closed-again", /^(?![\s\S]*─ Keys ─)/, "2 Inbox")
  })

  test("a failed load shows the error and r recovers", async () => {
    fake.fail({ path: "/api/v4/tasks", status: 500 })
    await tmux.keys("t", "r")
    await tmux.see("list-error", "Wrike failed with 500: Injected failure", "retry.")
    await tmux.keys("r")
    await tmux.see("list-recovered", /^(?![\s\S]*Wrike failed)/, "Today 1")
  })

  test("at 80 columns the navigation pane hides and everything still fits", async () => {
    await tmux.resize(80, 24)
    const narrow = await tmux.see("narrow-todo", "2 My to-do", "3 Details", /^(?![\s\S]*1 Wrike)/)
    for (const line of narrow.split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80)
    await tmux.keys("i", "g", "Enter")
    await tmux.see("narrow-inbox-task", "2 Inbox", /│ Enable SSO on sandbox for staff/, "Description")
    await tmux.keys("l", "G")
    await tmux.see("narrow-details-scrolled", "Comments (5)", "Longer note.", /^(?![\s\S]*Importance)/)
    await tmux.keys("g")
    await tmux.see("narrow-details-top", "Importance")
    await tmux.keys("s")
    await tmux.see("narrow-status-picker", "─ Status ─")
    await tmux.keys("Escape")
    await tmux.see("narrow-picker-closed", /^(?![\s\S]*─ Status ─)/)
    await tmux.keys("?")
    const legend = await tmux.see("narrow-legend", "─ Keys ─", "Copy the ID", "Quit")
    expect(legend).not.toContain("…││")
    await tmux.keys("Escape")
    await tmux.see("narrow-legend-closed", /^(?![\s\S]*─ Keys ─)/)
    await tmux.keys("1")
    await tmux.see("narrow-nav", "1 Wrike", /^(?![\s\S]*3 Details)/)
    await tmux.keys("v")
    await tmux.see("narrow-zoom", "3 Details", /^(?![\s\S]*2 Inbox)/)
    await tmux.resize(50, 10)
    await tmux.see("too-small", "wrike-tui needs at least 60 columns and 12 rows")
    await tmux.resize(WIDE.width, WIDE.height)
    await tmux.see("wide-again", "3 Details")
  })

  test("q quits and gives the terminal back", async () => {
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell")
    await tmux.see("quit", /^back-in-the-shell$/m)
  })
})

describe("token sources and logout", () => {
  test("a rejected WRIKE_TOKEN says so and does not open the client", async () => {
    await tmux.run("clear")
    await tmux.run(`WRIKE_TOKEN=revoked ${BINARY}`)
    await tmux.see("env-token-rejected", "Wrike rejected the token. Run `wrike-tui auth login`.")
  })

  test("an unreachable server is a network error, not a crash", async () => {
    await tmux.run("clear")
    await tmux.run(`WRIKE_TOKEN=${TOKEN} WRIKE_BASE_URL=http://127.0.0.1:9/api/v4 ${BINARY}`)
    await tmux.see("server-unreachable", "Could not reach Wrike:")
  })

  test("auth logout removes the token and the profile", async () => {
    await tmux.run("clear")
    await tmux.run(`${BINARY} auth logout`)
    await tmux.see("auth-logout", "Logged out. The stored token and profile are removed.")
    await tmux.run(`${BINARY} auth status`)
    await tmux.see("auth-status-logged-out", "Not logged in.")
    expect(await Bun.secrets.get({ service: KEYRING_SERVICE, name: "token" })).toBeNull()
    expect(await Bun.file(join(env.XDG_CONFIG_HOME!, "wrike-tui", "profile.json")).exists()).toBe(false)
  })
})
