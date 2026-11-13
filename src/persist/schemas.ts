import { z } from "zod"
import type { CustomField, FieldKind } from "../domain/fields"
import { customFieldId, customStatusId, folderId, spaceId, taskId, userId } from "../domain/ids"
import { COLUMN_KEYS, DUE_RANGES, GROUP_KEYS, SORT_KEYS, type Filter, type ListSpec } from "../domain/list"
import { IMPORTANCES } from "../domain/model"
import { TASK_SCOPE_KINDS, type Scope } from "../domain/scope"
import { DEFAULT_SETTINGS, NAV_WIDTH, THEME_NAMES, type Settings } from "../domain/settings"
import { SPACE_ACCESS, type Favorite, type FolderNode, type Space } from "../domain/workspace"

const FilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assignee"), ids: z.array(z.string().transform(userId)) }),
  z.object({ kind: z.literal("status"), ids: z.array(z.string().transform(customStatusId)) }),
  z.object({ kind: z.literal("importance"), values: z.array(z.enum(IMPORTANCES)) }),
  z.object({ kind: z.literal("due"), range: z.enum(DUE_RANGES) }),
  z.object({ kind: z.literal("text"), query: z.string() }),
]) satisfies z.ZodType<Filter>

const ListSpecSchema = z.object({
  group: z.enum(GROUP_KEYS),
  subgroup: z.enum(GROUP_KEYS),
  sort: z.array(z.object({ key: z.enum(SORT_KEYS), dir: z.enum(["asc", "desc"]) })),
  filters: z.array(FilterSchema),
  completed: z.boolean(),
  columns: z.array(z.enum(COLUMN_KEYS)),
}) satisfies z.ZodType<ListSpec>

export const ConfigSchema = z
  .object({
    theme: z.enum(THEME_NAMES).default(DEFAULT_SETTINGS.theme),
    navWidth: z.number().int().min(NAV_WIDTH.min).max(NAV_WIDTH.max).default(DEFAULT_SETTINGS.navWidth),
    completed: z.boolean().default(DEFAULT_SETTINGS.completed),
    history: z.boolean().default(DEFAULT_SETTINGS.history),
    lists: z.partialRecord(z.enum(TASK_SCOPE_KINDS), ListSpecSchema.partial()).default({}),
    keys: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  })
  .transform((file): Settings => file as Settings)

const SpaceSchema = z.object({ id: z.string().transform(spaceId), title: z.string(), access: z.enum(SPACE_ACCESS) }) satisfies z.ZodType<Space>

const ScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inbox") }),
  z.object({ kind: z.literal("todo") }),
  z.object({ kind: z.literal("search"), query: z.string() }),
  z.object({ kind: z.literal("space"), id: z.string().transform(spaceId), title: z.string() }),
  z.object({ kind: z.literal("folder"), id: z.string().transform(folderId), title: z.string(), project: z.boolean() }),
]) satisfies z.ZodType<Scope>

const FavoriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("space"), id: z.string().transform(spaceId), title: z.string() }),
  z.object({ kind: z.literal("folder"), id: z.string().transform(folderId), title: z.string(), project: z.boolean() }),
  z.object({ kind: z.literal("task"), id: z.string().transform(taskId), title: z.string() }),
]) satisfies z.ZodType<Favorite>

export const FavoritesSchema = z.object({ version: z.literal(1), favorites: z.array(FavoriteSchema) })

const ViewSchema = z.object({
  spec: ListSpecSchema,
  cursor: z.object({ id: z.string(), index: z.number().int().min(0) }).nullable().default(null),
  collapsed: z.array(z.string()).default([]),
  expanded: z.array(z.string()).default([]),
})

/** A field added after the first release takes a default here, which is how an older session keeps loading. */
export const SessionSchema = z.object({
  version: z.literal(1),
  scope: ScopeSchema,
  focus: z.enum(["nav", "list", "details"]).default("list"),
  zoom: z.boolean().default(false),
  nav: z.object({ cursor: z.string(), expanded: z.array(z.string()) }).default({ cursor: "view:inbox", expanded: [] }),
  openTaskId: z.string().nullable().default(null),
  includeRead: z.boolean().default(false),
  views: z.record(z.string(), ViewSchema).default({}),
})
export type SessionFile = z.infer<typeof SessionSchema>
export type SessionView = z.infer<typeof ViewSchema>

export const SpacesCacheSchema = z.object({ version: z.literal(1), fetchedAt: z.string(), spaces: z.array(SpaceSchema) })

const NodeSchema = z.object({
  id: z.string().transform(folderId),
  title: z.string(),
  childIds: z.array(z.string().transform(folderId)),
  kind: z.enum(["space", "folder", "project"]),
  project: z.object({ statusId: z.string().transform(customStatusId).nullable(), ownerIds: z.array(z.string().transform(userId)) }).nullable(),
}) satisfies z.ZodType<FolderNode>

export const TreeCacheSchema = z.object({ version: z.literal(1), fetchedAt: z.string(), nodes: z.array(NodeSchema) })

const decimals = z.number().int().min(0).nullable()

const FieldKindSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Text") }),
  z.object({ type: z.literal("DropDown"), options: z.array(z.string()), allowOther: z.boolean() }),
  z.object({ type: z.literal("Multiple"), options: z.array(z.string()), allowOther: z.boolean() }),
  z.object({ type: z.literal("Numeric"), decimals }),
  z.object({ type: z.literal("Percentage"), decimals }),
  z.object({ type: z.literal("Currency"), decimals, currency: z.string() }),
  z.object({ type: z.literal("Date"), allowTime: z.boolean() }),
  z.object({ type: z.literal("Checkbox") }),
  z.object({ type: z.literal("Duration") }),
  z.object({ type: z.literal("CalculatedNumeric"), decimals }),
  z.object({ type: z.literal("Unknown"), wireType: z.string() }),
]) satisfies z.ZodType<FieldKind>

const CustomFieldSchema = z.object({
  id: z.string().transform(customFieldId),
  title: z.string(),
  kind: FieldKindSchema,
  readOnly: z.boolean(),
  archived: z.boolean(),
}) satisfies z.ZodType<CustomField>

export const FieldsCacheSchema = z.object({ version: z.literal(1), fetchedAt: z.string(), fields: z.array(CustomFieldSchema) })
