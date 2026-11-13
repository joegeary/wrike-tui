import { testRender } from "@opentui/react/test-utils"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EffectDeps } from "../../src/app/effects"
import { initialState } from "../../src/app/state"
import { createStore } from "../../src/app/store"
import { keepClock } from "../../src/app/ticker"
import { userId } from "../../src/domain/ids"
import { App } from "../../src/ui/App"
import { createBridge } from "../../src/ui/bridge"
import { loadBoot, sessionSaver } from "../../src/app/session"
import { createPersistence, persistencePaths } from "../../src/persist/persistence"
import { createWrikeClient } from "../../src/wrike/client"
import { createMcpClient } from "../../src/wrike/mcp"
import { createTransport } from "../../src/wrike/transport"
import { ME } from "../fake/data"
import { createFakeWrike } from "../fake/wrike"

const TOKEN = "screen-test-token"
const CLOCK = { now: "2026-11-12T16:00:00Z", today: "2026-11-12" }

const ESC_PAUSE_MS = 120
const CLOCK_TICK_MS = 20

export type Editor = (initial: string, extension: string) => string | null

export type AppOptions = {
  /** A directory to keep config, session, favorites and cache in. A second app opened on it starts where the first left off. */
  home?: string
  /** A fake Wrike to reuse, so a second app sees what the first one changed. */
  fake?: ReturnType<typeof createFakeWrike>
  readOnly?: boolean
  /** False starts the way `WRIKE_TUI_NO_RESTORE=1` does. */
  restore?: boolean
}

/** The whole app in a test renderer, wired to the real client over an in-process fake Wrike. */
export async function openApp(size: { width: number; height: number } = { width: 160, height: 45 }, options: AppOptions = {}) {
  // The app's clock and the fake's stamps on new comments move together, and only when a test moves them.
  let clock = { ...CLOCK }
  const fake = options.fake ?? createFakeWrike({ token: TOKEN, ...CLOCK, stamp: () => clock.now })
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "wrike-tui-screen-")))
  const paths = persistencePaths({ XDG_CONFIG_HOME: join(home, "config"), XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache") }, "IEAAAAAA")
  const persistence = createPersistence(paths)
  const mcp = createMcpClient({ url: "http://fake.test/mcp", token: TOKEN, fetch: fake.fetch })
  const client = createWrikeClient(
    createTransport({ baseUrl: "http://fake.test/api/v4", token: TOKEN, fetch: fake.fetch, sleep: async () => {}, readOnly: options.readOnly ?? false }),
    mcp,
  )
  const bridge = createBridge()
  const outside = { opened: [] as string[], copied: [] as string[], quit: false, editor: ((initial) => initial) as Editor, edited: [] as { initial: string; extension: string }[] }
  const deps: EffectDeps = {
    client,
    clock: () => clock,
    editor: async (initial, extension) => {
      outside.edited.push({ initial, extension })
      const result = outside.editor(initial, extension)
      return result === initial ? null : result
    },
    openUrl: async (url) => void outside.opened.push(url),
    copy: (text) => (outside.copied.push(text), true),
    scroll: (pane, to) => bridge.scrollers[pane]?.(to),
    persistence,
    quit: () => void (outside.quit = true),
  }
  const profile = { host: "fake.test", accountId: "IEAAAAAA", userId: userId(ME), name: "Sam Sample" }
  const boot = await loadBoot(persistence, { readOnly: options.readOnly ?? false, restore: options.restore ?? true })
  const store = createStore(initialState(profile, CLOCK, boot), deps)
  const saveSession = sessionSaver(store.getState, persistence)
  const screen = await testRender(<App store={store} bridge={bridge} />, size)
  const stopClock = keepClock(store, () => clock, CLOCK_TICK_MS)
  // The app updates state from timers and promises, outside any act() scope.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

  async function frame(): Promise<string> {
    await store.idle()
    await screen.renderOnce()
    return screen.captureCharFrame()
  }

  /** The frame as drawn now, without waiting for the effects still running, for a check while a request is held. */
  async function peek(): Promise<string> {
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
    "alt+enter": () => screen.mockInput.pressEnter({ meta: true }),
    esc: () => screen.mockInput.pressEscape(),
    backspace: () => screen.mockInput.pressBackspace(),
    up: () => screen.mockInput.pressArrow("up"),
    down: () => screen.mockInput.pressArrow("down"),
    left: () => screen.mockInput.pressArrow("left"),
    right: () => screen.mockInput.pressArrow("right"),
    space: () => screen.mockInput.pressKey(" "),
    tab: () => screen.mockInput.pressTab(),
    "ctrl+e": () => screen.mockInput.pressKey("e", { ctrl: true }),
    "ctrl+j": () => screen.mockInput.pressKey("j", { ctrl: true }),
    "ctrl+n": () => screen.mockInput.pressKey("n", { ctrl: true }),
    "ctrl+p": () => screen.mockInput.pressKey("p", { ctrl: true }),
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

  /** The styled runs of the current frame, for checks on how text is drawn. */
  async function spans() {
    await frame()
    return screen.captureSpans().lines.flatMap((line) => line.spans)
  }

  async function type(text: string): Promise<void> {
    await screen.mockInput.typeText(text)
    await frame()
  }

  return {
    fake,
    home,
    paths,
    store,
    outside,
    frame,
    peek,
    see,
    spans,
    press,
    type,
    resize: (width: number, height: number) => screen.resize(width, height),
    /** Moves the clock forward. The countdowns on screen catch up within a tick. */
    advance(seconds: number) {
      clock = { ...clock, now: new Date(new Date(clock.now).getTime() + seconds * 1000).toISOString().replace(/\.\d+Z$/, "Z") }
    },
    /** Ends the app the way quitting does, session written. The directory is kept when the caller passed one, so a second app can open on it. */
    async close() {
      stopClock()
      await store.idle()
      await saveSession()
      await screen.dispose()
      await mcp.close()
      if (!options.home) await rm(home, { recursive: true, force: true })
    },
  }
}
