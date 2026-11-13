import { mkdir, rename } from "node:fs/promises"
import { dirname } from "node:path"
import type { z } from "zod"

/** What a file held, and the path it was moved to when it could not be read. */
export type Loaded<T> = { value: T; movedAside: string | null }

/**
 * Reads and parses one JSON file. A missing file is `fallback`. A file that is
 * not JSON, or not the shape this version reads, is renamed to `<name>.bad` so
 * the next write cannot destroy what the user had, and `fallback` loads.
 */
export async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<Loaded<T>> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { value: fallback, movedAside: null }
  const parsed = schema.safeParse(await file.json().catch(() => undefined))
  if (parsed.success) return { value: parsed.data, movedAside: null }
  const aside = `${path}.bad`
  await rename(path, aside)
  return { value: fallback, movedAside: aside }
}

/** The JSON object in a file, with every key kept. Empty when the file is missing, null when it holds something else. */
export async function readObject(path: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}
  const value: unknown = await file.json().catch(() => null)
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Writes through a temp file and a rename, so a crash never leaves half a file. */
export async function writeJson(path: string, value: unknown, layout: "readable" | "compact" = "readable"): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await Bun.write(temp, `${JSON.stringify(value, null, layout === "readable" ? 2 : undefined)}\n`)
  await rename(temp, path)
}
