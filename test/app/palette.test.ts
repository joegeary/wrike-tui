import { describe, expect, test } from "bun:test"
import { fuzzyScore, paletteCommands, paletteLines, paletteScope } from "../../src/app/palette"
import type { State } from "../../src/app/state"
import { inTodo, loaded, play, withTree } from "../support/app"

const titles = (state: State, query: string) => paletteCommands(state, query).map((command) => command.title)
const ids = (state: State) => paletteScope(state).map((command) => command.id)

describe("fuzzy matching", () => {
  test("letters must appear in order, whatever the case and spacing", () => {
    expect(fuzzyScore("gbs", "Group by status")).not.toBeNull()
    expect(fuzzyScore("GROUP status", "Group by status")).not.toBeNull()
    expect(fuzzyScore("sbg", "Group by status")).toBeNull()
    expect(fuzzyScore("xyz", "Group by status")).toBeNull()
    expect(fuzzyScore("", "anything")).toBe(0)
  })

  test("a run of letters beats the same letters scattered, and a word start beats the middle of a word", () => {
    expect(fuzzyScore("sort", "Sort by title")!).toBeGreaterThan(fuzzyScore("sort", "Show the Inbox or tasks")!)
    expect(fuzzyScore("st", "Sort by title")!).toBeGreaterThan(fuzzyScore("st", "Assign to me, last")!)
    expect(fuzzyScore("due", "Sort by due date")!).toBeGreaterThan(fuzzyScore("due", "Reduce the queue")!)
  })

  test("an earlier match breaks a tie", () => {
    expect(fuzzyScore("st", "Status change")!).toBeGreaterThan(fuzzyScore("st", "Change status")!)
    expect(fuzzyScore("group", "Group by status")!).toBeGreaterThan(fuzzyScore("group", "Subgroup by status")!)
  })
})

describe("context scoping", () => {
  test("the list pane offers its own commands, the task commands and the global ones", () => {
    const here = ids(inTodo())
    expect(here).toContain("list.group.status")
    expect(here).toContain("task.status")
    expect(here).toContain("app.refresh")
    expect(here).not.toContain("nav.toggle")
    expect(here).not.toContain("details.down")
  })

  test("the nav pane offers the nav commands and the global ones, and no list shaping", () => {
    const here = ids({ ...loaded(), focus: "nav" })
    expect(here).toContain("nav.toggle")
    expect(here).toContain("favorite.toggle")
    expect(here).toContain("theme.light")
    expect(here).not.toContain("list.group.status")
    expect(here).not.toContain("task.status")
  })

  test("the details pane offers scrolling and the task commands", () => {
    const here = ids({ ...inTodo(), focus: "details" })
    expect(here).toContain("details.bottom")
    expect(here).toContain("task.comment")
    expect(here).not.toContain("list.sort.due")
  })

  test("commands of the modes are never listed, nor the palette itself", () => {
    for (const state of [loaded(), inTodo(), { ...loaded(), focus: "nav" as const }]) {
      const here = ids(state)
      for (const id of ["app.palette", "picker.apply", "text.save", "edit.leave", "compose.post", "palette.run", "help.close"]) expect(here).not.toContain(id)
    }
  })

  test("a command whose condition fails is left out", () => {
    expect(ids(loaded())).toContain("inbox.read")
    expect(ids(loaded())).not.toContain("list.group.status")
    expect(ids(inTodo())).not.toContain("inbox.read")
    expect(ids(inTodo())).not.toContain("list.filter.clear")
    expect(ids(play(inTodo(), ":", ..."only my tasks", "enter").state)).toContain("list.filter.clear")
    expect(ids({ ...loaded(), focus: "nav" })).not.toContain("favorite.down")
  })
})

describe("the list of commands", () => {
  test("with nothing typed the commands come grouped under headings, in registry order", () => {
    const lines = paletteLines(inTodo(), "")
    const headings = lines.flatMap((line) => (line.kind === "heading" ? [line.label] : []))
    expect(headings).toEqual(["Navigate", "Task", "List", "View", "Favorites", "Theme", "App"])
    expect(lines[0]).toEqual({ kind: "heading", label: "Navigate" })
    expect(lines[1]).toMatchObject({ kind: "command", index: 0, command: { id: "pane.nav" }, keys: ["1"] })
    const commands = lines.flatMap((line) => (line.kind === "command" ? [line.index] : []))
    expect(commands).toEqual(commands.map((_index, position) => position))
  })

  test("a query ranks flat, best match first, with no headings", () => {
    expect(titles(inTodo(), "group by st")[0]).toBe("Group by status")
    expect(titles(inTodo(), "sort due")[0]).toBe("Sort by due date")
    expect(titles(inTodo(), "light")[0]).toBe("Theme: light")
    expect(paletteLines(inTodo(), "sort").every((line) => line.kind === "command")).toBe(true)
    expect(titles(inTodo(), "zzzz")).toEqual([])
  })

  test("keywords match too, behind a title match of the same strength", () => {
    expect(titles(inTodo(), "priority")).toEqual(["Filter by importance", "Change the importance"])
    expect(titles(inTodo(), "reload")).toEqual(["Refresh"])
    expect(titles(inTodo(), "colors").slice(0, 1)).toEqual(["Theme: terminal colors"])
  })

  test("each command shows the keys that run it where the palette was opened", () => {
    const line = (state: State, id: string) => paletteLines(state, "").find((candidate) => candidate.kind === "command" && candidate.command.id === id)
    expect(line(inTodo(), "list.completed")).toMatchObject({ keys: ["x"] })
    expect(line(inTodo(), "list.down")).toMatchObject({ keys: ["j", "down"] })
    expect(line(inTodo(), "list.group.due")).toMatchObject({ keys: [] })
    expect(line(withTree(), "nav.toggle")).toMatchObject({ keys: ["space"] })
  })
})

describe("the palette in the reducer", () => {
  test(": opens it, typing filters, the arrows move, Backspace erases and Esc closes", () => {
    const open = play(inTodo(), ":").state
    expect(open.mode).toEqual({ kind: "palette", query: "", cursor: 0 })
    const typed = play(open, "s", "o", "r", "t", "down", "down", "ctrl+p").state
    expect(typed.mode).toEqual({ kind: "palette", query: "sort", cursor: 1 })
    expect(play(typed, "backspace").state.mode).toEqual({ kind: "palette", query: "sor", cursor: 0 })
    expect(play(typed, "up", "up", "up").state.mode).toMatchObject({ cursor: 0 })
    expect(play(typed, "esc").state.mode).toEqual({ kind: "browse" })
  })

  test("Enter runs the highlighted command where the palette was opened, and with no match just closes", () => {
    const ran = play(inTodo(), ":", ..."zoom", "enter")
    expect(ran.state).toMatchObject({ mode: { kind: "browse" }, zoom: true })
    const none = play(inTodo(), ":", ..."zzzz", "enter")
    expect(none).toMatchObject({ effects: [], state: { mode: { kind: "browse" } } })
    const task = play(inTodo(), ":", ..."write a comment", "enter")
    expect(task.effects).toMatchObject([{ kind: "load-details" }])
    expect(task.state.afterOpen).toBe("comment")
  })

  test("letters that are keys elsewhere are typed, not run", () => {
    const { state, effects } = play(inTodo(), ":", "q", "r", "i")
    expect(effects).toEqual([])
    expect(state.mode).toEqual({ kind: "palette", query: "qri", cursor: 0 })
  })
})
