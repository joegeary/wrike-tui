import { describe, expect, test } from "bun:test"
import { commentStream, listCursor, listRows, openHistory } from "../../src/app/selectors"
import type { Action, Effect, Result, State } from "../../src/app/state"
import type { HistoryEntry, HistoryPage } from "../../src/domain/history"
import { commentId, userId } from "../../src/domain/ids"
import type { Comment, Task } from "../../src/domain/model"
import { detailsOf, inTodo, later, overdue, play, requestOf, undated } from "../support/app"

type Load = Effect & { kind: "load-history" }

const change = (at: string, to: string): HistoryEntry => ({ at, author: "Pat Example", change: { kind: "title", from: null, to } })
const loads = (effects: Effect[]) => effects.filter((effect): effect is Load => effect.kind === "load-history")
const answer = (load: Load, result: Result<HistoryPage>): Action & { type: "history-loaded" } => ({ type: "history-loaded", taskId: load.taskId, request: load.request, more: load.pageToken !== null, result })
const page = (entries: HistoryEntry[], next: string | null = null): Result<HistoryPage> => ({ ok: true, value: { entries, next } })
const titles = (state: State) => openHistory(state)?.items.map((entry) => (entry.change.kind === "title" ? entry.change.to : "?"))

/** Moves the to-do cursor to `task`, presses Enter and answers the details. The effects are every one the open caused. */
function open(state: State, task: Task): { state: State; effects: Effect[] } {
  const index = listRows(state).findIndex((row) => row.kind === "task" && row.task.id === task.id)
  const keys = Array.from({ length: Math.abs(index - listCursor(state)) }, () => (index > listCursor(state) ? "j" : "k"))
  const pressed = play({ ...state, focus: "list" }, ...keys, "enter")
  const loaded = play(pressed.state, { type: "details-loaded", request: requestOf(pressed.effects, "load-details"), result: { ok: true, value: detailsOf(task) } })
  return { state: loaded.state, effects: [...pressed.effects, ...loaded.effects] }
}

