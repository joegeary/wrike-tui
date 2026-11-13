import { describe, expect, test } from "bun:test"
import { navRows, type NavPath } from "../../src/app/nav"
import { reduce, start } from "../../src/app/reducer"
import { currentList, currentView, listCursor, listRows, navCursorRow, navRowsOf, pickerOptions, selectedRow, selectedTask } from "../../src/app/selectors"
import { initialState, LIST_LIMIT, type State } from "../../src/app/state"
import { commentId, customStatusId, folderId, taskId, userId } from "../../src/domain/ids"
import { DEFAULT_SPECS, NOBODY } from "../../src/domain/list"
import type { Workflow } from "../../src/domain/model"
import type { Favorite } from "../../src/domain/workspace"
import {
  boot,
  clock,
  contacts,
  detailsOf,
  ENG,
  engTree,
  inTodo,
  key,
  later,
  loaded,
  ME,
  mention,
  overdue,
  PAT,
  play,
  profile,
  projectNote,
  report,
  requestOf,
  showing,
  spaces,
  status,
  task,
  tasksLoaded,
  todo,
  tree,
  undated,
  withTree,
  workflows,
} from "../support/app"

const sketch = (state: State) =>
  listRows(state).map((row) => {
    if (row.kind === "group") return `${"  ".repeat(row.depth)}# ${row.label} ${row.count}${row.collapsed ? " (closed)" : ""}`
    if (row.kind === "task") return `${"  ".repeat(row.depth)}${row.task.title}${row.hasChildren ? (row.expanded ? " -" : " +") : ""}`
    return row.kind === "more" ? `... ${row.label}` : row.entry.id
  })

const navSketch = (state: State) =>
  navRowsOf(state).map((row) => {
    const at = row === navCursorRow(state) ? " <" : ""
    if (row.kind === "heading") return `# ${row.label}`
    if (row.kind === "note") return `(${row.text})`
    if (row.kind === "view") return `${row.view}${at}`
    if (row.kind === "favorite") return `* ${row.favorite.title}${row.missing ? " (not found)" : ""}${at}`
    return `${"  ".repeat(row.depth)}${row.loading ? "~" : row.expanded ? "v" : row.expandable ? ">" : "."} ${row.node.title}${at}`
  })

/** My to-do with `opened` open in the details pane and the cursor on it. */
function withOpen(opened = overdue): State {
  const base = inTodo()
  const index = listRows(base).findIndex((row) => row.kind === "task" && row.task.id === opened.id)
  const keys = Array.from({ length: index - listCursor(base) }, () => "j")
  const { state, effects } = play(base, ...keys, "enter")
  return play(state, { type: "details-loaded", request: requestOf(effects, "load-details"), result: { ok: true, value: detailsOf(opened) } }).state
}

/** The Platform folder (A) scoped from the tree, its list answered with `tasks`, the focus in the list. */
function inFolder(tasks = [later, undated, overdue], extra: { next?: string | null } = {}): State {
  return play(showing(withTree(), ["j", "enter"], "folder:A", tasks, extra), "l").state
}

describe("startup", () => {
  test("asks for reference data, the inbox, my tasks and the spaces, cache first", () => {
    const [state, effects] = start(initialState(profile, clock, boot()))
    expect(effects).toEqual([
      { kind: "load-reference" },
      { kind: "load-fields", request: 1 },
      { kind: "load-inbox", request: 1, includeRead: false },
      { kind: "load-tasks", request: 1, key: key("todo"), source: { kind: "mine", user: ME }, completed: false, pageToken: null },
      { kind: "load-spaces", request: 1, cached: true },
    ])
    expect(state.inbox.state).toBe("loading")
    expect(state.spaces.state).toBe("loading")
  })

  test("a response to a superseded request is dropped", () => {
    const { state } = play(loaded(), "r", { type: "inbox-loaded", request: 1, clock, result: { ok: true, value: [] } })
    expect(state.inbox).toMatchObject({ state: "loading", previous: [mention, projectNote, report] })
  })

  test("a failed reload keeps the last good list beside the error", () => {
    const { state } = play(loaded(), "r", { type: "inbox-loaded", request: 2, clock, result: { ok: false, error: { kind: "rate_limited" } } })
    expect(state.inbox).toEqual({ state: "error", error: { kind: "rate_limited" }, previous: [mention, projectNote, report] })
  })

  test("r reloads the list, the reference data, the spaces and the open space trees", () => {
    const { effects } = play(withTree(), "r")
    expect(effects.map((effect) => effect.kind)).toEqual(["load-reference", "load-fields", "load-spaces", "load-tree", "load-inbox"])
    expect(effects[2]).toMatchObject({ cached: false })
    expect(effects[3]).toMatchObject({ space: ENG, cached: false })
  })

  test("reloaded workflows replace the old ones instead of piling up", () => {
    const renamed: Workflow[] = [{ id: "W1", name: "Default", statuses: [status("NEW", "Fresh")] }]
    const { state } = play(loaded(), { type: "reference-loaded", result: { ok: true, value: { contacts, workflows: renamed } } })
    expect(state.workflows).toEqual(renamed)
  })
})

