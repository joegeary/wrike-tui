import { editWindowLeft, mentionMatches, typedMention } from "../domain/comment"
import { choicesOf, fieldText, isWritable, kindLabel, type CustomField } from "../domain/fields"
import type { HistoryEntry } from "../domain/history"
import type { CustomFieldId, CustomStatusId, TaskId, UserId } from "../domain/ids"
import { COLUMN_KEYS, DUE_RANGES, NOBODY, type ColumnKey, type DueRange, type ListSpec } from "../domain/list"
import { cancelStatuses, findStatus, IMPORTANCES, statusChoices, type Attachment, type Comment, type Contact, type CustomStatus, type InboxEntry, type Task, type Workflow } from "../domain/model"
import { scopeKey, taskScopeKind, type Scope, type ScopeKey } from "../domain/scope"
import { defaultSpec } from "../domain/settings"
import { cursorIndex, shapeList, type ListRow, type RowId, type ShapeContext } from "../domain/shape"
import { sortSpaces, type SpaceTree } from "../domain/workspace"
import { cursorRow, navRows, type NavRow, type SelectableNavRow } from "./nav"
import {
  EDIT_FIELDS,
  shown,
  type Details,
  type DetailsItem,
  type EditRow,
  type FieldEdit,
  type ListView,
  type Loadable,
  type Paged,
  type PickerField,
  type PickerMode,
  type State,
} from "./state"

export type PaneRow = ListRow | { kind: "entry"; id: RowId; entry: InboxEntry }

/** Remembers the last result, so a function of unchanged state parts is computed once. */
function memo<Args extends readonly unknown[], Out>(compute: (...args: Args) => Out): (...args: Args) => Out {
  let last: { args: Args; out: Out } | null = null
  return (...args) => {
    if (last && last.args.length === args.length && last.args.every((arg, index) => Object.is(arg, args[index]))) return last.out
    last = { args, out: compute(...args) }
    return last.out
  }
}

const EMPTY_VIEW_SETS = { collapsed: new Set<string>(), expanded: new Set<TaskId>() }

export const currentKey = (state: State): ScopeKey => scopeKey(state.scope)

export function freshView(state: Pick<State, "settings">, scope: Scope): ListView {
  const spec: ListSpec = scope.kind === "inbox" ? defaultSpec(state.settings, "todo") : defaultSpec(state.settings, taskScopeKind(scope))
  return { spec, cursor: null, ...EMPTY_VIEW_SETS }
}

export function currentView(state: State): ListView {
  return state.views.get(currentKey(state)) ?? freshView(state, state.scope)
}

export function currentList(state: State): Paged<Task> | undefined {
  return state.lists.get(currentKey(state))
}

const statusIndex = memo((workflows: Workflow[]): ShapeContext["statuses"] => {
  const statuses = new Map<CustomStatusId, { name: string; order: number }>()
  let order = 0
  for (const workflow of workflows) for (const status of workflow.statuses) statuses.set(status.id, { name: status.name, order: order++ })
  return statuses
})

/** Titles of every folder in the loaded trees. A folder's spaces are found here, never by walking its parents. */
export const folderTitles = memo((trees: State["trees"]): ReadonlyMap<string, string> => {
  const titles = new Map<string, string>()
  for (const loadable of trees.values()) {
    const tree: SpaceTree | undefined = shown(loadable)
    if (tree) for (const node of tree.values()) if (node.kind !== "space") titles.set(node.id, node.title)
  }
  return titles
})

// Keyed on the parts of the view that shape the list, so a cursor move never reshapes it.
const taskRows = memo(
  (
    list: Paged<Task> | undefined,
    spec: ListSpec,
    collapsed: ListView["collapsed"],
    expanded: ListView["expanded"],
    workflows: Workflow[],
    contacts: State["contacts"],
    trees: State["trees"],
    today: string,
  ): PaneRow[] => {
    if (!list) return []
    return shapeList(list.items, spec, {
      today,
      statuses: statusIndex(workflows),
      contacts,
      folders: folderTitles(trees),
      collapsed,
      expanded,
      more: list.next === null ? null : list.loading === "more" ? "loading" : "available",
    })
  },
)

const entryRows = memo((inbox: Loadable<InboxEntry[]>): PaneRow[] =>
  (shown(inbox) ?? []).map((entry) => ({ kind: "entry", id: `entry:${entry.id}` as RowId, entry })),
)

