/**
 * A description, and each list item in it, is a flow of parts: lines of text and
 * block elements (lists, headings, code, tables). Wrike separates them with a
 * run of <br>s, and how many matters: each extra one is a blank line on screen.
 * Markdown spells the same run as newlines, so a blank line in the editor is a
 * blank line in Wrike.
 *
 * | Between        | <br>s | Markdown                                     |
 * | -------------- | ----- | -------------------------------------------- |
 * | text and text  | 1     | a hard break inside one paragraph            |
 * | text and text  | n ≥ 2 | n newlines                                   |
 * | text and block | 0     | one newline                                  |
 * | text and block | 1     | a hard break, then one newline               |
 * | text and block | n ≥ 2 | n newlines                                   |
 * | block and any  | n     | n + 2 newlines                               |
 *
 * A <br> just before a block draws nothing in a browser, so text-and-block with
 * zero or one <br> look alike in Wrike and differ only by the backslash here.
 * A block ends at a blank line, since a line right after a list would join its
 * last item; each blank line after that one is a <br>.
 */
export type Part = "text" | "block"

/**
 * A backslash before the newline, which markdown reads as a <br> like two
 * trailing spaces do. Editors that strip trailing whitespace on save keep it.
 */
export const HARD_BREAK = "\\\n"

/** A line ending in a hard break: an odd number of backslashes, since an even run is escaped backslashes. */
export const ENDS_IN_HARD_BREAK = /(?<!\\)(?:\\\\)*\\\n*$/

export function separator(before: Part, after: Part, breaks: number): string {
  if (before === "text" && after === "block" && breaks < 2) return breaks === 1 ? HARD_BREAK : "\n"
  return "\n".repeat(before === "block" ? breaks + 2 : breaks)
}

export function breaksBetween(before: Part, after: Part, newlines: number, hardBreak: boolean): number {
  if (before === "block") return Math.max(0, newlines - 2)
  if (after === "block" && newlines === 1) return hardBreak ? 1 : 0
  return newlines
}
