import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { NavPath } from "../../src/app/nav"
import { start } from "../../src/app/reducer"
import { currentView, listRows, navCursorRow, selectedTask } from "../../src/app/selectors"
import { loadBoot, movedAsideFlash, restoreSession, sessionOf, sessionSaver, skipsRestore } from "../../src/app/session"
import { initialState, type State } from "../../src/app/state"
import { folderId } from "../../src/domain/ids"
import { DEFAULT_SETTINGS } from "../../src/domain/settings"
import { createPersistence, persistencePaths, type Persistence, type PersistencePaths } from "../../src/persist/persistence"
import { boot, clock, ENG, engTree, inTodo, key, later, loaded, OPS, overdue, play, profile, showing, spaces, tasksLoaded, undated, withTree } from "../support/app"

/** Platform scoped from the tree, grouped by due date, a group closed, the cursor on a task, that task open, the details zoomed. */
function busy(): State {
  const folder = play(showing(withTree(), ["j", "enter"], "folder:A", [later, undated, overdue]), "l").state
  const shaped = play(folder, ":", ..."group by due", "enter", "g", "space", "G").state
  const opened = play(shaped, "enter")
  return play(opened.state, "v").state
}

describe("the session", () => {
  test("holds where the user is, and nothing Wrike said", () => {
    const session = sessionOf(busy())
    expect(session).toMatchObject({
      version: 1,
      scope: { kind: "folder", id: "A", title: "Folder A", project: false },
      focus: "details",
      zoom: true,
      nav: { cursor: "space:ENG/A", expanded: ["space:ENG", "space:ENG/A"] },
      openTaskId: undated.id,
      includeRead: false,
    })
    expect(session.views["folder:A"]).toEqual({
      spec: { ...currentView(busy()).spec, group: "due" },
      cursor: { id: `task:${undated.id}`, index: 4 },
      collapsed: ["due:Overdue"],
      expanded: [],
    })
    expect(JSON.stringify(session)).not.toContain("Undated task")
  })

  test("restores onto a fresh state and survives the trip through JSON", () => {
    const session = JSON.parse(JSON.stringify(sessionOf(busy())))
    const restored = restoreSession(initialState(profile, clock, boot()), session)
    expect(sessionOf(restored)).toEqual(session)
    expect(restored).toMatchObject({ focus: "details", zoom: true, openTaskId: undated.id, mode: { kind: "browse" } })
    expect(restored.lists.size).toBe(0)
  })

  test("a restored search is the last search", () => {
    const searched = showing(loaded(), ["/", { type: "draft", text: "login" } as never, "enter"], "search:login", [later])
    expect(restoreSession(initialState(profile, clock, boot()), sessionOf(searched)).lastSearch).toBe("login")
  })

  test("a zoom without the details focused is not restored", () => {
    const session = { ...sessionOf(busy()), focus: "list" as const }
    expect(restoreSession(initialState(profile, clock, boot()), session).zoom).toBe(false)
  })

  test("starting from a session fetches what it shows, and the cursor and the shaping come back when the list arrives", () => {
    const session = sessionOf(busy())
    const [started, effects] = start(initialState(profile, clock, boot({ session, spaces, trees: new Map([[ENG, engTree]]) })))
    expect(effects).toEqual([
      { kind: "load-reference" },
      { kind: "load-fields", request: 1 },
      { kind: "load-inbox", request: 1, includeRead: false },
      { kind: "load-tasks", request: 1, key: key("todo"), source: { kind: "mine", user: profile.userId }, completed: false, pageToken: null },
      { kind: "load-spaces", request: 1, cached: false },
      { kind: "load-tree", request: 1, space: ENG, cached: false },
      { kind: "load-tasks", request: 1, key: key("folder:A"), source: { kind: "folder", id: folderId("A") }, completed: false, pageToken: null },
      { kind: "load-details", request: 1, target: { kind: "task", id: undated.id } },
      { kind: "check-update" },
    ])
    expect(started).toMatchObject({ focus: "details", zoom: true })
    expect(navCursorRow(started)?.path).toBe("space:ENG/A" as NavPath)
    const { state } = play(started, tasksLoaded("folder:A", 1, [later, undated, overdue]))
    expect(listRows(state).map((row) => (row.kind === "group" ? `# ${row.label}${row.collapsed ? " (closed)" : ""}` : row.kind === "task" ? row.task.title : ""))).toEqual([
      "# Overdue (closed)", "# Later", "Later task", "# No date", "Undated task",
    ])
    expect(selectedTask(state)?.title).toBe("Undated task")
  })

  test("with nothing cached the spaces and an open tree are read from the cache first", () => {
    const session = sessionOf(withTree())
    const [, effects] = start(initialState(profile, clock, boot({ session })))
    expect(effects).toContainEqual({ kind: "load-spaces", request: 1, cached: true })
    expect(effects).toContainEqual({ kind: "load-tree", request: 1, space: ENG, cached: true })
  })

  test("the cache paints the first state, before any answer", () => {
    const state = initialState(profile, clock, boot({ session: sessionOf(withTree()), spaces, trees: new Map([[ENG, engTree]]) }))
    expect(state.spaces).toEqual({ state: "loading", previous: spaces })
    expect(state.trees.get(ENG)).toEqual({ state: "loading", previous: engTree })
    expect(navCursorRow(state)).toMatchObject({ kind: "node", expanded: true, loading: false })
  })
})

