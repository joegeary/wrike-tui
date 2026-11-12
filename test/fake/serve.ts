#!/usr/bin/env bun
import { localDay } from "../../src/domain/dates"
import { createFakeWrike } from "./wrike"

/**
 * A fake Wrike on localhost for manual runs:
 *   bun test/fake/serve.ts 4010
 *   WRIKE_TOKEN=fake-token WRIKE_BASE_URL=http://127.0.0.1:4010/api/v4 WRIKE_MCP_URL=http://127.0.0.1:4010/mcp bun run dev
 */
const token = process.env.FAKE_WRIKE_TOKEN ?? "fake-token"
const now = new Date()
const fake = createFakeWrike({ token, today: localDay(now), now: now.toISOString() })
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[2] ?? 4010), fetch: fake.handle })

console.log(`Fake Wrike is listening. The token is "${token}".`)
console.log(`WRIKE_BASE_URL=http://127.0.0.1:${server.port}/api/v4`)
console.log(`WRIKE_MCP_URL=http://127.0.0.1:${server.port}/mcp`)
