import { describe, expect, test } from "bun:test"
import { resolveKey } from "../../src/app/keymap"
import { listCursor, listRows } from "../../src/app/selectors"
import type { State } from "../../src/app/state"
import { commentId } from "../../src/domain/ids"
import type { Comment, Task } from "../../src/domain/model"
import { inTodo, later, ME, overdue, PAT, play, requestOf } from "../support/app"

const comment = (id: string, authorId: Comment["authorId"], text: string, createdDate: string): Comment => ({ id: commentId(id), authorId, text, createdDate })

const older = comment("C1", PAT, "Can you look at this?", "2026-11-10T09:00:00Z")
const mine = comment("C2", ME, "On it.", "2026-11-12T15:58:00Z")
const newest = comment("C3", PAT, "Thanks!", "2026-11-12T15:59:00Z")

/** My to-do with `opened` open in the details pane and the focus there. */
function openWith(comments: Comment[], opened: Task = overdue): State {
  const base = inTodo()
  const index = listRows(base).findIndex((row) => row.kind === "task" && row.task.id === opened.id)
  const keys = Array.from({ length: index - listCursor(base) }, () => (index > listCursor(base) ? "j" : "k"))
  const { state, effects } = play(base, ...keys, "enter")
  return play(state, { type: "details-loaded", request: requestOf(effects, "load-details"), result: { ok: true, value: { task: opened, comments, folders: [] } } }).state
}

describe("selecting comments", () => {
  test("] starts at the oldest comment and walks forward, stopping at the newest", () => {
    const state = openWith([older, mine, newest])
    expect(state.focus).toBe("details")
    expect(play(state, "]").state.selected).toEqual({ kind: "comment", id: older.id })
    expect(play(state, "]", "]").state.selected).toEqual({ kind: "comment", id: mine.id })
    expect(play(state, "]", "]", "]", "]").state.selected).toEqual({ kind: "comment", id: newest.id })
  })

  test("[ starts at the newest comment and walks back", () => {
    const state = openWith([older, mine, newest])
    expect(play(state, "[").state.selected).toEqual({ kind: "comment", id: newest.id })
    expect(play(state, "[", "[", "[", "[").state.selected).toEqual({ kind: "comment", id: older.id })
  })

  test("Esc clears the selection, and does nothing when nothing is selected", () => {
    const state = openWith([older, mine])
    expect(resolveKey(state, "esc")).toBeNull()
    expect(play(state, "]", "esc").state.selected).toBeNull()
  })

  test("j and k still scroll while a comment is selected", () => {
    const { effects } = play(openWith([older]), "]", "j")
    expect(effects).toEqual([{ kind: "scroll", pane: "details", to: "down" }])
  })

  test("a task without comments says so", () => {
    const { state } = play(openWith([]), "]")
    expect(state.selected).toBeNull()
    expect(state.flash?.text).toBe("This task has no comments yet")
  })

  test("opening another task clears the selection, and reloading the same one keeps it", () => {
    const selected = play(openWith([older, mine]), "]").state
    const reloaded = play(selected, "r")
    expect(reloaded.state.selected).toEqual({ kind: "comment", id: older.id })
    const other = play(selected, "h", "j", "j", "enter").state
    expect(other.openTaskId).toBe(later.id)
    expect(other.selected).toBeNull()
  })
})
