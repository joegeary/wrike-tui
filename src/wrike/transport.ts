import { z } from "zod"
import type { Params } from "../domain/patch"
import { WrikeFailure, type WrikeError } from "./errors"

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type Method = "GET" | "PUT" | "POST" | "DELETE"

export type Page = { data: unknown[]; next: string | null }

/** Where the access token comes from: a fixed token, or an OAuth login that renews itself. */
export type TokenProvider = {
  /** The token to send, renewed first when it is about to run out. */
  current(): Promise<string>
  /** Called when Wrike answered 401 to `refused`. The token to send again with, or null when there is none. */
  renew(refused: string): Promise<string | null>
}

export const fixedToken = (token: string): TokenProvider => ({ current: async () => token, renew: async () => null })

/**
 * A fetch that sends the provider's token as a Bearer header. A 401 renews
 * the token and sends the request once more, so a body must be a string.
 */
export function withToken(provider: TokenProvider, fetcher: Fetch = fetch, scheme = "Bearer"): Fetch {
  const send = (input: string | URL | Request, init: RequestInit | undefined, token: string) =>
    fetcher(input, { ...init, headers: withHeader(init?.headers, "Authorization", `${scheme} ${token}`) })
  return async (input, init) => {
    const token = await provider.current()
    const response = await send(input, init, token)
    if (response.status !== 401) return response
    const renewed = await provider.renew(token)
    if (renewed === null) return response
    await response.body?.cancel()
    return send(input, init, renewed)
  }
}

export type Transport = {
  /** Resolves to the `data` array of Wrike's response envelope. */
  request(method: Method, path: string, params?: Params): Promise<unknown[]>
  /** One page of a list, with the token that asks for the page after it. */
  requestPage(method: Method, path: string, params?: Params): Promise<Page>
  /** The body of a GET that answers with a file instead of JSON, held in memory and never written anywhere. Null when it is over `limit` bytes. */
  bytes(path: string, limit: number): Promise<Uint8Array | null>
}

export type TransportOptions = {
  /** Full API base, for example `https://www.wrike.com/api/v4`. */
  baseUrl: string
  token: string | TokenProvider
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

/** Plain object headers stay a plain object, which is what the REST transport has always sent. */
function withHeader(headers: HeadersInit | undefined, name: string, value: string): HeadersInit {
  if (headers === undefined || (!(headers instanceof Headers) && !Array.isArray(headers))) return { ...headers, [name]: value }
  const merged = new Headers(headers)
  merged.set(name, value)
  return merged
}

export function createTransport(options: TransportOptions): Transport {
  const provider = typeof options.token === "string" ? fixedToken(options.token) : options.token
  const fetcher = withToken(provider, options.fetch, "bearer")
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const base = options.baseUrl.replace(/\/+$/, "")

  async function send(method: Method, path: string, params: Params): Promise<Response> {
    const encoded = encodeParams(params)
    const query = method === "GET" && encoded.size > 0 ? `?${encoded}` : ""
    try {
      return await fetcher(`${base}${path}${query}`, {
        method,
        headers: method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" },
        body: method === "GET" ? undefined : encoded.toString(),
      })
    } catch (thrown) {
      // A login that cannot be renewed is its own error, not a network one.
      if (thrown instanceof WrikeFailure) throw thrown
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
    bytes: async (path, limit) => readCapped(await respond("GET", path, {}), limit),
  }
}

/** The body when it is at most `limit` bytes, or null as soon as it is known to be larger, without reading the rest. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel()
    return null
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength
    // Leaving the loop cancels the stream.
    if (size > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
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
