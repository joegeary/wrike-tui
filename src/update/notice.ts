import { join } from "node:path"
import { z } from "zod"
import type { Env } from "../auth/config"
import { appDirs } from "../persist/dirs"
import { writeJson } from "../persist/files"
import type { Fetch } from "../wrike/transport"
import { compareVersions, isVersion, latestRelease, tagVersion } from "./release"

/** GitHub is asked at most once in this long, whatever it answered. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 5000

/** `latest` is null when the last check got no usable answer. */
const CacheSchema = z.object({ version: z.literal(1), checkedAt: z.iso.datetime(), latest: z.string().refine(isVersion).nullable() })
type Cache = z.infer<typeof CacheSchema>

export const updateCachePath = (env: Env) => join(appDirs(env).cache, "update-check.json")

export type NoticeOptions = { current: string; cachePath: string; fetch: Fetch; now?: () => Date }

/**
 * The version of the newest release when it is newer than `current`, or null.
 * Answers from the cache while the last check is under a day old. Never
 * throws: a failed check is the same as no news, and is not asked again for a
 * day. A local build never asks.
 */
export async function newerRelease(options: NoticeOptions): Promise<string | null> {
  if (options.current.endsWith("-dev")) return null
  try {
    const latest = await latestVersion(options)
    return latest !== null && compareVersions(latest, options.current) > 0 ? latest : null
  } catch {
    return null
  }
}

async function latestVersion({ cachePath, fetch, now = () => new Date() }: NoticeOptions): Promise<string | null> {
  const checkedAt = now()
  const cached = await readCache(cachePath)
  const age = cached ? checkedAt.getTime() - Date.parse(cached.checkedAt) : -1
  if (cached && age >= 0 && age < CHECK_EVERY_MS) return cached.latest

  let latest: string | null = null
  try {
    const version = tagVersion((await latestRelease(fetch, AbortSignal.timeout(TIMEOUT_MS))).tag_name)
    latest = isVersion(version) ? version : null
  } catch {
    // Offline, rate limited or a release in an odd shape: no news, and no new question for a day.
  }
  const record: Cache = { version: 1, checkedAt: checkedAt.toISOString(), latest }
  await writeJson(cachePath, record).catch(() => {})
  return latest
}

/** A cache that is missing or unreadable is the same as none. It is rewritten after the next check. */
async function readCache(path: string): Promise<Cache | null> {
  const value: unknown = await Bun.file(path)
    .json()
    .catch(() => null)
  const parsed = CacheSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
