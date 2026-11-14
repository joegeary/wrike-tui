import { afterEach, describe, expect, test } from "bun:test"
import { ME, STATUS, TASK } from "../fake/data"
import { FOLDER } from "../fake/workspace"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
afterEach(() => app.close())

const WIDE = { width: 160, height: 45 }

/** The lines of one pane between its borders, right-trimmed. Pane 0 is the nav pane, 1 the list. */
function pane(frame: string, index: number): string[] {
  return frame
    .split("\n")
    .slice(1, -3)
    .map((line) => (line.replace(/^│/, "").replace(/│$/, "").split("││")[index] ?? "").trimEnd())
    .filter((line) => line !== "")
}
const list = (frame: string) => pane(frame, 1)

/** Opens Engineering in the nav pane, so its folders are loaded, and leaves the cursor on it. */
async function withEngineering(options: Parameters<typeof openApp>[1] = {}) {
  app = await openApp(WIDE, options)
  await app.see("Enable SSO on sandbox", "Engineering")
  await app.press("1", "j", "j", "j", "j", "space")
  await app.see("▸ Platform")
}

/** Scopes the list to Engineering > Platform and moves the focus into the list. */
async function inPlatform(options: Parameters<typeof openApp>[1] = {}) {
  await withEngineering(options)
  await app.press("j", "enter", "l")
  await app.see("2 Platform  8 · status")
}

/** The URL `y` copies from the list's cursor row, which says which row is selected. */
async function selectedUrl(): Promise<string | undefined> {
  await app.press("2", "y")
  return app.outside.copied.at(-1)
}

async function palette(command: string) {
  await app.press(":")
  await app.see("─ Commands ─")
  await app.type(command)
  await app.press("enter")
}

const created = () => app.fake.data.tasks.at(-1)!

describe("n creates a task", () => {
  test("in a folder it goes there: an empty title is refused, then it is listed, selected and opened", async () => {
    await inPlatform()
    await app.press("n")
    await app.see("+ title of the new task", "A new task in Platform", "Enter create  Esc discard")
    await app.press("enter")
    await app.see("A title cannot be empty")
    expect(app.fake.writes).toEqual([])
    await app.type("Write the cutover runbook")
    await app.press("enter")
    const frame = await app.see('Created the task "Write the cutover runbook". Press e to edit its fields', /Folders\s+Platform/, "2 Platform  9 · status")
    expect(app.fake.writes).toEqual([{ method: "POST", path: `/folders/${FOLDER.platform}/tasks`, params: { title: "Write the cutover runbook" } }])
    expect(list(frame).some((line) => line.includes("Write the cutover runbook"))).toBe(true)
    expect(frame).toMatch(/Assignees\s+nobody/)
    expect(await selectedUrl()).toBe(created().permalink)
  })

  test("a title longer than the field scrolls inside it, behind the + lead and within the pane", async () => {
    app = await openApp({ width: 100, height: 26 })
    await app.see("Engineering")
    await app.press("1", "j", "j", "j", "j", "space")
    await app.see("▸ Platform")
    await app.press("j", "enter", "l", "n")
    await app.type("A long title for a narrow terminal")
    const line = (await app.frame()).split("\n")[1]!
    expect(line).toMatch(/││\+ [^│]*terminal\s+││/)
  })

  test("Esc discards the title and nothing is sent", async () => {
    await inPlatform()
    await app.press("n")
    await app.type("Never mind")
    await app.press("esc")
    expect(await app.frame()).not.toContain("title of the new task")
    expect(app.fake.writes).toEqual([])
  })

  test("in My to-do the folder is picked, the task is mine, and the next n offers the same folder first", async () => {
    await withEngineering()
    await app.press("t", "2")
    await app.see("2 My to-do")
    await app.press("n")
    const picker = await app.see("─ New task in ─", /Platform\s+Engineering/)
    expect(picker).toMatch(/Q4 Launch\s+Engineering project/)
    await app.type("laun")
    await app.see("Filter: laun")
    await app.press("enter")
    await app.see("A new task in Q4 Launch, assigned to you")
    await app.type("Book the launch venue")
    await app.press("enter")
    const frame = await app.see('Created the task "Book the launch venue"', /Folders\s+Q4 Launch/, /Assignees\s+Sam Sample/)
    expect(app.fake.writes).toEqual([{ method: "POST", path: `/folders/${FOLDER.launch}/tasks`, params: { title: "Book the launch venue", responsibles: `["${ME}"]` } }])
    expect(list(frame).some((line) => line.includes("Book the launch venue"))).toBe(true)
    expect(frame).toMatch(/│ {3}My to-do\s+7 │/)
    expect(await selectedUrl()).toBe(created().permalink)

    await app.press("n")
    const again = await app.see("─ New task in ─")
    expect(again).toMatch(/▸ Q4 Launch\s+last used/)
  })

  test("from the Inbox the picked folder gets the task, and it opens in the details pane", async () => {
    await withEngineering()
    await app.press("2", "n")
    await app.see("─ New task in ─")
    await app.type("parking")
    await app.press("enter")
    await app.see("A new task in Parking lot")
    await app.type("Sort the parked ideas")
    await app.press("enter")
    await app.see('Created the task "Sort the parked ideas"', /Folders\s+Parking lot/, /Assignees\s+nobody/)
    expect(app.fake.writes.map((write) => write.path)).toEqual([`/folders/${FOLDER.empty}/tasks`])
  })

  test("with no space opened the picker says how to load folders", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t", "n")
    await app.see("│ Open a space in the navigation pane first.")
  })

  test("read-only mode refuses before a title is typed", async () => {
    await inPlatform({ readOnly: true })
    await app.press("n")
    await app.see("read-only mode: not saved")
    expect(await app.frame()).not.toContain("title of the new task")
  })

  test("a failed create says why and leaves the list as it was", async () => {
    await inPlatform()
    app.fake.fail({ method: "POST", path: `/api/v4/folders/${FOLDER.platform}/tasks`, status: 500 })
    await app.press("n")
    await app.type("Doomed")
    await app.press("enter")
    await app.see("Wrike failed with 500: Injected failure", "2 Platform  8 · status")
  })
})

