import { describe, expect, test } from "bun:test"
import { reduce, start } from "../../src/app/reducer"
import { listRows, pickerOptions, selectedTask } from "../../src/app/selectors"
import { initialState, type Action, type Details, type Effect, type State } from "../../src/app/state"
import { customStatusId, legacyItemId, taskId, userId } from "../../src/domain/ids"
import type { Contact, InboxEntry, Task, TaskDates, Workflow } from "../../src/domain/model"

const ME = userId("ME")
const PAT = userId("PAT")
const clock = { now: "2026-11-12T16:00:00Z", today: "2026-11-12" }
const profile = { host: "www.wrike.com", accountId: "ACC", userId: ME, name: "Sam Sample" }

const status = (id: string, name: string, group: Workflow["statuses"][number]["group"] = "Active") => ({
  id: customStatusId(id),
  name,
  group,
  color: "Blue",
  hidden: false,
})
const workflows: Workflow[] = [{ id: "W1", name: "Default", statuses: [status("NEW", "New"), status("WIP", "In Progress"), status("DONE", "Completed", "Completed")] }]
const contacts: Contact[] = [
  { id: ME, name: "Sam Sample", email: "sam@example.test" },
  { id: PAT, name: "Pat Example", email: "pat@example.test" },
  { id: userId("RILEY"), name: "Riley Demo", email: null },
]

function task(id: string, title: string, dates: TaskDates, extra: Partial<Task> = {}): Task {
  return {
    id: taskId(id),
    title,
    statusId: customStatusId("NEW"),
    statusGroup: "Active",
    importance: "Normal",
    dates,
    assigneeIds: [ME],
    parentIds: [],
    permalink: `https://www.wrike.com/open.htm?id=${id.replace(/\D/g, "") || "1"}`,
    descriptionHtml: "",
    updatedDate: "2026-11-10T00:00:00Z",
    ...extra,
  }
}

const later = task("T3", "Later task", { type: "Milestone", due: "2026-12-01" })
const overdue = task("T1", "Overdue task", { type: "Milestone", due: "2026-11-10" })
const undated = task("T2", "Undated task", { type: "Backlog" })
const todo = [later, undated, overdue]

const mention: InboxEntry = {
  id: "n1",
  kind: "Mention",
  label: "Mention",
  unread: true,
  ts: "2026-11-12T15:00:00Z",
  item: { legacyId: legacyItemId("1")!, title: "Overdue task", baseType: "TASK", permalink: overdue.permalink },
  author: { name: "Pat Example" },
  commentText: "ping",
}
const projectNote: InboxEntry = { ...mention, id: "n2", item: { ...mention.item!, baseType: "PROJECT", permalink: "https://www.wrike.com/open.htm?id=77" } }
const report: InboxEntry = { ...mention, id: "n3", kind: "Other", label: "ReportReady", item: null }

/** Applies actions in order and collects every effect. */
function play(state: State, ...actions: (Action | string)[]): { state: State; effects: Effect[] } {
  const effects: Effect[] = []
  for (const action of actions) {
    const [next, more] = reduce(state, typeof action === "string" ? { type: "key", key: action } : action)
    state = next
    effects.push(...more)
  }
  return { state, effects }
}

function loaded(): State {
  const [started] = start(initialState(profile, clock))
  return play(
    started,
    { type: "reference-loaded", result: { ok: true, value: { contacts, workflows } } },
    { type: "inbox-loaded", request: 1, clock, result: { ok: true, value: [mention, projectNote, report] } },
    { type: "todo-loaded", request: 1, clock, result: { ok: true, value: todo } },
  ).state
}

const detailsOf = (opened: Task): Details => ({ task: opened, comments: [], folders: ["Platform"] })

