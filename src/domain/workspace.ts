import type { CustomStatusId, FolderId, SpaceId, TaskId, UserId } from "./ids"

export const SPACE_ACCESS = ["Public", "Private", "Personal"] as const
export type SpaceAccess = (typeof SPACE_ACCESS)[number]
export type Space = { id: SpaceId; title: string; access: SpaceAccess }

export type FolderNode = {
  id: FolderId
  title: string
  childIds: FolderId[]
  kind: "space" | "folder" | "project"
  project: { statusId: CustomStatusId | null; ownerIds: UserId[] } | null
}

/** One space's folders by ID. The space's own node is the root and has the space's ID. */
export type SpaceTree = Map<FolderId, FolderNode>

export const treeRoot = (tree: SpaceTree, space: SpaceId): FolderNode | undefined => tree.get(space as string as FolderId)

/** Personal spaces first, then by title. */
export function sortSpaces(spaces: Space[]): Space[] {
  const rank = (space: Space) => (space.access === "Personal" ? 0 : 1)
  return spaces.toSorted((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}

export type Favorite =
  | { kind: "space"; id: SpaceId; title: string }
  | { kind: "folder"; id: FolderId; title: string; project: boolean }
  | { kind: "task"; id: TaskId; title: string }

export const favoriteKey = (favorite: Pick<Favorite, "kind" | "id">) => `${favorite.kind}:${favorite.id}`

/** Adds the favorite, or removes the one with the same kind and ID. */
export function toggleFavorite(favorites: Favorite[], favorite: Favorite): Favorite[] {
  const key = favoriteKey(favorite)
  const without = favorites.filter((candidate) => favoriteKey(candidate) !== key)
  return without.length === favorites.length ? [...favorites, favorite] : without
}

/** Moves the favorite with `key` one place up or down. The list comes back unchanged at either end. */
export function moveFavorite(favorites: Favorite[], key: string, by: -1 | 1): Favorite[] {
  const from = favorites.findIndex((candidate) => favoriteKey(candidate) === key)
  const to = from + by
  if (from < 0 || to < 0 || to >= favorites.length) return favorites
  const moved = [...favorites]
  ;[moved[from], moved[to]] = [moved[to]!, moved[from]!]
  return moved
}

/** The favorites with any title that differs from `titles` replaced. The same array comes back when nothing changed. */
export function retitleFavorites(favorites: Favorite[], titles: ReadonlyMap<string, string>): Favorite[] {
  let changed = false
  const next = favorites.map((favorite) => {
    const title = titles.get(favoriteKey(favorite))
    if (title === undefined || title === favorite.title) return favorite
    changed = true
    return { ...favorite, title }
  })
  return changed ? next : favorites
}
