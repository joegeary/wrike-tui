import { describe, expect, test } from "bun:test"
import { WrikeFailure, type WrikeError } from "../../src/wrike/errors"
import { createTransport, encodeParams, type Fetch } from "../../src/wrike/transport"

type Call = { url: string; init: RequestInit }

function transportWith(responses: (Response | Error)[]) {
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
