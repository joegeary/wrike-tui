import { sameHtml } from "../html-equivalence"
import { markdownToHtml } from "./html"
import { htmlToMarkdown } from "./markdown"

export { displayMarkdown } from "./display"
export { htmlToMarkdown, markdownToHtml }

export type EditableDescription =
  | { format: "markdown"; text: string; padding: Padding }
  | { format: "html"; text: string }

/** Leading and trailing breaks and spaces, which markdown cannot spell. A save puts them back. */
type Padding = { before: string; after: string }

const PADDING = /^((?:\s|&nbsp;|&#160;|<br\s*\/?>)*)([\s\S]*?)((?:\s|&nbsp;|&#160;|<br\s*\/?>)*)$/

/**
 * Markdown when saving it unchanged writes back the same HTML. Raw HTML otherwise,
 * so a save never strips formatting the user did not touch.
 */
export function editableDescription(html: string): EditableDescription {
  const [, before = "", body = "", after = ""] = PADDING.exec(html)!
  const text = htmlToMarkdown(body)
  // A description of nothing but blank lines would come back empty, so it stays HTML.
  return (body !== "" || html === "") && sameHtml(markdownToHtml(text), body)
    ? { format: "markdown", text, padding: { before, after } }
    : { format: "html", text: html }
}

export function descriptionFromEdit(edited: EditableDescription): string {
  if (edited.format === "html") return edited.text.trim()
  const html = markdownToHtml(edited.text)
  return html === "" ? "" : edited.padding.before + html + edited.padding.after
}
