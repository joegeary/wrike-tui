import { favoriteKey, moveFavorite, toggleFavorite, type Favorite } from "../../domain/workspace"
import { favoritePath, nodeScope, pathSpace, stepCursor, type NavPath, type SelectableNavRow } from "../nav"
import { navCursorRow, navRowsOf, openTask, selectedEntry, selectedTask } from "../selectors"
import type { Action, State, Update } from "../state"
import { info, then } from "./core"
import { search } from "./lists"
import { loadTree, open, showScope } from "./load"

export function navOpen(state: State): Update {
  const row = navCursorRow(state)
  if (!row) return [state, []]
  const here = { ...state, nav: { ...state.nav, cursor: row.path } }
  switch (row.kind) {
    case "view":
      if (row.view !== "search") return showScope(here, { kind: row.view }, "list")
      return state.lastSearch === "" ? search(here) : showScope(here, { kind: "search", query: state.lastSearch }, "list")
    case "favorite": {
      const { favorite } = row
      if (favorite.kind === "task") return open(here, { kind: "task", id: favorite.id }, null)
      return showScope(here, favorite.kind === "space" ? { kind: "space", id: favorite.id, title: favorite.title } : { ...favorite }, "list")
    }
    case "node":
      // The focus stays in the tree, so the next folder down is one more Enter away.
      return then(row.expandable ? setExpanded(here, row, true) : [here, []], (next) => showScope(next, nodeScope(row), "nav"))
  }
}

function setExpanded(state: State, row: SelectableNavRow & { kind: "node" }, open: boolean): Update {
  const expanded = new Set(state.nav.expanded)
  if (open) expanded.add(row.path)
  else expanded.delete(row.path)
  const next = { ...state, nav: { ...state.nav, expanded } }
  const space = row.depth === 0 ? pathSpace(row.path) : null
  return open && space && !state.trees.has(space) ? loadTree(next, space) : [next, []]
}

export function navToggle(state: State): Update {
  const row = navCursorRow(state)
  if (row?.kind !== "node" || !row.expandable) return [state, []]
  return setExpanded({ ...state, nav: { ...state.nav, cursor: row.path } }, row, !state.nav.expanded.has(row.path))
}

/** What `F` acts on: the nav row under the cursor, the selected task, or the open task. */
function favoriteTarget(state: State): Favorite | string {
  if (state.focus === "nav") {
    const row = navCursorRow(state)
    if (row?.kind === "favorite") return row.favorite
    return row?.kind === "node" ? nodeScope(row) : "Only a space, a folder, a project or a task can be a favorite"
  }
  const opened = openTask(state)
  if (state.focus === "details") return opened ? { kind: "task", id: opened.id, title: opened.title } : "No task is open"
  const task = selectedTask(state)
  if (task) return { kind: "task", id: task.id, title: task.title }
  const item = selectedEntry(state)?.item
  if (item && opened?.permalink === item.permalink) return { kind: "task", id: opened.id, title: opened.title }
  return item ? "Open the task first, then press F" : "Select a task first"
}

export function favorite(state: State): Update {
  const target = favoriteTarget(state)
  if (typeof target === "string") return [{ ...state, flash: info(target) }, []]
  const key = favoriteKey(target)
  const favorites = toggleFavorite(state.favorites, target)
  const removed = favorites.length < state.favorites.length
  // A cursor on the favorite that goes away steps to its neighbour instead of jumping to the top.
  const path = favoritePath(target)
  const rows = navRowsOf(state)
  const below = stepCursor(rows, path, 1)
  const neighbour = below.startsWith("fav:") && below !== path ? below : stepCursor(rows, path, -1)
  const cursor: NavPath = removed && state.nav.cursor === path ? neighbour : state.nav.cursor
  return [
    {
      ...state,
      favorites,
      nav: { ...state.nav, cursor },
      missing: removed ? new Set([...state.missing].filter((candidate) => candidate !== key)) : state.missing,
      flash: info(removed ? `Removed ${target.title} from the favorites` : `Added ${target.title} to the favorites`),
    },
    [{ kind: "save-favorites", favorites }],
  ]
}

export function favoriteMove(state: State, action: Action & { type: "favorite-move" }): Update {
  const row = navCursorRow(state)
  if (row?.kind !== "favorite") return [state, []]
  const favorites = moveFavorite(state.favorites, favoriteKey(row.favorite), action.by)
  return favorites === state.favorites ? [state, []] : [{ ...state, favorites }, [{ kind: "save-favorites", favorites }]]
}
