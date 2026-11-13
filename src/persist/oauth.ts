import { z } from "zod"
import type { Env } from "../auth/config"
import { readObject, writeJson } from "./files"
import { configPath } from "./persistence"

export const DEFAULT_OAUTH_PORT = 8765

/**
 * The `oauth` part of `config.json`. The loopback server listens on `port`,
 * and `redirectUri` must be the redirect URI registered in Wrike's App Console.
 */
export type OAuthSettings = { clientId: string | null; port: number; redirectUri: string }

/** A bad value falls back to its default, so a typo here never moves the whole config aside. */
const OAuthSchema = z.object({
  clientId: z.string().trim().min(1).optional().catch(undefined),
  port: z.number().int().min(1).max(65535).optional().catch(undefined),
  redirectUri: z.url().optional().catch(undefined),
})

export async function loadOAuthSettings(env: Env): Promise<OAuthSettings> {
  const parsed = OAuthSchema.safeParse((await readObject(configPath(env)))?.oauth ?? {})
  const oauth = parsed.success ? parsed.data : {}
  const registered = oauth.redirectUri ? Number(new URL(oauth.redirectUri).port) || null : null
  const port = oauth.port ?? registered ?? DEFAULT_OAUTH_PORT
  return { clientId: oauth.clientId ?? null, port, redirectUri: oauth.redirectUri ?? `http://localhost:${port}/callback` }
}

/** Keeps every other key of the file. Throws when the file is not a JSON object, rather than replace it. */
export async function saveOAuthClientId(env: Env, clientId: string): Promise<void> {
  const path = configPath(env)
  const file = await readObject(path)
  if (file === null) throw new Error(`${path} is not a JSON object`)
  const oauth = typeof file.oauth === "object" && file.oauth !== null ? file.oauth : {}
  await writeJson(path, { ...file, oauth: { ...oauth, clientId } })
}