export function listRows(state: State): PaneRow[] {
  if (state.scope.kind === "inbox") return entryRows(state.inbox)
  const view = currentView(state)
  return taskRows(currentList(state), view.spec, view.collapsed, view.expanded, state.workflows, state.contacts, state.trees, state.clock.today)
}

/** The index of the cursor's row, or -1 for an empty list. */
export function listCursor(state: State): number {
  return cursorIndex(listRows(state), currentView(state).cursor)
}

export function selectedRow(state: State): PaneRow | null {
  return listRows(state)[listCursor(state)] ?? null
}

export function selectedTask(state: State): Task | null {
  const row = selectedRow(state)
  return row?.kind === "task" ? row.task : null
}

export function selectedEntry(state: State): InboxEntry | null {
  const row = selectedRow(state)
  return row?.kind === "entry" ? row.entry : null
}

export function openTask(state: State): Task | null {
  return state.details.state === "ready" ? state.details.value.task : null
}

/**
 * The drawn task's history while history is shown: what is loaded, whether
 * more is older, and how its last load went. It stays while the task reloads.
 */
export function openHistory(state: State): Paged<HistoryEntry> | null {
  const task = shown(state.details)?.task
  return task && state.settings.history ? (state.histories.get(task.id) ?? null) : null
}

export type StreamItem = { kind: "comment"; comment: Comment } | { kind: "change"; entry: HistoryEntry }

/**
 * Comments and history by time, oldest first. Comments keep their order, and
 * a change from the same second as a comment comes after it. A change without
 * a time follows the one before it on Wrike's page.
 */
export function commentStream(comments: Comment[], newestFirst: HistoryEntry[]): StreamItem[] {
  const changes = newestFirst.toReversed()
  const before = (entry: HistoryEntry, time: number) => entry.at === null || Date.parse(entry.at) < time
  const stream: StreamItem[] = []
  let at = 0
  for (const comment of comments) {
    const time = Date.parse(comment.createdDate)
    while (at < changes.length && before(changes[at]!, time)) stream.push({ kind: "change", entry: changes[at++]! })
    stream.push({ kind: "comment", comment })
  }
  for (; at < changes.length; at++) stream.push({ kind: "change", entry: changes[at]! })
  return stream
}

/**
 * What `]` and `[` step through, in the order the details pane draws it: the
 * attachments, which sit above the comments, then the comments oldest first.
 */
export function detailsItems(details: Details): DetailsItem[] {
  return [
    ...details.attachments.map((attachment): DetailsItem => ({ kind: "attachment", id: attachment.id })),
    ...details.comments.map((comment): DetailsItem => ({ kind: "comment", id: comment.id })),
  ]
}

export const sameItem = (a: DetailsItem | null, b: DetailsItem | null) => a !== null && b !== null && a.kind === b.kind && a.id === b.id

/** The selected comment of the open task, or null when nothing is selected, something else is, or the selection is gone. */
export function selectedComment(state: State): Comment | null {
  const { selected } = state
  if (selected?.kind !== "comment" || state.details.state !== "ready") return null
  return state.details.value.comments.find((comment) => comment.id === selected.id) ?? null
}

/** The selected attachment of the open task, or null. */
export function selectedAttachment(state: State): Attachment | null {
  const { selected } = state
  if (selected?.kind !== "attachment" || state.details.state !== "ready") return null
  return state.details.value.attachments.find((attachment) => attachment.id === selected.id) ?? null
}

/** The comment the comment box is editing, while it is open on one. */
export function editedComment(state: State): Comment | null {
  const { mode } = state
  if (mode.kind !== "compose" || mode.editing === null || state.details.state !== "ready") return null
  return state.details.value.comments.find((comment) => comment.id === mode.editing) ?? null
}

/** Milliseconds left to edit `comment` when it is mine, zero or less once its window has closed. Null otherwise. */
export function editTimeLeft(state: State, comment: Comment | null): number | null {
  if (!comment || comment.authorId !== state.profile.userId) return null
  return editWindowLeft(comment.createdDate, state.clock.now)
}

/** True while the screen counts an edit window down, beside the selected comment or in the box's title, which is when the clock must keep moving. */
export const countingDown = (state: State) => [selectedComment(state), editedComment(state)].some((comment) => (editTimeLeft(state, comment) ?? 0) > 0)

