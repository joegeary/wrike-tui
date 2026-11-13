import { beforeEach, describe, expect, test } from "bun:test"
import { attachmentId, commentId, customStatusId, folderId, legacyItemId, spaceId, taskId, userId } from "../../src/domain/ids"
import { describeChange } from "../../src/domain/history"
import { createWrikeClient, type WrikeClient } from "../../src/wrike/client"
import { WrikeFailure } from "../../src/wrike/errors"
import { createMcpClient } from "../../src/wrike/mcp"
import { createTransport } from "../../src/wrike/transport"
import { ME, PAT, RILEY, STATUS, TASK } from "../fake/data"
import { BIG_FOLDER, FOLDER, SPACE } from "../fake/workspace"
import { createFakeWrike, type FakeWrike } from "../fake/wrike"

let fake: FakeWrike
let client: WrikeClient

function clientFor(token: string): WrikeClient {
  return createWrikeClient(
    createTransport({ baseUrl: "http://fake.test/api/v4", token, fetch: fake.fetch, sleep: async () => {} }),
    createMcpClient({ url: "http://fake.test/mcp", token, fetch: fake.fetch }),
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

  test("a rate limit told in the tool's text is rate_limited, flagged as an error or not", async () => {
    fake.failTool({ tool: "get_my_inbox", text: "Rate limit exceeded. Try again in 60 seconds." })
    await expect(client.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "rate_limited" } })
    fake.failTool({ tool: "get_my_inbox", text: "Rate limit exceeded", isError: true })
    await expect(client.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "rate_limited" } })
    expect(await client.inbox({ includeRead: false })).toHaveLength(6)
  })

  test("an HTTP 429 from the MCP server is rate_limited", async () => {
    await client.inbox({ includeRead: false })
    fake.fail({ path: "/mcp", status: 429 })
    await expect(client.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "rate_limited" } })
  })

  test("any other failed tool is invalid with Wrike's words, and JSON that mentions a rate limit is still data", async () => {
    fake.failTool({ tool: "get_my_inbox", text: "Item not accessible", isError: true })
    await expect(client.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "invalid", message: "The Inbox tool failed: Item not accessible" } })
    fake.data.inbox[0]!.commentText = "We hit the rate limit again"
    expect((await client.inbox({ includeRead: false }))[0]!.commentText).toBe("We hit the rate limit again")
  })
})

describe("attachments", () => {
  test("a task's files come oldest first, a linked one without a size", async () => {
    const files = await client.attachments(taskId(TASK.login))
    expect(files.map((file) => [file.name, file.storage, file.contentType, file.size])).toEqual([
      ["callback-loop.png", "Wrike", "image/png", 182_734],
      ["har-capture.txt", "Wrike", "text/plain", 48_213],
      ["whiteboard.jpg", "Wrike", "image/jpeg", 2_310_442],
      ["Login flow notes", "Google", "application/vnd.google-apps.document", null],
    ])
    expect(files[0]).toMatchObject({ id: "IEAAAAAAIYAAAA01", authorId: PAT })
    expect(await client.attachments(taskId(TASK.sso))).toEqual([])
  })

  test("a link that is not an absolute https URL is an invalid response", async () => {
    const shot = fake.data.attachments.find((file) => file.id === "IEAAAAAAIYAAAA01")!
    for (const link of ["http://storage.example.test/a?signature=x", "/attachments/a?signature=x", "javascript:alert(1)", "file:///etc/passwd", "--help", ""]) {
      shot.link = link
      const refused = await client.attachmentUrl(attachmentId(shot.id)).then(() => null, (thrown: WrikeFailure) => thrown.error)
      expect(refused).toEqual({ kind: "invalid", message: "Unexpected attachment link from Wrike (0.url: not an absolute https URL)" })
    }
  })

  test("a file Wrike describes in a shape this version cannot read is left out, and the rest are listed", async () => {
    fake.data.attachments.push({ id: "IEAAAAAAIYAAAA09", authorId: PAT, createdDate: "2026-11-12T10:00:00Z", taskId: TASK.login } as never)
    expect((await client.attachments(taskId(TASK.login))).map((file) => file.name)).toEqual(["callback-loop.png", "har-capture.txt", "whiteboard.jpg", "Login flow notes"])
  })

  test("a preview is the PNG's bytes, and a link is Wrike's signed URL", async () => {
    const png = await client.attachmentPreview(attachmentId("IEAAAAAAIYAAAA01"))
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(await client.attachmentUrl(attachmentId("IEAAAAAAIYAAAA02"))).toBe("https://storage.example.test/attachments/IEAAAAAAIYAAAA02/har-capture.txt?signature=fake-2")
    await expect(client.attachmentPreview(attachmentId("IEAAAAAAIYNOPE01"))).rejects.toMatchObject({ error: { kind: "not_found" } })
  })
})

