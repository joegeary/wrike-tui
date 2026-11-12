import { withDay } from "../domain/dates"
import { customStatusId, userId, type TaskId } from "../domain/ids"
import { dueDay, findStatus, IMPORTANCES, permalinkId, startDay, type Importance, type Task } from "../domain/model"
import { assigneePatch, type TaskPatch } from "../domain/patch"
import { classifyQuery } from "../domain/search"
import { describeError } from "../wrike/errors"
import { resolveKey, type Command, type TaskCommand } from "./keymap"
import { itemCount, openTask, pickerOptions, selectedEntry, selectedTask } from "./selectors"
import {
  EDIT_FIELDS,
  PANES,
  shown,
  VIEWS,
  type Action,
  type Effect,
  type Flash,
  type Loadable,
  type Mode,
  type OpenTarget,
  type Origin,
  type PickerField,
  type Result,
  type State,
  type TextField,
  type Update,
  type View,
} from "./state"

const info = (text: string): Flash => ({ tone: "info", text })
const failure = (text: string): Flash => ({ tone: "error", text })
const clamp = (value: number, count: number) => Math.max(0, Math.min(value, count - 1))
const loading = <T>(from: Loadable<T>): Loadable<T> => {
  const previous = shown(from)
  return previous === undefined ? { state: "loading" } : { state: "loading", previous }
}

/** The effects that fill the first screen. */
export function start(state: State): Update {
  const [withInbox, inbox] = loadList(state, "inbox")
  const [withTodo, todo] = loadList(withInbox, "todo")
  return [withTodo, [{ kind: "load-reference" }, ...inbox, ...todo]]
}

export function reduce(state: State, action: Action): Update {
  switch (action.type) {
    case "key":
      return onKey(state, action.key)

    case "draft": {
      const mode = state.mode
      if (mode.kind === "edit-text") {
        const { error: _cleared, ...rest } = mode
        return [{ ...state, mode: { ...rest, draft: action.text } }, []]
      }
      if (mode.kind === "search-input" || mode.kind === "compose") return [{ ...state, mode: { ...mode, draft: action.text } }, []]
      return [state, []]
    }

    case "flash":
      return [{ ...state, flash: action.flash }, []]

    case "reference-loaded": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      const { contacts, workflows } = action.result.value
      return [{ ...state, contacts: new Map(contacts.map((contact) => [contact.id, contact])), workflows: [...workflows, ...state.workflows] }, []]
    }

    case "space-workflows-loaded": {
      if (!action.result.ok) return [{ ...state, spaceWorkflows: "loaded", flash: failure(describeError(action.result.error)) }, []]
      const known = new Set(state.workflows.map((workflow) => workflow.id))
      const added = action.result.value.filter((workflow) => !known.has(workflow.id))
      return [{ ...state, spaceWorkflows: "loaded", workflows: [...state.workflows, ...added] }, []]
    }

    case "inbox-loaded": {
      if (action.request !== state.requests.inbox) return [state, []]
      return [listed({ ...state, clock: action.clock, lists: { ...state.lists, inbox: settle(state.lists.inbox, action.result) } }, "inbox"), []]
    }

    case "todo-loaded": {
      if (action.request !== state.requests.todo) return [state, []]
      return [listed({ ...state, clock: action.clock, lists: { ...state.lists, todo: settle(state.lists.todo, action.result) } }, "todo"), []]
    }

    case "search-loaded": {
      if (action.request !== state.requests.search) return [state, []]
      const next = { ...state, lists: { ...state.lists, search: settle(state.lists.search, action.result) }, cursor: { ...state.cursor, search: 0 } }
      const [only] = action.result.ok ? action.result.value : []
      return action.jump && only ? open(next, { kind: "task", id: only.id }, null) : [next, []]
    }

    case "details-loaded": {
      if (action.request !== state.requests.details) return [state, []]
      if (!action.result.ok) {
        return [{ ...state, afterOpen: null, details: { state: "error", error: action.result.error } }, []]
      }
      const details = action.result.value
      const pending = state.afterOpen
      let next: State = { ...state, afterOpen: null, openTaskId: details.task.id, details: { state: "ready", value: details } }
      const effects: Effect[] = []
      if (!findStatus(next.workflows, details.task.statusId) && next.spaceWorkflows === "unloaded") {
        next = { ...next, spaceWorkflows: "loading" }
        effects.push({ kind: "load-space-workflows" })
      }
      if (!pending) return [next, effects]
      const [after, more] = taskCommand(next, pending, details.task, "browse")
      return [after, [...effects, ...more]]
    }

    case "task-saved": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      return [{ ...replaceTask(state, action.result.value), flash: info(action.done) }, []]
    }

    case "comment-added": {
      if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
      const flashed = { ...state, flash: info("Comment posted") }
      if (state.details.state !== "ready" || state.details.value.task.id !== action.taskId) return [flashed, []]
      const details = { ...state.details.value, comments: [...state.details.value.comments, action.result.value] }
      return [{ ...flashed, details: { state: "ready", value: details } }, [{ kind: "scroll-details", to: "bottom" }]]
    }
  }
}

