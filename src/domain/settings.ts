import { DEFAULT_SPECS, type ListSpec } from "./list"
import type { TaskScopeKind } from "./scope"

export const THEME_NAMES = ["terminal", "dark", "light", "high-contrast"] as const
export type ThemeName = (typeof THEME_NAMES)[number]

export const NAV_WIDTH = { min: 16, default: 30, max: 60 } as const

/** What `config.json` holds. Every part is optional in the file. */
export type Settings = {
  theme: ThemeName
  navWidth: number
  /** Whether a list starts with completed, cancelled and deferred tasks in. A list's own default wins. */
  completed: boolean
  /** Whether field history is drawn among the comments. */
  history: boolean
  lists: Partial<Record<TaskScopeKind, Partial<ListSpec>>>
  /** Keys that replace the defaults, by command ID. Absent from a file that changes none. */
  keys?: KeyOverrides
}

/** A command ID to the key, or the list of keys, that replace its default keys. An empty list unbinds the command. */
export type KeyOverrides = Readonly<Record<string, string | readonly string[]>>

export const DEFAULT_SETTINGS: Settings = { theme: "terminal", navWidth: NAV_WIDTH.default, completed: false, history: true, lists: {} }

/** The shaping a scope of this kind starts with. Search keeps finding closed tasks unless its own default says otherwise. */
export function defaultSpec(settings: Settings, kind: TaskScopeKind): ListSpec {
  return {
    ...DEFAULT_SPECS[kind],
    ...(kind === "search" ? {} : { completed: settings.completed }),
    ...settings.lists[kind],
  }
}