describe("what a launch reads from disk", () => {
  let root: string
  let paths: PersistencePaths
  let persistence: Persistence

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wrike-tui-boot-"))
    paths = persistencePaths({ XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, "ACC")
    persistence = createPersistence(paths)
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  async function seed() {
    await persistence.saveSession(sessionOf(withTree()))
    await persistence.saveSpaces(spaces)
    await persistence.saveTree(ENG, engTree)
    await persistence.saveTree(OPS, engTree)
    await persistence.saveFavorites([{ kind: "space", id: ENG, title: "Engineering" }])
  }

  test("nothing on disk is a fresh start", async () => {
    expect(await loadBoot(persistence, { readOnly: false, restore: true })).toEqual({
      settings: DEFAULT_SETTINGS, favorites: [], readOnly: false, session: null, spaces: null, fields: null, trees: new Map(), flash: null,
    })
  })

  test("the session, the favorites, the spaces and only the trees the session has open", async () => {
    await seed()
    const read = await loadBoot(persistence, { readOnly: true, restore: true })
    expect(read.session?.nav.expanded).toEqual(["space:ENG"])
    expect(read.spaces).toEqual(spaces)
    expect([...read.trees.keys()]).toEqual([ENG])
    expect(read.trees.get(ENG)).toEqual(engTree)
    expect(read.favorites).toHaveLength(1)
    expect(read.readOnly).toBe(true)
  })

  test("WRIKE_TUI_NO_RESTORE=1 skips the session and keeps the favorites and the cached spaces", async () => {
    await seed()
    expect(skipsRestore({ WRIKE_TUI_NO_RESTORE: "1" })).toBe(true)
    expect(skipsRestore({})).toBe(false)
    const read = await loadBoot(persistence, { readOnly: false, restore: false })
    expect(read.session).toBeNull()
    expect(read.trees.size).toBe(0)
    expect(read.spaces).toEqual(spaces)
    expect(read.favorites).toHaveLength(1)
    expect(await Bun.file(paths.session).exists()).toBe(true)
  })

  test("every file that could not be read is named once", async () => {
    await seed()
    for (const path of [paths.config, paths.session]) {
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, "{ nope")
    }
    const read = await loadBoot(persistence, { readOnly: false, restore: true })
    expect(read.flash).toEqual({ tone: "error", text: "Could not read config.json, session.json. Kept as config.json.bad, session.json.bad, using the defaults." })
    expect(read.session).toBeNull()
    expect((await loadBoot(persistence, { readOnly: false, restore: true })).flash).toBeNull()
    expect(movedAsideFlash([null, null])).toBeNull()
  })

  test("the session is written only when it changed", async () => {
    let state = loaded()
    const save = sessionSaver(() => state, persistence)
    await save()
    expect(await Bun.file(paths.session).exists()).toBe(false)
    state = inTodo(state)
    await save()
    expect((await persistence.loadSession()).value?.scope).toEqual({ kind: "todo" })
    await rm(paths.session)
    state = play(state, { type: "flash", flash: { tone: "info", text: "not part of the session" } }).state
    await save()
    expect(await Bun.file(paths.session).exists()).toBe(false)
  })
})
