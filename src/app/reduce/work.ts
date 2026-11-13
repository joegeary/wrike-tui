import { customStatusId, folderId, type TaskId } from "../../domain/ids"
import { cancelStatuses, type FolderRef, type Task } from "../../domain/model"
import { scopeKey, type ScopeKey } from "../../domain/scope"
import { taskRowId } from "../../domain/shape"
import { favoriteKey } from "../../domain/workspace"
import { describeError } from "../../wrike/errors"
import { currentKey, openTask, pickerOptions } from "../selectors"
import { shown, type Action, type DeleteTarget, type Mode, type State, type TaskCommand, type TaskPlan, type Update, type WorkPicker } from "../state"
import { failure, info, markMissing, putTask, save } from "./core"
import { open, request } from "./load"

/** In read-only mode every command here is refused before a picker, a prompt or a question opens. */
const refuseReadOnly = (state: State): Update => [{ ...state, flash: failure(describeError({ kind: "read_only" })) }, []]
const LAST_FOLDER = "A task stays in at least one folder"

const picker = (field: WorkPicker): Mode => ({ kind: "picker", field, query: "", cursor: 0, chosen: [], origin: "browse" })
const titlePrompt = (plan: TaskPlan): Mode => ({ kind: "new-task", draft: "", plan })
const short = (title: string) => (title.length > 40 ? `${title.slice(0, 39)}…` : title)

/** Who a new task goes to: the user in My to-do, so it shows there, and nobody elsewhere. */
const assigneesHere = (state: State) => (state.scope.kind === "todo" ? [state.profile.userId] : [])

/** `n`: in a space, folder or project the task goes there. Anywhere else the folder is picked first. */
export function newTask(state: State): Update {
  if (state.readOnly) return refuseReadOnly(state)
  const { scope } = state
  const ready: State = { ...state, zoom: false }
  if (scope.kind === "space" || scope.kind === "folder") {
    return [{ ...ready, mode: titlePrompt({ folder: { id: folderId(scope.id), title: scope.title }, parent: null, assignees: [] }) }, []]
  }
  return [{ ...ready, mode: picker("folder") }, []]
}

/** `N` on a task: a subtask in the parent's first folder, else where the list is scoped, else in a folder picked first. */
function newSubtask(state: State, task: Task): Update {
  const ready: State = { ...state, zoom: false }
  const parent = { id: task.id, title: task.title }
  const named = shown(state.details)?.folders.find((folder) => folder.id === task.parentIds[0])
  const { scope } = state
  const folder: FolderRef | null =
    named ?? (scope.kind === "space" || scope.kind === "folder" ? { id: folderId(scope.id), title: scope.title } : null)
  if (!folder) return [{ ...ready, mode: picker("subtask-folder") }, []]
  return [{ ...ready, mode: titlePrompt({ folder, parent, assignees: assigneesHere(state) }) }, []]
}

/** The folder picker's choice becomes the plan, and the title is asked next. */
export function submitWorkPicker(state: State, mode: Mode & { kind: "picker" }, field: WorkPicker): Update {
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!option) return [state, []]
  const closed: State = { ...state, mode: { kind: "browse" } }
  const task = openTask(state)
  const folder: FolderRef = { id: folderId(option.id), title: option.label }
  switch (field) {
    case "folder":
      return [{ ...state, mode: titlePrompt({ folder, parent: null, assignees: assigneesHere(state) }) }, []]
    case "subtask-folder":
      if (!task) return [closed, []]
      return [{ ...state, mode: titlePrompt({ folder, parent: { id: task.id, title: task.title }, assignees: assigneesHere(state) }) }, []]
    case "file":
      return task ? save(closed, task.id, { field: "parents", add: [folder.id], remove: [] }, `Filed in ${folder.title}`) : [closed, []]
    case "unfile":
      if (!task) return [closed, []]
      if (task.parentIds.length <= 1) return [{ ...closed, flash: info(LAST_FOLDER) }, []]
      return save(closed, task.id, { field: "parents", add: [], remove: [folder.id] }, `Taken out of ${folder.title}`)
    case "cancel":
      return task ? save(closed, task.id, { field: "status", statusId: customStatusId(option.id) }, `Cancelled: status set to ${option.label}`) : [closed, []]
  }
}

/** Enter on the title: an empty one is refused, anything else is created where the plan says. */
export function submitNewTask(state: State, mode: Mode & { kind: "new-task" }): Update {
  const title = mode.draft.trim()
  if (title === "") return [{ ...state, mode: { ...mode, error: "A title cannot be empty" } }, []]
  const { plan } = mode
  const key = state.scope.kind === "inbox" ? null : currentKey(state)
  const what = plan.parent ? "subtask" : "task"
  return [
    { ...state, mode: { kind: "browse" }, lastFolder: plan.folder, flash: info(`Creating the ${what}...`) },
    [{ kind: "create-task", key, task: { title, folder: plan.folder.id, parent: plan.parent?.id ?? null, assignees: plan.assignees } }],
  ]
}

/** Gives every copy of a task, in the lists and in the details, the change. */
function editTasks(state: State, ids: ReadonlySet<TaskId>, change: (task: Task) => Task): State {
  const lists = new Map(state.lists)
  for (const [key, list] of lists) {
    if (list.items.some((task) => ids.has(task.id))) lists.set(key, { ...list, items: list.items.map((task) => (ids.has(task.id) ? change(task) : task)) })
  }
  const details = state.details.state === "ready" && ids.has(state.details.value.task.id) ? ({ state: "ready", value: { ...state.details.value, task: change(state.details.value.task) } } as const) : state.details
  return { ...state, lists, details }
}

