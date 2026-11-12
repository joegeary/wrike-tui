import { withDay } from "../domain/dates"
import { customStatusId, userId, type SpaceId, type TaskId } from "../domain/ids"
import { COLUMN_KEYS, DUE_RANGES, withFilter, withSort, type ColumnKey, type Filter, type ListSpec } from "../domain/list"
import { dueDay, findStatus, IMPORTANCES, permalinkId, startDay, type Importance, type Task, type Workflow } from "../domain/model"
import { assigneePatch, type TaskPatch } from "../domain/patch"
import { scopeKey, taskScopeKind, type Scope, type ScopeKey, type TaskScope } from "../domain/scope"
import { classifyQuery } from "../domain/search"
import { groupRowId, type RowCursor } from "../domain/shape"
import { favoriteKey, moveFavorite, retitleFavorites, toggleFavorite, type Favorite, type SpaceTree } from "../domain/workspace"
import { describeError } from "../wrike/errors"
import { resolveKey } from "./keymap"
import { favoritePath, nodeScope, pathSpace, spacePath, stepCursor, type NavPath, type SelectableNavRow } from "./nav"
import { paletteCommands } from "./palette"
import {
  ANY_DUE,
  currentKey,
  currentList,
  currentView,
  freshView,
  listCursor,
  listRows,
  navCursorRow,
  navRowsOf,
  openTask,
  pickerOptions,
  selectedEntry,
  selectedRow,
  selectedTask,
} from "./selectors"
import {
  EDIT_FIELDS,
  LIST_LIMIT,
  LOAD_AHEAD,
  PANES,
  shown,
  type Action,
  type Effect,
  type Flash,
  type ListPicker,
  type ListView,
  type Loadable,
  type Mode,
  type OpenTarget,
  type Origin,
  type Paged,
  type Pane,
  type PickerField,
  type RequestKey,
  type Result,
  type ScrollTo,
  type SpecChange,
  type State,
  type TaskCommand,
  type TaskPicker,
  type TaskSource,
  type TextField,
  type Update,
} from "./state"

const info = (text: string): Flash => ({ tone: "info", text })
const failure = (text: string): Flash => ({ tone: "error", text })
const clamp = (value: number, count: number) => Math.max(0, Math.min(value, count - 1))
const loading = <T>(from: Loadable<T> | undefined): Loadable<T> => {
  const previous = shown(from)
  return previous === undefined ? { state: "loading" } : { state: "loading", previous }
}
const TODO = scopeKey({ kind: "todo" })

/** Runs `second` on the state `first` produced and joins their effects. */
function then(first: Update, second: (state: State) => Update): Update {
  const [state, effects] = second(first[0])
  return [state, [...first[1], ...effects]]
}

function request(state: State, key: RequestKey): [State, number] {
  const number = (state.requests.get(key) ?? 0) + 1
  return [{ ...state, requests: new Map(state.requests).set(key, number) }, number]
}

const isCurrent = (state: State, key: RequestKey, number: number) => state.requests.get(key) === number

/** The effects that fill the first screen: what the session shows, and fresh copies of everything painted from the cache. */
export function start(state: State): Update {
  let update: Update = [state, [{ kind: "load-reference" }]]
  update = then(update, loadInbox)
  update = then(update, (next) => loadTasks(next, { kind: "todo" }, "first"))
  update = then(update, (next) => loadSpaces(next, shown(next.spaces) === undefined))
  for (const path of state.nav.expanded) {
    const space = pathSpace(path)
    if (space && path === spacePath(space)) update = then(update, (next) => loadTree(next, space))
  }
  const { scope } = state
  if (scope.kind !== "inbox" && scope.kind !== "todo") update = then(update, (next) => loadTasks(next, scope, "first"))
  if (state.openTaskId) {
    const id = state.openTaskId
    update = then(update, (next) => {
      const [opened, effects] = open(next, { kind: "task", id }, null)
      return [{ ...opened, focus: state.focus }, effects]
    })
  }
  return update
}

const BRINGS_TASKS: ReadonlySet<Action["type"]> = new Set(["reference-loaded", "tasks-loaded", "details-loaded", "task-saved"])

export function reduce(state: State, action: Action): Update {
  const [next, effects] = step(state, action)
  if (!BRINGS_TASKS.has(action.type) || !hasUnknownStatus(next)) return [next, effects]
  return [{ ...next, spaceWorkflows: "loading" }, [...effects, { kind: "load-space-workflows" }]]
}

