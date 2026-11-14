import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { OAuthApp } from "../../src/auth/oauth"
import { decodeLogin, type TokenStore } from "../../src/auth/token"
import { run, type Io } from "../../src/cli/run"
import { configPath } from "../../src/persist/persistence"
import type { Fetch } from "../../src/wrike/transport"
import { createFakeWrike } from "../fake/wrike"

const fake = createFakeWrike({ token: "good-token", today: "2026-11-12", now: "2026-11-12T16:00:00Z" })
const SHARED: OAuthApp = { clientId: "shared-id", clientSecret: "shared-secret" }

let configHome: string
let stored: string | null
let savedSecret: string | null
let lines: { out: string[]; err: string[] }
let opened: URL[]
let tokenPosts: URLSearchParams[]

/** Plays Wrike's token endpoint, which hands out the token the fake API accepts, and the API on the US data center. */
const wrike: Fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.href === "https://login.wrike.com/oauth2/token") {
    tokenPosts.push(new URLSearchParams(String(init?.body)))
    return Response.json({ access_token: "good-token", refresh_token: "refresh-2", expires_in: 3600, host: "app-us2.wrike.com" })
  }
  if (url.host !== "app-us2.wrike.com") return Response.json({ error: "not_authorized" }, { status: 401 })
  return fake.fetch(input, init)
}

const memory = (get: () => string | null, set: (value: string | null) => void): TokenStore => ({
  get: async () => get(),
  set: async (value) => set(value),
  delete: async () => set(null),
})

/** The user pastes the address the browser landed on after Wrike sent it back with a code. */
function pastedRedirect(): string {
  const authorize = opened.at(-1)!
  return `${authorize.searchParams.get("redirect_uri")}?code=code-1&state=${authorize.searchParams.get("state")}`
}

function io(overrides: Partial<Io> & { answers?: string[] } = {}): Io {
  const answers = [...(overrides.answers ?? [])]
  return {
    env: { XDG_CONFIG_HOME: configHome },
    tokens: memory(() => stored, (value) => void (stored = value)),
    out: (line) => void lines.out.push(line),
    err: (line) => void lines.err.push(line),
    readSecret: async () => answers.shift() ?? null,
    launch: async () => {},
    fetch: wrike,
    sharedApp: SHARED,
    oauth: {
      clientSecret: memory(() => savedSecret, (value) => void (savedSecret = value)),
      readLine: async (prompt) => (prompt.startsWith("Or paste") ? pastedRedirect() : (answers.shift() ?? null)),
      openUrl: async (url) => void opened.push(new URL(url)),
      interactive: true,
    },
    ...overrides,
  }
}

async function ownAppInConfig(clientId: string) {
  const path = configPath({ XDG_CONFIG_HOME: configHome })
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify({ oauth: { clientId } }))
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "wrike-tui-test-"))
  stored = null
  savedSecret = null
  lines = { out: [], err: [] }
  opened = []
  tokenPosts = []
})
afterEach(() => rm(configHome, { recursive: true, force: true }))

describe("auth login --oauth", () => {
  test("with the shared app and no client ID in config, signs in through the shared app with PKCE", async () => {
    expect(await run(["auth", "login", "--oauth"], io())).toBe(0)

    const authorize = Object.fromEntries(opened[0]!.searchParams)
    expect(authorize).toMatchObject({
      client_id: "shared-id",
      redirect_uri: "http://127.0.0.1:8765/callback",
      scope: "Default,wsReadWrite",
      code_challenge_method: "S256",
    })
    const exchange = Object.fromEntries(tokenPosts[0]!)
    expect(exchange).toMatchObject({
      client_id: "shared-id",
      client_secret: "shared-secret",
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "http://127.0.0.1:8765/callback",
    })
    expect(s256(exchange.code_verifier!)).toBe(authorize.code_challenge!)

    expect(decodeLogin(stored!)).toMatchObject({ app: "shared", accessToken: "good-token", refreshToken: "refresh-2", host: "app-us2.wrike.com" })
    expect(savedSecret).toBeNull()
    expect(lines.out.at(-1)).toBe("Logged in as Sam Sample on app-us2.wrike.com with OAuth. The tokens are in the OS keyring.")
  })

  test("a client ID in config means the user's own app, even when the build has the shared app", async () => {
    await ownAppInConfig("own-id")
    savedSecret = "own-secret"
    expect(await run(["auth", "login", "--oauth"], io())).toBe(0)

    const authorize = Object.fromEntries(opened[0]!.searchParams)
    expect(authorize).toMatchObject({ client_id: "own-id", redirect_uri: "http://localhost:8765/callback", code_challenge_method: "S256" })
    const exchange = Object.fromEntries(tokenPosts[0]!)
    expect(exchange).toMatchObject({ client_id: "own-id", client_secret: "own-secret" })
    expect(s256(exchange.code_verifier!)).toBe(authorize.code_challenge!)
    expect(decodeLogin(stored!)?.app).toBe("own")
    expect(lines.out.at(-1)).toBe("Logged in as Sam Sample on app-us2.wrike.com with OAuth. The tokens and the client secret are in the OS keyring.")
  })

  test("the shared app stops when its port is taken, since Wrike only sends the browser back there", async () => {
    const squatter = Bun.serve({ hostname: "127.0.0.1", port: 8765, fetch: () => new Response("busy") })
    try {
      expect(await run(["auth", "login", "--oauth"], io())).toBe(1)
    } finally {
      await squatter.stop()
    }
    expect(opened).toEqual([])
    expect(stored).toBeNull()
    expect(lines.err[0]).toStartWith("Could not listen on 127.0.0.1:8765")
    expect(lines.err[0]).toContain("Close the program using it")
  })
})

