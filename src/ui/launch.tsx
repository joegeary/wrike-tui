import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { basename } from "node:path"
import { isReadOnly, type Env } from "../auth/config"
import type { Session } from "../auth/session"
import type { EffectDeps } from "../app/effects"
import { initialState, type Clock, type Flash } from "../app/state"
import { createStore } from "../app/store"
import { localDay } from "../domain/dates"
import { createPersistence, persistencePaths } from "../persist/persistence"
import { createWrikeClient } from "../wrike/client"
import { createInboxSource } from "../wrike/inbox"
import { createTransport } from "../wrike/transport"
import { App } from "./App"
import { createBridge } from "./bridge"
import { copyText, editInEditor, openInBrowser } from "./handoff"
import { THEMES } from "./theme"

const CLOSE_TIMEOUT_MS = 500

function systemClock(): Clock {
  const now = new Date()
  return { now: now.toISOString(), today: localDay(now) }
}

/** What the status bar says once when a file could not be read and was moved aside. */
export function movedAsideFlash(paths: (string | null)[]): Flash | null {
  const moved = paths.filter((path): path is string => path !== null).map((path) => basename(path))
  if (moved.length === 0) return null
  return { tone: "error", text: `Could not read ${moved.map((name) => name.replace(/\.bad$/, "")).join(", ")}. Kept as ${moved.join(", ")}, using the defaults.` }
}

export async function launch(session: Session, env: Env): Promise<void> {
  const { token } = session.token
  const readOnly = isReadOnly(env)
  const inbox = createInboxSource({ url: session.endpoints.mcpUrl, token })
  const client = createWrikeClient(createTransport({ baseUrl: session.endpoints.apiBase, token, readOnly }), inbox)
  const persistence = createPersistence(persistencePaths(env, session.profile.accountId))
  const [config, favorites] = await Promise.all([persistence.loadConfig(), persistence.loadFavorites()])

  const closed = Promise.withResolvers<void>()
  const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: THEMES[config.value.theme].background, onDestroy: closed.resolve })
  const bridge = createBridge()
  const deps: EffectDeps = {
    client,
    clock: systemClock,
    editor: (initial, extension) => editInEditor(renderer, env, initial, extension),
    openUrl: (url) => openInBrowser(env, url),
    copy: (text) => copyText(renderer, env, text),
    scroll: (pane, to) => bridge.scrollers[pane]?.(to),
    persistence,
    quit: () => renderer.destroy(),
  }
  const boot = { settings: config.value, favorites: favorites.value, readOnly, flash: movedAsideFlash([config.movedAside, favorites.movedAside]) }
  const store = createStore(initialState(session.profile, systemClock(), boot), deps)
  createRoot(renderer).render(<App store={store} bridge={bridge} />)

  await closed.promise
  // Ending the MCP session is a courtesy, and an unreachable server must not hold the exit.
  await Promise.race([inbox.close(), new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))])
}
