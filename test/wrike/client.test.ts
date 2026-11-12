import { beforeEach, describe, expect, test } from "bun:test"
import { customStatusId, legacyItemId, taskId, userId } from "../../src/domain/ids"
import { createWrikeClient, type WrikeClient } from "../../src/wrike/client"
import { WrikeFailure } from "../../src/wrike/errors"
import { createInboxSource } from "../../src/wrike/inbox"
import { createTransport } from "../../src/wrike/transport"
import { ME, PAT, RILEY, STATUS, TASK } from "../fake/data"
import { createFakeWrike, type FakeWrike } from "../fake/wrike"

let fake: FakeWrike
let client: WrikeClient

function clientFor(token: string): WrikeClient {
  return createWrikeClient(
    createTransport({ baseUrl: "http://fake.test/api/v4", token, fetch: fake.fetch, sleep: async () => {} }),
    createInboxSource({ url: "http://fake.test/mcp", token, fetch: fake.fetch }),
  )
}

beforeEach(() => {
  fake = createFakeWrike({ token: "good-token", today: "2026-11-12", now: "2026-11-12T16:00:00Z" })
  client = clientFor("good-token")
})

const lastQuery = () => new URL(`http://fake.test${fake.requests.at(-1)!.split(" ")[1]}`).searchParams

describe("reads", () => {
  test("me returns the token's user and account", async () => {
    expect(await client.me()).toEqual({ userId: userId(ME), name: "Sam Sample", accountId: "IEAAAAAA" })
  })

  test("contacts are active people only", async () => {
    const names = (await client.contacts()).map((contact) => contact.name)
    expect(names).toEqual(["Sam Sample", "Pat Example", "Riley Demo", "Jordan Placeholder"])
  })

  test("workflows come from the account, space workflows from every space", async () => {
    expect((await client.workflows()).map((workflow) => workflow.name)).toEqual(["Default Workflow"])
    expect((await client.spaceWorkflows()).map((workflow) => workflow.name)).toEqual(["Support Workflow"])
  })

  test("myTasks asks for my active tasks with the fields a list omits", async () => {
    const tasks = await client.myTasks(userId(ME))
    expect(tasks.map((task) => task.title)).toEqual([
      "Enable SSO on sandbox",
      "Rotate API keys for the staging cluster",
      "Draft the Q4 launch checklist",
      "Write onboarding guide for new support agents",
      expect.stringContaining("Archive last year's dashboards"),
      "Clean up stale feature flags",
    ])
    expect(tasks[0]!.assigneeIds).toEqual([userId(ME), userId(PAT)])
    expect(Object.fromEntries(lastQuery())).toEqual({
      responsibles: `["${ME}"]`,
      status: "Active",
      subTasks: "true",
      sortField: "DueDate",
      fields: '["responsibleIds","parentIds","description"]',
    })
  })

  test("searchTasks matches titles across the account", async () => {
    const tasks = await client.searchTasks("fix")
    expect(tasks.map((task) => task.title).sort()).toEqual(["Fix flaky export test", "Fix login redirect loop"])
    expect(lastQuery().get("pageSize")).toBe("100")
  })

  test("a permalink and a legacy id both resolve to the task", async () => {
    expect((await client.taskByPermalink("https://www.wrike.com/open.htm?id=4598459107"))?.id).toBe(taskId(TASK.login))
    expect(await client.taskByPermalink("https://www.wrike.com/open.htm?id=1")).toBeNull()
    expect(await client.taskIdFromLegacy(legacyItemId("4598459107")!)).toBe(taskId(TASK.login))
    expect(await client.taskIdFromLegacy(legacyItemId("1")!)).toBeNull()
  })

  test("comments come back oldest first", async () => {
    const comments = await client.comments(taskId(TASK.sso))
    expect(comments.map((comment) => comment.authorId)).toEqual([userId(RILEY), userId(ME), userId(PAT)])
  })

  test("comments posted in the same second keep the order they were written in", async () => {
    await client.addComment(taskId(TASK.flags), "first")
    await client.addComment(taskId(TASK.flags), "second")
    const [first, second] = fake.data.comments.filter((comment) => comment.taskId === TASK.flags).reverse()
    second!.createdDate = first!.createdDate
    expect((await client.comments(taskId(TASK.flags))).map((comment) => comment.text)).toEqual(["first", "second"])
  })

  test("folders returns the titles of a task's parents", async () => {
    const task = await client.task(taskId(TASK.sso))
    expect(await client.folders(task.parentIds)).toEqual(["Platform", "Q4 Launch"])
    expect(await client.folders([])).toEqual([])
  })

  test("a missing task is not_found", async () => {
    await expect(client.task(taskId("NOPE"))).rejects.toMatchObject({ error: { kind: "not_found" } })
  })
})

