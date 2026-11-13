import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { ME, STATUS } from "../test/fake/data"
import { FOLDER } from "../test/fake/workspace"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary through the Phase 4 flows that create and
 * reshape work, against the fake Wrike: a new task and a subtask, filing in
 * another folder and taking it out, cancelling, and deleting. The tests share
 * one session and run in order.
 */
setDefaultTimeout(60_000)

let e2e: E2e
let tmux: TmuxSession

beforeAll(async () => {
  e2e = await startE2e("phase-4-work", WIDE, { WRIKE_TOKEN: TOKEN })
  tmux = e2e.tmux
})
afterAll(() => e2e.stop())

const writes = () => e2e.fake.writes
const byTitle = (title: string) => e2e.fake.data.tasks.find((task) => task.title === title)!

describe("creating", () => {
  test("n in a folder asks for a title, refuses an empty one, and opens the new task", async () => {
    await tmux.run(BINARY)
    await tmux.see("inbox", "2 Inbox", "Engineering")
    await tmux.keys("1", "j", "j", "j", "j", "Space")
    await tmux.see("engineering-open", "▸ Platform")
    await tmux.keys("j", "Enter", "l")
    await tmux.see("platform", "2 Platform  8 · status")
    await tmux.keys("n")
    await tmux.see("title-prompt", "+ title of the new task", "A new task in Platform", "Enter create  Esc discard")
    await tmux.keys("Enter")
    await tmux.see("title-empty", "A title cannot be empty")
    await tmux.type("Plan the cutover")
    await tmux.keys("Enter")
    await tmux.see("task-created", 'Created the task "Plan the cutover". Press e to edit its fields', "2 Platform  9 · status", /Folders +Platform/, /Assignees +nobody/)
    expect(writes()).toEqual([{ method: "POST", path: `/folders/${FOLDER.platform}/tasks`, params: { title: "Plan the cutover" } }])
  })

  test("N makes a subtask of the open task in its folder, nested under it in the list", async () => {
    await tmux.keys("N")
    await tmux.see("subtask-prompt", 'A subtask of "Plan the cutover" in Platform')
    await tmux.type("Freeze the deploys")
    await tmux.keys("Enter")
    const frame = await tmux.see("subtask-created", 'Created the subtask "Freeze the deploys"', "2 Platform  10 · status", /▾ Plan the cutover/)
    const lines = frame.split("\n")
    const parent = lines.findIndex((line) => line.includes("▾ Plan the cutover"))
    expect(lines[parent + 1]).toMatch(/││ {6}Freeze the deploys/)
    expect(writes().at(-1)).toEqual({
      method: "POST",
      path: `/folders/${FOLDER.platform}/tasks`,
      params: { title: "Freeze the deploys", superTasks: `["${byTitle("Plan the cutover").id}"]` },
    })
  })

  test("in My to-do the folder is picked and the task is assigned to me", async () => {
    await tmux.keys("t", "2", "n")
    await tmux.see("folder-picker", "─ New task in ─", /Platform +last used/, /Q4 Launch +Engineering project/)
    await tmux.type("laun")
    await tmux.keys("Enter")
    await tmux.see("todo-prompt", "A new task in Q4 Launch, assigned to you")
    await tmux.type("Order the launch swag")
    await tmux.keys("Enter")
    await tmux.see("todo-created", 'Created the task "Order the launch swag"', "2 My to-do  7", /Assignees +Sam Sample/, /Folders +Q4 Launch/)
    expect(writes().at(-1)).toEqual({ method: "POST", path: `/folders/${FOLDER.launch}/tasks`, params: { title: "Order the launch swag", responsibles: `["${ME}"]` } })
  })
})

describe("reshaping", () => {
  test("L files the open task in another folder, and Take out of a folder removes one, but never the last", async () => {
    await tmux.keys("L")
    await tmux.see("file-picker", "─ File in another folder ─")
    await tmux.type("parking")
    await tmux.keys("Enter")
    await tmux.see("filed", "Filed in Parking lot", /Folders +Q4 Launch, Parking lot/)
    await tmux.keys(":")
    await tmux.type("take out of a folder")
    await tmux.keys("Enter")
    await tmux.see("unfile-picker", "─ Take out of a folder ─", /▸ Q4 Launch/)
    await tmux.keys("Enter")
    await tmux.see("unfiled", "Taken out of Q4 Launch", /Folders +Parking lot/)
    await tmux.keys(":")
    await tmux.type("take out of a folder")
    await tmux.keys("Enter")
    await tmux.see("last-folder", "A task stays in at least one folder")
    const id = byTitle("Order the launch swag").id
    expect(writes().slice(-2)).toEqual([
      { method: "PUT", path: `/tasks/${id}`, params: { addParents: `["${FOLDER.empty}"]` } },
      { method: "PUT", path: `/tasks/${id}`, params: { removeParents: `["${FOLDER.launch}"]` } },
    ])
  })

  test("Cancel the task sets its workflow's Cancelled status, and it leaves My to-do", async () => {
    await tmux.keys(":")
    await tmux.type("cancel the task")
    await tmux.keys("Enter")
    await tmux.see("cancelled", "Cancelled: status set to Cancelled", "2 My to-do  6", /Status +● Cancelled/)
    expect(writes().at(-1)).toEqual({ method: "PUT", path: `/tasks/${byTitle("Order the launch swag").id}`, params: { customStatus: STATUS.cancelled } })
  })
})

describe("deleting", () => {
  test("D asks in the status bar, n keeps the task, and y sends it to the Recycle Bin", async () => {
    await tmux.keys("/")
    await tmux.type("Plan the cutover")
    await tmux.keys("Enter")
    await tmux.see("search", "2 Search: Plan the cutover  1")
    await tmux.keys("Enter")
    await tmux.see("parent-open", /Folders +Platform/)
    await tmux.keys("D")
    await tmux.see("delete-asked", 'Delete "Plan the cutover"? It goes to the Recycle Bin. Its subtask stays as a top-level task.', "y delete  n keep")
    await tmux.keys("n")
    await tmux.see("delete-kept", "Kept the task")
    const before = writes().length
    expect(before).toBe(6)
    await tmux.keys("D", "y")
    await tmux.see("deleted", 'Deleted "Plan the cutover". It is in the Recycle Bin', "Select a task and press Enter to open it here.", 'No task matches "Plan the cutover".')
    expect(writes().slice(before)).toEqual([{ method: "DELETE", path: `/tasks/${byTitle("Plan the cutover").id}`, params: {} }])
    expect(byTitle("Freeze the deploys").superTaskIds).toEqual([])
  })

  test("the freed subtask is a top-level task in the folder, and q quits", async () => {
    await tmux.keys("1")
    await tmux.see("nav", "▾ Platform")
    await tmux.keys("Enter", "l")
    await tmux.see("platform-after", "2 Platform  9 · status", /││ +Freeze the deploys/)
    await tmux.keys("q")
    await tmux.see("quit", "$ ")
  })
})