describe("N creates a subtask", () => {
  test("in the parent's first folder, nested under the parent, which counts it", async () => {
    await inPlatform()
    await app.press("G", "N")
    await app.see('A subtask of "Fix login redirect loop" in Platform')
    await app.type("Add a regression test")
    await app.press("enter")
    const frame = await app.see('Created the subtask "Add a regression test"', /Folders\s+Platform/)
    expect(app.fake.writes).toEqual([
      { method: "POST", path: `/folders/${FOLDER.platform}/tasks`, params: { title: "Add a regression test", superTasks: `["${TASK.login}"]` } },
    ])
    const rows = list(frame)
    const parent = rows.findIndex((line) => line.includes("▾ Fix login redirect loop"))
    expect(rows.slice(parent + 1, parent + 4)).toEqual([
      expect.stringContaining("Reproduce the redirect loop on s"),
      expect.stringContaining("Add a regression test"),
      expect.stringContaining("Patch the callback handler"),
    ])
    expect(app.fake.data.tasks.find((task) => task.id === TASK.login)!.subTaskIds).toHaveLength(3)
    expect(await selectedUrl()).toBe(created().permalink)
  })

  test("a parent filed in no folder of its own gives the scoped folder, and elsewhere the folder is picked", async () => {
    await inPlatform()
    await app.press("G", "space", "j", "N")
    await app.see('A subtask of "Reproduce the redirect loop on staging" in Platform')
    await app.press("esc", "/")
    await app.type("4598459110")
    await app.press("enter")
    await app.see("2 Search: 4598459110  1", /Folders\s+none/)
    await app.press("N")
    await app.see("─ New subtask in ─")
    await app.type("incid")
    await app.press("enter")
    await app.see('A subtask of "Reproduce the redirect loop on staging" in Incidents')
    await app.type("Capture the HAR")
    await app.press("enter")
    await app.see('Created the subtask "Capture the HAR"', /Folders\s+Incidents/)
    expect(app.fake.writes).toEqual([
      { method: "POST", path: `/folders/${FOLDER.incidents}/tasks`, params: { title: "Capture the HAR", superTasks: `["${TASK.reproduce}"]` } },
    ])
  })
})

describe("Cancel the task", () => {
  test("moves the task to its workflow's Cancelled status, and it leaves My to-do like any closed task", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t", "2", "G")
    await app.see("2 My to-do  6")
    await palette("cancel the task")
    const frame = await app.see("Cancelled: status set to Cancelled", "2 My to-do  5")
    expect(app.fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.flags}`, params: { customStatus: STATUS.cancelled } }])
    expect(list(frame).some((line) => line.includes("Clean up stale feature flags"))).toBe(false)
  })

  test("a workflow with several Cancelled statuses asks which", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t", "2")
    await app.see("2 My to-do  6")
    await app.press("G", "k", "k", "k", "enter")
    await app.see(/Status\s+● Triage/)
    await palette("cancel the task")
    const picker = await app.see("─ Cancel the task ─", "Won't fix")
    expect(picker).toMatch(/▸ ● Duplicate\s+Cancelled/)
    expect(picker).not.toContain("Resolved")
    await app.press("down", "enter")
    await app.see("Cancelled: status set to Won't fix", /Status\s+● Won't fix/)
    expect(app.fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.onboarding}`, params: { customStatus: STATUS.wontFix } }])
  })

  test("read-only mode refuses", async () => {
    app = await openApp(WIDE, { readOnly: true })
    await app.see("Enable SSO on sandbox")
    await app.press("t", "2", "G")
    await palette("cancel the task")
    await app.see("read-only mode: not saved")
    expect(app.fake.writes).toEqual([])
  })
})

