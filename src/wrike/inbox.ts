import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import pkg from "../../package.json"
import type { InboxSource } from "./client"
import { WrikeFailure, type WrikeError } from "./errors"
import { InboxSchema } from "./schemas"
import type { Fetch } from "./transport"

export type InboxOptions = { url: string; token: string; fetch?: Fetch }

const ToolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})

/** Reads the Inbox through Wrike's MCP server, the only public surface that has it. */
export function createInboxSource(options: InboxOptions): InboxSource {
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

  return {
    async inbox({ includeRead }) {
      let result: unknown
      try {
        const client = await connect()
        result = await client.callTool({ name: "get_my_inbox", arguments: { includeRead, limit: 100 } })
      } catch (thrown) {
        connection = null
        throw new WrikeFailure(mcpError(thrown))
      }
      const tool = ToolResult.safeParse(result)
      const text = tool.success ? tool.data.content.find((part) => part.type === "text")?.text : undefined
      if (!tool.success || text === undefined) throw invalid("The Inbox tool returned no text")
      if (tool.data.isError) throw invalid(`The Inbox tool failed: ${text}`)
      const inbox = InboxSchema.safeParse(parseJson(text))
      if (!inbox.success) throw invalid("Unexpected Inbox data from Wrike")
      return inbox.data.inbox
    },

    async close() {
      const open = connection
      connection = null
      await open?.then((client) => client.close()).catch(() => {})
    },
  }
}

const invalid = (message: string) => new WrikeFailure({ kind: "invalid", message })

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function mcpError(thrown: unknown): WrikeError {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  const status = thrown instanceof StreamableHTTPError ? thrown.code : undefined
  if (status === 401 || status === 403 || /unauthorized/i.test(message)) return { kind: "unauthorized" }
  if (status === 429) return { kind: "rate_limited" }
  if (status !== undefined && status >= 500) return { kind: "server", status, message }
  if (status !== undefined && status >= 400) return { kind: "invalid", message }
  return { kind: "network", message }
}
