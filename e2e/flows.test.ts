import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { ME, TASK } from "../test/fake/data"
import type { FakeWrike } from "../test/fake/wrike"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary in a detached tmux session against the fake
 * Wrike, through login, the keyring, the $EDITOR, browser and clipboard
 * handoffs, the cursor row's escape codes and a resize. Run it with
 * `bun run e2e`, which builds first. Every screen is saved to $WRIKE_TUI_E2E_CAPTURES for a
 * person to read. The tests share one session and run in order.
 */
const KEYRING_SERVICE = `wrike-tui-e2e-${process.pid}`
/** The terminal theme's selection color, ANSI color 8, as tmux reports an indexed background. */
const SELECTION_BG = "48;5;8"

setDefaultTimeout(60_000)

let e2e: E2e
let work: string
let fake: FakeWrike
let server: { port: number }
let tmux: TmuxSession
let env: Record<string, string>

const lastWrite = () => fake.writes.at(-1)

beforeAll(async () => {
  e2e = await startE2e("phase-1", WIDE, { WRIKE_TUI_KEYRING_SERVICE: KEYRING_SERVICE })
  ;({ work, fake, tmux, env } = e2e)
  server = { port: Number(new URL(e2e.origin).port) }
})

afterAll(async () => {
  await e2e.stop()
  await Bun.secrets.delete({ service: KEYRING_SERVICE, name: "token" })
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
    const inbox = await tmux.see("inbox", "2 Inbox", "Enable SSO on sandbox", /│ {3}Inbox\s+6 │/, /My to-do\s+6 /, "Sam Sample", "Engineering")
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

  test("the description opens in $EDITOR as markdown and is saved as HTML", async () => {
    await tmux.keys("Enter")
    await tmux.see("inbox-open-task", "Register the sandbox as a service provider", "Comments (3)")
    await tmux.keys("e", "j", "j", "j", "j", "j", "j", "Enter")
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

  test("at 80 columns the navigation pane hides and everything still fits", async () => {
    await tmux.resize(80, 24)
    const narrow = await tmux.see("narrow-inbox", "2 Inbox", "3 Details", /^(?![\s\S]*1 Wrike)/)
    for (const line of narrow.split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80)
    await tmux.keys("i", "g", "Enter")
    await tmux.see("narrow-inbox-task", "2 Inbox", /│ Enable SSO on sandbox/, "Description")
    await tmux.keys("l", "G")
    await tmux.see("narrow-details-scrolled", "Longer note.", "Edited in the e2e editor.", /^(?![\s\S]*Importance)/)
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
    await tmux.see("auth-logout", "Logged out. The stored login and profile are removed.")
    await tmux.run(`${BINARY} auth status`)
    await tmux.see("auth-status-logged-out", "Not logged in.")
    expect(await Bun.secrets.get({ service: KEYRING_SERVICE, name: "token" })).toBeNull()
    expect(await Bun.file(join(env.XDG_CONFIG_HOME!, "wrike-tui", "profile.json")).exists()).toBe(false)
  })
})
