import { chmod, realpath, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import { isLocalBuild, VERSION } from "../version"
import type { Fetch } from "../wrike/transport"

const LATEST = "https://api.github.com/repos/joegeary/wrike-tui/releases/latest"
const SUMS = "SHA256SUMS"

export type UpdateIo = {
  out(line: string): void
  err(line: string): void
  fetch?: Fetch
}

const Release = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
})
type Release = z.infer<typeof Release>

class UpdateFailure extends Error {}

export async function update(check: boolean, io: UpdateIo): Promise<number> {
  if (isLocalBuild) return io.err("This is a local build. Rebuild it from the source instead."), 1
  const http = io.fetch ?? fetch
  try {
    const release = await latestRelease(http)
    const latest = release.tag_name.replace(/^v/, "")
    if (compareVersions(latest, VERSION) <= 0) return io.out(`wrike-tui ${VERSION} is the newest release.`), 0
    if (check) {
      io.out(`wrike-tui ${latest} is out. This is ${VERSION}. Run \`wrike-tui update\` to install it.`)
      return 0
    }
    const binary = await download(http, release)
    const target = await realpath(process.execPath)
    await replace(target, binary, latest)
    io.out(`Updated wrike-tui ${VERSION} to ${latest} at ${target}.`)
    return 0
  } catch (thrown) {
    io.err(thrown instanceof UpdateFailure ? thrown.message : `Update failed: ${messageOf(thrown)}. Nothing was changed.`)
    return 1
  }
}

async function latestRelease(http: Fetch): Promise<Release> {
  const response = await get(http, LATEST, "application/vnd.github+json")
  const parsed = Release.safeParse(await response.json())
  if (!parsed.success) throw new UpdateFailure("GitHub answered the release lookup in a shape this version cannot read.")
  return parsed.data
}

/** The new binary's bytes, from this platform's tarball, after its checksum matched SHA256SUMS. */
async function download(http: Fetch, release: Release): Promise<Blob> {
  const name = `wrike-tui-${process.platform}-${process.arch}.tar.gz`
  const asset = release.assets.find((a) => a.name === name)
  if (!asset) throw new UpdateFailure(`Release ${release.tag_name} has no build for ${process.platform}-${process.arch}.`)
  const sums = release.assets.find((a) => a.name === SUMS)
  if (!sums) throw new UpdateFailure(`Release ${release.tag_name} has no ${SUMS} file, so the download cannot be checked.`)

  const expected = checksumFor(await (await get(http, sums.browser_download_url)).text(), name)
  if (!expected) throw new UpdateFailure(`${SUMS} in release ${release.tag_name} does not list ${name}.`)
  const tarball = new Uint8Array(await (await get(http, asset.browser_download_url)).arrayBuffer())
  const actual = new Bun.CryptoHasher("sha256").update(tarball).digest("hex")
  if (actual !== expected) throw new UpdateFailure(`${name} does not match its checksum in ${SUMS}. Nothing was changed.`)

  const files = await new Bun.Archive(tarball).files()
  const binary = files.get("wrike-tui") ?? files.get("./wrike-tui")
  if (!binary) throw new UpdateFailure(`${name} holds no wrike-tui binary.`)
  return binary
}

/**
 * Writes the new binary beside the old one, proves it runs, and renames it over the old one, so the path holds
 * either the whole old binary or the whole new one. `target` is the real path, never a symlink to it.
 */
async function replace(target: string, binary: Blob, version: string): Promise<void> {
  const temp = join(dirname(target), `.wrike-tui-update-${process.pid}`)
  try {
    await Bun.write(temp, binary)
    await chmod(temp, 0o755)
    const smoke = Bun.spawnSync([temp, "--version"], { stdout: "pipe", stderr: "pipe" })
    const said = smoke.stdout.toString().trim()
    if (smoke.exitCode !== 0 || said !== `wrike-tui ${version}`) {
      throw new UpdateFailure(`The downloaded binary did not run (it said ${JSON.stringify(said)}). Nothing was changed.`)
    }
    await rename(temp, target)
  } catch (thrown) {
    await rm(temp, { force: true })
    if (isErrno(thrown, "EACCES") || isErrno(thrown, "EPERM")) {
      throw new UpdateFailure(`Cannot write to ${dirname(target)}. Run the update as a user who can. Nothing was changed.`)
    }
    throw thrown
  }
}

async function get(http: Fetch, url: string, accept = "application/octet-stream"): Promise<Response> {
  let response: Response
  try {
    response = await http(url, { headers: { Accept: accept, "User-Agent": `wrike-tui/${VERSION}` } })
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
function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line.trim())
    if (match && match[2] === name) return match[1] ?? null
  }
  return null
}

/** Compares `major.minor.patch` with an optional `-prerelease`, which sorts before the plain version. */
function compareVersions(a: string, b: string): number {
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

function isErrno(thrown: unknown, code: string): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === code
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown)
}
