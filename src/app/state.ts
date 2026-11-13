import type { Profile } from "../auth/profile"
import type { CommentBody, Mention } from "../domain/comment"
import type { CustomField, FieldWrite } from "../domain/fields"
import type { Answers, FormAnswer, FormDefinition, FormSummary, Submission } from "../domain/forms"
import type { HistoryEntry, HistoryPage } from "../domain/history"
import type { AttachmentId, CommentId, CustomFieldId, CustomStatusId, LegacyItemId, RequestFormId, SpaceId, TaskId, UserId } from "../domain/ids"
import type { ListSpec } from "../domain/list"
import type { Attachment, Comment, Contact, FolderRef, InboxEntry, NewTask, Task, Workflow } from "../domain/model"
import type { TaskPatch } from "../domain/patch"
import type { Scope, ScopeKey } from "../domain/scope"
import type { Settings, ThemeName } from "../domain/settings"
import type { RowCursor } from "../domain/shape"
import type { Favorite, Space, SpaceTree } from "../domain/workspace"
import type { SessionFile } from "../persist/schemas"
import type { TaskPage, TaskQuery } from "../wrike/client"
import type { WrikeError } from "../wrike/errors"
import { viewPath, type NavPath } from "./nav"
import { restoreSession } from "./session"

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
/**
 * Pickers that create, file or close work: where a new task or subtask goes,
 * another folder for the open task, one of its folders to leave, and which
 * Cancelled status when its workflow has several.
 */
export const WORK_PICKERS = ["folder", "subtask-folder", "file", "unfile", "cancel"] as const
export type WorkPicker = (typeof WORK_PICKERS)[number]
/** Changes picked once for every marked task. */
export const BULK_PICKERS = ["status", "importance", "assignees", "cancel"] as const
export type BulkPicker = (typeof BULK_PICKERS)[number]
export type PickerField = TaskPicker | ListPicker | WorkPicker | "set-field" | "custom" | "bulk" | "request-form"

/**
 * A custom field being changed and the tasks the value goes to. The details
 * pane passes the open task. The editor never reads the task list itself, so
 * a caller can pass several and the one value chosen is written to each.
 */
export type FieldEdit = { id: CustomFieldId; taskIds: readonly TaskId[] }

/** A row the edit walk steps through: a field every task has, then the task's custom fields as drawn. */
export type EditRow = { kind: "core"; field: EditField } | { kind: "custom"; id: CustomFieldId }

type Typing = { kind: "edit-text"; draft: string; error?: string; origin: Origin }
/** A value typed in place. `custom` is a custom field, whose text is checked against its type. */
export type EditTextMode = Typing & ({ field: TextField } | { field: "custom"; edit: FieldEdit })

type Picking = { kind: "picker"; query: string; cursor: number; chosen: string[]; origin: Origin }
/** A list of choices that filters as it is typed into. `set-field` lists the custom fields to give the tasks, and `custom` is one field's choices. */
export type PickerMode = Picking &
  (
    /** `request-form` lists what Wrike's search found for the typed text. */
    | { field: TaskPicker | ListPicker | WorkPicker | "request-form" }
    | { field: "set-field"; taskIds: readonly TaskId[] }
    | { field: "custom"; edit: FieldEdit }
    /** A status, importance, assignees or Cancelled status for every marked task. `assigned` holds who was on all of them when it opened. */
    | { field: "bulk"; change: BulkPicker; tasks: BulkTask[]; assigned: UserId[] }
  )

export const TASK_COMMANDS = ["edit", "status", "importance", "assignees", "assign-me", "comment", "description", "set-field", "subtask", "delete", "file", "unfile", "cancel"] as const
/** What can be done to a task. On a list row the task is opened first, then the command runs. */
export type TaskCommand = (typeof TASK_COMMANDS)[number]

/** Where a field editor returns to when it closes. */
export type Origin = "browse" | "edit"

export type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "filter-input"; draft: string }
  | { kind: "edit"; field: number }
  | EditTextMode
  | PickerMode
  | Compose
  /** The title of a new task, typed in the list pane. The plan says where it goes. */
  | { kind: "new-task"; draft: string; plan: TaskPlan; error?: string }
  /** Asks before a comment or tasks are deleted, or marked tasks cancelled. Only `y` goes ahead. */
  | { kind: "confirm"; target: ConfirmTarget }
  | { kind: "palette"; query: string; cursor: number }
  | { kind: "help" }
  | FormMode

