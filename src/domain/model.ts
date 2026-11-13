import type { AttachmentId, CommentId, CustomStatusId, LegacyItemId, TaskId, UserId } from "./ids"

export const STATUS_GROUPS = ["Active", "Completed", "Deferred", "Cancelled"] as const
export type StatusGroup = (typeof STATUS_GROUPS)[number]

export const IMPORTANCES = ["High", "Normal", "Low"] as const
export type Importance = (typeof IMPORTANCES)[number]

export type CustomStatus = {
  id: CustomStatusId
  name: string
  group: StatusGroup
  color: string
  hidden: boolean
}
export type Workflow = { id: string; name: string; statuses: CustomStatus[] }

/** Day strings are `YYYY-MM-DD`. Wrike's time of day is dropped at the wire. */
export type TaskDates =
  | { type: "Backlog" }
  | { type: "Milestone"; due: string }
  | { type: "Planned"; start: string; due: string; duration?: number }

export type Task = {
  id: TaskId
  title: string
  statusId: CustomStatusId
  statusGroup: StatusGroup
  importance: Importance
  dates: TaskDates
  assigneeIds: UserId[]
  parentIds: string[]
  subTaskIds: TaskId[]
  superTaskIds: TaskId[]
  permalink: string
  descriptionHtml: string
  createdDate: string
  updatedDate: string
}

export type Comment = { id: CommentId; authorId: UserId; text: string; createdDate: string }

/**
 * A file on a task. `storage` is where it lives: "Wrike" for an upload, or a
 * service such as "Google" or "Box" for a linked file. Size and content type
 * are missing for some linked files.
 */
export type Attachment = {
  id: AttachmentId
  name: string
  storage: string
  contentType: string | null
  size: number | null
  authorId: UserId
  createdDate: string
}

/** Wrike draws a thumbnail for an image it stores. */
export const hasPreview = (attachment: Attachment) => attachment.storage === "Wrike" && (attachment.contentType?.startsWith("image/") ?? false)

/** A deactivated person keeps a name, because old tasks still name them. Pickers offer active people only. */
export type Contact = { id: UserId; name: string; email: string | null; active: boolean }

export type InboxKind = "Mention" | "Assign" | "Comment" | "Status" | "Other"
export type InboxItemType = "TASK" | "FOLDER" | "PROJECT"
export type InboxEntry = {
  id: string
  kind: InboxKind
  /** The wire label, shown when `kind` is `Other`. */
  label: string
  unread: boolean
  ts: string
  item: { legacyId: LegacyItemId; title: string; baseType: InboxItemType; permalink: string } | null
  author: { name: string } | null
  commentText: string | null
}

export function startDay(dates: TaskDates): string | null {
  return dates.type === "Planned" ? dates.start : null
}

export function dueDay(dates: TaskDates): string | null {
  return dates.type === "Backlog" ? null : dates.due
}

export function findStatus(workflows: Workflow[], id: CustomStatusId): CustomStatus | null {
  for (const workflow of workflows) {
    const status = workflow.statuses.find((s) => s.id === id)
    if (status) return status
  }
  return null
}

/** The visible statuses a task can move to: those of the workflow that owns its current status. */
export function statusChoices(workflows: Workflow[], current: CustomStatusId): CustomStatus[] {
  const workflow = workflows.find((w) => w.statuses.some((s) => s.id === current))
  return workflow ? workflow.statuses.filter((s) => !s.hidden || s.id === current) : []
}

/** The number in `https://www.wrike.com/open.htm?id=4598459124`, which is what Wrike shows people as the task ID. */
export function permalinkId(permalink: string): string | null {
  return /[?&]id=(\d+)/.exec(permalink)?.[1] ?? null
}
