import type { CommentBody } from "../domain/comment"
import type { HistoryPage } from "../domain/history"
import type { AttachmentId, CommentId, FolderId, LegacyItemId, SpaceId, TaskId, UserId } from "../domain/ids"
import { folderId, taskId, userId } from "../domain/ids"
import type { Attachment, Comment, Contact, FolderRef, InboxEntry, NewTask, Task, Workflow } from "../domain/model"
import { patchParams, type Params, type TaskPatch } from "../domain/patch"
import type { Space, SpaceTree } from "../domain/workspace"
import { WrikeFailure } from "./errors"
import {
  AttachmentSchema,
  AttachmentUrlSchema,
  CommentSchema,
  contactFromWire,
  ContactSchema,
  FolderSchema,
  LegacyIdSchema,
  parseAll,
  parseEach,
  parseSpaceTree,
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
  /** The spaces the token can see that are not archived. */
  spaces(): Promise<Space[]>
  spaceTree(id: SpaceId): Promise<SpaceTree>
  /** One page of a task list. `pageToken` asks for the page after the one that returned it. */
  tasks(query: TaskQuery, options: { completed: boolean; pageToken?: string }): Promise<TaskPage>
  taskByPermalink(url: string): Promise<Task | null>
  taskIdFromLegacy(id: LegacyItemId): Promise<TaskId | null>
  task(id: TaskId): Promise<Task>
  updateTask(id: TaskId, patch: TaskPatch): Promise<Task>
  createTask(task: NewTask): Promise<Task>
  /** Moves the task to the Recycle Bin. A task already there is "already-deleted", which is not an error. */
  deleteTask(id: TaskId): Promise<"deleted" | "already-deleted">
  comments(id: TaskId): Promise<Comment[]>
  addComment(id: TaskId, body: CommentBody): Promise<Comment>
  updateComment(id: CommentId, body: CommentBody): Promise<Comment>
  deleteComment(id: CommentId): Promise<void>
  /** The folders a task is filed in, in the order of `ids`. Ones the token cannot see are left out. */
  folders(ids: string[]): Promise<FolderRef[]>
  /** A task's files, oldest first. */
  attachments(id: TaskId): Promise<Attachment[]>
  /** Wrike's small PNG of an image attachment, refused when it is over 1 MB. */
  attachmentPreview(id: AttachmentId): Promise<Uint8Array>
  /** A temporary signed link to the file, which opens without the token. */
  attachmentUrl(id: AttachmentId): Promise<string>
  inbox(options: { includeRead: boolean }): Promise<InboxEntry[]>
  /** One page of an item's field history, newest first. */
  history(item: LegacyItemId, page: { pageSize: number; pageToken?: string }): Promise<HistoryPage>
}

export type TaskQuery =
  | { kind: "mine"; user: UserId }
  | { kind: "title"; text: string }
  | { kind: "space"; id: SpaceId }
  | { kind: "folder"; id: FolderId }

export type TaskPage = { tasks: Task[]; next: string | null }

export const PAGE_SIZE = 200
/** Wrike's thumbnails are small, so a larger answer is refused rather than held in memory. */
const PREVIEW_LIMIT = 1024 * 1024

/** The calls that go to Wrike's MCP server, and the end of its session. */
export type McpClient = Pick<WrikeClient, "inbox" | "history"> & { close(): Promise<void> }

// A task list omits these unless asked, and the app's Task always carries them.
const LIST_FIELDS = ["responsibleIds", "parentIds", "description", "subTaskIds", "superTaskIds"]

function listCall(query: TaskQuery): { path: string; params: Params } {
  switch (query.kind) {
    case "mine":
      return { path: "/tasks", params: { responsibles: [query.user], subTasks: true, sortField: "DueDate" } }
    case "title":
      return { path: "/tasks", params: { title: query.text, sortField: "UpdatedDate", sortOrder: "Desc" } }
    case "space":
      // Without `descendants` a space answers with no tasks at all.
      return { path: `/spaces/${query.id}/tasks`, params: { descendants: true, subTasks: true } }
    case "folder":
      return { path: `/folders/${query.id}/tasks`, params: { descendants: true, subTasks: true } }
  }
}

/** What Wrike says when asked to change a task that is already in the Recycle Bin. */
const DELETED_TASK = "Operation is not allowed on deleted Folder/Task"

const commentParams = (body: CommentBody): Params => (body.plainText ? { text: body.text, plainText: true } : { text: body.text })

export async function fetchMe(transport: Transport): Promise<Me> {
  const [contact] = parseAll(ContactSchema, await transport.request("GET", "/contacts", { me: true }), "contact")
  if (!contact) throw new WrikeFailure({ kind: "not_found" })
  return {
    userId: userId(contact.id),
    name: contactFromWire(contact).name,
    accountId: contact.profiles[0]?.accountId ?? "",
  }
}