/** True the first time a task on screen has a status the account workflows do not hold: it belongs to a space workflow. */
function hasUnknownStatus(state: State): boolean {
  if (state.spaceWorkflows !== "unloaded" || state.workflows.length === 0) return false
  const opened = openTask(state)
  const tasks = [...(state.lists.get(TODO)?.items ?? []), ...(currentList(state)?.items ?? []), ...(opened ? [opened] : [])]
  return tasks.some((task) => !findStatus(state.workflows, task.statusId))
}

function step(state: State, action: Action): Update {
  switch (action.type) {
    case "key":
      return onKey(state, action.key)

    case "draft": {
      const mode = state.mode
      if (mode.kind === "edit-text") {
        const { error: _cleared, ...rest } = mode
        return [{ ...state, mode: { ...rest, draft: action.text } }, []]
      }
      if (mode.kind === "search-input" || mode.kind === "filter-input" || mode.kind === "compose") return [{ ...state, mode: { ...mode, draft: action.text } }, []]
      return [state, []]
    }

    case "flash":
      return [{ ...state, flash: action.flash }, []]

    case "reference-loaded": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      const { contacts, workflows } = action.result.value
      return [{ ...state, contacts: new Map(contacts.map((contact) => [contact.id, contact])), workflows: mergeWorkflows(workflows, state.workflows) }, []]
    }

    case "space-workflows-loaded": {
      if (!action.result.ok) return [{ ...state, spaceWorkflows: "loaded", flash: failure(describeError(action.result.error)) }, []]
      return [{ ...state, spaceWorkflows: "loaded", workflows: mergeWorkflows(state.workflows, action.result.value) }, []]
    }

    case "inbox-loaded": {
      if (!isCurrent(state, "inbox", action.request)) return [state, []]
      return [{ ...state, clock: action.clock, inbox: settle(state.inbox, action.result) }, []]
    }

    case "tasks-loaded":
      return tasksLoaded(state, action)

    case "spaces-loaded": {
      if (!isCurrent(state, "spaces", action.request)) return [state, []]
      if (action.from === "cache") return action.result.ok ? [{ ...state, spaces: { state: "loading", previous: action.result.value } }, []] : [state, []]
      if (!action.result.ok) return [{ ...state, spaces: settle(state.spaces, action.result), flash: failure(describeError(action.result.error)) }, []]
      const previous = shown(state.spaces)
      // A fetch that matches what is drawn keeps the drawn value, so nothing rebuilds and nothing is written.
      const same = previous !== undefined && JSON.stringify(previous) === JSON.stringify(action.result.value)
      const spaces = same ? previous : action.result.value
      const titles = new Map(spaces.map((space) => [favoriteKey({ kind: "space", id: space.id }), space.title]))
      return retitle({ ...state, spaces: { state: "ready", value: spaces } }, titles, same ? [] : [{ kind: "cache-spaces", spaces }])
    }

    case "tree-loaded": {
      const { space } = action
      if (!isCurrent(state, `tree:${space}`, action.request)) return [state, []]
      const current = state.trees.get(space)
      const put = (tree: Loadable<SpaceTree>) => new Map(state.trees).set(space, tree)
      if (action.from === "cache") return action.result.ok ? [{ ...state, trees: put({ state: "loading", previous: action.result.value }) }, []] : [state, []]
      if (!action.result.ok) return [{ ...state, trees: put(settle(current ?? { state: "idle" }, action.result)), flash: failure(describeError(action.result.error)) }, []]
      const previous = shown(current)
      const same = previous !== undefined && sameTree(previous, action.result.value)
      const tree = same ? previous : action.result.value
      const titles = new Map([...tree.values()].map((node) => [favoriteKey({ kind: "folder", id: node.id }), node.title]))
      return retitle({ ...state, trees: put({ state: "ready", value: tree }) }, titles, same ? [] : [{ kind: "cache-tree", space, tree }])
    }

    case "details-loaded": {
      if (!isCurrent(state, "details", action.request)) return [state, []]
      if (!action.result.ok) {
        const gone = action.result.error.kind === "not_found" && state.openTaskId ? [favoriteKey({ kind: "task", id: state.openTaskId })] : []
        return [{ ...markMissing(state, gone), afterOpen: null, details: { state: "error", error: action.result.error } }, []]
      }
      const details = action.result.value
      const pending = state.afterOpen
      const next: State = { ...state, afterOpen: null, openTaskId: details.task.id, details: { state: "ready", value: details } }
      const retitled = retitle(next, new Map([[favoriteKey({ kind: "task", id: details.task.id }), details.task.title]]), [])
      return pending ? then(retitled, (after) => taskCommand(after, pending, details.task, "browse")) : retitled
    }

    case "task-saved": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      const task = action.result.value
      return retitle({ ...replaceTask(state, task), flash: info(action.done) }, new Map([[favoriteKey({ kind: "task", id: task.id }), task.title]]), [])
    }

    case "comment-added": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      const flashed = { ...state, flash: info("Comment posted") }
      if (state.details.state !== "ready" || state.details.value.task.id !== action.taskId) return [flashed, []]
      const details = { ...state.details.value, comments: [...state.details.value.comments, action.result.value] }
      return [{ ...flashed, details: { state: "ready", value: details } }, [{ kind: "scroll", pane: "details", to: "bottom" }]]
    }

    case "focus":
      return focusPane(state, action.pane === "left" ? PANES.indexOf(state.focus) - 1 : action.pane === "right" ? PANES.indexOf(state.focus) + 1 : PANES.indexOf(action.pane))
    case "show":
      return showScope(state, action.scope, "list")
    case "search":
      return [{ ...state, focus: "list", zoom: false, mode: { kind: "search-input", draft: "" } }, []]
    case "refresh":
      return refresh(state)
    case "zoom":
      return [{ ...state, zoom: !state.zoom, focus: state.zoom ? state.focus : "details" }, []]
    case "help":
      return [{ ...state, mode: { kind: "help" } }, []]
    case "palette":
      return [{ ...state, mode: { kind: "palette", query: "", cursor: 0 } }, []]
    case "quit":
      return [state, [{ kind: "quit" }]]

    case "nav-move":
      return [{ ...state, nav: { ...state.nav, cursor: stepCursor(navRowsOf(state), state.nav.cursor, action.by) } }, []]
    case "nav-open":
      return navOpen(state)
    case "nav-toggle":
      return navToggle(state)
    case "favorite":
      return favorite(state)
    case "favorite-move": {
      const row = navCursorRow(state)
      if (row?.kind !== "favorite") return [state, []]
      const favorites = moveFavorite(state.favorites, favoriteKey(row.favorite), action.by)
      return favorites === state.favorites ? [state, []] : [{ ...state, favorites }, [{ kind: "save-favorites", favorites }]]
    }

    case "move":
      return moveCursor(state, action.to)
    case "open":
      return openRow(state)
    case "toggle-row":
      return toggleRow(state)
    case "toggle-read": {
      const includeRead = !state.includeRead
      const flash = info(includeRead ? "Showing read notifications too" : "Showing unread notifications only")
      return loadInbox(withView({ ...state, includeRead, flash }, (view) => ({ ...view, cursor: null })))
    }
    case "filter-text": {
      const current = currentView(state).spec.filters.find((filter) => filter.kind === "text")
      return [{ ...state, mode: { kind: "filter-input", draft: current?.query ?? "" } }, []]
    }
    case "spec":
      return changeSpec(state, action.change)
    case "pick":
      return [{ ...state, mode: listPicker(state, action.field) }, []]
    case "expand-all": {
      const parents = (currentList(state)?.items ?? []).filter((task) => task.subTaskIds.length > 0).map((task) => task.id)
      return [withView(state, (view) => ({ ...view, collapsed: new Set(), expanded: new Set(parents) })), []]
    }
    case "collapse-all": {
      const groups = listRows(state).flatMap((row) => (row.kind === "group" && row.depth === 0 ? [row.key] : []))
      const closed = withView(state, (view) => ({ ...view, collapsed: new Set(groups), expanded: new Set() }))
      // The cursor's row is hidden now, so it lands on the group that held it.
      return [withView(closed, (view) => ({ ...view, cursor: cursorAt(closed, listCursor(closed)) })), []]
    }

    case "scroll":
      return [state, [{ kind: "scroll", pane: action.pane, to: action.to }]]
    case "task":
      return onTask(state, action.command)
    case "link":
      return onLink(state, action.act)

    case "field-move":
      return state.mode.kind === "edit" ? [{ ...state, mode: { kind: "edit", field: clamp(state.mode.field + action.by, EDIT_FIELDS.length) } }, []] : [state, []]
    case "field-open":
      return openField(state)
    case "choice-move":
      return moveChoice(state, action.by)
    case "choice-toggle": {
      const mode = state.mode
      if (mode.kind !== "picker") return [state, []]
      const option = pickerOptions(state, mode)[mode.cursor]
      if (!option) return [state, []]
      const chosen = mode.chosen.includes(option.id) ? mode.chosen.filter((id) => id !== option.id) : [...mode.chosen, option.id]
      return [{ ...state, mode: { ...mode, chosen } }, []]
    }
    case "erase":
      return state.mode.kind === "picker" || state.mode.kind === "palette"
        ? [{ ...state, mode: { ...state.mode, query: state.mode.query.slice(0, -1), cursor: 0 } }, []]
        : [state, []]
    case "compose-editor": {
      const task = openTask(state)
      if (state.mode.kind !== "compose" || !task) return [state, []]
      return [{ ...state, mode: { kind: "browse" } }, [{ kind: "compose-in-editor", taskId: task.id, draft: state.mode.draft }]]
    }
    case "submit":
      return submit(state)
    case "cancel":
      return cancel(state)

    case "theme":
      return [{ ...state, settings: { ...state.settings, theme: action.name } }, []]
    case "save-defaults":
      return saveDefaults(state)
  }
}

