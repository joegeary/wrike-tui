import { createDocument } from "@mixmark-io/domino"

const BLOCK_TAGS = new Set(["UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "TABLE", "TR", "P", "DIV", "BLOCKQUOTE", "HR"])
const CELL_TAGS = new Set(["TD", "TH"])
/** The start of a line, or of a list item's line, where a block needs no break of its own. */
const LINE_START = /(?:^|\n)(?: *• )?$/

/** A description as plain text: a line per paragraph, "• " before each list item, indented two spaces a level, and no markup. */
export function htmlToText(html: string): string {
  const document = createDocument("")
  document.body.innerHTML = html
  let out = ""
  const breakLine = () => {
    if (!LINE_START.test(out)) out += "\n"
  }
  const walk = (node: Node, pre: boolean, depth: number): void => {
    for (const child of Array.from(node.childNodes as ArrayLike<Node>)) {
      if (child.nodeType === child.TEXT_NODE) {
        const text = (child.nodeValue ?? "").replace(/\xa0/g, " ")
        const flowed = pre ? text : text.replace(/\s+/g, " ")
        out += LINE_START.test(out) && !pre ? flowed.trimStart() : flowed
      } else if (child.nodeType === child.ELEMENT_NODE) {
        const tag = child.nodeName
        if (tag === "BR") {
          out += "\n"
        } else if (CELL_TAGS.has(tag)) {
          if (!LINE_START.test(out) && !out.endsWith(" ")) out += " "
          walk(child, pre, depth)
        } else if (BLOCK_TAGS.has(tag)) {
          breakLine()
          if (tag === "LI") out += `${"  ".repeat(Math.max(depth - 1, 0))}• `
          walk(child, pre || tag === "PRE", tag === "UL" || tag === "OL" ? depth + 1 : depth)
          breakLine()
        } else {
          walk(child, pre, depth)
        }
      }
    }
  }
  walk(document.body, false, 0)
  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")
}