describe("field history", () => {
  test("an open asks once, and opening the task again draws what is held without asking", () => {
    const first = open(inTodo(), overdue)
    const [load] = loads(first.effects)
    expect(load).toMatchObject({ taskId: overdue.id, pageToken: null })
    const shown = play(first.state, answer(load!, page([change("2026-11-12T10:00:00Z", "B"), change("2026-11-11T10:00:00Z", "A")]))).state
    expect(titles(shown)).toEqual(["B", "A"])
    const again = open(open(shown, later).state, overdue)
    expect(loads(again.effects)).toEqual([])
    expect(titles(again.state)).toEqual(["B", "A"])
  })

  test("a failed load is not asked again by an open or by H, only by r", () => {
    const first = open(inTodo(), overdue)
    const failed = play(first.state, answer(loads(first.effects)[0]!, { ok: false, error: { kind: "rate_limited" } })).state
    expect(openHistory(failed)).toMatchObject({ items: [], error: { kind: "rate_limited" } })
    expect(loads(open(open(failed, later).state, overdue).effects)).toEqual([])
    expect(loads(play(failed, "H", "H").effects)).toEqual([])
    const retried = play(failed, "r")
    expect(loads(retried.effects)).toMatchObject([{ taskId: overdue.id, pageToken: null }])
    expect(retried.state.histories.get(overdue.id)).toMatchObject({ loading: "first", error: null })
  })

  test("an answer to an older request is dropped, and one for another task never reaches the open task's stream", () => {
    const first = open(inTodo(), overdue)
    const stale = loads(first.effects)[0]!
    const refreshed = play(first.state, "r")
    const current = loads(refreshed.effects)[0]!
    const dropped = play(refreshed.state, answer(stale, page([change("2026-11-10T10:00:00Z", "stale")]))).state
    expect(dropped.histories.get(overdue.id)).toMatchObject({ items: [], loading: "first" })
    const settled = play(dropped, answer(current, page([change("2026-11-12T10:00:00Z", "fresh")]))).state
    expect(settled.histories.get(overdue.id)?.items).toEqual([change("2026-11-12T10:00:00Z", "fresh")])

    const other = open(settled, later)
    const otherLoad = loads(other.effects)[0]!
    const unasked = play(other.state, { ...answer(otherLoad, page([change("2026-11-12T11:00:00Z", "never asked")])), taskId: undated.id }).state
    expect(unasked.histories.has(undated.id)).toBe(false)
    expect(openHistory(unasked)).toMatchObject({ items: [], loading: "first" })
    expect(titles(play(unasked, answer(otherLoad, page([change("2026-11-12T11:00:00Z", "later's")]))).state)).toEqual(["later's"])
  })

  test("older changes load after the held page and join its end, and with none left it says so", () => {
    const first = open(inTodo(), overdue)
    const held = play(first.state, answer(loads(first.effects)[0]!, page([change("2026-11-12T10:00:00Z", "new")], "token-2"))).state
    const older = play(held, { type: "older-history" })
    const load = loads(older.effects)[0]!
    expect(load).toMatchObject({ taskId: overdue.id, pageToken: "token-2" })
    expect(openHistory(older.state)).toMatchObject({ loading: "more" })
    expect(loads(play(older.state, { type: "older-history" }).effects)).toEqual([])
    const all = play(older.state, answer(load, page([change("2026-11-01T10:00:00Z", "old")]))).state
    expect(titles(all)).toEqual(["new", "old"])
    expect(play(all, { type: "older-history" })).toMatchObject({ effects: [], state: { flash: { text: "All of the history is shown" } } })
  })

  test("H hides the history without a call, and turning it on asks only for a task never fetched", () => {
    const hidden = play(inTodo(), "H").state
    const opened = open(hidden, overdue)
    expect(loads(opened.effects)).toEqual([])
    expect(openHistory(opened.state)).toBeNull()
    const shown = play(opened.state, "H")
    expect(shown.state.flash?.text).toBe("Field history shown among the comments")
    const load = loads(shown.effects)[0]!
    expect(load).toMatchObject({ taskId: overdue.id })
    const answered = play(shown.state, answer(load, page([change("2026-11-12T10:00:00Z", "B")]))).state
    expect(play(answered, "H", "H").effects).toEqual([])
    expect(titles(play(answered, "H", "H").state)).toEqual(["B"])
  })
})

describe("the comment stream", () => {
  const comment = (id: string, createdDate: string): Comment => ({ id: commentId(id), authorId: userId("PAT"), text: id, createdDate })
  const order = (comments: Comment[], newestFirst: HistoryEntry[]) =>
    commentStream(comments, newestFirst).map((item) => (item.kind === "comment" ? item.comment.id : item.entry.change.kind === "title" ? item.entry.change.to : "?"))

  test("changes and comments go by time, and a change from a comment's second comes after it", () => {
    const comments = [comment("c1", "2026-11-12T10:00:00Z"), comment("c2", "2026-11-12T12:00:00Z")]
    expect(order(comments, [change("2026-11-12T12:00:00Z", "same second"), change("2026-11-12T11:00:00Z", "between"), change("2026-11-12T09:00:00Z", "first")])).toEqual([
      "first",
      "c1",
      "between",
      "c2",
      "same second",
    ])
  })

  test("a change without a time stays next to its neighbours on the page, and the rest keep their order", () => {
    const comments = [comment("c1", "2026-11-12T10:00:00Z"), comment("c2", "2026-11-12T12:00:00Z")]
    const untimed: HistoryEntry = { ...change("", "untimed"), at: null }
    expect(order(comments, [change("2026-11-12T11:00:00Z", "late"), untimed, change("2026-11-12T09:00:00Z", "early")])).toEqual(["early", "untimed", "c1", "late", "c2"])
  })
})