export type MentionSuggestions = { at: number; contacts: Contact[] }

/** The people offered for the mention typed at the end of the comment box, or null when no list is open. */
export function mentionSuggestions(state: State): MentionSuggestions | null {
  if (state.mode.kind !== "compose") return null
  const typed = typedMention(state.mode.draft)
  if (!typed || typed.at === state.mode.dismissed) return null
  const contacts = mentionMatches(state.contacts.values(), typed.query)
  return contacts.length === 0 ? null : { at: typed.at, contacts }
}

/** A contact's name as the comment box writes it, for a mention. */
export const mentionName = (state: State) => (id: UserId) => state.contacts.get(id)?.name

/** The custom field definitions by ID, from the last good load. */
export const fieldDefs = memo((loadable: Loadable<CustomField[]>): ReadonlyMap<CustomFieldId, CustomField> => new Map((shown(loadable) ?? []).map((field) => [field.id, field])))

/** A field as the details pane draws it. `field` is null when no loaded definition has its ID. */
export type ShownField = { id: CustomFieldId; field: CustomField | null; value: string }

/**
 * The task's set fields by title, and those whose definition is not loaded
 * last by ID. `adding` is a field being typed that the task does not have
 * yet, drawn in its place with no value.
 */
export function taskFields(state: State, task: Task, adding: CustomFieldId | null = null): ShownField[] {
  const defs = fieldDefs(state.customFields)
  const title = (shown: ShownField) => shown.field?.title ?? `\uffff${shown.id}`
  const values = adding && !task.fields.some((value) => value.id === adding) ? [...task.fields, { id: adding, value: "" }] : task.fields
  return values
    .map((value): ShownField => ({ id: value.id, field: defs.get(value.id) ?? null, value: value.value }))
    .sort((a, b) => title(a).localeCompare(title(b), undefined, { sensitivity: "base", numeric: true }))
}

/** What the edit walk steps through on the open task: the fields every task has, then its custom fields as the pane draws them. */
export function editRows(state: State): EditRow[] {
  const task = openTask(state)
  const custom = task ? taskFields(state, task).map((shown): EditRow => ({ kind: "custom", id: shown.id })) : []
  return [...EDIT_FIELDS.map((field): EditRow => ({ kind: "core", field })), ...custom]
}

/** A task the client holds: the open one, else the first list that has it. */
export function heldTask(state: State, id: TaskId): Task | null {
  const opened = openTask(state)
  if (opened?.id === id) return opened
  for (const list of state.lists.values()) {
    const found = list.items.find((task) => task.id === id)
    if (found) return found
  }
  return null
}

/** The value the edited tasks share for the field, or null when it is not set on them or they differ. */
export function sharedValue(state: State, edit: FieldEdit): string | null {
  const values = edit.taskIds.map((id) => heldTask(state, id)?.fields.find((value) => value.id === edit.id)?.value ?? null)
  const [first = null] = values
  return values.every((value) => value === first) ? first : null
}

/** True when some edited task has the field set, so clearing it would change something. */
export const anySet = (state: State, edit: FieldEdit) => edit.taskIds.some((id) => heldTask(state, id)?.fields.some((value) => value.id === edit.id))

export function statusOf(state: State, task: Task): CustomStatus | null {
  return findStatus(state.workflows, task.statusId)
}

export function contactName(state: State, id: UserId): string {
  return state.contacts.get(id)?.name ?? "Unknown user"
}

export function unreadCount(state: State): number | null {
  const entries = shown(state.inbox)
  return entries ? entries.filter((entry) => entry.unread).length : null
}

const buildNavRows = memo(
  (
    inbox: number | null,
    todo: number | null,
    search: number | null,
    favorites: State["favorites"],
    missing: State["missing"],
    spaces: State["spaces"],
    trees: State["trees"],
    expanded: State["nav"]["expanded"],
  ) => navRows({ counts: { inbox, todo, search }, favorites, missing, spaces, trees, expanded }),
)

export function navRowsOf(state: State): NavRow[] {
  const search = state.lastSearch === "" ? undefined : state.lists.get(scopeKey({ kind: "search", query: state.lastSearch }))
  const todo = state.lists.get("todo" as ScopeKey)
  return buildNavRows(unreadCount(state), todo?.items.length ?? null, search?.items.length ?? null, state.favorites, state.missing, state.spaces, state.trees, state.nav.expanded)
}

