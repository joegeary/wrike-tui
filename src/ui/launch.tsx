import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { isReadOnly, type Env } from "../auth/config"
import type { Session } from "../auth/session"
import type { EffectDeps } from "../app/effects"
import { AUTOSAVE_MS, loadBoot, sessionSaver, skipsRestore } from "../app/session"
import { initialState, type Clock } from "../app/state"
import { createStore } from "../app/store"
import { keepClock } from "../app/ticker"
import { localDay } from "../domain/dates"
import { createPersistence, persistencePaths } from "../persist/persistence"
import { createWrikeClient } from "../wrike/client"
import { createMcpClient } from "../wrike/mcp"
import { createTransport } from "../wrike/transport"
import { App } from "./App"
import { createBridge } from "./bridge"
import { createFrameLog } from "./frameLog"
import { copyText, editInEditor, openInBrowser } from "./handoff"
import { THEMES } from "./theme"

const CLOSE_TIMEOUT_MS = 500

function systemClock(): Clock {
  const now = new Date()
  return { now: now.toISOString(), today: localDay(now) }
}

export async function launch(session: Session, env: Env): Promise<void> {
  const { token } = session.token
  const readOnly = isReadOnly(env)
  const mcp = createMcpClient({ url: session.endpoints.mcpUrl, token, readOnly })
  const client = createWrikeClient(createTransport({ baseUrl: session.endpoints.apiBase, token, readOnly }), mcp)
  const persistence = createPersistence(persistencePaths(env, session.profile.accountId))
  const boot = await loadBoot(persistence, { readOnly, restore: !skipsRestore(env) })

  const closed = Promise.withResolvers<void>()
  const frameLog = env.WRIKE_TUI_FRAME_LOG ? createFrameLog(env.WRIKE_TUI_FRAME_LOG) : null
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: THEMES[boot.settings.theme].background,
    onDestroy: closed.resolve,
    ...(frameLog ? { postProcessFns: [() => frameLog.frame()] } : {}),
  })
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
  const store = createStore(initialState(session.profile, systemClock(), boot), deps)
  const timed: typeof store = frameLog
    ? { ...store, dispatch: (action) => (action.type === "key" && frameLog.key(action.key), store.dispatch(action)) }
    : store
  createRoot(renderer).render(<App store={timed} bridge={bridge} />)
  const stopClock = keepClock(store, systemClock)

  // The session is written while it changes and once more at quit, so a crash loses at most half a minute.
  const saveSession = sessionSaver(store.getState, persistence)
  const autosave = setInterval(() => void saveSession().catch(() => {}), AUTOSAVE_MS)
  await closed.promise
  clearInterval(autosave)
  stopClock()
  await saveSession().catch(() => {})
  // Ending the MCP session is a courtesy, and an unreachable server must not hold the exit.
  await Promise.race([mcp.close(), new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))])
}
