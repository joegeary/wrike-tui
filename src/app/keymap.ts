import { commandById, isOffered, type Command, type Context } from "./commands"
import type { State } from "./state"

export type KeyBinding = { context: Context; key: string; command: string }

/** A label longer than this is cut off in the legend on an 80-column terminal. */
export const MAX_LABEL = 28

const bind = (context: Context, command: string, ...keys: string[]): KeyBinding[] => keys.map((key) => ({ context, key, command }))

/** The one place a key is given meaning. Each row binds a key, in a context, to a command of the registry. */
export const KEYMAP: KeyBinding[] = [
  ...bind("global", "pane.nav", "1"),
  ...bind("global", "pane.list", "2"),
  ...bind("global", "pane.details", "3"),
  ...bind("global", "pane.left", "h", "left"),
  ...bind("global", "pane.right", "l", "right"),
  ...bind("global", "view.inbox", "i"),
  ...bind("global", "view.todo", "t"),
  ...bind("global", "app.search", "/"),
  ...bind("global", "app.palette", ":"),
  ...bind("global", "app.refresh", "r"),
  ...bind("global", "view.zoom", "v"),
  ...bind("global", "view.history", "H"),
  ...bind("global", "app.help", "?"),
  ...bind("global", "app.quit", "q"),

  ...bind("nav", "nav.down", "j", "down"),
  ...bind("nav", "nav.up", "k", "up"),
  ...bind("nav", "nav.open", "enter"),
  ...bind("nav", "nav.toggle", "space"),
  ...bind("nav", "favorite.toggle", "F"),
  ...bind("nav", "favorite.down", "J"),
  ...bind("nav", "favorite.up", "K"),

  ...bind("list", "list.down", "j", "down"),
  ...bind("list", "list.up", "k", "up"),
  ...bind("list", "list.top", "g"),
  ...bind("list", "list.bottom", "G"),
  ...bind("list", "list.open", "enter"),
  ...bind("list", "list.toggle", "space"),
  ...bind("list", "list.completed", "x"),
  ...bind("list", "list.filter.text", "f"),
  ...bind("list", "inbox.read", "a"),

  ...bind("details", "details.down", "j", "down"),
  ...bind("details", "details.up", "k", "up"),
  ...bind("details", "details.top", "g"),
  ...bind("details", "details.bottom", "G"),
  ...bind("details", "details.next", "]"),
  ...bind("details", "details.previous", "["),
  ...bind("details", "details.unselect", "esc"),
  ...bind("details", "details.act", "enter"),
  ...bind("details", "comment.delete", "d"),

  ...bind("task", "task.edit", "e"),
  ...bind("task", "task.status", "s"),
  ...bind("task", "task.importance", "p"),
  ...bind("task", "task.assignees", "A"),
  ...bind("task", "task.assign-me", "m"),
  ...bind("task", "task.comment", "c"),
  ...bind("task", "task.description", "E"),
  ...bind("task", "task.browser", "o"),
  ...bind("task", "task.copy-url", "y"),
  ...bind("task", "task.copy-id", "Y"),
  ...bind("task", "favorite.toggle", "F"),

  ...bind("edit", "edit.down", "j", "down"),
  ...bind("edit", "edit.up", "k", "up"),
  ...bind("edit", "edit.open", "enter"),
  ...bind("edit", "edit.leave", "esc"),

  ...bind("picker", "picker.toggle", "space"),
  ...bind("picker", "picker.down", "down", "ctrl+n"),
  ...bind("picker", "picker.up", "up", "ctrl+p"),
  ...bind("picker", "picker.erase", "backspace"),
  ...bind("picker", "picker.apply", "enter"),
  ...bind("picker", "picker.cancel", "esc"),

  ...bind("text", "text.save", "enter"),
  ...bind("text", "text.discard", "esc"),

  ...bind("mention", "mention.down", "down", "ctrl+n"),
  ...bind("mention", "mention.up", "up", "ctrl+p"),
  ...bind("mention", "mention.pick", "tab", "enter"),
  ...bind("mention", "mention.close", "esc"),

  ...bind("compose", "compose.post", "enter"),
  ...bind("compose", "compose.editor", "ctrl+e"),
  ...bind("compose", "compose.discard", "esc"),

  ...bind("confirm", "confirm.yes", "y"),
  ...bind("confirm", "confirm.no", "n", "esc"),

  ...bind("palette", "palette.down", "down", "ctrl+n"),
  ...bind("palette", "palette.up", "up", "ctrl+p"),
  ...bind("palette", "palette.erase", "backspace"),
  ...bind("palette", "palette.run", "enter"),
  ...bind("palette", "palette.close", "esc"),

  ...bind("help", "help.down", "j", "down"),
  ...bind("help", "help.up", "k", "up"),
  ...bind("help", "help.close", "esc", "?", "q"),
]

