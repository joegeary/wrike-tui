import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
let home: string | null = null
afterEach(async () => {
  await app.close()
  if (home) await rm(home, { recursive: true, force: true })
  home = null
})

const WIDE = { width: 200, height: 50 }

/** Opens "Clean up stale feature flags", the task with a field of every type, from the bottom of My to-do. */
async function openFlags() {
  await app.see("Enable SSO on sandbox")
  await app.press("t")
  await app.see("2 My to-do")
  await app.press("G", "enter")
  return app.see("Clean up stale feature flags", "Fields")
}

describe("the Fields section", () => {
  test("lists the task's fields by title, each value drawn the way its type reads", async () => {
    app = await openApp(WIDE)
    const frame = await openFlags()
    const rows = [
      /Budget {9,}1,250\.00 USD/,
      /Confidence {5,}40%/,
      /Customer Facing {2,}yes/,
      /Labels {5,}auth, infra/,
      /Notes {5,}Flags older than 90 days/,
      /Owner {5,}KUAAAA02/,
      /Region {5,}East/,
      /Review Date {2,}2026-11-20 {2}Nov 20/,
      /Score {5,}7\.5/,
      /Skill Lane {2,}Backend/,
      /Story Points {2,}5/,
      /Ticket Type {2,}Chore/,
      /Time Spent {2,}2h 30m/,
    ]
    for (const row of rows) expect(frame).toMatch(row)
    const lines = frame.split("\n")
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line))
    expect(at(/Permalink/)).toBeLessThan(at(/ Fields /))
    expect(rows.map(at)).toEqual(rows.map(at).toSorted((a, b) => a - b))
    expect(at(/Time Spent/)).toBeLessThan(at(/ Description /))
  })

  test("a task without fields draws no section", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    expect(await app.see("Comments (3)")).not.toMatch(/│ +Fields +│/)
  })

  test("a second launch draws the field titles from the cache while Wrike fails to send them", async () => {
    home = await mkdtemp(join(tmpdir(), "wrike-tui-fields-"))
    app = await openApp(WIDE, { home })
    await openFlags()
    await app.close()
    expect(await Bun.file(app.paths.fields).exists()).toBe(true)
    const { fake } = app
    fake.fail({ path: "/api/v4/customfields", status: 500, times: 5 })
    app = await openApp(WIDE, { home, fake })
    const frame = await app.see("Clean up stale feature flags", "Wrike failed with 500", /Ticket Type {2,}Chore/)
    expect(frame).toMatch(/Budget {9,}1,250\.00 USD/)
  })
})