describe("lists", () => {
  test("My to-do is grouped by due date, and the cursor starts on the first task and walks every row", () => {
    const state = inTodo()
    expect(sketch(state)).toEqual(["# Overdue 1", "Overdue task", "# Later 1", "Later task", "# No date 1", "Undated task"])
    expect(selectedTask(state)?.title).toBe("Overdue task")
    expect(selectedRow(play(state, "j").state)).toMatchObject({ kind: "group", label: "Later" })
    expect(selectedTask(play(state, "j", "j").state)?.title).toBe("Later task")
    expect(selectedTask(play(state, "G").state)?.title).toBe("Undated task")
    expect(selectedTask(play(state, "G", "j", "j").state)?.title).toBe("Undated task")
    expect(selectedRow(play(state, "G", "g", "k").state)).toMatchObject({ kind: "group", label: "Overdue" })
  })

  test("moving the cursor does not shape the list again", () => {
    const state = inTodo()
    const rows = listRows(state)
    expect(listRows(play(state, "j", "j", "G", "k").state)).toBe(rows)
    expect(listRows(play(state, "j", "space").state)).not.toBe(rows)
  })

  test("showing a list seen before draws it at once and fetches it again behind", () => {
    const { state, effects } = play(loaded(), "t")
    expect(sketch(state)).toHaveLength(6)
    expect(currentList(state)).toMatchObject({ loading: "first", items: todo })
    expect(effects).toEqual([{ kind: "load-tasks", request: 2, key: key("todo"), source: { kind: "mine", user: ME }, completed: false, pageToken: null }])
  })

  test("Enter on a task loads its details and focuses the details pane", () => {
    const { state, effects } = play(inTodo(), "enter")
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

  test("a toggles read notifications and reloads from the top, and only works in the Inbox", () => {
    const { state, effects } = play(loaded(), "G", "a")
    expect(effects).toEqual([{ kind: "load-inbox", request: 2, includeRead: true }])
    expect(state.includeRead).toBe(true)
    expect(listCursor(state)).toBe(0)
    expect(play(inTodo(), "a")).toMatchObject({ effects: [], state: { includeRead: false } })
  })

  test("a flash lasts until the next key", () => {
    const flashed = play(loaded(), "G", "enter").state
    expect(play(flashed, "k").state.flash).toBeNull()
  })
})

describe("scopes and paging", () => {
  test("a folder list asks for active tasks first, and x asks again with every status", () => {
    const scoped = play(withTree(), "j", "enter")
    expect(scoped.effects).toEqual([{ kind: "load-tasks", request: 1, key: key("folder:A"), source: { kind: "folder", id: folderId("A") }, completed: false, pageToken: null }])
    expect(scoped.state.scope).toEqual({ kind: "folder", id: folderId("A"), title: "Folder A", project: false })
    const { state, effects } = play(inFolder(), "x")
    expect(effects).toEqual([{ kind: "load-tasks", request: 2, key: key("folder:A"), source: { kind: "folder", id: folderId("A") }, completed: true, pageToken: null }])
    expect(state.flash?.text).toBe("Showing completed, cancelled and deferred tasks too")
    expect(play(state, "x").effects[0]).toMatchObject({ completed: false, request: 3 })
  })

  test("a space scopes to the space, and a project is a folder that says so", () => {
    expect(play(withTree(), "enter").effects).toEqual([{ kind: "load-tasks", request: 1, key: key("space:ENG"), source: { kind: "space", id: ENG }, completed: false, pageToken: null }])
    expect(play(withTree(), "j", "j", "enter").state.scope).toEqual({ kind: "folder", id: folderId("B"), title: "Folder B", project: true })
  })

  test("a folder is grouped by status and sorted by importance, due date, then title", () => {
    const urgent = task("T7", "Urgent task", { type: "Milestone", due: "2026-12-05" }, { importance: "High" })
    const wip = task("T8", "Started task", { type: "Backlog" }, { statusId: customStatusId("WIP") })
    expect(sketch(inFolder([later, undated, overdue, wip, urgent]))).toEqual(["# New 4", "Urgent task", "Overdue task", "Later task", "Undated task", "# In Progress 1", "Started task"])
  })

  test("the next page loads when the cursor comes within 20 rows of the end, once", () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_unused, index) => task(`P${from + index}`, `Task ${String(from + index).padStart(3, "0")}`))
    const first = inFolder(page(0, 60), { next: "TOKEN-2" })
    expect(sketch(first).at(-1)).toBe("... Load more")
    const far = play(first, ...Array.from({ length: 30 }, () => "j"))
    expect(far.effects).toEqual([])
    const near = play(far.state, ...Array.from({ length: 12 }, () => "j"))
    expect(near.effects).toEqual([{ kind: "load-tasks", request: 2, key: key("folder:A"), source: { kind: "folder", id: folderId("A") }, completed: false, pageToken: "TOKEN-2" }])
    expect(sketch(near.state).at(-1)).toBe("... Loading more...")
    const before = selectedTask(near.state)!.title
    const second = play(near.state, tasksLoaded("folder:A", 2, page(60, 40), { more: true }))
    expect(currentList(second.state)).toMatchObject({ next: null, loading: null })
    expect(currentList(second.state)!.items).toHaveLength(100)
    expect(selectedTask(second.state)!.title).toBe(before)
    expect(sketch(second.state).at(-1)).toBe("Task 099")
  })

  test("Enter on the more row loads the next page, and a page that fails keeps what is loaded", () => {
    const first = inFolder([later], { next: "TOKEN-2" })
    const asked = play(first, "G", "enter")
    expect(asked.effects).toMatchObject([{ kind: "load-tasks", pageToken: "TOKEN-2" }])
    const failed = play(asked.state, { type: "tasks-loaded", key: key("folder:A"), request: 2, clock, more: true, jump: false, result: { ok: false, error: { kind: "rate_limited" } } })
    expect(currentList(failed.state)).toMatchObject({ items: [later], next: "TOKEN-2", loading: null, error: { kind: "rate_limited" } })
  })

  test("a page that answers after a reload is dropped", () => {
    const first = inFolder([later], { next: "TOKEN-2" })
    const { state } = play(first, "G", "enter", "r", tasksLoaded("folder:A", 2, [undated], { more: true }))
    expect(currentList(state)).toMatchObject({ items: [later], loading: "first" })
  })

  test("the cursor keeps its task when a reload reorders the list, and takes its old place when the task is gone", () => {
    const state = play(inFolder(), "j", "j").state
    expect(selectedTask(state)?.title).toBe("Undated task")
    const urgent = task("T7", "Urgent task", { type: "Backlog" }, { importance: "High" })
    const reloaded = showing(state, ["r"], "folder:A", [urgent, later, undated, overdue])
    expect(selectedTask(reloaded)?.title).toBe("Undated task")
    expect(selectedTask(showing(state, ["r"], "folder:A", [later, overdue]))?.title).toBe("Later task")
  })

  test("only the eight most recent lists are kept, and My to-do and the current one always stay", () => {
    let state = loaded()
    for (let n = 0; n < LIST_LIMIT + 2; n++) state = showing(state, ["/", { type: "draft", text: `query ${n}` } as never, "enter"], `search:query ${n}`, [later])
    expect(state.lists.size).toBe(LIST_LIMIT)
    expect([...state.lists.keys()]).toContain(key("todo"))
    expect([...state.lists.keys()]).toContain(key(`search:query ${LIST_LIMIT + 1}`))
    expect([...state.lists.keys()]).not.toContain(key("search:query 0"))
    expect(state.views.has(key("search:query 0"))).toBe(true)
  })

  test("an answer for a list that was dropped is ignored", () => {
    const [state] = reduce(loaded(), tasksLoaded("folder:GONE", 1, [later]))
    expect(state.lists.has(key("folder:GONE"))).toBe(false)
  })
})

