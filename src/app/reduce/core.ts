import { scopeKey } from "../../domain/scope"
import type { RowCursor } from "../../domain/shape"
import { favoriteKey, retitleFavorites } from "../../domain/workspace"
import { currentKey, currentView, listRows } from "../selectors"
import type { Effect, Flash, ListView, State, Update } from "../state"

export const info = (text: string): Flash => ({ tone: "info", text })
export const failure = (text: string): Flash => ({ tone: "error", text })
export const clamp = (value: number, count: number) => Math.max(0, Math.min(value, count - 1))
export const TODO = scopeKey({ kind: "todo" })

/** Runs `second` on the state `first` produced and joins their effects. */
export function then(first: Update, second: (state: State) => Update): Update {
  const [state, effects] = second(first[0])
  return [state, [...first[1], ...effects]]
}

/** Refreshes favorite titles from what was just seen, and saves them when one changed. */
export function retitle(state: State, titles: ReadonlyMap<string, string>, effects: Effect[]): Update {
  const favorites = retitleFavorites(state.favorites, titles)
  const found = [...state.missing].filter((key) => titles.has(key))
  const missing = found.length > 0 ? new Set([...state.missing].filter((key) => !titles.has(key))) : state.missing
  if (favorites === state.favorites) return [{ ...state, missing }, effects]
  return [{ ...state, favorites, missing }, [...effects, { kind: "save-favorites", favorites }]]
}

export function markMissing(state: State, keys: string[]): State {
  const favorites = new Set(state.favorites.map(favoriteKey))
  const gone = keys.filter((key) => favorites.has(key) && !state.missing.has(key))
  return gone.length === 0 ? state : { ...state, missing: new Set([...state.missing, ...gone]) }
}

/** Changes the current scope's view, creating it with the config defaults when the scope is new. */
export function withView(state: State, change: (view: ListView) => ListView): State {
  return { ...state, views: new Map(state.views).set(currentKey(state), change(currentView(state))) }
}

export const cursorAt = (state: State, index: number): RowCursor | null => {
  const row = listRows(state)[index]
  return row ? { id: row.id, index } : null
}