describe("D deletes a task", () => {
  test("asks in the status bar, says what happens to the subtasks, and only y deletes", async () => {
    await inPlatform()
    await app.press("G", "F", "D")
    await app.see('Delete "Fix login redirect loop"? It goes to the Recycle Bin. Its 2 subtasks stay as top-level tasks. y deletes, any other key keeps it')
    await app.press("n")
    await app.see("Kept the task")
    expect(app.fake.writes).toEqual([])

    await app.press("enter")
    await app.see("The session cookie is dropped")
    await app.press("D", "y")
    const frame = await app.see('Deleted "Fix login redirect loop". It is in the Recycle Bin', "Select a task and press Enter to open it here.", "2 Platform  7 · status")
    expect(app.fake.writes).toEqual([{ method: "DELETE", path: `/tasks/${TASK.login}`, params: {} }])
    const rows = list(frame)
    expect(rows.some((line) => line.includes("Fix login redirect loop"))).toBe(false)
    expect(rows).toContainEqual(expect.stringMatching(/^ {2}Reproduce the redirect loop on s/))
    expect(rows).toContainEqual(expect.stringMatching(/^ {2}Patch the callback handler/))
    expect(frame).toContain("★ Fix login re… (not found)")
  })

  test("a question longer than the status bar's room is cut short of the keys", async () => {
    app = await openApp({ width: 100, height: 26 })
    await app.see("Engineering")
    await app.press("1", "j", "j", "j", "j", "space")
    await app.see("▸ Platform")
    await app.press("j", "enter", "l", "G", "D")
    const bar = (await app.see("y delete  n keep")).split("\n").at(-2)!
    expect(bar).toMatch(/^ Delete "Fix login redirect loop"\? It goes to the Recycle Bin\. .*…  y delete  n keep\s*$/)
  })

  test("a task without subtasks says nothing of them, and Esc keeps it", async () => {
    await inPlatform()
    await app.press("j", "D")
    await app.see('Delete "Clean up stale feature flags"? It goes to the Recycle Bin. y deletes')
    await app.press("esc")
    await app.see("Kept the task")
  })

  test("read-only mode refuses before asking", async () => {
    await inPlatform({ readOnly: true })
    await app.press("G", "D")
    const frame = await app.see("read-only mode: not saved")
    expect(frame).not.toContain("Recycle Bin")
    expect(app.fake.writes).toEqual([])
  })
})

describe("Folders", () => {
  test("L files the task in another folder, and Take out of a folder removes one but never the last", async () => {
    await inPlatform()
    await app.press("enter")
    await app.see(/Folders\s+Platform\s/, "Rotate before the audit")
    await app.press("L")
    const picker = await app.see("─ File in another folder ─", "Q4 Launch")
    expect(picker).not.toMatch(/│ {3}Platform\s+Engineering\s*│/)
    expect(picker).not.toMatch(/Engineering\s+space\s*│/)
    await app.type("launch")
    await app.press("enter")
    await app.see("Filed in Q4 Launch", /Folders\s+Platform, Q4 Launch/)
    expect(app.fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.keys}`, params: { addParents: `["${FOLDER.launch}"]` } }])

    await palette("take out of a folder")
    const out = await app.see("─ Take out of a folder ─")
    expect(out).toMatch(/▸ Platform/)
    expect(out).toContain("Q4 Launch")
    await app.press("enter")
    await app.see("Taken out of Platform", /Folders\s+Q4 Launch/)
    expect(app.fake.writes.at(-1)).toEqual({ method: "PUT", path: `/tasks/${TASK.keys}`, params: { removeParents: `["${FOLDER.platform}"]` } })

    await palette("take out of a folder")
    await app.see("A task stays in at least one folder")
    expect(app.fake.writes).toHaveLength(2)
  })

  test("read-only mode refuses filing before the picker opens", async () => {
    await inPlatform({ readOnly: true })
    await app.press("j", "L")
    const frame = await app.see("read-only mode: not saved")
    expect(frame).not.toContain("File in another folder")
  })
})
