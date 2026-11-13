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

describe("editing my comment", () => {
  const stale = comment("C4", ME, "Yesterday's note", "2026-11-11T10:00:00Z")
  const linked = comment("C5", ME, 'See <a href="https://example.test/pull/7">PR 7</a>', "2026-11-12T15:59:30Z")
  const moved = (now: string) => ({ type: "clock", clock: { now, today: "2026-11-12" } }) as const
  /** The thread with `mine` selected: posted at 15:58, with the clock at 16:00. */
  const onMine = () => play(openWith([older, mine, newest, stale]), "]", "]").state

  test("Enter opens the comment box on it, prefilled", () => {
    const { state } = play(onMine(), "enter")
    expect(state.mode).toEqual({ kind: "compose", draft: "On it.", editing: mine.id, mentions: [] })
  })

  test("Enter on someone else's comment says it is not mine", () => {
    const { state } = play(openWith([older, mine]), "]", "enter")
    expect(state.mode).toEqual({ kind: "browse" })
    expect(state.flash).toEqual({ tone: "info", text: "This is Pat Example's comment, not yours" })
  })

  test("Enter after the five minutes says why it cannot edit", () => {
    expect(play(openWith([stale]), "]", "enter").state.flash?.text).toBe("Comments can only be edited in the 5 minutes after posting")
    expect(play(onMine(), moved("2026-11-12T16:03:00Z"), "enter").state.flash?.text).toBe("Comments can only be edited in the 5 minutes after posting")
  })

  test("a comment with formatting is not opened as text", () => {
    const { state } = play(openWith([linked]), "]", "enter")
    expect(state.mode).toEqual({ kind: "browse" })
    expect(state.flash?.text).toBe("This comment has formatting the client cannot edit. Press o to edit it in Wrike")
  })

  test("Enter saves the edit through the comment, and an unchanged one sends nothing", () => {
    const editing = play(onMine(), "enter").state
    const saved = play(editing, { type: "draft", text: "On it, done by Friday." }, "enter")
    expect(saved.effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: mine.id, body: { text: "On it, done by Friday.", plainText: true } }])
    expect(saved.state.flash?.text).toBe("Saving the comment...")
    const unchanged = play(editing, "enter")
    expect(unchanged.effects).toEqual([])
    expect(unchanged.state.flash?.text).toBe("Comment unchanged")
  })

  test("a window that closes while typing keeps the draft and says so", () => {
    const { state, effects } = play(onMine(), "enter", { type: "draft", text: "Too late" }, moved("2026-11-12T16:03:01Z"), "enter")
    expect(effects).toEqual([])
    expect(state.mode).toMatchObject({ kind: "compose", draft: "Too late" })
    expect(state.flash).toEqual({ tone: "error", text: "The 5-minute edit window has closed. Esc discards the edit" })
  })

  test("the saved comment replaces the old one in place", () => {
    const edited = { ...mine, text: "On it, done by Friday." }
    const { state } = play(onMine(), { type: "comment-saved", taskId: overdue.id, editing: mine.id, result: { ok: true, value: edited } })
    expect(state.details).toMatchObject({ value: { comments: [older, edited, newest, stale] } })
    expect(state.flash?.text).toBe("Comment saved")
    expect(state.selected).toEqual({ kind: "comment", id: mine.id })
  })

  test("an edit of a comment deleted in Wrike drops it here", () => {
    const { state } = play(onMine(), { type: "comment-saved", taskId: overdue.id, editing: mine.id, result: { ok: false, error: { kind: "not_found" } } })
    expect(state.details).toMatchObject({ value: { comments: [older, newest, stale] } })
    expect(state.selected).toBeNull()
    expect(state.flash).toEqual({ tone: "info", text: "That comment was deleted in Wrike" })
  })

  test("Ctrl+E edits in the editor and saves what comes back", () => {
    const handed = play(onMine(), "enter", "ctrl+e")
    expect(handed.effects).toEqual([{ kind: "compose-in-editor", draft: "On it." }])
    const back = play(handed.state, { type: "composed", text: "On it.\nShipped." })
    expect(back.effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: mine.id, body: { text: "On it.\nShipped.", plainText: true } }])
    expect(play(handed.state, { type: "composed", text: null }).state.flash?.text).toBe("Comment unchanged")
  })
})
