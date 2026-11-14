import { authorizeUrl, exchangeCode, newPkce, newState, type OAuthApp } from "../auth/oauth"
import { writeProfile } from "../auth/profile"
import { probe, type Renewal } from "../auth/session"
import { SHARED_REDIRECT } from "../auth/shared-app"
import { encodeLogin, type TokenStore } from "../auth/token"
import { loadOAuthSettings, saveOAuthClientId } from "../persist/oauth"
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

/** The credentials that renew a login, taken from the app it signed in through and never from what config.json says now. */
export function renewalApp(io: Io): Renewal["app"] {
  return async (which) => (which === "shared" ? io.sharedApp : ownApp(io))
}

/** The user's own app: the client ID from config.json and the secret from the keyring, or null when either is missing. */
async function ownApp(io: Io): Promise<OAuthApp | null> {
  const [settings, clientSecret] = await Promise.all([loadOAuthSettings(io.env), io.oauth?.clientSecret.get() ?? null])
  return settings.clientId && clientSecret ? { clientId: settings.clientId, clientSecret } : null
}

type Target = { uri: string; port: number }

/** The app a new login signs in through and where Wrike sends the browser back to. */
type Chosen =
  | { which: "shared"; app: OAuthApp; redirect: Target }
  /** `secretSaved` is whether the secret came from the keyring rather than the prompt. */
  | { which: "own"; app: OAuthApp; redirect: Target; secretSaved: boolean }

/** `oauth.clientId` in config.json means the user's own app. Without it the shared app, when this build has one. */
async function chooseApp(io: Io, oauth: OAuthIo): Promise<Chosen | null> {
  const settings = await loadOAuthSettings(io.env)
  if (!settings.clientId && io.sharedApp) return { which: "shared", app: io.sharedApp, redirect: SHARED_REDIRECT }
  const clientId = settings.clientId ?? (await askClientId(io, oauth))
  if (!clientId) return io.err("No client ID entered. Nothing was stored."), null
  const savedSecret = await oauth.clientSecret.get()
  const clientSecret = savedSecret ?? (await io.readSecret("Wrike OAuth client secret: "))
  if (!clientSecret) return io.err("No client secret entered. Nothing was stored."), null
  const redirect = { uri: settings.redirectUri, port: settings.port }
  return { which: "own", app: { clientId, clientSecret }, redirect, secretSaved: savedSecret !== null }
}

/**
 * Signs in through the browser: the authorize URL opens, Wrike redirects to
 * the loopback server with a code, and the code becomes tokens. Where the
 * redirect cannot reach the loopback server, the user pastes the address the
 * browser landed on instead.
 */
export async function oauthLogin(io: Io, oauth: OAuthIo): Promise<number> {
  const chosen = await chooseApp(io, oauth)
  if (!chosen) return 1

  const state = newState()
  const pkce = newPkce()
  const answer = await waitForRedirect(io, oauth, chosen, authorizeUrl(chosen.app.clientId, chosen.redirect.uri, state, pkce.challenge))
  if (answer === "busy") return 1
  if (answer === "cancelled") return io.err("Login cancelled. Nothing was stored."), 1
  if (answer === "timeout") return io.err("No answer from Wrike within ten minutes. Nothing was stored."), 1
  const denied = answer.get("error_description") || answer.get("error")
  if (denied) return io.err(`Wrike did not grant access: ${denied}. Nothing was stored.`), 1
  if (answer.get("state") !== state) return io.err("The answer did not carry this login's state, so it was ignored. Nothing was stored."), 1
  const code = answer.get("code")
  if (!code) return io.err("The answer from Wrike carried no code. Nothing was stored."), 1

  try {
    const grant = { app: chosen.app, which: chosen.which, code, redirectUri: chosen.redirect.uri, verifier: pkce.verifier }
    const tokens = await exchangeCode(grant, io.fetch)
    if (!tokens.ok) {
      // The saved secret may be the part Wrike refused, so the next login asks for it again.
      const forget = chosen.which === "own" && chosen.secretSaved
      if (forget) await oauth.clientSecret.delete()
      const again = forget ? " The saved client secret was removed, so the next login asks for it." : ""
      return io.err(`Wrike refused the login: ${tokens.refused}. Nothing was stored.${again}`), 1
    }
    const env = tokens.host && !io.env.WRIKE_HOST ? { ...io.env, WRIKE_HOST: tokens.host } : io.env
    const profile = await probe(tokens.login.accessToken, env, io.fetch)
    await io.tokens.set(encodeLogin({ ...tokens.login, host: profile.host }))
    if (chosen.which === "own" && !chosen.secretSaved) await oauth.clientSecret.set(chosen.app.clientSecret)
    await writeProfile(io.env, profile)
    const kept = chosen.which === "shared" ? "The tokens are in the OS keyring." : "The tokens and the client secret are in the OS keyring."
    io.out(`Logged in as ${profile.name} on ${profile.host} with OAuth. ${kept}`)
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

/** `busy` means the shared app's port is taken and the reason is already printed. */
type Redirect = URLSearchParams | "cancelled" | "timeout" | "busy"

/** The query of the redirect, from the loopback server or from an address the user pasted, whichever comes first. */
async function waitForRedirect(io: Io, oauth: OAuthIo, chosen: Chosen, url: string): Promise<Redirect> {
  const answer = Promise.withResolvers<Redirect>()
  const { port } = chosen.redirect
  const callbackPath = new URL(chosen.redirect.uri).pathname
  let server: ReturnType<typeof Bun.serve> | null = null
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(request) {
        const query = new URL(request.url)
        if (query.pathname !== callbackPath) return new Response("Not found", { status: 404 })
        answer.resolve(query.searchParams)
        return new Response(DONE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      },
    })
  } catch (thrown) {
    const listen = `Could not listen on 127.0.0.1:${port} (${messageOf(thrown)}).`
    // Wrike sends the browser back to this one address, so another port cannot work.
    if (chosen.which === "shared") {
      io.err(`${listen} The browser sign-in needs that port. Close the program using it, often another \`wrike-tui auth login\` still waiting, and try again. Nothing was stored.`)
      return "busy"
    }
    io.err(`${listen} Set oauth.port in config.json to a free port and register its redirect URI.`)
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
