import { beforeEach, describe, expect, test } from "bun:test"
import { commentId, customStatusId, folderId, legacyItemId, spaceId, taskId, userId } from "../../src/domain/ids"
import { createWrikeClient, type WrikeClient } from "../../src/wrike/client"
import { WrikeFailure } from "../../src/wrike/errors"
import { createInboxSource } from "../../src/wrike/inbox"
import { createTransport } from "../../src/wrike/transport"
import { ME, PAT, RILEY, STATUS, TASK } from "../fake/data"
import { BIG_FOLDER, FOLDER, SPACE } from "../fake/workspace"
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

  test("contacts are people, and a deactivated one keeps a name for old tasks", async () => {
    const people = (await client.contacts()).map((contact) => [contact.name, contact.active])
    expect(people).toEqual([["Sam Sample", true], ["Pat Example", true], ["Riley Demo", true], ["Jordan Placeholder", true], ["Former Colleague", false]])
  })

  test("workflows come from the account, space workflows from every space", async () => {
    expect((await client.workflows()).map((workflow) => workflow.name)).toEqual(["Default Workflow"])
    expect((await client.spaceWorkflows()).map((workflow) => workflow.name)).toEqual(["Support Workflow"])
  })

  test("my tasks are my active tasks, with the fields a list omits", async () => {
    const { tasks, next } = await client.tasks({ kind: "mine", user: userId(ME) }, { completed: false })
    expect(tasks.map((task) => task.title)).toEqual([
      "Enable SSO on sandbox",
      "Rotate API keys for the staging cluster",
      "Draft the Q4 launch checklist",
      "Write onboarding guide for new support agents",
      expect.stringContaining("Archive last year's dashboards"),
      "Clean up stale feature flags",
    ])
    expect(next).toBeNull()
    expect(tasks[0]!.assigneeIds).toEqual([userId(ME), userId(PAT)])
    expect(tasks[3]!.subTaskIds).toEqual([taskId(TASK.macros)])
    expect(Object.fromEntries(lastQuery())).toEqual({
      responsibles: `["${ME}"]`,
      status: "Active",
      subTasks: "true",
      sortField: "DueDate",
      pageSize: "200",
      fields: '["responsibleIds","parentIds","description","subTaskIds","superTaskIds"]',
    })
  })

  test("a title search matches across the account and every status", async () => {
    const { tasks } = await client.tasks({ kind: "title", text: "fix" }, { completed: true })
    expect(tasks.map((task) => task.title).sort()).toEqual(["Fix flaky export test", "Fix login redirect loop"])
    expect(lastQuery().has("status")).toBe(false)
  })

  test("spaces leave out the archived one", async () => {
    expect(await client.spaces()).toEqual([
      { id: spaceId(SPACE.support), title: "Support", access: "Public" },
      { id: spaceId(SPACE.operations), title: "Operations", access: "Private" },
      { id: spaceId(SPACE.personal), title: "Sam's space", access: "Personal" },
      { id: spaceId(SPACE.engineering), title: "Engineering", access: "Public" },
    ])
  })

  test("a space tree is keyed by folder, rooted at the space, and marks projects", async () => {
    const tree = await client.spaceTree(spaceId(SPACE.engineering))
    expect(tree.get(folderId(SPACE.engineering))).toMatchObject({ kind: "space", childIds: [FOLDER.platform, FOLDER.launch, FOLDER.empty] })
    expect(tree.get(folderId(FOLDER.launch))).toMatchObject({ kind: "project", title: "Q4 Launch", project: { statusId: STATUS.inProgress, ownerIds: [PAT] } })
    expect(tree.get(folderId(FOLDER.platform))).toMatchObject({ kind: "folder", project: null })
    expect([...tree.keys()].sort()).toEqual([SPACE.engineering, FOLDER.platform, FOLDER.launch, FOLDER.runbooks, FOLDER.incidents, FOLDER.shared, FOLDER.empty].sort() as never)
  })

  test("the big space has the measured shape: about 3,500 folders, six deep, 18 under two parents", async () => {
    const tree = await client.spaceTree(spaceId(SPACE.operations))
    expect(tree.size).toBe(3548)
    const parents = new Map<string, number>()
    for (const node of tree.values()) for (const child of node.childIds) parents.set(child, (parents.get(child) ?? 0) + 1)
    expect([...parents.values()].filter((count) => count > 1)).toHaveLength(18)
    const depth = (id: string): number => 1 + Math.max(0, ...tree.get(folderId(id))!.childIds.map(depth))
    expect(depth(SPACE.operations) - 1).toBe(6)
  })

  test("a folder list takes its descendants and subtasks, active only by default", async () => {
    const { tasks } = await client.tasks({ kind: "folder", id: folderId(FOLDER.platform) }, { completed: false })
    expect(tasks.map((task) => task.title)).toEqual([
      "Enable SSO on sandbox",
      "Rotate API keys for the staging cluster",
      "Clean up stale feature flags",
      expect.stringContaining("Archive last year's dashboards"),
      "Fix login redirect loop",
      "Reproduce the redirect loop on staging",
      "Patch the callback handler",
      "List the macros agents use most",
    ])
    expect(tasks.find((task) => task.id === TASK.reproduce)!.superTaskIds).toEqual([taskId(TASK.login)])
    expect(Object.fromEntries(lastQuery())).toMatchObject({ descendants: "true", subTasks: "true", status: "Active", pageSize: "200" })
    const all = await client.tasks({ kind: "folder", id: folderId(FOLDER.platform) }, { completed: true })
    expect(all.tasks.map((task) => task.statusGroup)).toContain("Completed")
    expect(lastQuery().has("status")).toBe(false)
  })

  test("a space list asks for descendants, without which Wrike returns nothing", async () => {
    const { tasks } = await client.tasks({ kind: "space", id: spaceId(SPACE.support) }, { completed: false })
    expect(tasks.map((task) => task.title)).toEqual(["Write onboarding guide for new support agents", "List the macros agents use most"])
    expect(fake.requests.at(-1)).toContain(`/spaces/${SPACE.support}/tasks?descendants=true`)
    const bare = await fake.fetch(`http://fake.test/api/v4/spaces/${SPACE.support}/tasks`, { headers: { Authorization: "bearer good-token" } })
    expect(((await bare.json()) as { data: unknown[] }).data).toEqual([])
  })

  test("pages follow the token, resend the fields, and never overlap", async () => {
    const query = { kind: "folder", id: folderId(FOLDER.requests) } as const
    const seen = new Set<string>()
    let pages = 0
    for (let token: string | undefined, done = false; !done; pages++) {
      const page = await client.tasks(query, { completed: false, ...(token ? { pageToken: token } : {}) })
      if (pages > 0) expect(Object.fromEntries(lastQuery())).toEqual({ nextPageToken: token!, fields: '["responsibleIds","parentIds","description","subTaskIds","superTaskIds"]' })
      for (const task of page.tasks) {
        expect(seen.has(task.id)).toBe(false)
        seen.add(task.id)
      }
      // A page that lost its fields would have neither parents nor subtask links.
      expect(page.tasks.every((task) => task.parentIds.length > 0 || task.superTaskIds.length > 0)).toBe(true)
      token = page.next ?? undefined
      done = page.next === null
    }
    expect(pages).toBe(6)
    expect(seen.size).toBe(BIG_FOLDER.active)
  })

  test("a follow-up page without fields comes back without the optional fields, as Wrike does", async () => {
    const first = await fake.fetch(`http://fake.test/api/v4/folders/${FOLDER.requests}/tasks?pageSize=5&fields=["parentIds"]`, { headers: { Authorization: "bearer good-token" } })
    const { nextPageToken, data } = (await first.json()) as { nextPageToken: string; data: Record<string, unknown>[] }
    expect(data[0]).toHaveProperty("parentIds")
    const second = await fake.fetch(`http://fake.test/api/v4/folders/${FOLDER.requests}/tasks?nextPageToken=${nextPageToken}`, { headers: { Authorization: "bearer good-token" } })
    expect(((await second.json()) as { data: Record<string, unknown>[] }).data[0]).not.toHaveProperty("parentIds")
  })

  test("a folder Wrike does not know is not found", async () => {
    const missing = client.tasks({ kind: "folder", id: folderId("IEAAAAAAI4ZZZZZZ") }, { completed: false })
    expect(missing).rejects.toMatchObject({ error: { kind: "not_found" } })
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
    await client.addComment(taskId(TASK.flags), { text: "first", plainText: true })
    await client.addComment(taskId(TASK.flags), { text: "second", plainText: true })
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
    const comment = await client.addComment(taskId(TASK.flags), { text: "Removed 4 <flags>", plainText: true })
    expect(comment).toMatchObject({ authorId: ME, text: "Removed 4 &lt;flags&gt;" })
    expect(fake.writes).toEqual([{ method: "POST", path: `/tasks/${TASK.flags}/comments`, params: { text: "Removed 4 <flags>", plainText: "true" } }])
    expect(await client.comments(taskId(TASK.flags))).toHaveLength(1)
  })

  test("addComment posts HTML as it is, without plainText", async () => {
    const html = `<a class="stream-user-id avatar" rel="${PAT}">&#64;Pat Example</a> ready`
    expect(await client.addComment(taskId(TASK.flags), { text: html, plainText: false })).toMatchObject({ text: html })
    expect(fake.writes).toEqual([{ method: "POST", path: `/tasks/${TASK.flags}/comments`, params: { text: html } }])
  })

  test("updateComment sends a PUT to the comment and keeps its dates", async () => {
    const [original] = fake.data.comments.filter((comment) => comment.authorId === ME)
    const updated = await client.updateComment(commentId(original!.id), { text: "Pilot accounts are ready", plainText: true })
    expect(updated).toEqual({ id: commentId(original!.id), authorId: userId(ME), text: "Pilot accounts are ready", createdDate: original!.createdDate })
    expect(fake.writes).toEqual([{ method: "PUT", path: `/comments/${original!.id}`, params: { text: "Pilot accounts are ready", plainText: "true" } }])
    expect(original!.updatedDate).toBe(original!.createdDate)
  })

  test("deleteComment sends a DELETE, and a second one is not_found", async () => {
    const [original] = fake.data.comments.filter((comment) => comment.authorId === ME)
    await client.deleteComment(commentId(original!.id))
    expect(fake.writes).toEqual([{ method: "DELETE", path: `/comments/${original!.id}`, params: {} }])
    expect((await client.comments(taskId(TASK.sso))).map((comment) => comment.id)).not.toContain(original!.id)
    await expect(client.deleteComment(commentId(original!.id))).rejects.toMatchObject({ error: { kind: "not_found" } })
  })

  test("updating a comment that is gone is not_found", async () => {
    await expect(client.updateComment(commentId("IEAAAAAAIMNOPE01"), { text: "x", plainText: true })).rejects.toMatchObject({ error: { kind: "not_found" } })
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
