import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { folderId, spaceId, taskId } from "../../src/domain/ids"
import { DEFAULT_SPECS } from "../../src/domain/list"
import { DEFAULT_SETTINGS, defaultSpec } from "../../src/domain/settings"
import type { Favorite, FolderNode, Space } from "../../src/domain/workspace"
import { createPersistence, persistencePaths, type Persistence, type PersistencePaths } from "../../src/persist/persistence"
import type { SessionFile } from "../../src/persist/schemas"

let root: string
let paths: PersistencePaths
let persistence: Persistence

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wrike-tui-persist-"))
  paths = persistencePaths({ XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, "ACC1")
  persistence = createPersistence(paths, () => "2026-11-12T16:00:00Z")
})
afterEach(() => rm(root, { recursive: true, force: true }))

async function put(path: string, content: string | object) {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, typeof content === "string" ? content : JSON.stringify(content))
}

const session: SessionFile = {
  version: 1,
  scope: { kind: "folder", id: folderId("F1"), title: "Platform", project: false },
  focus: "nav",
  zoom: false,
  nav: { cursor: "space:S1/F1", expanded: ["space:S1"] },
  openTaskId: "T1",
  includeRead: true,
  views: { "folder:F1": { spec: { ...DEFAULT_SPECS.folder, group: "assignee" }, cursor: { id: "task:T1", index: 3 }, collapsed: ["assignee:U1"], expanded: ["T2"] } },
}

describe("paths", () => {
  test("config is shared, state and cache are per account, under the XDG directories", () => {
    expect(paths.config).toBe(join(root, "config", "wrike-tui", "config.json"))
    expect(paths.session).toBe(join(root, "state", "wrike-tui", "ACC1", "session.json"))
    expect(paths.favorites).toBe(join(root, "state", "wrike-tui", "ACC1", "favorites.json"))
    expect(paths.spaces).toBe(join(root, "cache", "wrike-tui", "ACC1", "spaces.json"))
    expect(paths.tree(spaceId("S1"))).toBe(join(root, "cache", "wrike-tui", "ACC1", "tree-S1.json"))
  })

  test("without XDG variables the usual home directories are used", () => {
    const fallback = persistencePaths({}, "ACC1")
    expect(fallback.config).toEndWith("/.config/wrike-tui/config.json")
    expect(fallback.session).toEndWith("/.local/state/wrike-tui/ACC1/session.json")
    expect(fallback.spaces).toEndWith("/.cache/wrike-tui/ACC1/spaces.json")
  })
})

describe("config", () => {
  test("a missing file is the defaults", async () => {
    expect(await persistence.loadConfig()).toEqual({ value: DEFAULT_SETTINGS, movedAside: null })
  })

  test("a hand-written file may set any part and leaves the rest default", async () => {
    await put(paths.config, { theme: "light", lists: { folder: { group: "assignee", columns: ["title", "due"] } } })
    const { value } = await persistence.loadConfig()
    expect(value).toEqual({ theme: "light", navWidth: 30, completed: false, history: true, lists: { folder: { group: "assignee", columns: ["title", "due"] } } })
    expect(defaultSpec(value, "folder")).toEqual({ ...DEFAULT_SPECS.folder, group: "assignee", columns: ["title", "due"] })
    expect(defaultSpec(value, "space")).toEqual(DEFAULT_SPECS.space)
  })

  test("the completed default reaches every list but search, and a list's own default wins", async () => {
    await put(paths.config, { completed: true, lists: { todo: { completed: false } } })
    const { value } = await persistence.loadConfig()
    expect(defaultSpec(value, "folder").completed).toBe(true)
    expect(defaultSpec(value, "todo").completed).toBe(false)
    expect(defaultSpec({ ...value, completed: false }, "search").completed).toBe(true)
  })

  test.each([
    ["not JSON", "{ theme: dark"],
    ["an unknown theme", JSON.stringify({ theme: "solarized" })],
    ["a nav width out of range", JSON.stringify({ navWidth: 500 })],
    ["an unknown column", JSON.stringify({ lists: { todo: { columns: ["title", "sparkles"] } } })],
  ])("a file with %s is moved aside and the defaults load", async (_what, content) => {
    await put(paths.config, content)
    expect(await persistence.loadConfig()).toEqual({ value: DEFAULT_SETTINGS, movedAside: `${paths.config}.bad` })
    expect(await Bun.file(`${paths.config}.bad`).text()).toBe(content)
    expect(await Bun.file(paths.config).exists()).toBe(false)
    expect(await persistence.loadConfig()).toEqual({ value: DEFAULT_SETTINGS, movedAside: null })
  })

  test("a saved config reads back the same", async () => {
    const settings = { theme: "high-contrast", navWidth: 40, completed: true, history: false, lists: { project: DEFAULT_SPECS.project } } as const
    await persistence.saveConfig(settings)
    expect((await persistence.loadConfig()).value).toEqual(settings)
  })
})