/**
 * A request form on screen. It loads, then is filled one field at a time:
 * `at` indexes the steps the answers lead through, and `at` past the last
 * step is the review that submits. A submission Wrike is still processing is
 * followed, never sent again.
 */
export type FormMode = { kind: "form"; form: FormSummary } & (
  | { phase: "loading" }
  | { phase: "failed"; error: WrikeError }
  | FormFilling
  | { phase: "processing"; submission: string }
)

/** `draft` is the text being typed into the current field and `cursor` the highlighted choice. `sending` is true while Wrike has the submission. */
export type FormFilling = { phase: "filling"; definition: FormDefinition; answers: Answers; at: number; draft: string; cursor: number; error?: string; sending: boolean }

/** Where a new task goes and who gets it. Only the title is still to come. */
export type TaskPlan = { folder: FolderRef; parent: { id: TaskId; title: string } | null; assignees: UserId[] }

/** A task named in a change made to several at once. */
export type BulkTask = { id: TaskId; title: string }

/** What a confirm asks about. A task names how many subtasks it leaves behind. Marked tasks are deleted, or cancelled each to its own status. */
export type ConfirmTarget =
  | { kind: "comment"; id: CommentId }
  | { kind: "task"; id: TaskId; title: string; subtasks: number }
  | { kind: "delete-tasks"; tasks: BulkTask[] }
  | { kind: "cancel-tasks"; plan: CancelPlan[] }

/** A marked task and the Cancelled status of its workflow. */
export type CancelPlan = BulkTask & { statusId: CustomStatusId }

/**
 * One change to several tasks. An update sends the same patch to each, in
 * batches Wrike takes. Cancel and delete go one request per task.
 */
export type BulkJob =
  | { kind: "update"; tasks: BulkTask[]; patch: TaskPatch; done: string; check?: FieldCheck }
  | { kind: "cancel"; plan: CancelPlan[] }
  | { kind: "delete"; tasks: BulkTask[] }

/** What a bulk job did, task by task. */
export type BulkOutcome = {
  saved: Task[]
  deleted: { task: BulkTask; result: "deleted" | "already-deleted" }[]
  failed: { task: BulkTask; error: WrikeError }[]
}

/** The comment box, for a new comment or for an edit of one of mine. */
export type Compose = {
  kind: "compose"
  draft: string
  /** The comment being edited, or null for a new one. */
  editing: CommentId | null
  /** The mentions in the draft. They move with its edits, and one the user types over becomes plain text. */
  mentions: Mention[]
  /** The highlighted suggestion while a mention is typed. */
  pick: number
  /** Where the `@` is whose suggestions Esc closed. They stay closed until another `@` is typed. */
  dismissed: number | null
}

/** An open task and what is drawn with it. `attachmentsError` says why the attachments are missing when their call failed. `folders` are the task's parents Wrike could name. */
export type Details = { task: Task; attachments: Attachment[]; attachmentsError?: WrikeError; comments: Comment[]; folders: FolderRef[] }

/** Something in the details pane that `]` and `[` step through, in the order the pane draws it: the attachments, then the comments. */
export type DetailsItem = { kind: "attachment"; id: AttachmentId } | { kind: "comment"; id: CommentId }
export type Clock = { now: string; today: string }
export type Flash = { tone: "info" | "error"; text: string }

/** What a response is checked against: `inbox`, `details`, `spaces`, `fields`, `tree:<spaceId>`, `list:<scopeKey>`, `history:<taskId>`, `forms` (the form search) or `form` (the open request form). */
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
  /** The details item `]` and `[` selected. It is cleared when another task opens. */
  selected: DetailsItem | null
  /** Field history by task, kept for the session. Pages arrive newest first, so `next` asks for older changes. */
  histories: ReadonlyMap<TaskId, Paged<HistoryEntry>>
  /** Thumbnails of image attachments, fetched the first time one is selected and kept in memory for the session. */
  previews: ReadonlyMap<AttachmentId, Loadable<Uint8Array>>
  contacts: Map<UserId, Contact>
  workflows: Workflow[]
  /** The account's custom field definitions, painted from the disk cache at launch and fetched with the contacts and workflows. */
  customFields: Loadable<CustomField[]>
  /** Space workflows load once, the first time a task's status is not in the account workflows. */
  spaceWorkflows: "unloaded" | "loading" | "loaded"
  mode: Mode
  flash: Flash | null
  /** The folder the last task of this session was created in, which the folder picker offers first. */
  lastFolder: FolderRef | null
  /** A task command pressed on a list row, held until that task's details arrive. */
  afterOpen: TaskCommand | null
  /** The latest request number per target. A response carrying an older number is dropped. */
  requests: ReadonlyMap<RequestKey, number>
  /** Tasks marked in the current list. The status, assignee, importance, field, cancel and delete commands act on all of them. Cleared when the scope changes. */
  marks: ReadonlySet<TaskId>
  /** What Wrike's form search found for the text typed into the form picker. */
  forms: Loadable<FormSummary[]>
}

