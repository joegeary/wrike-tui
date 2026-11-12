import { bucketOf, BUCKETS } from "./buckets"
import type { Brand, CustomStatusId, TaskId, UserId } from "./ids"
import { NOBODY, type Filter, type GroupKey, type ListSpec, type SortKey, type SortTerm } from "./list"
import { dueDay, IMPORTANCES, type Task } from "./model"

/** What a row is, apart from where it is: `task:<id>`, `group:<key>`, `more`. A second drawing of one task ends in `#2`. */
export type RowId = Brand<string, "RowId">

export type ListRow =
  | { kind: "group"; id: RowId; key: string; label: string; count: number; depth: 0 | 1; collapsed: boolean }
  | { kind: "task"; id: RowId; task: Task; depth: number; hasChildren: boolean; expanded: boolean }
  | { kind: "more"; id: RowId; label: string }

export type ShapeContext = {
  today: string
  /** A status's name and its place in its workflow. */
  statuses: ReadonlyMap<CustomStatusId, { name: string; order: number }>
  contacts: ReadonlyMap<UserId, { name: string }>
  /** Titles of the folders drawn in the loaded space trees, by ID. */
  folders: ReadonlyMap<string, string>
  /** Keys of the groups that are closed. */
  collapsed: ReadonlySet<string>
  /** Tasks whose subtasks are open. */
  expanded: ReadonlySet<TaskId>
  /** Whether Wrike has more pages, and whether one is on its way. */
  more: "loading" | "available" | null
}

export const taskRowId = (id: TaskId) => `task:${id}` as RowId
export const groupRowId = (key: string) => `group:${key}` as RowId
export const MORE_ROW = "more" as RowId

type Group = { key: string; label: string; order: number }

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
const WEEK: ReadonlySet<string> = new Set(["Today", "This week"])

function passes(task: Task, filter: Filter, today: string): boolean {
  switch (filter.kind) {
    case "assignee":
      return filter.ids.some((id) => (id === NOBODY ? task.assigneeIds.length === 0 : task.assigneeIds.includes(id)))
    case "status":
      return filter.ids.includes(task.statusId)
    case "importance":
      return filter.values.includes(task.importance)
    case "text":
      return task.title.toLowerCase().includes(filter.query.toLowerCase())
    case "due": {
      const bucket = bucketOf(task, today)
      if (filter.range === "overdue") return bucket === "Overdue"
      if (filter.range === "today") return bucket === "Today"
      return filter.range === "week" ? WEEK.has(bucket) : bucket === "No date"
    }
  }
}

/** The groups a task is drawn in. Only an assignee grouping can give more than one. */
function groupsOf(task: Task, by: GroupKey, ctx: ShapeContext): Group[] {
  switch (by) {
    case "none":
      return []
    case "status": {
      const status = ctx.statuses.get(task.statusId)
      return [{ key: `status:${task.statusId}`, label: status?.name ?? task.statusGroup, order: status?.order ?? Number.MAX_SAFE_INTEGER }]
    }
    case "importance":
      return [{ key: `importance:${task.importance}`, label: task.importance, order: IMPORTANCES.indexOf(task.importance) }]
    case "assignee":
      if (task.assigneeIds.length === 0) return [{ key: `assignee:${NOBODY}`, label: "Unassigned", order: 1 }]
      return task.assigneeIds.map((id) => ({ key: `assignee:${id}`, label: ctx.contacts.get(id)?.name ?? "Unknown user", order: 0 }))
    case "due": {
      const bucket = bucketOf(task, ctx.today)
      return [{ key: `due:${bucket}`, label: bucket, order: BUCKETS.indexOf(bucket) }]
    }
    case "folder": {
      const parent = task.parentIds.find((id) => ctx.folders.has(id))
      return parent === undefined ? [{ key: "folder:other", label: "Other folders", order: 1 }] : [{ key: `folder:${parent}`, label: ctx.folders.get(parent)!, order: 0 }]
    }
  }
}

function compareBy(key: SortKey, ctx: ShapeContext): (a: Task, b: Task) => number {
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  switch (key) {
    case "due":
      return (a, b) => text(dueDay(a.dates) ?? "", dueDay(b.dates) ?? "")
    case "importance":
      return (a, b) => IMPORTANCES.indexOf(a.importance) - IMPORTANCES.indexOf(b.importance)
    case "status": {
      const order = (task: Task) => ctx.statuses.get(task.statusId)?.order ?? Number.MAX_SAFE_INTEGER
      return (a, b) => order(a) - order(b)
    }
    case "title":
      return (a, b) => collator.compare(a.title, b.title)
    case "updated":
      return (a, b) => text(a.updatedDate, b.updatedDate)
    case "created":
      return (a, b) => text(a.createdDate, b.createdDate)
  }
}