describe("session", () => {
  test("a missing session is null and a saved one reads back the same", async () => {
    expect(await persistence.loadSession()).toEqual({ value: null, movedAside: null })
    await persistence.saveSession(session)
    expect((await persistence.loadSession()).value).toEqual(session)
  })

  test("a session written before a field existed loads with that field's default", async () => {
    await put(paths.session, { version: 1, scope: { kind: "todo" }, views: { todo: { spec: DEFAULT_SPECS.todo } } })
    expect((await persistence.loadSession()).value).toEqual({
      version: 1,
      scope: { kind: "todo" },
      focus: "list",
      zoom: false,
      nav: { cursor: "view:inbox", expanded: [] },
      openTaskId: null,
      includeRead: false,
      views: { todo: { spec: DEFAULT_SPECS.todo, cursor: null, collapsed: [], expanded: [] } },
    })
  })

  test.each([
    ["a newer version", { ...session, version: 2 }],
    ["a scope this version does not know", { ...session, scope: { kind: "dashboard", id: "D1" } }],
    ["a truncated file", '{"version":1,"scope":{"kind":"fol'],
  ])("a session with %s is moved aside and nothing restores", async (_what, content) => {
    await put(paths.session, content)
    expect(await persistence.loadSession()).toEqual({ value: null, movedAside: `${paths.session}.bad` })
    expect(await Bun.file(paths.session).exists()).toBe(false)
  })

  test("a write goes through a temp file and leaves none behind", async () => {
    await persistence.saveSession(session)
    await persistence.saveSession({ ...session, zoom: true })
    expect(await readdir(dirname(paths.session))).toEqual(["session.json"])
  })
})

describe("favorites", () => {
  const favorites: Favorite[] = [
    { kind: "space", id: spaceId("S1"), title: "Engineering" },
    { kind: "folder", id: folderId("F1"), title: "Q4 Launch", project: true },
    { kind: "task", id: taskId("T1"), title: "Enable SSO" },
  ]

  test("none at first, then what was saved, in order", async () => {
    expect((await persistence.loadFavorites()).value).toEqual([])
    await persistence.saveFavorites(favorites)
    expect((await persistence.loadFavorites()).value).toEqual(favorites)
  })

  test("a broken file is moved aside", async () => {
    await put(paths.favorites, { version: 1, favorites: [{ kind: "task" }] })
    expect(await persistence.loadFavorites()).toEqual({ value: [], movedAside: `${paths.favorites}.bad` })
  })

  test("each account keeps its own", async () => {
    await persistence.saveFavorites(favorites)
    const other = createPersistence(persistencePaths({ XDG_STATE_HOME: join(root, "state") }, "ACC2"))
    expect((await other.loadFavorites()).value).toEqual([])
  })
})

describe("cache", () => {
  const spaces: Space[] = [{ id: spaceId("S1"), title: "Engineering", access: "Public" }]
  const nodes: FolderNode[] = [
    { id: folderId("S1"), title: "Engineering", childIds: [folderId("F1")], kind: "space", project: null },
    { id: folderId("F1"), title: "Q4 Launch", childIds: [], kind: "project", project: { statusId: null, ownerIds: [] } },
  ]

  test("spaces and a tree read back with the time they were fetched", async () => {
    expect((await persistence.loadSpaces()).value).toBeNull()
    expect((await persistence.loadTree(spaceId("S1"))).value).toBeNull()
    await persistence.saveSpaces(spaces)
    await persistence.saveTree(spaceId("S1"), new Map(nodes.map((node) => [node.id, node])))
    expect((await persistence.loadSpaces()).value).toEqual({ value: spaces, fetchedAt: "2026-11-12T16:00:00Z" })
    const tree = (await persistence.loadTree(spaceId("S1"))).value!
    expect([...tree.value.values()]).toEqual(nodes)
    expect(tree.fetchedAt).toBe("2026-11-12T16:00:00Z")
  })

  test("a broken cache file is moved aside and reads as nothing cached", async () => {
    await put(paths.tree(spaceId("S1")), "[]")
    expect(await persistence.loadTree(spaceId("S1"))).toEqual({ value: null, movedAside: `${paths.tree(spaceId("S1"))}.bad` })
  })
})
