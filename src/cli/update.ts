import { chmod, mkdtemp, realpath, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { checksumFor, compareVersions, get, INSTALL_PS1_URL, latestRelease, messageOf, SUMS, tagVersion, UpdateFailure, type Release } from "../update/release"
import { VERSION } from "../version"
import type { Fetch } from "../wrike/transport"

/** Runs the downloaded install.ps1 with these variables added, and resolves to its exit code. */
export type RunInstaller = (script: string, env: Record<string, string>) => Promise<number>

export type UpdateIo = {
  out(line: string): void
  err(line: string): void
  fetch?: Fetch
  /** The running version, the platform and the binary's path. Tests pass their own. */
  version?: string
  platform?: NodeJS.Platform
  arch?: string
  execPath?: string
  runInstaller?: RunInstaller
}

export async function update(check: boolean, io: UpdateIo): Promise<number> {
  const current = io.version ?? VERSION
  if (current.endsWith("-dev")) return io.err("This is a local build. Rebuild it from the source instead."), 1
  const http = io.fetch ?? fetch
  const platform = io.platform ?? process.platform
  try {
    const release = await latestRelease(http)
    const latest = tagVersion(release.tag_name)
    if (compareVersions(latest, current) <= 0) return io.out(`wrike-tui ${current} is the newest release.`), 0
    if (check) {
      io.out(`wrike-tui ${latest} is out. This is ${current}. Run \`wrike-tui update\` to install it.`)
      return 0
    }
    const target = await realpath(io.execPath ?? process.execPath)
    if (platform === "win32") return await installOnWindows(http, release, target, io)
    const binary = await download(http, release, platform, io.arch ?? process.arch)
    await replace(target, binary, latest)
    io.out(`Updated wrike-tui ${current} to ${latest} at ${target}.`)
    return 0
  } catch (thrown) {
    io.err(thrown instanceof UpdateFailure ? thrown.message : `Update failed: ${messageOf(thrown)}. Nothing was changed.`)
    return 1
  }
}

/**
 * A running .exe cannot be overwritten, only renamed aside, and install.ps1
 * already does that. So Windows updates through the same script a first
 * install runs, pinned to the release found here and aimed at this binary's folder.
 */
async function installOnWindows(http: Fetch, release: Release, target: string, io: UpdateIo): Promise<number> {
  const script = await (await get(http, INSTALL_PS1_URL, "text/plain")).text()
  const folder = await mkdtemp(join(tmpdir(), "wrike-tui-update-"))
  try {
    // PowerShell refuses -File on a path that does not end in .ps1.
    const path = join(folder, "install.ps1")
    await Bun.write(path, script)
    const code = await (io.runInstaller ?? runPowerShell)(path, { INSTALL_DIR: dirname(target), VERSION: release.tag_name })
    if (code !== 0) throw new UpdateFailure(`install.ps1 stopped with exit code ${code}. Its message is above.`)
    return 0
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

const runPowerShell: RunInstaller = async (script, env) => {
  const child = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return child.exited
}

/** The new binary's bytes, from this platform's tarball, after its checksum matched SHA256SUMS. */
async function download(http: Fetch, release: Release, platform: NodeJS.Platform, arch: string): Promise<Blob> {
  const name = `wrike-tui-${platform}-${arch}.tar.gz`
  const asset = release.assets.find((a) => a.name === name)
  if (!asset) throw new UpdateFailure(`Release ${release.tag_name} has no build for ${platform}-${arch}.`)
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

function isErrno(thrown: unknown, code: string): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === code
}
