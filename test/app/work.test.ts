import { describe, expect, test } from "bun:test"
import { listCursor, listRows } from "../../src/app/selectors"
import type { State } from "../../src/app/state"
import { customStatusId, folderId, taskId } from "../../src/domain/ids"
import type { Task } from "../../src/domain/model"
import { detailsOf, inTodo, key, loaded, overdue, play, requestOf, showing, status, task, undated, workflows } from "../support/app"

/** My to-do with `opened` open in the details pane, the cursor on it, and `folders` named in the details. */
function withOpen(opened: Task, extra: Partial<State> = {}): State {
  const base = { ...inTodo(), ...extra }
  const index = listRows(base).findIndex((row) => row.kind === "task" && row.task.id === opened.id)
  const keys = Array.from({ length: index - listCursor(base) }, () => "j")
  const { state, effects } = play(base, ...keys, "enter")
  return play(state, { type: "details-loaded", request: requestOf(effects, "load-details"), result: { ok: true, value: detailsOf(opened) } }).state
}

const cancelled = status("GONE", "Cancelled", "Cancelled")

describe("cancel", () => {
  test("a workflow without a Cancelled status says so, and nothing is sent", () => {
    const { state, effects } = play(withOpen(overdue), { type: "task", command: "cancel" })
    expect(state.flash?.text).toBe("This task's workflow has no Cancelled status")
    expect(effects).toEqual([])
  })

  test("a task already in a Cancelled status is left alone", () => {
    const gone = { ...overdue, statusId: cancelled.id, statusGroup: "Cancelled" as const }
    const withCancelled = [{ ...workflows[0]!, statuses: [...workflows[0]!.statuses, cancelled] }]
    const { state, effects } = play({ ...withOpen(overdue), workflows: withCancelled, details: { state: "ready", value: detailsOf(gone) } }, { type: "task", command: "cancel" })
    expect(state.flash?.text).toBe("This task is already cancelled")
    expect(effects).toEqual([])
  })

  test("a hidden Cancelled status is not offered", () => {
    const withHidden = [{ ...workflows[0]!, statuses: [...workflows[0]!.statuses, { ...cancelled, hidden: true }] }]
    const { state } = play({ ...withOpen(overdue), workflows: withHidden }, { type: "task", command: "cancel" })
    expect(state.flash?.text).toBe("This task's workflow has no Cancelled status")
  })

  test("the one Cancelled status is set without asking", () => {
    const withCancelled = [{ ...workflows[0]!, statuses: [...workflows[0]!.statuses, cancelled] }]
    const { effects } = play({ ...withOpen(overdue), workflows: withCancelled }, { type: "task", command: "cancel" })
    expect(effects).toEqual([{ kind: "update-task", taskId: overdue.id, patch: { field: "status", statusId: customStatusId("GONE") }, done: "Cancelled: status set to Cancelled" }])
  })
})

describe("taking a task out of a folder", () => {
  test("the last folder stays, without asking Wrike", () => {
    const filed = { ...overdue, parentIds: ["A"] }
    const { state, effects } = play(withOpen(filed), { type: "task", command: "unfile" })
    expect(state.flash?.text).toBe("A task stays in at least one folder")
    expect(state.mode.kind).toBe("browse")
    expect(effects).toEqual([])
  })

  test("a task in two folders offers both, and the pick is removed", () => {
    const twice = { ...overdue, parentIds: ["A", "B"] }
    const opened = withOpen(twice)
    const named = { ...opened, details: { state: "ready" as const, value: { ...detailsOf(twice), folders: [{ id: folderId("A"), title: "Platform" }, { id: folderId("B"), title: "Launch" }] } } }
    const { state, effects } = play(named, { type: "task", command: "unfile" }, "down", "enter")
    expect(state.mode.kind).toBe("browse")
    expect(effects).toEqual([{ kind: "update-task", taskId: twice.id, patch: { field: "parents", add: [], remove: [folderId("B")] }, done: "Taken out of Launch" }])
  })
})

describe("a deleted task", () => {
  const parent = task("T7", "Parent task", { type: "Backlog" }, { subTaskIds: [taskId("T8")] })
  const child = task("T8", "Child task", { type: "Backlog" }, { superTaskIds: [taskId("T7")] })

  test("leaves every list, closes the details, and its subtasks become top-level", () => {
    const listed = showing(loaded(), ["t"], "todo", [parent, child, undated])
    const opened = play(listed, "enter")
    const shown = play(opened.state, { type: "details-loaded", request: requestOf(opened.effects, "load-details"), result: { ok: true, value: detailsOf(parent) } }).state
    const { state } = play(shown, { type: "task-deleted", id: parent.id, title: parent.title, result: { ok: true, value: "deleted" } })
    const todo = state.lists.get(key("todo"))!.items
    expect(todo.map((item) => item.id)).toEqual([child.id, undated.id])
    expect(todo[0]!.superTaskIds).toEqual([])
    expect(state.details).toEqual({ state: "idle" })
    expect(state.openTaskId).toBeNull()
    expect(state.flash?.text).toBe('Deleted "Parent task". It is in the Recycle Bin')
  })

  test("Wrike saying it was already deleted is not an error", () => {
    const { state } = play(withOpen(overdue), { type: "task-deleted", id: overdue.id, title: overdue.title, result: { ok: true, value: "already-deleted" } })
    expect(state.flash).toEqual({ tone: "info", text: '"Overdue task" was already deleted' })
    expect(state.lists.get(key("todo"))!.items.map((item) => item.id)).not.toContain(overdue.id)
  })
})
