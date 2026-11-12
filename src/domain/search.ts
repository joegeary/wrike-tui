import { legacyItemId, type LegacyItemId } from "./ids"

export type SearchQuery =
  | { kind: "title"; text: string }
  | { kind: "permalink"; url: string }
  | { kind: "legacy-id"; id: LegacyItemId }

export function classifyQuery(input: string): SearchQuery {
  const text = input.trim()
  if (/^https?:\/\/\S+\/open\.htm\?id=\d+$/.test(text)) return { kind: "permalink", url: text }
  const id = /^\d+$/.test(text) ? legacyItemId(text) : null
  return id ? { kind: "legacy-id", id } : { kind: "title", text }
}
