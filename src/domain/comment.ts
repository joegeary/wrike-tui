import { createDocument } from "@mixmark-io/domino"
import { userId, type UserId } from "./ids"
import type { Contact } from "./model"

/**
 * Wrike's web app lets a comment be edited for five minutes after it is
 * posted. The API allows more, but an edit leaves no "edited" mark, so the
 * client keeps the web app's rule and nobody reads a comment that changed
 * long after they replied to it.
 */
export const EDIT_WINDOW_MS = 5 * 60_000

/** Milliseconds left to edit a comment posted at `createdDate`. Zero or less once the window has closed. */
export function editWindowLeft(createdDate: string, now: string): number {
  return new Date(createdDate).getTime() + EDIT_WINDOW_MS - new Date(now).getTime()
}

/** The most characters Wrike takes for a comment's text, as sent, so mention anchors count. */
export const COMMENT_LIMIT = 10_000

/** A mention in a draft: `@name` at offset `at`. Wrike stores it as an anchor to the person. */
export type Mention = { at: number; id: UserId; name: string }

/** What the comment endpoints take. Plain text unless the comment holds a mention, which only HTML carries. */
export type CommentBody = { text: string; plainText: boolean }

const mentionText = (mention: Mention) => `@${mention.name}`
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const mentionAnchor = (mention: Mention) => `<a class="stream-user-id avatar" rel="${mention.id}">&#64;${escapeHtml(mention.name)}</a>`

/** The draft as Wrike should store it, trimmed. Mentions become anchors, so a comment with one is sent as HTML. */
export function commentBody(draft: string, mentions: Mention[]): CommentBody {
  const text = draft.trim()
  if (mentions.length === 0) return { text, plainText: true }
  const lead = draft.length - draft.trimStart().length
  let html = ""
  let from = 0
  for (const mention of mentions.toSorted((a, b) => a.at - b.at)) {
    const at = mention.at - lead
    html += escapeHtml(text.slice(from, at)) + mentionAnchor(mention)
    from = at + mentionText(mention).length
  }
  html += escapeHtml(text.slice(from))
  return { text: html.replace(/\n/g, "<br />"), plainText: false }
}

/** The comment's HTML parsed the way a browser reads it, with every character reference decoded. */
function parse(html: string): HTMLElement {
  const document = createDocument("")
  document.body.innerHTML = html
  return document.body
}

// domino node lists are array-likes without an iterator.
const childrenOf = (node: Node): Node[] => Array.from(node.childNodes as ArrayLike<Node>)

/** The person a mention anchor names, or null for any other element. */
function mentioned(node: Node): UserId | null {
  if (node.nodeName !== "A") return null
  const anchor = node as Element
  const rel = anchor.getAttribute("rel")
  return rel && anchor.classList.contains("stream-user-id") ? userId(rel) : null
}

/** A mention's name: the person's name now, or the one stored in the anchor for someone the client does not know. */
const mentionedName = (id: UserId, anchor: Element, nameOf: (id: UserId) => string | undefined) => nameOf(id) ?? (anchor.textContent ?? "").replace(/^@/, "")

/** The comment's HTML with each mention as a bold `@Full Name`, so it reads as a name and not as a link with no target. */
export function showMentions(html: string, nameOf: (id: UserId) => string | undefined): string {
  const body = parse(html)
  for (const anchor of Array.from(body.querySelectorAll("a") as ArrayLike<Element>)) {
    const id = mentioned(anchor)
    if (!id) continue
    const bold = anchor.ownerDocument.createElement("strong")
    bold.textContent = `@${mentionedName(id, anchor, nameOf)}`
    anchor.parentNode!.replaceChild(bold, anchor)
  }
  return body.innerHTML
}

const SOURCE_NEWLINE = /[ \t\r]*\n[ \t\r\n]*/g
const atLineEdge = (node: Node | null) => node === null || node.nodeName === "BR"

/**
 * A text node as a browser shows it: a newline in the source, with the
 * spaces around it, is one space, and none at all at the start or end of a line.
 */