describe("shaping", () => {
  const press = (state: State, ...names: string[]) => names.reduce((next, name) => play(next, ":", ...name, "enter").state, state)

  test("the palette query keeps the spaces typed into it", () => {
    expect(play(inFolder(), ":", ..."group by").state.mode).toMatchObject({ kind: "palette", query: "group by" })
  })

  test("the palette regroups, and the cursor stays on its task", () => {
    const state = play(inFolder(), "j", "j").state
    const regrouped = press(state, "group by due")
    expect(sketch(regrouped)).toEqual(["# Overdue 1", "Overdue task", "# Later 1", "Later task", "# No date 1", "Undated task"])
    expect(selectedTask(regrouped)?.title).toBe("Undated task")
    expect(currentView(regrouped).spec.group).toBe("due")
  })

  test("a subgroup, a sort and its reverse", () => {
    const state = press(inFolder(), "subgroup by due", "sort by title")
    expect(sketch(state)).toEqual(["# New 3", "  # Overdue 1", "Overdue task", "  # Later 1", "Later task", "  # No date 1", "Undated task"])
    expect(currentView(state).spec.sort[0]).toEqual({ key: "title", dir: "asc" })
    expect(currentView(press(state, "reverse the sort")).spec.sort[0]).toEqual({ key: "title", dir: "desc" })
  })

  test("Space closes a group and opens it again, and Enter does the same", () => {
    const state = play(inFolder(), "k", "space").state
    expect(sketch(state)).toEqual(["# New 3 (closed)"])
    expect(selectedRow(state)).toMatchObject({ kind: "group" })
    expect(sketch(play(state, "enter").state)).toHaveLength(4)
  })

  test("Space opens and closes the subtasks of a task", () => {
    const parent = task("T5", "Parent", { type: "Backlog" }, { subTaskIds: [taskId("T6")] })
    const child = task("T6", "Child", { type: "Backlog" }, { superTaskIds: [taskId("T5")] })
    const state = inFolder([parent, child])
    expect(sketch(state)).toEqual(["# New 1", "Parent +"])
    const open = play(state, "space").state
    expect(sketch(open)).toEqual(["# New 1", "Parent -", "  Child"])
    expect(sketch(play(open, "space").state)).toEqual(["# New 1", "Parent +"])
    expect(sketch(press(state, "open every group"))).toEqual(["# New 1", "Parent -", "  Child"])
    const closed = press(press(state, "open every group"), "close every group")
    expect(sketch(closed)).toEqual(["# New 1 (closed)"])
    expect(selectedRow(closed)).toMatchObject({ kind: "group" })
  })

  test("f filters by title, an empty filter clears it, and Esc leaves it alone", () => {
    const typed = play(inFolder(), "f", { type: "draft", text: "LATER" }, "enter").state
    expect(sketch(typed)).toEqual(["# New 1", "Later task"])
    expect(currentView(typed).spec.filters).toEqual([{ kind: "text", query: "LATER" }])
    expect(play(typed, "f").state.mode).toEqual({ kind: "filter-input", draft: "LATER" })
    expect(sketch(play(typed, "f", { type: "draft", text: "x" }, "esc").state)).toEqual(["# New 1", "Later task"])
    expect(currentView(play(typed, "f", { type: "draft", text: " " }, "enter").state).spec.filters).toEqual([])
  })

  test("pickers offer active people, and a deactivated one only while chosen", () => {
    const former = { id: userId("KUAAAA09"), name: "Former Colleague", email: null, active: false }
    const base = inFolder([later])
    const picking = play({ ...base, contacts: new Map([...base.contacts, [former.id, former]]) }, ":", ..."filter by assignee", "enter").state
    const labels = (state: State) => pickerOptions(state, state.mode as never).map((option) => option.label)
    expect(labels(picking)).not.toContain("Former Colleague")
    expect(labels({ ...picking, mode: { ...picking.mode, chosen: [former.id] } as never })).toContain("Former Colleague")
  })

  test("a filter picks its values in the picker, and applying nothing removes it", () => {
    const theirs = task("T7", "Theirs", { type: "Backlog" }, { assigneeIds: [PAT] })
    const nobodys = task("T8", "Nobody's", { type: "Backlog" }, { assigneeIds: [] })
    const picking = play(inFolder([later, theirs, nobodys]), ":", ..."filter by assignee", "enter").state
    expect(picking.mode).toMatchObject({ kind: "picker", field: "filter-assignee", chosen: [] })
    expect(pickerOptions(picking, picking.mode as never).map((option) => option.label)).toEqual(["Unassigned", "Pat Example", "Riley Demo", "Sam Sample"])
    const filtered = play(picking, "space", "down", "space", "enter").state
    expect(currentView(filtered).spec.filters).toEqual([{ kind: "assignee", ids: [NOBODY, PAT] }])
    expect(sketch(filtered)).toEqual(["# New 2", "Nobody's", "Theirs"])
    const again = play(filtered, ":", ..."filter by assignee", "enter").state
    expect(again.mode).toMatchObject({ chosen: [NOBODY, PAT] })
    expect(currentView(play(again, "space", "down", "space", "enter").state).spec.filters).toEqual([])
  })

  test("the status filter offers the statuses the loaded tasks use, and the due filter one range", () => {
    const wip = task("T8", "Started", { type: "Backlog" }, { statusId: customStatusId("WIP") })
    const state = inFolder([later, overdue, wip])
    const statuses = play(state, ":", ..."filter by status", "enter").state
    expect(pickerOptions(statuses, statuses.mode as never).map((option) => option.label)).toEqual(["New", "In Progress"])
    expect(sketch(play(statuses, "down", "space", "enter").state)).toEqual(["# In Progress 1", "Started"])
    const dueNow = play(state, ":", ..."filter by due", "enter", "down", "enter").state
    expect(currentView(dueNow).spec.filters).toEqual([{ kind: "due", range: "overdue" }])
    expect(play(dueNow, ":", ..."filter by due", "enter").state.mode).toMatchObject({ cursor: 1 })
    expect(currentView(play(dueNow, ":", ..."filter by due", "enter", "up", "enter").state).spec.filters).toEqual([])
  })

  test("only my tasks, then clear the filters, which is offered only while there are some", () => {
    const theirs = task("T7", "Theirs", { type: "Backlog" }, { assigneeIds: [PAT] })
    const mine = press(inFolder([later, theirs]), "only my tasks")
    expect(sketch(mine)).toEqual(["# New 1", "Later task"])
    const cleared = press(mine, "clear the filters")
    expect(currentView(cleared).spec.filters).toEqual([])
    expect(press(cleared, "clear the filters").mode).toEqual({ kind: "browse" })
    expect(sketch(press(cleared, "clear the filters"))).toHaveLength(3)
  })

  test("the columns are chosen in a picker, and the title always stays", () => {
    const picking = play(inFolder(), ":", ..."choose the columns", "enter").state
    expect(picking.mode).toMatchObject({ field: "columns", chosen: ["importance", "title", "assignees", "due"] })
    expect(pickerOptions(picking, picking.mode as never).map((option) => option.label)).toEqual(["Importance", "Status", "Assignees", "Due date", "Start date", "Updated", "Folder", "ID"])
    const chosen = play(picking, "space", "down", "space", "enter").state
    expect(currentView(chosen).spec.columns).toEqual(["title", "status", "assignees", "due"])
  })

  test("each scope keeps its own shaping", () => {
    const shaped = press(inFolder(), "group by assignee")
    const elsewhere = showing(play(shaped, "1").state, ["j", "j", "enter"], "folder:C", [later])
    expect(currentView(elsewhere).spec.group).toBe("status")
    const back = showing(elsewhere, ["k", "k", "enter"], "folder:A", [later])
    expect(currentView(back).spec.group).toBe("assignee")
  })

  test("Save as default writes this list's shaping for scopes of its kind, and a scope not seen yet starts from it", () => {
    const shaped = press(inFolder(), "group by assignee")
    const saved = play(shaped, ":", ..."save as default", "enter")
    expect(saved.effects).toEqual([{ kind: "save-config", settings: { ...shaped.settings, lists: { folder: { ...DEFAULT_SPECS.folder, group: "assignee" } } } }])
    expect(saved.state.flash?.text).toBe("Saved the theme, field history and this list's shaping as the default")
    const folder = showing(play(saved.state, "1").state, ["j", "j", "enter"], "folder:C", [later])
    expect(currentView(folder).spec.group).toBe("assignee")
    const project = showing(play(saved.state, "1").state, ["j", "enter"], "folder:B", [later])
    expect(project.scope).toMatchObject({ project: true })
    expect(currentView(project).spec.group).toBe("status")
  })

  test("a new scope starts from the config defaults", () => {
    const settings = { theme: "dark", navWidth: 30, completed: true, history: true, lists: { folder: { group: "none" } } } as const
    const scoped = play(withTree(loaded({ settings })), "j", "enter")
    expect(scoped.effects[0]).toMatchObject({ completed: true })
    expect(currentView(scoped.state).spec).toEqual({ ...DEFAULT_SPECS.folder, group: "none", completed: true })
  })

  test("a theme command switches the theme at once", () => {
    expect(press(loaded(), "theme: light").settings.theme).toBe("light")
  })
})

