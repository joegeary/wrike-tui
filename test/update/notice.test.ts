import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CHECK_EVERY_MS, newerRelease, updateCachePath } from "../../src/update/notice"
import { LATEST } from "../../src/update/release"
import type { Fetch } from "../../src/wrike/transport"

let root: string
let cachePath: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wrike-tui-notice-"))
  cachePath = join(root, "cache", "wrike-tui", "update-check.json")
})
afterEach(() => rm(root, { recursive: true, force: true }))

const NOON = new Date("2026-11-13T12:00:00Z")
const at = (ms: number) => () => new Date(NOON.getTime() + ms)

/** GitHub answering the latest release lookup, counting how often it was asked. */
function github(answer: () => Response | Promise<Response>) {
  const asked: string[] = []
  const fetch: Fetch = async (input, init) => {
    asked.push(String(input))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return answer()
  }
  return { fetch, asked }
}

const tagged = (tag: string) => () => Response.json({ tag_name: tag, assets: [] })

describe("newerRelease", () => {
  test("names a newer release, and leaves the answer in the cache", async () => {
    const { fetch, asked } = github(tagged("v0.3.0"))
    expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(0) })).toBe("0.3.0")
    expect(asked).toEqual([LATEST])
    expect(await Bun.file(cachePath).json()).toEqual({ version: 1, checkedAt: NOON.toISOString(), latest: "0.3.0" })
  })

  test("is null when the running version is the newest, or newer", async () => {
    expect(await newerRelease({ current: "0.3.0", cachePath, fetch: github(tagged("v0.3.0")).fetch, now: at(0) })).toBeNull()
    await rm(cachePath)
    expect(await newerRelease({ current: "0.4.0-rc.1", cachePath, fetch: github(tagged("v0.3.0")).fetch, now: at(0) })).toBeNull()
  })

  test("asks GitHub at most once a day, and answers from the cache in between", async () => {
    const { fetch, asked } = github(tagged("v0.3.0"))
    await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(0) })
    expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(CHECK_EVERY_MS - 1) })).toBe("0.3.0")
    expect(asked).toHaveLength(1)
    expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(CHECK_EVERY_MS) })).toBe("0.3.0")
    expect(asked).toHaveLength(2)
  })

  test("a cache written in the future is asked again, so a clock set back cannot silence it", async () => {
    const { fetch, asked } = github(tagged("v0.3.0"))
    await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(60_000) })
    await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(0) })
    expect(asked).toHaveLength(2)
  })

  test("a failed check is no news, never throws, and is not asked again that day", async () => {
    for (const failure of [
      () => Promise.reject(new Error("offline")),
      () => new Response("slow down", { status: 403 }),
      () => new Response("not json"),
      tagged("nightly"),
    ]) {
      await rm(cachePath, { force: true })
      const { fetch, asked } = github(failure)
      expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(0) })).toBeNull()
      expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(1000) })).toBeNull()
      expect(asked).toHaveLength(1)
      expect(await Bun.file(cachePath).json()).toEqual({ version: 1, checkedAt: NOON.toISOString(), latest: null })
    }
  })

  test("a cache that cannot be read is asked past and written again", async () => {
    await Bun.write(cachePath, "{ not json")
    const { fetch, asked } = github(tagged("v0.3.0"))
    expect(await newerRelease({ current: "0.2.0", cachePath, fetch, now: at(0) })).toBe("0.3.0")
    expect(asked).toHaveLength(1)
    expect((await Bun.file(cachePath).json()).latest).toBe("0.3.0")
  })

  test("a cache that cannot be written still gives the answer", async () => {
    await Bun.write(join(root, "file"), "")
    const { fetch } = github(tagged("v0.3.0"))
    expect(await newerRelease({ current: "0.2.0", cachePath: join(root, "file", "update-check.json"), fetch, now: at(0) })).toBe("0.3.0")
  })

  test("a local build never asks", async () => {
    const { fetch, asked } = github(tagged("v9.0.0"))
    expect(await newerRelease({ current: "0.2.0-dev", cachePath, fetch, now: at(0) })).toBeNull()
    expect(asked).toEqual([])
  })
})

test("the cache sits in the cache folder, beside the per account folders", () => {
  expect(updateCachePath({ XDG_CACHE_HOME: "/x/cache" })).toBe(join("/x/cache", "wrike-tui", "update-check.json"))
})