/** My to-do with `opened` open in the details pane and the cursor on it. */
function withOpen(opened: Task): State {
  const base = play(loaded(), "t")
  const cursor = base.state.cursor.todo
  const index = listRows(base.state).flatMap((row) => (row.kind === "task" && row.task.id === opened.id ? [row.index] : []))[0] ?? cursor
  const keys = Array.from({ length: index }, () => "j")
  const { state, effects } = play(base.state, ...keys, "enter")
  const load = effects.find((effect) => effect.kind === "load-details")!
  return play(state, { type: "details-loaded", request: (load as { request: number }).request, result: { ok: true, value: detailsOf(opened) } }).state
}

describe("startup", () => {
  test("asks for reference data, the inbox and my tasks", () => {
    const [state, effects] = start(initialState(profile, clock))
    expect(effects).toEqual([
      { kind: "load-reference" },
      { kind: "load-inbox", request: 1, includeRead: false },
      { kind: "load-todo", request: 1, user: ME },
    ])
    expect(state.lists.inbox.state).toBe("loading")
  })

  test("a response to a superseded request is dropped", () => {
    const { state } = play(loaded(), "r", { type: "inbox-loaded", request: 1, clock, result: { ok: true, value: [] } })
    expect(state.lists.inbox).toMatchObject({ state: "loading", previous: [mention, projectNote, report] })
  })

  test("a failed reload keeps the last good list beside the error", () => {
    const { state } = play(loaded(), "r", { type: "inbox-loaded", request: 2, clock, result: { ok: false, error: { kind: "rate_limited" } } })
    expect(state.lists.inbox).toEqual({ state: "error", error: { kind: "rate_limited" }, previous: [mention, projectNote, report] })
  })
})

describe("lists", () => {
  test("My to-do rows are bucket headings and tasks, and the cursor walks tasks only", () => {
    const { state } = play(loaded(), "t")
    expect(listRows(state).map((row) => (row.kind === "heading" ? `# ${row.name} ${row.count}` : row.kind === "task" ? row.task.title : ""))).toEqual([
      "# Overdue 1",
      "Overdue task",
      "# Later 1",
      "Later task",
      "# No date 1",
      "Undated task",
    ])
    expect(selectedTask(state)?.title).toBe("Overdue task")
    expect(selectedTask(play(state, "j").state)?.title).toBe("Later task")
    expect(selectedTask(play(state, "G").state)?.title).toBe("Undated task")
    expect(selectedTask(play(state, "G", "j", "j").state)?.title).toBe("Undated task")
    expect(selectedTask(play(state, "G", "g", "k").state)?.title).toBe("Overdue task")
  })

  test("Enter on a task loads its details and focuses the details pane", () => {
    const { state, effects } = play(loaded(), "t", "enter")
    expect(effects).toEqual([{ kind: "load-details", request: 1, target: { kind: "task", id: overdue.id } }])
    expect(state).toMatchObject({ focus: "details", openTaskId: overdue.id, details: { state: "loading" } })
  })

  test("Enter on an inbox task resolves its legacy id", () => {
    const { effects } = play(loaded(), "enter")
    expect(effects).toEqual([{ kind: "load-details", request: 1, target: { kind: "legacy", id: mention.item!.legacyId } }])
  })

  test("Enter on a project notification opens the browser", () => {
    const { state, effects } = play(loaded(), "j", "enter")
    expect(effects).toEqual([{ kind: "open-url", url: "https://www.wrike.com/open.htm?id=77" }])
    expect(state.flash).toEqual({ tone: "info", text: "Opening the project in the browser" })
  })

  test("Enter on a notification without an item says so", () => {
    const { state, effects } = play(loaded(), "G", "enter")
    expect(effects).toEqual([])
    expect(state.flash?.text).toBe("This notification has nothing to open")
  })

  test("a toggles read notifications and reloads from the top", () => {
    const { state, effects } = play(loaded(), "G", "a")
    expect(effects).toEqual([{ kind: "load-inbox", request: 2, includeRead: true }])
    expect(state).toMatchObject({ includeRead: true, cursor: { inbox: 0 } })
  })

  test("a flash lasts until the next key", () => {
    const flashed = play(loaded(), "G", "enter").state
    expect(play(flashed, "k").state.flash).toBeNull()
  })
})

