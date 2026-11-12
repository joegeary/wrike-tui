import type { Brand, FolderId, SpaceId } from "../domain/ids"
import { favoriteKey, sortSpaces, treeRoot, type Favorite, type FolderNode, type Space, type SpaceTree } from "../domain/workspace"
import type { WrikeError } from "../wrike/errors"
import type { Loadable } from "./state"

/**
 * Where a nav row is: `view:todo`, `fav:folder:<id>`, `space:<spaceId>`, or
 * `space:<spaceId>/<folderId>/<folderId>` for a folder reached through its
 * parents. A folder with two parents has two paths.
 */
export type NavPath = Brand<string, "NavPath">

export const NAV_VIEWS = ["inbox", "todo", "search"] as const
export type NavView = (typeof NAV_VIEWS)[number]
export type ViewCounts = Record<NavView, number | null>

export type NavRow =
  | { kind: "heading"; label: string }
  | { kind: "note"; depth: number; text: string; error: WrikeError | null }
  | { kind: "view"; path: NavPath; view: NavView; count: number | null }
  | { kind: "node"; path: NavPath; depth: number; node: FolderNode | Space; expandable: boolean; expanded: boolean; loading: boolean }
  | { kind: "favorite"; path: NavPath; favorite: Favorite; depth: 0; missing: boolean }

export type SelectableNavRow = Exclude<NavRow, { kind: "heading" | "note" }>

export const viewPath = (view: NavView) => `view:${view}` as NavPath
export const favoritePath = (favorite: Pick<Favorite, "kind" | "id">) => `fav:${favoriteKey(favorite)}` as NavPath
export const spacePath = (space: SpaceId) => `space:${space}` as NavPath
const childPath = (parent: NavPath, child: FolderId) => `${parent}/${child}` as NavPath

/** The space a tree path starts at, or null for a view or a favorite. */
export function pathSpace(path: NavPath): SpaceId | null {
  return path.startsWith("space:") ? (path.slice("space:".length).split("/")[0] as SpaceId) : null
}

/** The paths above `path` in its space, nearest first. */
export function pathAncestors(path: NavPath): NavPath[] {
  const ancestors: NavPath[] = []
  for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/", cut - 1)) ancestors.push(path.slice(0, cut) as NavPath)
  return ancestors
}

export type NavInput = {
  counts: ViewCounts
  favorites: Favorite[]
  /** Keys of favorites Wrike answered 404 for. */
  missing: ReadonlySet<string>
  spaces: Loadable<Space[]>
  trees: ReadonlyMap<SpaceId, Loadable<SpaceTree>>
  expanded: ReadonlySet<NavPath>
}

function shownValue<T>(loadable: Loadable<T> | undefined): T | undefined {
  if (!loadable || loadable.state === "idle") return undefined
  return loadable.state === "ready" ? loadable.value : loadable.previous
}

/** Every row of the navigation pane, top to bottom. Only expanded paths are walked, so the cost follows what is open. */
export function navRows(input: NavInput): NavRow[] {
  const rows: NavRow[] = NAV_VIEWS.map((view) => ({ kind: "view", path: viewPath(view), view, count: input.counts[view] }))

  if (input.favorites.length > 0) {
    rows.push({ kind: "heading", label: "Favorites" })
    for (const favorite of input.favorites) {
      rows.push({ kind: "favorite", path: favoritePath(favorite), favorite, depth: 0, missing: input.missing.has(favoriteKey(favorite)) })
    }
  }

  rows.push({ kind: "heading", label: "Spaces" })
  const spaces = shownValue(input.spaces)
  if (input.spaces.state === "error") rows.push({ kind: "note", depth: 0, text: "Could not load the spaces", error: input.spaces.error })
  if (!spaces) {
    if (input.spaces.state === "loading") rows.push({ kind: "note", depth: 0, text: "Loading...", error: null })
    return rows
  }
  if (spaces.length === 0) rows.push({ kind: "note", depth: 0, text: "No spaces", error: null })

  for (const space of sortSpaces(spaces)) {
    const path = spacePath(space.id)
    const loadable = input.trees.get(space.id)
    const tree = shownValue(loadable)
    const root = tree ? treeRoot(tree, space.id) : undefined
    const open = input.expanded.has(path)
    // Until the tree has loaded nobody knows whether the space has folders, so it offers to open.
    const expandable = root ? root.childIds.length > 0 : true
    rows.push({ kind: "node", path, depth: 0, node: space, expandable, expanded: open && expandable, loading: open && !tree && loadable?.state === "loading" })
    if (!open) continue
    if (loadable?.state === "error") rows.push({ kind: "note", depth: 1, text: "Could not load the folders", error: loadable.error })
    if (tree && root) for (const child of root.childIds) walk(rows, tree, child, path, 1, new Set([root.id]), input.expanded)
  }
  return rows
}

function walk(rows: NavRow[], tree: SpaceTree, id: FolderId, parent: NavPath, depth: number, above: ReadonlySet<FolderId>, expanded: ReadonlySet<NavPath>) {
  const node = tree.get(id)
  if (!node) return
  const path = childPath(parent, id)
  // A folder met again on its own path is a cycle: it is drawn, and never opened again.
  const expandable = node.childIds.length > 0 && !above.has(id)
  const open = expandable && expanded.has(path)
  rows.push({ kind: "node", path, depth, node, expandable, expanded: open, loading: false })
  if (!open) return
  const within = new Set(above).add(id)
  for (const child of node.childIds) walk(rows, tree, child, path, depth + 1, within, expanded)
}

export const isSelectable = (row: NavRow): row is SelectableNavRow => row.kind !== "heading" && row.kind !== "note"

/** The row the cursor is on: the row at `path`, else its nearest ancestor still drawn, else the first row. */
export function cursorRow(rows: NavRow[], path: NavPath): SelectableNavRow | null {
  const selectable = rows.filter(isSelectable)
  for (const candidate of [path, ...pathAncestors(path)]) {
    const row = selectable.find((row) => row.path === candidate)
    if (row) return row
  }
  return selectable[0] ?? null
}

/** The path `by` selectable rows from the cursor, stopping at either end. */
export function stepCursor(rows: NavRow[], path: NavPath, by: number): NavPath {
  const selectable = rows.filter(isSelectable)
  const current = cursorRow(rows, path)
  if (!current) return path
  const index = selectable.indexOf(current)
  return selectable[Math.max(0, Math.min(index + by, selectable.length - 1))]!.path
}
