import { Lexer, Marked, Parser, Renderer, type Token, type Tokens } from "marked"
import { breaksBetween, type Part } from "./flow"

class WrikeRenderer extends Renderer {
  // Wrike stores <b> and <strong> alike, so each keeps its own delimiter: ** and *, or __ and _.
  override strong(token: Tokens.Strong): string {
    return tag(token.raw.startsWith("__") ? "strong" : "b", this.parser.parseInline(token.tokens))
  }
  override em(token: Tokens.Em): string {
    return tag(token.raw.startsWith("_") ? "em" : "i", this.parser.parseInline(token.tokens))
  }
  override del(token: Tokens.Del): string {
    return tag("s", this.parser.parseInline(token.tokens))
  }
  // listItem writes the checkbox inside the item's label.
  override checkbox(): string {
    return ""
  }
  override br(): string {
    return "<br />"
  }
  // Markdown from htmlToMarkdown never holds markup, so angle brackets are text the user wrote, like `Bearer <token>`.
  override html(token: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(token.text)
  }
}

const tag = (name: string, content: string) => `<${name}>${content}</${name}>`

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Only an explicit [text](url) makes a link. A bare URL or <address> stays the text it was in Wrike.
const wrikeMarked = new Marked({ tokenizer: { autolink: () => undefined, url: () => undefined } }).setOptions({
  gfm: true,
  renderer: new WrikeRenderer(),
})

/** The HTML Wrike stores for markdown written in the dialect htmlToMarkdown writes. */
export function markdownToHtml(markdown: string): string {
  return flow(wrikeMarked.lexer(markdown.trim()))
}

const parser = new Parser(wrikeMarked.defaults)
const inline = (tokens: Token[]) => parser.parseInline(tokens)

const HARD_BREAK = / {2,}\n*$/

const trailingNewlines = (raw: string) => raw.length - raw.replace(/\n+$/, "").length

/**
 * The blocks of a document or a list item, with the <br>s the newlines between them spell.
 * `opening` wraps the first part, which is how a checklist item puts its text in a label.
 */
function flow(tokens: Token[], opening = (html: string) => html): string {
  let html = ""
  let previous: { part: Part; hardBreak: boolean } | null = null
  let newlines = 0
  for (const token of tokens) {
    if (token.type === "space") {
      newlines += trailingNewlines(token.raw)
      continue
    }
    const part: Part = token.type === "paragraph" || token.type === "text" || token.type === "html" ? "text" : "block"
    if (previous) html += "<br />".repeat(Math.max(0, breaksBetween(previous.part, part, newlines, previous.hardBreak)))
    html += previous ? render(token) : opening(render(token))
    previous = { part, hardBreak: HARD_BREAK.test(token.raw) }
    newlines = trailingNewlines(token.raw)
  }
  return html
}

function render(token: Token): string {
  switch (token.type) {
    case "paragraph":
    case "text":
      if (!token.tokens) return escapeHtml(token.text)
      // A hard break at the end of a paragraph is the <br> before the block that follows, which flow writes.
      return inline(HARD_BREAK.test(token.raw) ? Lexer.lexInline(token.text.replace(/ +$/, ""), wrikeMarked.defaults) : token.tokens)
    case "html":
      return escapeHtml(token.text.replace(/\n+$/, ""))
    case "heading":
      return tag(`h${token.depth}`, inline(token.tokens!))
    case "code":
      return tag("pre", escapeHtml(token.text))
    case "list": {
      const { items, ordered } = token as Tokens.List
      const html = items.map(listItem).join("")
      if (items.some((item) => item.task)) return `<ul class="checklist" style="list-style-type: none;">${html}</ul>`
      if (!ordered) return tag("ul", html)
      return token.start === 1 ? tag("ol", html) : `<ol start="${token.start}">${html}</ol>`
    }
    default:
      return parser.parse([token]).replace(/\n/g, "")
  }
}

/** A task list item is a Wrike checklist item: a checkbox and the item's text inside a label. */
function listItem(item: Tokens.ListItem): string {
  if (!item.task) return tag("li", flow(item.tokens))
  const checkbox = `<input type="checkbox"${item.checked ? ' checked="checked"' : ""} />`
  const content = item.tokens.filter((token) => token.type !== "checkbox")
  return tag("li", content.length === 0 ? tag("label", checkbox) : flow(content, (first) => tag("label", checkbox + first)))
}
