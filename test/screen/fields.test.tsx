import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FIELD, TASK } from "../fake/data"
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

/** Enters edit mode and walks down to the field with this title. */
async function walkTo(title: string): Promise<string> {
  await app.press("e")
  for (let step = 0; step < 25; step++) {
    const frame = await app.frame()
    if (frame.includes(`▸ ${title} `)) return frame
    await app.press("j")
  }
  throw new Error(`The walk never reached ${title}`)
}

const flags = () => app.fake.data.tasks.find((task) => task.id === TASK.flags)!
const stored = (id: string) => flags().customFields.find((field) => field.id === id)?.value
const wrote = (id: string, value: unknown) => ({ method: "PUT", path: `/tasks/${TASK.flags}`, params: { customFields: JSON.stringify([{ id, value }]) } })

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

describe("editing a field", () => {
  test("e walks past the description into the fields, and a drop-down picks one of its choices", async () => {
    app = await openApp(WIDE)
    await openFlags()
    const walked = await walkTo("Ticket Type")
    expect(walked).toMatch(/▸ Ticket Type {2,}Chore/)
    expect(walked).toMatch(/ {3}Time Spent {2,}2h 30m/)
    await app.press("enter")
    const picker = await app.see("─ Ticket Type ─")
    expect(picker).toMatch(/▸ Chore/)
    expect(picker).toContain("Clear the field")
    expect(picker).not.toContain("Other value")
    await app.press("up", "enter")
    const saved = await app.see("Ticket Type set to Feature")
    expect(saved).toMatch(/▸ Ticket Type {2,}Feature/)
    expect(app.fake.writes).toEqual([wrote(FIELD.ticketType, "Feature")])
    expect(stored(FIELD.ticketType)).toBe("Feature")
  })

  test("a drop-down that takes other values offers one, typed from the filter", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Skill Lane")
    await app.press("enter")
    await app.see("─ Skill Lane ─", "Other value...")
    await app.type("Mobile")
    const filtered = await app.see("Filter: Mobile")
    expect(filtered).toMatch(/▸ Other value\.\.\. +Mobile/)
    await app.press("enter")
    await app.see(/ Skill Lane {2,}Mobile/)
    await app.press("enter")
    await app.see("Skill Lane set to Mobile")
    expect(app.fake.writes).toEqual([wrote(FIELD.skillLane, "Mobile")])
  })

  test("Clear the field sends null, and the field leaves the section", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Ticket Type")
    await app.press("enter")
    await app.see("─ Ticket Type ─")
    await app.type("clear")
    await app.press("enter")
    const cleared = await app.see("Ticket Type cleared")
    expect(cleared).not.toMatch(/Ticket Type {2,}/)
    expect(app.fake.writes).toEqual([wrote(FIELD.ticketType, null)])
    expect(stored(FIELD.ticketType)).toBeUndefined()
  })

  test("a number is refused past its decimal places and saved as digits", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Story Points")
    await app.press("enter")
    await app.see("A whole number, empty clears the field")
    await app.press("ctrl+u")
    await app.type("2.5")
    await app.press("enter")
    await app.see("A whole number, or empty to clear")
    expect(app.fake.writes).toEqual([])
    await app.press("ctrl+u")
    await app.type("8")
    await app.press("enter")
    expect(await app.see("Story Points set to 8")).toMatch(/▸ Story Points {2,}8/)
    expect(app.fake.writes).toEqual([wrote(FIELD.storyPoints, "8")])
  })

  test("currency, percent, date and duration each read their own notation", async () => {
    app = await openApp(WIDE)
    await openFlags()
    const typeInto = async (title: string, text: string, done: string) => {
      await walkTo(title)
      await app.press("enter", "ctrl+u")
      await app.type(text)
      await app.press("enter")
      await app.see(done)
      await app.press("esc")
    }
    await typeInto("Budget", "99.5 usd", "Budget set to 99.50 USD")
    await typeInto("Confidence", "55%", "Confidence set to 55%")
    await walkTo("Review Date")
    await app.press("enter", "ctrl+u")
    await app.type("next week")
    await app.press("enter")
    await app.see("Use YYYY-MM-DD, or leave it empty to clear")
    await app.press("esc", "esc")
    await typeInto("Review Date", "2026-12-01", "Review Date set to 2026-12-01")
    await walkTo("Time Spent")
    await app.press("enter")
    expect(await app.see("Hours and minutes like 2h 30m")).toMatch(/ Time Spent {2,}2h 30m/)
    await app.press("ctrl+u")
    await app.type("1h 15m")
    await app.press("enter")
    expect(await app.see("Time Spent set to 1h 15m")).toMatch(/Time Spent {2,}1h 15m/)
    expect(app.fake.writes.map((write) => write.params.customFields)).toEqual([
      JSON.stringify([{ id: FIELD.budget, value: "99.5" }]),
      JSON.stringify([{ id: FIELD.confidence, value: "55" }]),
      JSON.stringify([{ id: FIELD.reviewDate, value: "2026-12-01" }]),
      JSON.stringify([{ id: FIELD.timeSpent, value: "75" }]),
    ])
  })

  test("a multi-select toggles choices with Space, and unchecking them all clears it", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Labels")
    await app.press("enter")
    const picker = await app.see("─ Labels ─", "With nothing chosen, Enter clears the field.")
    expect(picker).toMatch(/\[x\] auth/)
    expect(picker).toMatch(/\[ \] sso/)
    expect(picker).toMatch(/\[x\] infra/)
    await app.press("down", "space", "enter")
    expect(await app.see("Labels set to auth, infra, sso")).toMatch(/▸ Labels {2,}auth, infra, sso/)
    expect(stored(FIELD.labels)).toBe('["auth","infra","sso"]')
    await app.press("enter", "space", "down", "space", "down", "down", "space", "enter")
    await app.see("Labels cleared")
    expect(app.fake.writes.map((write) => write.params.customFields)).toEqual([
      JSON.stringify([{ id: FIELD.labels, value: ["auth", "infra", "sso"] }]),
      JSON.stringify([{ id: FIELD.labels, value: null }]),
    ])
  })

  test("a checkbox flips on Enter, and a text field is cleared by saving it empty", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Customer Facing")
    await app.press("enter")
    await app.see("Customer Facing cleared")
    await app.press("esc")
    await walkTo("Notes")
    await app.press("enter", "ctrl+u", "enter")
    await app.see("Notes cleared")
    expect(app.fake.writes).toEqual([wrote(FIELD.customerFacing, null), wrote(FIELD.notes, null)])
    await app.press("esc")
    const unset = (await app.frame()).split("\n")
    expect(unset.some((line) => / Customer Facing /.test(line) || / Notes /.test(line))).toBe(false)
  })

  test("on a short terminal the walk scrolls a field below the fold into view", async () => {
    app = await openApp({ width: 140, height: 24 })
    await openFlags()
    expect(await app.frame()).not.toContain("Time Spent")
    const walked = await walkTo("Time Spent")
    expect(walked).toMatch(/▸ Time Spent {2,}2h 30m/)
  })

  test("read-only, calculated and unknown fields say why they cannot be edited", async () => {
    app = await openApp(WIDE)
    await openFlags()
    await walkTo("Owner")
    await app.press("enter")
    await app.see("Owner is a Contacts field, which this version cannot edit")
    await app.press("j", "enter")
    await app.see("Region is read-only in Wrike")
    await app.press("j", "j", "enter")
    await app.see("Wrike calculates Score, so it cannot be edited")
    expect(app.fake.writes).toEqual([])
  })
})