export function navCursorRow(state: State): SelectableNavRow | null {
  return cursorRow(navRowsOf(state), state.nav.cursor)
}

export type PickerOption = { id: string; label: string; detail?: string; color?: string }

const MULTI_PICKERS: ReadonlySet<PickerField> = new Set<PickerField>([
  "assignees",
  "filter-assignee",
  "filter-status",
  "filter-importance",
  "columns",
])

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  importance: "Importance",
  title: "Title",
  status: "Status",
  assignees: "Assignees",
  due: "Due date",
  start: "Start date",
  updated: "Updated",
  folder: "Folder",
  id: "ID",
}

export const DUE_LABELS: Record<DueRange, string> = { overdue: "Overdue", today: "Due today", week: "Due this week", none: "No due date" }
/** The choice in the due picker that removes the filter. */
export const ANY_DUE = "any"

/**
 * Where a task can go, as picker options: the folder the last task went to,
 * the favorite folders and projects, then every folder and project of the
 * loaded trees, space by space. Spaces themselves are offered only when
 * `spaces` holds, because only creating a task is known to work in one.
 */
const folderOptions = memo(
  (spaces: State["spaces"], trees: State["trees"], favorites: State["favorites"], last: State["lastFolder"], withSpaces: boolean): PickerOption[] => {
    const options: PickerOption[] = []
    const seen = new Set<string>()
    const add = (id: string, label: string, detail: string) => {
      if (seen.has(id)) return
      seen.add(id)
      options.push({ id, label, detail })
    }
    if (last) add(last.id, last.title, "last used")
    for (const favorite of favorites) {
      if (favorite.kind === "folder") add(favorite.id, favorite.title, favorite.project ? "favorite project" : "favorite")
      if (favorite.kind === "space" && withSpaces) add(favorite.id, favorite.title, "favorite space")
    }
    const known = sortSpaces(shown(spaces) ?? [])
    const order = [...known.map((space) => space.id), ...[...trees.keys()].filter((id) => !known.some((space) => space.id === id))]
    for (const space of order) {
      const tree = shown(trees.get(space))
      const title = known.find((candidate) => candidate.id === space)?.title ?? "Space"
      for (const node of tree?.values() ?? []) {
        if (node.kind === "space") {
          if (withSpaces) add(node.id, title, "space")
        } else add(node.id, node.title, node.kind === "project" ? `${title} project` : title)
      }
    }
    return options
  },
)

/** True when the picker takes several choices: Space toggles them and Enter applies them all. */
export function isMultiPicker(state: State, mode: PickerMode): boolean {
  return mode.field === "custom" ? fieldDefs(state.customFields).get(mode.edit.id)?.kind.type === "Multiple" : MULTI_PICKERS.has(mode.field)
}

/** Option IDs in a custom field's picker: a choice is `v:` and its value, the rest name what Enter does. */
export const CHOICE = "v:"
export const OTHER_VALUE = "other"
export const CLEAR_FIELD = "clear"

/** A custom field's choices. A choice already set that the field no longer lists stays, so it can be kept or removed. */
function fieldOptions(state: State, mode: PickerMode & { field: "custom" }, matches: (text: string) => boolean): PickerOption[] {
  const field = fieldDefs(state.customFields).get(mode.edit.id)
  if (field?.kind.type !== "DropDown" && field?.kind.type !== "Multiple") return []
  const current = sharedValue(state, mode.edit)
  const held = current === null ? [] : field.kind.type === "Multiple" ? choicesOf(current) : [current]
  const chosen = mode.chosen.flatMap((id) => (id.startsWith(CHOICE) ? [id.slice(CHOICE.length)] : []))
  const values = [...new Set([...field.kind.options, ...(field.kind.type === "Multiple" ? [...held, ...chosen] : [])])]
  const options = values.filter(matches).map((value): PickerOption => ({ id: CHOICE + value, label: value }))
  if (field.kind.type === "Multiple") return options
  const other = current !== null && !field.kind.options.includes(current) ? current : null
  return [
    ...options,
    ...(field.kind.allowOther ? [{ id: OTHER_VALUE, label: "Other value...", ...(mode.query ? { detail: mode.query } : other ? { detail: other } : {}) }] : []),
    ...(anySet(state, mode.edit) ? [{ id: CLEAR_FIELD, label: "Clear the field" }] : []),
  ]
}

