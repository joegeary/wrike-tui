import { z } from "zod"
import type { Env } from "./config"

/** One keyring entry. The token entry holds a permanent token, or an OAuth login as JSON. */
export type TokenStore = {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  delete(): Promise<void>
}

/** `WRIKE_TUI_KEYRING_SERVICE` namespaces the keyring entries so tests never touch the real ones. */
function keyringEntry(env: Env, name: string): TokenStore {
  const entry = { service: env.WRIKE_TUI_KEYRING_SERVICE || "wrike-tui", name }
  return {
    get: () => Bun.secrets.get(entry),
    set: (value) => Bun.secrets.set({ ...entry, value }),
    delete: async () => void (await Bun.secrets.delete(entry)),
  }
}

export const keyringStore = (env: Env) => keyringEntry(env, "token")

/** The OAuth app's client secret, kept apart from the login so a new login can reuse it. */
export const clientSecretStore = (env: Env) => keyringEntry(env, "oauth-client-secret")

/** Which app a login signed in through: the one built into release builds, or one the user registered in Wrike's App Console. */
export type LoginApp = "shared" | "own"

/**
 * `expiresAt` is an ISO time. Wrike may hand out a new refresh token on every
 * refresh. `app` decides which credentials renew the login.
 */
export type OAuthLogin = { kind: "oauth"; app: LoginApp; accessToken: string; refreshToken: string; expiresAt: string; host: string }

const OAuthLoginSchema = z.object({
  kind: z.literal("oauth"),
  // 0.2.0 had only the user's own app and stored no `app`.
  app: z.enum(["shared", "own"]).default("own"),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string(),
  host: z.string(),
}) satisfies z.ZodType<OAuthLogin>

export const encodeLogin = (login: OAuthLogin) => JSON.stringify(login)

/** An OAuth login, or null when the entry is a plain permanent token. */
export function decodeLogin(stored: string): OAuthLogin | null {
  if (!stored.startsWith("{")) return null
  try {
    return OAuthLoginSchema.parse(JSON.parse(stored))
  } catch {
    return null
  }
}

export type ResolvedToken =
  | { kind: "permanent"; token: string; source: "env" | "keyring" }
  | { kind: "oauth"; token: string; source: "keyring"; login: OAuthLogin }

/** `WRIKE_TOKEN` wins over whatever the keyring holds. */
export async function resolveToken(env: Env, store: TokenStore): Promise<ResolvedToken | null> {
  if (env.WRIKE_TOKEN) return { kind: "permanent", token: env.WRIKE_TOKEN, source: "env" }
  const stored = await store.get()
  if (!stored) return null
  const login = decodeLogin(stored)
  return login ? { kind: "oauth", token: login.accessToken, source: "keyring", login } : { kind: "permanent", token: stored, source: "keyring" }
}