describe("the navigation pane", () => {
  test("j and k move the cursor over the rows without changing the list", () => {
    const { state, effects } = play(loaded(), "1", "j", "j", "j", "j", "j", "k")
    expect(navSketch(state)).toEqual(["inbox", "todo", "search", "# Spaces", "> Engineering <", "> Operations"])
    expect(state.scope).toEqual({ kind: "inbox" })
    expect(effects).toEqual([])
  })

  test("Enter on a view shows it and goes to the list", () => {
    const { state, effects } = play(loaded(), "1", "j", "enter")
    expect(state).toMatchObject({ scope: { kind: "todo" }, focus: "list" })
    expect(effects.map((effect) => effect.kind)).toEqual(["load-tasks"])
  })

  test("Enter on Search asks for a query the first time, and shows the last search after", () => {
    const first = play(loaded(), "1", "j", "j", "enter")
    expect(first.state.mode).toEqual({ kind: "search-input", draft: "" })
    const searched = showing(first.state, [{ type: "draft", text: "login" } as never, "enter"], "search:login", [later])
    expect(searched).toMatchObject({ scope: { kind: "search", query: "login" }, lastSearch: "login" })
    const back = play(searched, "i", "1", "enter")
    expect(back.state).toMatchObject({ scope: { kind: "search", query: "login" }, focus: "list" })
    expect(navRowsOf(back.state)[2]).toMatchObject({ kind: "view", view: "search", count: 1 })
  })

  test("Space opens a space, which loads its tree once, cache first", () => {
    const opened = play(loaded(), "1", "j", "j", "j", "space")
    expect(opened.effects).toEqual([{ kind: "load-tree", request: 1, space: ENG, cached: true }])
    expect(navSketch(opened.state).slice(4)).toEqual(["~ Engineering <", "> Operations"])
    expect(opened.state.scope).toEqual({ kind: "inbox" })
    const state = withTree()
    expect(navSketch(state).slice(4)).toEqual(["v Engineering <", "  > Folder A", "  . Folder B", "> Operations"])
    const closedAndOpened = play(state, "space", "space")
    expect(closedAndOpened.effects).toEqual([])
    expect(navSketch(closedAndOpened.state).slice(4)).toHaveLength(4)
  })

  test("Enter scopes the list to the row and opens it, and the focus stays in the tree", () => {
    const { state, effects } = play(loaded(), "1", "j", "j", "j", "enter")
    expect(effects.map((effect) => effect.kind)).toEqual(["load-tree", "load-tasks"])
    expect(state).toMatchObject({ focus: "nav", scope: { kind: "space", id: ENG, title: "Engineering" } })
    const deeper = play(withTree(), "j", "enter", "j", "enter")
    expect(navSketch(deeper.state).slice(4)).toEqual(["v Engineering", "  v Folder A", "    . Folder B <", "    . Folder C", "  . Folder B", "> Operations"])
    expect(deeper.state.scope).toMatchObject({ kind: "folder", id: "B", project: true })
  })

  test("a folder under two parents is two rows, and the cursor stays on the one it is on", () => {
    const state = play(withTree(), "j", "space", "j").state
    expect(state.nav.cursor).toBe("space:ENG/A/B" as NavPath)
    const refreshed = play(state, "r", { type: "tree-loaded", space: ENG, request: 2, from: "wrike", result: { ok: true, value: engTree } }).state
    expect(navCursorRow(refreshed)?.path).toBe("space:ENG/A/B" as NavPath)
  })

  test("the cursor goes to the nearest ancestor when a refresh removes its folder", () => {
    const state = play(withTree(), "j", "space", "j", "j").state
    expect(state.nav.cursor).toBe("space:ENG/A/C" as NavPath)
    const without = tree("ENG", { ENG: ["A", "B"], A: ["B"], B: [] }, ["B"])
    const refreshed = play(state, "r", { type: "tree-loaded", space: ENG, request: 2, from: "wrike", result: { ok: true, value: without } }).state
    expect(navCursorRow(refreshed)?.path).toBe("space:ENG/A" as NavPath)
  })

  test("a tree that fails to load says so under its space and loads again on r", () => {
    const opened = play(loaded(), "1", "j", "j", "j", "space")
    const failed = play(opened.state, { type: "tree-loaded", space: ENG, request: 1, from: "wrike", result: { ok: false, error: { kind: "network", message: "offline" } } })
    expect(navSketch(failed.state).slice(4, 6)).toEqual(["v Engineering <", "(Could not load, press r)"])
    expect(play(failed.state, "r").effects.map((effect) => effect.kind)).toContain("load-tree")
  })

  test("/ in the nav pane still opens task search", () => {
    expect(play(loaded(), "1", "/").state).toMatchObject({ mode: { kind: "search-input" }, focus: "list" })
  })
})

