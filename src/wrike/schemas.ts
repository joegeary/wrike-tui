import { z } from "zod"
import { customStatusId, legacyItemId, taskId, userId } from "../domain/ids"
import {
  IMPORTANCES,
  STATUS_GROUPS,
  type Comment,
  type Contact,
  type InboxEntry,
  type InboxKind,
  type Task,
  type TaskDates,
  type Workflow,
} from "../domain/model"
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
    permalink: z.string(),
    description: z.string().default(""),
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
      permalink: wire.permalink,
      descriptionHtml: wire.description,
      updatedDate: wire.updatedDate,
    }),
  )

export const CommentSchema = z
  .object({ id: z.string(), authorId: z.string(), text: z.string(), createdDate: z.string() })
  .transform((wire): Comment => ({ ...wire, authorId: userId(wire.authorId) }))

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
  const name = `${wire.firstName} ${wire.lastName}`.trim()
  const email = wire.primaryEmail ?? wire.profiles[0]?.email ?? null
  return { id: userId(wire.id), name: name || email || wire.id, email }
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

export const SpaceSchema = z.object({ id: z.string() })
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

export function parseAll<T>(schema: z.ZodType<T>, items: unknown[], what: string): T[] {
  const parsed = z.array(schema).safeParse(items)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""
  throw new WrikeFailure({ kind: "invalid", message: `Unexpected ${what} from Wrike${where}` })
}
