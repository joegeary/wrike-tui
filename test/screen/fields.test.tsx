import { afterEach, expect, test } from "bun:test"
import { FIELD, TASK } from "../fake/data"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
afterEach(() => app.close())

const WIDE = { width: 200, height: 50 }

/** Opens "Clean up stale feature flags", the task with a field of every type, from the bottom of My to-do. */
async function openFlags() {
  await app.see("Enable SSO on sandbox")
  await app.press("t")
  await app.see("2 My to-do")
  await app.press("G", "enter")
  return app.see("Clean up stale feature flags", "Fields")
}

/** Opens "Rotate API keys for the staging cluster", a task with two fields, through search. */
async function openKeys() {
  await app.see("Enable SSO on sandbox")
  await app.press("/")
  await app.type("rotate")
  await app.press("enter")
  await app.see("Search: rotate", "Rotate API keys for the staging cluster")
  await app.press("enter")
  await app.see("Comments (0)")
}

async function setField(query: string) {
  await app.press(":")
  await app.type("set a field")
  await app.press("enter")
  await app.see("─ Set a field ─")
  await app.type(query)
  await app.press("enter")
}

const wrote = (task: string, id: string, value: unknown) => ({ method: "PUT", path: `/tasks/${task}`, params: { customFields: JSON.stringify([{ id, value }]) } })

test("the Fields section lists the task's fields by title, each value drawn the way its type reads", async () => {
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
  const lines = frame.split("\n")
  const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line))
  expect(rows.map(at).every((row) => row > at(/ Fields /))).toBe(true)
  expect(rows.map(at)).toEqual(rows.map(at).toSorted((a, b) => a - b))
})

test("e walks past the description into the fields, and a drop-down picks one of its choices", async () => {
  app = await openApp(WIDE)
  await openFlags()
  await app.press("e")
  for (let step = 0; step < 25 && !(await app.frame()).includes("▸ Ticket Type "); step++) await app.press("j")
  await app.press("enter")
  const picker = await app.see("─ Ticket Type ─")
  expect(picker).toMatch(/▸ Chore/)
  expect(picker).toContain("Clear the field")
  await app.press("up", "enter")
  expect(await app.see("Ticket Type set to Feature")).toMatch(/▸ Ticket Type {2,}Feature/)
  expect(app.fake.writes).toEqual([wrote(TASK.flags, FIELD.ticketType, "Feature")])
})

test("Set a field offers the list's fields first and types a new one in place", async () => {
  app = await openApp(WIDE)
  await openKeys()
  await app.press(":")
  await app.type("set a field")
  await app.press("enter")
  const picker = await app.see("─ Set a field ─")
  const row = (label: string) => picker.split("\n").findIndex((line) => new RegExp(`│ [▸ ] ${label} {2,}`).test(line))
  expect(row("Size")).toBeLessThan(row("Ticket Type"))
  expect(row("Ticket Type")).toBeLessThan(row("Budget"))
  for (const hidden of ["Legacy Code", "Region", "Score", "Owner"]) expect(row(hidden)).toBe(-1)
  await app.type("story")
  await app.press("enter")
  await app.see(/Story Points {2,}number/)
  await app.type("3")
  await app.press("enter")
  expect(await app.see("Story Points set to 3")).toMatch(/Story Points {2,}3/)
  expect(app.fake.writes).toEqual([wrote(TASK.keys, FIELD.storyPoints, "3")])
})

test("a write Wrike does not keep is reported, and the field is not drawn as set", async () => {
  app = await openApp(WIDE)
  await openKeys()
  await setField("budget")
  await app.type("100")
  await app.press("enter")
  const dropped = await app.see("Wrike did not keep Budget on this task. It may not apply here.")
  expect(dropped).not.toMatch(/Budget {2,}/)
  expect(dropped).toMatch(/Size {2,}S/)
  expect(app.fake.writes).toEqual([wrote(TASK.keys, FIELD.budget, "100")])
})
