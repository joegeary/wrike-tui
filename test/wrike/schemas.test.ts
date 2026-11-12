import { describe, expect, test } from "bun:test"
import { WrikeFailure } from "../../src/wrike/errors"
import { CommentSchema, contactFromWire, ContactSchema, InboxSchema, parseAll, TaskSchema, WorkflowSchema } from "../../src/wrike/schemas"
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
      permalink: "https://www.wrike.com/open.htm?id=4598459101",
      descriptionHtml: expect.stringContaining("<h2>Goal</h2>"),
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
  expect(contactFromWire(parsed[0]!)).toEqual({ id: "KUAAAA01" as never, name: "Sam Sample", email: "sam.sample@example.test" })
  expect(contactFromWire({ ...parsed[0]!, firstName: "", lastName: "" }).name).toBe("sam.sample@example.test")
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