describe("search", () => {
  test("a title query searches and a late answer to an older query is dropped", () => {
    const typing = play(loaded(), "/", { type: "draft", text: " login " })
    expect(typing.state).toMatchObject({ view: "search", mode: { kind: "search-input", draft: " login " } })
    const { state, effects } = play(typing.state, "enter")
    expect(effects).toEqual([{ kind: "search", request: 1, query: { kind: "title", text: "login" } }])
    expect(state).toMatchObject({ searchQuery: "login", mode: { kind: "browse" }, lists: { search: { state: "loading" } } })
    const again = play(state, "/", { type: "draft", text: "sso" }, "enter", { type: "search-loaded", request: 1, jump: false, result: { ok: true, value: [later] } })
    expect(again.state.lists.search.state).toBe("loading")
  })

  test("a permalink query opens the task it finds", () => {
    const { state, effects } = play(
      loaded(),
      "/",
      { type: "draft", text: "https://www.wrike.com/open.htm?id=3" },
      "enter",
      { type: "search-loaded", request: 1, jump: true, result: { ok: true, value: [later] } },
    )
    expect(effects.map((effect) => effect.kind)).toEqual(["search", "load-details"])
    expect(effects[0]).toMatchObject({ query: { kind: "permalink" } })
    expect(state).toMatchObject({ openTaskId: later.id, focus: "details" })
  })

  test("an empty query changes nothing", () => {
    const { state, effects } = play(loaded(), "/", "enter")
    expect(effects).toEqual([])
    expect(state.mode).toEqual({ kind: "browse" })
  })
})

