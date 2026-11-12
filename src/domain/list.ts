import type { CustomStatusId, UserId } from "./ids"
import type { Importance } from "./model"
import type { TaskScopeKind } from "./scope"

export const GROUP_KEYS = ["status", "importance", "assignee", "due", "folder", "none"] as const
export type GroupKey = (typeof GROUP_KEYS)[number]

export const SORT_KEYS = ["due", "importance", "status", "title", "updated", "created"] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortTerm = { key: SortKey; dir: "asc" | "desc" }

export const DUE_RANGES = ["overdue", "today", "week", "none"] as const
export type DueRange = (typeof DUE_RANGES)[number]

/** Stands in an assignee filter for a task nobody is assigned to. */
export const NOBODY = "nobody" as UserId

export type Filter =
  | { kind: "assignee"; ids: UserId[] }
  | { kind: "status"; ids: CustomStatusId[] }
  | { kind: "importance"; values: Importance[] }
  | { kind: "due"; range: DueRange }
  | { kind: "text"; query: string }

export const COLUMN_KEYS = ["importance", "title", "status", "assignees", "due", "start", "updated", "folder", "id"] as const
export type ColumnKey = (typeof COLUMN_KEYS)[number]

export type ListSpec = {
  group: GroupKey
  subgroup: GroupKey
  /** The first term decides, the rest break ties. */
  sort: SortTerm[]
  /** At most one filter of each kind. */
  filters: Filter[]
  /** Completed, cancelled and deferred tasks are fetched too. */
  completed: boolean
  columns: ColumnKey[]
}

const asc = (key: SortKey): SortTerm => ({ key, dir: "asc" })
const workspace: ListSpec = {
  group: "status",
  subgroup: "none",
  sort: [asc("importance"), asc("due"), asc("title")],
  filters: [],
  completed: false,
  columns: ["importance", "title", "assignees", "due"],
}

export const DEFAULT_SPECS: Record<TaskScopeKind, ListSpec> = {
  todo: { group: "due", subgroup: "none", sort: [asc("due"), asc("importance"), asc("title")], filters: [], completed: false, columns: ["importance", "title", "status", "due"] },
  search: { group: "none", subgroup: "none", sort: [{ key: "updated", dir: "desc" }], filters: [], completed: true, columns: ["importance", "title", "status", "folder", "updated"] },
  space: workspace,
  folder: workspace,
  project: workspace,
}

/** The spec with the filter of that kind replaced, or removed when `filter` is null. */
export function withFilter(spec: ListSpec, kind: Filter["kind"], filter: Filter | null): ListSpec {
  const others = spec.filters.filter((candidate) => candidate.kind !== kind)
  return { ...spec, filters: filter ? [...others, filter] : others }
}

/** Makes `key` the first sort term. Choosing the key that already leads flips its direction. */
export function withSort(spec: ListSpec, key: SortKey): ListSpec {
  const [first, ...rest] = spec.sort
  if (first?.key === key) return { ...spec, sort: [{ key, dir: first.dir === "asc" ? "desc" : "asc" }, ...rest] }
  return { ...spec, sort: [asc(key), ...spec.sort.filter((term) => term.key !== key)] }
}