describe("the cache", () => {
  test("a cached tree paints while the fetch runs, and a fetch that matches rebuilds nothing", () => {
    const opened = play(loaded(), "1", "j", "j", "j", "space")
    const painted = play(opened.state, { type: "tree-loaded", space: ENG, request: 1, from: "cache", result: { ok: true, value: engTree } })
    expect(painted.state.trees.get(ENG)).toEqual({ state: "loading", previous: engTree })
    expect(navSketch(painted.state).slice(4, 6)).toEqual(["v Engineering <", "  > Folder A"])
    const copy = tree("ENG", { ENG: ["A", "B"], A: ["B", "C"], B: [], C: [] }, ["B"])
    const same = play(painted.state, { type: "tree-loaded", space: ENG, request: 1, from: "wrike", result: { ok: true, value: copy } })
    expect(same.effects).toEqual([])
    expect(same.state.trees.get(ENG)).toEqual({ state: "ready", value: engTree })
    expect((same.state.trees.get(ENG) as { value: unknown }).value).toBe(engTree)
  })

  test("a fetch that differs replaces the tree and is written to the cache", () => {
    const changed = tree("ENG", { ENG: ["A"], A: [] })
    const { state, effects } = play(withTree(), "r", { type: "tree-loaded", space: ENG, request: 2, from: "wrike", result: { ok: true, value: changed } })
    expect(effects.at(-1)).toEqual({ kind: "cache-tree", space: ENG, tree: changed })
    expect(navSketch(state).slice(4, 6)).toEqual(["v Engineering <", "  . Folder A"])
  })

  test("the spaces list paints from the cache, and is written only when it changed", () => {
    const [started] = start(initialState(profile, clock, boot()))
    const painted = play(started, { type: "spaces-loaded", request: 1, from: "cache", result: { ok: true, value: spaces } })
    expect(painted.state.spaces).toEqual({ state: "loading", previous: spaces })
    expect(play(painted.state, { type: "spaces-loaded", request: 1, from: "wrike", result: { ok: true, value: [...spaces] } }).effects).toEqual([])
    const fewer = play(painted.state, { type: "spaces-loaded", request: 1, from: "wrike", result: { ok: true, value: [spaces[0]!] } })
    expect(fewer.effects).toEqual([{ kind: "cache-spaces", spaces: [spaces[0]!] }])
    expect(play(started, { type: "spaces-loaded", request: 1, from: "wrike", result: { ok: true, value: spaces } }).effects).toEqual([{ kind: "cache-spaces", spaces }])
  })
})

