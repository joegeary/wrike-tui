import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { candidateBases, endpointsFor } from "../../src/auth/config"
import { readProfile } from "../../src/auth/profile"
import type { Session } from "../../src/auth/session"
import type { TokenStore } from "../../src/auth/token"
import { run, type Io } from "../../src/cli/run"
import type { Fetch } from "../../src/wrike/transport"
import { createFakeWrike } from "../fake/wrike"

const fake = createFakeWrike({ token: "good-token", today: "2026-11-12", now: "2026-11-12T16:00:00Z" })

/** Serves the fake only on the second data center, the way a real token belongs to one host. */
const usDataCenterOnly: Fetch = (input, init) => {
  const url = new URL(String(input))
  if (url.host !== "app-us2.wrike.com") return Promise.resolve(Response.json({ error: "not_authorized" }, { status: 401 }))
  return fake.fetch(input, init)
}

let configHome: string
let stored: string | null
let lines: { out: string[]; err: string[] }
let launched: Session[]

function io(overrides: Partial<Io> & { typed?: string | null } = {}): Io {
  const tokens: TokenStore = {
    get: async () => stored,
    set: async (token) => void (stored = token),
    delete: async () => void (stored = null),
  }
  return {
    env: { XDG_CONFIG_HOME: configHome },
    tokens,
    out: (line) => void lines.out.push(line),
    err: (line) => void lines.err.push(line),
    readSecret: async () => overrides.typed ?? null,
    launch: async (session) => void launched.push(session),
    fetch: usDataCenterOnly,
    sharedApp: null,
    ...overrides,
  }
}

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "wrike-tui-test-"))
  stored = null
  lines = { out: [], err: [] }
  launched = []
})
afterEach(() => rm(configHome, { recursive: true, force: true }))

describe("auth login", () => {
  test("finds the data center that accepts the token and stores token and profile", async () => {
    expect(await run(["auth", "login"], io({ typed: "good-token" }))).toBe(0)
    expect(stored).toBe("good-token")
    expect(await readProfile({ XDG_CONFIG_HOME: configHome })).toEqual({
      host: "app-us2.wrike.com",
      accountId: "IEAAAAAA",
      userId: "KUAAAA01" as never,
      name: "Sam Sample",
    })
    expect(lines.out).toEqual(["Logged in as Sam Sample on app-us2.wrike.com. The token is in the OS keyring."])
  })

  test("a token no data center accepts stores nothing", async () => {
    expect(await run(["auth", "login"], io({ typed: "wrong-token" }))).toBe(1)
    expect(stored).toBeNull()
    expect(await readProfile({ XDG_CONFIG_HOME: configHome })).toBeNull()
    expect(lines.err).toEqual(["No Wrike data center accepted that token. Nothing was stored."])
  })

  test("an empty prompt stores nothing", async () => {
    expect(await run(["auth", "login"], io({ typed: null }))).toBe(1)
    expect(lines.err).toEqual(["No token entered. Nothing was stored."])
  })
})

describe("auth status and logout", () => {
  test("status names the user, the host and the token source", async () => {
    await run(["auth", "login"], io({ typed: "good-token" }))
    lines.out = []
    expect(await run(["auth", "status"], io())).toBe(0)
    expect(lines.out).toEqual(["Logged in as Sam Sample on app-us2.wrike.com. The token comes from the OS keyring."])
  })

  test("status with nobody logged in fails", async () => {
    expect(await run(["auth", "status"], io())).toBe(1)
    expect(lines.err).toEqual(["Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."])
  })

  test("status reports a stored token that stopped working", async () => {
    await run(["auth", "login"], io({ typed: "good-token" }))
    stored = "revoked-token"
    expect(await run(["auth", "status"], io())).toBe(1)
    expect(lines.err[0]).toStartWith("The token for Sam Sample from the OS keyring did not work.")
  })

  test("logout removes the token and the profile", async () => {
    await run(["auth", "login"], io({ typed: "good-token" }))
    expect(await run(["auth", "logout"], io())).toBe(0)
    expect(stored).toBeNull()
    expect(await readProfile({ XDG_CONFIG_HOME: configHome })).toBeNull()
  })
})

describe("opening the client", () => {
  test("without a token it explains how to log in", async () => {
    expect(await run([], io())).toBe(1)
    expect(lines.err).toEqual(["Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."])
    expect(launched).toEqual([])
  })

  test("a keyring token launches with the stored profile and no probe", async () => {
    await run(["auth", "login"], io({ typed: "good-token" }))
    const offline: Fetch = () => Promise.reject(new Error("offline"))
    expect(await run([], io({ fetch: offline }))).toBe(0)
    expect(launched[0]).toMatchObject({
      token: { token: "good-token", source: "keyring" },
      profile: { name: "Sam Sample", host: "app-us2.wrike.com" },
      endpoints: { apiBase: "https://app-us2.wrike.com/api/v4", mcpUrl: "https://mcp.wrike.com/v2" },
    })
  })

  test("WRIKE_TOKEN wins over the keyring and is probed", async () => {
    stored = "keyring-token"
    const env = { XDG_CONFIG_HOME: configHome, WRIKE_TOKEN: "good-token" }
    expect(await run([], io({ env }))).toBe(0)
    expect(launched[0]).toMatchObject({ token: { token: "good-token", source: "env" }, profile: { name: "Sam Sample" } })
  })

  test("a rejected WRIKE_TOKEN does not launch", async () => {
    expect(await run([], io({ env: { XDG_CONFIG_HOME: configHome, WRIKE_TOKEN: "wrong-token" } }))).toBe(1)
    expect(lines.err).toEqual(["Wrike rejected the token. Run `wrike-tui auth login`."])
    expect(launched).toEqual([])
  })
})

describe("endpoints", () => {
  test("WRIKE_HOST overrides the stored host", () => {
    expect(endpointsFor({ WRIKE_HOST: "app-eu.wrike.com" }, "www.wrike.com").apiBase).toBe("https://app-eu.wrike.com/api/v4")
    expect(candidateBases({ WRIKE_HOST: "app-eu.wrike.com" })).toEqual(["https://app-eu.wrike.com/api/v4"])
  })
  test("the development overrides replace both URLs", () => {
    const env = { WRIKE_BASE_URL: "http://127.0.0.1:4010/api/v4", WRIKE_MCP_URL: "http://127.0.0.1:4010/mcp" }
    expect(endpointsFor(env, "www.wrike.com")).toEqual({ apiBase: env.WRIKE_BASE_URL, mcpUrl: env.WRIKE_MCP_URL })
    expect(candidateBases(env)).toEqual([env.WRIKE_BASE_URL])
  })
})

test("an unknown command prints usage and exits 2", async () => {
  expect(await run(["auth", "nope"], io())).toBe(2)
  expect(lines.err[0]).toStartWith("Unknown command: auth nope")
})
