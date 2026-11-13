import { BROWSE_CONTEXTS, COMMAND_GROUPS, COMMANDS, isOffered, type Command } from "./commands"
import { browseContexts, keysFor } from "./keymap"
import type { State } from "./state"

/**
 * How well `query` matches `text`, or null when its letters are not all in
 * `text` in order. Letters at the start of a word and letters that follow the
 * previous match score higher, and an earlier first match breaks ties.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, "")
  const hay = text.toLowerCase()
  if (needle === "") return 0
  let score = 0
  let from = 0
  let previous = -2
  for (const letter of needle) {
    const at = bestIndex(hay, letter, from, previous)
    if (at < 0) return null
    score += 1
    if (at === previous + 1) score += 3
    if (at === 0 || /[\s:.,$-]/.test(hay[at - 1]!)) score += 2
    previous = at
    from = at + 1
  }
  return score - hay.indexOf(needle[0]!) / 100
}

/** The next place `letter` matches: right after the previous match when it can, else at a word start, else anywhere. */
function bestIndex(hay: string, letter: string, from: number, previous: number): number {
  if (hay[previous + 1] === letter && previous + 1 >= from) return previous + 1
  for (let at = hay.indexOf(letter, from); at >= 0; at = hay.indexOf(letter, at + 1)) {
    if (at === 0 || hay[at - 1] === " ") return at
  }
  return hay.indexOf(letter, from)
}

/** A command's score for a query: its title, or its keywords at a discount. */
function commandScore(entry: Command, query: string): number | null {
  const title = fuzzyScore(query, entry.title)
  const keyword = Math.max(-1, ...(entry.keywords ?? []).map((word) => fuzzyScore(query, word) ?? -1))
  if (title === null && keyword < 0) return null
  return Math.max(title ?? -1, keyword - 1)
}

/** The commands that apply where the palette was opened: those of the focused pane's contexts, and the global ones. */
export function paletteScope(state: State): Command[] {
  const here = new Set(browseContexts(state))
  return COMMANDS.filter(
    (entry) => entry.id !== "app.palette" && entry.contexts.some((context) => BROWSE_CONTEXTS.has(context) && here.has(context)) && isOffered(entry, state),
  )
}

/** The palette's commands: in registry groups for an empty query, else ranked by the match. */
export function paletteCommands(state: State, query: string): Command[] {
  const scope = paletteScope(state)
  if (query.trim() === "") return COMMAND_GROUPS.flatMap((group) => scope.filter((entry) => entry.group === group))
  return scope
    .flatMap((entry) => {
      const score = commandScore(entry, query)
      return score === null ? [] : [{ entry, score }]
    })
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry)
}

export type PaletteLine = { kind: "heading"; label: string } | { kind: "command"; command: Command; index: number; keys: string[] }

/** The palette as drawn: group headings between the commands when nothing is typed. */
export function paletteLines(state: State, query: string): PaletteLine[] {
  const contexts = browseContexts(state)
  const grouped = query.trim() === ""
  const lines: PaletteLine[] = []
  paletteCommands(state, query).forEach((entry, index, all) => {
    if (grouped && entry.group !== all[index - 1]?.group) lines.push({ kind: "heading", label: entry.group })
    lines.push({ kind: "command", command: entry, index, keys: keysFor(state.keymap, entry.id, contexts) })
  })
  return lines
}
