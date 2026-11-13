import { expect, test } from "bun:test"
import { runEffect, type EffectDeps } from "../../src/app/effects"
import type { Action } from "../../src/app/state"
import { attachmentId } from "../../src/domain/ids"
import { openInBrowser } from "../../src/ui/handoff"
import type { WrikeClient } from "../../src/wrike/client"

const SIGNED = "https://storage.example.test/attachments/A1/shot.png?signature=secret"

test("a browser that cannot start says so without the signed link", async () => {
  const actions: Action[] = []
  const deps = {
    client: { attachmentUrl: async () => SIGNED } as Partial<WrikeClient> as WrikeClient,
    openUrl: (url: string) => openInBrowser({ BROWSER: "/nonexistent/wrike-tui-browser" }, url),
  } as Partial<EffectDeps> as EffectDeps
  await runEffect({ kind: "open-attachment", id: attachmentId("A1"), name: "shot.png" }, deps, (action) => void actions.push(action))
  expect(actions).toEqual([{ type: "flash", flash: { tone: "error", text: expect.stringContaining("Could not open the browser") } }])
  expect(JSON.stringify(actions)).not.toContain("signature")
})
