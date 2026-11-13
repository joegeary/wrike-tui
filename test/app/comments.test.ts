import { describe, expect, test } from "bun:test"
import { resolveKey } from "../../src/app/keymap"
import { listCursor, listRows, mentionSuggestions } from "../../src/app/selectors"
import type { State } from "../../src/app/state"
import { commentId, userId } from "../../src/domain/ids"
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
    expect(state.mode).toEqual({ kind: "compose", draft: "On it.", editing: mine.id, mentions: [], pick: 0, dismissed: null })
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

describe("deleting my comment", () => {
  const stale = comment("C4", ME, "Yesterday's note", "2026-11-11T10:00:00Z")
  /** The thread with my day-old comment selected: deleting has no time limit. */
  const onStale = () => play(openWith([older, stale, newest]), "]", "]").state

  test("d asks first, and y deletes", () => {
    const asked = play(onStale(), "d")
    expect(asked.state.mode).toEqual({ kind: "confirm-delete", id: stale.id })
    expect(asked.effects).toEqual([])
    const { state, effects } = play(asked.state, "y")
    expect(effects).toEqual([{ kind: "delete-comment", taskId: overdue.id, id: stale.id }])
    expect(state.mode).toEqual({ kind: "browse" })
  })

  test("any other key keeps the comment", () => {
    for (const key of ["n", "esc", "j", "Y", "enter"]) {
      const { state, effects } = play(onStale(), "d", key)
      expect(effects, key).toEqual([])
      expect(state.mode, key).toEqual({ kind: "browse" })
      expect(state.flash?.text, key).toBe("Kept the comment")
    }
  })

  test("d on someone else's comment says it is not mine", () => {
    const { state } = play(onStale(), "[", "d")
    expect(state.mode).toEqual({ kind: "browse" })
    expect(state.flash?.text).toBe("This is Pat Example's comment, not yours")
  })

  test("a deleted comment leaves the thread and the selection", () => {
    const { state } = play(onStale(), { type: "comment-deleted", taskId: overdue.id, id: stale.id, result: { ok: true, value: null } })
    expect(state.details).toMatchObject({ value: { comments: [older, newest] } })
    expect(state.selected).toBeNull()
    expect(state.flash).toEqual({ tone: "info", text: "Comment deleted" })
  })

  test("a comment that was already gone is removed too, with a neutral message", () => {
    const { state } = play(onStale(), { type: "comment-deleted", taskId: overdue.id, id: stale.id, result: { ok: false, error: { kind: "not_found" } } })
    expect(state.details).toMatchObject({ value: { comments: [older, newest] } })
    expect(state.flash).toEqual({ tone: "info", text: "The comment was already deleted" })
  })

  test("read-only mode keeps the comment and says nothing was saved", () => {
    const { state } = play(onStale(), { type: "comment-deleted", taskId: overdue.id, id: stale.id, result: { ok: false, error: { kind: "read_only" } } })
    expect(state.details).toMatchObject({ value: { comments: [older, stale, newest] } })
    expect(state.flash).toEqual({ tone: "error", text: "read-only mode: not saved" })
  })
})

describe("mentions in the comment box", () => {
  const SASHA = userId("SASHA")
  /** The comment box with `draft` typed, and one more Example among the contacts. */
  function typing(draft: string): State {
    const opened = openWith([older])
    const contacts = new Map(opened.contacts).set(SASHA, { id: SASHA, name: "Sasha Example", email: null, active: true })
    return play({ ...opened, contacts }, "c", { type: "draft", text: draft }).state
  }

  test("@ and letters offer the active people with a word of their name starting so", () => {
    expect(mentionSuggestions(typing("Thanks @"))).toBeNull()
    expect(mentionSuggestions(typing("Thanks @s"))?.contacts.map((contact) => contact.name)).toEqual(["Sam Sample", "Sasha Example"])
    expect(mentionSuggestions(typing("Thanks @EX"))?.contacts.map((contact) => contact.name)).toEqual(["Pat Example", "Sasha Example"])
    expect(mentionSuggestions(typing("Thanks @de"))?.contacts.map((contact) => contact.name)).toEqual(["Riley Demo"])
    expect(mentionSuggestions(typing("mail sam@ex"))).toBeNull()
    expect(mentionSuggestions(typing("Thanks @zz"))).toBeNull()
  })

  test("Tab or Enter picks the highlighted person as @Full Name, and Up and Down move", () => {
    const tabbed = play(typing("Thanks @ex"), "tab").state
    expect(tabbed.mode).toMatchObject({ draft: "Thanks @Pat Example ", mentions: [{ at: 7, id: PAT, name: "Pat Example" }] })
    const moved = play(typing("Thanks @ex"), "down", "enter").state
    expect(moved.mode).toMatchObject({ draft: "Thanks @Sasha Example ", mentions: [{ at: 7, id: SASHA, name: "Sasha Example" }] })
    expect(play(typing("Thanks @ex"), "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+p", "tab").state.mode).toMatchObject({ draft: "Thanks @Pat Example " })
  })

  test("Esc closes the list and keeps the comment box, and Enter then posts the text as typed", () => {
    const closed = play(typing("ping @pa"), "esc")
    expect(closed.state.mode).toMatchObject({ kind: "compose", draft: "ping @pa" })
    expect(mentionSuggestions(closed.state)).toBeNull()
    expect(play(closed.state, { type: "draft", text: "ping @pat" }).state.mode).toMatchObject({ dismissed: 5 })
    const { effects } = play(closed.state, "enter")
    expect(effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: null, body: { text: "ping @pa", plainText: true } }])
  })

  test("a picked mention posts as HTML with Wrike's anchor", () => {
    const picked = play(typing("@pa"), "tab", { type: "draft", text: "@Pat Example can you <check> this?" }, "enter")
    expect(picked.effects).toEqual([
      {
        kind: "save-comment",
        taskId: overdue.id,
        editing: null,
        body: { text: `<a class="stream-user-id avatar" rel="${PAT}">&#64;Pat Example</a> can you &lt;check&gt; this?`, plainText: false },
      },
    ])
  })

  test("typing over a picked mention makes it plain text again", () => {
    const { effects } = play(typing("@pa"), "tab", { type: "draft", text: "@Pat Exampl " }, "enter")
    expect(effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: null, body: { text: "@Pat Exampl", plainText: true } }])
  })
})
