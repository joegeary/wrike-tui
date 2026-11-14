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

test("the update check reports a newer release, and stays quiet without one or without a check", async () => {
  for (const [newerRelease, expected] of [
    [async () => "0.3.0", [{ type: "update-available", version: "0.3.0" }]],
    [async () => null, []],
    [undefined, []],
  ] as const) {
    const actions: Action[] = []
    const deps = (newerRelease ? { newerRelease } : {}) as Partial<EffectDeps> as EffectDeps
    await runEffect({ kind: "check-update" }, deps, (action) => void actions.push(action))
    expect(actions).toEqual([...expected])
  }
})
