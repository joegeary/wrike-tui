import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary through field history and attachments against
 * the fake Wrike: history of every kind in the comment stream, H on and off,
 * a rate-limited history load, and attachments selected, previewed and
 * opened. The tests share one session and run in order.
 */
setDefaultTimeout(60_000)

const absent = (text: string) => new RegExp(`^(?![\\s\\S]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
/** A change line. A long one wraps in the 160-column layout, so only its start is matched. */
const change = (author: string, what: string) => new RegExp(`│ {2}${author} {2}\\w{3} \\d+ \\d\\d:\\d\\d {2}${what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)

let e2e: E2e
let tmux: TmuxSession

beforeAll(async () => {
  e2e = await startE2e("phase-3-activity", WIDE, { WRIKE_TOKEN: TOKEN })
  tmux = e2e.tmux
})
afterAll(() => e2e.stop())

const historyCalls = () => e2e.fake.toolCalls.filter((call) => call.name === "get_item_history")

describe("field history", () => {
  test("folds into the comments, one line per change of every kind, an unknown shape named by its type", async () => {
    await tmux.run(BINARY)
    await tmux.see("inbox", "2 Inbox", "Fix login redirect loop")
    await tmux.keys("j", "j", "Enter")
    // The thumbnail and the attachments push the oldest changes above the fold, so G brings the stream's end into view.
    await tmux.see("history-open", "Comments (1) · 16 changes", change("Pat Example", "Work Type: DB"))
    await tmux.keys("G")
    const stream = await tmux.see(
      "history-stream",
      change("Pat Example", "title Fix login loop → Fix login"),
      change("Riley Demo", "custom fields changed"),
      change("Pat Example", "removed attachment old-capture.har"),
      change("Riley Demo", "due cleared"),
      change("Sam Sample", "duration 1d → 2d"),
      change("Sam Sample", "moved out of Q4 Launch"),
      change("Sam Sample", "moved into Platform"),
      change("Jordan Placeholder", "unassigned Riley Demo"),
      change("Pat Example", "assigned Pat Example"),
      change("Pat Example", "attached callback-loop.png"),
      change("Pat Example", "status New → In Progress"),
      change("Riley Demo", "attached Login flow notes"),
      change("Jordan Placeholder", "Labels: auth, sso"),
      change("Pat Example", "Work Type: DB"),
      /│ {2}Repro steps attached, it loops after the callback\. +│/,
    )
    expect(stream).toMatch(/start \d{4}-\d\d-\d\d/)
    expect(stream).toMatch(/due \d{4}-\d\d-\d\d/)
    const lines = stream.split("\n")
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line))
    // The Inbox row on the left quotes the comment too, so the comment is found by its indent in the details pane.
    const comment = at(/│ {2}Repro steps attached/)
    expect(at(/ assigned Pat Example/)).toBeLessThan(comment)
    expect(comment).toBeLessThan(at(/status New → In Progress/))
    expect(historyCalls()).toHaveLength(1)
  })

  test("H hides it and shows it again without asking Wrike twice", async () => {
    await tmux.keys("H")
    await tmux.see("history-hidden", "Field history hidden", /Comments \(1\) +│/, absent("Work Type: DB"))
    await tmux.keys("H")
    await tmux.see("history-shown", "Field history shown among the comments", "Comments (1) · 16 changes")
    expect(historyCalls()).toHaveLength(1)
  })
})

describe("attachments", () => {
  test("list with kind, size, author and date, and ] draws the image's thumbnail in blocks", async () => {
    await tmux.keys("g")
    await tmux.see(
      "attachments",
      "Attachments (4)",
      /│ {2}callback-loop\.png {2}PNG image {2}178 KB {2}Pat Example {2}\w{3} \d+ +│/,
      /│ {2}har-capture\.txt {2}text {2}47 KB {2}Pat Example {2}\w{3} \d+ +│/,
      /│ {2}whiteboard\.jpg {2}JPEG image {2}2\.2 MB {2}Pat Example {2}\w{3} \d+ +│/,
      /│ {2}Login flow notes {2}Google {2}Riley Demo {2}\w{3} \d+ +│/,
    )
    await tmux.keys("]")
    await tmux.see("attachment-thumbnail", /┃callback-loop\.png/, /┃[▀▄█]{20,}/, "Enter open")
  })

  test("Enter hands Wrike's signed link to the browser", async () => {
    await tmux.keys("Enter")
    await tmux.see("attachment-opened", "Opening callback-loop.png in the browser")
    const urls = join(e2e.work, "opened-urls")
    // The browser recorder runs after the flash is drawn.
    for (let tries = 0; tries < 50 && !(await Bun.file(urls).exists()); tries++) await Bun.sleep(50)
    expect((await Bun.file(urls).text()).trim()).toBe("https://storage.example.test/attachments/IEAAAAAAIYAAAA01/callback-loop.png?signature=fake-1")
    expect(e2e.fake.requests.filter((line) => line.includes("/download"))).toEqual([])
  })

  test("an image the terminal cannot draw says so in a line", async () => {
    await tmux.keys("]", "]")
    await tmux.see("attachment-undrawable", /┃whiteboard\.jpg/, "┃This preview cannot be drawn here. Enter opens the file.")
    await tmux.keys("Escape")
    await tmux.see("attachment-unselected", absent("┃"))
  })
})

describe("a rate-limited history load", () => {
  test("leaves the comments with a one-line notice, and r loads it", async () => {
    e2e.fake.failTool({ tool: "get_item_history", text: "Rate limit exceeded. Try again in 60 seconds." })
    await tmux.keys("2", "k", "k", "Enter")
    await tmux.see("history-rate-limited", "Register the sandbox as a service provider", "Wrike is rate limiting history. Press r to retry.", "The identity provider team needs the entity ID by Friday.")
    await tmux.keys("r")
    await tmux.see("history-retried", "Comments (3) · no changes", absent("rate limiting"))
  })

  test("q quits", async () => {
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell")
    await tmux.see("quit", /^back-in-the-shell$/m)
  })
})