export const CONTEXT_TITLES: Record<Context, string> = {
  global: "Anywhere",
  nav: "Navigation",
  list: "List",
  task: "Task",
  details: "Details",
  edit: "Edit mode",
  picker: "Picker",
  text: "Text field",
  mention: "Mention",
  compose: "Comment",
  confirm: "Confirm",
  palette: "Commands",
  help: "Keys",
}

/** The contexts whose keys work in this state, most specific first. */
export function activeContexts(state: Pick<State, "mode" | "focus">): Context[] {
  switch (state.mode.kind) {
    case "browse":
      return browseContexts(state)
    case "search-input":
    case "filter-input":
    case "edit-text":
      return ["text"]
    case "compose":
      return ["mention", "compose"]
    case "confirm-delete":
      return ["confirm"]
    case "edit":
      return ["edit"]
    case "picker":
      return ["picker"]
    case "palette":
      return ["palette"]
    case "help":
      return ["help"]
  }
}

export function browseContexts(state: Pick<State, "focus">): Context[] {
  switch (state.focus) {
    case "nav":
      return ["nav", "global"]
    case "list":
      return ["list", "task", "global"]
    case "details":
      return ["details", "task", "global"]
  }
}

/** The command a key runs here, or null. A command whose `when` does not hold leaves its key unbound. */
export function resolveKey(state: State, key: string): Command | null {
  for (const context of activeContexts(state)) {
    for (const binding of KEYMAP) {
      if (binding.context !== context || binding.key !== key) continue
      const found = commandById(binding.command)
      if (isOffered(found, state)) return found
    }
  }
  return null
}

export type BoundCommand = { command: Command; keys: string[] }

/** The commands bound in a context, in table order, each with all its keys. */
export function boundCommands(context: Context): BoundCommand[] {
  const bound = new Map<string, BoundCommand>()
  for (const binding of KEYMAP) {
    if (binding.context !== context) continue
    const entry = bound.get(binding.command)
    if (entry) entry.keys.push(binding.key)
    else bound.set(binding.command, { command: commandById(binding.command), keys: [binding.key] })
  }
  return [...bound.values()]
}

/** The keys that run a command in any of these contexts, the most specific context first. */
export function keysFor(command: string, contexts: Context[]): string[] {
  return contexts.flatMap((context) => KEYMAP.filter((binding) => binding.context === context && binding.command === command).map((binding) => binding.key))
}

const KEY_LABELS: Record<string, string> = {
  enter: "Enter", esc: "Esc", space: "Space", backspace: "Backspace", tab: "Tab",
  up: "↑", down: "↓", left: "←", right: "→", "ctrl+n": "Ctrl+N", "ctrl+p": "Ctrl+P", "ctrl+e": "Ctrl+E",
}

export const keyLabel = (key: string) => KEY_LABELS[key] ?? key

/** What a key press is called in the table, from the parts of a terminal key event. */
export function normalizeKey(event: { name: string; sequence: string; ctrl: boolean; meta: boolean }): string | null {
  if (event.meta) return null
  if (event.ctrl) return `ctrl+${event.name}`
  if (event.name === "return") return "enter"
  if (event.name === "escape") return "esc"
  if (event.name === "space") return "space"
  // The sequence keeps the case and the symbol, where the name is always the lowercase key.
  if ([...event.sequence].length === 1 && event.sequence >= " " && event.sequence !== "\x7f") return event.sequence
  return event.name || null
}