export function createWrikeClient(transport: Transport, mcp: McpClient): WrikeClient {
  const spaces = async () => parseAll(SpaceSchema, await transport.request("GET", "/spaces"), "spaces")

  const one = <T>(items: T[]): T => {
    const [first] = items
    if (first === undefined) throw new WrikeFailure({ kind: "not_found" })
    return first
  }

  return {
    me: () => fetchMe(transport),

    async contacts() {
      const contacts = parseAll(ContactSchema, await transport.request("GET", "/contacts", { types: ["Person"] }), "contacts")
      return contacts.filter((contact) => contact.type === "Person").map(contactFromWire)
    },

    async workflows() {
      return parseAll(WorkflowSchema, await transport.request("GET", "/workflows"), "workflows")
    },

    async spaceWorkflows() {
      const perSpace = await Promise.all(
        (await spaces()).map(async (space) =>
          parseAll(WorkflowSchema, await transport.request("GET", `/spaces/${space.id}/workflows`), "workflows"),
        ),
      )
      const byId = new Map(perSpace.flat().map((workflow) => [workflow.id, workflow]))
      return [...byId.values()]
    },

    async spaces() {
      return (await spaces()).filter((space) => !space.archived).map(({ archived: _archived, ...space }) => space)
    },

    async spaceTree(id) {
      return parseSpaceTree(await transport.request("GET", `/spaces/${id}/folders`), id)
    },

    async tasks(query, { completed, pageToken }) {
      const { path, params } = listCall(query)
      // A follow-up page must repeat `fields`, or Wrike leaves the optional fields out of it.
      const page = await transport.requestPage(
        "GET",
        path,
        pageToken
          ? { nextPageToken: pageToken, fields: LIST_FIELDS }
          : { ...params, ...(completed ? {} : { status: "Active" }), pageSize: PAGE_SIZE, fields: LIST_FIELDS },
      )
      return { tasks: parseAll(TaskSchema, page.data, "tasks"), next: page.next }
    },

    async taskByPermalink(url) {
      const found = await transport.request("GET", "/tasks", { permalink: url, fields: LIST_FIELDS })
      return parseAll(TaskSchema, found, "tasks")[0] ?? null
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

    async createTask(task) {
      const params: Params = {
        title: task.title,
        ...(task.assignees.length > 0 ? { responsibles: task.assignees } : {}),
        ...(task.parent ? { superTasks: [task.parent] } : {}),
      }
      // A subtask is created in a folder too, with superTasks naming its parent: `POST /tasks/{id}/tasks` does not exist.
      return one(parseAll(TaskSchema, await transport.request("POST", `/folders/${task.folder}/tasks`, params), "task"))
    },

    async deleteTask(id) {
      try {
        await transport.request("DELETE", `/tasks/${id}`)
        return "deleted"
      } catch (thrown) {
        if (thrown instanceof WrikeFailure && thrown.error.kind === "invalid" && thrown.error.message === DELETED_TASK) return "already-deleted"
        throw thrown
      }
    },

    async comments(id) {
      const comments = parseAll(CommentSchema, await transport.request("GET", `/tasks/${id}/comments`), "comments")
      // Wrike lists newest first with one-second stamps. Reversing before the stable sort keeps two comments from the same second in order.
      return comments.reverse().sort((a, b) => a.createdDate.localeCompare(b.createdDate))
    },

    async addComment(id, body) {
      return one(parseAll(CommentSchema, await transport.request("POST", `/tasks/${id}/comments`, commentParams(body)), "comment"))
    },

    async updateComment(id, body) {
      return one(parseAll(CommentSchema, await transport.request("PUT", `/comments/${id}`, commentParams(body)), "comment"))
    },

    async deleteComment(id) {
      await transport.request("DELETE", `/comments/${id}`)
    },

    async folders(ids) {
      if (ids.length === 0) return []
      const folders = parseAll(FolderSchema, await transport.request("GET", `/folders/${ids.join(",")}`), "folders")
      const byId = new Map(folders.map((folder) => [folder.id, folder.title]))
      return ids.flatMap((id) => {
        const title = byId.get(id)
        return title === undefined ? [] : [{ id: folderId(id), title }]
      })
    },

    async attachments(id) {
      const attachments = parseEach(AttachmentSchema, await transport.request("GET", `/tasks/${id}/attachments`))
      return attachments.sort((a, b) => a.createdDate.localeCompare(b.createdDate))
    },

    async attachmentPreview(id) {
      const preview = await transport.bytes(`/attachments/${id}/preview`, PREVIEW_LIMIT)
      if (!preview) throw new WrikeFailure({ kind: "invalid", message: "The preview is larger than 1 MB" })
      return preview
    },

    async attachmentUrl(id) {
      return one(parseAll(AttachmentUrlSchema, await transport.request("GET", `/attachments/${id}/url`), "attachment link")).url
    },

    inbox: (options) => mcp.inbox(options),
    history: (item, page) => mcp.history(item, page),
  }
}

