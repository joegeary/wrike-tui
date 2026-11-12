import type { State } from "./state"

export const TASK_COMMANDS = ["edit", "status", "importance", "assignees", "assign-me", "comment", "description"] as const
export type TaskCommand = (typeof TASK_COMMANDS)[number]

export type Command =
  | TaskCommand
  | "focus-nav" | "focus-list" | "focus-details" | "pane-left" | "pane-right"
  | "view-inbox" | "view-todo" | "search" | "refresh" | "zoom" | "help" | "quit"
  | "nav-down" | "nav-up"
  | "move-down" | "move-up" | "move-top" | "move-bottom" | "open" | "toggle-read"
  | "scroll-down" | "scroll-up" | "scroll-top" | "scroll-bottom"
  | "browser" | "copy-url" | "copy-id"
  | "field-down" | "field-up" | "field-open"
  | "picker-down" | "picker-up" | "picker-toggle" | "picker-erase"
  | "compose-editor" | "submit" | "cancel"

export type Context =
  | "global" | "nav" | "list" | "inbox" | "details" | "task"
  | "edit" | "picker" | "multi-picker" | "text" | "compose" | "help"

export type Binding = {
  /** Normalized key names. The first one is shown in the status bar. */
  keys: string[]
  command: Command
  label: string
  /** A short label. A binding with one is offered in the status bar. */
  hint?: string
}

const bind = (keys: string | string[], command: Command, label: string, hint?: string): Binding => ({
  keys: Array.isArray(keys) ? keys : [keys],
  command,
  label,
  ...(hint ? { hint } : {}),
})

/** The one place a key is given meaning. It drives dispatch, the status bar and the `?` legend. */
export const KEYMAP: Record<Context, { title: string; bindings: Binding[] }> = {
  global: {
    title: "Anywhere",
    bindings: [
      bind("1", "focus-nav", "Focus the navigation pane"),
      bind("2", "focus-list", "Focus the list pane"),
      bind("3", "focus-details", "Focus the details pane"),
      bind(["h", "left"], "pane-left", "Move to the pane on the left"),
      bind(["l", "right"], "pane-right", "Move to the pane on the right"),
      bind("i", "view-inbox", "Show the Inbox"),
      bind("t", "view-todo", "Show My to-do"),
      bind("/", "search", "Search by title, permalink or ID", "search"),
      bind("r", "refresh", "Refresh"),
      bind("v", "zoom", "Zoom the details pane"),
      bind("?", "help", "Show the keys", "keys"),
      bind("q", "quit", "Quit", "quit"),
    ],
  },
  nav: {
    title: "Navigation",
    bindings: [
      bind(["j", "down"], "nav-down", "Next view", "next"),
      bind(["k", "up"], "nav-up", "Previous view", "previous"),
      bind("enter", "focus-list", "Go to the list", "list"),
    ],
  },
  list: {
    title: "List",
    bindings: [
      bind(["j", "down"], "move-down", "Move down"),
      bind(["k", "up"], "move-up", "Move up"),
      bind("g", "move-top", "Jump to the top"),
      bind("G", "move-bottom", "Jump to the bottom"),
      bind("enter", "open", "Open", "open"),
    ],
  },
  inbox: {
    title: "Inbox",
    bindings: [bind("a", "toggle-read", "Show or hide read notifications", "read")],
  },
  details: {
    title: "Details",
    bindings: [
      bind(["j", "down"], "scroll-down", "Scroll down"),
      bind(["k", "up"], "scroll-up", "Scroll up"),
      bind("g", "scroll-top", "Scroll to the top"),
      bind("G", "scroll-bottom", "Scroll to the bottom"),
    ],
  },
  task: {
    title: "Task",
    bindings: [
      bind("e", "edit", "Edit fields", "edit"),
      bind("s", "status", "Change the status", "status"),
      bind("p", "importance", "Change the importance"),
      bind("A", "assignees", "Change the assignees"),
      bind("m", "assign-me", "Assign to me", "mine"),
      bind("c", "comment", "Write a comment", "comment"),
      bind("E", "description", "Edit the description in $EDITOR"),
      bind("o", "browser", "Open in the browser"),
      bind("y", "copy-url", "Copy the URL"),
      bind("Y", "copy-id", "Copy the ID"),
    ],
  },
  edit: {
    title: "Edit mode",
    bindings: [
      bind(["j", "down"], "field-down", "Next field", "next"),
      bind(["k", "up"], "field-up", "Previous field", "previous"),
      bind("enter", "field-open", "Edit the field", "edit"),
      bind("esc", "cancel", "Leave edit mode", "done"),
    ],
  },
  "multi-picker": {
    title: "Assignees",
    bindings: [bind("space", "picker-toggle", "Toggle the person", "toggle")],
  },
  picker: {
    title: "Picker",
    bindings: [
      bind(["down", "ctrl+n"], "picker-down", "Move down"),
      bind(["up", "ctrl+p"], "picker-up", "Move up"),
      bind("backspace", "picker-erase", "Erase the filter"),
      bind("enter", "submit", "Apply", "apply"),
      bind("esc", "cancel", "Cancel", "cancel"),
    ],
  },
  text: {
    title: "Text field",
    bindings: [bind("enter", "submit", "Save", "save"), bind("esc", "cancel", "Discard", "discard")],
  },
  compose: {
    title: "Comment",
    bindings: [
      bind("enter", "submit", "Post the comment", "post"),
      bind("ctrl+e", "compose-editor", "Write it in $EDITOR", "editor"),
      bind("esc", "cancel", "Discard", "discard"),
    ],
  },
  help: {
    title: "Keys",
    bindings: [bind(["esc", "?", "q"], "cancel", "Close", "close")],
  },
}

/** The contexts whose keys work in this state, most specific first. */
export function activeContexts(state: Pick<State, "mode" | "focus" | "view">): Context[] {
  switch (state.mode.kind) {
    case "browse":
      return browseContexts(state)
    case "search-input":
    case "edit-text":
      return ["text"]
    case "compose":
      return ["compose"]
    case "edit":
      return ["edit"]
    case "picker":
      return state.mode.field === "assignees" ? ["multi-picker", "picker"] : ["picker"]
    case "help":
      return ["help"]
  }
}

export function browseContexts(state: Pick<State, "focus" | "view">): Context[] {
  switch (state.focus) {
    case "nav":
      return ["nav", "global"]
    case "list":
      return state.view === "inbox" ? ["list", "inbox", "task", "global"] : ["list", "task", "global"]
    case "details":
      return ["details", "task", "global"]
  }
}

export function resolveKey(state: Pick<State, "mode" | "focus" | "view">, key: string): Command | null {
  for (const context of activeContexts(state)) {
    const binding = KEYMAP[context].bindings.find((candidate) => candidate.keys.includes(key))
    if (binding) return binding.command
  }
  return null
}

const KEY_LABELS: Record<string, string> = {
  enter: "Enter", esc: "Esc", space: "Space", backspace: "Backspace",
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
