import { describe, expect, test } from "bun:test"
import { bucketOf } from "../../src/domain/buckets"
import { addDays, isDay, withDay } from "../../src/domain/dates"
import { customStatusId, legacyItemId, taskId, userId } from "../../src/domain/ids"
import { permalinkId, statusChoices, type Task, type TaskDates, type Workflow } from "../../src/domain/model"
import { assigneePatch, patchParams } from "../../src/domain/patch"
import { classifyQuery } from "../../src/domain/search"

function task(title: string, dates: TaskDates, importance: Task["importance"] = "Normal"): Task {
  return {
    id: taskId(`T-${title}`),
    title,
    statusId: customStatusId("S1"),
    statusGroup: "Active",
    importance,
    dates,
    assigneeIds: [],
    parentIds: [],
    subTaskIds: [],
    superTaskIds: [],
    permalink: "https://www.wrike.com/open.htm?id=1",
    descriptionHtml: "",
    createdDate: "2026-10-01T00:00:00Z",
    updatedDate: "2026-11-01T00:00:00Z",
  }
}

describe("ids", () => {
  test("a legacy id comes from a bare number or the MCP item form", () => {
    expect(legacyItemId("w:itm:4598459124")).toBe("4598459124" as never)
    expect(legacyItemId("4598459124")).toBe("4598459124" as never)
    expect(legacyItemId("IEAGIITRKQAB5JHX")).toBeNull()
    expect(legacyItemId("w:usr:12")).toBeNull()
  })
  test("the permalink id is the number people see in Wrike", () => {
    expect(permalinkId("https://www.wrike.com/open.htm?id=4598459124")).toBe("4598459124")
    expect(permalinkId("https://example.test/none")).toBeNull()
  })
})

describe("buckets", () => {
  // 2026-11-12 is a Thursday, so the week ends on Sunday 2026-11-15.
  const today = "2026-11-12"
  test("each due date lands in its bucket", () => {
    expect(bucketOf(task("a", { type: "Milestone", due: "2026-11-11" }), today)).toBe("Overdue")
    expect(bucketOf(task("a", { type: "Milestone", due: "2026-11-12" }), today)).toBe("Today")
    expect(bucketOf(task("a", { type: "Planned", start: "2026-11-01", due: "2026-11-15" }), today)).toBe("This week")
    expect(bucketOf(task("a", { type: "Milestone", due: "2026-11-16" }), today)).toBe("Later")
    expect(bucketOf(task("a", { type: "Backlog" }), today)).toBe("No date")
  })
  test("on a Sunday nothing later than today is this week", () => {
    expect(bucketOf(task("a", { type: "Milestone", due: "2026-11-16" }), "2026-11-15")).toBe("Later")
  })
})

describe("dates", () => {
  test("isDay rejects impossible days", () => {
    expect(isDay("2026-02-28")).toBe(true)
    expect(isDay("2026-02-30")).toBe(false)
    expect(isDay("11/20/2026")).toBe(false)
  })
  test("addDays crosses a month", () => {
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02")
  })
  test("a due date on a backlog task makes a milestone", () => {
    expect(withDay({ type: "Backlog" }, "due", "2026-11-20")).toEqual({ ok: true, dates: { type: "Milestone", due: "2026-11-20" } })
  })
  test("a start date on a milestone makes it planned", () => {
    expect(withDay({ type: "Milestone", due: "2026-11-20" }, "start", "2026-11-10")).toEqual({
      ok: true,
      dates: { type: "Planned", start: "2026-11-10", due: "2026-11-20" },
    })
  })
  test("clearing the start keeps the due date, clearing the due date clears both", () => {
    const planned: TaskDates = { type: "Planned", start: "2026-11-10", due: "2026-11-20" }
    expect(withDay(planned, "start", "")).toEqual({ ok: true, dates: { type: "Milestone", due: "2026-11-20" } })
    expect(withDay(planned, "due", " ")).toEqual({ ok: true, dates: { type: "Backlog" } })
  })
  test("bad input explains itself", () => {
    expect(withDay({ type: "Backlog" }, "due", "tomorrow")).toMatchObject({ ok: false })
    expect(withDay({ type: "Backlog" }, "start", "2026-11-10")).toEqual({ ok: false, message: "Set a due date before a start date" })
    expect(withDay({ type: "Milestone", due: "2026-11-20" }, "start", "2026-11-21")).toEqual({
      ok: false,
      message: "The start date is after the due date",
    })
  })
})

describe("patch encoding", () => {
  test("each field maps to its Wrike parameter", () => {
    expect(patchParams({ field: "title", title: "New" })).toEqual({ title: "New" })
    expect(patchParams({ field: "status", statusId: customStatusId("S2") })).toEqual({ customStatus: "S2" })
    expect(patchParams({ field: "importance", importance: "High" })).toEqual({ importance: "High" })
    expect(patchParams({ field: "description", html: "<b>x</b>" })).toEqual({ description: "<b>x</b>" })
    expect(patchParams({ field: "dates", dates: { type: "Planned", start: "2026-11-10", due: "2026-11-20", duration: 4800 } })).toEqual({
      dates: { type: "Planned", start: "2026-11-10", due: "2026-11-20" },
    })
    expect(patchParams({ field: "dates", dates: { type: "Backlog" } })).toEqual({ dates: { type: "Backlog" } })
  })
  test("assignees send only the sides that changed", () => {
    const [a, b, c] = [userId("A"), userId("B"), userId("C")]
    expect(patchParams(assigneePatch([a, b], [b, c]))).toEqual({ addResponsibles: ["C"], removeResponsibles: ["A"] })
    expect(patchParams(assigneePatch([a], [a, b]))).toEqual({ addResponsibles: ["B"] })
    expect(patchParams(assigneePatch([a], [a]))).toEqual({})
  })
})

describe("status choices", () => {
  const status = (id: string, hidden = false) => ({ id: customStatusId(id), name: id, group: "Active" as const, color: "Blue", hidden })
  const workflows: Workflow[] = [
    { id: "W1", name: "Default", statuses: [status("A"), status("B"), status("H", true)] },
    { id: "W2", name: "Other", statuses: [status("X")] },
  ]
  test("offers the visible statuses of the task's own workflow", () => {
    expect(statusChoices(workflows, customStatusId("A")).map((s) => s.id as string)).toEqual(["A", "B"])
    expect(statusChoices(workflows, customStatusId("X")).map((s) => s.id as string)).toEqual(["X"])
  })
  test("keeps a hidden status the task is already in", () => {
    expect(statusChoices(workflows, customStatusId("H")).map((s) => s.id as string)).toEqual(["A", "B", "H"])
  })
  test("is empty when no known workflow owns the status", () => {
    expect(statusChoices(workflows, customStatusId("?"))).toEqual([])
  })
})

describe("search query", () => {
  test("a permalink, a number and a title are told apart", () => {
    expect(classifyQuery(" https://www.wrike.com/open.htm?id=4598459124 ")).toEqual({
      kind: "permalink",
      url: "https://www.wrike.com/open.htm?id=4598459124",
    })
    expect(classifyQuery("4598459124")).toEqual({ kind: "legacy-id", id: "4598459124" as never })
    expect(classifyQuery("sso sandbox")).toEqual({ kind: "title", text: "sso sandbox" })
    expect(classifyQuery("2026 budget")).toEqual({ kind: "title", text: "2026 budget" })
  })
})