/** Fresh workflows replace the ones held under the same ID, and the rest are kept after them. */
function mergeWorkflows(first: Workflow[], rest: Workflow[]): Workflow[] {
  const ids = new Set(first.map((workflow) => workflow.id))
  return [...first, ...rest.filter((workflow) => !ids.has(workflow.id))]
}

function sameTree(a: SpaceTree, b: SpaceTree): boolean {
  if (a.size !== b.size) return false
  for (const [id, node] of a) {
    const other = b.get(id)
    if (!other || JSON.stringify(node) !== JSON.stringify(other)) return false
  }
  return true
}

function settle<T>(current: Loadable<T>, result: Result<T>): Loadable<T> {
  if (result.ok) return { state: "ready", value: result.value }
  const previous = shown(current)
  return previous === undefined ? { state: "error", error: result.error } : { state: "error", error: result.error, previous }
}

/** Refreshes favorite titles from what was just seen, and saves them when one changed. */
function retitle(state: State, titles: ReadonlyMap<string, string>, effects: Effect[]): Update {
  const favorites = retitleFavorites(state.favorites, titles)
  const found = [...state.missing].filter((key) => titles.has(key))
  const missing = found.length > 0 ? new Set([...state.missing].filter((key) => !titles.has(key))) : state.missing
  if (favorites === state.favorites) return [{ ...state, missing }, effects]
  return [{ ...state, favorites, missing }, [...effects, { kind: "save-favorites", favorites }]]
}

