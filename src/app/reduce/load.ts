import type { HistoryEntry } from "../../domain/history"
import { legacyItemId, type SpaceId } from "../../domain/ids"
import { permalinkId, type Task, type Workflow } from "../../domain/model"
import { scopeKey, type Scope, type ScopeKey, type TaskScope } from "../../domain/scope"
import { classifyQuery } from "../../domain/search"
import { favoriteKey, type SpaceTree } from "../../domain/workspace"
import { describeError } from "../../wrike/errors"
import { pathSpace, spacePath } from "../nav"
import { currentKey, freshView, openTask } from "../selectors"
import {
  LIST_LIMIT,
  shown,
  type Action,
  type Loadable,
  type OpenTarget,
  type Paged,
  type Pane,
  type RequestKey,
  type Result,
  type State,
  type TaskCommand,
  type TaskSource,
  type Update,
} from "../state"
import { failure, markMissing, retitle, then, TODO } from "./core"

export const loading = <T>(from: Loadable<T> | undefined): Loadable<T> => {
  const previous = shown(from)
  return previous === undefined ? { state: "loading" } : { state: "loading", previous }
}

export function request(state: State, key: RequestKey): [State, number] {
  const number = (state.requests.get(key) ?? 0) + 1
  return [{ ...state, requests: new Map(state.requests).set(key, number) }, number]
}

export const isCurrent = (state: State, key: RequestKey, number: number) => state.requests.get(key) === number

/** Fresh workflows replace the ones held under the same ID, and the rest are kept after them. */
export function mergeWorkflows(first: Workflow[], rest: Workflow[]): Workflow[] {
  const ids = new Set(first.map((workflow) => workflow.id))
  return [...first, ...rest.filter((workflow) => !ids.has(workflow.id))]
}

export function sameTree(a: SpaceTree, b: SpaceTree): boolean {
  if (a.size !== b.size) return false
  for (const [id, node] of a) {
    const other = b.get(id)
    if (!other || JSON.stringify(node) !== JSON.stringify(other)) return false
  }
  return true
}

export function settle<T>(current: Loadable<T>, result: Result<T>): Loadable<T> {
  if (result.ok) return { state: "ready", value: result.value }
  const previous = shown(current)
  return previous === undefined ? { state: "error", error: result.error } : { state: "error", error: result.error, previous }
}

