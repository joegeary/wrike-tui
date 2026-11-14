import { createDocument } from "@mixmark-io/domino"
import { Lexer, type Token } from "marked"
import { htmlToMarkdown } from "./markdown"

/**
 * Markdown for reading in the details pane. The editor's dialect spells every
 * style so a save keeps it; on screen those spellings are noise, so this drops
 * what a terminal cannot show (colors, highlights, underline, a link's rel),
 * draws checklist boxes as ☐ and ☑, marks an image as (image), and shows at
 * most one blank line in a row.
 */
export function displayMarkdown(html: string): string {
  const document = createDocument("")
  document.body.innerHTML = html
  const all = (selector: string) => Array.from(document.body.querySelectorAll(selector) as ArrayLike<Element>)
  for (const element of all("span, u")) unwrap(element)
  for (const link of all("a[rel]")) link.removeAttribute("rel")
  for (const box of all('input[type="checkbox"]')) box.parentNode!.replaceChild(document.createTextNode(box.hasAttribute("checked") ? "☑ " : "☐ "), box)
  for (const image of all("img")) image.parentNode!.replaceChild(document.createTextNode("(image)"), image)
  for (const lineBreak of all("td br, th br")) lineBreak.parentNode!.replaceChild(document.createTextNode(" "), lineBreak)
  return htmlToMarkdown(document.body.innerHTML)
    .split(/(^```[\s\S]*?^```)/m)
    .map((part) => (part.startsWith("```") ? part : plain(part)))
    .join("")
}

const SPACES: Record<string, string> = { "&#32;": " ", "&#9;": "\t", "&nbsp;": "\u00a0" }

/**
 * The pane shows character references and backslash escapes as typed, so spaces come back as
 * themselves, a hard break is spelled with two spaces instead of a backslash, and the escapes
 * the editor adds for ==, ++ and { go, since plain markdown reads those as text already.
 */
const plain = (markdown: string) =>
  markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<!\\)((?:\\\\)*)\\\n/g, "$1  \n")
    .replace(/(?<!\\)(&#32;|&#9;|&nbsp;)/g, (space) => SPACES[space]!)
    .replace(/(?<!\\)\\(==|\+\+|\{)/g, "$1")

function unwrap(element: Element) {
  const parent = element.parentNode!
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

/**
 * A description split for drawing: each top-level paragraph on its own, so
 * the pane can wrap it, and the lists, tables, headings and code around them
 * as markdown. A gap is that many blank lines.
 */
export type DisplayBlock = { kind: "paragraph"; tokens: Token[] } | { kind: "markdown"; markdown: string } | { kind: "gap"; lines: number }

/** Blocks the markdown renderer draws on their own, with a blank line on each side. */
const SEPARATE = new Set(["code", "table", "blockquote", "hr"])

/**
 * Splits display markdown into blocks that draw the same lines OpenTUI's
 * markdown renderer drew for the whole: a table, code block, quote or rule
 * alone with a blank line on each side, and the rest line for line as it is
 * written, blank lines included, except that blank lines at the start are
 * dropped and those at the end of a run count as one.
 */
export function displayBlocks(markdown: string): DisplayBlock[] {
  const tokens = new Lexer({ gfm: true }).lex(markdown)
  const units: ({ separate: Token } | { run: Token[] })[] = []
  let run: Token[] = []
  const flush = () => {
    if (run.length > 0) units.push({ run })
    run = []
  }
  tokens.forEach((token, index) => {
    if (token.type === "space") {
      const next = tokens.slice(index + 1).find((later) => later.type !== "space")
      if (run.length > 0 && next && !SEPARATE.has(next.type)) run.push(token)
    } else if (SEPARATE.has(token.type)) {
      flush()
      units.push({ separate: token })
    } else run.push(token)
  })
  flush()

  const blocks: DisplayBlock[] = []
  const gap = (lines: number) => {
    const last = blocks.at(-1)
    if (lines <= 0 || !last) return
    if (last.kind === "gap") last.lines += lines
    else blocks.push({ kind: "gap", lines })
  }
  units.forEach((unit, index) => {
    if ("separate" in unit) {
      if (blocks.at(-1)?.kind !== "gap") gap(1)
      blocks.push({ kind: "markdown", markdown: unit.separate.raw.replace(/(?:\r?\n)+$/, "") })
      if (index < units.length - 1) gap(1)
      return
    }
    let offset = 0
    const owners = unit.run.map((token) => {
      const owner = { token, start: offset }
      offset += token.raw.length
      return owner
    })
    const raw = unit.run.map((token) => token.raw).join("").replace(/(?:\r?\n){2,}$/, "\n")
    let start = 0
    let blank = 0
    let paragraph: Token | null = null
    for (const text of raw.split("\n")) {
      const owner = owners.findLast((candidate) => candidate.start <= start)!.token
      start += text.length + 1
      if (text.trim() === "") {
        blank += 1
        paragraph = null
        continue
      }
      const last = blocks.at(-1)
      if (owner.type === "paragraph") {
        if (owner !== paragraph) {
          gap(blank)
          blocks.push({ kind: "paragraph", tokens: "tokens" in owner && owner.tokens ? owner.tokens : [] })
        }
        paragraph = owner
      } else if (last?.kind === "markdown" && paragraph === null) {
        last.markdown += "\n".repeat(blank + 1) + text
      } else {
        gap(blank)
        blocks.push({ kind: "markdown", markdown: text })
        paragraph = null
      }
      blank = 0
    }
    gap(blank)
  })
  return blocks
}