function markMissing(state: State, keys: string[]): State {
  const favorites = new Set(state.favorites.map(favoriteKey))
  const gone = keys.filter((key) => favorites.has(key) && !state.missing.has(key))
  return gone.length === 0 ? state : { ...state, missing: new Set([...state.missing, ...gone]) }
}

/** Changes the current scope's view, creating it with the config defaults when the scope is new. */
function withView(state: State, change: (view: ListView) => ListView): State {
  return { ...state, views: new Map(state.views).set(currentKey(state), change(currentView(state))) }
}

const cursorAt = (state: State, index: number): RowCursor | null => {
  const row = listRows(state)[index]
  return row ? { id: row.id, index } : null
}

/** Stores a list as the most recently shown, and drops the oldest past the limit. My to-do and the current scope always stay. */
function putList(state: State, key: ScopeKey, list: Paged<Task>): State {
  const lists = new Map(state.lists)
  lists.delete(key)
  lists.set(key, list)
  const keep = new Set<ScopeKey>([TODO, key, currentKey(state)])
  for (const candidate of lists.keys()) {
    if (lists.size <= LIST_LIMIT) break
    if (!keep.has(candidate)) lists.delete(candidate)
  }
  return { ...state, lists }
}

function taskSource(state: State, scope: TaskScope): TaskSource {
  switch (scope.kind) {
    case "todo":
      return { kind: "mine", user: state.profile.userId }
    case "search": {
      const query = classifyQuery(scope.query)
      return query.kind === "title" ? { kind: "title", text: query.text } : query
    }
    case "space":
    case "folder":
      return { kind: scope.kind, id: scope.id } as TaskSource
  }
}

function loadInbox(state: State): Update {
  const [next, number] = request(state, "inbox")
  return [{ ...next, inbox: loading(state.inbox) }, [{ kind: "load-inbox", request: number, includeRead: state.includeRead }]]
}

function loadTasks(state: State, scope: TaskScope, page: "first" | "more"): Update {
  const key = scopeKey(scope)
  const list = state.lists.get(key)
  if (page === "more" && (!list || list.next === null || list.loading !== null)) return [state, []]
  const view = state.views.get(key) ?? freshView(state, scope)
  const [next, number] = request(state, `list:${key}`)
  const pending: Paged<Task> = { items: list?.items ?? [], next: list?.next ?? null, loading: page, error: null }
  return [
    putList({ ...next, views: new Map(next.views).set(key, view) }, key, pending),
    [{ kind: "load-tasks", request: number, key, source: taskSource(state, scope), completed: view.spec.completed, pageToken: page === "more" ? list!.next : null }],
  ]
}

