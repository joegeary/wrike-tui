import { describe, expect, test } from "bun:test"
import { activeContexts, KEYMAP, normalizeKey, resolveKey, TASK_COMMANDS, type Context } from "../../src/app/keymap"
import { COMMANDS } from "../../src/app/reducer"
import { PANES, VIEWS, type Mode, type State } from "../../src/app/state"

const MODES: Mode[] = [
  { kind: "browse" },
  { kind: "search-input", draft: "" },
  { kind: "edit", field: 0 },
  { kind: "edit-text", field: "title", draft: "", origin: "browse" },
  { kind: "picker", field: "status", query: "", cursor: 0, chosen: [], origin: "browse" },
  { kind: "picker", field: "assignees", query: "", cursor: 0, chosen: [], origin: "browse" },
  { kind: "compose", draft: "" },
  { kind: "help" },
]

const situations: Pick<State, "mode" | "focus" | "view">[] = MODES.flatMap((mode) =>
  PANES.flatMap((focus) => VIEWS.map((view) => ({ mode, focus, view }))),
)
const contexts = Object.keys(KEYMAP) as Context[]

describe("keymap table", () => {
  test("no key is bound twice in one context", () => {
    for (const context of contexts) {
      const keys = KEYMAP[context].bindings.flatMap((binding) => binding.keys)
      expect(keys, context).toEqual([...new Set(keys)])
    }
  })

  test("no key is bound twice among contexts that are active together", () => {
    for (const situation of situations) {
      const keys = activeContexts(situation).flatMap((context) => KEYMAP[context].bindings.flatMap((binding) => binding.keys))
      const twice = keys.filter((key, index) => keys.indexOf(key) !== index)
      expect(twice, JSON.stringify(situation)).toEqual([])
    }
  })

  test("every bound command has a handler and every handler has a key", () => {
    const bound = new Set(contexts.flatMap((context) => KEYMAP[context].bindings.map((binding) => binding.command)))
    expect([...bound].sort() as string[]).toEqual(Object.keys(COMMANDS).sort())
  })

  test("every context is reachable from some state", () => {
    const reachable = new Set(situations.flatMap((situation) => activeContexts(situation)))
    expect([...reachable].sort()).toEqual([...contexts].sort())
  })

  test("every task command is offered wherever a task can be selected", () => {
    const taskCommands = KEYMAP.task.bindings.map((binding) => binding.command)
    for (const command of TASK_COMMANDS) expect(taskCommands).toContain(command)
  })

  test("the most specific context wins and unbound keys resolve to nothing", () => {
    expect(resolveKey({ mode: { kind: "browse" }, focus: "list", view: "inbox" }, "j")).toBe("move-down")
    expect(resolveKey({ mode: { kind: "browse" }, focus: "details", view: "inbox" }, "j")).toBe("scroll-down")
    expect(resolveKey({ mode: { kind: "browse" }, focus: "list", view: "todo" }, "a")).toBeNull()
    expect(resolveKey({ mode: { kind: "help" }, focus: "list", view: "todo" }, "j")).toBeNull()
  })
})

describe("normalizeKey", () => {
  const key = (name: string, sequence: string, ctrl = false) => normalizeKey({ name, sequence, ctrl, meta: false })
  test("letters keep their case and symbols their character", () => {
    expect(key("g", "G")).toBe("G")
    expect(key("j", "j")).toBe("j")
    expect(key("?", "?")).toBe("?")
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
