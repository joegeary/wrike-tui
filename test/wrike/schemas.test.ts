import { describe, expect, test } from "bun:test"
import { WrikeFailure } from "../../src/wrike/errors"
import { describeChange } from "../../src/domain/history"
import { CommentSchema, contactFromWire, ContactSchema, CustomFieldSchema, HistorySchema, InboxSchema, parseAll, TaskSchema, WorkflowSchema } from "../../src/wrike/schemas"
import comments from "../fixtures/comments.json"
import contacts from "../fixtures/contacts.json"
import inbox from "../fixtures/inbox.json"
import tasks from "../fixtures/tasks.json"
import workflows from "../fixtures/workflows.json"

describe("task parser", () => {
  const parsed = parseAll(TaskSchema, tasks.data, "tasks")

  test("maps the wire task onto the domain task", () => {
    expect(parsed[0]).toEqual({
      id: "IEAAAAAAKQAAAA01" as never,
      title: "Enable SSO on sandbox",
      statusId: "IEAAAAAAJMAAAA02" as never,
      statusGroup: "Active",
      importance: "High",
      dates: { type: "Planned", start: "2026-11-07", due: "2026-11-11", duration: 2400 },
      assigneeIds: ["KUAAAA01", "KUAAAA02"] as never,
      parentIds: ["IEAAAAAAI4AAAA01", "IEAAAAAAI4AAAA02"],
      subTaskIds: [],
      superTaskIds: [],
      permalink: "https://www.wrike.com/open.htm?id=4598459101",
      descriptionHtml: expect.stringContaining("<h2>Goal</h2>"),
      fields: [],
      createdDate: "2026-10-13T12:00:00Z",
      updatedDate: "2026-11-11T12:00:00Z",
    })
  })

  test("each date type keeps only its own days", () => {
    expect(parsed.map((task) => task.dates.type)).toContain("Backlog")
    expect(parsed.find((task) => task.dates.type === "Milestone")!.dates).toEqual({ type: "Milestone", due: "2026-11-12" })
    expect(parsed.find((task) => task.dates.type === "Backlog")!.dates).toEqual({ type: "Backlog" })
  })

  test("optional list fields default when Wrike omits them", () => {
    const { responsibleIds, parentIds, description, ...bare } = tasks.data[0]!
    const [task] = parseAll(TaskSchema, [bare], "tasks")
    expect(task).toMatchObject({ assigneeIds: [], parentIds: [], descriptionHtml: "" })
  })

  test("field values are kept as strings, and an entry that is not one or is empty is left out", () => {
    const customFields = [
      { id: "F1", value: "7" },
      { id: "F2", value: 7 },
      { id: "F3", value: "" },
      { id: "F4", value: '["A","B"]' },
      "junk",
    ]
    const [task] = parseAll(TaskSchema, [{ ...tasks.data[0], customFields }], "tasks")
    expect(task!.fields).toEqual([
      { id: "F1" as never, value: "7" },
      { id: "F4" as never, value: '["A","B"]' },
    ])
  })

  test("a task with an unknown status group fails with a message that names the field", () => {
    const broken = [{ ...tasks.data[0], status: "Paused" }]
    expect(() => parseAll(TaskSchema, broken, "tasks")).toThrow(WrikeFailure)
    expect(() => parseAll(TaskSchema, broken, "tasks")).toThrow(/Unexpected tasks from Wrike \(0\.status/)
  })
})

test("comment parser keeps the HTML text", () => {
  const parsed = parseAll(CommentSchema, comments.data, "comments")
  expect(parsed).toHaveLength(3)
  expect(parsed[0]).toMatchObject({ authorId: "KUAAAA02", text: expect.stringContaining("@Sam Sample</a> can we run trainings") })
})

test("contact parser builds a display name and falls back to the email", () => {
  const parsed = parseAll(ContactSchema, contacts.data, "contacts")
  expect(contactFromWire(parsed[0]!)).toEqual({ id: "KUAAAA01" as never, name: "Sam Sample", email: "sam.sample@example.test", active: true })
  expect(contactFromWire({ ...parsed[0]!, firstName: "", lastName: "" }).name).toBe("sam.sample@example.test")
  expect(contactFromWire({ ...parsed[0]!, firstName: "Sam ", lastName: " Sample" }).name).toBe("Sam Sample")
})

test("a deactivated person keeps their name and is marked inactive", () => {
  const deactivated = parseAll(ContactSchema, contacts.data, "contacts").find((contact) => contact.deleted)!
  expect(contactFromWire(deactivated)).toMatchObject({ name: expect.stringContaining("Colleague"), active: false })
})

test("workflow parser maps custom statuses", () => {
  const [workflow] = parseAll(WorkflowSchema, workflows.data, "workflows")
  expect(workflow!.name).toBe("Default Workflow")
  expect(workflow!.statuses[1]).toEqual({ id: "IEAAAAAAJMAAAA02" as never, name: "In Progress", group: "Active", color: "Turquoise", hidden: false })
  expect(workflow!.statuses.filter((status) => status.hidden).map((status) => status.name)).toEqual(["Legacy Review"])
})

describe("inbox parser", () => {
  const entries = InboxSchema.parse(inbox).inbox

  test("maps a mention with its item, author and comment", () => {
    expect(entries[0]).toEqual({
      id: "w:obj_chng:1057210601",
      kind: "Mention",
      label: "Mention",
      unread: true,
      ts: "2026-11-12T15:25:00Z",
      item: {
        legacyId: "4598459101" as never,
        title: "Enable SSO on sandbox",
        baseType: "TASK",
        permalink: "https://www.wrike.com/open.htm?id=4598459101",
      },
      author: { name: "Pat Example" },
      commentText: "@Sam Sample can we run trainings in the sandbox?",
    })
  })

  test("EntitiesAssigned is an assignment and has no comment", () => {
    expect(entries[1]).toMatchObject({ kind: "Assign", label: "EntitiesAssigned", commentText: null })
  })

  test("an unknown type becomes Other and keeps its label", () => {
    expect(entries[4]).toMatchObject({ kind: "Other", label: "ApprovalRequested", item: null })
  })

  test("a type named like an Object property is Other too", () => {
    const parsed = InboxSchema.parse({ inbox: ["constructor", "toString", "__proto__"].map((notificationType, n) => ({ notificationId: `n${n}`, notificationType, ts: "2026-11-12T00:00:00Z" })) })
    expect(parsed.inbox.map((entry) => entry.kind)).toEqual(["Other", "Other", "Other"])
  })

  test("a project notification keeps its base type", () => {
    expect(entries[5]!.item).toMatchObject({ baseType: "PROJECT", title: "Q4 Launch" })
  })

  test("an item without an id cannot be opened", () => {
    const [entry] = InboxSchema.parse({
      inbox: [{ notificationId: "n1", notificationType: "Mention", ts: "2026-11-12T00:00:00Z", item: { title: "Weekly report", baseType: "REPORT" } }],
    }).inbox
    expect(entry).toMatchObject({ item: null, author: null, unread: false })
  })
})

describe("history parser", () => {
  const one = (change: Record<string, unknown>) => HistorySchema.parse({ taskChanges: [{ success: true, changes: [{ timestamp: "2026-11-12T18:24:31Z", type: "STATUS", action: "UPDATE", ...change }] }] }).taskChanges[0]!.changes[0]!

  test("a known type with a payload of another shape is still drawn, by its type and action", () => {
    const entry = one({ payload: { surprise: true }, author: { id: "w:usr:1", name: "Joe Geary" } })
    expect(entry).toEqual({ at: "2026-11-12T18:24:31Z", author: "Joe Geary", change: { kind: "other", type: "STATUS", action: "UPDATE" } })
    expect(describeChange(entry.change)).toBe("status changed")
  })

  test("a change without an author or a payload parses, and a time without a zone is UTC", () => {
    const entry = one({ timestamp: "2026-11-12T18:24:31", type: "RECURRENCE", action: "ENABLE" })
    expect(entry).toEqual({ at: "2026-11-12T18:24:31Z", author: null, change: { kind: "other", type: "RECURRENCE", action: "ENABLE" } })
    expect(describeChange(entry.change)).toBe("recurrence enable")
    expect(one({ timestamp: Date.UTC(2026, 10, 12, 18, 24, 31, 500), payload: {} }).at).toBe("2026-11-12T18:24:31Z")
    expect(one({ timestamp: "yesterday-ish", payload: {} }).at).toBeNull()
  })

  const drawn = (change: Record<string, unknown>) => describeChange(one(change).change)

  test("a field is cleared only when the payload names an old value and no new one", () => {
    expect(drawn({ type: "DUE_DATE", payload: { oldValue: "2026-11-09T17:00:00" } })).toBe("due cleared")
    expect(drawn({ type: "START_DATE", payload: { oldValue: "2026-11-09T09:00:00", newValue: null } })).toBe("start cleared")
    expect(drawn({ type: "DURATION", payload: { oldValue: { durationInMinutes: 480 } } })).toBe("duration cleared")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: { id: "w:cf:1", name: "Work Type" }, oldString: "DB" } })).toBe("Work Type cleared")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: { id: "w:cf:2", name: "Labels" }, oldValues: ["auth"], newValues: [] } })).toBe("Labels cleared")
  })

  test("a payload missing its values, or of a shape this version does not know, is drawn by its type and action", () => {
    const field = { id: "w:cf:1", name: "Owner" }
    expect(drawn({ type: "DUE_DATE", payload: {} })).toBe("due date changed")
    expect(drawn({ type: "START_DATE", payload: { surprise: true } })).toBe("start date changed")
    expect(drawn({ type: "DUE_DATE", payload: { newValue: 1794000000000 } })).toBe("due date changed")
    expect(drawn({ type: "DURATION", payload: { whatever: 1 } })).toBe("duration changed")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field } })).toBe("custom fields changed")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field, newUsers: [{ name: "Pat" }] } })).toBe("custom fields changed")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field, newNumber: 5 } })).toBe("custom fields changed")
    expect(drawn({ type: "ASSIGNEES", action: "REPLACE", payload: { removedUsers: [{ name: "Pat" }] } })).toBe("assignees replace")
    expect(drawn({ type: "TITLE", payload: { oldValue: "Old" } })).toBe("title changed")
  })

  test("Wrike's measured shapes read as a change from one value to another where it has both", () => {
    const field = (name: string) => ({ id: "w:cf:1", name })
    expect(drawn({ type: "DUE_DATE", payload: { newValue: "2026-11-14T17:00:00" } })).toBe("due 2026-11-14")
    expect(drawn({ type: "DUE_DATE", payload: { oldValue: "2026-11-12T17:00:00", newValue: "2026-11-14T17:00:00" } })).toBe("due 2026-11-12 → 2026-11-14")
    expect(drawn({ type: "DURATION", payload: { newValue: { durationInMinutes: 90 } } })).toBe("duration 90m")
    expect(drawn({ type: "DURATION", payload: { oldValue: { durationInMinutes: 480 }, newValue: { durationInMinutes: 960 } } })).toBe("duration 1d → 2d")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field("Work Type"), newString: "DB" } })).toBe("Work Type: DB")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field("Work Type"), oldString: "Frontend", newString: "DB" } })).toBe("Work Type: Frontend → DB")
    expect(drawn({ type: "CUSTOM_FIELDS", payload: { customField: field("Labels"), oldValues: ["auth"], newValues: ["auth", "sso"] } })).toBe("Labels: auth, sso")
    expect(drawn({ type: "ATTACHMENTS", action: "ADD", payload: { addedAttachments: [{ name: "a.png", id: "w:att:1", type: "WRIKE" }, { name: "b.txt" }] } })).toBe("attached a.png, b.txt")
    expect(drawn({ type: "ATTACHMENTS", action: "DELETE", payload: { removedAttachments: [{ name: "old.har" }] } })).toBe("removed attachment old.har")
    expect(drawn({ type: "TITLE", payload: { newValue: "New" } })).toBe("title New")
  })

  test("a type or action named like an Object property is drawn by its name", () => {
    for (const type of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(one({ type, payload: {} }).change).toEqual({ kind: "other", type, action: "UPDATE" })
    }
    expect(describeChange({ kind: "other", type: "STATUS", action: "constructor" })).toBe("status constructor")
    expect(describeChange({ kind: "other", type: "STATUS", action: "toString" })).toBe("status tostring")
  })
})