/**
 * A created task joins the list it was created from and the held lists of
 * its folders, and its parent counts it. It is selected, with its parent
 * opened in that list, and opened in the details pane.
 */
export function taskCreated(state: State, action: Action & { type: "task-created" }): Update {
  if (!action.result.ok) return [{ ...state, flash: failure(describeError(action.result.error)) }, []]
  const task = action.result.value
  const joins: ScopeKey[] = [...(action.key ? [action.key] : []), ...task.parentIds.map((id) => scopeKey({ kind: "folder", id: folderId(id), title: "", project: false }))]
  const parents = new Set(task.superTaskIds)
  let next = putTask(state, task, joins)
  next = editTasks(next, parents, (parent) => (parent.subTaskIds.includes(task.id) ? parent : { ...parent, subTaskIds: [...parent.subTaskIds, task.id] }))
  const view = action.key ? next.views.get(action.key) : undefined
  if (action.key && view) {
    const expanded = new Set([...view.expanded, ...parents])
    next = { ...next, views: new Map(next.views).set(action.key, { ...view, expanded, cursor: { id: taskRowId(task.id), index: view.cursor?.index ?? 0 } }) }
  }
  const what = parents.size > 0 ? "subtask" : "task"
  return open({ ...next, flash: info(`Created the ${what} "${short(task.title)}". Press e to edit its fields`) }, { kind: "task", id: task.id }, null)
}

/** `D` asks first, in the status bar, and says what happens to the task's subtasks. */
function askDelete(state: State, task: Task): Update {
  return [{ ...state, mode: { kind: "confirm-delete", target: { kind: "task", id: task.id, title: task.title, subtasks: task.subTaskIds.length } } }, []]
}

export function confirmDeleteTask(state: State, target: DeleteTarget & { kind: "task" }): Update {
  return [{ ...state, mode: { kind: "browse" }, flash: info("Deleting the task...") }, [{ kind: "delete-task", id: target.id, title: target.title }]]
}

/**
 * A deleted task leaves every list and the details pane, and a favorite of it
 * is marked missing. Its subtasks stay where they are listed, now top-level,
 * and its parent stops counting it. Wrike answering that it was already
 * deleted means the same.
 */
export function taskDeleted(state: State, action: Action & { type: "task-deleted" }): Update {
  const { id, result } = action
  if (!result.ok) return [{ ...state, flash: failure(describeError(result.error)) }, []]
  const lists = new Map(state.lists)
  for (const [key, list] of lists) {
    if (list.items.some((task) => task.id === id)) lists.set(key, { ...list, items: list.items.filter((task) => task.id !== id) })
  }
  const related = new Set([...lists.values()].flatMap((list) => list.items).filter((task) => task.superTaskIds.includes(id) || task.subTaskIds.includes(id)).map((task) => task.id))
  const opened = shown(state.details)?.task
  if (opened && opened.id !== id && (opened.superTaskIds.includes(id) || opened.subTaskIds.includes(id))) related.add(opened.id)
  let next = editTasks({ ...state, lists }, related, (task) => ({
    ...task,
    superTaskIds: task.superTaskIds.filter((other) => other !== id),
    subTaskIds: task.subTaskIds.filter((other) => other !== id),
  }))
  if (state.openTaskId === id || opened?.id === id) {
    // A details load still on its way for the task is dropped when it answers.
    const [closed] = request(next, "details")
    next = { ...closed, openTaskId: null, details: { state: "idle" }, selected: null, afterOpen: null, focus: next.focus === "details" ? "list" : next.focus }
  }
  const histories = new Map(next.histories)
  histories.delete(id)
  next = markMissing({ ...next, histories }, [favoriteKey({ kind: "task", id })])
  const text = result.value === "deleted" ? `Deleted "${short(action.title)}". It is in the Recycle Bin` : `"${short(action.title)}" was already deleted`
  return [{ ...next, flash: info(text) }, []]
}

/** Cancel: the workflow's one Cancelled status, or a pick among several. */
function cancelTask(state: State, task: Task): Update {
  if (task.statusGroup === "Cancelled") return [{ ...state, flash: info("This task is already cancelled") }, []]
  const choices = cancelStatuses(state.workflows, task.statusId)
  if (choices.length === 0) {
    const why = state.spaceWorkflows === "loading" ? "This task's workflow is still loading. Try again in a moment" : "This task's workflow has no Cancelled status"
    return [{ ...state, flash: info(why) }, []]
  }
  if (choices.length === 1) return save(state, task.id, { field: "status", statusId: choices[0]!.id }, `Cancelled: status set to ${choices[0]!.name}`)
  return [{ ...state, mode: picker("cancel") }, []]
}

/** Takes the task out of one of its folders. The last one stays, because Wrike would move the task to the account root. */
function unfileTask(state: State, task: Task): Update {
  if (task.parentIds.length <= 1) return [{ ...state, flash: info(LAST_FOLDER) }, []]
  return [{ ...state, mode: picker("unfile") }, []]
}

export type WorkCommand = Extract<TaskCommand, "subtask" | "delete" | "file" | "unfile" | "cancel">

/** The task commands that create, file, cancel or delete, on the open task. */
export function workCommand(state: State, command: WorkCommand, task: Task): Update {
  if (state.readOnly) return refuseReadOnly(state)
  switch (command) {
    case "subtask":
      return newSubtask(state, task)
    case "delete":
      return askDelete(state, task)
    case "file":
      return [{ ...state, mode: picker("file") }, []]
    case "unfile":
      return unfileTask(state, task)
    case "cancel":
      return cancelTask(state, task)
  }
}