describe("task commands", () => {
  test("a command on a row that is not open waits for the details, then runs", () => {
    const pressed = play(loaded(), "t", "s")
    expect(pressed.effects).toEqual([{ kind: "load-details", request: 1, target: { kind: "task", id: overdue.id } }])
    expect(pressed.state).toMatchObject({ afterOpen: "status", focus: "list", mode: { kind: "browse" } })
    const wip = { ...overdue, statusId: customStatusId("WIP") }
    const { state } = play(pressed.state, { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(wip) } })
    expect(state).toMatchObject({ afterOpen: null, mode: { kind: "picker", field: "status", cursor: 1 } })
  })

  test("a failed open drops the waiting command and shows the error in the pane", () => {
    const { state } = play(loaded(), "t", "s", { type: "details-loaded", request: 1, result: { ok: false, error: { kind: "not_found" } } })
    expect(state).toMatchObject({ afterOpen: null, mode: { kind: "browse" }, details: { state: "error", error: { kind: "not_found" } } })
  })

  test("the status picker filters as you type and applies the highlighted status", () => {
    const opened = play(withOpen(overdue), "s")
    expect(pickerOptions(opened.state, opened.state.mode as never).map((option) => option.label)).toEqual(["New", "In Progress", "Completed"])
    const filtered = play(opened.state, "c", "o", "m")
    expect(pickerOptions(filtered.state, filtered.state.mode as never).map((option) => option.label)).toEqual(["Completed"])
    expect(play(filtered.state, "backspace", "backspace", "backspace").state.mode).toMatchObject({ query: "" })
    const { state, effects } = play(filtered.state, "enter")
    expect(effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "status", statusId: customStatusId("DONE") }, done: "Status set to Completed" },
    ])
    expect(state).toMatchObject({ mode: { kind: "browse" }, flash: { text: "Saving..." } })
  })

  test("picking the current status or pressing Esc saves nothing", () => {
    expect(play(withOpen(overdue), "s", "enter").effects).toEqual([])
    expect(play(withOpen(overdue), "s", "down", "esc")).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
  })

  test("the importance picker moves with the arrows and stays inside the list", () => {
    const { effects } = play(withOpen(overdue), "p", "up", "up", "up", "enter")
    expect(effects).toEqual([{ kind: "update-task", taskId: overdue.id, patch: { field: "importance", importance: "High" }, done: "Importance set to High" }])
  })

  test("the assignee picker toggles people and saves only the difference", () => {
    const opened = play(withOpen(overdue), "A")
    expect(opened.state.mode).toMatchObject({ field: "assignees", chosen: [ME] })
    expect(pickerOptions(opened.state, opened.state.mode as never).map((option) => option.label)).toEqual(["Pat Example", "Riley Demo", "Sam Sample"])
    const { effects } = play(opened.state, "space", "s", "a", "m", "space", "enter")
    expect(effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "assignees", add: [PAT], remove: [ME] }, done: "Assignees updated" },
    ])
    expect(play(opened.state, "enter").effects).toEqual([])
  })

  test("m assigns to me once", () => {
    expect(play(withOpen(overdue), "m")).toMatchObject({ effects: [], state: { flash: { text: "Already assigned to you" } } })
    const theirs = { ...overdue, assigneeIds: [PAT] }
    expect(play(withOpen(theirs), "m").effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "assignees", add: [ME], remove: [] }, done: "Assigned to you" },
    ])
  })

  test("E hands the description to the editor, o and y and Y use the permalink", () => {
    const { effects } = play(withOpen(overdue), "E", "o", "y", "Y")
    expect(effects).toEqual([
      { kind: "edit-description", task: overdue },
      { kind: "open-url", url: overdue.permalink },
      { kind: "copy", text: overdue.permalink },
      { kind: "copy", text: "1" },
    ])
  })

  test("o on an inbox row needs no open task", () => {
    expect(play(loaded(), "o").effects).toEqual([{ kind: "open-url", url: overdue.permalink }])
    expect(play(loaded(), "G", "o")).toMatchObject({ effects: [], state: { flash: { text: "Nothing is selected" } } })
  })

  test("a project notification cannot be edited", () => {
    expect(play(loaded(), "j", "e")).toMatchObject({ effects: [], state: { flash: { text: "Only tasks can be edited here" }, mode: { kind: "browse" } } })
  })
})

describe("edit mode", () => {
  test("j and k walk the fields and stop at the ends", () => {
    const state = play(withOpen(overdue), "e", "k").state
    expect(state.mode).toEqual({ kind: "edit", field: 0 })
    expect(play(state, "j", "j", "j", "j", "j", "j", "j", "j").state.mode).toEqual({ kind: "edit", field: 6 })
    expect(play(state, "esc").state.mode).toEqual({ kind: "browse" })
  })

  test("the title is typed in place, refuses to be empty, and saving returns to the field", () => {
    const editing = play(withOpen(overdue), "e", "enter")
    expect(editing.state.mode).toEqual({ kind: "edit-text", field: "title", draft: "Overdue task", origin: "edit" })
    const empty = play(editing.state, { type: "draft", text: "  " }, "enter")
    expect(empty).toMatchObject({ effects: [], state: { mode: { error: "A title cannot be empty" } } })
    const typed = play(empty.state, { type: "draft", text: "Renamed" })
    expect(typed.state.mode).toEqual({ kind: "edit-text", field: "title", draft: "Renamed", origin: "edit" })
    const { state, effects } = play(typed.state, "enter")
    expect(effects).toEqual([{ kind: "update-task", taskId: overdue.id, patch: { field: "title", title: "Renamed" }, done: "Title saved" }])
    expect(state.mode).toEqual({ kind: "edit", field: 0 })
  })

  test("an unchanged title or Esc saves nothing", () => {
    expect(play(withOpen(overdue), "e", "enter", "enter").effects).toEqual([])
    expect(play(withOpen(overdue), "e", "enter", { type: "draft", text: "x" }, "esc")).toMatchObject({ effects: [], state: { mode: { kind: "edit", field: 0 } } })
  })

  test("a due date is validated before it is sent", () => {
    const due = play(withOpen(overdue), "e", "G", "j", "j", "j", "j", "j", "enter")
    expect(due.state.mode).toMatchObject({ kind: "edit-text", field: "due", draft: "2026-11-10" })
    expect(play(due.state, { type: "draft", text: "next week" }, "enter")).toMatchObject({
      effects: [],
      state: { mode: { error: "Use YYYY-MM-DD, or leave it empty to clear" } },
    })
    expect(play(due.state, { type: "draft", text: "2026-11-30" }, "enter").effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "dates", dates: { type: "Milestone", due: "2026-11-30" } }, done: "Due date set to 2026-11-30" },
    ])
    expect(play(due.state, { type: "draft", text: "" }, "enter").effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "dates", dates: { type: "Backlog" } }, done: "Due date cleared" },
    ])
  })

  test("the description field opens the editor and stays in edit mode", () => {
    const { state, effects } = play(withOpen(overdue), "e", "j", "j", "j", "j", "j", "j", "enter")
    expect(effects).toEqual([{ kind: "edit-description", task: overdue }])
    expect(state.mode).toEqual({ kind: "edit", field: 6 })
  })
})

