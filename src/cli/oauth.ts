import { authorizeUrl, exchangeCode, type OAuthApp } from "../auth/oauth"
import { writeProfile } from "../auth/profile"
import { probe } from "../auth/session"
import { encodeLogin, type TokenStore } from "../auth/token"
import { loadOAuthSettings, saveOAuthClientId, type OAuthSettings } from "../persist/oauth"
import { describeError, toWrikeError } from "../wrike/errors"
import type { Io } from "./run"

/** What only `auth login --oauth` needs from the terminal and the OS. */
export type OAuthIo = {
  clientSecret: TokenStore
  readLine(prompt: string, signal?: AbortSignal): Promise<string | null>
  openUrl(url: string): Promise<void>
  /** Whether a person is at the terminal to paste the address the browser landed on. */
  interactive: boolean
}

/** Wrike's authorization code lives ten minutes, so waiting longer cannot help. */
const WAIT_MS = 10 * 60_000

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>wrike-tui</title>
<body style="font-family: system-ui, sans-serif; margin: 3rem">wrike-tui has the answer from Wrike. You can close this tab and go back to the terminal.</body>`

const messageOf = (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown))

/** The client ID and secret a refresh needs, or null when either is missing. */
export async function storedApp(io: Io): Promise<OAuthApp | null> {
  const [settings, clientSecret] = await Promise.all([loadOAuthSettings(io.env), io.oauth?.clientSecret.get() ?? null])
  return settings.clientId && clientSecret ? { clientId: settings.clientId, clientSecret } : null
}

/**
 * Signs in through the browser: the authorize URL opens, Wrike redirects to
 * the loopback server with a code, and the code becomes tokens. Where the
 * redirect cannot reach the loopback server, the user pastes the address the
 * browser landed on instead.
 */
export async function oauthLogin(io: Io, oauth: OAuthIo): Promise<number> {
  const settings = await loadOAuthSettings(io.env)
  const clientId = settings.clientId ?? (await askClientId(io, oauth))
  if (!clientId) return io.err("No client ID entered. Nothing was stored."), 1
  const savedSecret = await oauth.clientSecret.get()
  const clientSecret = savedSecret ?? (await io.readSecret("Wrike OAuth client secret: "))
  if (!clientSecret) return io.err("No client secret entered. Nothing was stored."), 1

  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")
  const answer = await waitForRedirect(io, oauth, settings, authorizeUrl(clientId, settings.redirectUri, state))
  if (answer === "cancelled") return io.err("Login cancelled. Nothing was stored."), 1
  if (answer === "timeout") return io.err("No answer from Wrike within ten minutes. Nothing was stored."), 1
  const denied = answer.get("error_description") || answer.get("error")
  if (denied) return io.err(`Wrike did not grant access: ${denied}. Nothing was stored.`), 1
  if (answer.get("state") !== state) return io.err("The answer did not carry this login's state, so it was ignored. Nothing was stored."), 1
  const code = answer.get("code")
  if (!code) return io.err("The answer from Wrike carried no code. Nothing was stored."), 1

  try {
    const app = { clientId, clientSecret }
    const tokens = await exchangeCode(app, code, settings.redirectUri, io.fetch)
    if (!tokens.ok) {
      // The saved secret may be the part Wrike refused, so the next login asks for it again.
      if (savedSecret) await oauth.clientSecret.delete()
      const again = savedSecret ? " The saved client secret was removed, so the next login asks for it." : ""
      return io.err(`Wrike refused the login: ${tokens.refused}. Nothing was stored.${again}`), 1
    }
    const env = tokens.host && !io.env.WRIKE_HOST ? { ...io.env, WRIKE_HOST: tokens.host } : io.env
    const profile = await probe(tokens.login.accessToken, env, io.fetch)
    await io.tokens.set(encodeLogin({ ...tokens.login, host: profile.host }))
    if (!savedSecret) await oauth.clientSecret.set(clientSecret)
    await writeProfile(io.env, profile)
    io.out(`Logged in as ${profile.name} on ${profile.host} with OAuth. The tokens and the client secret are in the OS keyring.`)
    return 0
  } catch (thrown) {
    io.err(`${describeError(toWrikeError(thrown))} Nothing was stored.`)
    return 1
  }
}

async function askClientId(io: Io, oauth: OAuthIo): Promise<string | null> {
  const clientId = await oauth.readLine("Wrike OAuth client ID: ")
  if (!clientId) return null
  await saveOAuthClientId(io.env, clientId).catch((thrown) => io.err(`The client ID was not saved to config.json: ${messageOf(thrown)}`))
  return clientId
}

type Redirect = URLSearchParams | "cancelled" | "timeout"

/** The query of the redirect, from the loopback server or from an address the user pasted, whichever comes first. */
async function waitForRedirect(io: Io, oauth: OAuthIo, settings: OAuthSettings, url: string): Promise<Redirect> {
  const answer = Promise.withResolvers<Redirect>()
  const callbackPath = new URL(settings.redirectUri).pathname
  let server: ReturnType<typeof Bun.serve> | null = null
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: settings.port,
      fetch(request) {
        const query = new URL(request.url)
        if (query.pathname !== callbackPath) return new Response("Not found", { status: 404 })
        answer.resolve(query.searchParams)
        return new Response(DONE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      },
    })
  } catch (thrown) {
    io.err(`Could not listen on 127.0.0.1:${settings.port} (${messageOf(thrown)}). Set oauth.port in config.json to a free port and register its redirect URI.`)
  }

  io.out("Opening Wrike in your browser to sign in. If it does not open, visit:")
  io.out(url)
  await oauth.openUrl(url).catch(() => {})

  const pasting = new AbortController()
  if (oauth.interactive) {
    void oauth.readLine("Or paste the address the browser landed on: ", pasting.signal).then((line) => {
      if (line === null) return answer.resolve("cancelled")
      answer.resolve(URL.canParse(line) ? new URL(line).searchParams : new URLSearchParams())
    })
  } else if (!server) {
    return "cancelled"
  }
  const timer = setTimeout(() => answer.resolve("timeout"), WAIT_MS)
  try {
    return await answer.promise
  } finally {
    clearTimeout(timer)
    pasting.abort()
    // Not awaited: the page is still on its way to the browser, and the process ends soon after.
    void server?.stop()
  }
}
