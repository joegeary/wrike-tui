import { z } from "zod"
import { WrikeFailure } from "../wrike/errors"
import type { Fetch, TokenProvider } from "../wrike/transport"
import { decodeLogin, encodeLogin, type OAuthLogin, type TokenStore } from "./token"

/** Wrike's OAuth 2.0 endpoints. Both the code exchange and the refresh post to the same token URL. */
const AUTHORIZE_URL = "https://login.wrike.com/oauth2/authorize/v4"
const TOKEN_URL = "https://login.wrike.com/oauth2/token"

/** The app registered in Wrike's App Console. */
export type OAuthApp = { clientId: string; clientSecret: string }

/** Renewing a minute early keeps a request from starting with a token that runs out on the way. */
const EARLY_MS = 60_000

/** `Default` covers the REST API. Wrike's MCP server, which serves the Inbox and field history, asks for `wsReadWrite`. */
const SCOPE = "Default,wsReadWrite"

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, state, scope: SCOPE })
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

async function tokenRequest(params: Record<string, string>, fetcher: Fetch, now: number, host: string): Promise<TokenAnswer> {
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
  const login: OAuthLogin = { kind: "oauth", accessToken: access_token, refreshToken: refresh_token, expiresAt, host: tokens.data.host ?? host }
  return { ok: true, login, host: tokens.data.host ?? null }
}

/** Swaps the code from the redirect for tokens. `redirectUri` must be the one the authorize URL carried. */
export function exchangeCode(app: OAuthApp, code: string, redirectUri: string, fetcher: Fetch = fetch, now = Date.now()): Promise<TokenAnswer> {
  const params = { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }
  return tokenRequest(params, fetcher, now, "www.wrike.com")
}

function refreshLogin(app: OAuthApp, login: OAuthLogin, fetcher: Fetch, now: number): Promise<TokenAnswer> {
  const params = { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: login.refreshToken }
  return tokenRequest(params, fetcher, now, login.host)
}

export type OAuthProviderOptions = {
  login: OAuthLogin
  store: TokenStore
  /** The client ID and secret, read only when a refresh needs them. Null when either is missing. */
  app(): Promise<OAuthApp | null>
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
  let ended = false

  const fresh = (candidate: OAuthLogin) => Date.parse(candidate.expiresAt) - EARLY_MS > now()
  const expired = () => new WrikeFailure({ kind: "expired" })

  /** Another wrike-tui may have refreshed already, and only its refresh token still works. */
  async function adoptStored(): Promise<void> {
    const stored = await options.store.get().catch(() => null)
    const found = stored ? decodeLogin(stored) : null
    if (found && found.refreshToken !== login.refreshToken) login = found
  }

  async function refresh(stale: string): Promise<string> {
    if (ended) throw expired()
    await adoptStored()
    if (login.accessToken !== stale && fresh(login)) return login.accessToken
    const app = await options.app()
    const answer = app ? await refreshLogin(app, login, options.fetch ?? fetch, now()) : null
    if (!answer?.ok) {
      ended = true
      throw expired()
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
