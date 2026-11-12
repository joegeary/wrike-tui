import type { Brand, FolderId, SpaceId } from "./ids"

/** What the list pane shows. */
export type Scope =
  | { kind: "inbox" }
  | { kind: "todo" }
  | { kind: "search"; query: string }
  | { kind: "space"; id: SpaceId; title: string }
  | { kind: "folder"; id: FolderId; title: string; project: boolean }

/** `inbox`, `todo`, `search:<query>`, `space:<id>` or `folder:<id>`. Lists and their shaping are kept under it. */
export type ScopeKey = Brand<string, "ScopeKey">

export function scopeKey(scope: Scope): ScopeKey {
  switch (scope.kind) {
    case "inbox":
    case "todo":
      return scope.kind as ScopeKey
    case "search":
      return `search:${scope.query}` as ScopeKey
    case "space":
    case "folder":
      return `${scope.kind}:${scope.id}` as ScopeKey
  }
}

export const TASK_SCOPE_KINDS = ["todo", "search", "space", "folder", "project"] as const
/** The kinds of scope that list tasks. Each has its own default shaping. */
export type TaskScopeKind = (typeof TASK_SCOPE_KINDS)[number]
export type TaskScope = Exclude<Scope, { kind: "inbox" }>

export function taskScopeKind(scope: TaskScope): TaskScopeKind {
  return scope.kind === "folder" && scope.project ? "project" : scope.kind
}

export function scopeTitle(scope: Scope): string {
  switch (scope.kind) {
    case "inbox":
      return "Inbox"
    case "todo":
      return "My to-do"
    case "search":
      return `Search: ${scope.query}`
    case "space":
    case "folder":
      return scope.title
  }
}
