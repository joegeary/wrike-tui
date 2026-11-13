import { describe, expect, test } from "bun:test"
import { cursorRow, favoritePath, navRows, pathAncestors, pathSpace, spacePath, stepCursor, viewPath, type NavInput, type NavPath, type NavRow } from "../../src/app/nav"
import { folderId, spaceId, taskId } from "../../src/domain/ids"
import { moveFavorite, retitleFavorites, toggleFavorite, type Favorite, type FolderNode, type Space, type SpaceTree } from "../../src/domain/workspace"

const ENG = spaceId("ENG")
const OPS = spaceId("OPS")
const ME = spaceId("ME")
const spaces: Space[] = [
  { id: OPS, title: "Operations", access: "Private" },
  { id: ENG, title: "Engineering", access: "Public" },
  { id: ME, title: "Zed's space", access: "Personal" },
]

function tree(space: string, shape: Record<string, string[]>, projects: string[] = []): SpaceTree {
  const nodes = new Map<ReturnType<typeof folderId>, FolderNode>()
  for (const [id, children] of Object.entries(shape)) {
    nodes.set(folderId(id), {
      id: folderId(id),
      title: id === space ? "root" : `Folder ${id}`,
      childIds: children.map(folderId),
      kind: id === space ? "space" : projects.includes(id) ? "project" : "folder",
      project: projects.includes(id) ? { statusId: null, ownerIds: [] } : null,
    })
  }
  return nodes
}

// B sits under both A and the space. C loops back to A.
const engTree = tree("ENG", { ENG: ["A", "B"], A: ["B", "C"], B: [], C: ["A"] }, ["B"])
const path = (text: string) => text as NavPath

function input(overrides: Partial<NavInput> = {}): NavInput {
  return {
    counts: { inbox: 2, todo: 6, search: null },
    favorites: [],
    missing: new Set(),
    spaces: { state: "ready", value: spaces },
    trees: new Map([[ENG, { state: "ready", value: engTree }]]),
    expanded: new Set(),
    ...overrides,
  }
}

const sketch = (rows: NavRow[]) =>
  rows.map((row) => {
    switch (row.kind) {
      case "heading":
        return `# ${row.label}`
      case "note":
        return `${"  ".repeat(row.depth)}(${row.text})`
      case "view":
        return `${row.view} ${row.count ?? "-"}`
      case "favorite":
        return `* ${row.favorite.title}${row.missing ? " (not found)" : ""}`
      case "node":
        return `${"  ".repeat(row.depth)}${row.loading ? "~" : row.expanded ? "v" : row.expandable ? ">" : "."} ${row.node.title}`
    }
  })

describe("navRows", () => {
  test("views, then spaces with Personal first and the rest by title", () => {
    expect(sketch(navRows(input()))).toEqual(["inbox 2", "todo 6", "search -", "# Spaces", "> Zed's space", "> Engineering", "> Operations"])
  })

  test("favorites get their own heading only when there are any", () => {
    const favorites: Favorite[] = [
      { kind: "folder", id: folderId("A"), title: "Folder A", project: false },
      { kind: "task", id: taskId("T1"), title: "A task" },
    ]
    const rows = navRows(input({ favorites, missing: new Set(["task:T1"]) }))
    expect(sketch(rows).slice(3, 7)).toEqual(["# Favorites", "* Folder A", "* A task (not found)", "# Spaces"])
    expect(rows.find((row) => row.kind === "favorite")).toMatchObject({ path: "fav:folder:A", depth: 0 })
  })

  test("an expanded space draws its children in childIds order", () => {
    const rows = navRows(input({ expanded: new Set([spacePath(ENG)]) }))
    expect(sketch(rows).slice(4, 8)).toEqual(["> Zed's space", "v Engineering", "  > Folder A", "  . Folder B"])
  })

  test("a folder with two parents is drawn at each, under its own path", () => {
    const rows = navRows(input({ expanded: new Set([spacePath(ENG), path("space:ENG/A")]) }))
    const paths = rows.flatMap((row) => (row.kind === "node" && row.node.id === "B" ? [row.path] : []))
    expect(paths).toEqual(["space:ENG/A/B", "space:ENG/B"] as never)
  })

  test("expanding one path of a multi-parent folder leaves its other path closed", () => {
    const twice = tree("ENG", { ENG: ["A", "B"], A: ["B"], B: ["D"], D: [] })
    const rows = navRows(input({ trees: new Map([[ENG, { state: "ready", value: twice }]]), expanded: new Set([spacePath(ENG), path("space:ENG/A"), path("space:ENG/A/B")]) }))
    expect(sketch(rows).slice(5)).toEqual(["v Engineering", "  v Folder A", "    v Folder B", "      . Folder D", "  > Folder B", "> Operations"])
  })

  test("a folder met again on its own path is drawn but never opened", () => {
    const expanded = new Set([spacePath(ENG), path("space:ENG/A"), path("space:ENG/A/C"), path("space:ENG/A/C/A")])
    const rows = navRows(input({ expanded }))
    expect(sketch(rows).slice(5, 10)).toEqual(["v Engineering", "  v Folder A", "    . Folder B", "    v Folder C", "      . Folder A"])
    expect(rows.find((row) => row.kind === "node" && row.path === "space:ENG/A/C/A")).toMatchObject({ expandable: false, expanded: false })
  })

  test("an opened space whose tree is on its way shows as loading, and a loaded empty one cannot open", () => {
    const trees = new Map<typeof ENG, NavInput["trees"] extends ReadonlyMap<unknown, infer V> ? V : never>([
      [OPS, { state: "loading" }],
      [ME, { state: "ready", value: tree("ME", { ME: [] }) }],
    ])
    const rows = navRows(input({ trees, expanded: new Set([spacePath(OPS), spacePath(ME)]) }))
    expect(sketch(rows).slice(4)).toEqual([". Zed's space", "> Engineering", "~ Operations"])
  })

  test("a tree that failed says so under its space, and a reload keeps the old tree drawn", () => {
    const failed = navRows(input({ trees: new Map([[ENG, { state: "error", error: { kind: "rate_limited" } }]]), expanded: new Set([spacePath(ENG)]) }))
    expect(sketch(failed).slice(5, 7)).toEqual(["v Engineering", "  (Could not load, press r)"])
    const reloading = navRows(input({ trees: new Map([[ENG, { state: "loading", previous: engTree }]]), expanded: new Set([spacePath(ENG)]) }))
    expect(sketch(reloading).slice(5, 8)).toEqual(["v Engineering", "  > Folder A", "  . Folder B"])
  })

  test("the spaces list loading, failed and empty", () => {
    expect(sketch(navRows(input({ spaces: { state: "loading" } }))).slice(3)).toEqual(["# Spaces", "(Loading...)"])
    expect(sketch(navRows(input({ spaces: { state: "error", error: { kind: "unauthorized" } } }))).slice(3)).toEqual(["# Spaces", "(Could not load, press r)"])
    expect(sketch(navRows(input({ spaces: { state: "ready", value: [] } }))).slice(3)).toEqual(["# Spaces", "(No spaces)"])
    expect(sketch(navRows(input({ spaces: { state: "loading", previous: spaces } }))).slice(3)).toHaveLength(4)
  })

  test("only expanded paths are walked, so a big closed tree costs nothing", () => {
    const shape: Record<string, string[]> = { OPS: [] }
    for (let n = 0; n < 4000; n++) {
      shape[`F${n}`] = []
      shape[n < 40 ? "OPS" : `F${n % 40}`]!.push(`F${n}`)
    }
    const rows = navRows(input({ trees: new Map([[OPS, { state: "ready", value: tree("OPS", shape) }]]), expanded: new Set([spacePath(OPS)]) }))
    expect(rows.filter((row) => row.kind === "node")).toHaveLength(3 + 40)
  })
})

