/**
 * One change to a task's fields, as Wrike's history tells it. `from` is null
 * when Wrike did not send the old value, and `to` is null only when the field
 * was cleared. A change of a type or a shape this version does not know is
 * `other`, which still names what changed.
 */
export type HistoryChange =
  | { kind: "title"; from: string | null; to: string }
  | { kind: "status"; from: string | null; to: string }
  | { kind: "assignees"; added: string[]; removed: string[] }
  | { kind: "parents"; added: string[]; removed: string[] }
  | { kind: "attachments"; added: string[]; removed: string[] }
  | { kind: "start"; from: string | null; to: string | null }
  | { kind: "due"; from: string | null; to: string | null }
  | { kind: "duration"; from: number | null; to: number | null }
  | { kind: "field"; name: string; from: string | null; to: string | null }
  | { kind: "other"; type: string; action: string }

/** `at` is an ISO time like a comment's `createdDate`. The author is a name, because history names people by their MCP ID. */
export type HistoryEntry = { at: string; author: string | null; change: HistoryChange }

/** One page of history, newest first, and Wrike's token for the older page after it. */
export type HistoryPage = { entries: HistoryEntry[]; next: string | null }

const MINUTES_PER_DAY = 8 * 60

function span(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

const VERBS = new Map([
  ["ADD", "added"],
  ["DELETE", "removed"],
  ["UPDATE", "changed"],
])

const fromTo = (from: string | null, to: string) => (from === null ? to : `${from} → ${to}`)

function addedRemoved(change: { added: string[]; removed: string[] }, added: string, removed: string): string {
  return [change.added.length > 0 ? `${added} ${change.added.join(", ")}` : "", change.removed.length > 0 ? `${removed} ${change.removed.join(", ")}` : ""].filter(Boolean).join(", ")
}

/** The change as the comment stream draws it, after the author and the time. */
export function describeChange(change: HistoryChange): string {
  switch (change.kind) {
    case "title":
    case "status":
      return `${change.kind} ${fromTo(change.from, change.to)}`
    case "assignees":
      return addedRemoved(change, "assigned", "unassigned")
    case "parents":
      return addedRemoved(change, "moved into", "moved out of")
    case "attachments":
      return addedRemoved(change, "attached", "removed attachment")
    case "start":
    case "due":
      return change.to === null ? `${change.kind} cleared` : `${change.kind} ${fromTo(change.from, change.to)}`
    case "duration":
      return change.to === null ? "duration cleared" : `duration ${fromTo(change.from === null ? null : span(change.from), span(change.to))}`
    case "field":
      return change.to === null ? `${change.name} cleared` : `${change.name}: ${fromTo(change.from, change.to)}`
    case "other":
      return `${change.type.toLowerCase().replace(/_/g, " ")} ${VERBS.get(change.action) ?? change.action.toLowerCase()}`.trim()
  }
}