describe("results of writes", () => {
  test("a saved task updates the details and the lists", () => {
    const renamed = { ...overdue, title: "Renamed" }
    const { state } = play(withOpen(overdue), { type: "task-saved", done: "Title saved", result: { ok: true, value: renamed } })
    expect(state.flash).toEqual({ tone: "info", text: "Title saved" })
    expect(state.details).toMatchObject({ state: "ready", value: { task: { title: "Renamed" } } })
    expect(selectedTask({ ...state, focus: "list" })?.title).toBe("Renamed")
  })

  test("a completed task, or one handed to someone else, leaves My to-do", () => {
    const done = { ...overdue, statusId: customStatusId("DONE"), statusGroup: "Completed" as const }
    const { state } = play(withOpen(overdue), { type: "task-saved", done: "x", result: { ok: true, value: done } })
    expect(listRows(state).flatMap((row) => (row.kind === "task" ? [row.task.title] : []))).toEqual(["Later task", "Undated task"])
    const theirs = { ...undated, assigneeIds: [PAT] }
    const moved = play(play(withOpen(undated), "2").state, { type: "task-saved", done: "x", result: { ok: true, value: theirs } }).state
    expect(selectedTask(moved)?.title).toBe("Later task")
  })

  test("a task I just took joins My to-do", () => {
    const taken = task("T9", "Taken task", { type: "Milestone", due: "2026-11-12" })
    const { state } = play(loaded(), "t", { type: "task-saved", done: "Assigned to you", result: { ok: true, value: taken } })
    expect(listRows(state).map((row) => (row.kind === "heading" ? row.name : row.kind === "task" ? row.task.title : ""))).toEqual([
      "Overdue", "Overdue task", "Today", "Taken task", "Later", "Later task", "No date", "Undated task",
    ])
  })

  test("a failed save keeps the task and shows Wrike's message", () => {
    const { state } = play(withOpen(overdue), { type: "task-saved", done: "x", result: { ok: false, error: { kind: "invalid", message: "Parameter 'title' value is invalid" } } })
    expect(state.flash).toEqual({ tone: "error", text: "Parameter 'title' value is invalid" })
    expect(state.details).toMatchObject({ value: { task: { title: "Overdue task" } } })
  })

  test("a comment needs text, posts, and lands at the end of the thread", () => {
    const composing = play(withOpen(overdue), "c")
    expect(play(composing.state, "enter")).toMatchObject({ effects: [], state: { mode: { kind: "compose" }, flash: { tone: "error" } } })
    const sent = play(composing.state, { type: "draft", text: "On it" }, "enter")
    expect(sent.effects).toEqual([{ kind: "add-comment", taskId: overdue.id, text: "On it" }])
    const comment = { id: "C1", authorId: ME, text: "On it", createdDate: "2026-11-12T16:01:00Z" }
    const { state, effects } = play(sent.state, { type: "comment-added", taskId: overdue.id, result: { ok: true, value: comment } })
    expect(state.details).toMatchObject({ value: { comments: [comment] } })
    expect(state.flash?.text).toBe("Comment posted")
    expect(effects).toEqual([{ kind: "scroll-details", to: "bottom" }])
  })

  test("Ctrl+E moves a comment draft to the editor", () => {
    const { state, effects } = play(withOpen(overdue), "c", { type: "draft", text: "Long" }, "ctrl+e")
    expect(effects).toEqual([{ kind: "compose-in-editor", taskId: overdue.id, draft: "Long" }])
    expect(state.mode).toEqual({ kind: "browse" })
  })
})

