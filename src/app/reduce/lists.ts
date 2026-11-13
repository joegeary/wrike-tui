import { customStatusId, userId } from "../../domain/ids"
import { COLUMN_KEYS, DUE_RANGES, withFilter, withSort, type ColumnKey, type Filter, type ListSpec } from "../../domain/list"
import { IMPORTANCES } from "../../domain/model"
import { taskScopeKind } from "../../domain/scope"
import { groupRowId } from "../../domain/shape"
import { ANY_DUE, currentList, currentView, listCursor, listRows, markedTasks, pickerOptions, selectedRow, selectedTask } from "../selectors"
import { LOAD_AHEAD, type ListPicker, type ListView, type Mode, type ScrollTo, type SpecChange, type State, type Update } from "../state"
import { clamp, cursorAt, info, withView } from "./core"
import { loadInbox, loadTasks, open, showScope } from "./load"

/** `M` marks the task under the cursor, or unmarks it, and moves on to the next task, past group headings. */
export function toggleMark(state: State): Update {
  const task = selectedTask(state)
  // A mark on a task that has left the list is dropped here too, so the count on screen is the count kept.
  const marks = new Set(markedTasks(state).map((marked) => marked.id))
  if (task && !marks.delete(task.id)) marks.add(task.id)
  const rows = listRows(state)
  const next = rows.findIndex((row, index) => index > listCursor(state) && row.kind === "task")
  const marked: State = { ...state, marks }
  return next < 0 ? [marked, []] : loadAhead(withView(marked, (view) => ({ ...view, cursor: cursorAt(state, next) })))
}

export function moveCursor(state: State, to: ScrollTo): Update {
  const count = listRows(state).length
  if (count === 0) return [state, []]
  const from = listCursor(state)
  const index = clamp(to === "down" ? from + 1 : to === "up" ? from - 1 : to === "top" ? 0 : count - 1, count)
  return loadAhead(withView(state, (view) => ({ ...view, cursor: cursorAt(state, index) })))
}

/** Asks for the next page once the cursor is near the end of what is loaded. */
function loadAhead(state: State): Update {
  const { scope } = state
  const list = currentList(state)
  if (scope.kind === "inbox" || !list || list.next === null || list.loading !== null || list.error !== null) return [state, []]
  return listRows(state).length - 1 - listCursor(state) <= LOAD_AHEAD ? loadTasks(state, scope, "more") : [state, []]
}

export function openRow(state: State): Update {
  const row = selectedRow(state)
  if (!row) return [state, []]
  switch (row.kind) {
    case "task":
      return open(state, { kind: "task", id: row.task.id }, null)
    case "group":
      return toggleRow(state)
    case "more":
      return state.scope.kind === "inbox" ? [state, []] : loadTasks(state, state.scope, "more")
    case "entry": {
      const { item } = row.entry
      if (!item) return [{ ...state, flash: info("This notification has nothing to open") }, []]
      if (item.baseType !== "TASK") {
        const kind = item.baseType === "PROJECT" ? "project" : "folder"
        return [{ ...state, flash: info(`Opening the ${kind} in the browser`) }, [{ kind: "open-url", url: item.permalink }]]
      }
      return open(state, { kind: "legacy", id: item.legacyId }, null)
    }
  }
}

export function toggleRow(state: State): Update {
  const row = selectedRow(state)
  const index = listCursor(state)
  const flip = <T>(set: ReadonlySet<T>, value: T) => {
    const next = new Set(set)
    if (!next.delete(value)) next.add(value)
    return next
  }
  if (row?.kind === "group") return [withView(state, (view) => ({ ...view, cursor: { id: groupRowId(row.key), index }, collapsed: flip(view.collapsed, row.key) })), []]
  if (row?.kind === "task" && row.hasChildren) return [withView(state, (view) => ({ ...view, cursor: { id: row.id, index }, expanded: flip(view.expanded, row.task.id) })), []]
  return [state, []]
}

export function changeSpec(state: State, change: SpecChange): Update {
  const { scope } = state
  if (scope.kind === "inbox") return [state, []]
  const { spec } = currentView(state)
  const [first, ...rest] = spec.sort
  const index = listCursor(state)
  // The cursor keeps its task through a regroup, and falls back to its place when the task is filtered away.
  const keep = (next: ListSpec, extra: Partial<ListView> = {}) => withView(state, (view) => ({ ...view, ...extra, spec: next, cursor: cursorAt(state, index) }))
  switch (change.set) {
    case "group":
      return [keep({ ...spec, group: change.group }, { collapsed: new Set() }), []]
    case "subgroup":
      return [keep({ ...spec, subgroup: change.group }, { collapsed: new Set() }), []]
    case "sort":
      return [keep(withSort(spec, change.key)), []]
    case "reverse":
      return first ? [keep({ ...spec, sort: [{ ...first, dir: first.dir === "asc" ? "desc" : "asc" }, ...rest] }), []] : [state, []]
    case "clear-filters":
      return [{ ...keep({ ...spec, filters: [] }), flash: info("Filters cleared") }, []]
    case "mine":
      return [keep(withFilter(spec, "assignee", { kind: "assignee", ids: [state.profile.userId] })), []]
    case "completed": {
      const completed = !spec.completed
      const flash = info(completed ? "Showing completed, cancelled and deferred tasks too" : "Showing active tasks only")
      return loadTasks({ ...keep({ ...spec, completed }), flash }, scope, "first")
    }
  }
}

