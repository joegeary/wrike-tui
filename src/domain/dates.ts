import type { TaskDates } from "./model"

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDay(text: string): boolean {
  const match = DAY.exec(text)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Monday is 1 and Sunday is 7. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7
}

export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export type DatesResult = { ok: true; dates: TaskDates } | { ok: false; message: string }

/**
 * Applies one typed date to a task's dates. The date type follows from which
 * days are set, because Wrike has no start without a due date.
 */
export function withDay(dates: TaskDates, field: "start" | "due", input: string): DatesResult {
  const text = input.trim()
  if (text !== "" && !isDay(text)) return { ok: false, message: "Use YYYY-MM-DD, or leave it empty to clear" }
  const start = field === "start" ? text : dates.type === "Planned" ? dates.start : ""
  const due = field === "due" ? text : dates.type === "Backlog" ? "" : dates.due

  if (due === "") {
    if (field === "start" && start !== "") return { ok: false, message: "Set a due date before a start date" }
    return { ok: true, dates: { type: "Backlog" } }
  }
  if (start === "") return { ok: true, dates: { type: "Milestone", due } }
  if (start > due) return { ok: false, message: "The start date is after the due date" }
  return { ok: true, dates: { type: "Planned", start, due } }
}