function settle<T>(current: Loadable<T>, result: Result<T>): Loadable<T> {
  if (result.ok) return { state: "ready", value: result.value }
  const previous = shown(current)
  return previous === undefined ? { state: "error", error: result.error } : { state: "error", error: result.error, previous }
}

/** Keeps the cursor on a row after a list changed length. */
function listed(state: State, view: View): State {
  return { ...state, cursor: { ...state.cursor, [view]: clamp(state.cursor[view], countIn(state, view)) } }
}

function countIn(state: State, view: View): number {
  return itemCount({ ...state, view })
}

/** Puts a saved task everywhere it is shown. A task that is done or no longer mine leaves My to-do. */
function replaceTask(state: State, task: Task): State {
  const swap = (tasks: Task[]) => tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
  const mine = (tasks: Task[]) =>
    swap(tasks).filter((candidate) => candidate.statusGroup === "Active" && candidate.assigneeIds.includes(state.profile.userId))
  const mapList = (list: Loadable<Task[]>, change: (tasks: Task[]) => Task[]): Loadable<Task[]> =>
    list.state === "ready" ? { state: "ready", value: change(list.value) } : list
  const details =
    state.details.state === "ready" && state.details.value.task.id === task.id
      ? ({ state: "ready", value: { ...state.details.value, task } } as const)
      : state.details
  const lists = { ...state.lists, todo: mapList(state.lists.todo, mine), search: mapList(state.lists.search, swap) }
  return listed({ ...state, details, lists }, "todo")
}

function onKey(state: State, key: string): Update {
  const command = resolveKey(state, key)
  if (command) return COMMANDS[command]({ ...state, flash: null })
  // Typing in a picker filters it. Every other text is typed into an input, which reports through "draft".
  if (state.mode.kind === "picker" && [...key].length === 1) {
    return [{ ...state, mode: { ...state.mode, query: state.mode.query + key, cursor: 0 } }, []]
  }
  return [state, []]
}

function loadList(state: State, view: View): Update {
  const request = state.requests[view] + 1
  const requests = { ...state.requests, [view]: request }
  switch (view) {
    case "inbox":
      return [
        { ...state, requests, lists: { ...state.lists, inbox: loading(state.lists.inbox) } },
        [{ kind: "load-inbox", request, includeRead: state.includeRead }],
      ]
    case "todo":
      return [{ ...state, requests, lists: { ...state.lists, todo: loading(state.lists.todo) } }, [{ kind: "load-todo", request, user: state.profile.userId }]]
    case "search":
      if (state.searchQuery === "") return [state, []]
      return [
        { ...state, requests, lists: { ...state.lists, search: loading(state.lists.search) } },
        [{ kind: "search", request, query: classifyQuery(state.searchQuery) }],
      ]
  }
}

function showView(state: State, view: View, focus = state.focus): Update {
  const next = { ...state, view, focus, zoom: false }
  return next.lists[view].state === "idle" ? loadList(next, view) : [next, []]
}

function open(state: State, target: OpenTarget, after: TaskCommand | null): Update {
  const request = state.requests.details + 1
  const sameTask = target.kind === "task" && target.id === state.openTaskId
  return [
    {
      ...state,
      requests: { ...state.requests, details: request },
      openTaskId: target.kind === "task" ? target.id : null,
      details: sameTask ? loading(state.details) : { state: "loading" },
      afterOpen: after,
      focus: after ? state.focus : "details",
    },
    [{ kind: "load-details", request, target }],
  ]
}

/** What a task key acts on: the open task, a row that must be opened first, or nothing. */
type TaskTarget = { kind: "open"; task: Task } | { kind: "closed"; target: OpenTarget } | { kind: "none"; why?: string }