describe("the nav cursor", () => {
  const open = new Set([spacePath(ENG), path("space:ENG/A")])
  const rows = navRows(input({ expanded: open }))

  test("stays on its path across a rebuild", () => {
    expect(cursorRow(rows, path("space:ENG/A/C"))?.path).toBe(path("space:ENG/A/C"))
    const refreshed = navRows(input({ expanded: open, counts: { inbox: 9, todo: 1, search: 3 } }))
    expect(cursorRow(refreshed, path("space:ENG/A/C"))?.path).toBe(path("space:ENG/A/C"))
  })

  test("falls to the nearest ancestor still drawn when its path is gone", () => {
    const closed = navRows(input({ expanded: new Set([spacePath(ENG)]) }))
    expect(cursorRow(closed, path("space:ENG/A/C"))?.path).toBe(path("space:ENG/A"))
    expect(cursorRow(navRows(input()), path("space:ENG/A/C"))?.path).toBe(spacePath(ENG))
  })

  test("falls to the first row when nothing of its path is left", () => {
    expect(cursorRow(rows, favoritePath({ kind: "task", id: taskId("GONE") }))?.path).toBe(viewPath("inbox"))
    expect(cursorRow([], viewPath("inbox"))).toBeNull()
  })

  test("steps over headings and notes and stops at both ends", () => {
    expect(stepCursor(rows, viewPath("search"), 1)).toBe(spacePath(ME))
    expect(stepCursor(rows, spacePath(ME), -1)).toBe(viewPath("search"))
    expect(stepCursor(rows, viewPath("inbox"), -1)).toBe(viewPath("inbox"))
    expect(stepCursor(rows, spacePath(OPS), 5)).toBe(spacePath(OPS))
  })

  test("a path knows its space and its ancestors", () => {
    expect(pathSpace(path("space:ENG/A/C"))).toBe(ENG)
    expect(pathSpace(viewPath("todo"))).toBeNull()
    expect(pathAncestors(path("space:ENG/A/C"))).toEqual(["space:ENG/A", "space:ENG"] as never)
    expect(pathAncestors(spacePath(ENG))).toEqual([])
  })
})

describe("favorites", () => {
  const a: Favorite = { kind: "folder", id: folderId("A"), title: "Folder A", project: false }
  const b: Favorite = { kind: "space", id: ENG, title: "Engineering" }
  const c: Favorite = { kind: "task", id: taskId("T1"), title: "A task" }

  test("toggling adds at the end and removes by kind and ID", () => {
    expect(toggleFavorite([a], b)).toEqual([a, b])
    expect(toggleFavorite([a, b], { ...a, title: "Renamed" })).toEqual([b])
  })

  test("moving swaps neighbours and stops at the ends", () => {
    expect(moveFavorite([a, b, c], "space:ENG", -1)).toEqual([b, a, c])
    expect(moveFavorite([a, b, c], "space:ENG", 1)).toEqual([a, c, b])
    const list = [a, b, c]
    expect(moveFavorite(list, "folder:A", -1)).toBe(list)
    expect(moveFavorite(list, "task:T1", 1)).toBe(list)
    expect(moveFavorite(list, "task:NOPE", 1)).toBe(list)
  })

  test("titles refresh from what was seen, and nothing changes when they match", () => {
    const list = [a, b]
    expect(retitleFavorites(list, new Map([["folder:A", "Folder A"]]))).toBe(list)
    expect(retitleFavorites(list, new Map([["folder:A", "Alpha"]]))).toEqual([{ ...a, title: "Alpha" }, b])
  })
})
