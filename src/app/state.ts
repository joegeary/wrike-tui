import type { Profile } from "../auth/profile"
import type { LegacyItemId, SpaceId, TaskId, UserId } from "../domain/ids"
import type { ListSpec } from "../domain/list"
import type { Comment, Contact, InboxEntry, Task, Workflow } from "../domain/model"
import type { TaskPatch } from "../domain/patch"
import type { Scope, ScopeKey } from "../domain/scope"
import type { Settings, ThemeName } from "../domain/settings"
import type { RowCursor } from "../domain/shape"
import type { Favorite, Space, SpaceTree } from "../domain/workspace"
import type { TaskPage, TaskQuery } from "../wrike/client"
import type { WrikeError } from "../wrike/errors"
import { viewPath, type NavPath } from "./nav"

export const PANES = ["nav", "list", "details"] as const
export type Pane = (typeof PANES)[number]

export type Loadable<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T }
  | { state: "error"; error: WrikeError; previous?: T }

export type Result<T> = { ok: true; value: T } | { ok: false; error: WrikeError }

/** A list that arrives a page at a time. `next` is Wrike's token for the page after the last one loaded. */
export type Paged<T> = {
  items: T[]
  next: string | null
  loading: "first" | "more" | null
  error: WrikeError | null
}

/** How one scope's list is shaped and where its cursor is. */
export type ListView = {
  spec: ListSpec
  cursor: RowCursor | null
  /** Keys of the closed groups. */
  collapsed: ReadonlySet<string>
  /** Tasks whose subtasks are open. */
  expanded: ReadonlySet<TaskId>
}

export const EDIT_FIELDS = ["title", "status", "importance", "assignees", "start", "due", "description"] as const
export type EditField = (typeof EDIT_FIELDS)[number]
export type TextField = "title" | "start" | "due"
export const TASK_PICKERS = ["status", "importance", "assignees"] as const
export type TaskPicker = (typeof TASK_PICKERS)[number]
export const LIST_PICKERS = ["filter-assignee", "filter-status", "filter-importance", "filter-due", "columns"] as const
export type ListPicker = (typeof LIST_PICKERS)[number]
export type PickerField = TaskPicker | ListPicker

export const TASK_COMMANDS = ["edit", "status", "importance", "assignees", "assign-me", "comment", "description"] as const
/** What can be done to a task. On a list row the task is opened first, then the command runs. */
export type TaskCommand = (typeof TASK_COMMANDS)[number]

/** Where a field editor returns to when it closes. */
export type Origin = "browse" | "edit"

export type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "filter-input"; draft: string }
  | { kind: "edit"; field: number }
  | { kind: "edit-text"; field: TextField; draft: string; error?: string; origin: Origin }
  | { kind: "picker"; field: PickerField; query: string; cursor: number; chosen: string[]; origin: Origin }
  | { kind: "compose"; draft: string }
  | { kind: "palette"; query: string; cursor: number }
  | { kind: "help" }

export type Details = { task: Task; comments: Comment[]; folders: string[] }
export type Clock = { now: string; today: string }
export type Flash = { tone: "info" | "error"; text: string }

/** What a response is checked against: `inbox`, `details`, `spaces`, `tree:<spaceId>` or `list:<scopeKey>`. */
export type RequestKey = string

export type State = {
  profile: Profile
  /** Every write is refused before it is sent. */
  readOnly: boolean
  clock: Clock
  /** The config file's content. The theme and the list defaults are read from here. */
  settings: Settings
  scope: Scope
  focus: Pane
  zoom: boolean
  inbox: Loadable<InboxEntry[]>
  includeRead: boolean
  /** Task lists by scope, least recently shown first. The oldest drop off past `LIST_LIMIT`. */
  lists: ReadonlyMap<ScopeKey, Paged<Task>>
  views: ReadonlyMap<ScopeKey, ListView>
  /** The last search, which is what the Search row opens. */
  lastSearch: string
  spaces: Loadable<Space[]>
  trees: ReadonlyMap<SpaceId, Loadable<SpaceTree>>
  nav: { cursor: NavPath; expanded: ReadonlySet<NavPath> }
  favorites: Favorite[]
  /** Keys of favorites Wrike answered 404 for. */
  missing: ReadonlySet<string>
  openTaskId: TaskId | null
  details: Loadable<Details>
  contacts: Map<UserId, Contact>
  workflows: Workflow[]
  /** Space workflows load once, the first time a task's status is not in the account workflows. */
  spaceWorkflows: "unloaded" | "loading" | "loaded"
  mode: Mode
  flash: Flash | null
  /** A task command pressed on a list row, held until that task's details arrive. */
  afterOpen: TaskCommand | null
  /** The latest request number per target. A response carrying an older number is dropped. */
  requests: ReadonlyMap<RequestKey, number>
}

export const LIST_LIMIT = 8
/** The next page loads when the cursor comes this close to the end of what is loaded. */
export const LOAD_AHEAD = 20

export type OpenTarget = { kind: "task"; id: TaskId } | { kind: "legacy"; id: LegacyItemId }

/** Where a task list comes from: a query that pages, or a lookup that finds at most one task. */
export type TaskSource = TaskQuery | { kind: "permalink"; url: string } | { kind: "legacy-id"; id: LegacyItemId }

export type ScrollTo = "up" | "down" | "top" | "bottom"