/** Stores a list as the most recently shown, and drops the oldest past the limit. My to-do and the current scope always stay. */
export function putList(state: State, key: ScopeKey, list: Paged<Task>): State {
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

export function taskSource(state: State, scope: TaskScope): TaskSource {
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

export function loadInbox(state: State): Update {
  const [next, number] = request(state, "inbox")
  return [{ ...next, inbox: loading(state.inbox) }, [{ kind: "load-inbox", request: number, includeRead: state.includeRead }]]
}

export function loadTasks(state: State, scope: TaskScope, page: "first" | "more"): Update {
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

export function loadSpaces(state: State, cached: boolean): Update {
  const [next, number] = request(state, "spaces")
  return [{ ...next, spaces: loading(state.spaces) }, [{ kind: "load-spaces", request: number, cached }]]
}

export function loadTree(state: State, space: SpaceId): Update {
  const current = state.trees.get(space)
  const [next, number] = request(state, `tree:${space}`)
  // The cache is read only when nothing is drawn yet. A reload already has the tree on screen.
  return [{ ...next, trees: new Map(state.trees).set(space, loading(current)) }, [{ kind: "load-tree", request: number, space, cached: shown(current) === undefined }]]
}

export function open(state: State, target: OpenTarget, after: TaskCommand | null): Update {
  const [next, number] = request(state, "details")
  const sameTask = target.kind === "task" && target.id === state.openTaskId
  return [
    {
      ...next,
      openTaskId: target.kind === "task" ? target.id : null,
      details: sameTask ? loading(state.details) : { state: "loading" },
      selected: sameTask ? state.selected : null,
      afterOpen: after,
      focus: after ? state.focus : "details",
    },
    [{ kind: "load-details", request: number, target }],
  ]
}

/** Whether showing the task's history should fetch it: only the first time. After a failure, r asks again. */
export const needsHistory = (held: Paged<HistoryEntry> | undefined) => held === undefined

/** Fetches the newest page of a task's history again, or the page older than what is held. What is held stays drawn meanwhile. */
export function loadHistory(state: State, task: Task, page: "first" | "more"): Update {
  const item = legacyItemId(permalinkId(task.permalink) ?? "")
  const held = state.histories.get(task.id)
  if (!item || (page === "more" && (!held || held.next === null || held.loading !== null))) return [state, []]
  const [next, number] = request(state, `history:${task.id}`)
  const pending: Paged<HistoryEntry> = { items: held?.items ?? [], next: held?.next ?? null, loading: page, error: null }
  return [
    { ...next, histories: new Map(next.histories).set(task.id, pending) },
    [{ kind: "load-history", request: number, taskId: task.id, item, pageToken: page === "more" ? held!.next : null }],
  ]
}

export function historyLoaded(state: State, action: Action & { type: "history-loaded" }): Update {
  const held = state.histories.get(action.taskId)
  if (!held || !isCurrent(state, `history:${action.taskId}`, action.request)) return [state, []]
  const page: Paged<HistoryEntry> = action.result.ok
    ? { items: action.more ? [...held.items, ...action.result.value.entries] : action.result.value.entries, next: action.result.value.next, loading: null, error: null }
    : { ...held, loading: null, error: action.result.error }
  return [{ ...state, histories: new Map(state.histories).set(action.taskId, page) }, []]
}

/** Shows a scope in the list pane. A list seen before is drawn at once and fetched again behind it. */
export function showScope(state: State, scope: Scope, focus: Pane): Update {
  const key = scopeKey(scope)
  const views = state.views.has(key) ? state.views : new Map(state.views).set(key, freshView(state, scope))
  const next: State = { ...state, scope, focus, zoom: false, views, lastSearch: scope.kind === "search" ? scope.query : state.lastSearch }
  if (scope.kind === "inbox") return next.inbox.state === "idle" ? loadInbox(next) : [next, []]
  const list = next.lists.get(key)
  return list?.loading ? [putList(next, key, list), []] : loadTasks(next, scope, "first")
}

export function refresh(state: State): Update {
  let update: Update = [state, [{ kind: "load-reference" }]]
  update = then(update, (next) => loadSpaces(next, false))
  for (const [space, tree] of state.trees) {
    if (state.nav.expanded.has(spacePath(space)) && tree.state !== "loading") update = then(update, (next) => loadTree(next, space))
  }
  const { scope } = state
  update = then(update, (next) => (scope.kind === "inbox" ? loadInbox(next) : loadTasks(next, scope, "first")))
  if (!state.openTaskId) return update
  const id = state.openTaskId
  update = then(update, (next) => {
    const [opened, effects] = open(next, { kind: "task", id }, null)
    return [{ ...opened, focus: state.focus }, effects]
  })
  const task = openTask(state)
  return state.settings.history && task ? then(update, (next) => loadHistory(next, task, "first")) : update
}

export function tasksLoaded(state: State, action: Action & { type: "tasks-loaded" }): Update {
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

export function referenceLoaded(state: State, action: Action & { type: "reference-loaded" }): Update {
  if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
  const { contacts, workflows } = action.result.value
  return [{ ...state, contacts: new Map(contacts.map((contact) => [contact.id, contact])), workflows: mergeWorkflows(workflows, state.workflows) }, []]
}

export function spaceWorkflowsLoaded(state: State, action: Action & { type: "space-workflows-loaded" }): Update {
  if (!action.result.ok) return [{ ...state, spaceWorkflows: "loaded", flash: failure(describeError(action.result.error)) }, []]
  return [{ ...state, spaceWorkflows: "loaded", workflows: mergeWorkflows(state.workflows, action.result.value) }, []]
}

export function inboxLoaded(state: State, action: Action & { type: "inbox-loaded" }): Update {
  if (!isCurrent(state, "inbox", action.request)) return [state, []]
  return [{ ...state, clock: action.clock, inbox: settle(state.inbox, action.result) }, []]
}

export function spacesLoaded(state: State, action: Action & { type: "spaces-loaded" }): Update {
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

export function treeLoaded(state: State, action: Action & { type: "tree-loaded" }): Update {
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