export const LIST_LIMIT = 8
/** The next page loads when the cursor comes this close to the end of what is loaded. */
export const LOAD_AHEAD = 20
/** Changes per history page. A page is one MCP call, newest first, and older pages load only when asked for. */
export const HISTORY_PAGE = 50

export type OpenTarget = { kind: "task"; id: TaskId } | { kind: "legacy"; id: LegacyItemId }

/** Where a task list comes from: a query that pages, or a lookup that finds at most one task. */
export type TaskSource = TaskQuery | { kind: "permalink"; url: string } | { kind: "legacy-id"; id: LegacyItemId }

export type ScrollTo = "up" | "down" | "top" | "bottom"

export type Effect =
  | { kind: "load-reference" }
  | { kind: "load-space-workflows" }
  | { kind: "load-fields"; request: number }
  | { kind: "load-inbox"; request: number; includeRead: boolean }
  | { kind: "load-tasks"; request: number; key: ScopeKey; source: TaskSource; completed: boolean; pageToken: string | null }
  | { kind: "load-spaces"; request: number; cached: boolean }
  | { kind: "load-tree"; request: number; space: SpaceId; cached: boolean }
  | { kind: "load-details"; request: number; target: OpenTarget }
  | { kind: "load-history"; request: number; taskId: TaskId; item: LegacyItemId; pageToken: string | null }
  | { kind: "load-preview"; id: AttachmentId }
  /** Asks Wrike for a signed link to the file and hands it to the browser. */
  | { kind: "open-attachment"; id: AttachmentId; name: string }
  /** `check` names a custom field write, whose value is looked for in Wrike's answer. */
  | { kind: "update-task"; taskId: TaskId; patch: TaskPatch; done: string; check?: FieldCheck }
  /** `key` is the list the task was created from, which shows it. Null from the Inbox. */
  | { kind: "create-task"; key: ScopeKey | null; task: NewTask }
  | { kind: "delete-task"; id: TaskId; title: string }
  | { kind: "bulk"; job: BulkJob }
  /** Waits for typing to pause, then reports back so only the latest text is searched. */
  | { kind: "search-forms"; request: number; query: string }
  | { kind: "load-forms"; request: number; query: string }
  | { kind: "load-form"; request: number; form: FormSummary }
  | { kind: "submit-form"; request: number; form: RequestFormId; answers: FormAnswer[] }
  /** Asks Wrike every few seconds about a submission it was still processing, and never submits again. */
  | { kind: "poll-form"; request: number; submission: string }
  | { kind: "save-comment"; taskId: TaskId; editing: CommentId | null; body: CommentBody }
  | { kind: "delete-comment"; taskId: TaskId; id: CommentId }
  | { kind: "edit-description"; task: Task }
  | { kind: "compose-in-editor"; draft: string }
  | { kind: "open-url"; url: string }
  | { kind: "copy"; text: string }
  | { kind: "scroll"; pane: "details" | "help"; to: ScrollTo }
  | { kind: "save-favorites"; favorites: Favorite[] }
  | { kind: "save-config"; settings: Settings }
  | { kind: "cache-spaces"; spaces: Space[] }
  | { kind: "cache-tree"; space: SpaceId; tree: SpaceTree }
  | { kind: "cache-fields"; fields: CustomField[] }
  | { kind: "quit" }

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
  | { type: "mark" }
  | { type: "clear-marks" }
  | { type: "request-form" }
  | { type: "form-back" }
  | { type: "form-browser" }
  | { type: "filter-text" }
  | { type: "spec"; change: SpecChange }
  | { type: "pick"; field: ListPicker }
  | { type: "expand-all" }
  | { type: "collapse-all" }
  | { type: "scroll"; pane: "details" | "help"; to: ScrollTo }
  | { type: "select"; by: 1 | -1 }
  | { type: "unselect" }
  | { type: "toggle-history" }
  | { type: "older-history" }
  | { type: "edit-comment" }
  | { type: "open-attachment" }
  | { type: "delete-comment" }
  | { type: "mention-pick" }
  | { type: "mention-close" }
  | { type: "confirm" }
  | { type: "task"; command: TaskCommand }
  | { type: "new-task" }
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
  | { type: "clock"; clock: Clock }
  /** The text the editor gave back for the comment box, or null when the file came back unchanged. */
  | { type: "composed"; text: string | null }
  | { type: "reference-loaded"; result: Result<{ contacts: Contact[]; workflows: Workflow[] }> }
  | { type: "space-workflows-loaded"; result: Result<Workflow[]> }
  | { type: "fields-loaded"; request: number; result: Result<CustomField[]> }
  | { type: "inbox-loaded"; request: number; clock: Clock; result: Result<InboxEntry[]> }
  | { type: "tasks-loaded"; key: ScopeKey; request: number; clock: Clock; more: boolean; jump: boolean; result: Result<TaskPage> }
  | { type: "spaces-loaded"; request: number; from: "cache" | "wrike"; result: Result<Space[]> }
  | { type: "tree-loaded"; space: SpaceId; request: number; from: "cache" | "wrike"; result: Result<SpaceTree> }
  | { type: "details-loaded"; request: number; result: Result<Details> }
  | { type: "history-loaded"; taskId: TaskId; request: number; more: boolean; result: Result<HistoryPage> }
  | { type: "preview-loaded"; id: AttachmentId; result: Result<Uint8Array> }
  /** `folders` comes with a save that filed the task, named again by Wrike. `check` is the custom field write the save asked for. */
  | { type: "task-saved"; done: string; check?: FieldCheck; result: Result<Task>; folders?: FolderRef[] }
  | { type: "task-created"; key: ScopeKey | null; result: Result<Task> }
  | { type: "task-deleted"; id: TaskId; title: string; result: Result<"deleted" | "already-deleted"> }
  | { type: "bulk-done"; job: BulkJob; outcome: BulkOutcome }
  | { type: "forms-due"; request: number; query: string }
  | { type: "forms-loaded"; request: number; result: Result<FormSummary[]> }
  | { type: "form-loaded"; request: number; result: Result<FormDefinition> }
  /** `waiting` is a submission still processing when the polling gave up. */
  | { type: "form-submitted"; request: number; result: Result<Submission | { kind: "waiting" }> }
  | { type: "comment-saved"; taskId: TaskId; editing: CommentId | null; result: Result<Comment> }
  | { type: "comment-deleted"; taskId: TaskId; id: CommentId; result: Result<null> }

