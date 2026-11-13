const ELLIPSIS = "…"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** The text cut to at most `width` columns, ending in an ellipsis when it was cut. */
export function truncate(text: string, width: number): string {
  if (Bun.stringWidth(text) <= width) return text
  if (width <= 0) return ""
  let kept = ""
  for (const char of text) {
    if (Bun.stringWidth(kept + char) > width - 1) break
    kept += char
  }
  return kept + ELLIPSIS
}

/** Whitespace runs, line breaks included, as single spaces. */
export const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** Exactly `width` columns: cut with an ellipsis or padded on the right. */
export function fit(text: string, width: number): string {
  const cut = truncate(oneLine(text), width)
  return cut + " ".repeat(Math.max(0, width - Bun.stringWidth(cut)))
}

/** `lead` kept as it is, then `text` cut or padded so the whole is exactly `width` columns. For indented rows, since `fit` trims. */
export function fitAfter(lead: string, text: string, width: number): string {
  return lead + fit(text, Math.max(0, width - Bun.stringWidth(lead)))
}

/** Exactly `width` columns, padded on the left. */
export function fitRight(text: string, width: number): string {
  const cut = truncate(oneLine(text), width)
  return " ".repeat(Math.max(0, width - Bun.stringWidth(cut))) + cut
}

/** `ApprovalRequested` as `Approval requested`. */
export function humanize(label: string): string {
  const words = label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `2026-11-11` as `Nov 11`, with the year when it is not `today`'s. */
export function shortDay(day: string, today: string): string {
  const [year, month, date] = day.split("-")
  const label = `${MONTHS[Number(month) - 1] ?? "?"} ${Number(date)}`
  return year === today.slice(0, 4) ? label : `${label} ${year}`
}

/** The compact form for a list column: `Nov 11`, or `Jan 2027` for another year. */
export function listDay(day: string, today: string): string {
  const [year, month] = day.split("-")
  return year === today.slice(0, 4) ? shortDay(day, today) : `${MONTHS[Number(month) - 1] ?? "?"} ${year}`
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

const KINDS = new Map([
  ["application/pdf", "PDF"],
  ["text/plain", "text"],
  ["text/csv", "CSV"],
  ["application/zip", "ZIP archive"],
])

/** What a file is, for the attachments list: a linked file names its service, and an upload its type. */
export function fileKind(file: { name: string; storage: string; contentType: string | null }): string {
  if (file.storage !== "Wrike") return file.storage
  const type = file.contentType ?? ""
  const known = KINDS.get(type)
  if (known) return known
  const [family, subtype] = type.split("/")
  if (family === "image" && subtype) return `${subtype.toUpperCase()} image`
  const extension = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]
  return extension ? `${extension.toUpperCase()} file` : "file"
}

/** Bytes as `840 B`, `48 KB` or `2.3 MB`. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Time left as `m:ss`, rounded up so it reads `0:01` until the very end. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
