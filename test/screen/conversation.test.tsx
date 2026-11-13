import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { TASK } from "../fake/data"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
afterEach(() => app.close())

const WIDE = { width: 200, height: 60 }
const LOGIN_ITEM = "w:itm:4598459107"

const historyCalls = () => app.fake.toolCalls.filter((call) => call.name === "get_item_history")

/** The Inbox's third notification is a comment on "Fix login redirect loop", which has a field history of every kind. */
async function openLogin(): Promise<string> {
  await app.see("Fix login redirect loop")
  await app.press("j", "j", "enter")
  return app.see("The session cookie is dropped", "Repro steps attached")
}

describe("Field history", () => {
  test("folds into the comments by time, one dim line per change, each kind drawn and an unknown one named", async () => {
    app = await openApp(WIDE)
    await openLogin()
    const frame = await app.see("Comments (1) · 16 changes", "Work Type: DB")
    const lines = frame.split("\n").map((line) => line.split("│").at(-2)?.trim() ?? "")
    const stream = lines.slice(lines.findIndex((line) => line.startsWith("Comments (1)")) + 1).filter((line) => line !== "")
    const change = (author: string, what: string) => new RegExp(`^${author} {2}\\w{3} \\d+ \\d\\d:\\d\\d {2}${what}$`)
    expect(stream).toHaveLength(18)
    expect(stream[0]).toMatch(change("Pat Example", "title Fix login loop → Fix login redirect loop"))
    expect(stream[1]).toMatch(change("Riley Demo", "custom fields changed"))
    expect(stream[2]).toMatch(change("Pat Example", "removed attachment old-capture\\.har"))
    expect(stream[3]).toMatch(change("Riley Demo", "due cleared"))
    expect(stream[4]).toMatch(change("Sam Sample", "duration 1d → 2d"))
    expect(stream[5]).toMatch(change("Sam Sample", "start 2026-11-13"))
    expect(stream[6]).toMatch(change("Sam Sample", "moved out of Q4 Launch"))
    expect(stream[7]).toMatch(change("Sam Sample", "moved into Platform"))
    expect(stream[8]).toMatch(change("Jordan Placeholder", "unassigned Riley Demo"))
    expect(stream[9]).toMatch(change("Pat Example", "assigned Pat Example"))
    expect(stream[10]).toMatch(change("Pat Example", "attached callback-loop\\.png"))
    // The comment from three hours ago sits between the changes from three hours and two minutes and two hours ago.
    expect(stream[11]).toMatch(/^Pat Example {2}\w{3} \d+ \d\d:\d\d$/)
    expect(stream[12]).toBe("Repro steps attached, it loops after the callback.")
    expect(stream[13]).toMatch(change("Pat Example", "status New → In Progress"))
    expect(stream[14]).toMatch(change("Riley Demo", "due 2026-11-14"))
    expect(stream[15]).toMatch(change("Riley Demo", "attached Login flow notes"))
    expect(stream[16]).toMatch(change("Jordan Placeholder", "Labels: auth, sso"))
    expect(stream[17]).toMatch(change("Pat Example", "Work Type: DB"))

    const dim = (await app.spans()).find((span) => span.text.includes("status New → In Progress"))!
    const body = (await app.spans()).find((span) => span.text.includes("Repro steps attached"))!
    expect(dim.fg).not.toEqual(body.fg)

    expect(historyCalls()).toEqual([
      {
        name: "get_item_history",
        arguments: {
          scope: { type: "ITEMS", itemIds: [LOGIN_ITEM] },
          requestedChanges: ["TITLE", "ASSIGNEES", "PARENTS", "STATUS", "START_DATE", "DUE_DATE", "DURATION", "ATTACHMENTS", "CUSTOM_FIELDS"],
          pageSize: 50,
        },
      },
    ])
  })

  test("H hides and shows it, reopening a task costs no MCP call, and Save as default keeps it off", async () => {
    app = await openApp(WIDE)
    await openLogin()
    await app.see("Work Type: DB")
    await app.press("H")
    const hidden = await app.see("Field history hidden", "Comments (1)")
    expect(hidden).not.toContain("Work Type: DB")
    expect(hidden).not.toContain("changes")
    await app.press("H")
    await app.see("Field history shown among the comments", "Comments (1) · 16 changes", "Work Type: DB")
    await app.press("2", "k", "k", "enter")
    await app.see("Comments (3)")
    await app.press("2", "j", "j", "enter")
    await app.see("Comments (1) · 16 changes")
    expect(historyCalls().map((call) => (call.arguments.scope as { itemIds: string[] }).itemIds[0])).toEqual([LOGIN_ITEM, "w:itm:4598459101"])

    await app.press("H", ":")
    await app.type("save as default")
    await app.press("enter")
    await app.see("Saved the theme and field history as the default")
    expect(JSON.parse(await readFile(app.paths.config, "utf8"))).toMatchObject({ history: false })
  })

  test("with history off, opening a task makes no MCP call, and turning it on fetches it then", async () => {
    app = await openApp(WIDE)
    await app.see("Fix login redirect loop")
    await app.press("H")
    await app.see("Field history hidden")
    await openLogin()
    expect(historyCalls()).toEqual([])
    await app.press("H")
    await app.see("Comments (1) · 16 changes")
    expect(historyCalls()).toHaveLength(1)
  })

  test("a rate-limited load leaves the comments with a short notice, and r tries again", async () => {
    app = await openApp(WIDE)
    app.fake.failTool({ tool: "get_item_history", text: "Rate limit exceeded. Try again later." })
    await openLogin()
    const limited = await app.see("Wrike is rate limiting history. Press r to retry.")
    expect(limited).toContain("Repro steps attached, it loops after the callback.")
    expect(limited).toMatch(/Comments \(1\)\s/)
    expect(limited).not.toContain("Work Type")
    await app.press("r")
    await app.see("Comments (1) · 16 changes", "Work Type: DB")
    expect(historyCalls()).toHaveLength(2)
  })

  test("stays drawn in the frames while r reloads the open task", async () => {
    app = await openApp(WIDE)
    await openLogin()
    await app.see("Comments (1) · 16 changes", "Work Type: DB")
    const release = app.fake.hold(`/api/v4/tasks/${TASK.login}`)
    app.store.dispatch({ type: "key", key: "r" })
    const reloading = await app.peek()
    release()
    expect(reloading).toContain("Details (refreshing)")
    expect(reloading).toContain("Comments (1) · 16 changes")
    expect(reloading).toMatch(/Pat Example {2}\w{3} \d+ \d\d:\d\d {2}Work Type: DB/)
    await app.see("Comments (1) · 16 changes", "Work Type: DB")
    expect(historyCalls()).toHaveLength(2)
  })

  test("older changes load only when asked for, a page at a time", async () => {
    app = await openApp(WIDE)
    const login = app.fake.data.history[TASK.login]!
    const oldest = login.at(-1)!
    for (let n = 1; n <= 45; n++) {
      const timestamp = new Date(Date.parse(oldest.timestamp) - n * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z")
      login.push({ ...oldest, timestamp, payload: { oldValue: `Draft ${n + 1}`, newValue: `Draft ${n}` } })
    }
    await openLogin()
    await app.see("Comments (1) · 50+ changes", "Older changes are not loaded. Press : and run Load older changes.")
    expect(historyCalls()).toHaveLength(1)
    await app.press(":")
    await app.type("older")
    await app.press("enter")
    const all = await app.see("Comments (1) · 61 changes", /Pat Example {2}\w{3} \d+ \d\d:\d\d {2}title Draft 46 → Draft 45/)
    expect(all).not.toContain("Older changes are not loaded")
    expect(historyCalls().map((call) => call.arguments.nextPageToken !== undefined)).toEqual([false, true])
  })
})

describe("Attachments", () => {
  const SHOT_URL = "https://storage.example.test/attachments/IEAAAAAAIYAAAA01/callback-loop.png?signature=fake-1"

  test("list each file with its kind, size, author and date, above the comments", async () => {
    app = await openApp(WIDE)
    await openLogin()
    const frame = await app.see("Attachments (4)")
    const lines = frame.split("\n").map((line) => line.split("│").at(-2)?.trim() ?? "")
    const at = lines.indexOf("Attachments (4)")
    expect(lines.slice(at + 1, at + 6)).toEqual([
      "callback-loop.png  PNG image  178 KB  Pat Example  Nov 12",
      "har-capture.txt  text  47 KB  Pat Example  Nov 12",
      "whiteboard.jpg  JPEG image  2.2 MB  Pat Example  Nov 12",
      "Login flow notes  Google  Riley Demo  Nov 12",
      "",
    ])
    expect(at).toBeLessThan(lines.findIndex((line) => line.startsWith("Comments (1)")))
    expect(app.fake.requests.filter((line) => line.includes("/attachments/"))).toEqual([])
  })

  test("] selects the first file and draws its thumbnail, and Enter opens it through Wrike's signed link", async () => {
    app = await openApp(WIDE)
    await openLogin()
    await app.press("]")
    const selected = await app.see(/┃callback-loop\.png/, "Enter open", /[▀▄█]/)
    expect(selected).not.toContain("Loading the preview")
    await app.press("enter")
    await app.see("Opening callback-loop.png in the browser")
    expect(app.outside.opened).toEqual([SHOT_URL])
    expect(app.fake.requests.filter((line) => line.includes("/attachments/"))).toEqual([
      "GET /api/v4/attachments/IEAAAAAAIYAAAA01/preview",
      "GET /api/v4/attachments/IEAAAAAAIYAAAA01/url",
    ])
  })

  test("a text file has no thumbnail, an image the terminal cannot draw says so, and ] goes on to the comments", async () => {
    app = await openApp(WIDE)
    await openLogin()
    await app.press("]", "]")
    await app.see(/┃har-capture\.txt/)
    await app.press("]")
    await app.see(/┃whiteboard\.jpg/, "This preview cannot be drawn here. Enter opens the file.")
    await app.press("]", "]")
    await app.see(/┃Pat Example/, "Enter edit comment")
    expect(app.fake.requests.filter((line) => line.endsWith("/preview"))).toEqual(["GET /api/v4/attachments/IEAAAAAAIYAAAA01/preview", "GET /api/v4/attachments/IEAAAAAAIYAAAA03/preview"])
  })
})