describe("favorites", () => {
  const folderA: Favorite = { kind: "folder", id: folderId("A"), title: "Folder A", project: false }
  const spaceEng: Favorite = { kind: "space", id: ENG, title: "Engineering" }
  const taskFav: Favorite = { kind: "task", id: overdue.id, title: "Overdue task" }

  test("F adds the nav row, the list row or the open task, and saves each time", () => {
    const folder = play(withTree(), "j", "F")
    expect(folder.effects).toEqual([{ kind: "save-favorites", favorites: [folderA] }])
    expect(folder.state.flash?.text).toBe("Added Folder A to the favorites")
    expect(navSketch(folder.state).slice(3, 5)).toEqual(["# Favorites", "* Folder A"])
    const space = play(folder.state, "k", "F")
    expect(space.state.favorites).toEqual([folderA, spaceEng])
    const row = play(inTodo(space.state), "F")
    expect(row.effects).toEqual([{ kind: "save-favorites", favorites: [folderA, spaceEng, taskFav] }])
    expect(play(withOpen(), "F").state.favorites).toEqual([taskFav])
  })

  test("F again removes it, and a cursor on the removed favorite steps to its neighbour", () => {
    const state = play(loaded({ favorites: [folderA, spaceEng] }), "1", "j", "j", "j", "j")
    expect(navSketch(state.state).slice(3, 6)).toEqual(["# Favorites", "* Folder A", "* Engineering <"])
    const removed = play(state.state, "F")
    expect(removed.effects).toEqual([{ kind: "save-favorites", favorites: [folderA] }])
    expect(navSketch(removed.state).slice(3, 5)).toEqual(["# Favorites", "* Folder A <"])
    expect(removed.state.flash?.text).toBe("Removed Engineering from the favorites")
  })

  test("F on a view, a group row or an unopened notification explains instead", () => {
    expect(play(loaded(), "1", "F")).toMatchObject({ effects: [], state: { flash: { text: "Only a space, a folder, a project or a task can be a favorite" } } })
    expect(play(inTodo(), "k", "F")).toMatchObject({ effects: [], state: { flash: { text: "Select a task first" } } })
    expect(play(loaded(), "F")).toMatchObject({ effects: [], state: { flash: { text: "Open the task first, then press F" } } })
  })

  test("J and K move a favorite and the cursor goes with it", () => {
    const state = play(loaded({ favorites: [folderA, spaceEng, taskFav] }), "1", "j", "j", "j").state
    const down = play(state, "J")
    expect(down.effects).toEqual([{ kind: "save-favorites", favorites: [spaceEng, folderA, taskFav] }])
    expect(navSketch(down.state).slice(4, 7)).toEqual(["* Engineering", "* Folder A <", "* Overdue task"])
    expect(play(down.state, "K").state.favorites).toEqual([folderA, spaceEng, taskFav])
    expect(play(state, "K").effects).toEqual([])
    expect(play(loaded(), "1", "J").effects).toEqual([])
  })

  test("Enter on a folder or space favorite scopes the list, and on a task favorite opens the task", () => {
    const state = play(loaded({ favorites: [folderA, taskFav] }), "1", "j", "j", "j").state
    const scoped = play(state, "enter")
    expect(scoped.state).toMatchObject({ scope: folderA, focus: "list" })
    expect(scoped.effects).toMatchObject([{ kind: "load-tasks", source: { kind: "folder", id: "A" } }])
    const opened = play(state, "j", "enter")
    expect(opened.effects).toEqual([{ kind: "load-details", request: 1, target: { kind: "task", id: overdue.id } }])
    expect(opened.state.focus).toBe("details")
  })

  test("a title refreshes when the item is seen again, in a list page or in a tree", () => {
    const stale = loaded({ favorites: [{ ...folderA, title: "Old name" }, { ...taskFav, title: "Old title" }] })
    expect(stale.favorites).toEqual([{ ...folderA, title: "Old name" }, taskFav])
    const opened = play(stale, "1", "j", "j", "j", "j", "j", "space")
    const withFolders = play(opened.state, { type: "tree-loaded", space: ENG, request: requestOf(opened.effects, "load-tree"), from: "wrike", result: { ok: true, value: engTree } })
    expect(withFolders.effects.at(-1)).toEqual({ kind: "save-favorites", favorites: [folderA, taskFav] })
    const renamed = { ...overdue, title: "Renamed" }
    const saved = play(withFolders.state, { type: "task-saved", done: "Title saved", result: { ok: true, value: renamed } })
    expect(saved.effects).toEqual([{ kind: "save-favorites", favorites: [folderA, { ...taskFav, title: "Renamed" }] }])
  })

  test("a favorite Wrike answers 404 for is marked not found until it is seen or removed", () => {
    const state = play(loaded({ favorites: [folderA, taskFav] }), "1", "j", "j", "j").state
    const gone = play(state, "enter", { type: "tasks-loaded", key: key("folder:A"), request: 1, clock, more: false, jump: false, result: { ok: false, error: { kind: "not_found" } } }).state
    expect(navSketch(gone)[4]).toBe("* Folder A (not found) <")
    const taskGone = play(gone, "1", "j", "enter", { type: "details-loaded", request: 1, result: { ok: false, error: { kind: "not_found" } } }).state
    expect(navSketch(taskGone).slice(4, 6)).toEqual(["* Folder A (not found)", "* Overdue task (not found) <"])
    expect(navSketch(play(taskGone, "1", "F").state).slice(3, 5)).toEqual(["# Favorites", "* Folder A (not found) <"])
    expect(play(gone, "1", "F").state.missing.size).toBe(0)
  })
})

