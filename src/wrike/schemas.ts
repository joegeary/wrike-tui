import { z } from "zod"
import { attachmentId, commentId, customStatusId, folderId, legacyItemId, spaceId, taskId, userId, type FolderId, type SpaceId } from "../domain/ids"
import {
  IMPORTANCES,
  STATUS_GROUPS,
  type Attachment,
  type Comment,
  type Contact,
  type InboxEntry,
  type InboxKind,
  type Task,
  type TaskDates,
  type Workflow,
} from "../domain/model"
import type { HistoryChange, HistoryEntry } from "../domain/history"
import { SPACE_ACCESS, type FolderNode, type Space, type SpaceTree } from "../domain/workspace"
import { WrikeFailure } from "./errors"

const day = z.string().transform((value) => value.slice(0, 10))

const Dates = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("Backlog") }),
    z.object({ type: z.literal("Milestone"), due: day }),
    z.object({ type: z.literal("Planned"), start: day, due: day, duration: z.number().optional() }),
  ])
  .transform((dates): TaskDates => dates)

export const TaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(STATUS_GROUPS),
    customStatusId: z.string(),
    importance: z.enum(IMPORTANCES),
    dates: Dates,
    responsibleIds: z.array(z.string()).default([]),
    parentIds: z.array(z.string()).default([]),
    subTaskIds: z.array(z.string()).default([]),
    superTaskIds: z.array(z.string()).default([]),
    permalink: z.string(),
    description: z.string().default(""),
    createdDate: z.string(),
    updatedDate: z.string(),
  })
  .transform(
    (wire): Task => ({
      id: taskId(wire.id),
      title: wire.title,
      statusId: customStatusId(wire.customStatusId),
      statusGroup: wire.status,
      importance: wire.importance,
      dates: wire.dates,
      assigneeIds: wire.responsibleIds.map(userId),
      parentIds: wire.parentIds,
      subTaskIds: wire.subTaskIds.map(taskId),
      superTaskIds: wire.superTaskIds.map(taskId),
      permalink: wire.permalink,
      descriptionHtml: wire.description,
      createdDate: wire.createdDate,
      updatedDate: wire.updatedDate,
    }),
  )

export const CommentSchema = z
  .object({ id: z.string(), authorId: z.string(), text: z.string(), createdDate: z.string() })
  .transform((wire): Comment => ({ ...wire, id: commentId(wire.id), authorId: userId(wire.authorId) }))

export const AttachmentSchema = z
  .object({
    id: z.string(),
    authorId: z.string(),
    name: z.string(),
    createdDate: z.string(),
    type: z.string().default("Wrike"),
    contentType: z.string().nullish(),
    size: z.number().nullish(),
  })
  .transform(
    (wire): Attachment => ({
      id: attachmentId(wire.id),
      name: wire.name,
      storage: wire.type,
      contentType: wire.contentType ?? null,
      size: wire.size ?? null,
      authorId: userId(wire.authorId),
      createdDate: wire.createdDate,
    }),
  )

export const AttachmentUrlSchema = z.object({ url: z.string() })

export const ContactSchema = z.object({
  id: z.string(),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  type: z.string(),
  deleted: z.boolean().default(false),
  primaryEmail: z.string().optional(),
  profiles: z.array(z.object({ accountId: z.string(), email: z.string().optional() })).default([]),
})
export type ContactWire = z.infer<typeof ContactSchema>

export function contactFromWire(wire: ContactWire): Contact {
  const name = `${wire.firstName} ${wire.lastName}`.replace(/\s+/g, " ").trim()
  const email = wire.primaryEmail ?? wire.profiles[0]?.email ?? null
  return { id: userId(wire.id), name: name || email || wire.id, email, active: !wire.deleted }
}

export const WorkflowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    customStatuses: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        group: z.enum(STATUS_GROUPS),
        color: z.string().default("Gray"),
        hidden: z.boolean().default(false),
      }),
    ),
  })
  .transform(
    (wire): Workflow => ({
      id: wire.id,
      name: wire.name,
      statuses: wire.customStatuses.map((status) => ({ ...status, id: customStatusId(status.id) })),
    }),
  )

export const SpaceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    // An access type this version does not know is drawn like a private space.
    accessType: z.enum(SPACE_ACCESS).catch("Private"),
    archived: z.boolean().default(false),
  })
  .transform((wire): Space & { archived: boolean } => ({ id: spaceId(wire.id), title: wire.title, access: wire.accessType, archived: wire.archived }))

const FolderNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  childIds: z.array(z.string()).default([]),
  scope: z.string().default("WsFolder"),
  project: z.object({ customStatusId: z.string().optional(), ownerIds: z.array(z.string()).default([]) }).optional(),
})

/** A space's folders in tree mode. The node with the space's ID is the root. Recycle Bin folders are left out. */
export function parseSpaceTree(items: unknown[], space: SpaceId): SpaceTree {
  const tree: SpaceTree = new Map()
  for (const wire of parseAll(FolderNodeSchema, items, "folders")) {
    if (wire.scope === "RbFolder") continue
    const id = folderId(wire.id)
    const node: FolderNode = {
      id,
      title: wire.title,
      childIds: wire.childIds.map(folderId),
      kind: wire.id === space ? "space" : wire.project ? "project" : "folder",
      project: wire.project
        ? { statusId: wire.project.customStatusId ? customStatusId(wire.project.customStatusId) : null, ownerIds: wire.project.ownerIds.map(userId) }
        : null,
    }
    tree.set(id, node)
  }
  if (!tree.has(space as string as FolderId)) throw new WrikeFailure({ kind: "invalid", message: "Unexpected folders from Wrike (the space is not in its own tree)" })
  return tree
}
export const FolderSchema = z.object({ id: z.string(), title: z.string() })
export const LegacyIdSchema = z.object({ id: z.string(), apiV2Id: z.string() })

const INBOX_KINDS: Record<string, InboxKind> = {
  Mention: "Mention",
  Assign: "Assign",
  EntitiesAssigned: "Assign",
  Comment: "Comment",
  Status: "Status",
}
const ITEM_TYPES = ["TASK", "FOLDER", "PROJECT"] as const

const InboxEntrySchema = z
  .object({
    notificationId: z.string(),
    notificationType: z.string(),
    isUnread: z.boolean().default(false),
    ts: z.string(),
    item: z
      .object({
        id: z.string().nullish(),
        title: z.string().nullish(),
        baseType: z.string().nullish(),
        permalink: z.string().nullish(),
      })
      .nullish(),
    author: z.object({ name: z.string().nullish() }).nullish(),
    commentText: z.string().nullish(),
  })
  .transform((wire): InboxEntry => {
    const legacyId = wire.item?.id ? legacyItemId(wire.item.id) : null
    const baseType = ITEM_TYPES.find((type) => type === wire.item?.baseType)
    return {
      id: wire.notificationId,
      kind: INBOX_KINDS[wire.notificationType] ?? "Other",
      label: wire.notificationType,
      unread: wire.isUnread,
      ts: wire.ts,
      // Reports, dashboards and approvals arrive with no item id, so there is nothing to open.
      item:
        legacyId && baseType && wire.item?.permalink
          ? { legacyId, title: wire.item.title ?? "(untitled)", baseType, permalink: wire.item.permalink }
          : null,
      author: wire.author?.name ? { name: wire.author.name } : null,
      commentText: wire.commentText || null,
    }
  })

export const InboxSchema = z.object({ inbox: z.array(InboxEntrySchema) })

/** Wrike's times as the rest of the app writes them: ISO in UTC, to the second. A time without a zone is UTC. */
function isoTime(raw: string | number): string {
  const text = typeof raw === "string" && !/(?:Z|[+-]\d\d:?\d\d)$/.test(raw) ? `${raw}Z` : raw
  const time = new Date(text)
  return Number.isNaN(time.getTime()) ? String(raw) : time.toISOString().replace(/\.\d+Z$/, "Z")
}

type Values<T> = { from: T | null; to: T | null }

/**
 * A field's old and new value under `keys`. A null or empty value counts as
 * absent, and a payload with neither is not this shape. So the field reads as
 * cleared only when the payload names an old value and no new one.
 */
function values<T>(payload: unknown, keys: [string, string], value: z.ZodType<T>, empty: (value: T) => boolean = () => false): Values<T> | null {
  const [oldKey, newKey] = keys
  const parsed = z.object({ [oldKey]: value.nullish(), [newKey]: value.nullish() }).safeParse(payload)
  if (!parsed.success) return null
  const present = (found: T | null | undefined) => (found === null || found === undefined || empty(found) ? null : found)
  const [from, to] = [present(parsed.data[oldKey]), present(parsed.data[newKey])]
  return from === null && to === null ? null : { from, to }
}

/** The names under `key`, or null when the payload has none there. */
function names(payload: unknown, key: string, field: "name" | "title"): string[] | null {
  const parsed = z.object({ [key]: z.array(z.object({ [field]: z.string() })).min(1) }).safeParse(payload)
  return parsed.success ? parsed.data[key]!.map((item) => item[field]!) : null
}

