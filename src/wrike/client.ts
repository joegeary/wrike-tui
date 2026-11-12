import type { LegacyItemId, TaskId, UserId } from "../domain/ids"
import { taskId, userId } from "../domain/ids"
import type { Comment, Contact, InboxEntry, Task, Workflow } from "../domain/model"
import { patchParams, type TaskPatch } from "../domain/patch"
import { WrikeFailure } from "./errors"
import {
  CommentSchema,
  contactFromWire,
  ContactSchema,
  FolderSchema,
  LegacyIdSchema,
  parseAll,
  SpaceSchema,
  TaskSchema,
  WorkflowSchema,
} from "./schemas"
import type { Transport } from "./transport"

export type Me = { userId: UserId; name: string; accountId: string }

export type WrikeClient = {
  me(): Promise<Me>
  contacts(): Promise<Contact[]>
  workflows(): Promise<Workflow[]>
  /** The workflows of every space, for a status the account workflows do not hold. */
  spaceWorkflows(): Promise<Workflow[]>
  myTasks(user: UserId): Promise<Task[]>
  searchTasks(title: string): Promise<Task[]>
  taskByPermalink(url: string): Promise<Task | null>
  taskIdFromLegacy(id: LegacyItemId): Promise<TaskId | null>
  task(id: TaskId): Promise<Task>
  updateTask(id: TaskId, patch: TaskPatch): Promise<Task>
  comments(id: TaskId): Promise<Comment[]>
  addComment(id: TaskId, text: string): Promise<Comment>
  folders(ids: string[]): Promise<string[]>
  inbox(options: { includeRead: boolean }): Promise<InboxEntry[]>
}

export type InboxSource = Pick<WrikeClient, "inbox"> & { close(): Promise<void> }

// A task list omits these unless asked, and the app's Task always carries them.
const LIST_FIELDS = ["responsibleIds", "parentIds", "description"]

export async function fetchMe(transport: Transport): Promise<Me> {
  const [contact] = parseAll(ContactSchema, await transport.request("GET", "/contacts", { me: true }), "contact")
  if (!contact) throw new WrikeFailure({ kind: "not_found" })
  return {
    userId: userId(contact.id),
    name: contactFromWire(contact).name,
    accountId: contact.profiles[0]?.accountId ?? "",
  }
}

export function createWrikeClient(transport: Transport, inboxSource: InboxSource): WrikeClient {
  const tasks = async (params: Parameters<Transport["request"]>[2]) =>
    parseAll(TaskSchema, await transport.request("GET", "/tasks", { ...params, fields: LIST_FIELDS }), "tasks")

  const one = <T>(items: T[]): T => {
    const [first] = items
    if (first === undefined) throw new WrikeFailure({ kind: "not_found" })
    return first
  }

  return {
    me: () => fetchMe(transport),

    async contacts() {
      const contacts = parseAll(ContactSchema, await transport.request("GET", "/contacts", { types: ["Person"] }), "contacts")
      return contacts.filter((contact) => contact.type === "Person" && !contact.deleted).map(contactFromWire)
    },

    async workflows() {
      return parseAll(WorkflowSchema, await transport.request("GET", "/workflows"), "workflows")
    },

    async spaceWorkflows() {
      const spaces = parseAll(SpaceSchema, await transport.request("GET", "/spaces"), "spaces")
      const perSpace = await Promise.all(
        spaces.map(async (space) =>
          parseAll(WorkflowSchema, await transport.request("GET", `/spaces/${space.id}/workflows`), "workflows"),
        ),
      )
      const byId = new Map(perSpace.flat().map((workflow) => [workflow.id, workflow]))
      return [...byId.values()]
    },

    myTasks: (user) =>
      tasks({ responsibles: [user], status: "Active", subTasks: true, sortField: "DueDate" }),

    searchTasks: (title) => tasks({ title, sortField: "UpdatedDate", sortOrder: "Desc", pageSize: 100 }),

    async taskByPermalink(url) {
      return (await tasks({ permalink: url }))[0] ?? null
    },

    async taskIdFromLegacy(id) {
      const found = parseAll(LegacyIdSchema, await transport.request("GET", "/ids", { ids: [id], type: "ApiV2Task" }), "ids")
      return found[0] ? taskId(found[0].id) : null
    },

    async task(id) {
      return one(parseAll(TaskSchema, await transport.request("GET", `/tasks/${id}`), "task"))
    },

    async updateTask(id, patch) {
      return one(parseAll(TaskSchema, await transport.request("PUT", `/tasks/${id}`, patchParams(patch)), "task"))
    },

    async comments(id) {
      const comments = parseAll(CommentSchema, await transport.request("GET", `/tasks/${id}/comments`), "comments")
      // Wrike lists newest first with one-second stamps. Reversing before the stable sort keeps two comments from the same second in order.
      return comments.reverse().sort((a, b) => a.createdDate.localeCompare(b.createdDate))
    },

    async addComment(id, text) {
      const created = await transport.request("POST", `/tasks/${id}/comments`, { text, plainText: true })
      return one(parseAll(CommentSchema, created, "comment"))
    },

    async folders(ids) {
      if (ids.length === 0) return []
      const folders = parseAll(FolderSchema, await transport.request("GET", `/folders/${ids.join(",")}`), "folders")
      return folders.map((folder) => folder.title)
    },

    inbox: (options) => inboxSource.inbox(options),
  }
}