describe("search", () => {
  test("a title query searches every status, and a late answer to an older query is dropped", () => {
    const typing = play(loaded(), "/", { type: "draft", text: " login " })
    expect(typing.state).toMatchObject({ scope: { kind: "inbox" }, mode: { kind: "search-input", draft: " login " } })
    const { state, effects } = play(typing.state, "enter")
    expect(effects).toEqual([{ kind: "load-tasks", request: 1, key: key("search:login"), source: { kind: "title", text: "login" }, completed: true, pageToken: null }])
    expect(state).toMatchObject({ scope: { kind: "search", query: "login" }, lastSearch: "login", mode: { kind: "browse" } })
    expect(currentList(state)).toMatchObject({ loading: "first" })
    const again = play(state, "/", { type: "draft", text: "sso" }, "enter", tasksLoaded("search:login", 1, [later]))
    expect(again.state.scope).toEqual({ kind: "search", query: "sso" })
    expect(currentList(again.state)).toMatchObject({ loading: "first", items: [] })
  })

  test("search results are flat, newest update first", () => {
    const old = task("T7", "Old", { type: "Backlog" }, { updatedDate: "2026-01-01T00:00:00Z" })
    const state = showing(loaded(), ["/", { type: "draft", text: "x" } as never, "enter"], "search:x", [old, later])
    expect(sketch(state)).toEqual(["Later task", "Old"])
  })

  test("a permalink query opens the task it finds", () => {
    const typed = play(loaded(), "/", { type: "draft", text: "https://www.wrike.com/open.htm?id=3" }, "enter")
    expect(typed.effects[0]).toMatchObject({ kind: "load-tasks", source: { kind: "permalink" } })
    const { state, effects } = play(typed.state, tasksLoaded("search:https://www.wrike.com/open.htm?id=3", 1, [later], { jump: true }))
    expect(effects.map((effect) => effect.kind)).toEqual(["load-details"])
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
    const pressed = play(inTodo(), "s")
    expect(pressed.effects).toEqual([{ kind: "load-details", request: 1, target: { kind: "task", id: overdue.id } }])
    expect(pressed.state).toMatchObject({ afterOpen: "status", focus: "list", mode: { kind: "browse" } })
    const wip = { ...overdue, statusId: customStatusId("WIP") }
    const { state } = play(pressed.state, { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(wip) } })
    expect(state).toMatchObject({ afterOpen: null, mode: { kind: "picker", field: "status", cursor: 1 } })
  })

  test("a failed open drops the waiting command and shows the error in the pane", () => {
    const { state } = play(inTodo(), "s", { type: "details-loaded", request: 1, result: { ok: false, error: { kind: "not_found" } } })
    expect(state).toMatchObject({ afterOpen: null, mode: { kind: "browse" }, details: { state: "error", error: { kind: "not_found" } } })
  })

  test("a task command on a group row does nothing", () => {
    expect(play(inTodo(), "k", "s")).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
  })

  test("the status picker filters as you type and applies the highlighted status", () => {
    const opened = play(withOpen(), "s")
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
    expect(play(withOpen(), "s", "enter").effects).toEqual([])
    expect(play(withOpen(), "s", "down", "esc")).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
  })

  test("the importance picker moves with the arrows and stays inside the list", () => {
    const { effects } = play(withOpen(), "p", "up", "up", "up", "enter")
    expect(effects).toEqual([{ kind: "update-task", taskId: overdue.id, patch: { field: "importance", importance: "High" }, done: "Importance set to High" }])
  })

  test("the assignee picker toggles people and saves only the difference", () => {
    const opened = play(withOpen(), "A")
    expect(opened.state.mode).toMatchObject({ field: "assignees", chosen: [ME] })
    expect(pickerOptions(opened.state, opened.state.mode as never).map((option) => option.label)).toEqual(["Pat Example", "Riley Demo", "Sam Sample"])
    const { effects } = play(opened.state, "space", "s", "a", "m", "space", "enter")
    expect(effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "assignees", add: [PAT], remove: [ME] }, done: "Assignees updated" },
    ])
    expect(play(opened.state, "enter").effects).toEqual([])
  })

  test("Space toggles only in a picker that takes several choices", () => {
    const single = play(withOpen(), "s", "space").state
    expect(single.mode).toMatchObject({ kind: "picker", chosen: [] })
  })

  test("m assigns to me once", () => {
    expect(play(withOpen(), "m")).toMatchObject({ effects: [], state: { flash: { text: "Already assigned to you" } } })
    const theirs = { ...overdue, assigneeIds: [PAT] }
    expect(play(withOpen(theirs), "m").effects).toEqual([
      { kind: "update-task", taskId: overdue.id, patch: { field: "assignees", add: [ME], remove: [] }, done: "Assigned to you" },
    ])
  })

  test("E hands the description to the editor, o and y and Y use the permalink", () => {
    const { effects } = play(withOpen(), "E", "o", "y", "Y")
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
    const state = play(withOpen(), "e", "k").state
    expect(state.mode).toEqual({ kind: "edit", field: 0 })
    expect(play(state, "j", "j", "j", "j", "j", "j", "j", "j").state.mode).toEqual({ kind: "edit", field: 6 })
    expect(play(state, "esc").state.mode).toEqual({ kind: "browse" })
  })

  test("the title is typed in place, refuses to be empty, and saving returns to the field", () => {
    const editing = play(withOpen(), "e", "enter")
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
    expect(play(withOpen(), "e", "enter", "enter").effects).toEqual([])
    expect(play(withOpen(), "e", "enter", { type: "draft", text: "x" }, "esc")).toMatchObject({ effects: [], state: { mode: { kind: "edit", field: 0 } } })
  })

  test("a due date is validated before it is sent", () => {
    const due = play(withOpen(), "e", "j", "j", "j", "j", "j", "enter")
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

  test("a picker opened from edit mode returns to its field", () => {
    expect(play(withOpen(), "e", "j", "enter", "esc").state.mode).toEqual({ kind: "edit", field: 1 })
  })

  test("the description field opens the editor and stays in edit mode", () => {
    const { state, effects } = play(withOpen(), "e", "j", "j", "j", "j", "j", "j", "enter")
    expect(effects).toEqual([{ kind: "edit-description", task: overdue }])
    expect(state.mode).toEqual({ kind: "edit", field: 6 })
  })
})

