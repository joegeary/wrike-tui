import { describe, expect, test } from "bun:test"
import { BROWSE_CONTEXTS, COMMAND_GROUPS, commandById, COMMANDS, isOffered, type Context } from "../../src/app/commands"
import { activeContexts, boundCommands, CONTEXT_TITLES, KEYMAP, keysFor, MAX_LABEL, normalizeKey, resolveKey } from "../../src/app/keymap"
import { reduce } from "../../src/app/reducer"
import { PANES, type Mode, type State } from "../../src/app/state"
import { commentId } from "../../src/domain/ids"
import { inTodo, loaded, play, withTree } from "../support/app"

const MODES: Mode[] = [
  { kind: "browse" },
  { kind: "search-input", draft: "" },
  { kind: "filter-input", draft: "" },
  { kind: "edit", field: 0 },
  { kind: "edit-text", field: "title", draft: "", origin: "browse" },
  { kind: "picker", field: "status", query: "", cursor: 0, chosen: [], origin: "browse" },
  { kind: "picker", field: "assignees", query: "", cursor: 0, chosen: [], origin: "browse" },
  { kind: "compose", draft: "", editing: null, mentions: [], pick: 0, dismissed: null },
  { kind: "compose", draft: "Thanks @pa", editing: null, mentions: [], pick: 0, dismissed: null },
  { kind: "confirm-delete", id: commentId("C1") },
  { kind: "palette", query: "", cursor: 0 },
  { kind: "help" },
]

/** Every mode in every pane, in the Inbox, in My to-do, and in the nav pane on a favorite. */
const bases: State[] = [loaded(), inTodo(), play(loaded({ favorites: [{ kind: "task", id: "T1" as never, title: "Fav" }] }), "1", "j", "j", "j").state, withTree()]
const situations: State[] = bases.flatMap((base) => MODES.flatMap((mode) => PANES.map((focus) => ({ ...base, mode, focus }))))
const contexts = Object.keys(CONTEXT_TITLES) as Context[]
const ids = COMMANDS.map((command) => command.id)

describe("the command registry and the keymap", () => {
  test("every command ID is unique", () => {
    expect(ids).toEqual([...new Set(ids)])
  })

  test("every binding names a registered command, in a context that command has", () => {
    for (const binding of KEYMAP) {
      expect(ids, binding.command).toContain(binding.command)
      expect(commandById(binding.command).contexts, `${binding.key} in ${binding.context}`).toContain(binding.context)
    }
  })

  test("no key is bound twice in one context", () => {
    for (const context of contexts) {
      const keys = KEYMAP.filter((binding) => binding.context === context).map((binding) => binding.key)
      expect(keys, context).toEqual([...new Set(keys)])
    }
  })

  test("no key runs two commands among contexts that are active together", () => {
    for (const situation of situations) {
      const offered = activeContexts(situation).flatMap((context) =>
        KEYMAP.filter((binding) => binding.context === context && isOffered(commandById(binding.command), situation)).map((binding) => binding.key),
      )
      const twice = offered.filter((key, index) => offered.indexOf(key) !== index)
      expect(twice, `${situation.mode.kind} in ${situation.focus}`).toEqual([])
    }
  })

  test("every command is reachable from a key or from the palette", () => {
    const bound = new Set(KEYMAP.map((binding) => binding.command))
    const unreachable = COMMANDS.filter((command) => !bound.has(command.id) && !command.contexts.some((context) => BROWSE_CONTEXTS.has(context)))
    expect(unreachable.map((command) => command.id)).toEqual([])
  })

  test("every command's intent is one the reducer handles", () => {
    for (const situation of bases) {
      for (const command of COMMANDS) expect(() => reduce(situation, command.run(situation)), command.id).not.toThrow()
    }
  })

  test("every command belongs to a known group and every context has a title", () => {
    for (const command of COMMANDS) expect(COMMAND_GROUPS, command.id).toContain(command.group)
    expect(contexts.sort()).toEqual([...new Set(COMMANDS.flatMap((command) => command.contexts))].sort())
  })

  test("every context is reachable from some state", () => {
    const reachable = new Set(situations.flatMap((situation) => activeContexts(situation)))
    expect([...reachable].sort()).toEqual([...contexts].sort())
  })

  test("every title of a bound command fits the legend on an 80-column terminal", () => {
    const long = KEYMAP.map((binding) => commandById(binding.command).title).filter((title) => title.length > MAX_LABEL)
    expect(long).toEqual([])
  })

  test("the legend lists each command once with all its keys, in table order", () => {
    expect(boundCommands("list").slice(0, 2).map(({ command, keys }) => `${keys.join(" ")} ${command.id}`)).toEqual(["j down list.down", "k up list.up"])
    expect(keysFor("favorite.toggle", ["list", "task", "global"])).toEqual(["F"])
    expect(keysFor("list.group.status", ["list", "task", "global"])).toEqual([])
  })

  test("the most specific context wins, and a command whose condition fails leaves its key unbound", () => {
    const state = loaded()
    expect(resolveKey(state, "j")?.id).toBe("list.down")
    expect(resolveKey({ ...state, focus: "details" }, "j")?.id).toBe("details.down")
    expect(resolveKey({ ...state, focus: "nav" }, "j")?.id).toBe("nav.down")
    expect(resolveKey(state, "a")?.id).toBe("inbox.read")
    expect(resolveKey(inTodo(), "a")).toBeNull()
    expect(resolveKey(state, "x")).toBeNull()
    expect(resolveKey(inTodo(), "x")?.id).toBe("list.completed")
    expect(resolveKey({ ...state, focus: "nav" }, "J")).toBeNull()
    expect(resolveKey({ ...state, mode: { kind: "help" } }, "i")).toBeNull()
    expect(resolveKey({ ...state, mode: { kind: "picker", field: "status", query: "", cursor: 0, chosen: [], origin: "browse" } }, "space")).toBeNull()
    expect(resolveKey({ ...state, mode: { kind: "picker", field: "columns", query: "", cursor: 0, chosen: [], origin: "browse" } }, "space")?.id).toBe("picker.toggle")
  })
})

describe("normalizeKey", () => {
  const key = (name: string, sequence: string, ctrl = false) => normalizeKey({ name, sequence, ctrl, meta: false })
  test("letters keep their case and symbols their character", () => {
    expect(key("g", "G")).toBe("G")
    expect(key("j", "j")).toBe("j")
    expect(key("?", "?")).toBe("?")
    expect(key(":", ":")).toBe(":")
  })
  test("named keys use the table's names", () => {
    expect(key("return", "\r")).toBe("enter")
    expect(key("escape", "\u001b")).toBe("esc")
    expect(key("space", " ")).toBe("space")
    expect(key("backspace", "\b")).toBe("backspace")
    expect(key("backspace", "\x7f")).toBe("backspace")
    expect(key("down", "\u001b[B")).toBe("down")
    expect(key("n", "\u000e", true)).toBe("ctrl+n")
  })
})
