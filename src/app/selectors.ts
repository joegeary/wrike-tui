import { editWindowLeft, mentionMatches, typedMention } from "../domain/comment"
import type { CustomStatusId, TaskId, UserId } from "../domain/ids"
import { COLUMN_KEYS, DUE_RANGES, NOBODY, type ColumnKey, type DueRange, type ListSpec } from "../domain/list"
import { findStatus, IMPORTANCES, statusChoices, type Comment, type Contact, type CustomStatus, type InboxEntry, type Task, type Workflow } from "../domain/model"
import { scopeKey, taskScopeKind, type Scope, type ScopeKey } from "../domain/scope"
import { defaultSpec } from "../domain/settings"
import { cursorIndex, shapeList, type ListRow, type RowId, type ShapeContext } from "../domain/shape"
import type { SpaceTree } from "../domain/workspace"
import { cursorRow, navRows, type NavRow, type SelectableNavRow } from "./nav"
import { shown, type Details, type DetailsItem, type ListView, type Loadable, type Mode, type Paged, type PickerField, type State } from "./state"

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

/** What `]` and `[` step through, in the order the details pane draws it. */
export function detailsItems(details: Details): DetailsItem[] {
  return details.comments.map((comment) => ({ kind: "comment", id: comment.id }))
}

export const sameItem = (a: DetailsItem | null, b: DetailsItem | null) => a !== null && b !== null && a.kind === b.kind && a.id === b.id

/** The selected comment of the open task, or null when nothing is selected or the selection is gone. */
export function selectedComment(state: State): Comment | null {
  const { selected } = state
  if (selected?.kind !== "comment" || state.details.state !== "ready") return null
  return state.details.value.comments.find((comment) => comment.id === selected.id) ?? null
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

export const MULTI_PICKERS: ReadonlySet<PickerField> = new Set<PickerField>([
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

/** The options of the open picker after its filter. The status picker needs the open task. */
export function pickerOptions(state: State, mode: Mode & { kind: "picker" }): PickerOption[] {
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
  }
}
