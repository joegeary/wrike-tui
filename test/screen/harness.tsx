import { testRender } from "@opentui/react/test-utils"
import type { EffectDeps } from "../../src/app/effects"
import { initialState } from "../../src/app/state"
import { createStore } from "../../src/app/store"
import { userId } from "../../src/domain/ids"
import { App } from "../../src/ui/App"
import { createBridge } from "../../src/ui/bridge"
import { createWrikeClient } from "../../src/wrike/client"
import { createInboxSource } from "../../src/wrike/inbox"
import { createTransport } from "../../src/wrike/transport"
import { ME } from "../fake/data"
import { createFakeWrike } from "../fake/wrike"

const TOKEN = "screen-test-token"
const CLOCK = { now: "2026-11-12T16:00:00Z", today: "2026-11-12" }

const ESC_PAUSE_MS = 120

export type Editor = (initial: string, extension: string) => string | null

/** The whole app in a test renderer, wired to the real client over an in-process fake Wrike. */
export async function openApp(size: { width: number; height: number } = { width: 160, height: 45 }) {
  const fake = createFakeWrike({ token: TOKEN, ...CLOCK })
  const inbox = createInboxSource({ url: "http://fake.test/mcp", token: TOKEN, fetch: fake.fetch })
  const client = createWrikeClient(
    createTransport({ baseUrl: "http://fake.test/api/v4", token: TOKEN, fetch: fake.fetch, sleep: async () => {} }),
    inbox,
  )
  const bridge = createBridge()
  const outside = { opened: [] as string[], copied: [] as string[], quit: false, editor: ((initial) => initial) as Editor, edited: [] as { initial: string; extension: string }[] }
  const deps: EffectDeps = {
    client,
    clock: () => CLOCK,
    editor: async (initial, extension) => {
      outside.edited.push({ initial, extension })
      const result = outside.editor(initial, extension)
      return result === initial ? null : result
    },
    openUrl: async (url) => void outside.opened.push(url),
    copy: (text) => (outside.copied.push(text), true),
    scrollDetails: (to) => bridge.scrollDetails(to),
    quit: () => void (outside.quit = true),
  }
  const profile = { host: "fake.test", accountId: "IEAAAAAA", userId: userId(ME), name: "Sam Sample" }
  const store = createStore(initialState(profile, CLOCK), deps)
  const screen = await testRender(<App store={store} bridge={bridge} />, size)
  // The app updates state from timers and promises, outside any act() scope.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

  async function frame(): Promise<string> {
    await store.idle()
    await screen.renderOnce()
    return screen.captureCharFrame()
  }

  /** Resolves with the first frame that satisfies every expectation. */
  async function see(...expected: (string | RegExp)[]): Promise<string> {
    let last = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      last = await frame()
      if (expected.every((want) => (typeof want === "string" ? last.includes(want) : want.test(last)))) return last
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`Never saw ${expected.map(String).join(" and ")} in:\n${last}`)
  }

  const KEYS: Record<string, () => void> = {
    enter: () => screen.mockInput.pressEnter(),
    esc: () => screen.mockInput.pressEscape(),
    backspace: () => screen.mockInput.pressBackspace(),
    up: () => screen.mockInput.pressArrow("up"),
    down: () => screen.mockInput.pressArrow("down"),
    left: () => screen.mockInput.pressArrow("left"),
    "ctrl+e": () => screen.mockInput.pressKey("e", { ctrl: true }),
    "ctrl+u": () => screen.mockInput.pressKey("u", { ctrl: true }),
  }

  /** Presses keys one frame apart, the way a person does. */
  async function press(...keys: string[]): Promise<void> {
    for (const key of keys) {
      const named = KEYS[key]
      if (named) named()
      else screen.mockInput.pressKey(key)
      // A lone Esc is only told apart from the start of an Alt chord after a pause.
      if (key === "esc") await new Promise((resolve) => setTimeout(resolve, ESC_PAUSE_MS))
      await frame()
    }
  }

  async function type(text: string): Promise<void> {
    await screen.mockInput.typeText(text)
    await frame()
  }

  return {
    fake,
    store,
    outside,
    frame,
    see,
    press,
    type,
    resize: (width: number, height: number) => screen.resize(width, height),
    async close() {
      await screen.dispose()
      await inbox.close()
    },
  }
}