export type Update = [State, Effect[]]

/** A custom field write to look for in Wrike's answer, since Wrike answers 200 and drops a field that does not apply to the task. */
export type FieldCheck = { id: CustomFieldId; title: string; value: FieldWrite }

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

export type Boot = {
  settings: Settings
  favorites: Favorite[]
  readOnly: boolean
  flash: Flash | null
  /** The session to come back to, or null to start on the Inbox. */
  session: SessionFile | null
  /** The cached spaces list and the cached trees of the spaces the session has open. */
  spaces: Space[] | null
  /** The cached custom field definitions. */
  fields: CustomField[] | null
  trees: ReadonlyMap<SpaceId, SpaceTree>
}

export function initialState(profile: Profile, clock: Clock, boot: Boot): State {
  const fresh: State = {
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
    // A cached value is drawn as the last good one while the fetch that follows runs.
    spaces: boot.spaces ? { state: "loading", previous: boot.spaces } : { state: "idle" },
    trees: new Map([...boot.trees].map(([space, tree]) => [space, { state: "loading", previous: tree }])),
    nav: { cursor: viewPath("inbox"), expanded: new Set() },
    favorites: boot.favorites,
    missing: new Set(),
    openTaskId: null,
    details: { state: "idle" },
    selected: null,
    histories: new Map(),
    previews: new Map(),
    contacts: new Map(),
    workflows: [],
    customFields: boot.fields ? { state: "loading", previous: boot.fields } : { state: "idle" },
    spaceWorkflows: "unloaded",
    mode: { kind: "browse" },
    flash: boot.flash,
    lastFolder: null,
    afterOpen: null,
    requests: new Map(),
    marks: new Set(),
    forms: { state: "idle" },
  }
  return boot.session ? restoreSession(fresh, boot.session) : fresh
}
