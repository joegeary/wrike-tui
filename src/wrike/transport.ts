import { z } from "zod"
import type { Params } from "../domain/patch"
import { WrikeFailure, type WrikeError } from "./errors"

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type Method = "GET" | "PUT" | "POST" | "DELETE"

export type Page = { data: unknown[]; next: string | null }

export type Transport = {
  /** Resolves to the `data` array of Wrike's response envelope. */
  request(method: Method, path: string, params?: Params): Promise<unknown[]>
  /** One page of a list, with the token that asks for the page after it. */
  requestPage(method: Method, path: string, params?: Params): Promise<Page>
  /** The body of a GET that answers with a file instead of JSON, held in memory and never written anywhere. */
  bytes(path: string): Promise<Uint8Array>
}

export type TransportOptions = {
  /** Full API base, for example `https://www.wrike.com/api/v4`. */
  baseUrl: string
  token: string
  fetch?: Fetch
  sleep?: (ms: number) => Promise<void>
  /** Refuses every request that is not a GET, before it reaches the network. */
  readOnly?: boolean
}

const MAX_RETRIES = 3
const BACKOFF_MS = 500
const MAX_RETRY_AFTER_MS = 60_000

const Envelope = z.object({ data: z.array(z.unknown()), nextPageToken: z.string().optional() })
const ErrorBody = z.object({ error: z.string().optional(), errorDescription: z.string().optional() })

export function encodeParams(params: Params): URLSearchParams {
  const encoded = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    encoded.set(key, typeof value === "object" ? JSON.stringify(value) : String(value))
  }
  return encoded
}

export function createTransport(options: TransportOptions): Transport {
  const fetcher = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const base = options.baseUrl.replace(/\/+$/, "")

  async function send(method: Method, path: string, params: Params): Promise<Response> {
    const encoded = encodeParams(params)
    const query = method === "GET" && encoded.size > 0 ? `?${encoded}` : ""
    try {
      return await fetcher(`${base}${path}${query}`, {
        method,
        headers: {
          Authorization: `bearer ${options.token}`,
          ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
        },
        body: method === "GET" ? undefined : encoded.toString(),
      })
    } catch (thrown) {
      throw new WrikeFailure({ kind: "network", message: thrown instanceof Error ? thrown.message : String(thrown) })
    }
  }

  /** A successful response, after waiting out up to three 429s. */
  async function respond(method: Method, path: string, params: Params): Promise<Response> {
    if (options.readOnly && method !== "GET") throw new WrikeFailure({ kind: "read_only" })
    for (let attempt = 0; ; attempt++) {
      const response = await send(method, path, params)
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(response.headers.get("retry-after"), Date.now()) ?? BACKOFF_MS * 2 ** attempt)
        continue
      }
      if (!response.ok) throw new WrikeFailure(await errorFrom(response))
      return response
    }
  }

  async function requestPage(method: Method, path: string, params: Params = {}): Promise<Page> {
    const envelope = Envelope.safeParse(await (await respond(method, path, params)).json().catch(() => null))
    if (!envelope.success) {
      throw new WrikeFailure({ kind: "invalid", message: `Unexpected response from ${method} ${path}` })
    }
    return { data: envelope.data.data, next: envelope.data.nextPageToken ?? null }
  }

  return {
    requestPage,
    request: async (method, path, params) => (await requestPage(method, path, params)).data,
    bytes: async (path) => new Uint8Array(await (await respond("GET", path, {})).arrayBuffer()),
  }
}

/** How long a `Retry-After` header asks to wait: seconds or an HTTP date. Null when it says neither. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (header === null || header.trim() === "") return null
  const seconds = Number(header)
  const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now
  return Number.isNaN(wait) ? null : Math.max(0, Math.min(wait, MAX_RETRY_AFTER_MS))
}

async function errorFrom(response: Response): Promise<WrikeError> {
  const body = ErrorBody.safeParse(await response.json().catch(() => null))
  const message = (body.success && (body.data.errorDescription || body.data.error)) || response.statusText || "no details"
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" }
  if (response.status === 404) return { kind: "not_found" }
  if (response.status === 429) return { kind: "rate_limited" }
  if (response.status >= 500) return { kind: "server", status: response.status, message }
  return { kind: "invalid", message }
}
