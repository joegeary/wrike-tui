import { basename } from "node:path"
import type { Env } from "../auth/config"
import type { SpaceId, TaskId } from "../domain/ids"
import type { ScopeKey } from "../domain/scope"
import type { SpaceTree } from "../domain/workspace"
import type { Persistence } from "../persist/persistence"
import type { SessionFile } from "../persist/schemas"
import { pathSpace, spacePath, type NavPath } from "./nav"
import type { Boot, Flash, ListView, State } from "./state"

/** The shaping of this many scopes is remembered, the most recently used first. */
const VIEW_LIMIT = 50
export const AUTOSAVE_MS = 30_000

/** What the session file holds: where the user is, not what Wrike said. */
export function sessionOf(state: State): SessionFile {
  const views = [...state.views].slice(-VIEW_LIMIT).map(([key, view]) => [
    key,
    { spec: view.spec, cursor: view.cursor ? { id: view.cursor.id as string, index: view.cursor.index } : null, collapsed: [...view.collapsed], expanded: [...view.expanded] },
  ])
  return {
    version: 1,
    scope: state.scope,
    focus: state.focus,
    zoom: state.zoom,
    nav: { cursor: state.nav.cursor, expanded: [...state.nav.expanded] },
    openTaskId: state.openTaskId,
    includeRead: state.includeRead,
    views: Object.fromEntries(views),
  }
}

/** Puts a saved session back onto a fresh state. The lists themselves are fetched again. */
export function restoreSession(state: State, session: SessionFile): State {
  const views = new Map<ScopeKey, ListView>(
    Object.entries(session.views).map(([key, view]) => [
      key as ScopeKey,
      { spec: view.spec, cursor: view.cursor as ListView["cursor"], collapsed: new Set(view.collapsed), expanded: new Set(view.expanded as TaskId[]) },
    ]),
  )
  return {
    ...state,
    scope: session.scope,
    focus: session.focus,
    zoom: session.zoom && session.focus === "details",
    nav: { cursor: session.nav.cursor as NavPath, expanded: new Set(session.nav.expanded as NavPath[]) },
    openTaskId: session.openTaskId as TaskId | null,
    includeRead: session.includeRead,
    views,
    lastSearch: session.scope.kind === "search" ? session.scope.query : state.lastSearch,
  }
}

/** `WRIKE_TUI_NO_RESTORE=1` starts on the Inbox with nothing open, and leaves the cache and the favorites in use. */
export const skipsRestore = (env: Env) => env.WRIKE_TUI_NO_RESTORE === "1"

/** What the status bar says once when a file could not be read and was moved aside. */
export function movedAsideFlash(paths: (string | null)[]): Flash | null {
  const moved = paths.filter((path): path is string => path !== null).map((path) => basename(path))
  if (moved.length === 0) return null
  return { tone: "error", text: `Could not read ${moved.map((name) => name.replace(/\.bad$/, "")).join(", ")}. Kept as ${moved.join(", ")}, using the defaults.` }
}

/**
 * Reads everything a launch starts from: the config, the favorites, the
 * session, and the cached spaces and trees the session has open, so the first
 * frame already shows the workspace.
 */
export async function loadBoot(persistence: Persistence, options: { readOnly: boolean; restore: boolean }): Promise<Boot> {
  const [config, favorites, session, spaces] = await Promise.all([
    persistence.loadConfig(),
    persistence.loadFavorites(),
    options.restore ? persistence.loadSession() : { value: null, movedAside: null },
    persistence.loadSpaces(),
  ])
  const open = (session.value?.nav.expanded ?? []).flatMap((path) => {
    const space = pathSpace(path as NavPath)
    return space && path === spacePath(space) ? [space] : []
  })
  const cached = await Promise.all(open.map(async (space) => [space, await persistence.loadTree(space)] as const))
  const trees = new Map<SpaceId, SpaceTree>(cached.flatMap(([space, tree]) => (tree.value ? [[space, tree.value.value] as const] : [])))
  return {
    settings: config.value,
    favorites: favorites.value,
    readOnly: options.readOnly,
    session: session.value,
    spaces: spaces.value?.value ?? null,
    trees,
    flash: movedAsideFlash([config.movedAside, favorites.movedAside, session.movedAside, spaces.movedAside, ...cached.map(([, tree]) => tree.movedAside)]),
  }
}

/**
 * Writes the session when it differs from the last one written. The caller
 * runs it on a timer and once more at quit.
 */
export function sessionSaver(getState: () => State, persistence: Persistence): () => Promise<void> {
  let written = JSON.stringify(sessionOf(getState()))
  return async () => {
    const session = sessionOf(getState())
    const text = JSON.stringify(session)
    if (text === written) return
    await persistence.saveSession(session)
    written = text
  }
}