function loadSpaces(state: State, cached: boolean): Update {
  const [next, number] = request(state, "spaces")
  return [{ ...next, spaces: loading(state.spaces) }, [{ kind: "load-spaces", request: number, cached }]]
}

function loadTree(state: State, space: SpaceId): Update {
  const current = state.trees.get(space)
  const [next, number] = request(state, `tree:${space}`)
  // The cache is read only when nothing is drawn yet. A reload already has the tree on screen.
  return [{ ...next, trees: new Map(state.trees).set(space, loading(current)) }, [{ kind: "load-tree", request: number, space, cached: shown(current) === undefined }]]
}

function tasksLoaded(state: State, action: Action & { type: "tasks-loaded" }): Update {
  const { key } = action
  const list = state.lists.get(key)
  if (!list || !isCurrent(state, `list:${key}`, action.request)) return [state, []]
  if (!action.result.ok) {
    const failed = putList(state, key, { ...list, loading: null, error: action.result.error })
    return [action.result.error.kind === "not_found" ? markMissing(failed, [key]) : failed, []]
  }
  const { tasks, next } = action.result.value
  const known = new Set(action.more ? list.items.map((task) => task.id) : [])
  const items = action.more ? [...list.items, ...tasks.filter((task) => !known.has(task.id))] : tasks
  const loaded = putList({ ...state, clock: action.clock }, key, { items, next, loading: null, error: null })
  const titles = new Map(tasks.map((task) => [favoriteKey({ kind: "task", id: task.id }), task.title]))
  const [only] = tasks
  return then(retitle(loaded, titles, []), (after) => (action.jump && only ? open(after, { kind: "task", id: only.id }, null) : [after, []]))
}

/** Shows a scope in the list pane. A list seen before is drawn at once and fetched again behind it. */
function showScope(state: State, scope: Scope, focus: Pane): Update {
  const key = scopeKey(scope)
  const views = state.views.has(key) ? state.views : new Map(state.views).set(key, freshView(state, scope))
  const next: State = { ...state, scope, focus, zoom: false, views, lastSearch: scope.kind === "search" ? scope.query : state.lastSearch }
  if (scope.kind === "inbox") return next.inbox.state === "idle" ? loadInbox(next) : [next, []]
  const list = next.lists.get(key)
  return list?.loading ? [putList(next, key, list), []] : loadTasks(next, scope, "first")
}

function refresh(state: State): Update {
  let update: Update = [state, [{ kind: "load-reference" }]]
  update = then(update, (next) => loadSpaces(next, false))
  for (const [space, tree] of state.trees) {
    if (state.nav.expanded.has(spacePath(space)) && tree.state !== "loading") update = then(update, (next) => loadTree(next, space))
  }
  const { scope } = state
  update = then(update, (next) => (scope.kind === "inbox" ? loadInbox(next) : loadTasks(next, scope, "first")))
  if (!state.openTaskId) return update
  const id = state.openTaskId
  return then(update, (next) => {
    const [opened, effects] = open(next, { kind: "task", id }, null)
    return [{ ...opened, focus: state.focus }, effects]
  })
}

/** Puts a saved task everywhere it is listed. A list of active tasks loses one that is closed, and My to-do gains one that became mine. */
function replaceTask(state: State, task: Task): State {
  const mine = task.assigneeIds.includes(state.profile.userId)
  const lists = new Map(state.lists)
  for (const [key, list] of lists) {
    const completed = state.views.get(key)?.spec.completed ?? false
    const belongs = (completed || task.statusGroup === "Active") && (key !== TODO || mine)
    const held = list.items.some((candidate) => candidate.id === task.id)
    if (!held && !(key === TODO && belongs)) continue
    const swapped = held ? list.items.map((candidate) => (candidate.id === task.id ? task : candidate)) : [...list.items, task]
    lists.set(key, { ...list, items: belongs ? swapped : swapped.filter((candidate) => candidate.id !== task.id) })
  }
  const details =
    state.details.state === "ready" && state.details.value.task.id === task.id
      ? ({ state: "ready", value: { ...state.details.value, task } } as const)
      : state.details
  return { ...state, details, lists }
}

function onKey(state: State, key: string): Update {
  const command = resolveKey(state, key)
  if (command) {
    const cleared = { ...state, flash: null }
    return step(cleared, command.run(cleared))
  }
  // Typing in a picker or the palette filters it. Every other text is typed into an input, which reports through "draft".
  if ((state.mode.kind === "picker" || state.mode.kind === "palette") && [...key].length === 1) {
    return [{ ...state, mode: { ...state.mode, query: state.mode.query + key, cursor: 0 } }, []]
  }
  return [state, []]
}