export function listPicker(state: State, field: ListPicker): Mode {
  const { spec } = currentView(state)
  const filter = <K extends Filter["kind"]>(kind: K) => spec.filters.find((candidate): candidate is Filter & { kind: K } => candidate.kind === kind)
  const chosen: string[] =
    field === "filter-assignee"
      ? (filter("assignee")?.ids ?? [])
      : field === "filter-status"
        ? (filter("status")?.ids ?? [])
        : field === "filter-importance"
          ? (filter("importance")?.values ?? [])
          : field === "columns"
            ? spec.columns
            : []
  const mode: Mode & { kind: "picker" } = { kind: "picker", field, query: "", cursor: 0, chosen: [...chosen], origin: "browse" }
  const current = field === "filter-due" ? (filter("due")?.range ?? ANY_DUE) : null
  return { ...mode, cursor: Math.max(0, pickerOptions(state, mode).findIndex((option) => option.id === current)) }
}

export function submitListPicker(state: State, mode: Mode & { kind: "picker" }, field: ListPicker): Update {
  const { spec } = currentView(state)
  const browse = (next: ListSpec): Update => [{ ...withView(state, (view) => ({ ...view, spec: next, cursor: cursorAt(state, listCursor(state)) })), mode: { kind: "browse" } }, []]
  const some = <T>(values: T[], filter: Filter) => (values.length > 0 ? filter : null)
  switch (field) {
    case "filter-assignee":
      return browse(withFilter(spec, "assignee", some(mode.chosen, { kind: "assignee", ids: mode.chosen.map(userId) })))
    case "filter-status":
      return browse(withFilter(spec, "status", some(mode.chosen, { kind: "status", ids: mode.chosen.map(customStatusId) })))
    case "filter-importance": {
      const values = IMPORTANCES.filter((importance) => mode.chosen.includes(importance))
      return browse(withFilter(spec, "importance", some(values, { kind: "importance", values })))
    }
    case "filter-due": {
      const option = pickerOptions(state, mode)[mode.cursor]
      if (!option) return [state, []]
      const range = DUE_RANGES.find((candidate) => candidate === option.id)
      return browse(withFilter(spec, "due", range ? { kind: "due", range } : null))
    }
    case "columns":
      return browse({ ...spec, columns: COLUMN_KEYS.filter((column): column is ColumnKey => column === "title" || mode.chosen.includes(column)) })
  }
}

/** Writes the config file: the theme in use, and this list's shaping as the default for scopes of its kind. */
export function saveDefaults(state: State): Update {
  const { scope } = state
  const lists = scope.kind === "inbox" ? state.settings.lists : { ...state.settings.lists, [taskScopeKind(scope)]: currentView(state).spec }
  const settings = { ...state.settings, lists }
  const what = scope.kind === "inbox" ? "the theme and field history" : "the theme, field history and this list's shaping"
  return [{ ...state, settings, flash: info(`Saved ${what} as the default`) }, [{ kind: "save-config", settings }]]
}

export function toggleRead(state: State): Update {
  const includeRead = !state.includeRead
  const flash = info(includeRead ? "Showing read notifications too" : "Showing unread notifications only")
  return loadInbox(withView({ ...state, includeRead, flash }, (view) => ({ ...view, cursor: null })))
}

export function filterText(state: State): Update {
  const current = currentView(state).spec.filters.find((filter) => filter.kind === "text")
  return [{ ...state, mode: { kind: "filter-input", draft: current?.query ?? "" } }, []]
}

export function expandAll(state: State): Update {
  const parents = (currentList(state)?.items ?? []).filter((task) => task.subTaskIds.length > 0).map((task) => task.id)
  return [withView(state, (view) => ({ ...view, collapsed: new Set(), expanded: new Set(parents) })), []]
}

export function collapseAll(state: State): Update {
  const groups = listRows(state).flatMap((row) => (row.kind === "group" && row.depth === 0 ? [row.key] : []))
  const closed = withView(state, (view) => ({ ...view, collapsed: new Set(groups), expanded: new Set() }))
  // The cursor's row is hidden now, so it lands on the group that held it.
  return [withView(closed, (view) => ({ ...view, cursor: cursorAt(closed, listCursor(closed)) })), []]
}

export function search(state: State): Update {
  return [{ ...state, focus: "list", zoom: false, mode: { kind: "search-input", draft: "" } }, []]
}

export function submitSearch(state: State, mode: Mode & { kind: "search-input" }): Update {
  const query = mode.draft.trim()
  if (query === "") return [{ ...state, mode: { kind: "browse" } }, []]
  return showScope({ ...state, mode: { kind: "browse" } }, { kind: "search", query }, "list")
}

export function submitFilter(state: State, mode: Mode & { kind: "filter-input" }): Update {
  const query = mode.draft.trim()
  const { spec } = currentView(state)
  const filtered = withView(state, (view) => ({ ...view, spec: withFilter(spec, "text", query === "" ? null : { kind: "text", query }), cursor: cursorAt(state, listCursor(state)) }))
  return [{ ...filtered, mode: { kind: "browse" } }, []]
}
