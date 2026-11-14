import { createHash } from "node:crypto"
import { z } from "zod"
import { WrikeFailure } from "../wrike/errors"
import type { Fetch, TokenProvider } from "../wrike/transport"
import { decodeLogin, encodeLogin, type LoginApp, type OAuthLogin, type TokenStore } from "./token"

/** Wrike's OAuth 2.0 endpoints. Both the code exchange and the refresh post to the same token URL. */
const AUTHORIZE_URL = "https://login.wrike.com/oauth2/authorize/v4"
const TOKEN_URL = "https://login.wrike.com/oauth2/token"

/** An app registered in Wrike's App Console: the shared one built into release builds, or the user's own. */
export type OAuthApp = { clientId: string; clientSecret: string }

/** Renewing a minute early keeps a request from starting with a token that runs out on the way. */
const EARLY_MS = 60_000

/** `Default` covers the REST API. Wrike's MCP server, which serves the Inbox and field history, asks for `wsReadWrite`. */
const SCOPE = "Default,wsReadWrite"

const randomText = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

/** PKCE with S256: the authorize URL carries `challenge`, and only the holder of `verifier` can swap the code for tokens. */
export type Pkce = { verifier: string; challenge: string }

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")

export function newPkce(): Pkce {
  const verifier = randomText()
  return { verifier, challenge: s256(verifier) }
}

export const newState = randomText

export function authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  return `${AUTHORIZE_URL}?${params}`
}

/** Wrike shows `expires_in` as a string in its docs, so either form is read. */
const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  host: z.string().min(1).optional(),
})
const ErrorResponse = z.object({ error: z.string().optional(), error_description: z.string().optional() })

/** A refusal is Wrike saying no to the code, the refresh token or the app. Network and server failures throw. */
export type TokenAnswer = { ok: true; login: OAuthLogin; host: string | null } | { ok: false; refused: string }

async function tokenRequest(params: Record<string, string>, which: LoginApp, fetcher: Fetch, now: number, host: string): Promise<TokenAnswer> {
  let response: Response
  try {
    response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    })
  } catch (thrown) {
    throw new WrikeFailure({ kind: "network", message: thrown instanceof Error ? thrown.message : String(thrown) })
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status >= 500) throw new WrikeFailure({ kind: "server", status: response.status, message: response.statusText || "no details" })
  if (!response.ok) {
    const error = ErrorResponse.safeParse(body)
    const words = (error.success && (error.data.error_description || error.data.error)) || response.statusText || `status ${response.status}`
    return { ok: false, refused: words }
  }
  const tokens = TokenResponse.safeParse(body)
  if (!tokens.success) throw new WrikeFailure({ kind: "invalid", message: "Unexpected token response from Wrike" })
  const { access_token, refresh_token, expires_in } = tokens.data
  const expiresAt = new Date(now + expires_in * 1000).toISOString()
  const login: OAuthLogin = { kind: "oauth", app: which, accessToken: access_token, refreshToken: refresh_token, expiresAt, host: tokens.data.host ?? host }
  return { ok: true, login, host: tokens.data.host ?? null }
}

/** The code from the redirect, and what the authorize URL carried that Wrike checks it against. */
export type CodeGrant = { app: OAuthApp; which: LoginApp; code: string; redirectUri: string; verifier: string }

/** Swaps the code from the redirect for tokens. Wrike wants the client secret even with PKCE. */
export function exchangeCode(grant: CodeGrant, fetcher: Fetch = fetch, now = Date.now()): Promise<TokenAnswer> {
  const { app, which, code, redirectUri, verifier } = grant
  const params = {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }
  return tokenRequest(params, which, fetcher, now, "www.wrike.com")
}

function refreshLogin(app: OAuthApp, login: OAuthLogin, fetcher: Fetch, now: number): Promise<TokenAnswer> {
  const params = { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: login.refreshToken }
  return tokenRequest(params, login.app, fetcher, now, login.host)
}

export type OAuthProviderOptions = {
  login: OAuthLogin
  store: TokenStore
  /**
   * The client ID and secret of the app the login signed in through, read
   * only when a refresh needs them. Null when that app is not at hand.
   */
  app(which: LoginApp): Promise<OAuthApp | null>
  fetch?: Fetch
  now?: () => number
}

export type OAuthProvider = TokenProvider & { login(): OAuthLogin }

/**
 * Hands out the access token and renews it when it runs out or Wrike answers
 * 401. One refresh runs at a time and every caller waits for it. A refused
 * refresh ends the login: every later call fails with `expired` at once.
 */
export function oauthProvider(options: OAuthProviderOptions): OAuthProvider {
  const now = options.now ?? Date.now
  let login = options.login
  /** True once this process renewed `login`, so a 401 on it is a refusal and not a stale token. */
  let renewedHere = false
  let renewing: Promise<string> | null = null
  /** Set once the login can no longer renew. Every later call fails with it at once. */
  let ended: WrikeFailure | null = null

  const fresh = (candidate: OAuthLogin) => Date.parse(candidate.expiresAt) - EARLY_MS > now()

  /** Another wrike-tui may have refreshed already, and only its refresh token still works. */
  async function adoptStored(): Promise<void> {
    const stored = await options.store.get().catch(() => null)
    const found = stored ? decodeLogin(stored) : null
    if (found && found.refreshToken !== login.refreshToken) login = found
  }

  async function refresh(stale: string): Promise<string> {
    if (ended) throw ended
    await adoptStored()
    if (login.accessToken !== stale && fresh(login)) return login.accessToken
    const app = await options.app(login.app)
    const answer = app ? await refreshLogin(app, login, options.fetch ?? fetch, now()) : null
    if (!answer?.ok) {
      ended = new WrikeFailure({ kind: !app && login.app === "shared" ? "no_shared_app" : "expired" })
      throw ended
    }
    login = answer.login
    renewedHere = true
    // A keyring that will not take the new tokens still leaves them working for this run.
    await options.store.set(encodeLogin(login)).catch(() => {})
    return login.accessToken
  }

  function refreshOnce(stale: string): Promise<string> {
    renewing ??= refresh(stale).finally(() => {
      renewing = null
    })
    return renewing
  }

  return {
    login: () => login,
    current: async () => (fresh(login) && !renewing ? login.accessToken : refreshOnce(login.accessToken)),
    async renew(refused) {
      if (renewing) return renewing
      if (refused !== login.accessToken) return login.accessToken
      // A token this run just got is refused for another reason, and a second refresh would not change that.
      if (renewedHere && fresh(login)) return null
      return refreshOnce(refused)
    },
  }
}