function open(state: State, target: OpenTarget, after: TaskCommand | null): Update {
  const [next, number] = request(state, "details")
  const sameTask = target.kind === "task" && target.id === state.openTaskId
  return [
    {
      ...next,
      openTaskId: target.kind === "task" ? target.id : null,
      details: sameTask ? loading(state.details) : { state: "loading" },
      afterOpen: after,
      focus: after ? state.focus : "details",
    },
    [{ kind: "load-details", request: number, target }],
  ]
}

function focusPane(state: State, index: number): Update {
  const focus = PANES[Math.max(0, Math.min(index, PANES.length - 1))]!
  return [{ ...state, focus, zoom: state.zoom && focus === "details" }, []]
}

function navOpen(state: State): Update {
  const row = navCursorRow(state)
  if (!row) return [state, []]
  const here = { ...state, nav: { ...state.nav, cursor: row.path } }
  switch (row.kind) {
    case "view":
      if (row.view !== "search") return showScope(here, { kind: row.view }, "list")
      return state.lastSearch === "" ? step(here, { type: "search" }) : showScope(here, { kind: "search", query: state.lastSearch }, "list")
    case "favorite": {
      const { favorite } = row
      if (favorite.kind === "task") return open(here, { kind: "task", id: favorite.id }, null)
      return showScope(here, favorite.kind === "space" ? { kind: "space", id: favorite.id, title: favorite.title } : { ...favorite }, "list")
    }
    case "node":
      // The focus stays in the tree, so the next folder down is one more Enter away.
      return then(row.expandable ? setExpanded(here, row, true) : [here, []], (next) => showScope(next, nodeScope(row), "nav"))
  }
}

function setExpanded(state: State, row: SelectableNavRow & { kind: "node" }, open: boolean): Update {
  const expanded = new Set(state.nav.expanded)
  if (open) expanded.add(row.path)
  else expanded.delete(row.path)
  const next = { ...state, nav: { ...state.nav, expanded } }
  const space = row.depth === 0 ? pathSpace(row.path) : null
  return open && space && !state.trees.has(space) ? loadTree(next, space) : [next, []]
}

function navToggle(state: State): Update {
  const row = navCursorRow(state)
  if (row?.kind !== "node" || !row.expandable) return [state, []]
  return setExpanded({ ...state, nav: { ...state.nav, cursor: row.path } }, row, !state.nav.expanded.has(row.path))
}

/** What `F` acts on: the nav row under the cursor, the selected task, or the open task. */
function favoriteTarget(state: State): Favorite | string {
  if (state.focus === "nav") {
    const row = navCursorRow(state)
    if (row?.kind === "favorite") return row.favorite
    return row?.kind === "node" ? nodeScope(row) : "Only a space, a folder, a project or a task can be a favorite"
  }
  const opened = openTask(state)
  if (state.focus === "details") return opened ? { kind: "task", id: opened.id, title: opened.title } : "No task is open"
  const task = selectedTask(state)
  if (task) return { kind: "task", id: task.id, title: task.title }
  const item = selectedEntry(state)?.item
  if (item && opened?.permalink === item.permalink) return { kind: "task", id: opened.id, title: opened.title }
  return item ? "Open the task first, then press F" : "Select a task first"
}

function favorite(state: State): Update {
  const target = favoriteTarget(state)
  if (typeof target === "string") return [{ ...state, flash: info(target) }, []]
  const key = favoriteKey(target)
  const favorites = toggleFavorite(state.favorites, target)
  const removed = favorites.length < state.favorites.length
  // A cursor on the favorite that goes away steps to its neighbour instead of jumping to the top.
  const path = favoritePath(target)
  const rows = navRowsOf(state)
  const below = stepCursor(rows, path, 1)
  const neighbour = below.startsWith("fav:") && below !== path ? below : stepCursor(rows, path, -1)
  const cursor: NavPath = removed && state.nav.cursor === path ? neighbour : state.nav.cursor
  return [
    {
      ...state,
      favorites,
      nav: { ...state.nav, cursor },
      missing: removed ? new Set([...state.missing].filter((candidate) => candidate !== key)) : state.missing,
      flash: info(removed ? `Removed ${target.title} from the favorites` : `Added ${target.title} to the favorites`),
    },
    [{ kind: "save-favorites", favorites }],
  ]
}