function shownText(node: Node): string {
  let text = node.nodeValue ?? ""
  if (atLineEdge(node.previousSibling)) text = text.replace(/^[ \t\r]*\n[ \t\r\n]*/, "")
  if (atLineEdge(node.nextSibling)) text = text.replace(/[ \t\r]*\n[ \t\r\n]*$/, "")
  return text.replace(SOURCE_NEWLINE, " ")
}

/**
 * A comment as text to edit, with its mentions as `@Full Name`. Null when the
 * HTML holds anything but text, line breaks and mentions, because saving it
 * back as text would strip formatting the user did not touch.
 */
export function editableComment(html: string, nameOf: (id: UserId) => string | undefined): { text: string; mentions: Mention[] } | null {
  let text = ""
  const mentions: Mention[] = []
  for (const node of childrenOf(parse(html))) {
    if (node.nodeType === node.TEXT_NODE) {
      text += shownText(node)
    } else if (node.nodeName === "BR") {
      text += "\n"
    } else {
      const id = mentioned(node)
      if (!id || childrenOf(node).some((child) => child.nodeType !== child.TEXT_NODE)) return null
      const name = mentionedName(id, node as Element, nameOf)
      mentions.push({ at: text.length, id, name })
      text += `@${name}`
    }
  }
  return { text, mentions }
}

/** Moves the mentions along with an edit of the text. A mention the edit touched is plain text from then on. */
export function followEdit(before: string, after: string, mentions: Mention[]): Mention[] {
  if (before === after || mentions.length === 0) return mentions
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const changedUntil = before.length - end
  const shift = after.length - before.length
  return mentions.flatMap((mention) => {
    if (mention.at + mentionText(mention).length <= start) return [mention]
    if (mention.at >= changedUntil) return [{ ...mention, at: mention.at + shift }]
    return []
  })
}

/** Where `@name` stands in `text` as a whole name, one not running on into a longer word. */
function places(text: string, name: string): number[] {
  const escaped = `@${name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return Array.from(text.matchAll(new RegExp(`${escaped}(?![\\p{L}\\p{N}])`, "gu")), (match) => match.index)
}

/**
 * Finds the mentions again in text that came back from the editor. Each name
 * binds its picks to its places in document order, longer names first so
 * `@Pat` does not take part of `@Pat Example`. When one name stands for
 * several people and the editor changed how often it appears, there is no
 * telling who is still meant, so none of them is a mention and the name is
 * returned as unsure.
 */
export function refindMentions(text: string, mentions: Mention[]): { mentions: Mention[]; unsure: string[] } {
  const found: Mention[] = []
  const unsure: string[] = []
  const taken: [number, number][] = []
  const names = [...new Set(mentions.map((mention) => mention.name))].sort((a, b) => b.length - a.length)
  for (const name of names) {
    const picks = mentions.filter((mention) => mention.name === name).toSorted((a, b) => a.at - b.at)
    const end = (at: number) => at + name.length + 1
    const free = places(text, name).filter((at) => !taken.some(([from, to]) => at < to && end(at) > from))
    if (new Set(picks.map((pick) => pick.id)).size > 1 && free.length !== picks.length) {
      unsure.push(name)
      continue
    }
    free.slice(0, picks.length).forEach((at, index) => {
      found.push({ ...picks[index]!, at })
      taken.push([at, end(at)])
    })
  }
  return { mentions: found.toSorted((a, b) => a.at - b.at), unsure }
}

/** The mention being typed at the end of the draft: an `@` at the start or after a space, then at least one letter. */
export function typedMention(draft: string): { at: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]+)$/.exec(draft)
  return match ? { at: draft.length - match[1]!.length - 1, query: match[1]! } : null
}

export const MENTION_LIMIT = 5

/** Active people with a word of their name that starts with `query`, by name, at most `MENTION_LIMIT`. */
export function mentionMatches(contacts: Iterable<Contact>, query: string): Contact[] {
  const prefix = query.toLowerCase()
  return [...contacts]
    .filter((contact) => contact.active && contact.name.toLowerCase().split(/[\s-]+/).some((word) => word.startsWith(prefix)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MENTION_LIMIT)
}
