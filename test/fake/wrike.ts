import type { Fetch } from "../../src/wrike/transport"
import { ACCOUNT, ME, permalink, PREVIEW_PNG, STATUS, seed, type FakeData, type FakeTask } from "./data"
import { seedForms, type FakeForm } from "./forms"
import { showcaseSeed } from "./showcase"

export type RecordedWrite = { method: string; path: string; params: Record<string, string> }
type Failure = { method?: string; path: string; status: number; times: number; retryAfter?: string }
type ToolFailure = { tool: string; text: string; isError: boolean; times: number }

export type FakeWrike = {
  data: FakeData
  /** Every REST write, in order, with its form parameters as sent. */
  writes: RecordedWrite[]
  /** Every request line, in order. */
  requests: string[]
  /** Every MCP tool call, in order, with its arguments. */
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  /** The request forms, and how the next submission answers: at once, or still processing until one poll later. */
  forms: { list: FakeForm[]; submitAs: "COMPLETED" | "PROCESSING" }
  handle(request: Request): Promise<Response>
  fetch: Fetch
  /** Makes the next `times` requests whose path starts with `path` fail with `status`. A 429 can carry a `Retry-After` header. */
  fail(failure: { method?: string; path: string; status: number; times?: number; retryAfter?: string }): void
  /** Makes the next `times` calls of an MCP tool answer with `text` instead of JSON, the way Wrike reports a rate limit. */
  failTool(failure: { tool: string; text: string; isError?: boolean; times?: number }): void
  /** Drops every failure still waiting, so the fake answers normally again. */
  heal(): void
  /** Makes the next request whose path starts with `path` wait until the returned function is called. */
  hold(path: string): () => void
}

const OPTIONAL_LIST_FIELDS = [
  "description", "briefDescription", "parentIds", "superParentIds", "sharedIds", "responsibleIds", "authorIds",
  "hasAttachments", "superTaskIds", "subTaskIds", "dependencyIds", "metadata", "customFields",
] as const

/** Field types whose write Wrike accepted with 200 and then did not store on a task where the field does not apply. */
const DROPPED_WHERE_NOT_APPLYING = new Set(["Checkbox", "Currency", "Duration"])

const json = (body: unknown, status = 200) => Response.json(body, { status })
const wrikeError = (status: number, error: string, errorDescription: string) => json({ error, errorDescription }, status)
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export type FakeOptions = {
  token: string
  today: string
  /** The time the seed data is laid out around. */
  now: string
  /** The time a new comment is stamped with. Real time unless a test sets a clock of its own. */
  stamp?: () => string
  /** `showcase` serves the made-up company the README's screenshots show, in place of the data the tests assert on. */
  dataset?: "test" | "showcase"
}

/** Where Wrike puts a task whose last folder was removed: the account root, which answers 200. */
export const ACCOUNT_ROOT = "IEAA5UTEI7777777"
/** A task in the Recycle Bin has this scope. Lists leave it out, and changing it again answers 400. */
const RECYCLED = "RbTask"
const deletedTask = () => wrikeError(400, "invalid_request", "Operation is not allowed on deleted Folder/Task")

const realTime = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const commentNotFound = () => wrikeError(404, "resource_not_found", "Comment not found or access denied")

