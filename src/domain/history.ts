/**
 * One change to a task's fields, as Wrike's history tells it. A change of a
 * type or a shape this version does not know is `other`, which still names
 * what changed.
 */
export type HistoryChange =
  | { kind: "title"; from: string | null; to: string }
  | { kind: "status"; from: string | null; to: string }
  | { kind: "assignees"; added: string[]; removed: string[] }
  | { kind: "parents"; added: string[]; removed: string[] }
  | { kind: "start"; day: string | null }
  | { kind: "due"; day: string | null }
  | { kind: "duration"; minutes: number | null }
  | { kind: "field"; name: string; value: string | null }
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

const VERBS: Record<string, string> = { ADD: "added", DELETE: "removed", UPDATE: "changed" }

/** The change as the comment stream draws it, after the author and the time. */
export function describeChange(change: HistoryChange): string {
  switch (change.kind) {
    case "title":
    case "status":
      return change.from === null ? `${change.kind} ${change.to}` : `${change.kind} ${change.from} → ${change.to}`
    case "assignees":
      return [change.added.length > 0 ? `assigned ${change.added.join(", ")}` : "", change.removed.length > 0 ? `unassigned ${change.removed.join(", ")}` : ""].filter(Boolean).join(", ")
    case "parents":
      return [change.added.length > 0 ? `moved into ${change.added.join(", ")}` : "", change.removed.length > 0 ? `moved out of ${change.removed.join(", ")}` : ""].filter(Boolean).join(", ")
    case "start":
    case "due":
      return `${change.kind} ${change.day ?? "cleared"}`
    case "duration":
      return change.minutes === null ? "duration cleared" : `duration ${span(change.minutes)}`
    case "field":
      return change.value === null || change.value === "" ? `${change.name} cleared` : `${change.name}: ${change.value}`
    case "other":
      return `${change.type.toLowerCase().replace(/_/g, " ")} ${VERBS[change.action] ?? change.action.toLowerCase()}`.trim()
  }
}