function moveCursor(state: State, to: ScrollTo): Update {
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

function openRow(state: State): Update {
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

function toggleRow(state: State): Update {
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

function changeSpec(state: State, change: SpecChange): Update {
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

function listPicker(state: State, field: ListPicker): Mode {
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

/** What a task key acts on: the open task, a row that must be opened first, or nothing. */
type TaskTarget = { kind: "open"; task: Task } | { kind: "closed"; target: OpenTarget } | { kind: "none"; why?: string }

function taskTarget(state: State): TaskTarget {
  const opened = openTask(state)
  if (state.focus === "details") return opened ? { kind: "open", task: opened } : { kind: "none" }
  if (state.scope.kind === "inbox") {
    const item = selectedEntry(state)?.item
    if (!item) return { kind: "none" }
    if (item.baseType !== "TASK") return { kind: "none", why: "Only tasks can be edited here" }
    return opened?.permalink === item.permalink ? { kind: "open", task: opened } : { kind: "closed", target: { kind: "legacy", id: item.legacyId } }
  }
  const row = selectedTask(state)
  if (!row) return { kind: "none" }
  return opened?.id === row.id ? { kind: "open", task: opened } : { kind: "closed", target: { kind: "task", id: row.id } }
}

function onTask(state: State, command: TaskCommand): Update {
  const target = taskTarget(state)
  switch (target.kind) {
    case "open":
      return taskCommand(state, command, target.task, "browse")
    case "closed":
      return open(state, target.target, command)
    case "none":
      return [target.why ? { ...state, flash: info(target.why) } : state, []]
  }
}

function taskPicker(state: State, task: Task, field: TaskPicker, origin: Origin): Mode {
  const mode: Mode & { kind: "picker" } = {
    kind: "picker",
    field,
    query: "",
    cursor: 0,
    chosen: field === "assignees" ? [...task.assigneeIds] : [],
    origin,
  }
  const current = field === "status" ? task.statusId : field === "importance" ? task.importance : null
  const index = pickerOptions(state, mode).findIndex((option) => option.id === current)
  return { ...mode, cursor: Math.max(0, index) }
}

function textField(task: Task, field: TextField, origin: Origin): Mode {
  const draft = field === "title" ? task.title : ((field === "start" ? startDay(task.dates) : dueDay(task.dates)) ?? "")
  return { kind: "edit-text", field, draft, origin }
}

function taskCommand(state: State, command: TaskCommand, task: Task, origin: Origin): Update {
  switch (command) {
    case "edit":
      return [{ ...state, mode: { kind: "edit", field: 0 } }, []]
    case "status":
    case "importance":
    case "assignees":
      return [{ ...state, mode: taskPicker(state, task, command, origin) }, []]
    case "assign-me":
      if (task.assigneeIds.includes(state.profile.userId)) return [{ ...state, flash: info("Already assigned to you") }, []]
      return save(state, task.id, { field: "assignees", add: [state.profile.userId], remove: [] }, "Assigned to you")
    case "comment":
      return [{ ...state, mode: { kind: "compose", draft: "" } }, []]
    case "description":
      return [state, [{ kind: "edit-description", task }]]
  }
}

function save(state: State, taskId: TaskId, patch: TaskPatch, done: string): Update {
  return [{ ...state, flash: info("Saving...") }, [{ kind: "update-task", taskId, patch, done }]]
}

function closeEditor(state: State, origin: Origin, field: PickerField | TextField): State {
  const edited = EDIT_FIELDS.findIndex((candidate) => candidate === field)
  return { ...state, mode: origin === "edit" && edited >= 0 ? { kind: "edit", field: edited } : { kind: "browse" } }
}

function onLink(state: State, act: "browser" | "copy-url" | "copy-id"): Update {
  const url = state.focus === "details" ? openTask(state)?.permalink : state.scope.kind === "inbox" ? selectedEntry(state)?.item?.permalink : selectedTask(state)?.permalink
  if (!url) return [{ ...state, flash: info("Nothing is selected") }, []]
  if (act === "browser") return [{ ...state, flash: info("Opening in the browser") }, [{ kind: "open-url", url }]]
  if (act === "copy-url") return [{ ...state, flash: info("Copied the URL") }, [{ kind: "copy", text: url }]]
  const id = permalinkId(url)
  return id ? [{ ...state, flash: info(`Copied the ID ${id}`) }, [{ kind: "copy", text: id }]] : [{ ...state, flash: info("This item has no ID") }, []]
}

function openField(state: State): Update {
  const task = openTask(state)
  if (state.mode.kind !== "edit" || !task) return [state, []]
  const field = EDIT_FIELDS[state.mode.field]!
  switch (field) {
    case "title":
    case "start":
    case "due":
      return [{ ...state, mode: textField(task, field, "edit") }, []]
    case "status":
    case "importance":
    case "assignees":
    case "description":
      return taskCommand(state, field, task, "edit")
  }
}

function moveChoice(state: State, by: number): Update {
  const { mode } = state
  if (mode.kind === "picker") return [{ ...state, mode: { ...mode, cursor: clamp(mode.cursor + by, pickerOptions(state, mode).length) } }, []]
  if (mode.kind === "palette") return [{ ...state, mode: { ...mode, cursor: clamp(mode.cursor + by, paletteCommands(state, mode.query).length) } }, []]
  return [state, []]
}

function submitListPicker(state: State, mode: Mode & { kind: "picker" }, field: ListPicker): Update {
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

function submit(state: State): Update {
  const mode = state.mode
  const task = openTask(state)
  switch (mode.kind) {
    case "search-input": {
      const query = mode.draft.trim()
      if (query === "") return [{ ...state, mode: { kind: "browse" } }, []]
      return showScope({ ...state, mode: { kind: "browse" } }, { kind: "search", query }, "list")
    }
    case "filter-input": {
      const query = mode.draft.trim()
      const { spec } = currentView(state)
      const filtered = withView(state, (view) => ({ ...view, spec: withFilter(spec, "text", query === "" ? null : { kind: "text", query }), cursor: cursorAt(state, listCursor(state)) }))
      return [{ ...filtered, mode: { kind: "browse" } }, []]
    }
    case "palette": {
      const command = paletteCommands(state, mode.query)[mode.cursor]
      const closed: State = { ...state, mode: { kind: "browse" } }
      return command ? step(closed, command.run(closed)) : [closed, []]
    }
    case "compose": {
      const text = mode.draft.trim()
      if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
      if (text === "") return [{ ...state, flash: failure("Write the comment first, or press Esc to discard") }, []]
      return [{ ...state, mode: { kind: "browse" }, flash: info("Posting the comment...") }, [{ kind: "add-comment", taskId: task.id, text }]]
    }
    case "edit-text": {
      if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
      const closed = closeEditor(state, mode.origin, mode.field)
      if (mode.field === "title") {
        const title = mode.draft.trim()
        if (title === "") return [{ ...state, mode: { ...mode, error: "A title cannot be empty" } }, []]
        return title === task.title ? [closed, []] : save(closed, task.id, { field: "title", title }, "Title saved")
      }
      const result = withDay(task.dates, mode.field, mode.draft)
      if (!result.ok) return [{ ...state, mode: { ...mode, error: result.message } }, []]
      const [before, after] = [JSON.stringify(task.dates), JSON.stringify(result.dates)]
      const name = mode.field === "start" ? "Start date" : "Due date"
      const done = mode.draft.trim() === "" ? `${name} cleared` : `${name} set to ${mode.draft.trim()}`
      return before === after ? [closed, []] : save(closed, task.id, { field: "dates", dates: result.dates }, done)
    }
    case "picker": {
      const { field } = mode
      if (field !== "status" && field !== "importance" && field !== "assignees") return submitListPicker(state, mode, field)
      if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
      const closed = closeEditor(state, mode.origin, field)
      if (field === "assignees") {
        const patch = assigneePatch(task.assigneeIds, mode.chosen.map(userId))
        return patch.add.length + patch.remove.length === 0 ? [closed, []] : save(closed, task.id, patch, "Assignees updated")
      }
      const option = pickerOptions(state, mode)[mode.cursor]
      if (!option) return [state, []]
      if (field === "status") {
        return option.id === task.statusId
          ? [closed, []]
          : save(closed, task.id, { field: "status", statusId: customStatusId(option.id) }, `Status set to ${option.label}`)
      }
      const importance = IMPORTANCES.find((candidate): candidate is Importance => candidate === option.id)
      return !importance || importance === task.importance
        ? [closed, []]
        : save(closed, task.id, { field: "importance", importance }, `Importance set to ${importance}`)
    }
    case "browse":
    case "edit":
    case "help":
      return [state, []]
  }
}

function cancel(state: State): Update {
  const mode = state.mode
  if (mode.kind === "edit-text" || mode.kind === "picker") return [closeEditor(state, mode.origin, mode.field), []]
  return [{ ...state, mode: { kind: "browse" } }, []]
}

/** Writes the config file: the theme in use, and this list's shaping as the default for scopes of its kind. */
function saveDefaults(state: State): Update {
  const { scope } = state
  const lists = scope.kind === "inbox" ? state.settings.lists : { ...state.settings.lists, [taskScopeKind(scope)]: currentView(state).spec }
  const settings = { ...state.settings, lists }
  const what = scope.kind === "inbox" ? "the theme" : "the theme and this list's shaping"
  return [{ ...state, settings, flash: info(`Saved ${what} as the default`) }, [{ kind: "save-config", settings }]]
}
