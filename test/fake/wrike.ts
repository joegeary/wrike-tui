import type { Fetch } from "../../src/wrike/transport"
import { ME, seed, type FakeData, type FakeTask } from "./data"

export type RecordedWrite = { method: string; path: string; params: Record<string, string> }
type Failure = { method?: string; path: string; status: number; times: number; retryAfter?: string }
type ToolFailure = { tool: string; text: string; isError: boolean; times: number }

export type FakeWrike = {
  data: FakeData
  /** Every REST write, in order, with its form parameters as sent. */
  writes: RecordedWrite[]
  /** Every request line, in order. */
  requests: string[]
  handle(request: Request): Promise<Response>
  fetch: Fetch
  /** Makes the next `times` requests whose path starts with `path` fail with `status`. A 429 can carry a `Retry-After` header. */
  fail(failure: { method?: string; path: string; status: number; times?: number; retryAfter?: string }): void
  /** Makes the next `times` calls of an MCP tool answer with `text` instead of JSON, the way Wrike reports a rate limit. */
  failTool(failure: { tool: string; text: string; isError?: boolean; times?: number }): void
  /** Drops every failure still waiting, so the fake answers normally again. */
  heal(): void
}

const OPTIONAL_LIST_FIELDS = [
  "description", "briefDescription", "parentIds", "superParentIds", "sharedIds", "responsibleIds", "authorIds",
  "hasAttachments", "superTaskIds", "subTaskIds", "dependencyIds", "metadata", "customFields",
] as const

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
}

const realTime = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const commentNotFound = () => wrikeError(404, "resource_not_found", "Comment not found or access denied")

export function createFakeWrike(options: FakeOptions): FakeWrike {
  const data = seed(options.today, options.now)
  const writes: RecordedWrite[] = []
  const requests: string[] = []
  const failures: Failure[] = []
  const toolFailures: ToolFailure[] = []
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
    const added = form.has("addResponsibles") ? (JSON.parse(form.get("addResponsibles")!) as string[]) : []
    const removed = form.has("removeResponsibles") ? (JSON.parse(form.get("removeResponsibles")!) as string[]) : []
    task.responsibleIds = [...new Set([...task.responsibleIds, ...added])].filter((id) => !removed.includes(id))
    task.updatedDate = new Date().toISOString().replace(/\.\d+Z$/, "Z")
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

    const taskPath = /^\/tasks\/([^/]+)(\/comments)?$/.exec(path)
    if (taskPath) {
      const task = data.tasks.find((candidate) => candidate.id === taskPath[1])
      if (!task) return wrikeError(404, "resource_not_found", "Task not found")
      if (!taskPath[2]) {
        if (method === "GET") return json({ kind: "tasks", data: [task] })
        if (method === "PUT") return updateTask(task, form)
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

  /** `get_item_history` for the items in the scope, newest first, paged by `pageSize` with an opaque token. */
  function itemHistory(args: { scope?: { itemIds?: string[] }; pageSize?: number; nextPageToken?: string }) {
    const offset = args.nextPageToken ? Number(Buffer.from(args.nextPageToken, "base64url").toString()) : 0
    const pageSize = args.pageSize ?? 50
    let more = false
    const taskChanges = (args.scope?.itemIds ?? []).map((itemId) => {
      const task = data.tasks.find((candidate) => `w:itm:${candidate.permalink.split("=")[1]}` === itemId)
      if (!task) return { itemId, success: false, error: "Item not found or access denied" }
      const all = data.history[task.id] ?? []
      more ||= offset + pageSize < all.length
      return { itemId, success: true, title: task.title, baseType: "TASK", changes: all.slice(offset, offset + pageSize) }
    })
    return { taskChanges, truncated: more, ...(more ? { nextPageToken: Buffer.from(String(offset + pageSize)).toString("base64url") } : {}) }
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
          ],
        })
      case "tools/call": {
        const failure = toolFailures.find((candidate) => candidate.tool === message.params?.name)
        if (failure) {
          failure.times -= 1
          if (failure.times <= 0) toolFailures.splice(toolFailures.indexOf(failure), 1)
          return result({ ...(failure.isError ? { isError: true } : {}), content: [{ type: "text", text: failure.text }] })
        }
        if (message.params?.name === "get_item_history") return result({ content: [{ type: "text", text: JSON.stringify(itemHistory(message.params.arguments ?? {})) }] })
        if (message.params?.name !== "get_my_inbox") {
          return result({ isError: true, content: [{ type: "text", text: `Unknown tool ${message.params?.name}` }] })
        }
        const args = (message.params.arguments ?? {}) as { includeRead?: boolean; limit?: number }
        const matched = data.inbox.filter((entry) => args.includeRead || entry.isUnread)
        const inbox = matched.slice(0, args.limit ?? 50)
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
    handle,
    fetch: (input, init) => handle(new Request(input, init)),
    fail: (failure) => void failures.push({ times: 1, ...failure }),
    failTool: (failure) => void toolFailures.push({ isError: false, times: 1, ...failure }),
    heal: () => {
      failures.splice(0)
      toolFailures.splice(0)
    },
  }
}
