import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import pkg from "../../package.json"
import type { McpClient } from "./client"
import { WrikeFailure, type WrikeError } from "./errors"
import { AsyncJobSchema, FormIndexSchema, FormPagesSchema, FormSearchSchema, HistorySchema, InboxSchema, SubmissionSchema, SubmitErrorSchema } from "./schemas"
import type { Fetch } from "./transport"

/** `readOnly` refuses the one tool that writes, `submit_requestform`, before it is sent. */
export type McpOptions = { url: string; token: string; fetch?: Fetch; readOnly?: boolean }

const ToolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})

const RATE_LIMITED = /rate limit/i
/** What `get_requestform` answered in plain text during the probe: "A server error occurred. Retry later." */
const RETRY_LATER = /server error occurred|retry later/i
/** `search_requestforms` takes at most 10 forms a page. */
const FORM_PAGE = 10

/** The history types asked for. Comments come from REST, and descriptions would flood the stream. */
const HISTORY_TYPES = ["TITLE", "ASSIGNEES", "PARENTS", "STATUS", "START_DATE", "DUE_DATE", "DURATION", "ATTACHMENTS", "CUSTOM_FIELDS"]

/** Reads what only Wrike's MCP server has: the Inbox and field history. One connection, opened on first use and shared by every call. */
export function createMcpClient(options: McpOptions): McpClient {
  let connection: Promise<Client> | null = null

  function connect(): Promise<Client> {
    if (!connection) {
      const opening = (async () => {
        const client = new Client({ name: pkg.name, version: pkg.version })
        await client.connect(
          new StreamableHTTPClientTransport(new URL(options.url), {
            requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
            fetch: options.fetch,
          }),
        )
        return client
      })()
      connection = opening
      // A failed connect must not poison every later refresh.
      opening.catch(() => drop(opening))
    }
    return connection
  }

  /** Forgets a connection a call failed on and closes it, unless another call already replaced it. */
  function drop(used: Promise<Client>): void {
    if (connection !== used) return
    connection = null
    used.then((client) => client.close()).catch(() => {})
  }

  async function raw(name: string, args: Record<string, unknown>): Promise<unknown> {
    const used = connect()
    try {
      return await (await used).callTool({ name, arguments: args })
    } catch (thrown) {
      drop(used)
      throw new WrikeFailure(mcpError(thrown))
    }
  }

  /** Calls a tool and parses the JSON in its text with `schema`. `what` names the data in error messages. */
  async function call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>, what: string): Promise<T> {
    const parsed = schema.safeParse(toolJson(await raw(name, args), what))
    if (!parsed.success) throw invalid(`Unexpected ${what} data from Wrike`)
    return parsed.data
  }

  return {
    async inbox({ includeRead }) {
      return (await call("get_my_inbox", { includeRead, limit: 100 }, InboxSchema, "Inbox")).inbox
    },

    async history(item, { pageSize, pageToken }) {
      const scope = { type: "ITEMS", itemIds: [`w:itm:${item}`] }
      const args = { scope, requestedChanges: HISTORY_TYPES, pageSize, ...(pageToken ? { nextPageToken: pageToken } : {}) }
      const answer = await call("get_item_history", args, HistorySchema, "history")
      // Wrike leaves out an item with no change of the requested types.
      const [found] = answer.taskChanges
      if (!found) return { entries: [], next: null }
      if (!found.success) throw new WrikeFailure(itemError(found.error))
      return { entries: found.changes, next: answer.nextPageToken ?? null }
    },

    async requestForms(text) {
      return (await call("search_requestforms", { textSearch: text, limit: FORM_PAGE }, FormSearchSchema, "request form")).forms
    },

    async requestForm(form) {
      // The index first, then each page Wrike offers on its own call, so no answer runs past the tool's size limit.
      const { pageIndex } = await call("get_requestform", { form: form.id }, FormIndexSchema, "request form")
      const pages = []
      for (const page of pageIndex.filter((entry) => entry.visibility.kind !== "orphan")) {
        const answer = await call("get_requestform", { form: form.id, pageIds: [page.id], includePageIndex: false }, FormPagesSchema, "request form")
        pages.push({ ...page, fields: answer.pages.find((candidate) => candidate.id === page.id)?.fields ?? [] })
      }
      if (!pages.some((page) => page.visibility.kind === "entry")) throw invalid("Wrike described the form without a first page")
      return { form, pages }
    },

    async submitRequestForm(form, answers) {
      if (options.readOnly) throw new WrikeFailure({ kind: "read_only" })
      const result = await raw("submit_requestform", { form, fields: answers })
      // A refusal comes back as JSON naming the field to fix and whether sending again is safe.
      const refused = SubmitErrorSchema.safeParse(errorJson(result))
      if (refused.success) return { kind: "refused", message: refused.data.message, retrySafe: refused.data.retrySafe }
      const parsed = SubmissionSchema.safeParse(toolJson(result, "submission"))
      if (!parsed.success) throw invalid("Unexpected submission data from Wrike")
      return parsed.data
    },

    async submission(job) {
      return call("get_asyncjob", { jobId: job }, AsyncJobSchema, "submission")
    },

    async close() {
      const open = connection
      connection = null
      await open?.then((client) => client.close()).catch(() => {})
    },
  }
}

const invalid = (message: string) => new WrikeFailure({ kind: "invalid", message })

/**
 * The JSON a tool answered with. Wrike reports a rate limit as a tool result
 * in plain text, with or without `isError`, so text that is not JSON is
 * checked for it. JSON is data even when it mentions a rate limit.
 */
function toolJson(result: unknown, what: string): unknown {
  const tool = ToolResult.safeParse(result)
  const text = tool.success ? tool.data.content.find((part) => part.type === "text")?.text : undefined
  if (!tool.success || text === undefined) throw invalid(`The ${what} tool returned no text`)
  const json = tool.data.isError ? undefined : parseJson(text)
  if (json !== undefined) return json
  if (RATE_LIMITED.test(text)) throw new WrikeFailure({ kind: "rate_limited" })
  if (RETRY_LATER.test(text)) throw new WrikeFailure({ kind: "unavailable", message: text })
  throw invalid(tool.data.isError ? `The ${what} tool failed: ${text}` : `Unexpected ${what} data from Wrike`)
}

/** An item `get_item_history` could not read. The error's shape is not documented, so its words are taken from wherever they are. */
function itemError(error: unknown): WrikeError {
  const words = typeof error === "string" ? error : z.object({ message: z.string() }).safeParse(error).data?.message ?? JSON.stringify(error ?? "no details")
  return RATE_LIMITED.test(words) ? { kind: "rate_limited" } : { kind: "invalid", message: `Wrike did not give the history: ${words}` }
}

/** The JSON of a tool result marked as an error, or undefined. */
function errorJson(result: unknown): unknown {
  const tool = ToolResult.safeParse(result)
  if (!tool.success || !tool.data.isError) return undefined
  const text = tool.data.content.find((part) => part.type === "text")?.text
  return text === undefined ? undefined : parseJson(text)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function mcpError(thrown: unknown): WrikeError {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  const status = thrown instanceof StreamableHTTPError ? thrown.code : undefined
  if (status === 401 || status === 403 || /unauthorized/i.test(message)) return { kind: "unauthorized" }
  if (status === 429 || RATE_LIMITED.test(message)) return { kind: "rate_limited" }
  if (status !== undefined && status >= 500) return { kind: "server", status, message }
  if (status !== undefined && status >= 400) return { kind: "invalid", message }
  return { kind: "network", message }
}
