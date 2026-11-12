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
  lists: Partial<Record<TaskScopeKind, Partial<ListSpec>>>
}

export const DEFAULT_SETTINGS: Settings = { theme: "terminal", navWidth: NAV_WIDTH.default, completed: false, lists: {} }

/** The shaping a scope of this kind starts with. Search keeps finding closed tasks unless its own default says otherwise. */
export function defaultSpec(settings: Settings, kind: TaskScopeKind): ListSpec {
  return {
    ...DEFAULT_SPECS[kind],
    ...(kind === "search" ? {} : { completed: settings.completed }),
    ...settings.lists[kind],
  }
}
