import type { Profile } from "../auth/profile"
import type { LegacyItemId, TaskId, UserId } from "../domain/ids"
import type { Comment, Contact, InboxEntry, Task, Workflow } from "../domain/model"
import type { TaskPatch } from "../domain/patch"
import type { SearchQuery } from "../domain/search"
import type { WrikeError } from "../wrike/errors"
import type { TaskCommand } from "./keymap"

export const VIEWS = ["inbox", "todo", "search"] as const
export type View = (typeof VIEWS)[number]
export const PANES = ["nav", "list", "details"] as const
export type Pane = (typeof PANES)[number]

export type Loadable<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T }
  | { state: "error"; error: WrikeError; previous?: T }

export type Result<T> = { ok: true; value: T } | { ok: false; error: WrikeError }

export const EDIT_FIELDS = ["title", "status", "importance", "assignees", "start", "due", "description"] as const
export type EditField = (typeof EDIT_FIELDS)[number]
export type TextField = "title" | "start" | "due"
export type PickerField = "status" | "importance" | "assignees"

/** Where a field editor returns to when it closes. */
export type Origin = "browse" | "edit"

export type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "edit"; field: number }
  | { kind: "edit-text"; field: TextField; draft: string; error?: string; origin: Origin }
  | { kind: "picker"; field: PickerField; query: string; cursor: number; chosen: string[]; origin: Origin }
  | { kind: "compose"; draft: string }
  | { kind: "help" }

export type Details = { task: Task; comments: Comment[]; folders: string[] }
export type Clock = { now: string; today: string }
export type Flash = { tone: "info" | "error"; text: string }
export type RequestKind = View | "details"

export type State = {
  profile: Profile
  clock: Clock
  view: View
  focus: Pane
  zoom: boolean
  lists: { inbox: Loadable<InboxEntry[]>; todo: Loadable<Task[]>; search: Loadable<Task[]> }
  includeRead: boolean
  searchQuery: string
  cursor: Record<View, number>
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
  requests: Record<RequestKind, number>
}

export type OpenTarget = { kind: "task"; id: TaskId } | { kind: "legacy"; id: LegacyItemId }

export type Effect =
  | { kind: "load-reference" }
  | { kind: "load-space-workflows" }
  | { kind: "load-inbox"; request: number; includeRead: boolean }
  | { kind: "load-todo"; request: number; user: UserId }
  | { kind: "search"; request: number; query: SearchQuery }
  | { kind: "load-details"; request: number; target: OpenTarget }
  | { kind: "update-task"; taskId: TaskId; patch: TaskPatch; done: string }
  | { kind: "add-comment"; taskId: TaskId; text: string }
  | { kind: "edit-description"; task: Task }
  | { kind: "compose-in-editor"; taskId: TaskId; draft: string }
  | { kind: "open-url"; url: string }
  | { kind: "copy"; text: string }
  | { kind: "scroll-details"; to: "up" | "down" | "top" | "bottom" }
  | { kind: "quit" }

export type Action =
  | { type: "key"; key: string }
  | { type: "draft"; text: string }
  | { type: "flash"; flash: Flash }
  | { type: "reference-loaded"; result: Result<{ contacts: Contact[]; workflows: Workflow[] }> }
  | { type: "space-workflows-loaded"; result: Result<Workflow[]> }
  | { type: "inbox-loaded"; request: number; clock: Clock; result: Result<InboxEntry[]> }
  | { type: "todo-loaded"; request: number; clock: Clock; result: Result<Task[]> }
  | { type: "search-loaded"; request: number; jump: boolean; result: Result<Task[]> }
  | { type: "details-loaded"; request: number; result: Result<Details> }
  | { type: "task-saved"; done: string; result: Result<Task> }
  | { type: "comment-added"; taskId: TaskId; result: Result<Comment> }

export type Update = [State, Effect[]]

export function initialState(profile: Profile, clock: Clock): State {
  return {
    profile,
    clock,
    view: "inbox",
    focus: "list",
    zoom: false,
    lists: { inbox: { state: "idle" }, todo: { state: "idle" }, search: { state: "idle" } },
    includeRead: false,
    searchQuery: "",
    cursor: { inbox: 0, todo: 0, search: 0 },
    openTaskId: null,
    details: { state: "idle" },
    contacts: new Map(),
    workflows: [],
    spaceWorkflows: "unloaded",
    mode: { kind: "browse" },
    flash: null,
    afterOpen: null,
    requests: { inbox: 0, todo: 0, search: 0, details: 0 },
  }
}

/** The value to show: the loaded one, or the last good one while a reload runs or after it failed. */
export function shown<T>(loadable: Loadable<T>): T | undefined {
  switch (loadable.state) {
    case "ready":
      return loadable.value
    case "loading":
    case "error":
      return loadable.previous
    case "idle":
      return undefined
  }
}
