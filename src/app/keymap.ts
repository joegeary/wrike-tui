import { commandById, COMMANDS, isOffered, type Command, type Context } from "./commands"
import type { KeyOverrides } from "../domain/settings"
import type { Mode, Pane, State } from "./state"

export type KeyBinding = { context: Context; key: string; command: string }

/** A label longer than this is cut off in the legend on an 80-column terminal. */
export const MAX_LABEL = 28

const bind = (context: Context, command: string, ...keys: string[]): KeyBinding[] => keys.map((key) => ({ context, key, command }))

/** The keymap in effect: the defaults with the `keys` of the config applied. It is built once at launch and kept in the state. */
export type Keymap = readonly KeyBinding[]

/** The default keys. Each row binds a key, in a context, to a command of the registry. The config can replace a command's keys. */
export const KEYMAP: Keymap = [
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
  ...bind("list", "list.mark", "M"),
  ...bind("list", "list.clear-marks", "esc"),

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
  ...bind("task", "task.new", "n"),
  ...bind("task", "task.subtask", "N"),
  ...bind("task", "task.delete", "D"),
  ...bind("task", "task.file", "L"),

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

  ...bind("form", "form.next", "enter"),
  ...bind("form", "form.back", "ctrl+b"),
  ...bind("form", "form.down", "down", "ctrl+n"),
  ...bind("form", "form.up", "up", "ctrl+p"),
  ...bind("form", "form.toggle", "space"),
  ...bind("form", "form.browser", "o"),
  ...bind("form", "form.close", "esc"),

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
  form: "Request form",
}

const PANE_CONTEXTS: Record<Pane, Context[]> = {
  nav: ["nav", "global"],
  list: ["list", "task", "global"],
  details: ["details", "task", "global"],
}

const MODE_CONTEXTS: Record<Exclude<Mode["kind"], "browse">, Context[]> = {
  "search-input": ["text"],
  "filter-input": ["text"],
  "edit-text": ["text"],
  "new-task": ["text"],
  compose: ["mention", "compose"],
  confirm: ["confirm"],
  edit: ["edit"],
  picker: ["picker"],
  palette: ["palette"],
  help: ["help"],
  form: ["form"],
}

/** Every set of contexts that are active at once, the most specific first. */
const ACTIVE_TOGETHER: Context[][] = [...Object.values(PANE_CONTEXTS), ...Object.values(MODE_CONTEXTS)]

/** The contexts where a key can also be typed text, so a printable key bound there would stop that character from being typed. */
const TYPING_CONTEXTS: ReadonlySet<Context> = new Set(["picker", "text", "mention", "compose", "palette", "form"])

/** The contexts whose keys work in this state, most specific first. */
export function activeContexts(state: Pick<State, "mode" | "focus">): Context[] {
  return state.mode.kind === "browse" ? browseContexts(state) : MODE_CONTEXTS[state.mode.kind]
}

export function browseContexts(state: Pick<State, "focus">): Context[] {
  return PANE_CONTEXTS[state.focus]
}

/** The command a key runs here, or null. A command whose `when` does not hold leaves its key unbound. */
export function resolveKey(state: State, key: string): Command | null {
  for (const context of activeContexts(state)) {
    for (const binding of state.keymap) {
      if (binding.context !== context || binding.key !== key) continue
      const found = commandById(binding.command)
      if (isOffered(found, state)) return found
    }
  }
  return null
}

export type BoundCommand = { command: Command; keys: string[] }

/** The commands bound in a context, in table order, each with all its keys. */
export function boundCommands(keymap: Keymap, context: Context): BoundCommand[] {
  const bound = new Map<string, BoundCommand>()
  for (const binding of keymap) {
    if (binding.context !== context) continue
    const entry = bound.get(binding.command)
    if (entry) entry.keys.push(binding.key)
    else bound.set(binding.command, { command: commandById(binding.command), keys: [binding.key] })
  }
  return [...bound.values()]
}

