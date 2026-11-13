import { Lexer, Marked, Parser, Renderer, type Token, type TokenizerAndRendererExtension, type Tokens } from "marked"
import { breaksBetween, ENDS_IN_HARD_BREAK, type Part } from "./flow"

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
  // Written by hand so the href goes back exactly as written, without the URL encoding marked's own renderer applies.
  override link(token: Tokens.Link): string {
    const { rel } = token as LinkWithRel
    const relAttribute = rel ? ` rel="${escapeAttribute(rel)}"` : ""
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : ""
    return `<a href="${escapeAttribute(token.href)}"${title}${relAttribute}>${this.parser.parseInline(token.tokens)}</a>`
  }
  // Wrike stores an image as a bare <img src>, so the URL goes back exactly as written.
  override image(token: Tokens.Image): string {
    const alt = token.text ? ` alt="${escapeAttribute(token.text)}"` : ""
    return `<img src="${escapeAttribute(token.href)}"${alt} />`
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
const escapeAttribute = (text: string) => escapeHtml(text).replace(/"/g, "&quot;")

/** The highlight a bare ==text== takes: the one Wrike descriptions use most. */
const DEFAULT_HIGHLIGHT = "#F8BBD0"

const HEX = "#[0-9a-fA-F]{3,8}"

const WORD = /[\p{L}\p{N}]/u

/**
 * Like markdown's `_`, highlight and underline only open where no word runs
 * into them, and only close before something that is not a word, so `a==b==c`
 * and `i++; j++` stay the text they were typed as. The tokens read so far in
 * this run of inline text end with the character before the delimiter.
 */
const openable = (tokens: Token[]) => !WORD.test([...(tokens.at(-1)?.raw ?? "")].at(-1) ?? "")
const CLOSED = "(?![\\p{L}\\p{N}])"

/** Inline syntax markdown lacks, for Wrike's text color, highlight and underline. */
const WRIKE_INLINE: TokenizerAndRendererExtension[] = [
  {
    name: "color",
    level: "inline",
    start: (src) => src.indexOf("{color:"),
    // Wrike colors parts of words, so a color may touch a word; a space just inside either tag keeps it text.
    tokenizer(src) {
      const match = new RegExp(`^\\{color:(${HEX})\\}(?=\\S)([\\s\\S]*?\\S)\\{color\\}`).exec(src)
      if (match) return { type: "color", raw: match[0], color: match[1], tokens: this.lexer.inlineTokens(match[2]!) }
    },
    renderer(token) {
      return `<span style="color: ${token.color};">${this.parser.parseInline(token.tokens!)}</span>`
    },
  },
  {
    name: "highlight",
    level: "inline",
    start: (src) => src.indexOf("=="),
    tokenizer(src, tokens) {
      const match = openable(tokens) && new RegExp(`^==(?:\\{(${HEX})\\})?(?=\\S)([\\s\\S]*?\\S)==${CLOSED}`, "u").exec(src)
      if (match) return { type: "highlight", raw: match[0], color: match[1] ?? DEFAULT_HIGHLIGHT, tokens: this.lexer.inlineTokens(match[2]!) }
    },
    renderer(token) {
      return `<span style="background-color: ${token.color};">${this.parser.parseInline(token.tokens!)}</span>`
    },
  },
  {
    name: "underline",
    level: "inline",
    start: (src) => src.indexOf("++"),
    tokenizer(src, tokens) {
      const match = openable(tokens) && new RegExp(`^\\+\\+(?=\\S)([\\s\\S]*?\\S)\\+\\+${CLOSED}`, "u").exec(src)
      if (match) return { type: "underline", raw: match[0], tokens: this.lexer.inlineTokens(match[1]!) }
    },
    renderer(token) {
      return tag("u", this.parser.parseInline(token.tokens!))
    },
  },
]

type LinkWithRel = Tokens.Link & { rel?: string }

const REL = /^\{rel=([\w-]+)\}/

/** A link's rel, which Wrike keeps on pasted links, follows the link as {rel=value}. */
function attachRel(tokens: Token[]): Token[] {
  wrikeMarked.walkTokens(tokens, (token) => {
    if (token.type === "table") for (const cell of [...token.header, ...token.rows.flat()]) attachRelAmong(cell.tokens)
    else if ("tokens" in token && token.tokens) attachRelAmong(token.tokens)
  })
  attachRelAmong(tokens)
  return tokens
}

function attachRelAmong(tokens: Token[]) {
  tokens.forEach((link, index) => {
    const next = tokens[index + 1]
    const match = next?.type === "text" ? REL.exec(next.raw) : null
    if (link.type !== "link" || !match) return
    ;(link as LinkWithRel).rel = match[1]
    next!.raw = next!.raw.slice(match[0].length)
    ;(next as Tokens.Text).text = (next as Tokens.Text).text.slice(match[0].length)
  })
}

// Only an explicit [text](url) makes a link. A bare URL or <address> stays the text it was in Wrike.
const wrikeMarked = new Marked({ tokenizer: { autolink: () => undefined, url: () => undefined }, extensions: WRIKE_INLINE }).setOptions({
  gfm: true,
  renderer: new WrikeRenderer(),
})

/** The HTML Wrike stores for markdown written in the dialect htmlToMarkdown writes. */
export function markdownToHtml(markdown: string): string {
  return flow(attachRel(wrikeMarked.lexer(markdown.trim())), 0)
}

const parser = new Parser(wrikeMarked.defaults)
const inline = (tokens: Token[]) => parser.parseInline(tokens)

/** A paragraph that ends in a hard break, spelled with a backslash or, as a person may type it, two spaces. */
const endsInHardBreak = (raw: string) => ENDS_IN_HARD_BREAK.test(raw) || / {2,}\n*$/.test(raw)
const withoutHardBreak = (text: string) => (/ $/.test(text) ? text.replace(/ +$/, "") : text.slice(0, -1))

const trailingNewlines = (raw: string) => raw.length - raw.replace(/\n+$/, "").length

/**
 * The blocks of a document or a list item, with the <br>s the newlines between them spell.
 * `bullets` counts the bullet lists around them. `opening` wraps the first part, which is
 * how a checklist item puts its text in a label.
 */
function flow(tokens: Token[], bullets: number, opening = (html: string) => html): string {
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
    html += previous ? render(token, bullets) : opening(render(token, bullets))
    previous = { part, hardBreak: endsInHardBreak(token.raw) }
    newlines = trailingNewlines(token.raw)
  }
  return html
}

function render(token: Token, bullets: number): string {
  switch (token.type) {
    case "paragraph":
    case "text":
      if (!token.tokens) return escapeHtml(token.text)
      // A hard break at the end of a paragraph is the <br> before the block that follows, which flow writes.
      return inline(endsInHardBreak(token.raw) ? attachRel(Lexer.lexInline(withoutHardBreak(token.text), wrikeMarked.defaults)) : token.tokens)
    case "html":
      return escapeHtml(token.text.replace(/\n+$/, ""))
    case "heading":
      return tag(`h${token.depth}`, inline(token.tokens!))
    case "code":
      return tag("pre", escapeHtml(token.text))
    case "list": {
      const { items, ordered } = token as Tokens.List
      const html = items.map((item) => listItem(item, ordered ? bullets : bullets + 1)).join("")
      if (items.some((item) => item.task)) return `<ul class="checklist" style="list-style-type: none;">${html}</ul>`
      if (ordered) return token.start === 1 ? tag("ol", html) : `<ol start="${token.start}">${html}</ol>`
      const style = NESTED_BULLETS[bullets]
      return style ? `<ul style="list-style-type: ${style};">${html}</ul>` : tag("ul", html)
    }
    case "table": {
      const { header, rows } = token as Tokens.Table
      const row = (cells: Tokens.TableCell[]) => tag("tr", cells.map((cell) => tag("td", tableCell(cell.tokens))).join(""))
      return tag("table", [header, ...rows].map(row).join(""))
    }
    default:
      return parser.parse([token]).replace(/\n/g, "")
  }
}

/** A table cell has no lines, so a <br> written in one is the break Wrike keeps there. */
const tableCell = (tokens: Token[]) =>
  tokens.map((token) => (token.type === "html" && /^<br\s*\/?>$/i.test(token.raw) ? "<br />" : inline([token]))).join("")

/** Wrike's editor marks a bullet list inside another by how deep it sits: circles, then squares. */
const NESTED_BULLETS: (string | undefined)[] = [undefined, "circle", "square"]

/** A task list item is a Wrike checklist item: a checkbox and the item's text inside a label. */
function listItem(item: Tokens.ListItem, bullets: number): string {
  if (!item.task) return tag("li", flow(item.tokens, bullets))
  const checkbox = `<input type="checkbox"${item.checked ? ' checked="checked"' : ""} />`
  const content = item.tokens.filter((token) => token.type !== "checkbox")
  return tag("li", content.length === 0 ? tag("label", checkbox) : flow(content, bullets, (first) => tag("label", checkbox + first)))
}
