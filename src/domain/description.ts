import { Marked, Renderer } from "marked"
import TurndownService from "turndown"

const ROUND_TRIP_TAGS = new Set([
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "s", "a", "ul", "ol", "li", "code", "pre",
])

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    codeBlockStyle: "fenced",
  })
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
  // Wrike writes a code block as a bare <pre>, which turndown would flatten into a paragraph.
  service.addRule("preformatted", {
    filter: "pre",
    replacement: (_content, node) => `\n\n\`\`\`\n${(node.textContent ?? "").replace(/\n$/, "")}\n\`\`\`\n\n`,
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

const markdownService = turndown()

// Wrike separates paragraphs with two <br> tags, which turndown renders as two hard breaks.
const collapseBreaks = (markdown: string) => markdown.replace(/(?: {2}\n){2,}/g, "\n\n").trim()

export function htmlToMarkdown(html: string): string {
  return collapseBreaks(markdownService.turndown(html))
}


class WrikeRenderer extends Renderer {
  // <p> is not in Wrike's description tag list, so paragraphs become its own <br><br> form.
  override paragraph(token: Parameters<Renderer["paragraph"]>[0]): string {
    return `${this.parser.parseInline(token.tokens)}<br /><br />`
  }
  override del(token: Parameters<Renderer["del"]>[0]): string {
    return `<s>${this.parser.parseInline(token.tokens)}</s>`
  }
  override code(token: Parameters<Renderer["code"]>[0]): string {
    return `<pre>${escapeHtml(token.text)}</pre>`
  }
  override br(): string {
    return "<br />"
  }
  // Markdown from htmlToMarkdown never holds markup, so angle brackets are text the user wrote, like `Bearer <token>`.
  override html(token: Parameters<Renderer["html"]>[0]): string {
    return escapeHtml(token.text) + (token.block ? "<br /><br />" : "")
  }
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Only an explicit [text](url) makes a link. A bare URL or <address> stays the text it was in Wrike.
const wrikeMarked = new Marked({ tokenizer: { autolink: () => undefined, url: () => undefined } }).setOptions({
  gfm: true,
  renderer: new WrikeRenderer(),
})

export function markdownToHtml(markdown: string): string {
  const html = wrikeMarked.parse(markdown.trim(), { async: false })
  return html
    .split(/(<pre>[\s\S]*?<\/pre>)/)
    .map((part) => (part.startsWith("<pre>") ? part : part.replace(/\n/g, "")))
    .join("")
    .replace(/(?:<br \/>)+(<\/li>|<(?:h[1-6]|ul|ol|pre)>|$)/g, "$1")
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
  // Markup inside code would come back as literal text.
  for (const match of html.matchAll(/<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (match[2]!.includes("<")) return false
  }
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const tag = match[1]!.toLowerCase()
    if (!ROUND_TRIP_TAGS.has(tag)) return false
    const attributes = [...match[2]!.matchAll(/([a-zA-Z-]+)\s*=/g)].map((attribute) => attribute[1]!.toLowerCase())
    if (attributes.some((name) => !(tag === "a" && (name === "href" || name === "rel" || name === "target")))) return false
  }
  return true
}