/** The keys that run a command in any of these contexts, the most specific context first. */
export function keysFor(keymap: Keymap, command: string, contexts: readonly Context[]): string[] {
  return contexts.flatMap((context) => keymap.filter((binding) => binding.context === context && binding.command === command).map((binding) => binding.key))
}

/** The first key that runs a command in any context, as drawn, or null when no key does. */
export function firstKeyLabel(keymap: Keymap, command: string): string | null {
  const binding = keymap.find((entry) => entry.command === command)
  return binding ? keyLabel(binding.key) : null
}

/** How a sentence tells the user to run a command: "press" and its key, or the palette's key and the command's title when no key runs it. */
export function howToRun(keymap: Keymap, command: string): string {
  const key = firstKeyLabel(keymap, command)
  if (key !== null) return `press ${key}`
  const palette = firstKeyLabel(keymap, "app.palette")
  if (palette !== null) return `press ${palette} and run ${commandById(command).title}`
  return `bind a key to ${command} in config.json`
}

/** The sentence that says how to fetch again after a failure. */
export function retryHint(keymap: Keymap): string {
  const how = howToRun(keymap, "app.refresh")
  return `${how.charAt(0).toUpperCase()}${how.slice(1)} to retry.`
}

const KEY_LABELS: Record<string, string> = {
  enter: "Enter", esc: "Esc", space: "Space", backspace: "Backspace", tab: "Tab", delete: "Del", insert: "Ins",
  home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn", up: "↑", down: "↓", left: "←", right: "→",
}

export function keyLabel(key: string): string {
  if (key.startsWith("ctrl+")) {
    const rest = key.slice("ctrl+".length)
    return `Ctrl+${KEY_LABELS[rest] ?? rest.toUpperCase()}`
  }
  return KEY_LABELS[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : key)
}

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

const ARROWS_AND_EDITING = ["up", "down", "left", "right", "home", "end", "pageup", "pagedown", "insert", "delete"]
const NAMED_KEYS: ReadonlySet<string> = new Set(["enter", "esc", "space", "tab", "backspace", ...ARROWS_AND_EDITING, ...Array.from({ length: 12 }, (_, at) => `f${at + 1}`)])
const KEY_ALIASES: Record<string, string> = { return: "enter", escape: "esc" }
/** What Ctrl reaches as itself. Ctrl+C quits, and Ctrl+H, Ctrl+I, Ctrl+J and Ctrl+M arrive as Backspace, Tab, a new line and Enter. */
const CTRL_KEYS: ReadonlySet<string> = new Set([..."abdefgklnopqrstuvwxyz", "space", ...ARROWS_AND_EDITING])

/**
 * The table's name for a key written in the config: one character such as `G`
 * or `?`, a name such as `enter`, `esc`, `space`, `up` or `f1`, or `ctrl+`
 * and a letter or name. Names take any case. Null for a key the terminal
 * input never reports.
 */
export function parseKey(written: string): string | null {
  if ([...written].length === 1) {
    if (written === " ") return "space"
    return written > " " && written !== "\x7f" ? written : null
  }
  const lower = written.toLowerCase()
  if (lower.startsWith("ctrl+")) {
    const rest = lower.slice("ctrl+".length)
    return CTRL_KEYS.has(rest) ? `ctrl+${rest}` : null
  }
  const name = KEY_ALIASES[lower] ?? lower
  return NAMED_KEYS.has(name) ? name : null
}

const typesText = (key: string) => key === "space" || [...key].length === 1

const isDefault = (row: KeyBinding) => KEYMAP.some((binding) => binding.context === row.context && binding.key === row.key && binding.command === row.command)

export type BuiltKeymap = {
  keymap: Keymap
  /** The commands whose keys the config changed. */
  changed: ReadonlySet<string>
  /** One line per config entry that was dropped, and why. */
  problems: string[]
}

/** Where a command's keys go: the contexts its default keys are in, or for a command with none, the contexts the registry gives it. */
export function overrideContexts(command: string): Context[] {
  const bound = [...new Set(KEYMAP.filter((binding) => binding.command === command).map((binding) => binding.context))]
  return bound.length > 0 ? bound : commandById(command).contexts
}

