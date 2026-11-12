import { mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { userId, type UserId } from "../domain/ids"
import type { Env } from "./config"

export type Profile = { host: string; accountId: string; userId: UserId; name: string }

const ProfileSchema = z.object({
  host: z.string(),
  accountId: z.string(),
  userId: z.string().transform(userId),
  name: z.string(),
})

export function profilePath(env: Env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "wrike-tui", "profile.json")
}

/** A missing or unreadable profile is the same as no profile: the caller probes again. */
export async function readProfile(env: Env): Promise<Profile | null> {
  const file = Bun.file(profilePath(env))
  if (!(await file.exists())) return null
  const parsed = ProfileSchema.safeParse(await file.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

export async function writeProfile(env: Env, profile: Profile): Promise<void> {
  const path = profilePath(env)
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(profile, null, 2)}\n`)
}

export async function deleteProfile(env: Env): Promise<void> {
  await rm(profilePath(env), { force: true })
}
