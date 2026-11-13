import { userId, type UserId } from "./ids"

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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const attribute = (attributes: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attributes)?.[1] ?? null

/**
 * A comment as text to edit, with its mentions as `@Full Name`. Null when the
 * HTML holds anything but text, line breaks and mentions, because saving it
 * back as text would strip formatting the user did not touch.
 */
export function editableComment(html: string, nameOf: (id: UserId) => string | undefined): { text: string; mentions: Mention[] } | null {
  let text = ""
  const mentions: Mention[] = []
  for (const [token, attributes, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>|<[^>]*>|[^<]+/gi)) {
    if (attributes !== undefined) {
      const rel = attribute(attributes, "rel")
      if (!attribute(attributes, "class")?.split(/\s+/).includes("stream-user-id") || !rel || inner!.includes("<")) return null
      const id = userId(rel)
      const name = nameOf(id) ?? decodeEntities(inner!).replace(/^@/, "")
      mentions.push({ at: text.length, id, name })
      text += `@${name}`
    } else if (/^<br\s*\/?>$/i.test(token)) {
      text += "\n"
    } else if (token.startsWith("<")) {
      return null
    } else {
      text += decodeEntities(token)
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

/** Finds the mentions again in text that came back from the editor, in order, each after the one before it. */
export function refindMentions(text: string, mentions: Mention[]): Mention[] {
  let from = 0
  return mentions
    .toSorted((a, b) => a.at - b.at)
    .flatMap((mention) => {
      const at = text.indexOf(mentionText(mention), from)
      if (at < 0) return []
      from = at + mentionText(mention).length
      return [{ ...mention, at }]
    })
}