export type Effect =
  | { kind: "load-reference" }
  | { kind: "load-space-workflows" }
  | { kind: "load-inbox"; request: number; includeRead: boolean }
  | { kind: "load-tasks"; request: number; key: ScopeKey; source: TaskSource; completed: boolean; pageToken: string | null }
  | { kind: "load-spaces"; request: number; cached: boolean }
  | { kind: "load-tree"; request: number; space: SpaceId; cached: boolean }
  | { kind: "load-details"; request: number; target: OpenTarget }
  | { kind: "update-task"; taskId: TaskId; patch: TaskPatch; done: string }
  | { kind: "add-comment"; taskId: TaskId; text: string }
  | { kind: "edit-description"; task: Task }
  | { kind: "compose-in-editor"; taskId: TaskId; draft: string }
  | { kind: "open-url"; url: string }
  | { kind: "copy"; text: string }
  | { kind: "scroll"; pane: "details" | "help"; to: ScrollTo }
  | { kind: "save-favorites"; favorites: Favorite[] }
  | { kind: "save-config"; settings: Settings }
  | { kind: "cache-spaces"; spaces: Space[] }
  | { kind: "cache-tree"; space: SpaceId; tree: SpaceTree }
  | { kind: "quit" }

/** A change to the shaping of the current list. */
export type SpecChange =
  | { set: "group"; group: ListSpec["group"] }
  | { set: "subgroup"; group: ListSpec["subgroup"] }
  | { set: "sort"; key: ListSpec["sort"][number]["key"] }
  | { set: "reverse" }
  | { set: "completed" }
  | { set: "clear-filters" }
  | { set: "mine" }

/** What a command asks the reducer to do. A key press and the palette both end in one of these. */
export type Intent =
  | { type: "focus"; pane: Pane | "left" | "right" }
  | { type: "show"; scope: Scope }
  | { type: "search" }
  | { type: "refresh" }
  | { type: "zoom" }
  | { type: "help" }
  | { type: "palette" }
  | { type: "quit" }
  | { type: "nav-move"; by: number }
  | { type: "nav-open" }
  | { type: "nav-toggle" }
  | { type: "favorite" }
  | { type: "favorite-move"; by: -1 | 1 }
  | { type: "move"; to: ScrollTo }
  | { type: "open" }
  | { type: "toggle-row" }
  | { type: "toggle-read" }
  | { type: "filter-text" }
  | { type: "spec"; change: SpecChange }
  | { type: "pick"; field: ListPicker }
  | { type: "expand-all" }
  | { type: "collapse-all" }
  | { type: "scroll"; pane: "details" | "help"; to: ScrollTo }
  | { type: "task"; command: TaskCommand }
  | { type: "link"; act: "browser" | "copy-url" | "copy-id" }
  | { type: "field-move"; by: number }
  | { type: "field-open" }
  | { type: "choice-move"; by: number }
  | { type: "choice-toggle" }
  | { type: "erase" }
  | { type: "compose-editor" }
  | { type: "submit" }
  | { type: "cancel" }
  | { type: "theme"; name: ThemeName }
  | { type: "save-defaults" }

export type Action =
  | Intent
  | { type: "key"; key: string }
  | { type: "draft"; text: string }
  | { type: "flash"; flash: Flash }
  | { type: "reference-loaded"; result: Result<{ contacts: Contact[]; workflows: Workflow[] }> }
  | { type: "space-workflows-loaded"; result: Result<Workflow[]> }
  | { type: "inbox-loaded"; request: number; clock: Clock; result: Result<InboxEntry[]> }
  | { type: "tasks-loaded"; key: ScopeKey; request: number; clock: Clock; more: boolean; jump: boolean; result: Result<TaskPage> }
  | { type: "spaces-loaded"; request: number; from: "cache" | "wrike"; result: Result<Space[]> }
  | { type: "tree-loaded"; space: SpaceId; request: number; from: "cache" | "wrike"; result: Result<SpaceTree> }
  | { type: "details-loaded"; request: number; result: Result<Details> }
  | { type: "task-saved"; done: string; result: Result<Task> }
  | { type: "comment-added"; taskId: TaskId; result: Result<Comment> }

export type Update = [State, Effect[]]

/** The value to show: the loaded one, or the last good one while a reload runs or after it failed. */
export function shown<T>(loadable: Loadable<T> | undefined): T | undefined {
  switch (loadable?.state) {
    case "ready":
      return loadable.value
    case "loading":
    case "error":
      return loadable.previous
    case "idle":
    case undefined:
      return undefined
  }
}

/** What a launch brings from disk. */
export type Boot = { settings: Settings; favorites: Favorite[]; readOnly: boolean; flash: Flash | null }

export function initialState(profile: Profile, clock: Clock, boot: Boot): State {
  return {
    profile,
    readOnly: boot.readOnly,
    clock,
    settings: boot.settings,
    scope: { kind: "inbox" },
    focus: "list",
    zoom: false,
    inbox: { state: "idle" },
    includeRead: false,
    lists: new Map(),
    views: new Map(),
    lastSearch: "",
    spaces: { state: "idle" },
    trees: new Map(),
    nav: { cursor: viewPath("inbox"), expanded: new Set() },
    favorites: boot.favorites,
    missing: new Set(),
    openTaskId: null,
    details: { state: "idle" },
    contacts: new Map(),
    workflows: [],
    spaceWorkflows: "unloaded",
    mode: { kind: "browse" },
    flash: boot.flash,
    afterOpen: null,
    requests: new Map(),
  }
}
