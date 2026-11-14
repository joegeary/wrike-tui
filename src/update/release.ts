import { z } from "zod"
import { VERSION } from "../version"
import type { Fetch } from "../wrike/transport"

export const LATEST = "https://api.github.com/repos/joegeary/wrike-tui/releases/latest"
export const SUMS = "SHA256SUMS"

/** The Windows installer, which `wrike-tui update` runs on Windows. */
export const INSTALL_PS1_URL = "https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.ps1"

const Release = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
})
export type Release = z.infer<typeof Release>

/** A failure whose message is written for the user as it stands. */
export class UpdateFailure extends Error {}

export async function latestRelease(http: Fetch, signal?: AbortSignal): Promise<Release> {
  const response = await get(http, LATEST, "application/vnd.github+json", signal)
  const parsed = Release.safeParse(await response.json())
  if (!parsed.success) throw new UpdateFailure("GitHub answered the release lookup in a shape this version cannot read.")
  return parsed.data
}

/** The version a release tag names, without its `v`. */
export const tagVersion = (tag: string) => tag.replace(/^v/, "")

export async function get(http: Fetch, url: string, accept = "application/octet-stream", signal?: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await http(url, { headers: { Accept: accept, "User-Agent": `wrike-tui/${VERSION}` }, ...(signal ? { signal } : {}) })
  } catch (thrown) {
    throw new UpdateFailure(`Could not reach GitHub: ${messageOf(thrown)}`)
  }
  if (response.ok) return response
  if (response.status === 404 && url === LATEST) throw new UpdateFailure("No release of wrike-tui is published yet.")
  if (response.status === 403 || response.status === 429) {
    throw new UpdateFailure("GitHub is limiting requests from this address. Try again in an hour.")
  }
  throw new UpdateFailure(`GitHub answered ${response.status} for ${url}.`)
}

/** The hash `sha256sum` wrote for `name`, one `<hash>  <name>` line per file. */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line.trim())
    if (match && match[2] === name) return match[1] ?? null
  }
  return null
}

const VERSION_SHAPE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** Whether `version` is `major.minor.patch` with an optional `-prerelease`, the only shape compareVersions orders. */
export const isVersion = (version: string) => VERSION_SHAPE.test(version)

/** Compares `major.minor.patch` with an optional `-prerelease`, which sorts before the plain version. */
export function compareVersions(a: string, b: string): number {
  const [aCore = "", aPre] = splitPre(a)
  const [bCore = "", bPre] = splitPre(b)
  const aParts = aCore.split(".").map(Number)
  const bParts = bCore.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (aPre === bPre) return 0
  if (aPre === undefined) return 1
  if (bPre === undefined) return -1
  return aPre.localeCompare(bPre, "en", { numeric: true })
}

function splitPre(version: string): [string, string | undefined] {
  const dash = version.indexOf("-")
  return dash === -1 ? [version, undefined] : [version.slice(0, dash), version.slice(dash + 1)]
}

export function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown)
}