describe("plain auth login", () => {
  test("signs in through the browser with the shared app, asking nothing", async () => {
    expect(await run(["auth", "login"], io())).toBe(0)
    expect(opened.at(-1)?.searchParams.get("client_id")).toBe("shared-id")
    expect(decodeLogin(stored!)?.app).toBe("shared")
  })

  test("--token stores a permanent token instead", async () => {
    expect(await run(["auth", "login", "--token"], io({ answers: ["good-token"] }))).toBe(0)
    expect(opened).toEqual([])
    expect(stored).toBe("good-token")
  })

  test("without the shared app it signs in with the user's own app when config.json names one", async () => {
    await ownAppInConfig("own-id")
    expect(await run(["auth", "login"], io({ sharedApp: null, answers: ["own-secret"] }))).toBe(0)
    expect(opened.at(-1)?.searchParams.get("client_id")).toBe("own-id")
    expect(decodeLogin(stored!)?.app).toBe("own")
  })

  test("without any app it asks for a token", async () => {
    expect(await run(["auth", "login"], io({ sharedApp: null, answers: ["good-token"] }))).toBe(0)
    expect(opened).toEqual([])
    expect(stored).toBe("good-token")
  })

  test("piped input reads a token even with the shared app", async () => {
    const piped = io({ answers: ["good-token"] })
    expect(await run(["auth", "login"], { ...piped, oauth: { ...piped.oauth!, interactive: false } })).toBe(0)
    expect(opened).toEqual([])
    expect(stored).toBe("good-token")
  })

  test("the usage names the browser as the default only in a build with the shared app", async () => {
    await run(["--help"], io())
    await run(["--help"], io({ sharedApp: null }))
    const [shared, own] = lines.out
    expect(shared).toContain("auth login          Sign in through the browser\n")
    expect(shared).toContain("auth login --token  Store a Wrike permanent access token in the OS keyring instead")
    expect(shared).not.toContain("App Console")
    expect(own).toContain("auth login --oauth  Sign in through the browser with an app from Wrike's App Console")
  })
})

describe("renewing an OAuth login", () => {
  const expiredLogin = (app?: "shared" | "own") =>
    JSON.stringify({
      kind: "oauth",
      ...(app ? { app } : {}),
      accessToken: "old-token",
      refreshToken: "refresh-1",
      expiresAt: "2020-01-01T00:00:00.000Z",
      host: "app-us2.wrike.com",
    })

  test("a shared login renews with the shared app, whatever config says now", async () => {
    await ownAppInConfig("own-id")
    savedSecret = "own-secret"
    stored = expiredLogin("shared")
    expect(await run(["auth", "status"], io())).toBe(0)
    expect(Object.fromEntries(tokenPosts[0]!)).toMatchObject({
      client_id: "shared-id",
      client_secret: "shared-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    })
    expect(decodeLogin(stored!)).toMatchObject({ app: "shared", refreshToken: "refresh-2" })
    expect(lines.out[0]).toStartWith("Logged in as Sam Sample on app-us2.wrike.com with OAuth.")
  })

  test("an own login renews with the client ID from config and the secret from the keyring", async () => {
    await ownAppInConfig("own-id")
    savedSecret = "own-secret"
    stored = expiredLogin("own")
    expect(await run(["auth", "status"], io())).toBe(0)
    expect(Object.fromEntries(tokenPosts[0]!)).toMatchObject({ client_id: "own-id", client_secret: "own-secret", grant_type: "refresh_token" })
    expect(decodeLogin(stored!)?.app).toBe("own")
  })

  test("a login stored by 0.2.0, without an app, is the user's own", async () => {
    await ownAppInConfig("own-id")
    savedSecret = "own-secret"
    stored = expiredLogin()
    expect(await run(["auth", "status"], io())).toBe(0)
    expect(Object.fromEntries(tokenPosts[0]!)).toMatchObject({ client_id: "own-id", client_secret: "own-secret" })
    expect(decodeLogin(stored!)?.app).toBe("own")
  })

  test("a shared login in a build without the shared app says it cannot renew and how to log in again", async () => {
    stored = expiredLogin("shared")
    expect(await run(["auth", "status"], io({ sharedApp: null }))).toBe(1)
    expect(tokenPosts).toEqual([])
    expect(lines.err[0]).toEndWith(
      "Your Wrike login came from a release build of wrike-tui, and this build cannot renew it. Run `wrike-tui auth login`.",
    )
  })
})
