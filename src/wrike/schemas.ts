import { z } from "zod"
import {
  attachmentId,
  commentId,
  customFieldId,
  customStatusId,
  folderId,
  formFieldId,
  formOptionId,
  formPageId,
  legacyItemId,
  requestFormId,
  spaceId,
  taskId,
  userId,
  type FolderId,
  type FormPageId,
  type SpaceId,
} from "../domain/ids"
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
import type { CustomField, FieldKind, FieldValue } from "../domain/fields"
import type { Condition, FormField, FormFieldKind, FormOption, FormSummary, PageVisibility, Submission } from "../domain/forms"
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

/**
 * A task's field values. Wrike sends strings. An entry in another shape is
 * left out rather than failing the task, and so is an empty string, which
 * shows nothing.
 */
const FieldValues = z
  .array(z.unknown())
  .default([])
  .transform((entries): FieldValue[] =>
    parseEach(z.object({ id: z.string(), value: z.string() }), entries).flatMap((entry) => (entry.value === "" ? [] : [{ id: customFieldId(entry.id), value: entry.value }])),
  )

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
    customFields: FieldValues,
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
      fields: wire.customFields,
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

const isHttps = (url: string) => URL.canParse(url) && new URL(url).protocol === "https:"

/** Wrike's signed link to a file. It goes to the browser launcher, so anything but an absolute https URL is refused here. */
export const AttachmentUrlSchema = z.object({ url: z.string().refine(isHttps, "not an absolute https URL") })

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

const decimals = z.number().int().min(0).nullish().transform((value) => value ?? null)

const FieldSettings = z.object({
  values: z.array(z.string()).nullish(),
  options: z.array(z.object({ value: z.string() })).nullish(),
  allowOtherValues: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  decimalPlaces: decimals,
  currency: z.string().nullish(),
  allowTime: z.boolean().default(false),
})

/** The kind of a field from its wire type and settings. A type this version does not know keeps its name and is shown as stored. */
function fieldKind(type: string, settings: z.infer<typeof FieldSettings>): FieldKind {
  const options = settings.options?.map((option) => option.value) ?? settings.values ?? []
  switch (type) {
    case "Text":
    case "Checkbox":
    case "Duration":
      return { type }
    case "DropDown":
    case "Multiple":
      return { type, options, allowOther: settings.allowOtherValues }
    case "Numeric":
    case "Percentage":
    case "CalculatedNumeric":
      return { type, decimals: settings.decimalPlaces }
    case "Currency":
      return { type, decimals: settings.decimalPlaces, currency: settings.currency ?? "" }
    case "Date":
      return { type, allowTime: settings.allowTime }
    default:
      return { type: "Unknown", wireType: type }
  }
}

