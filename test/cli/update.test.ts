import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { update, type RunInstaller, type UpdateIo } from "../../src/cli/update"
import { INSTALL_PS1_URL, LATEST } from "../../src/update/release"
import type { Fetch } from "../../src/wrike/transport"

const DOWNLOAD = "https://github.test/download/v0.3.0"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wrike-tui-update-"))
})
afterEach(() => rm(root, { recursive: true, force: true }))

/** Answers each URL from the table and remembers what was asked. Anything else is a 404. */
function server(routes: Record<string, () => Response>) {
  const asked: string[] = []
  const fetch: Fetch = async (input) => {
    const url = String(input)
    asked.push(url)
    return routes[url]?.() ?? new Response("missing", { status: 404 })
  }
  return { fetch, asked }
}

const release = (tag: string, names: string[]) => () =>
  Response.json({ tag_name: tag, assets: names.map((name) => ({ name, browser_download_url: `${DOWNLOAD}/${name}` })) })

function io(extra: Partial<UpdateIo>) {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (line: string) => void out.push(line), err: (line: string) => void err.push(line), version: "0.2.0", ...extra } }
}

/** A stand-in for the release binary: a script that answers --version the way a release does. */
const standIn = (version: string) => `#!/usr/bin/env zsh\nprint -r -- "wrike-tui ${version}"\n`

async function tarball(content: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Bun.Archive({ "wrike-tui": content }, { compress: "gzip" }).bytes())
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

test("a local build refuses to replace itself", async () => {
  const { err, io: given } = io({ version: "0.2.0-dev" })
  expect(await update(false, given)).toBe(1)
  expect(err).toEqual(["This is a local build. Rebuild it from the source instead."])
})

describe("--check", () => {
  test("says when a newer release is out, and changes nothing", async () => {
    const { fetch, asked } = server({ [LATEST]: release("v0.3.0", []) })
    const { out, io: given } = io({ fetch })
    expect(await update(true, given)).toBe(0)
    expect(out).toEqual(["wrike-tui 0.3.0 is out. This is 0.2.0. Run `wrike-tui update` to install it."])
    expect(asked).toEqual([LATEST])
  })

  test("says when this is the newest release", async () => {
    const { fetch } = server({ [LATEST]: release("v0.2.0", []) })
    const { out, io: given } = io({ fetch })
    expect(await update(true, given)).toBe(0)
    expect(out).toEqual(["wrike-tui 0.2.0 is the newest release."])
  })
})

describe("on Linux and macOS", () => {
  test("replaces the binary with the release's, after the checksum matched and the new one ran", async () => {
    const target = join(root, "wrike-tui")
    await Bun.write(target, standIn("0.2.0"))
    await chmod(target, 0o755)
    const archive = await tarball(standIn("0.3.0"))
    const name = "wrike-tui-linux-x64.tar.gz"
    const { fetch } = server({
      [LATEST]: release("v0.3.0", [name, "SHA256SUMS"]),
      [`${DOWNLOAD}/SHA256SUMS`]: () => new Response(`${sha256(archive)}  ${name}\n`),
      [`${DOWNLOAD}/${name}`]: () => new Response(archive),
    })
    const { out, err, io: given } = io({ fetch, platform: "linux", arch: "x64", execPath: target })
    expect(await update(false, given)).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([`Updated wrike-tui 0.2.0 to 0.3.0 at ${target}.`])
    expect(await Bun.file(target).text()).toBe(standIn("0.3.0"))
    expect(await readdir(root)).toEqual(["wrike-tui"])
  })

  test("a tarball that does not match SHA256SUMS changes nothing", async () => {
    const target = join(root, "wrike-tui")
    await Bun.write(target, standIn("0.2.0"))
    const archive = await tarball(standIn("0.3.0"))
    const name = "wrike-tui-linux-x64.tar.gz"
    const { fetch } = server({
      [LATEST]: release("v0.3.0", [name, "SHA256SUMS"]),
      [`${DOWNLOAD}/SHA256SUMS`]: () => new Response(`${"0".repeat(64)}  ${name}\n`),
      [`${DOWNLOAD}/${name}`]: () => new Response(archive),
    })
    const { err, io: given } = io({ fetch, platform: "linux", arch: "x64", execPath: target })
    expect(await update(false, given)).toBe(1)
    expect(err).toEqual([`${name} does not match its checksum in SHA256SUMS. Nothing was changed.`])
    expect(await Bun.file(target).text()).toBe(standIn("0.2.0"))
  })
})

describe("on Windows", () => {
  test("runs install.ps1 pinned to the new release and aimed at this binary's folder", async () => {
    const target = join(root, "wrike-tui.exe")
    await Bun.write(target, "old")
    const { fetch, asked } = server({ [LATEST]: release("v0.3.0", []), [INSTALL_PS1_URL]: () => new Response("Write-Host 'install'") })
    const ran: { script: string; text: string; env: Record<string, string> }[] = []
    const runInstaller: RunInstaller = async (script, env) => (ran.push({ script, text: await Bun.file(script).text(), env }), 0)
    const { err, io: given } = io({ fetch, platform: "win32", arch: "x64", execPath: target, runInstaller })
    expect(await update(false, given)).toBe(0)
    expect(err).toEqual([])
    expect(asked).toEqual([LATEST, INSTALL_PS1_URL])
    expect(ran).toHaveLength(1)
    expect(ran[0]!.script).toEndWith("install.ps1")
    expect(ran[0]!.text).toBe("Write-Host 'install'")
    expect(ran[0]!.env).toEqual({ INSTALL_DIR: root, VERSION: "v0.3.0" })
    expect(await Bun.file(ran[0]!.script).exists()).toBe(false)
  })

  test("an installer that fails is reported", async () => {
    const target = join(root, "wrike-tui.exe")
    await Bun.write(target, "old")
    const { fetch } = server({ [LATEST]: release("v0.3.0", []), [INSTALL_PS1_URL]: () => new Response("throw 'no'") })
    const { err, io: given } = io({ fetch, platform: "win32", execPath: target, runInstaller: async () => 1 })
    expect(await update(false, given)).toBe(1)
    expect(err).toEqual(["install.ps1 stopped with exit code 1. Its message is above."])
  })
})
