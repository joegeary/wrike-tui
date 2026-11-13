import { withDay } from "../../domain/dates"
import { customStatusId, userId, type TaskId } from "../../domain/ids"
import { dueDay, IMPORTANCES, permalinkId, startDay, type Importance, type Task } from "../../domain/model"
import { assigneePatch, type TaskPatch } from "../../domain/patch"
import { favoriteKey } from "../../domain/workspace"
import { describeError } from "../../wrike/errors"
import { openTask, pickerOptions, selectedEntry, selectedTask } from "../selectors"
import { EDIT_FIELDS, type Action, type Mode, type OpenTarget, type Origin, type PickerField, type State, type TaskCommand, type TaskPicker, type TextField, type Update } from "../state"
import { newComment } from "./comments"
import { failure, info, markMissing, retitle, TODO, then } from "./core"
import { isCurrent, loadHistory, needsHistory, open } from "./load"

export function detailsLoaded(state: State, action: Action & { type: "details-loaded" }): Update {
  if (!isCurrent(state, "details", action.request)) return [state, []]
  if (!action.result.ok) {
    const gone = action.result.error.kind === "not_found" && state.openTaskId ? [favoriteKey({ kind: "task", id: state.openTaskId })] : []
    return [{ ...markMissing(state, gone), afterOpen: null, details: { state: "error", error: action.result.error } }, []]
  }
  const details = action.result.value
  const pending = state.afterOpen
  const next: State = { ...state, afterOpen: null, openTaskId: details.task.id, details: { state: "ready", value: details } }
  let retitled = retitle(next, new Map([[favoriteKey({ kind: "task", id: details.task.id }), details.task.title]]), [])
  // History is the one MCP call an open costs, and only the first time, or after a try that failed.
  if (next.settings.history && needsHistory(next.histories.get(details.task.id))) retitled = then(retitled, (after) => loadHistory(after, details.task, "first"))
  return pending ? then(retitled, (after) => taskCommand(after, pending, details.task, "browse")) : retitled
}

export function taskSaved(state: State, action: Action & { type: "task-saved" }): Update {
  if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
  const task = action.result.value
  return retitle({ ...replaceTask(state, task), flash: info(action.done) }, new Map([[favoriteKey({ kind: "task", id: task.id }), task.title]]), [])
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

export function onTask(state: State, command: TaskCommand): Update {
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
      return [{ ...state, mode: newComment() }, []]
    case "description":
      return [state, [{ kind: "edit-description", task }]]
  }
}

function save(state: State, taskId: TaskId, patch: TaskPatch, done: string): Update {
  return [{ ...state, flash: info("Saving...") }, [{ kind: "update-task", taskId, patch, done }]]
}

export function closeEditor(state: State, origin: Origin, field: PickerField | TextField): State {
  const edited = EDIT_FIELDS.findIndex((candidate) => candidate === field)
  return { ...state, mode: origin === "edit" && edited >= 0 ? { kind: "edit", field: edited } : { kind: "browse" } }
}

export function onLink(state: State, act: "browser" | "copy-url" | "copy-id"): Update {
  const url = state.focus === "details" ? openTask(state)?.permalink : state.scope.kind === "inbox" ? selectedEntry(state)?.item?.permalink : selectedTask(state)?.permalink
  if (!url) return [{ ...state, flash: info("Nothing is selected") }, []]
  if (act === "browser") return [{ ...state, flash: info("Opening in the browser") }, [{ kind: "open-url", url }]]
  if (act === "copy-url") return [{ ...state, flash: info("Copied the URL") }, [{ kind: "copy", text: url }]]
  const id = permalinkId(url)
  return id ? [{ ...state, flash: info(`Copied the ID ${id}`) }, [{ kind: "copy", text: id }]] : [{ ...state, flash: info("This item has no ID") }, []]
}

export function openField(state: State): Update {
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

export function choiceToggle(state: State): Update {
  const mode = state.mode
  if (mode.kind !== "picker") return [state, []]
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!option) return [state, []]
  const chosen = mode.chosen.includes(option.id) ? mode.chosen.filter((id) => id !== option.id) : [...mode.chosen, option.id]
  return [{ ...state, mode: { ...mode, chosen } }, []]
}

export function submitEditText(state: State, mode: Mode & { kind: "edit-text" }): Update {
  const task = openTask(state)
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

export function submitTaskPicker(state: State, mode: Mode & { kind: "picker" }, field: TaskPicker): Update {
  const task = openTask(state)
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
