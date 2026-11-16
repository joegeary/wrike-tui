import { htmlToText } from "./description"
import { legacyItemId, taskId, type LegacyItemId, type TaskId } from "./ids"
import { dueDay, findStatus, permalinkId, type Importance, type InboxEntry, type InboxItemType, type InboxKind, type StatusGroup, type Task, type Workflow } from "./model"

/** One line of `wrike-tui tasks --mine --json`. */
export type TaskLine = {
  /** The number in the permalink, which Wrike shows people as the task ID. */
  id: string
  taskId: string
  title: string
  link: string
  importance: Importance
  status: string
  statusGroup: StatusGroup
  /** Wrike's name for the status color, such as "Blue". */
  color: string
  due: string | null
  updated: string
  folders: string[]
  subtasks: number
  description: string
}

/** One line of `wrike-tui inbox --json`. */
export type InboxLine = {
  id: string
  kind: InboxKind
  label: string
  unread: boolean
  ts: string
  item: { id: string; title: string; link: string; type: InboxItemType } | null
  author: string | null
  text: string | null
}

/** A task as `wrike-tui export` takes it: the API ID, or the number a permalink carries. */
export type TaskRef = { kind: "task"; id: TaskId } | { kind: "legacy"; id: LegacyItemId }

/** Sprint folders hold every task of a sprint, so naming them says nothing about where a task belongs. */
const SPRINT_FOLDER = "Sprint:"
/** Wrike's API IDs are letters and digits that start upper case, such as IEAAB2G6KQAAAA01 or MAAAAAER7i1K. */
const API_ID = /^[A-Z][A-Za-z0-9]{7,}$/

/**
 * The tasks latest change first, with their status named from `workflows`
 * and their folders from `folderTitles`. A folder with no title there is left out.
 */
export function taskLines(tasks: readonly Task[], workflows: readonly Workflow[], folderTitles: ReadonlyMap<string, string>): TaskLine[] {
  return tasks
    .toSorted((a, b) => b.updatedDate.localeCompare(a.updatedDate))
    .map((task) => {
      const status = findStatus([...workflows], task.statusId)
      return {
        id: permalinkId(task.permalink) ?? "",
        taskId: task.id,
        title: task.title.replace(/\s*[\t\n\r]\s*/g, " "),
        link: task.permalink,
        importance: task.importance,
        status: status?.name ?? "Unknown",
        statusGroup: task.statusGroup,
        color: status?.color ?? "Gray",
        due: dueDay(task.dates),
        updated: task.updatedDate.slice(0, 10),
        folders: task.parentIds.flatMap((id) => {
          const title = folderTitles.get(id)
          return title === undefined || title.startsWith(SPRINT_FOLDER) ? [] : [title]
        }),
        subtasks: task.subTaskIds.length,
        description: htmlToText(task.descriptionHtml),
      }
    })
}

/** The entries newest first. Entries from the same moment keep Wrike's order. */
export function inboxLines(entries: readonly InboxEntry[]): InboxLine[] {
  return entries
    .toSorted((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      unread: entry.unread,
      ts: entry.ts,
      item: entry.item ? { id: entry.item.legacyId, title: entry.item.title, link: entry.item.permalink, type: entry.item.baseType } : null,
      author: entry.author?.name ?? null,
      text: entry.commentText,
    }))
}

/** Null for text that is neither a task ID nor a permalink. */
export function parseTaskRef(input: string): TaskRef | null {
  const text = input.trim()
  const fromLink = /^https?:\/\//.test(text) ? permalinkId(text) : null
  const legacy = legacyItemId(fromLink ?? text)
  if (legacy) return { kind: "legacy", id: legacy }
  return API_ID.test(text) ? { kind: "task", id: taskId(text) } : null
}
