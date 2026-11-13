import { expect, test } from "bun:test"
import { legacyItemId } from "../../src/domain/ids"
import { createMcpClient } from "../../src/wrike/mcp"
import type { Fetch } from "../../src/wrike/transport"
import { createFakeWrike } from "../fake/wrike"

test("a call that fails after its connection was replaced leaves the new one in use, and a dropped connection is closed", async () => {
  const fake = createFakeWrike({ token: "t", today: "2026-11-12", now: "2026-11-12T16:00:00Z" })
  let connections = 0
  let holding = false
  const arrived = Promise.withResolvers<AbortSignal | undefined>()
  const release = Promise.withResolvers<void>()
  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init)
    const body = request.method === "POST" ? await request.clone().json().catch(() => null) : null
    if (body?.method === "initialize") connections++
    if (holding && body?.params?.name === "get_item_history") {
      holding = false
      arrived.resolve(init?.signal ?? undefined)
      await release.promise
      return new Response("Injected failure", { status: 500 })
    }
    return fake.handle(request)
  }
  const mcp = createMcpClient({ url: "http://fake.test/mcp", token: "t", fetch })

  await mcp.inbox({ includeRead: false })
  holding = true
  const slow = mcp.history(legacyItemId("4598459107")!, { pageSize: 50 }).catch((thrown) => thrown)
  const signal = await arrived.promise
  fake.fail({ path: "/mcp", status: 500 })
  await expect(mcp.inbox({ includeRead: false })).rejects.toMatchObject({ error: { kind: "server", status: 500 } })
  expect(signal?.aborted).toBe(true)
  await mcp.inbox({ includeRead: false })
  release.resolve()
  expect(await slow).toMatchObject({ error: { kind: expect.any(String) } })
  await mcp.inbox({ includeRead: false })
  expect(connections).toBe(2)
  await mcp.close()
})