export function createFakeWrike(options: FakeOptions): FakeWrike {
  const data = (options.dataset === "showcase" ? showcaseSeed : seed)(options.today, options.now)
  const writes: RecordedWrite[] = []
  const requests: string[] = []
  const toolCalls: FakeWrike["toolCalls"] = []
  const forms: FakeWrike["forms"] = { list: seedForms(), submitAs: "COMPLETED" }
  const jobs = new Map<string, { itemId: string; polls: number }>()
  const failures: Failure[] = []
  const toolFailures: ToolFailure[] = []
  const holds: { path: string; released: Promise<void> }[] = []
  let sequence = 0
  const stamp = options.stamp ?? realTime
  const storedText = (form: URLSearchParams) => {
    const text = form.get("text") ?? ""
    return form.get("plainText") === "true" ? escapeHtml(text).replace(/\n/g, "<br />") : text
  }

  const authorized = (request: Request) =>
    request.headers.get("authorization")?.toLowerCase() === `bearer ${options.token}`.toLowerCase()

  const allStatuses = () =>
    [...data.workflows, ...Object.values(data.spaceWorkflows).flat()].flatMap(
      (workflow) => (workflow as { customStatuses: { id: string; group: FakeTask["status"] }[] }).customStatuses,
    )

  const folderById = () => new Map(data.folders.map((folder) => [folder.id, folder]))

  /** The folder and everything under it. */
  function subtree(root: string): Set<string> {
    const byId = folderById()
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      for (const child of byId.get(id)?.childIds ?? []) walk(child)
    }
    walk(root)
    return seen
  }

  /** The tasks filed in `folders`, and with `subTasks` their subtasks at any depth, in data order. */
  function tasksIn(folders: Set<string>, subTasks: boolean): FakeTask[] {
    const included = new Set(data.tasks.filter((task) => task.parentIds.some((id) => folders.has(id))).map((task) => task.id))
    if (subTasks) {
      for (let grew = true; grew; ) {
        grew = false
        for (const task of data.tasks) {
          if (!included.has(task.id) && task.superTaskIds.some((id) => included.has(id))) grew = included.add(task.id).size > 0
        }
      }
    }
    return data.tasks.filter((task) => included.has(task.id) && (subTasks || task.superTaskIds.length === 0))
  }

  type Listing = { path: string; query: string; offset: number }

  /** Filters, sorts and pages a task list the way Wrike does, including a follow-up page that only carries its token and `fields`. */
  function listTasks(path: string, query: URLSearchParams, scope: (first: URLSearchParams) => FakeTask[]): Response {
    const array = (from: URLSearchParams, name: string): string[] | null => (from.has(name) ? (JSON.parse(from.get(name)!) as string[]) : null)
    let listing: Listing = { path, query: query.toString(), offset: 0 }
    if (query.has("nextPageToken")) {
      try {
        listing = JSON.parse(Buffer.from(query.get("nextPageToken")!, "base64url").toString()) as Listing
      } catch {
        return wrikeError(400, "invalid_parameter", "Parameter 'nextPageToken' value is invalid")
      }
      if (listing.path !== path) return wrikeError(400, "invalid_parameter", "Parameter 'nextPageToken' value is invalid")
    }
    const first = new URLSearchParams(listing.query)
    const responsibles = array(first, "responsibles")
    const title = first.get("title")?.toLowerCase()
    let found = scope(first).filter(
      (task) =>
        task.scope !== RECYCLED &&
        (!responsibles || task.responsibleIds.some((id) => responsibles.includes(id))) &&
        (!first.has("status") || task.status === first.get("status")) &&
        (title === undefined || task.title.toLowerCase().includes(title)) &&
        (!first.has("permalink") || task.permalink === first.get("permalink")),
    )
    const descending = first.get("sortOrder") === "Desc" ? -1 : 1
    if (first.get("sortField") === "DueDate") {
      found = found.toSorted((a, b) => (a.dates.due ?? "9999").localeCompare(b.dates.due ?? "9999") * descending)
    } else if (first.get("sortField") === "UpdatedDate") {
      found = found.toSorted((a, b) => a.updatedDate.localeCompare(b.updatedDate) * descending)
    }
    // The optional fields come from this request, not from the first one, which is why a follow-up must repeat them.
    const fields = array(query, "fields") ?? []
    const pageSize = Number(first.get("pageSize") ?? 1000)
    const end = listing.offset + pageSize
    const page = found.slice(listing.offset, end).map((task) => {
      const row: Record<string, unknown> = { ...task }
      for (const field of OPTIONAL_LIST_FIELDS) if (!fields.includes(field)) delete row[field]
      return row
    })
    const next = end < found.length ? Buffer.from(JSON.stringify({ ...listing, offset: end } satisfies Listing)).toString("base64url") : undefined
    return json({ kind: "tasks", ...(next ? { nextPageToken: next } : {}), ...(listing.offset === 0 ? { responseSize: found.length } : {}), data: page })
  }

  function updateTask(task: FakeTask, form: URLSearchParams): Response {
    const invalid = (name: string) => wrikeError(400, "invalid_parameter", `Parameter '${name}' value is invalid`)
    if (form.has("title")) {
      if (form.get("title")!.trim() === "") return invalid("title")
      task.title = form.get("title")!
    }
    if (form.has("description")) task.description = form.get("description")!
    if (form.has("importance")) {
      const importance = form.get("importance")!
      if (importance !== "High" && importance !== "Normal" && importance !== "Low") return invalid("importance")
      task.importance = importance
    }
    if (form.has("customStatus")) {
      const status = allStatuses().find((candidate) => candidate.id === form.get("customStatus"))
      if (!status) return invalid("customStatus")
      task.customStatusId = status.id
      task.status = status.group
    }
    if (form.has("dates")) {
      const dates = JSON.parse(form.get("dates")!) as FakeTask["dates"]
      task.dates = {
        type: dates.type,
        ...(dates.start ? { start: `${dates.start.slice(0, 10)}T09:00:00` } : {}),
        ...(dates.due ? { due: `${dates.due.slice(0, 10)}T17:00:00` } : {}),
      }
    }
    const folders = (name: string) => (form.has(name) ? (JSON.parse(form.get(name)!) as string[]) : [])
    const [addParents, removeParents] = [folders("addParents"), folders("removeParents")]
    if (addParents.some((id) => !folderById().has(id))) return invalid("addParents")
    if (addParents.length + removeParents.length > 0) {
      task.parentIds = [...new Set([...task.parentIds, ...addParents])].filter((id) => !removeParents.includes(id))
      if (task.parentIds.length === 0) task.parentIds = [ACCOUNT_ROOT]
    }
    if (form.has("customFields")) {
      let entries: unknown
      try {
        entries = JSON.parse(form.get("customFields")!)
      } catch {
        return invalid("customFields")
      }
      if (!Array.isArray(entries)) return invalid("customFields")
      for (const entry of entries as { id?: unknown; value?: unknown }[]) {
        const definition = data.customFields.find((field) => field.id === entry.id)
        if (!definition) return invalid("customFields")
        // Wrike answers 200 for a read-only field, and for some types on a task they do not apply to, and stores nothing.
        if (definition.type === "CalculatedNumeric" || definition.settings.readOnly === true) continue
        if (DROPPED_WHERE_NOT_APPLYING.has(definition.type) && data.notApplying[task.id]?.includes(definition.id)) continue
        const at = task.customFields.findIndex((field) => field.id === definition.id)
        if (entry.value === null) {
          if (at >= 0) task.customFields.splice(at, 1)
          continue
        }
        // An empty string leaves the field as it was. Any other string is stored as sent, whatever the field's type.
        if (entry.value === "") continue
        // Several choices read back as a JSON-array string, and one as plain text.
        const value = Array.isArray(entry.value) ? (entry.value.length === 1 ? String(entry.value[0]) : JSON.stringify(entry.value)) : String(entry.value)
        if (at >= 0) task.customFields[at] = { id: definition.id, value }
        else task.customFields.push({ id: definition.id, value })
      }
    }
    const added = form.has("addResponsibles") ? (JSON.parse(form.get("addResponsibles")!) as string[]) : []
    const removed = form.has("removeResponsibles") ? (JSON.parse(form.get("removeResponsibles")!) as string[]) : []
    task.responsibleIds = [...new Set([...task.responsibleIds, ...added])].filter((id) => !removed.includes(id))
    task.updatedDate = new Date().toISOString().replace(/\.\d+Z$/, "Z")
    return json({ kind: "tasks", data: [task] })
  }

  /**
   * `PUT /tasks/{a},{b},...`: up to 100 tasks given one change. Wrike refuses
   * importance here with a 400, which the client avoids by sending it one task
   * at a time.
   */
  async function updateTasks(ids: string[], form: URLSearchParams): Promise<Response> {
    if (form.has("importance")) return wrikeError(400, "invalid_parameter", "Parameter 'importance' is not allowed")
    if (ids.length > 100) return wrikeError(400, "invalid_parameter", "Parameter 'taskIds' value is invalid")
    const tasks = ids.map((id) => data.tasks.find((candidate) => candidate.id === id))
    if (tasks.some((task) => task === undefined)) return wrikeError(404, "resource_not_found", "Task not found")
    if (tasks.some((task) => task!.scope === RECYCLED)) return deletedTask()
    const answers = tasks.map((task) => updateTask(task!, form))
    const failed = answers.find((answer) => answer.status !== 200)
    if (failed) return failed
    return json({ kind: "tasks", data: tasks })
  }

  let created = 0

  /** `POST /folders/{id}/tasks`: the folder or space in the path holds the task, and `superTasks` makes it a subtask of another. */
  function createTask(container: string, form: URLSearchParams): Response {
    if (!folderById().has(container)) return wrikeError(404, "resource_not_found", "Folder not found")
    const title = form.get("title") ?? ""
    if (title.trim() === "") return wrikeError(400, "invalid_parameter", "Parameter 'title' value is invalid")
    const superTaskIds = form.has("superTasks") ? (JSON.parse(form.get("superTasks")!) as string[]) : []
    const parents = superTaskIds.map((id) => data.tasks.find((candidate) => candidate.id === id && candidate.scope !== RECYCLED))
    if (parents.some((parent) => parent === undefined)) return wrikeError(400, "invalid_parameter", "Parameter 'superTasks' value is invalid")
    created += 1
    const now = stamp()
    const task: FakeTask = {
      id: `IEAAAAAAKQAN${String(created).padStart(4, "0")}`,
      accountId: ACCOUNT,
      title,
      description: "",
      briefDescription: "",
      parentIds: [container],
      superParentIds: [],
      sharedIds: [ME],
      responsibleIds: form.has("responsibles") ? (JSON.parse(form.get("responsibles")!) as string[]) : [],
      status: "Active",
      importance: "Normal",
      createdDate: now,
      updatedDate: now,
      dates: { type: "Backlog" },
      scope: "WsTask",
      authorIds: [ME],
      customStatusId: STATUS.new,
      hasAttachments: false,
      permalink: permalink(4598469000 + created),
      priority: "0",
      superTaskIds,
      subTaskIds: [],
      dependencyIds: [],
      metadata: [],
      customFields: [],
    }
    data.tasks.push(task)
    for (const parent of parents) parent!.subTaskIds.push(task.id)
    return json({ kind: "tasks", data: [task] })
  }

  /**
   * `DELETE /tasks/{id}` moves the task to the Recycle Bin. Its subtasks are
   * detached and stay active as top-level tasks, so one that was filed nowhere
   * of its own stays in its parent's folders.
   */
  function deleteTask(task: FakeTask): Response {
    task.scope = RECYCLED
    for (const child of data.tasks.filter((candidate) => candidate.superTaskIds.includes(task.id))) {
      child.superTaskIds = child.superTaskIds.filter((id) => id !== task.id)
      if (child.parentIds.length === 0) child.parentIds = [...task.parentIds]
    }
    for (const parent of data.tasks.filter((candidate) => candidate.subTaskIds.includes(task.id))) {
      parent.subTaskIds = parent.subTaskIds.filter((id) => id !== task.id)
    }
    task.subTaskIds = []
    return json({ kind: "tasks", data: [task] })
  }

  async function rest(request: Request, path: string, query: URLSearchParams): Promise<Response> {
    const method = request.method
    const form = method === "GET" ? new URLSearchParams() : new URLSearchParams(await request.text())
    if (method !== "GET") writes.push({ method, path, params: Object.fromEntries(form) })

    if (method === "GET" && path === "/contacts") {
      const contacts = query.get("me") === "true" ? data.contacts.filter((contact) => contact.id === ME) : data.contacts
      return json({ kind: "contacts", data: contacts })
    }
    if (method === "GET" && path === "/workflows") return json({ kind: "workflows", data: data.workflows })
    if (method === "GET" && path === "/customfields") return json({ kind: "customfields", data: data.customFields })
    if (method === "GET" && path === "/spaces") return json({ kind: "spaces", data: data.spaces })
    const spaceWorkflows = /^\/spaces\/([^/]+)\/workflows$/.exec(path)
    if (method === "GET" && spaceWorkflows) return json({ kind: "workflows", data: data.spaceWorkflows[spaceWorkflows[1]!] ?? [] })
    if (method === "GET" && path === "/tasks") {
      return listTasks(path, query, (first) => data.tasks.filter((task) => first.get("subTasks") === "true" || task.superTaskIds.length === 0))
    }
    const spaceFolders = /^\/spaces\/([^/]+)\/folders$/.exec(path)
    if (method === "GET" && spaceFolders) {
      if (!data.spaces.some((space) => space.id === spaceFolders[1])) return wrikeError(404, "resource_not_found", "Space not found")
      const byId = folderById()
      // Tree mode: the space's own node first, then every folder under it.
      return json({ kind: "folderTree", data: [...subtree(spaceFolders[1]!)].map((id) => byId.get(id)!) })
    }
    const containerTasks = /^\/(spaces|folders)\/([^/]+)\/tasks$/.exec(path)
    if (method === "POST" && containerTasks?.[1] === "folders") return createTask(containerTasks[2]!, form)
    if (method === "GET" && containerTasks) {
      const [, kind, id] = containerTasks
      if (!folderById().has(id!)) return wrikeError(404, "resource_not_found", `${kind === "spaces" ? "Space" : "Folder"} not found`)
      return listTasks(path, query, (first) => {
        // A space holds no task directly, so without `descendants` its list is empty.
        const folders = first.get("descendants") === "true" ? subtree(id!) : kind === "spaces" ? new Set<string>() : new Set([id!])
        return tasksIn(folders, first.get("subTasks") === "true")
      })
    }
    if (method === "GET" && path === "/ids") {
      const ids = JSON.parse(query.get("ids") ?? "[]") as string[]
      const found = ids.flatMap((apiV2Id) => {
        const task = data.tasks.find((candidate) => candidate.permalink.endsWith(`=${apiV2Id}`))
        return task ? [{ id: task.id, apiV2Id }] : []
      })
      return json({ kind: "ids", data: found })
    }
    const folders = /^\/folders\/([^/]+)$/.exec(path)
    if (method === "GET" && folders) {
      const ids = folders[1]!.split(",")
      return json({ kind: "folders", data: data.folders.filter((folder) => ids.includes(folder.id)) })
    }

    const batch = /^\/tasks\/([^/]+,[^/]+)$/.exec(path)
    if (batch && method === "PUT") return updateTasks(batch[1]!.split(","), form)

    const taskPath = /^\/tasks\/([^/]+)(\/comments|\/attachments)?$/.exec(path)
    if (taskPath) {
      const task = data.tasks.find((candidate) => candidate.id === taskPath[1])
      if (!task) return wrikeError(404, "resource_not_found", "Task not found")
      if (taskPath[2] === "/attachments") {
        if (method === "GET") return json({ kind: "attachments", data: data.attachments.filter((attachment) => attachment.taskId === task.id) })
      } else if (!taskPath[2]) {
        if (method === "GET") return json({ kind: "tasks", data: [task] })
        if (method !== "GET" && task.scope === RECYCLED) return deletedTask()
        if (method === "PUT") return updateTask(task, form)
        if (method === "DELETE") return deleteTask(task)
      } else {
        if (method === "GET") return json({ kind: "comments", data: data.comments.filter((comment) => comment.taskId === task.id) })
        if (method === "POST") {
          if ((form.get("text") ?? "").trim() === "") return wrikeError(400, "invalid_parameter", "Parameter 'text' value is invalid")
          sequence += 1
          const now = stamp()
          const comment = {
            id: `IEAAAAAAIMAAAN${String(sequence).padStart(2, "0")}`,
            authorId: ME,
            text: storedText(form),
            createdDate: now,
            updatedDate: now,
            taskId: task.id,
          }
          data.comments.unshift(comment)
          return json({ kind: "comments", data: [comment] })
        }
      }
    }
    const attachmentPath = /^\/attachments\/([^/]+)\/(preview|url)$/.exec(path)
    if (attachmentPath && method === "GET") {
      const attachment = data.attachments.find((candidate) => candidate.id === attachmentPath[1])
      if (!attachment) return wrikeError(404, "resource_not_found", "Attachment not found")
      if (attachmentPath[2] === "url") {
        const url = attachment.link ?? `https://storage.example.test/attachments/${attachment.id}/${encodeURIComponent(attachment.name)}?signature=fake-${attachment.version}`
        return json({ kind: "url", data: [{ url }] })
      }
      if (!attachment.contentType?.startsWith("image/")) return wrikeError(404, "resource_not_found", "Preview not available")
      // The JPEG stands for an image the terminal cannot decode: its preview bytes are not a PNG.
      const body = attachment.contentType === "image/png" ? PREVIEW_PNG : Buffer.from("not an image")
      return new Response(body, { headers: { "Content-Type": "image/png" } })
    }
    const commentPath = /^\/comments\/([^/]+)$/.exec(path)
    if (commentPath && method === "PUT") {
      const comment = data.comments.find((candidate) => candidate.id === commentPath[1])
      if (!comment) return commentNotFound()
      if ((form.get("text") ?? "").trim() === "") return wrikeError(400, "invalid_parameter", "Parameter 'text' value is invalid")
      // Wrike keeps updatedDate as it was, so an edit leaves no trace.
      comment.text = storedText(form)
      return json({ kind: "comments", data: [comment] })
    }
    if (commentPath && method === "DELETE") {
      const at = data.comments.findIndex((candidate) => candidate.id === commentPath[1])
      if (at < 0) return commentNotFound()
      data.comments.splice(at, 1)
      return json({ kind: "comments", data: [] })
    }
    return wrikeError(404, "method_not_found", `No fake route for ${method} ${path}`)
  }

  /**
   * `get_item_history` for the items in the scope, newest first, paged by
   * `pageSize` with an opaque token. Like Wrike, it returns only the requested
   * types, and leaves out an item with no change of those types.
   */
  function itemHistory(args: { scope?: { itemIds?: string[] }; requestedChanges?: string[]; pageSize?: number; nextPageToken?: string }) {
    const offset = args.nextPageToken ? Number(Buffer.from(args.nextPageToken, "base64url").toString()) : 0
    const pageSize = args.pageSize ?? 50
    const requested = (type: string) => !args.requestedChanges || args.requestedChanges.includes(type)
    let more = false
    const taskChanges = (args.scope?.itemIds ?? []).flatMap((itemId): Record<string, unknown>[] => {
      const task = data.tasks.find((candidate) => `w:itm:${candidate.permalink.split("=")[1]}` === itemId)
      if (!task) return [{ itemId, success: false, error: "Item not found or access denied" }]
      const all = (data.history[task.id] ?? []).filter((change) => requested(change.type))
      const changes = all.slice(offset, offset + pageSize)
      if (changes.length === 0) return []
      more ||= offset + pageSize < all.length
      return [{ itemId, success: true, title: task.title, baseType: "TASK", changes }]
    })
    return { taskChanges, truncated: more, ...(more ? { nextPageToken: Buffer.from(String(offset + pageSize)).toString("base64url") } : {}) }
  }

  /** `search_requestforms`: the forms whose title, description or field titles hold the text, with pages of field titles and types. */
  function searchForms(args: { textSearch?: string; limit?: number }) {
    const text = (args.textSearch ?? "").toLowerCase()
    const found = forms.list.filter((form) =>
      [form.title, form.description, ...form.pages.flatMap((page) => page.fields.map((field) => field.title))].some((words) => words.toLowerCase().includes(text)),
    )
    const limit = Math.min(args.limit ?? 5, 10)
    return {
      forms: found.slice(0, limit).map((form) => ({
        id: form.id,
        title: form.title,
        description: form.description,
        pages: form.pages.map((page) => ({ title: page.title, fields: page.fields.map((field) => ({ title: field.title, type: field.type })) })),
      })),
      truncated: found.length > limit,
    }
  }

  /** `get_requestform`: the page index alone, or the named pages with their fields. */
  function getForm(args: { form?: string; pageIds?: string[]; includePageIndex?: boolean }) {
    const form = forms.list.find((candidate) => candidate.id === args.form)
    if (!form) return null
    const pageIndex = form.pages.map(({ fields: _fields, ...page }) => page)
    const pages = (args.pageIds ?? []).flatMap((id) => form.pages.filter((page) => page.id === id)).map(({ id, title, fields }) => ({ id, title, fields }))
    return { id: form.id, title: form.title, description: form.description, ...(args.pageIds === undefined || args.includePageIndex !== false ? { pageIndex } : {}), pages }
  }

  /**
   * `submit_requestform`: checks the entry page's mandatory fields and every
   * choice, then creates a task in the first folder of the workspace titled
   * by the first text answer.
   */
  function submitForm(args: { form?: string; fields?: { field: string; values: string[] }[] }): { error: { retrySafe: boolean; message: string } } | Record<string, unknown> {
    const form = forms.list.find((candidate) => candidate.id === args.form)
    if (!form) return { error: { retrySafe: true, message: "Request form not found. Nothing was created." } }
    const answers = new Map((args.fields ?? []).map((entry) => [entry.field, entry.values]))
    const fields = form.pages.flatMap((page) => page.fields)
    for (const [id, values] of answers) {
      const field = fields.find((candidate) => candidate.id === id)
      if (!field) return { error: { retrySafe: true, message: `Unknown field ${id}. Nothing was created.` } }
      if (field.options && values.some((value) => !field.options!.some((option) => option.id === value))) {
        return { error: { retrySafe: true, message: `Field '${field.title}' got a value that is not one of its options. Nothing was created.` } }
      }
    }
    const missing = form.pages.find((page) => page.visibility === "ENTRY")!.fields.find((field) => field.mandatory && !answers.has(field.id))
    if (missing) return { error: { retrySafe: true, message: `Field '${missing.title}' is mandatory. Nothing was created.` } }
    const title = fields.flatMap((field) => (field.type === "TEXT_FIELD" ? (answers.get(field.id) ?? []) : []))[0] ?? form.title
    const folder = data.folders.find((candidate) => candidate.scope === "WsFolder")!
    createTask(folder.id, new URLSearchParams({ title, responsibles: JSON.stringify([ME]) }))
    const itemId = `w:itm:${data.tasks.at(-1)!.permalink.split("=")[1]}`
    if (forms.submitAs === "COMPLETED") return { status: "COMPLETED", itemId }
    const submissionId = `w:acj:${jobs.size + 1}`
    jobs.set(submissionId, { itemId, polls: 0 })
    return { status: "PROCESSING", submissionId }
  }

  async function mcp(request: Request): Promise<Response> {
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method === "DELETE") return new Response(null, { status: 200 })
    const message = (await request.json()) as { id?: number | string; method: string; params?: Record<string, any> }
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result = (value: unknown) => json({ jsonrpc: "2.0", id: message.id, result: value })
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-wrike-mcp", version: "0.0.0" },
        })
      case "ping":
        return result({})
      case "tools/list":
        return result({
          tools: [
            { name: "get_my_inbox", description: "Inbox notifications", inputSchema: { type: "object" } },
            { name: "get_item_history", description: "Field history of items", inputSchema: { type: "object" } },
            { name: "search_requestforms", description: "Finds request forms by text", inputSchema: { type: "object" } },
            { name: "get_requestform", description: "One request form", inputSchema: { type: "object" } },
            { name: "submit_requestform", description: "Submits a request form", inputSchema: { type: "object" } },
            { name: "get_asyncjob", description: "Status of an async job", inputSchema: { type: "object" } },
          ],
        })
      case "tools/call": {
        toolCalls.push({ name: String(message.params?.name), arguments: message.params?.arguments ?? {} })
        const failure = toolFailures.find((candidate) => candidate.tool === message.params?.name)
        if (failure) {
          failure.times -= 1
          if (failure.times <= 0) toolFailures.splice(toolFailures.indexOf(failure), 1)
          return result({ ...(failure.isError ? { isError: true } : {}), content: [{ type: "text", text: failure.text }] })
        }
        const text = (body: unknown) => result({ content: [{ type: "text", text: JSON.stringify(body) }] })
        const toolError = (body: unknown) => result({ isError: true, content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }] })
        const args = message.params?.arguments ?? {}
        switch (message.params?.name) {
          case "get_item_history":
            return text(itemHistory(args))
          case "search_requestforms":
            return text(searchForms(args))
          case "get_requestform": {
            const form = getForm(args)
            return form ? text(form) : toolError("Request form not found or access denied")
          }
          case "submit_requestform": {
            const answer = submitForm(args)
            return "error" in answer ? toolError(answer.error) : text(answer)
          }
          case "get_asyncjob": {
            const job = jobs.get(String(args.jobId))
            if (!job) return toolError("Async job not found")
            job.polls += 1
            return text(job.polls < 2 ? { status: "IN_PROGRESS", progressPercent: 50 } : { status: "COMPLETED", itemId: job.itemId, progressPercent: 100 })
          }
        }
        if (message.params?.name !== "get_my_inbox") {
          return result({ isError: true, content: [{ type: "text", text: `Unknown tool ${message.params?.name}` }] })
        }
        const inboxArgs = args as { includeRead?: boolean; limit?: number }
        const matched = data.inbox.filter((entry) => inboxArgs.includeRead || entry.isUnread)
        const inbox = matched.slice(0, inboxArgs.limit ?? 50)
        const body = { inbox, returned: inbox.length, matched: matched.length, hasMore: inbox.length < matched.length }
        return result({ content: [{ type: "text", text: JSON.stringify(body) }] })
      }
      default:
        return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}${url.search}`)
    const held = holds.findIndex((candidate) => url.pathname.startsWith(candidate.path))
    if (held >= 0) await holds.splice(held, 1)[0]!.released
    const failure = failures.find(
      (candidate) => url.pathname.startsWith(candidate.path) && (!candidate.method || candidate.method === request.method),
    )
    if (failure) {
      failure.times -= 1
      if (failure.times <= 0) failures.splice(failures.indexOf(failure), 1)
      if (failure.status !== 429) return wrikeError(failure.status, "server_error", "Injected failure")
      const limited = { error: "too_many_requests", errorDescription: "Rate limit exceeded, try again later" }
      return Response.json(limited, { status: 429, headers: failure.retryAfter ? { "Retry-After": failure.retryAfter } : {} })
    }
    if (!authorized(request)) return wrikeError(401, "not_authorized", "Access token is unknown or invalid")
    if (url.pathname === "/mcp") return mcp(request)
    if (url.pathname.startsWith("/api/v4/")) return rest(request, url.pathname.slice("/api/v4".length), url.searchParams)
    return wrikeError(404, "method_not_found", `No fake route for ${url.pathname}`)
  }

  return {
    data,
    writes,
    requests,
    toolCalls,
    forms,
    handle,
    fetch: (input, init) => handle(new Request(input, init)),
    fail: (failure) => void failures.push({ times: 1, ...failure }),
    failTool: (failure) => void toolFailures.push({ isError: false, times: 1, ...failure }),
    heal: () => {
      failures.splice(0)
      toolFailures.splice(0)
    },
    hold(path) {
      const { promise, resolve } = Promise.withResolvers<void>()
      holds.push({ path, released: promise })
      return () => resolve()
    },
  }
}
