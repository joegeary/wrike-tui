const ELLIPSIS = "…"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function truncate(text: string, width: number): string {
  if (Bun.stringWidth(text) <= width) return text
  if (width <= 0) return ""
  let kept = ""
  for (const char of text) {
    if (Bun.stringWidth(kept + char) > width - 1) break
    kept += char
  }
  return kept + ELLIPSIS
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** Exactly `width` columns: cut with an ellipsis or padded on the right. */
export function fit(text: string, width: number): string {
  const cut = truncate(oneLine(text), width)
  return cut + " ".repeat(Math.max(0, width - Bun.stringWidth(cut)))
}

/** Exactly `width` columns, padded on the left. */
export function fitRight(text: string, width: number): string {
  const cut = truncate(oneLine(text), width)
  return " ".repeat(Math.max(0, width - Bun.stringWidth(cut))) + cut
}

/** `2026-11-11` as `Nov 11`, with the year when it is not `today`'s. */
export function shortDay(day: string, today: string): string {
  const [year, month, date] = day.split("-")
  const label = `${MONTHS[Number(month) - 1] ?? "?"} ${Number(date)}`
  return year === today.slice(0, 4) ? label : `${label} ${year}`
}

export function relativeTime(ts: string, now: string): string {
  const minutes = Math.floor((new Date(now).getTime() - new Date(ts).getTime()) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`
  const date = new Date(ts)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** A comment's time in the local zone, as `Nov 10 14:05`. */
export function stamp(ts: string): string {
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