describe("history over MCP", () => {
  const loginItem = () => legacyItemId(fake.data.tasks.find((task) => task.id === TASK.login)!.permalink.split("=")[1]!)!
  const describeAll = (entries: { author: string | null; change: Parameters<typeof describeChange>[0] }[]) => entries.map((entry) => `${entry.author}: ${describeChange(entry.change)}`)

  test("a task's changes come newest first, each kind read, an unknown shape named by its type, an unasked type left out", async () => {
    const page = await client.history(loginItem(), { pageSize: 50 })
    expect(page.next).toBeNull()
    expect(describeAll(page.entries)).toEqual([
      "Pat Example: Work Type: DB",
      "Jordan Placeholder: Labels: auth, sso",
      "Riley Demo: attached Login flow notes",
      `Riley Demo: due ${fake.data.tasks.find((task) => task.id === TASK.login)!.dates.due!.slice(0, 10)}`,
      "Pat Example: status New → In Progress",
      "Pat Example: attached callback-loop.png",
      "Pat Example: assigned Pat Example",
      "Jordan Placeholder: unassigned Riley Demo",
      "Sam Sample: moved into Platform",
      "Sam Sample: moved out of Q4 Launch",
      "Sam Sample: start 2026-11-13",
      "Sam Sample: duration 1d → 2d",
      "Riley Demo: due cleared",
      "Pat Example: removed attachment old-capture.har",
      "Riley Demo: custom fields changed",
      "Pat Example: title Fix login loop → Fix login redirect loop",
    ])
    expect(page.entries[0]!.at).toBe("2026-11-12T15:40:00Z")
  })

  test("the call asks for one item by its permalink number, and pages with Wrike's token", async () => {
    const first = await client.history(loginItem(), { pageSize: 4 })
    expect(first.entries).toHaveLength(4)
    expect(first.next).not.toBeNull()
    const second = await client.history(loginItem(), { pageSize: 4, pageToken: first.next! })
    expect(describeAll(second.entries)[0]).toBe("Pat Example: status New → In Progress")
    const item = `w:itm:${loginItem()}`
    expect(fake.toolCalls.map((call) => call.arguments)).toMatchObject([
      { scope: { type: "ITEMS", itemIds: [item] }, pageSize: 4 },
      { scope: { type: "ITEMS", itemIds: [item] }, pageSize: 4, nextPageToken: first.next },
    ])
    expect(fake.toolCalls[0]!.arguments).not.toHaveProperty("nextPageToken")
  })

  test("an item Wrike cannot read is an error with Wrike's words, a rate limit is rate_limited", async () => {
    await expect(client.history(legacyItemId("1")!, { pageSize: 50 })).rejects.toMatchObject({
      error: { kind: "invalid", message: "Wrike did not give the history: Item not found or access denied" },
    })
    fake.failTool({ tool: "get_item_history", text: "Rate limit exceeded" })
    await expect(client.history(loginItem(), { pageSize: 50 })).rejects.toMatchObject({ error: { kind: "rate_limited" } })
  })

  test("a task with no change of the asked types is an empty page, as Wrike leaves the item out", async () => {
    const sso = legacyItemId(fake.data.tasks.find((task) => task.id === TASK.sso)!.permalink.split("=")[1]!)!
    expect(await client.history(sso, { pageSize: 50 })).toEqual({ entries: [], next: null })
    fake.failTool({ tool: "get_item_history", text: JSON.stringify({ taskChanges: [], truncated: false }) })
    expect(await client.history(loginItem(), { pageSize: 50 })).toEqual({ entries: [], next: null })
  })
})

test("a rate limited read retries and succeeds", async () => {
  fake.fail({ path: "/api/v4/workflows", status: 429, times: 2 })
  expect(await client.workflows()).toHaveLength(1)
  expect(fake.requests.filter((line) => line.startsWith("GET /api/v4/workflows"))).toHaveLength(3)
})