export const CustomFieldSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    archived: z.boolean().default(false),
    settings: FieldSettings.nullish().transform((settings) => settings ?? FieldSettings.parse({})),
  })
  .transform(
    (wire): CustomField => ({
      id: customFieldId(wire.id),
      title: wire.title,
      kind: fieldKind(wire.type, wire.settings),
      readOnly: wire.settings.readOnly,
      archived: wire.archived,
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

const INBOX_KINDS = new Map<string, InboxKind>([
  ["Mention", "Mention"],
  ["Assign", "Assign"],
  ["EntitiesAssigned", "Assign"],
  ["Comment", "Comment"],
  ["Status", "Status"],
])
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
      kind: INBOX_KINDS.get(wire.notificationType) ?? "Other",
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

/** Wrike's times as the rest of the app writes them: ISO in UTC, to the second. A time without a zone is UTC. Null for one that is not a time. */
function isoTime(raw: string | number): string | null {
  const text = typeof raw === "string" && !/(?:Z|[+-]\d\d:?\d\d)$/.test(raw) ? `${raw}Z` : raw
  const time = new Date(text)
  return Number.isNaN(time.getTime()) ? null : time.toISOString().replace(/\.\d+Z$/, "Z")
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

/** The items that parse with `schema`. One Wrike describes in a shape this version cannot read is left out instead of failing the list. */
export function parseEach<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function parseAll<T>(schema: z.ZodType<T>, items: unknown[], what: string): T[] {
  const parsed = z.array(schema).safeParse(items)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""
  throw new WrikeFailure({ kind: "invalid", message: `Unexpected ${what} from Wrike${where}` })
}

/*
 * Request forms, from the published schemas of Wrike's MCP tools. None of
 * these shapes was measured live: the one probe of `get_requestform` answered
 * with a server error. Names that the schemas leave open (an option's title,
 * a condition's parts) are read from any of the likely keys.
 */

const FormSummarySchema = z
  .object({ id: z.string(), title: z.string(), description: z.string().nullish() })
  .transform((wire): FormSummary => ({ id: requestFormId(wire.id), title: wire.title, description: wire.description ?? "" }))

export const FormSearchSchema = z.object({
  forms: z.array(z.unknown()).transform((forms) => parseEach(FormSummarySchema, forms)),
  truncated: z.boolean().optional(),
  nextPageToken: z.string().nullish(),
})

const named = z.object({ title: z.string().optional(), name: z.string().optional(), text: z.string().optional() })
const nameOf = (wire: z.infer<typeof named>) => wire.title ?? wire.name ?? wire.text ?? ""

const ConditionSchema = z.union([
  z.string().transform((value): Condition => (value.startsWith("w:rfopt:") ? { option: formOptionId(value), title: null } : { option: null, title: value })),
  z
    .object({ option: z.unknown(), optionId: z.string().optional(), id: z.string().optional(), optionTitle: z.string().optional() })
    .passthrough()
    .transform((wire): Condition => {
      const option = typeof wire.option === "string" ? wire.option : z.object({ id: z.string() }).safeParse(wire.option).data?.id
      const optionTitle = wire.optionTitle ?? z.object({ title: z.string() }).safeParse(wire.option).data?.title ?? null
      const id = option ?? wire.optionId ?? (wire.id?.startsWith("w:rfopt:") ? wire.id : undefined)
      return { option: id ? formOptionId(id) : null, title: optionTitle }
    }),
])
const Conditions = z
  .array(z.unknown())
  .nullish()
  .transform((entries) => parseEach(ConditionSchema, entries ?? []).filter((condition) => condition.option !== null || condition.title !== null))

const OptionSchema = z
  .object({ id: z.string() })
  .and(named)
  .transform((wire): FormOption => ({ id: formOptionId(wire.id), title: nameOf(wire) || wire.id }))

function formFieldKind(type: string, options: FormOption[]): FormFieldKind {
  switch (type.toUpperCase().replace(/[^A-Z]/g, "")) {
    case "TEXTFIELD":
    case "TEXT":
      return { type: "text", lines: "one" }
    case "TEXTAREA":
      return { type: "text", lines: "many" }
    case "COMBOBOX":
    case "IMPORTANCE":
      return { type: "choice", options, multi: false }
    case "CHECKBOX":
      return { type: "choice", options, multi: true }
    case "DATE":
      return { type: "date" }
    case "NUMBER":
      return { type: "number" }
    case "ATTACHMENT":
      return { type: "attachment" }
    default:
      return { type: "unsupported", wireType: type }
  }
}

const FormFieldSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    mandatory: z.boolean().default(false),
    helperText: z.string().nullish(),
    options: z.array(z.unknown()).nullish(),
    visibleWhenAny: Conditions,
  })
  .transform(
    (wire): FormField => ({
      id: formFieldId(wire.id),
      title: wire.title,
      mandatory: wire.mandatory,
      helperText: wire.helperText ?? "",
      kind: formFieldKind(wire.type, parseEach(OptionSchema, wire.options ?? [])),
      visibleWhenAny: wire.visibleWhenAny,
    }),
  )

const PageIndexSchema = z
  .object({ id: z.string(), title: z.string().default(""), visibility: z.string(), afterPages: z.array(z.string()).nullish(), visibleWhenAny: Conditions })
  .transform((wire): { id: FormPageId; title: string; visibility: PageVisibility } => {
    const after = (wire.afterPages ?? []).map(formPageId)
    const visibility: PageVisibility =
      wire.visibility === "ENTRY"
        ? { kind: "entry" }
        : wire.visibility === "AFTER_PAGE"
          ? { kind: "after", pages: after }
          : wire.visibility === "ON_CONDITION"
            ? { kind: "condition", after, when: wire.visibleWhenAny }
            : { kind: "orphan" }
    return { id: formPageId(wire.id), title: wire.title, visibility }
  })

export const FormIndexSchema = z.object({ pageIndex: z.array(z.unknown()).transform((pages) => parseEach(PageIndexSchema, pages)) })

export const FormPagesSchema = z.object({
  pages: z.array(z.object({ id: z.string(), fields: z.array(z.unknown()).default([]) }).transform((wire) => ({ id: formPageId(wire.id), fields: parseEach(FormFieldSchema, wire.fields) }))),
})

const itemOf = (raw: string) => {
  const item = legacyItemId(raw)
  if (!item) throw new WrikeFailure({ kind: "invalid", message: `Wrike named the request ${raw}, which is not an item ID` })
  return item
}

/** `submit_requestform`'s answer, and `get_asyncjob`'s for a submission that was still processing. */
export const SubmissionSchema = z.union([
  z.object({ status: z.literal("COMPLETED"), itemId: z.string() }).transform((wire): Submission => ({ kind: "completed", item: itemOf(wire.itemId) })),
  z.object({ status: z.literal("PROCESSING"), submissionId: z.string() }).transform((wire): Submission => ({ kind: "processing", submission: wire.submissionId })),
])

export const AsyncJobSchema = z
  .object({ status: z.string(), itemId: z.string().nullish(), errorMessage: z.string().nullish() })
  .transform((wire): Submission | { kind: "waiting" } => {
    if (wire.status === "COMPLETED" && wire.itemId) return { kind: "completed", item: itemOf(wire.itemId) }
    if (wire.status === "FAILED") return { kind: "refused", message: wire.errorMessage ?? "Wrike could not create the request", retrySafe: false }
    return { kind: "waiting" }
  })

/** How `submit_requestform` reports an error: what to fix, and whether sending again is safe. */
export const SubmitErrorSchema = z.object({ message: z.string(), retrySafe: z.boolean().default(false) })