describe("workflows", () => {
  const foreign = { ...overdue, statusId: customStatusId("SPACE-1") }

  test("a status outside the account workflows loads the space workflows once", () => {
    const first = play(loaded(), "t", "enter", { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(foreign) } })
    expect(first.effects.map((effect) => effect.kind)).toEqual(["load-details", "load-space-workflows"])
    const second = play(first.state, "r", { type: "details-loaded", request: 2, result: { ok: true, value: detailsOf(foreign) } })
    expect(second.effects.map((effect) => effect.kind)).toEqual(["load-todo", "load-details"])
  })

  test("a list with such a task loads them too, once the account workflows are known", () => {
    const [started] = start(initialState(profile, clock))
    const early = play(started, { type: "todo-loaded", request: 1, clock, result: { ok: true, value: [foreign] } })
    expect(early.effects).toEqual([])
    const { state, effects } = play(early.state, { type: "reference-loaded", result: { ok: true, value: { contacts, workflows } } })
    expect(effects).toEqual([{ kind: "load-space-workflows" }])
    expect(state.spaceWorkflows).toBe("loading")
  })

  test("the status picker fills in when the space workflows arrive", () => {
    const waiting = play(loaded(), "t", "enter", { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(foreign) } }, "s")
    expect(pickerOptions(waiting.state, waiting.state.mode as never)).toEqual([])
    const space: Workflow = { id: "W2", name: "Support", statuses: [status("SPACE-1", "Triage"), status("SPACE-2", "Resolved", "Completed")] }
    const { state } = play(waiting.state, { type: "space-workflows-loaded", result: { ok: true, value: [space] } })
    expect(pickerOptions(state, state.mode as never).map((option) => option.label)).toEqual(["Triage", "Resolved"])
  })
})

describe("panes", () => {
  test("h and l move between panes and stop at the edges", () => {
    expect(play(loaded(), "h", "h").state.focus).toBe("nav")
    expect(play(loaded(), "l", "l").state.focus).toBe("details")
    expect(play(loaded(), "3", "1").state.focus).toBe("nav")
  })

  test("v zooms the details pane and leaving it ends the zoom", () => {
    const zoomed = play(loaded(), "v").state
    expect(zoomed).toMatchObject({ zoom: true, focus: "details" })
    expect(play(zoomed, "h").state).toMatchObject({ zoom: false, focus: "list" })
    expect(play(zoomed, "v").state).toMatchObject({ zoom: false, focus: "details" })
  })

  test("the navigation pane steps through the views", () => {
    const { state, effects } = play(loaded(), "1", "j", "j", "j", "k")
    expect(state).toMatchObject({ focus: "nav", view: "todo" })
    expect(effects).toEqual([])
  })

  test("? opens the legend and q quits only outside it", () => {
    const help = play(loaded(), "?")
    expect(help.state.mode).toEqual({ kind: "help" })
    expect(play(help.state, "q")).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
    expect(play(loaded(), "q").effects).toEqual([{ kind: "quit" }])
  })
})
