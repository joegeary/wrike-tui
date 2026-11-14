import { fetchMe } from "../wrike/client"
import { toWrikeError, WrikeFailure, type WrikeError } from "../wrike/errors"
import { createTransport, fixedToken, type Fetch, type TokenProvider } from "../wrike/transport"
import { candidateBases, endpointsFor, type Endpoints, type Env } from "./config"
import { oauthProvider, type OAuthApp } from "./oauth"
import { readProfile, type Profile } from "./profile"
import { resolveToken, type LoginApp, type ResolvedToken, type TokenStore } from "./token"

/** `auth` is what REST and MCP ask for the token, so an OAuth login renews itself under them. */
export type Session = { token: ResolvedToken; auth: TokenProvider; profile: Profile; endpoints: Endpoints }

/** What an OAuth login needs to renew itself: the keyring entry it lives in and the credentials of the app it signed in through. */
export type Renewal = { store: TokenStore; app(which: LoginApp): Promise<OAuthApp | null> }

export function tokenProvider(token: ResolvedToken, renewal: Renewal, fetch?: Fetch): TokenProvider {
  if (token.kind === "permanent") return fixedToken(token.token)
  return oauthProvider({ login: token.login, store: renewal.store, app: renewal.app, fetch })
}

/**
 * Finds the data center that accepts the token. A host that rejects the token
 * is skipped, and the last error is reported when none accepts it.
 */
export async function probe(token: string, env: Env, fetch?: Fetch): Promise<Profile> {
  let last: WrikeError = { kind: "unauthorized" }
  for (const baseUrl of candidateBases(env)) {
    try {
      const me = await fetchMe(createTransport({ baseUrl, token, fetch }))
      return { host: new URL(baseUrl).host, accountId: me.accountId, userId: me.userId, name: me.name }
    } catch (thrown) {
      last = toWrikeError(thrown)
    }
  }
  throw new WrikeFailure(last)
}

/**
 * Null means nobody is logged in. A token from the environment is probed on
 * every start, because the stored profile may belong to a different token.
 */
export async function loadSession(env: Env, store: TokenStore, fetch?: Fetch, app: Renewal["app"] = async () => null): Promise<Session | null> {
  const token = await resolveToken(env, store)
  if (!token) return null
  const auth = tokenProvider(token, { store, app }, fetch)
  const stored = token.source === "keyring" ? await readProfile(env) : null
  const profile = stored ?? (await probe(await auth.current(), oauthHost(env, token), fetch))
  return { token, auth, profile, endpoints: endpointsFor(env, profile.host) }
}

/** An OAuth login knows its data center, so the probe goes straight there. */
export function oauthHost(env: Env, token: ResolvedToken): Env {
  return token.kind === "oauth" && !env.WRIKE_HOST ? { ...env, WRIKE_HOST: token.login.host } : env
}