describe("custom field parser", () => {
  const parse = (wire: Record<string, unknown>) => CustomFieldSchema.parse({ id: "F1", title: "Field", archived: false, ...wire })

  test("choices come from the options, else the values", () => {
    const options = parse({ type: "DropDown", settings: { values: ["a"], options: [{ value: "x", color: "Red" }, { value: "y" }], allowOtherValues: true, readOnly: true } })
    expect(options).toMatchObject({ kind: { type: "DropDown", options: ["x", "y"], allowOther: true }, readOnly: true })
    expect(parse({ type: "Multiple", settings: { values: ["a", "b"] } }).kind).toEqual({ type: "Multiple", options: ["a", "b"], allowOther: false })
  })

  test("numbers keep their decimal places, or none when Wrike sets no precision", () => {
    expect(parse({ type: "Numeric", settings: { decimalPlaces: 2 } }).kind).toEqual({ type: "Numeric", decimals: 2 })
    expect(parse({ type: "Percentage", settings: {} }).kind).toEqual({ type: "Percentage", decimals: null })
    expect(parse({ type: "Currency", settings: { decimalPlaces: 0, currency: "EUR" } }).kind).toEqual({ type: "Currency", decimals: 0, currency: "EUR" })
    expect(parse({ type: "CalculatedNumeric" }).kind).toEqual({ type: "CalculatedNumeric", decimals: null })
  })

  test("a date says whether it takes a time, and a type this version does not know keeps its name", () => {
    expect(parse({ type: "Date", settings: { allowTime: true } }).kind).toEqual({ type: "Date", allowTime: true })
    expect(parse({ type: "LinkToDatabase", settings: { anything: 1 } })).toMatchObject({ kind: { type: "Unknown", wireType: "LinkToDatabase" }, readOnly: false })
  })
})