function comparator(sort: SortTerm[], ctx: ShapeContext): (a: Task, b: Task) => number {
  const terms = sort.map((term) => {
    const compare = compareBy(term.key, ctx)
    const sign = term.dir === "asc" ? 1 : -1
    // A task with no due date sorts after every dated one, in either direction.
    const missing = term.key === "due" ? (task: Task) => dueDay(task.dates) === null : null
    return (a: Task, b: Task) => (missing && missing(a) !== missing(b) ? (missing(a) ? 1 : -1) : compare(a, b) * sign)
  })
  return (a, b) => {
    for (const term of terms) {
      const order = term(a, b)
      if (order !== 0) return order
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
}

/** The tasks split by one grouping, in the grouping's display order. */
function split(tasks: Task[], by: GroupKey, ctx: ShapeContext): { group: Group; tasks: Task[] }[] {
  const buckets = new Map<string, { group: Group; tasks: Task[] }>()
  for (const task of tasks) {
    for (const group of groupsOf(task, by, ctx)) {
      const bucket = buckets.get(group.key)
      if (bucket) bucket.tasks.push(task)
      else buckets.set(group.key, { group, tasks: [task] })
    }
  }
  return [...buckets.values()].sort((a, b) => a.group.order - b.group.order || collator.compare(a.group.label, b.group.label))
}

/**
 * The rows of a task list: filtered, with subtasks nested under a parent that
 * is in the list, then grouped, subgrouped and sorted. Grouping and sorting
 * act on top-level tasks. Subtasks keep the same sort inside their parent.
 */
export function shapeList(tasks: Task[], spec: ListSpec, ctx: ShapeContext): ListRow[] {
  const visible = tasks.filter((task) => spec.filters.every((filter) => passes(task, filter, ctx.today)))
  const ids = new Set(visible.map((task) => task.id))
  const order = comparator(spec.sort, ctx)

  const children = new Map<TaskId, Task[]>()
  const top: Task[] = []
  for (const task of visible) {
    const parent = task.superTaskIds.find((id) => ids.has(id) && id !== task.id)
    if (parent === undefined) top.push(task)
    else if (children.has(parent)) children.get(parent)!.push(task)
    else children.set(parent, [task])
  }
  // A loop of subtasks has no top-level member, and its tasks must still be drawn.
  const reachable = new Set<TaskId>()
  const reach = (task: Task) => {
    if (reachable.has(task.id)) return
    reachable.add(task.id)
    children.get(task.id)?.forEach(reach)
  }
  top.forEach(reach)
  for (const task of visible) {
    if (reachable.has(task.id)) continue
    top.push(task)
    reach(task)
  }

  const rows: ListRow[] = []
  const drawn = new Map<TaskId, number>()
  const emit = (task: Task, depth: number, above: ReadonlySet<TaskId>) => {
    const times = (drawn.get(task.id) ?? 0) + 1
    drawn.set(task.id, times)
    const nested = above.has(task.id) ? [] : (children.get(task.id) ?? [])
    const expanded = nested.length > 0 && ctx.expanded.has(task.id)
    rows.push({ kind: "task", id: (times === 1 ? taskRowId(task.id) : `${taskRowId(task.id)}#${times}`) as RowId, task, depth, hasChildren: nested.length > 0, expanded })
    if (!expanded) return
    const within = new Set(above).add(task.id)
    for (const child of nested.toSorted(order)) emit(child, depth + 1, within)
  }
  const emitAll = (list: Task[], depth: number) => list.toSorted(order).forEach((task) => emit(task, depth, new Set()))

  const subgroup = spec.subgroup === spec.group ? "none" : spec.subgroup
  if (spec.group === "none") {
    emitAll(top, 0)
  } else {
    for (const { group, tasks: grouped } of split(top, spec.group, ctx)) {
      const collapsed = ctx.collapsed.has(group.key)
      rows.push({ kind: "group", id: groupRowId(group.key), key: group.key, label: group.label, count: grouped.length, depth: 0, collapsed })
      if (collapsed) continue
      if (subgroup === "none") {
        emitAll(grouped, 0)
        continue
      }
      for (const { group: sub, tasks: subgrouped } of split(grouped, subgroup, ctx)) {
        const key = `${group.key}/${sub.key}`
        const closed = ctx.collapsed.has(key)
        rows.push({ kind: "group", id: groupRowId(key), key, label: sub.label, count: subgrouped.length, depth: 1, collapsed: closed })
        if (!closed) emitAll(subgrouped, 0)
      }
    }
  }
  if (ctx.more) rows.push({ kind: "more", id: MORE_ROW, label: ctx.more === "loading" ? "Loading more..." : "Load more" })
  return rows
}

/** Where the cursor is, as the row's identity plus the index it was last seen at. */
export type RowCursor = { id: RowId; index: number }

/**
 * The index of the cursor's row: the row with its identity, else another
 * drawing of the same task, else the row now at its old index. With no cursor
 * yet, the first task.
 */
export function cursorIndex(rows: readonly { id: RowId; kind: string }[], cursor: RowCursor | null): number {
  if (rows.length === 0) return -1
  if (cursor === null) return Math.max(0, rows.findIndex((row) => row.kind !== "group"))
  const exact = rows.findIndex((row) => row.id === cursor.id)
  if (exact >= 0) return exact
  const base = cursor.id.split("#")[0]
  const same = rows.findIndex((row) => row.id.split("#")[0] === base)
  return same >= 0 ? same : Math.min(cursor.index, rows.length - 1)
}
