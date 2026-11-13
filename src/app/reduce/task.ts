import { withDay } from "../../domain/dates"
import { kept } from "../../domain/fields"
import { customStatusId, userId, type TaskId } from "../../domain/ids"
import { dueDay, IMPORTANCES, permalinkId, startDay, type FolderRef, type Importance, type Task } from "../../domain/model"
import { assigneePatch, type TaskPatch } from "../../domain/patch"
import { favoriteKey } from "../../domain/workspace"
import { describeError } from "../../wrike/errors"
import { bulkTargets, editRows, isMultiPicker, openTask, pickerOptions, selectedAttachment, selectedEntry, selectedTask } from "../selectors"
import { type Action, type EditTextMode, type Flash, type Mode, type OpenTarget, type Origin, type PickerMode, type State, type TaskCommand, type TaskPicker, type TextField, type Update } from "../state"
import { closeEditor, openFieldEditor, submitFieldPicker, submitFieldText, submitSetField } from "./fields"
import { withPreview } from "./attachments"
import { actsOnMarks, onMarks } from "./bulk"
import { newComment } from "./comments"
import { clamp, failure, info, markMissing, putTask, retitle, save, then } from "./core"
import { historyStale, isCurrent, loadHistory, needsHistory, open } from "./load"
import { workCommand } from "./work"

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
  // History is the one MCP call an open costs, and only the first time. After a failure, r asks again.
  if (next.settings.history && needsHistory(next.histories.get(details.task.id))) retitled = then(retitled, (after) => loadHistory(after, details.task, "first"))
  // A selected image whose thumbnail r dropped, or the limit did, is fetched again.
  retitled = then(retitled, (after) => withPreview(after, selectedAttachment(after)))
  return pending ? then(retitled, (after) => taskCommand(after, pending, details.task, "browse")) : retitled
}

/** Wrike answers 200 to a field write it did not store, so the answer is read for the value. The task is drawn as Wrike answered. */
function savedFlash(task: Task, action: Action & { type: "task-saved" }): Flash {
  const { check } = action
  if (!check || kept(check.value, task.fields.find((value) => value.id === check.id)?.value)) return info(action.done)
  return check.value === null
    ? failure(`Wrike did not clear ${check.title} on this task.`)
    : failure(`Wrike did not keep ${check.title} on this task. It may not apply here.`)
}

export function taskSaved(state: State, action: Action & { type: "task-saved" }): Update {
  if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
  const task = action.result.value
  const put = withFolders(putTask(state, task), task, action.folders)
  const saved = retitle({ ...put, flash: savedFlash(task, action) }, new Map([[favoriteKey({ kind: "task", id: task.id }), task.title]]), [])
  return then(saved, (next) => historyStale(next, task))
}

/** The open task's folder line, named again after a save that filed it. */
function withFolders(state: State, task: Task, folders: FolderRef[] | undefined): State {
  if (!folders || state.details.state !== "ready" || state.details.value.task.id !== task.id) return state
  return { ...state, details: { state: "ready", value: { ...state.details.value, folders } } }
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
  const marked = bulkTargets(state)
  if (marked.length > 0 && actsOnMarks(command)) return onMarks(state, command, marked)
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
  const mode: PickerMode = {
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
    case "set-field":
      return [{ ...state, mode: { kind: "picker", field: "set-field", taskIds: [task.id], query: "", cursor: 0, chosen: [], origin } }, []]
    case "subtask":
    case "delete":
    case "file":
    case "unfile":
    case "cancel":
      return workCommand(state, command, task)
  }
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
  const rows = editRows(state)
  const row = rows[clamp(state.mode.field, rows.length)]!
  if (row.kind === "custom") return openFieldEditor(state, { id: row.id, taskIds: [task.id] }, "edit")
  const field = row.field
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
  if (mode.kind !== "picker" || !isMultiPicker(state, mode)) return [state, []]
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!option) return [state, []]
  const chosen = mode.chosen.includes(option.id) ? mode.chosen.filter((id) => id !== option.id) : [...mode.chosen, option.id]
  return [{ ...state, mode: { ...mode, chosen } }, []]
}

export function submitEditText(state: State, mode: EditTextMode): Update {
  if (mode.field === "custom") return submitFieldText(state, mode)
  const task = openTask(state)
  if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
  const closed = closeEditor(state, mode)
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

export function submitTaskPicker(state: State, mode: PickerMode, field: TaskPicker | "set-field" | "custom"): Update {
  if (mode.field === "custom") return submitFieldPicker(state, mode)
  if (mode.field === "set-field") return submitSetField(state, mode)
  const task = openTask(state)
  if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
  const closed = closeEditor(state, mode)
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
