import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import pkg from "../../package.json"
import type { McpClient } from "./client"
import { WrikeFailure, type WrikeError } from "./errors"
import { HistorySchema, InboxSchema } from "./schemas"
import type { Fetch } from "./transport"

export type McpOptions = { url: string; token: string; fetch?: Fetch }

const ToolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})

const RATE_LIMITED = /rate limit/i

/** The history types asked for. Comments come from REST, and descriptions would flood the stream. */
const HISTORY_TYPES = ["TITLE", "ASSIGNEES", "PARENTS", "STATUS", "START_DATE", "DUE_DATE", "DURATION", "ATTACHMENTS", "CUSTOM_FIELDS"]

/** Reads what only Wrike's MCP server has: the Inbox and field history. One connection, opened on first use and shared by every call. */
export function createMcpClient(options: McpOptions): McpClient {
  let connection: Promise<Client> | null = null

  function connect(): Promise<Client> {
    connection ??= (async () => {
      const client = new Client({ name: pkg.name, version: pkg.version })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(options.url), {
          requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
          fetch: options.fetch,
        }),
      )
      return client
    })()
    // A failed connect must not poison every later refresh.
    connection.catch(() => (connection = null))
    return connection
  }

  /** Calls a tool and parses the JSON in its text with `schema`. `what` names the data in error messages. */
  async function call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>, what: string): Promise<T> {
    let result: unknown
    try {
      result = await (await connect()).callTool({ name, arguments: args })
    } catch (thrown) {
      connection = null
      throw new WrikeFailure(mcpError(thrown))
    }
    const parsed = schema.safeParse(toolJson(result, what))
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
      const [found] = answer.taskChanges
      if (!found) throw new WrikeFailure({ kind: "not_found" })
      if (!found.success) throw new WrikeFailure(itemError(found.error))
      return { entries: found.changes, next: answer.nextPageToken ?? null }
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
  throw invalid(tool.data.isError ? `The ${what} tool failed: ${text}` : `Unexpected ${what} data from Wrike`)
}

/** An item `get_item_history` could not read. The error's shape is not documented, so its words are taken from wherever they are. */
function itemError(error: unknown): WrikeError {
  const words = typeof error === "string" ? error : z.object({ message: z.string() }).safeParse(error).data?.message ?? JSON.stringify(error ?? "no details")
  return RATE_LIMITED.test(words) ? { kind: "rate_limited" } : { kind: "invalid", message: `Wrike did not give the history: ${words}` }
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