function taskTarget(state: State): TaskTarget {
  const opened = openTask(state)
  if (state.focus === "details") return opened ? { kind: "open", task: opened } : { kind: "none" }
  if (state.view === "inbox") {
    const item = selectedEntry(state)?.item
    if (!item) return { kind: "none" }
    if (item.baseType !== "TASK") return { kind: "none", why: "Only tasks can be edited here" }
    return opened?.permalink === item.permalink ? { kind: "open", task: opened } : { kind: "closed", target: { kind: "legacy", id: item.legacyId } }
  }
  const row = selectedTask(state)
  if (!row) return { kind: "none" }
  return opened?.id === row.id ? { kind: "open", task: opened } : { kind: "closed", target: { kind: "task", id: row.id } }
}

function onTask(command: TaskCommand): (state: State) => Update {
  return (state) => {
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
}

function picker(state: State, task: Task, field: PickerField, origin: Origin): Mode {
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
      return [{ ...state, mode: picker(state, task, command, origin) }, []]
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

function closeEditor(state: State, origin: Origin, field: (typeof EDIT_FIELDS)[number]): State {
  return { ...state, mode: origin === "edit" ? { kind: "edit", field: EDIT_FIELDS.indexOf(field) } : { kind: "browse" } }
}

function linkTarget(state: State): string | null {
  if (state.focus === "details") return openTask(state)?.permalink ?? null
  return (state.view === "inbox" ? selectedEntry(state)?.item?.permalink : selectedTask(state)?.permalink) ?? null
}

function withLink(act: (state: State, permalink: string) => Update): (state: State) => Update {
  return (state) => {
    const permalink = linkTarget(state)
    return permalink ? act(state, permalink) : [{ ...state, flash: info("Nothing is selected") }, []]
  }
}

function moveCursor(state: State, to: (cursor: number, count: number) => number): Update {
  const count = itemCount(state)
  return [{ ...state, cursor: { ...state.cursor, [state.view]: clamp(to(state.cursor[state.view], count), count) } }, []]
}

function movePicker(state: State, by: number): Update {
  if (state.mode.kind !== "picker") return [state, []]
  const count = pickerOptions(state, state.mode).length
  return [{ ...state, mode: { ...state.mode, cursor: clamp(state.mode.cursor + by, count) } }, []]
}

function focusPane(state: State, index: number): Update {
  const focus = PANES[Math.max(0, Math.min(index, PANES.length - 1))]!
  return [{ ...state, focus, zoom: state.zoom && focus === "details" }, []]
}

function stepView(state: State, by: number): Update {
  const view = VIEWS[Math.max(0, Math.min(VIEWS.indexOf(state.view) + by, VIEWS.length - 1))]!
  return showView(state, view)
}

function submit(state: State): Update {
  const mode = state.mode
  const task = openTask(state)
  switch (mode.kind) {
    case "search-input": {
      const query = mode.draft.trim()
      if (query === "") return [{ ...state, mode: { kind: "browse" } }, []]
      return loadList({ ...state, mode: { kind: "browse" }, searchQuery: query, cursor: { ...state.cursor, search: 0 } }, "search")
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
      if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
      const closed = closeEditor(state, mode.origin, mode.field)
      if (mode.field === "assignees") {
        const patch = assigneePatch(task.assigneeIds, mode.chosen.map(userId))
        return patch.add.length + patch.remove.length === 0 ? [closed, []] : save(closed, task.id, patch, "Assignees updated")
      }
      const option = pickerOptions(state, mode)[mode.cursor]
      if (!option) return [state, []]
      if (mode.field === "status") {
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

/** One handler per command. The keymap test fails when a command has no key or a key has no command. */
export const COMMANDS: Record<Command, (state: State) => Update> = {
  "focus-nav": (state) => focusPane(state, 0),
  "focus-list": (state) => focusPane(state, 1),
  "focus-details": (state) => focusPane(state, 2),
  "pane-left": (state) => focusPane(state, PANES.indexOf(state.focus) - 1),
  "pane-right": (state) => focusPane(state, PANES.indexOf(state.focus) + 1),
  "view-inbox": (state) => showView(state, "inbox", "list"),
  "view-todo": (state) => showView(state, "todo", "list"),
  search: (state) => [{ ...state, view: "search", focus: "list", zoom: false, mode: { kind: "search-input", draft: state.searchQuery } }, []],
  refresh: (state) => {
    const [listed, effects] = loadList(state, state.view)
    if (!listed.openTaskId) return [listed, effects]
    const [opened, more] = open(listed, { kind: "task", id: listed.openTaskId }, null)
    return [{ ...opened, focus: state.focus }, [...effects, ...more]]
  },
  zoom: (state) => [{ ...state, zoom: !state.zoom, focus: state.zoom ? state.focus : "details" }, []],
  help: (state) => [{ ...state, mode: { kind: "help" } }, []],
  quit: (state) => [state, [{ kind: "quit" }]],

  "nav-down": (state) => stepView(state, 1),
  "nav-up": (state) => stepView(state, -1),

  "move-down": (state) => moveCursor(state, (cursor) => cursor + 1),
  "move-up": (state) => moveCursor(state, (cursor) => cursor - 1),
  "move-top": (state) => moveCursor(state, () => 0),
  "move-bottom": (state) => moveCursor(state, (_cursor, count) => count - 1),
  open: (state) => {
    if (state.view !== "inbox") {
      const task = selectedTask(state)
      return task ? open(state, { kind: "task", id: task.id }, null) : [state, []]
    }
    const entry = selectedEntry(state)
    if (!entry) return [state, []]
    if (!entry.item) return [{ ...state, flash: info("This notification has nothing to open") }, []]
    if (entry.item.baseType !== "TASK") {
      const kind = entry.item.baseType === "PROJECT" ? "project" : "folder"
      return [{ ...state, flash: info(`Opening the ${kind} in the browser`) }, [{ kind: "open-url", url: entry.item.permalink }]]
    }
    return open(state, { kind: "legacy", id: entry.item.legacyId }, null)
  },
  "toggle-read": (state) => {
    const includeRead = !state.includeRead
    const flash = info(includeRead ? "Showing read notifications too" : "Showing unread notifications only")
    return loadList({ ...state, includeRead, flash, cursor: { ...state.cursor, inbox: 0 } }, "inbox")
  },

  "scroll-down": (state) => [state, [{ kind: "scroll-details", to: "down" }]],
  "scroll-up": (state) => [state, [{ kind: "scroll-details", to: "up" }]],
  "scroll-top": (state) => [state, [{ kind: "scroll-details", to: "top" }]],
  "scroll-bottom": (state) => [state, [{ kind: "scroll-details", to: "bottom" }]],

  edit: onTask("edit"),
  status: onTask("status"),
  importance: onTask("importance"),
  assignees: onTask("assignees"),
  "assign-me": onTask("assign-me"),
  comment: onTask("comment"),
  description: onTask("description"),

  browser: withLink((state, url) => [{ ...state, flash: info("Opening in the browser") }, [{ kind: "open-url", url }]]),
  "copy-url": withLink((state, url) => [{ ...state, flash: info("Copied the URL") }, [{ kind: "copy", text: url }]]),
  "copy-id": withLink((state, url) => {
    const id = permalinkId(url)
    return id ? [{ ...state, flash: info(`Copied the ID ${id}`) }, [{ kind: "copy", text: id }]] : [{ ...state, flash: info("This item has no ID") }, []]
  }),

  "field-down": (state) =>
    state.mode.kind === "edit" ? [{ ...state, mode: { kind: "edit", field: clamp(state.mode.field + 1, EDIT_FIELDS.length) } }, []] : [state, []],
  "field-up": (state) =>
    state.mode.kind === "edit" ? [{ ...state, mode: { kind: "edit", field: clamp(state.mode.field - 1, EDIT_FIELDS.length) } }, []] : [state, []],
  "field-open": (state) => {
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
        return taskCommand(state, field, task, "edit")
      case "description":
        return taskCommand(state, "description", task, "edit")
    }
  },

  "picker-down": (state) => movePicker(state, 1),
  "picker-up": (state) => movePicker(state, -1),
  "picker-erase": (state) =>
    state.mode.kind === "picker" ? [{ ...state, mode: { ...state.mode, query: state.mode.query.slice(0, -1), cursor: 0 } }, []] : [state, []],
  "picker-toggle": (state) => {
    const mode = state.mode
    if (mode.kind !== "picker") return [state, []]
    const option = pickerOptions(state, mode)[mode.cursor]
    if (!option) return [state, []]
    const chosen = mode.chosen.includes(option.id) ? mode.chosen.filter((id) => id !== option.id) : [...mode.chosen, option.id]
    return [{ ...state, mode: { ...mode, chosen } }, []]
  },

  "compose-editor": (state) => {
    const task = openTask(state)
    if (state.mode.kind !== "compose" || !task) return [state, []]
    return [{ ...state, mode: { kind: "browse" } }, [{ kind: "compose-in-editor", taskId: task.id, draft: state.mode.draft }]]
  },
  submit,
  cancel,
}
