import { describe, expect, test } from "bun:test"
import { describeError, WrikeFailure, type WrikeError } from "../../src/wrike/errors"
import { createTransport, encodeParams, retryAfterMs, type Fetch } from "../../src/wrike/transport"

type Call = { url: string; init: RequestInit }

function transportWith(responses: (Response | Error)[], options: { readOnly?: boolean } = {}) {
  const calls: Call[] = []
  const sleeps: number[] = []
  const fetch: Fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error("no response queued")
    if (next instanceof Error) throw next
    return next
  }
  const transport = createTransport({
    baseUrl: "https://www.wrike.com/api/v4/",
    token: "secret",
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    ...options,
  })
  return { transport, calls, sleeps }
}

const ok = (data: unknown[]) => Response.json({ kind: "tasks", data })
const failure = (status: number, body: unknown = { error: "x", errorDescription: "bad thing" }) => Response.json(body, { status })

async function errorOf(promise: Promise<unknown>): Promise<WrikeError> {
  try {
    await promise
  } catch (thrown) {
    if (thrown instanceof WrikeFailure) return thrown.error
    throw thrown
  }
  throw new Error("expected a failure")
}

describe("encodeParams", () => {
  test("arrays and objects travel as JSON strings, scalars as text", () => {
    const encoded = encodeParams({ responsibles: ["KUAJ25LC"], dates: { due: "2026-11-20" }, subTasks: true, pageSize: 100, title: "a b" })
    expect(Object.fromEntries(encoded)).toEqual({
      responsibles: '["KUAJ25LC"]',
      dates: '{"due":"2026-11-20"}',
      subTasks: "true",
      pageSize: "100",
      title: "a b",
    })
  })
})

describe("request", () => {
  test("a GET puts params in the query and sends the bearer token", async () => {
    const { transport, calls } = transportWith([ok([{ id: 1 }])])
    expect(await transport.request("GET", "/tasks", { responsibles: ["KUAJ25LC"] })).toEqual([{ id: 1 }])
    expect(calls[0]!.url).toBe("https://www.wrike.com/api/v4/tasks?responsibles=%5B%22KUAJ25LC%22%5D")
    expect(calls[0]!.init.method).toBe("GET")
    expect(calls[0]!.init.headers).toEqual({ Authorization: "bearer secret" })
    expect(calls[0]!.init.body).toBeUndefined()
  })

  test("a PUT sends a form body and no query", async () => {
    const { transport, calls } = transportWith([ok([])])
    await transport.request("PUT", "/tasks/T1", { title: "New title", addResponsibles: ["A"] })
    expect(calls[0]!.url).toBe("https://www.wrike.com/api/v4/tasks/T1")
    expect(calls[0]!.init.headers).toEqual({
      Authorization: "bearer secret",
      "Content-Type": "application/x-www-form-urlencoded",
    })
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({ title: "New title", addResponsibles: '["A"]' })
  })

  test("a 429 retries with exponential backoff and then succeeds", async () => {
    const { transport, calls, sleeps } = transportWith([failure(429), failure(429), ok(["done"])])
    expect(await transport.request("GET", "/tasks")).toEqual(["done"])
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([500, 1000])
  })

  test("a 429 gives up after three retries", async () => {
    const { transport, calls, sleeps } = transportWith([failure(429), failure(429), failure(429), failure(429)])
    expect(await errorOf(transport.request("GET", "/tasks"))).toEqual({ kind: "rate_limited" })
    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([500, 1000, 2000])
  })

  test.each([
    [401, { kind: "unauthorized" }],
    [403, { kind: "unauthorized" }],
    [404, { kind: "not_found" }],
    [400, { kind: "invalid", message: "bad thing" }],
    [503, { kind: "server", status: 503, message: "bad thing" }],
  ] as const)("status %i becomes a tagged error", async (status, expected) => {
    const { transport } = transportWith([failure(status)])
    expect(await errorOf(transport.request("GET", "/tasks"))).toEqual(expected)
  })

  test("a failed connection is a network error", async () => {
    const { transport } = transportWith([new Error("connection refused")])
    expect(await errorOf(transport.request("GET", "/tasks"))).toEqual({ kind: "network", message: "connection refused" })
  })

  test("a body without a data array is invalid", async () => {
    const { transport } = transportWith([Response.json({ kind: "tasks" })])
    expect(await errorOf(transport.request("GET", "/tasks"))).toEqual({ kind: "invalid", message: "Unexpected response from GET /tasks" })
  })
})

describe("requestPage", () => {
  test("returns the data with the token for the next page", async () => {
    const { transport } = transportWith([Response.json({ kind: "tasks", nextPageToken: "TOKEN2", responseSize: 3, data: [1, 2] })])
    expect(await transport.requestPage("GET", "/tasks", { pageSize: 2 })).toEqual({ data: [1, 2], next: "TOKEN2" })
  })

  test("the last page has no next token", async () => {
    const { transport } = transportWith([ok([3])])
    expect(await transport.requestPage("GET", "/tasks", { nextPageToken: "TOKEN2", fields: ["parentIds"] })).toEqual({ data: [3], next: null })
  })

  test("a follow-up sends the token and the fields in the query", async () => {
    const { transport, calls } = transportWith([ok([])])
    await transport.requestPage("GET", "/folders/F1/tasks", { nextPageToken: "TOKEN2", fields: ["parentIds"] })
    expect(calls[0]!.url).toBe("https://www.wrike.com/api/v4/folders/F1/tasks?nextPageToken=TOKEN2&fields=%5B%22parentIds%22%5D")
  })
})

describe("Retry-After", () => {
  const limited = (retryAfter: string) => Response.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": retryAfter } })

  test("a 429 with Retry-After waits that many seconds instead of the backoff", async () => {
    const { transport, sleeps } = transportWith([limited("7"), failure(429), ok(["done"])])
    expect(await transport.request("GET", "/tasks")).toEqual(["done"])
    expect(sleeps).toEqual([7000, 1000])
  })

  test("seconds, an HTTP date, a cap and nonsense", () => {
    const now = Date.parse("2026-11-12T16:00:00Z")
    expect(retryAfterMs("2", now)).toBe(2000)
    expect(retryAfterMs("0", now)).toBe(0)
    expect(retryAfterMs("Thu, 12 Nov 2026 16:00:05 GMT", now)).toBe(5000)
    expect(retryAfterMs("Thu, 12 Nov 2026 15:00:00 GMT", now)).toBe(0)
    expect(retryAfterMs("3600", now)).toBe(60_000)
    expect(retryAfterMs("soon", now)).toBeNull()
    expect(retryAfterMs("", now)).toBeNull()
    expect(retryAfterMs(null, now)).toBeNull()
  })
})

describe("read-only mode", () => {
  test.each(["PUT", "POST", "DELETE"] as const)("a %s is refused before any request is sent", async (method) => {
    const { transport, calls } = transportWith([ok([])], { readOnly: true })
    expect(await errorOf(transport.request(method, "/tasks/T1", { title: "x" }))).toEqual({ kind: "read_only" })
    expect(calls).toEqual([])
  })

  test("a GET still goes out", async () => {
    const { transport, calls } = transportWith([ok([1])], { readOnly: true })
    expect(await transport.request("GET", "/tasks")).toEqual([1])
    expect(calls).toHaveLength(1)
  })

  test("the error reads as the status bar shows it", () => {
    expect(describeError({ kind: "read_only" })).toBe("read-only mode: not saved")
  })
})
