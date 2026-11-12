import { marked, Renderer } from "marked"
import TurndownService from "turndown"

const ROUND_TRIP_TAGS = new Set([
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "s", "a", "ul", "ol", "li",
])

function turndown(escape: boolean): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    codeBlockStyle: "fenced",
  })
  if (!escape) service.escape = (text) => text
  service.addRule("strikethrough", {
    filter: ["s", "del"],
    replacement: (content) => `~~${content}~~`,
  })
  // Turndown's own rule pads the marker to four columns, which is noisy to edit.
  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const parent = node.parentNode as HTMLElement | null
      const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0
      const prefix = parent?.nodeName === "OL" ? `${Number(parent.getAttribute("start") ?? 1) + index}. ` : `${options.bulletListMarker} `
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n(?=.)/g, `\n${" ".repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "")
    },
  })
  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      // domino node lists are array-likes without an iterator.
      const rows = Array.from((node as HTMLElement).querySelectorAll("tr"), (row) =>
        Array.from(row.querySelectorAll("td, th"), (cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " ")),
      )
      const width = Math.max(0, ...rows.map((row) => row.length))
      if (width === 0) return ""
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`
      const [head, ...body] = rows
      return `\n\n${[line(head ?? []), line(Array(width).fill("---")), ...body.map(line)].join("\n")}\n\n`
    },
  })
  return service
}

const markdownService = turndown(true)
const textService = turndown(false)

// Wrike separates paragraphs with two <br> tags, which turndown renders as two hard breaks.
const collapseBreaks = (markdown: string) => markdown.replace(/(?: {2}\n){2,}/g, "\n\n").trim()

export function htmlToMarkdown(html: string): string {
  return collapseBreaks(markdownService.turndown(html))
}

/** For comments, which are shown as plain text, so markdown punctuation is not escaped. */
export function htmlToText(html: string): string {
  return collapseBreaks(textService.turndown(html))
}

class WrikeRenderer extends Renderer {
  // <p> is not in Wrike's description tag list, so paragraphs become its own <br><br> form.
  override paragraph(token: Parameters<Renderer["paragraph"]>[0]): string {
    return `${this.parser.parseInline(token.tokens)}<br /><br />`
  }
  override del(token: Parameters<Renderer["del"]>[0]): string {
    return `<s>${this.parser.parseInline(token.tokens)}</s>`
  }
}

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown.trim(), { async: false, gfm: true, renderer: new WrikeRenderer() })
  return html
    .replace(/\n/g, "")
    .replace(/(?:<br \/>)+(<\/li>|<(?:h[1-6]|ul|ol)>|$)/g, "$1")
}

export type EditableDescription = { format: "markdown" | "html"; text: string }

/**
 * Markdown when every tag survives a round trip through it. Raw HTML otherwise,
 * so a save never strips formatting the user did not touch.
 */
export function editableDescription(html: string): EditableDescription {
  return survivesMarkdown(html)
    ? { format: "markdown", text: htmlToMarkdown(html) }
    : { format: "html", text: html }
}

export function descriptionFromEdit(edited: EditableDescription): string {
  return edited.format === "markdown" ? markdownToHtml(edited.text) : edited.text.trim()
}

function survivesMarkdown(html: string): boolean {
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const tag = match[1]!.toLowerCase()
    if (!ROUND_TRIP_TAGS.has(tag)) return false
    const attributes = [...match[2]!.matchAll(/([a-zA-Z-]+)\s*=/g)].map((attribute) => attribute[1]!.toLowerCase())
    if (attributes.some((name) => !(tag === "a" && (name === "href" || name === "rel" || name === "target")))) return false
  }
  return true
}
