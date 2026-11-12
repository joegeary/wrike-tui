import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { isReadOnly, type Env } from "../auth/config"
import type { Session } from "../auth/session"
import type { EffectDeps } from "../app/effects"
import { initialState, type Clock } from "../app/state"
import { createStore } from "../app/store"
import { localDay } from "../domain/dates"
import { createWrikeClient } from "../wrike/client"
import { createInboxSource } from "../wrike/inbox"
import { createTransport } from "../wrike/transport"
import { App } from "./App"
import { createBridge } from "./bridge"
import { copyText, editInEditor, openInBrowser } from "./handoff"
import { theme } from "./theme"

const CLOSE_TIMEOUT_MS = 500

function systemClock(): Clock {
  const now = new Date()
  return { now: now.toISOString(), today: localDay(now) }
}

export async function launch(session: Session, env: Env): Promise<void> {
  const { token } = session.token
  const inbox = createInboxSource({ url: session.endpoints.mcpUrl, token })
  const client = createWrikeClient(createTransport({ baseUrl: session.endpoints.apiBase, token, readOnly: isReadOnly(env) }), inbox)

  const closed = Promise.withResolvers<void>()
  const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: theme.background, onDestroy: closed.resolve })
  const bridge = createBridge()
  const deps: EffectDeps = {
    client,
    clock: systemClock,
    editor: (initial, extension) => editInEditor(renderer, env, initial, extension),
    openUrl: (url) => openInBrowser(env, url),
    copy: (text) => copyText(renderer, env, text),
    scrollDetails: (to) => bridge.scrollDetails(to),
    quit: () => renderer.destroy(),
  }
  const store = createStore(initialState(session.profile, systemClock()), deps)
  createRoot(renderer).render(<App store={store} bridge={bridge} />)

  await closed.promise
  // Ending the MCP session is a courtesy, and an unreachable server must not hold the exit.
  await Promise.race([inbox.close(), new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))])
}
