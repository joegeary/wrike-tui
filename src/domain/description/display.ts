import { createDocument } from "@mixmark-io/domino"
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
 * themselves, and the escapes the editor adds for ==, ++ and { go, since plain markdown reads
 * those as text already.
 */
const plain = (markdown: string) =>
  markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<!\\)(&#32;|&#9;|&nbsp;)/g, (space) => SPACES[space]!)
    .replace(/(?<!\\)\\(==|\+\+|\{)/g, "$1")

function unwrap(element: Element) {
  const parent = element.parentNode!
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}