describe("writes", () => {
  test("updateTask sends one form-encoded PUT and returns the updated task", async () => {
    const updated = await client.updateTask(taskId(TASK.sso), { field: "status", statusId: customStatusId(STATUS.completed) })
    expect(updated).toMatchObject({ statusId: STATUS.completed, statusGroup: "Completed" })
    expect(fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.sso}`, params: { customStatus: STATUS.completed } }])
  })

  test("assignee and date patches use Wrike's JSON-string parameters", async () => {
    await client.updateTask(taskId(TASK.sso), { field: "assignees", add: [userId(RILEY)], remove: [userId(PAT)] })
    const updated = await client.updateTask(taskId(TASK.sso), { field: "dates", dates: { type: "Milestone", due: "2026-12-01" } })
    expect(fake.writes.map((write) => write.params)).toEqual([
      { addResponsibles: `["${RILEY}"]`, removeResponsibles: `["${PAT}"]` },
      { dates: '{"type":"Milestone","due":"2026-12-01"}' },
    ])
    expect(updated).toMatchObject({ assigneeIds: [ME, RILEY], dates: { type: "Milestone", due: "2026-12-01" } })
  })

  test("a rejected update surfaces Wrike's message", async () => {
    await expect(client.updateTask(taskId(TASK.sso), { field: "title", title: " " })).rejects.toMatchObject({
      error: { kind: "invalid", message: "Parameter 'title' value is invalid" },
    })
  })

  test("addComment posts plain text and returns the comment", async () => {
    const comment = await client.addComment(taskId(TASK.flags), "Removed 4 <flags>")
    expect(comment).toMatchObject({ authorId: ME, text: "Removed 4 &lt;flags&gt;" })
    expect(fake.writes).toEqual([{ method: "POST", path: `/tasks/${TASK.flags}/comments`, params: { text: "Removed 4 <flags>", plainText: "true" } }])
    expect(await client.comments(taskId(TASK.flags))).toHaveLength(1)
  })
})

describe("inbox over MCP", () => {
  test("unread notifications come first by default, read ones on request", async () => {
    const unread = await client.inbox({ includeRead: false })
    expect(unread).toHaveLength(6)
    expect(unread.every((entry) => entry.unread)).toBe(true)
    expect(unread[0]).toMatchObject({ kind: "Mention", item: { title: "Enable SSO on sandbox" }, author: { name: "Pat Example" } })
    expect(await client.inbox({ includeRead: true })).toHaveLength(8)
  })

  test("the connection is opened once and reused", async () => {
    await client.inbox({ includeRead: false })
    await client.inbox({ includeRead: false })
    const initializes = fake.requests.filter((line) => line === "POST /mcp").length
    // initialize, initialized notification, then one tools/call per read
    expect(initializes).toBe(4)
  })

  test("a rejected token is unauthorized, on REST and on MCP", async () => {
    const stranger = clientFor("wrong-token")
    await expect(stranger.me()).rejects.toMatchObject({ error: { kind: "unauthorized" } })
    await expect(stranger.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "unauthorized" } })
  })

  test("a server failure is reported and the next read reconnects", async () => {
    await client.inbox({ includeRead: false })
    fake.fail({ path: "/mcp", status: 500 })
    await expect(client.inbox({ includeRead: false })).rejects.toBeInstanceOf(WrikeFailure)
    expect(await client.inbox({ includeRead: false })).toHaveLength(6)
  })
})

test("a rate limited read retries and succeeds", async () => {
  fake.fail({ path: "/api/v4/workflows", status: 429, times: 2 })
  expect(await client.workflows()).toHaveLength(1)
  expect(fake.requests.filter((line) => line.startsWith("GET /api/v4/workflows"))).toHaveLength(3)
})
