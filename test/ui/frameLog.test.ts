import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFrameLog } from "../../src/ui/frameLog"

let directory: string
afterEach(() => rm(directory, { recursive: true, force: true }))

test("one line per key: the key and the time to the next frame, and frames without a key are not logged", async () => {
  directory = await mkdtemp(join(tmpdir(), "wrike-tui-frames-"))
  const path = join(directory, "frames.tsv")
  let clock = 100
  const log = createFrameLog(path, () => clock)
  log.frame()
  log.key("j")
  clock = 104.25
  log.frame()
  log.frame()
  log.key("k")
  clock = 110
  log.key("G")
  clock = 130.5
  log.frame()
  expect(await Bun.file(path).text()).toBe("j\t4.25\nk\t26.25\n")
})
