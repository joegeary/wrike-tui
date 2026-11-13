import { createDocument } from "@mixmark-io/domino"
import { separator, type Part } from "./flow"

const BLOCK_TAGS = new Set(["UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "TABLE", "P", "DIV", "BLOCKQUOTE", "HR"])
const HARD_BREAK = "  \n"

/** Markdown for a description or a comment, in the dialect that markdownToHtml reads back. */
export function htmlToMarkdown(html: string): string {
  const document = createDocument("")
  document.body.innerHTML = html
  return flow(document.body).trim()
}

// domino node lists are array-likes without an iterator.
const childrenOf = (node: Node): Node[] => Array.from(node.childNodes as ArrayLike<Node>)

const isElement = (node: Node): node is Element => node.nodeType === node.ELEMENT_NODE

type TextPart = { part: "text"; lines: string[]; breaks: number }
type BlockPart = { part: "block"; markdown: string; breaks: number; tag: string; alternate: boolean }

/** Text and blocks, joined by the newlines that spell the <br>s between them. */
function flow(parent: Node): string {
  const parts: (TextPart | BlockPart)[] = []
  let breaks = 0
  for (const child of childrenOf(parent)) {
    if (isElement(child) && child.nodeName === "BR") {
      breaks++
      continue
    }
    const last = parts.at(-1)
    if (isElement(child) && BLOCK_TAGS.has(child.nodeName)) {
      // Markdown runs two lists in a row together unless the second one changes its marker.
      const alternate = last?.part === "block" && last.tag === child.nodeName && !last.alternate
      parts.push({ part: "block", markdown: block(child, alternate), breaks, tag: child.nodeName, alternate })
    } else if (last?.part === "text" && breaks < 2) {
      if (breaks === 1) last.lines.push("")
      last.lines[last.lines.length - 1] += inline(child)
    } else {
      parts.push({ part: "text", lines: [inline(child)], breaks })
    }
    breaks = 0
  }
  return parts
    .map((part, index) => {
      const markdown = part.part === "text" ? part.lines.map(keepEdgeSpace).join(HARD_BREAK) : part.markdown
      return (index === 0 ? "" : separator(parts[index - 1]!.part, part.part, part.breaks)) + markdown
    })
    .join("")
}

const SPACE_REFERENCES: Record<string, string> = { " ": "&#32;", "\t": "&#9;", "\u00a0": "&nbsp;" }

/** Markdown drops spaces at the ends of a line or inside emphasis, so the outermost one is written as a character reference. */
const keepEdgeSpace = (markdown: string) => markdown.replace(/^[ \t\u00a0]|[ \t\u00a0]$/g, (space) => SPACE_REFERENCES[space]!)

function block(element: Element, alternate: boolean): string {
  const name = element.nodeName
  if (name === "UL" || name === "OL") return list(element, alternate)
  if (/^H[1-6]$/.test(name)) return `${"#".repeat(Number(name[1]))} ${keepEdgeSpace(inlineChildren(element))}`
  if (name === "PRE") return fenced(element.textContent ?? "")
  if (name === "TABLE") return table(element)
  if (name === "HR") return "---"
  return flow(element)
}

function list(element: Element, alternate: boolean): string {
  const start = Number(element.getAttribute("start") ?? 1)
  const items = childrenOf(element).filter((child) => child.nodeName === "LI")
  return items
    .map((item, index) => {
      const marker = element.nodeName === "OL" ? `${start + index}${alternate ? ")" : "."} ` : alternate ? "* " : "- "
      return marker + indent(flow(item), marker.length)
    })
    .join("\n")
}

const indent = (markdown: string, width: number) => markdown.replace(/\n(?=.)/g, `\n${" ".repeat(width)}`)

function fenced(code: string): string {
  const fence = "`".repeat(Math.max(3, longestRun(code, "`") + 1))
  return `${fence}\n${code.replace(/\n$/, "")}\n${fence}`
}

/** A GFM table. Wrike has no header cells, so its first row is the header. A break in a cell is written <br>. */
function table(element: Element): string {
  const rows = Array.from(element.querySelectorAll("tr") as ArrayLike<Element>, (row) =>
    childrenOf(row)
      .filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH")
      .map((cell) => keepEdgeSpace(childrenOf(cell).map((child) => (child.nodeName === "BR" ? "<br>" : inline(child))).join("")).replace(/\|/g, "\\|")),
  )
  const width = Math.max(0, ...rows.map((row) => row.length))
  if (width === 0) return ""
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`
  const [head, ...body] = rows
  return [line(head!), line(Array(width).fill("---")), ...body.map(line)].join("\n")
}

const inlineChildren = (element: Element) => childrenOf(element).map(inline).join("")

function inline(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return escapeText(node.nodeValue ?? "")
  if (!isElement(node)) return ""
  switch (node.nodeName) {
    case "B":
      return wrap("**", inlineChildren(node))
    case "STRONG":
      return wrap("__", inlineChildren(node))
    case "I":
      return wrap("*", inlineChildren(node))
    case "EM":
      return wrap("_", inlineChildren(node))
    case "S":
    case "DEL":
      return wrap("~~", inlineChildren(node))
    case "CODE":
      return codeSpan(node.textContent ?? "")
    case "A":
      return `[${inlineChildren(node)}](${destination(node.getAttribute("href") ?? "")})`
    case "INPUT":
      // A checklist item: the checkbox opens its label, which reads as a task list item.
      return node.hasAttribute("checked") ? "[x] " : "[ ] "
    case "IMG":
      return `![${escapeText(node.getAttribute("alt") ?? "")}](${destination(node.getAttribute("src") ?? "")})`
    case "BR":
      return HARD_BREAK
    default:
      return inlineChildren(node)
  }
}

const wrap = (delimiter: string, content: string) => (content ? `${delimiter}${keepEdgeSpace(content)}${delimiter}` : "")

function codeSpan(code: string): string {
  const ticks = "`".repeat(longestRun(code, "`") + 1)
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : ""
  return `${ticks}${pad}${code}${pad}${ticks}`
}

function longestRun(text: string, character: string): number {
  return Math.max(0, ...Array.from(text.matchAll(new RegExp(`\\${character}+`, "g")), (match) => match[0].length))
}

function destination(url: string): string {
  const escaped = url.replace(/([<>()])/g, "\\$1")
  return escaped.includes(" ") ? `<${escaped}>` : escaped
}

// Anything markdown would read as markup stays text. Anchored rules apply at the start of each line.
const ESCAPES: [RegExp, string][] = [
  [/\\/g, "\\\\"],
  [/([*_`~[\]])/g, "\\$1"],
  [/&(?=#?\w+;)/g, "\\&"],
  [/^([-+>]|#{1,6} |=+)/gm, "\\$1"],
  [/^(\d+)([.)]) /gm, "$1\\$2 "],
]

const escapeText = (text: string) => ESCAPES.reduce((escaped, [pattern, replacement]) => escaped.replace(pattern, replacement), text)
