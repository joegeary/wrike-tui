import { fetchMe } from "../wrike/client"
import { toWrikeError, WrikeFailure, type WrikeError } from "../wrike/errors"
import { createTransport, type Fetch } from "../wrike/transport"
import { candidateBases, endpointsFor, type Endpoints, type Env } from "./config"
import { readProfile, type Profile } from "./profile"
import { resolveToken, type ResolvedToken, type TokenStore } from "./token"

export type Session = { token: ResolvedToken; profile: Profile; endpoints: Endpoints }

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
export async function loadSession(env: Env, store: TokenStore, fetch?: Fetch): Promise<Session | null> {
  const token = await resolveToken(env, store)
  if (!token) return null
  const stored = token.source === "keyring" ? await readProfile(env) : null
  const profile = stored ?? (await probe(token.token, env, fetch))
  return { token, profile, endpoints: endpointsFor(env, profile.host) }
}