describe("results of writes", () => {
  const titles = (state: State) => listRows(state).flatMap((row) => (row.kind === "task" ? [row.task.title] : []))

  test("a saved task updates the details and the lists", () => {
    const renamed = { ...overdue, title: "Renamed" }
    const { state } = play(withOpen(), { type: "task-saved", done: "Title saved", result: { ok: true, value: renamed } })
    expect(state.flash).toEqual({ tone: "info", text: "Title saved" })
    expect(state.details).toMatchObject({ state: "ready", value: { task: { title: "Renamed" } } })
    expect(selectedTask({ ...state, focus: "list" })?.title).toBe("Renamed")
  })

  test("a completed task, or one handed to someone else, leaves My to-do, and the cursor takes the next row", () => {
    const done = { ...overdue, statusId: customStatusId("DONE"), statusGroup: "Completed" as const }
    const { state } = play(withOpen(), { type: "task-saved", done: "x", result: { ok: true, value: done } })
    expect(titles(state)).toEqual(["Later task", "Undated task"])
    expect(selectedTask(state)?.title).toBe("Later task")
    const theirs = { ...undated, assigneeIds: [PAT] }
    const moved = play(play(withOpen(undated), "2").state, { type: "task-saved", done: "x", result: { ok: true, value: theirs } }).state
    expect(titles(moved)).toEqual(["Overdue task", "Later task"])
  })

  test("a task I just took joins My to-do", () => {
    const taken = task("T9", "Taken task", { type: "Milestone", due: "2026-11-12" })
    const { state } = play(inTodo(), { type: "task-saved", done: "Assigned to you", result: { ok: true, value: taken } })
    expect(sketch(state)).toEqual(["# Overdue 1", "Overdue task", "# Today 1", "Taken task", "# Later 1", "Later task", "# No date 1", "Undated task"])
  })

  test("a closed task leaves a folder list of active tasks, stays in one that shows every status, and never joins a list it was not in", () => {
    const done = { ...overdue, statusId: customStatusId("DONE"), statusGroup: "Completed" as const }
    const saved = { type: "task-saved", done: "x", result: { ok: true, value: done } } as const
    expect(titles(play(inFolder(), saved).state)).toEqual(["Later task", "Undated task"])
    const everything = showing(inFolder(), ["x"], "folder:A", [later, undated, overdue])
    expect(titles(play(everything, saved).state)).toContain("Overdue task")
    expect(titles(play(inFolder([later]), saved).state)).toEqual(["Later task"])
  })

  test("a failed save keeps the task and shows Wrike's message, and read-only mode says so", () => {
    const { state } = play(withOpen(), { type: "task-saved", done: "x", result: { ok: false, error: { kind: "invalid", message: "Parameter 'title' value is invalid" } } })
    expect(state.flash).toEqual({ tone: "error", text: "Parameter 'title' value is invalid" })
    expect(state.details).toMatchObject({ value: { task: { title: "Overdue task" } } })
    const refused = play(withOpen(), { type: "task-saved", done: "x", result: { ok: false, error: { kind: "read_only" } } })
    expect(refused.state.flash).toEqual({ tone: "error", text: "read-only mode: not saved" })
  })

  test("a comment needs text, posts, and lands at the end of the thread", () => {
    const composing = play(withOpen(), "c")
    expect(play(composing.state, "enter")).toMatchObject({ effects: [], state: { mode: { kind: "compose" }, flash: { tone: "error" } } })
    const sent = play(composing.state, { type: "draft", text: "On it" }, "enter")
    expect(sent.effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: null, body: { text: "On it", plainText: true } }])
    const comment = { id: commentId("C1"), authorId: ME, text: "On it", createdDate: "2026-11-12T16:01:00Z" }
    const { state, effects } = play(sent.state, { type: "comment-saved", taskId: overdue.id, editing: null, result: { ok: true, value: comment } })
    expect(state.details).toMatchObject({ value: { comments: [comment] } })
    expect(state.flash?.text).toBe("Comment posted")
    expect(effects).toEqual([{ kind: "scroll", pane: "details", to: "bottom" }])
  })

  test("Ctrl+E moves a comment draft to the editor, and what comes back is posted", () => {
    const handed = play(withOpen(), "c", { type: "draft", text: "Long" }, "ctrl+e")
    expect(handed.effects).toEqual([{ kind: "compose-in-editor", draft: "Long" }])
    const { state, effects } = play(handed.state, { type: "composed", text: "Long\nand longer" })
    expect(effects).toEqual([{ kind: "save-comment", taskId: overdue.id, editing: null, body: { text: "Long\nand longer", plainText: true } }])
    expect(state.mode).toEqual({ kind: "browse" })
  })

  test("an unchanged or emptied editor file discards the comment", () => {
    const handed = play(withOpen(), "c", { type: "draft", text: "Long" }, "ctrl+e").state
    for (const text of [null, "  "]) {
      const { state, effects } = play(handed, { type: "composed", text })
      expect(effects).toEqual([])
      expect(state.mode).toEqual({ kind: "browse" })
      expect(state.flash?.text).toBe("Comment discarded")
    }
  })
})

describe("workflows", () => {
  const foreign = { ...overdue, statusId: customStatusId("SPACE-1") }

  test("a status outside the account workflows loads the space workflows once", () => {
    const first = play(inTodo(), "enter", { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(foreign) } })
    expect(first.effects.map((effect) => effect.kind)).toEqual(["load-details", "load-history", "load-space-workflows"])
    const second = play(first.state, "r", { type: "details-loaded", request: 2, result: { ok: true, value: detailsOf(foreign) } })
    expect(second.effects.map((effect) => effect.kind)).not.toContain("load-space-workflows")
  })

  test("a list with such a task loads them too, once the account workflows are known", () => {
    const [started] = start(initialState(profile, clock, boot()))
    const early = play(started, tasksLoaded("todo", 1, [foreign]))
    expect(early.effects).toEqual([])
    const { state, effects } = play(early.state, { type: "reference-loaded", result: { ok: true, value: { contacts, workflows } } })
    expect(effects).toEqual([{ kind: "load-space-workflows" }])
    expect(state.spaceWorkflows).toBe("loading")
  })

  test("the status picker fills in when the space workflows arrive", () => {
    const waiting = play(inTodo(), "enter", { type: "details-loaded", request: 1, result: { ok: true, value: detailsOf(foreign) } }, "s")
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

  test("? opens the legend, which scrolls, and q quits only outside it", () => {
    const help = play(loaded(), "?")
    expect(help.state.mode).toEqual({ kind: "help" })
    expect(play(help.state, "j").effects).toEqual([{ kind: "scroll", pane: "help", to: "down" }])
    expect(play(help.state, "q")).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
    expect(play(loaded(), "q").effects).toEqual([{ kind: "quit" }])
  })

  test("the details pane scrolls", () => {
    expect(play(loaded(), "3", "j", "G").effects).toEqual([
      { kind: "scroll", pane: "details", to: "down" },
      { kind: "scroll", pane: "details", to: "bottom" },
    ])
  })
})

describe("the nav counts", () => {
  test("the counts are the unread notifications, my loaded tasks and the last search's results", () => {
    const rows = navRows({ counts: { inbox: 1, todo: 2, search: null }, favorites: [], missing: new Set(), spaces: { state: "idle" }, trees: new Map(), expanded: new Set() })
    expect(rows.slice(0, 3)).toMatchObject([{ count: 1 }, { count: 2 }, { count: null }])
    expect(navRowsOf(loaded()).slice(0, 3)).toMatchObject([{ count: 3 }, { count: 3 }, { count: null }])
  })
})