/** The rows one config entry asks for, or a problem when the entry cannot be used. */
function overrideRows(command: string, value: string | readonly string[]): KeyBinding[] | string {
  if (!COMMANDS.some((entry) => entry.id === command)) return `${command} is not a command`
  const keys: string[] = []
  for (const written of typeof value === "string" ? [value] : value) {
    const key = parseKey(written)
    if (key === null) return `${command}: ${JSON.stringify(written)} is not a key wrike-tui can bind`
    if (!keys.includes(key)) keys.push(key)
  }
  const rows = overrideContexts(command).flatMap((context) => keys.map((key): KeyBinding => ({ context, key, command })))
  const typed = rows.find((row) => TYPING_CONTEXTS.has(row.context) && typesText(row.key) && !isDefault(row))
  if (typed) return `${command}: ${keyLabel(typed.key)} is typed text in ${CONTEXT_TITLES[typed.context]}`
  return rows
}

/** The default table with each overridden command's rows put where its first default row was in each context. */
function applyOverrides(overrides: ReadonlyMap<string, KeyBinding[]>): KeyBinding[] {
  const placed = new Set<string>()
  const rows = KEYMAP.flatMap((binding) => {
    const replacement = overrides.get(binding.command)
    if (!replacement) return [binding]
    const at = `${binding.command} ${binding.context}`
    if (placed.has(at)) return []
    placed.add(at)
    return replacement.filter((row) => row.context === binding.context)
  })
  const unboundByDefault = [...overrides.values()].flat().filter((row) => !KEYMAP.some((binding) => binding.command === row.command))
  return [...rows, ...unboundByDefault]
}

/**
 * The overridden commands whose keys clash: one key for two commands in
 * contexts that are active together, which includes a pane key hiding a
 * global one. Clashes among the default keys themselves are left alone,
 * because those are told apart by each command's `when`.
 */
function clashes(keymap: KeyBinding[], overrides: ReadonlyMap<string, KeyBinding[]>): Map<string, string> {
  const found = new Map<string, string>()
  for (const contexts of ACTIVE_TOGETHER) {
    const rows = contexts.flatMap((context) => keymap.filter((binding) => binding.context === context))
    rows.forEach((row, index) => {
      for (const other of rows.slice(index + 1)) {
        if (other.key !== row.key || other.command === row.command) continue
        const blamed = [other, row].find((each) => overrides.has(each.command) && !isDefault(each))
        if (!blamed || found.has(blamed.command)) continue
        const against = blamed === row ? other : row
        found.set(blamed.command, `${blamed.command}: ${keyLabel(blamed.key)} is already ${against.command}`)
      }
    })
  }
  return found
}

/**
 * The keymap in effect: the defaults with the config's `keys` applied. A
 * listed command's keys replace its defaults in every context it was bound
 * in. An entry that names no command, names a key the terminal never
 * reports, binds a printable key where text is typed, or clashes with
 * another key is dropped, and the command keeps its defaults.
 */
export function buildKeymap(config: KeyOverrides = {}): BuiltKeymap {
  const problems: string[] = []
  const overrides = new Map<string, KeyBinding[]>()
  for (const [command, value] of Object.entries(config)) {
    const rows = overrideRows(command, value)
    if (typeof rows === "string") problems.push(rows)
    else overrides.set(command, rows)
  }
  // Dropping an entry brings its default keys back, and those can clash in turn, so this runs until nothing clashes.
  for (;;) {
    const keymap = applyOverrides(overrides)
    const found = clashes(keymap, overrides)
    if (found.size === 0) return { keymap, changed: new Set(overrides.keys()), problems }
    for (const [command, problem] of found) {
      overrides.delete(command)
      problems.push(problem)
    }
  }
}

/** The one status line that names every dropped `keys` entry. */
export const keyProblemsText = (problems: string[]) => `Ignored in the keys of config.json: ${problems.join("; ")}`
