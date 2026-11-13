import { findStatus } from "../domain/model"
import { resolveKey } from "./keymap"
import { stepCursor } from "./nav"
import { paletteCommands } from "./palette"
import { clamp, TODO } from "./reduce/core"
import { changeSpec, collapseAll, expandAll, filterText, listPicker, moveCursor, openRow, saveDefaults, search, submitFilter, submitListPicker, submitSearch, toggleMark, toggleRead, toggleRow } from "./reduce/lists"
import {
  fieldsLoaded,
  historyLoaded,
  inboxLoaded,
  referenceLoaded,
  refresh,
  showScope,
  start,
  spacesLoaded,
  spaceWorkflowsLoaded,
  tasksLoaded,
  treeLoaded,
} from "./reduce/load"
import {
  closeMentions,
  commentDeleted,
  commentSaved,
  composed,
  composeDraft,
  composeEditor,
  confirmDeleteComment,
  deleteComment,
  editComment,
  olderHistory,
  pickMention,
  selectItem,
  submitCompose,
  toggleHistory,
} from "./reduce/comments"
import { openAttachment, previewLoaded } from "./reduce/attachments"
import { bulkDone, confirmBulk, submitBulkPicker } from "./reduce/bulk"
import { favorite, favoriteMove, navOpen, navToggle } from "./reduce/nav"
import { closeEditor } from "./reduce/fields"
import { choiceToggle, detailsLoaded, onLink, onTask, openField, submitEditText, submitTaskPicker, taskSaved } from "./reduce/task"
import { confirmDeleteTask, newTask, submitNewTask, submitWorkPicker, taskCreated, taskDeleted } from "./reduce/work"
import { currentList, editRows, mentionSuggestions, navRowsOf, openTask, pickerOptions } from "./selectors"
import { info } from "./reduce/core"
import { PANES, WORK_PICKERS, type Action, type ConfirmTarget, type State, type Update, type WorkPicker } from "./state"

export { start }

const BRINGS_TASKS: ReadonlySet<Action["type"]> = new Set(["reference-loaded", "tasks-loaded", "details-loaded", "task-saved", "task-created", "bulk-done"])

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
      if (mode.kind === "edit-text" || mode.kind === "new-task") {
        const { error: _cleared, ...rest } = mode
        return [{ ...state, mode: { ...rest, draft: action.text } }, []]
      }
      if (mode.kind === "compose") return [{ ...state, mode: composeDraft(mode, action.text) }, []]
      if (mode.kind === "search-input" || mode.kind === "filter-input") return [{ ...state, mode: { ...mode, draft: action.text } }, []]
      return [state, []]
    }

    case "flash":
      return [{ ...state, flash: action.flash }, []]

    case "clock":
      return [{ ...state, clock: action.clock }, []]

    case "composed":
      return composed(state, action.text)

    case "reference-loaded":
      return referenceLoaded(state, action)

    case "space-workflows-loaded":
      return spaceWorkflowsLoaded(state, action)

    case "fields-loaded":
      return fieldsLoaded(state, action)

    case "inbox-loaded":
      return inboxLoaded(state, action)

    case "tasks-loaded":
      return tasksLoaded(state, action)

    case "spaces-loaded":
      return spacesLoaded(state, action)

    case "tree-loaded":
      return treeLoaded(state, action)

    case "details-loaded":
      return detailsLoaded(state, action)

    case "history-loaded":
      return historyLoaded(state, action)

    case "preview-loaded":
      return previewLoaded(state, action)

    case "task-saved":
      return taskSaved(state, action)

    case "task-created":
      return taskCreated(state, action)

    case "task-deleted":
      return taskDeleted(state, action)

    case "bulk-done":
      return bulkDone(state, action)

    case "comment-saved":
      return commentSaved(state, action)

    case "comment-deleted":
      return commentDeleted(state, action)

    case "focus":
      return focusPane(state, action.pane === "left" ? PANES.indexOf(state.focus) - 1 : action.pane === "right" ? PANES.indexOf(state.focus) + 1 : PANES.indexOf(action.pane))
    case "show":
      return showScope(state, action.scope, "list")
    case "search":
      return search(state)
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
    case "favorite-move":
      return favoriteMove(state, action)

    case "move":
      return moveCursor(state, action.to)
    case "open":
      return openRow(state)
    case "toggle-row":
      return toggleRow(state)
    case "toggle-read":
      return toggleRead(state)
    case "mark":
      return toggleMark(state)
    case "clear-marks":
      return [{ ...state, marks: new Set() }, []]
    case "filter-text":
      return filterText(state)
    case "spec":
      return changeSpec(state, action.change)
    case "pick":
      return [{ ...state, mode: listPicker(state, action.field) }, []]
    case "expand-all":
      return expandAll(state)
    case "collapse-all":
      return collapseAll(state)

    case "scroll":
      return [state, [{ kind: "scroll", pane: action.pane, to: action.to }]]
    case "select":
      return selectItem(state, action.by)
    case "unselect":
      return [{ ...state, selected: null }, []]
    case "toggle-history":
      return toggleHistory(state)
    case "older-history":
      return olderHistory(state)
    case "edit-comment":
      return editComment(state)
    case "open-attachment":
      return openAttachment(state)
    case "delete-comment":
      return deleteComment(state)
    case "mention-pick":
      return pickMention(state)
    case "mention-close":
      return closeMentions(state)
    case "confirm":
      return confirm(state)
    case "task":
      return onTask(state, action.command)
    case "new-task":
      return newTask(state)
    case "link":
      return onLink(state, action.act)

    case "field-move":
      return state.mode.kind === "edit" ? [{ ...state, mode: { kind: "edit", field: clamp(state.mode.field + action.by, editRows(state).length) } }, []] : [state, []]
    case "field-open":
      return openField(state)
    case "choice-move":
      return moveChoice(state, action.by)
    case "choice-toggle":
      return choiceToggle(state)
    case "erase":
      return state.mode.kind === "picker" || state.mode.kind === "palette"
        ? [{ ...state, mode: { ...state.mode, query: state.mode.query.slice(0, -1), cursor: 0 } }, []]
        : [state, []]
    case "compose-editor":
      return composeEditor(state)
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