/**
 * The fields "Set a field" offers: those set on the tasks of the current
 * list first, the most used first, then the rest by title. Archived,
 * read-only, calculated and unknown fields are left out. A field the tasks
 * already have shows their value, so it can be changed from here too.
 */
function settableFields(state: State, mode: PickerMode & { field: "set-field" }, matches: (text: string) => boolean): PickerOption[] {
  const uses = new Map<CustomFieldId, number>()
  for (const task of currentList(state)?.items ?? []) for (const value of task.fields) uses.set(value.id, (uses.get(value.id) ?? 0) + 1)
  const byTitle = (a: CustomField, b: CustomField) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true })
  return [...fieldDefs(state.customFields).values()]
    .filter((field) => isWritable(field) && matches(field.title))
    .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || byTitle(a, b))
    .map((field): PickerOption => {
      const current = sharedValue(state, { id: field.id, taskIds: mode.taskIds })
      return { id: field.id, label: field.title, detail: current === null ? kindLabel(field.kind) : fieldText(field.kind, current) }
    })
}

/** The options of the open picker after its filter. The status picker needs the open task. */
export function pickerOptions(state: State, mode: PickerMode): PickerOption[] {
  const matches = (text: string) => text.toLowerCase().includes(mode.query.toLowerCase())
  const people = () =>
    [...state.contacts.values()]
      .filter((contact) => contact.active || mode.chosen.includes(contact.id))
      .filter((contact) => matches(contact.name) || matches(contact.email ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((contact): PickerOption => ({ id: contact.id, label: contact.name, ...(contact.email ? { detail: contact.email } : {}) }))
  switch (mode.field) {
    case "status": {
      const task = openTask(state)
      const statuses = task ? statusChoices(state.workflows, task.statusId) : []
      return statuses
        .filter((status) => matches(status.name))
        .map((status) => ({ id: status.id, label: status.name, detail: status.group, color: status.color }))
    }
    case "importance":
    case "filter-importance":
      return IMPORTANCES.filter(matches).map((importance) => ({ id: importance, label: importance }))
    case "assignees":
      return people()
    case "filter-assignee":
      return [...(matches("Unassigned") ? [{ id: NOBODY, label: "Unassigned" }] : []), ...people()]
    case "filter-status": {
      // The statuses the loaded tasks use, in workflow order, plus any already chosen.
      const used = new Set<string>([...(currentList(state)?.items ?? []).map((task) => task.statusId), ...mode.chosen])
      return state.workflows
        .flatMap((workflow) => workflow.statuses)
        .filter((status) => used.has(status.id) && matches(status.name))
        .map((status) => ({ id: status.id, label: status.name, detail: status.group, color: status.color }))
    }
    case "filter-due":
      return [{ id: ANY_DUE, label: "Any date" }, ...DUE_RANGES.map((range) => ({ id: range, label: DUE_LABELS[range] }))].filter((option) => matches(option.label))
    case "columns":
      return COLUMN_KEYS.filter((column) => column !== "title" && matches(COLUMN_LABELS[column])).map((column) => ({ id: column, label: COLUMN_LABELS[column] }))
    case "folder":
    case "subtask-folder":
    case "file": {
      // A task is filed in folders and projects. The ones it is in already are left out.
      const current = new Set(mode.field === "file" ? (openTask(state)?.parentIds ?? []) : [])
      return folderOptions(state.spaces, state.trees, state.favorites, state.lastFolder, mode.field !== "file").filter(
        (option) => !current.has(option.id) && (matches(option.label) || matches(option.detail ?? "")),
      )
    }
    case "unfile": {
      const task = openTask(state)
      const folders = state.details.state === "ready" ? state.details.value.folders : []
      return folders.filter((folder) => task?.parentIds.includes(folder.id) && matches(folder.title)).map((folder) => ({ id: folder.id, label: folder.title }))
    }
    case "cancel": {
      const task = openTask(state)
      return (task ? cancelStatuses(state.workflows, task.statusId) : [])
        .filter((status) => matches(status.name))
        .map((status) => ({ id: status.id, label: status.name, detail: status.group, color: status.color }))
    }
    case "set-field":
      return settableFields(state, mode, matches)
    case "custom":
      return fieldOptions(state, mode, matches)
  }
}
