import { homedir } from "node:os"
import { join } from "node:path"
import type { Env } from "../auth/config"
import type { CustomField } from "../domain/fields"
import type { SpaceId } from "../domain/ids"
import { DEFAULT_SETTINGS, type Settings } from "../domain/settings"
import type { Favorite, Space, SpaceTree } from "../domain/workspace"
import { readJson, writeJson, type Loaded } from "./files"
import { ConfigSchema, FavoritesSchema, FieldsCacheSchema, SessionSchema, SpacesCacheSchema, TreeCacheSchema, type SessionFile } from "./schemas"

export type Cached<T> = { value: T; fetchedAt: string }

export type Persistence = {
  loadConfig(): Promise<Loaded<Settings>>
  saveConfig(settings: Settings): Promise<void>
  loadSession(): Promise<Loaded<SessionFile | null>>
  saveSession(session: SessionFile): Promise<void>
  loadFavorites(): Promise<Loaded<Favorite[]>>
  saveFavorites(favorites: Favorite[]): Promise<void>
  loadSpaces(): Promise<Loaded<Cached<Space[]> | null>>
  saveSpaces(spaces: Space[]): Promise<void>
  loadTree(space: SpaceId): Promise<Loaded<Cached<SpaceTree> | null>>
  saveTree(space: SpaceId, tree: SpaceTree): Promise<void>
  loadFields(): Promise<Loaded<Cached<CustomField[]> | null>>
  saveFields(fields: CustomField[]): Promise<void>
}

export type PersistencePaths = { config: string; session: string; favorites: string; spaces: string; fields: string; tree(space: SpaceId): string }

/** Config is shared by every account. Session, favorites and cache are kept per account. */
export function persistencePaths(env: Env, accountId: string): PersistencePaths {
  const home = homedir()
  const account = accountId || "default"
  const state = join(env.XDG_STATE_HOME || join(home, ".local", "state"), "wrike-tui", account)
  const cache = join(env.XDG_CACHE_HOME || join(home, ".cache"), "wrike-tui", account)
  return {
    config: join(env.XDG_CONFIG_HOME || join(home, ".config"), "wrike-tui", "config.json"),
    session: join(state, "session.json"),
    favorites: join(state, "favorites.json"),
    spaces: join(cache, "spaces.json"),
    fields: join(cache, "fields.json"),
    tree: (space) => join(cache, `tree-${space}.json`),
  }
}

export function createPersistence(paths: PersistencePaths, now: () => string = () => new Date().toISOString()): Persistence {
  return {
    loadConfig: () => readJson(paths.config, ConfigSchema, DEFAULT_SETTINGS),
    saveConfig: (settings) => writeJson(paths.config, settings),

    loadSession: () => readJson<SessionFile | null>(paths.session, SessionSchema, null),
    saveSession: (session) => writeJson(paths.session, session),

    async loadFavorites() {
      const { value, movedAside } = await readJson(paths.favorites, FavoritesSchema, null)
      return { value: value?.favorites ?? [], movedAside }
    },
    saveFavorites: (favorites) => writeJson(paths.favorites, { version: 1, favorites }),

    async loadSpaces() {
      const { value, movedAside } = await readJson(paths.spaces, SpacesCacheSchema, null)
      return { value: value ? { value: value.spaces, fetchedAt: value.fetchedAt } : null, movedAside }
    },
    saveSpaces: (spaces) => writeJson(paths.spaces, { version: 1, fetchedAt: now(), spaces }),

    async loadTree(space) {
      const { value, movedAside } = await readJson(paths.tree(space), TreeCacheSchema, null)
      return { value: value ? { value: new Map(value.nodes.map((node) => [node.id, node])), fetchedAt: value.fetchedAt } : null, movedAside }
    },
    saveTree: (space, tree) => writeJson(paths.tree(space), { version: 1, fetchedAt: now(), nodes: [...tree.values()] }, "compact"),

    async loadFields() {
      const { value, movedAside } = await readJson(paths.fields, FieldsCacheSchema, null)
      return { value: value ? { value: value.fields, fetchedAt: value.fetchedAt } : null, movedAside }
    },
    saveFields: (fields) => writeJson(paths.fields, { version: 1, fetchedAt: now(), fields }, "compact"),
  }
}