function onKey(state: State, key: string): Update {
  const command = resolveKey(state, key)
  if (command) {
    const cleared = { ...state, flash: null }
    return step(cleared, command.run(cleared))
  }
  if (state.mode.kind === "confirm") return keep({ ...state, flash: null })
  // Typing in a picker or the palette filters it. Every other text is typed into an input, which reports through "draft".
  const text = key === "space" ? " " : key
  if ((state.mode.kind === "picker" || state.mode.kind === "palette") && [...text].length === 1) {
    return [{ ...state, mode: { ...state.mode, query: state.mode.query + text, cursor: 0 } }, []]
  }
  return [state, []]
}

function focusPane(state: State, index: number): Update {
  const focus = PANES[Math.max(0, Math.min(index, PANES.length - 1))]!
  return [{ ...state, focus, zoom: state.zoom && focus === "details" }, []]
}

function moveChoice(state: State, by: number): Update {
  const { mode } = state
  if (mode.kind === "picker") return [{ ...state, mode: { ...mode, cursor: clamp(mode.cursor + by, pickerOptions(state, mode).length) } }, []]
  if (mode.kind === "palette") return [{ ...state, mode: { ...mode, cursor: clamp(mode.cursor + by, paletteCommands(state, mode.query).length) } }, []]
  if (mode.kind === "compose") return [{ ...state, mode: { ...mode, pick: clamp(mode.pick + by, mentionSuggestions(state)?.contacts.length ?? 0) } }, []]
  return [state, []]
}

function submit(state: State): Update {
  const mode = state.mode
  switch (mode.kind) {
    case "search-input":
      return submitSearch(state, mode)
    case "filter-input":
      return submitFilter(state, mode)
    case "palette": {
      const command = paletteCommands(state, mode.query)[mode.cursor]
      const closed: State = { ...state, mode: { kind: "browse" } }
      return command ? step(closed, command.run(closed)) : [closed, []]
    }
    case "compose":
      return submitCompose(state, mode)
    case "edit-text":
      return submitEditText(state, mode)
    case "new-task":
      return submitNewTask(state, mode)
    case "picker": {
      if (mode.field === "bulk") return submitBulkPicker(state, mode)
      const { field } = mode
      if (isWorkPicker(field)) return submitWorkPicker(state, mode, field)
      if (field !== "status" && field !== "importance" && field !== "assignees" && field !== "set-field" && field !== "custom") return submitListPicker(state, mode, field)
      return submitTaskPicker(state, mode, field)
    }
    case "browse":
    case "edit":
    case "help":
    case "confirm":
      return [state, []]
  }
}

function cancel(state: State): Update {
  const mode = state.mode
  if (mode.kind === "edit-text" || mode.kind === "picker") return [closeEditor(state, mode), []]
  if (mode.kind === "confirm") return keep(state)
  return [{ ...state, mode: { kind: "browse" } }, []]
}

const isWorkPicker = (field: string): field is WorkPicker => (WORK_PICKERS as readonly string[]).includes(field)

/** `y` while a confirm asks. */
function confirm(state: State): Update {
  const { mode } = state
  if (mode.kind !== "confirm") return [state, []]
  const { target } = mode
  switch (target.kind) {
    case "comment":
      return confirmDeleteComment(state, target.id)
    case "task":
      return confirmDeleteTask(state, target)
    case "delete-tasks":
    case "cancel-tasks":
      return confirmBulk(state, target)
  }
}

const KEPT: Record<ConfirmTarget["kind"], string> = {
  comment: "Kept the comment",
  task: "Kept the task",
  "delete-tasks": "Kept the tasks",
  "cancel-tasks": "Left the tasks as they were",
}

/** Any other key while a confirm asks keeps what was asked about. */
function keep(state: State): Update {
  if (state.mode.kind !== "confirm") return [state, []]
  return [{ ...state, mode: { kind: "browse" }, flash: info(KEPT[state.mode.target.kind]) }, []]
}