const Text = z.string()
const Name = z.object({ name: z.string() }).transform((named) => named.name)
const Day = z.string().transform((value) => value.slice(0, 10))
const Minutes = z.object({ durationInMinutes: z.number() }).transform((duration) => duration.durationInMinutes)
const Choices = z.array(z.string()).transform((choices) => choices.join(", "))
const blank = (text: string) => text === ""

function changed<T>(found: Values<T> | null): { from: T | null; to: T } | null {
  return found && found.to !== null ? { from: found.from, to: found.to } : null
}

function customField(payload: unknown): HistoryChange | null {
  const field = z.object({ customField: z.object({ name: z.string() }) }).safeParse(payload)
  if (!field.success) return null
  const name = field.data.customField.name
  // A text or single-choice field sends strings, a multi-select field lists its choices.
  const text = values(payload, ["oldString", "newString"], Text, blank)
  if (text) return { kind: "field", name, ...text }
  // A list of choices reads better as what it became than as one list turning into another.
  const choices = values(payload, ["oldValues", "newValues"], Choices, blank)
  return choices && { kind: "field", name, from: null, to: choices.to }
}

const listed = (kind: "assignees" | "parents" | "attachments", side: "added" | "removed", found: string[] | null): HistoryChange | null =>
  found && { kind, added: side === "added" ? found : [], removed: side === "removed" ? found : [] }

/** How each history type and action reads, keyed `TYPE ACTION`. One missing here, or a payload that does not match, is drawn as `other`. */
const CHANGES = new Map<string, (payload: unknown) => HistoryChange | null>([
  ["TITLE UPDATE", (payload) => {
    const found = changed(values(payload, ["oldValue", "newValue"], Text))
    return found && { kind: "title", ...found }
  }],
  ["STATUS UPDATE", (payload) => {
    const found = changed(values(payload, ["oldValue", "newValue"], Name))
    return found && { kind: "status", ...found }
  }],
  ["ASSIGNEES ADD", (payload) => listed("assignees", "added", names(payload, "addedUsers", "name"))],
  ["ASSIGNEES DELETE", (payload) => listed("assignees", "removed", names(payload, "removedUsers", "name"))],
  ["PARENTS ADD", (payload) => listed("parents", "added", names(payload, "addedParents", "title"))],
  ["PARENTS DELETE", (payload) => listed("parents", "removed", names(payload, "removedParents", "title"))],
  ["ATTACHMENTS ADD", (payload) => listed("attachments", "added", names(payload, "addedAttachments", "name"))],
  ["ATTACHMENTS DELETE", (payload) => listed("attachments", "removed", names(payload, "removedAttachments", "name"))],
  ["START_DATE UPDATE", (payload) => {
    const found = values(payload, ["oldValue", "newValue"], Day)
    return found && { kind: "start", ...found }
  }],
  ["DUE_DATE UPDATE", (payload) => {
    const found = values(payload, ["oldValue", "newValue"], Day)
    return found && { kind: "due", ...found }
  }],
  ["DURATION UPDATE", (payload) => {
    const found = values(payload, ["oldValue", "newValue"], Minutes)
    return found && { kind: "duration", ...found }
  }],
  ["CUSTOM_FIELDS UPDATE", customField],
])

const HistoryChangeSchema = z
  .object({
    timestamp: z.union([z.string(), z.number()]),
    author: z.object({ name: z.string().nullish() }).nullish(),
    type: z.string(),
    action: z.string().default(""),
    payload: z.unknown().optional(),
  })
  .transform(
    (wire): HistoryEntry => ({
      at: isoTime(wire.timestamp),
      author: wire.author?.name || null,
      change: CHANGES.get(`${wire.type} ${wire.action}`)?.(wire.payload) ?? { kind: "other", type: wire.type, action: wire.action },
    }),
  )

/** What `get_item_history` answers for one item. An item Wrike could not read comes back with `success: false` and an error. */
export const HistorySchema = z.object({
  taskChanges: z.array(
    z.object({
      success: z.boolean().default(true),
      error: z.unknown().optional(),
      changes: z.array(HistoryChangeSchema).default([]),
    }),
  ),
  nextPageToken: z.string().nullish(),
})

export function parseAll<T>(schema: z.ZodType<T>, items: unknown[], what: string): T[] {
  const parsed = z.array(schema).safeParse(items)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""
  throw new WrikeFailure({ kind: "invalid", message: `Unexpected ${what} from Wrike${where}` })
}
