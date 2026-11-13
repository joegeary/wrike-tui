import { isDay } from "./dates"
import type { CustomFieldId } from "./ids"

/** The custom field types Wrike reports, read from `GET /customfields`. A type this version does not know is kept as `Unknown`. */
export type FieldKind =
  | { type: "Text" }
  | { type: "DropDown"; options: string[]; allowOther: boolean }
  | { type: "Multiple"; options: string[]; allowOther: boolean }
  /** `decimals` is null when Wrike sets no precision, and then any is taken. */
  | { type: "Numeric"; decimals: number | null }
  | { type: "Percentage"; decimals: number | null }
  | { type: "Currency"; decimals: number | null; currency: string }
  | { type: "Date"; allowTime: boolean }
  | { type: "Checkbox" }
  /** Minutes, the unit Wrike counts every duration in. */
  | { type: "Duration" }
  /** Wrike computes it, so it is never written. */
  | { type: "CalculatedNumeric"; decimals: number | null }
  | { type: "Unknown"; wireType: string }

export type CustomField = { id: CustomFieldId; title: string; kind: FieldKind; readOnly: boolean; archived: boolean }

/** A field set on a task. Wrike stores every value as a string, whatever the field's type. */
export type FieldValue = { id: CustomFieldId; value: string }

/** What a write sends: a string, the choices of a multi-select, or null to clear. An empty string would leave the field as it was. */
export type FieldWrite = string | string[] | null

/** How a field is changed from the edit walk. */
export type FieldEditor =
  | { kind: "pick"; multi: boolean }
  | { kind: "type"; hint: string }
  | { kind: "toggle" }
  | { kind: "none"; why: string }

export function fieldEditor(field: CustomField): FieldEditor {
  const { kind, title } = field
  if (kind.type === "CalculatedNumeric") return { kind: "none", why: `Wrike calculates ${title}, so it cannot be edited` }
  if (kind.type === "Unknown") return { kind: "none", why: `${title} is a ${kind.wireType} field, which this version cannot edit` }
  if (field.readOnly) return { kind: "none", why: `${title} is read-only in Wrike` }
  switch (kind.type) {
    case "DropDown":
      return { kind: "pick", multi: false }
    case "Multiple":
      return { kind: "pick", multi: true }
    case "Checkbox":
      return { kind: "toggle" }
    case "Text":
      return { kind: "type", hint: "Empty clears the field" }
    case "Numeric":
    case "Percentage":
    case "Currency":
      return { kind: "type", hint: `${decimalsHint(kind.decimals)}, empty clears the field` }
    case "Date":
      return { kind: "type", hint: "YYYY-MM-DD, empty clears the field" }
    case "Duration":
      return { kind: "type", hint: "Hours and minutes like 2h 30m, empty clears the field" }
  }
}

const KIND_LABELS: Record<FieldKind["type"], string> = {
  Text: "text",
  DropDown: "drop-down",
  Multiple: "multi-select",
  Numeric: "number",
  Percentage: "percent",
  Currency: "currency",
  Date: "date",
  Checkbox: "checkbox",
  Duration: "duration",
  CalculatedNumeric: "calculated",
  Unknown: "other",
}

/** What kind of value a field holds, in a word. */
export const kindLabel = (kind: FieldKind) => (kind.type === "Unknown" ? kind.wireType : KIND_LABELS[kind.type])

/** True for a field "Set a field" offers: one that can be written and is still in use. */
export const isWritable = (field: CustomField) => !field.archived && fieldEditor(field).kind !== "none"

const decimalsHint = (decimals: number | null) =>
  decimals === null ? "A number" : decimals === 0 ? "A whole number" : `A number with up to ${decimals} decimal place${decimals === 1 ? "" : "s"}`

/** The choices in a multi-select value. Wrike reads one choice back as plain text and several as a JSON array. */
export function choicesOf(raw: string): string[] {
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed
    } catch {
      // Not an array after all, so it is one choice that starts with a bracket.
    }
  }
  return [raw]
}

const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

function formatNumber(raw: string, decimals: number | null): string | null {
  if (!NUMBER.test(raw)) return null
  const fraction = decimals ?? raw.split(".")[1]?.length ?? 0
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(Number(raw))
}

/** Minutes as `2h 30m`. */
export function formatMinutes(minutes: number): string {
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60]
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * A stored value as the details pane shows it. Wrike keeps any string in any
 * field, so a value that does not fit the field's type is shown as stored.
 */
export function fieldText(kind: FieldKind | undefined, raw: string): string {
  switch (kind?.type) {
    case "Multiple":
      return choicesOf(raw).join(", ")
    case "Numeric":
    case "CalculatedNumeric":
      return formatNumber(raw, kind.decimals) ?? raw
    case "Percentage": {
      const number = formatNumber(raw, kind.decimals)
      return number === null ? raw : `${number}%`
    }
    case "Currency": {
      const number = formatNumber(raw, kind.decimals)
      return number === null ? raw : `${number} ${kind.currency}`.trim()
    }
    case "Checkbox":
      return raw === "true" ? "yes" : raw === "false" ? "no" : raw
    case "Duration":
      return /^\d+$/.test(raw) ? formatMinutes(Number(raw)) : raw
    case "Date":
      return isDay(raw.slice(0, 10)) && raw.length > 10 && kind.allowTime ? `${raw.slice(0, 10)} ${raw.slice(11, 16)}` : raw
    default:
      return raw
  }
}

/** A written value as words, for the status bar. */
export function writeText(kind: FieldKind | undefined, value: FieldWrite): string {
  if (value === null) return "nothing"
  return Array.isArray(value) ? value.join(", ") : fieldText(kind, value)
}

export type ParsedInput = { ok: true; value: string | null } | { ok: false; message: string }

/**
 * Checks typed text against the field's type, since Wrike stores any string
 * in any field. Empty text clears the field. A number goes as plain digits,
 * a duration as minutes.
 */
export function parseInput(kind: FieldKind, input: string): ParsedInput {
  const text = input.trim()
  if (text === "") return { ok: true, value: null }
  switch (kind.type) {
    case "Numeric":
    case "Percentage":
    case "Currency":
      return parseNumber(kind, text)
    case "Date":
      return isDay(text) ? { ok: true, value: text } : { ok: false, message: "Use YYYY-MM-DD, or leave it empty to clear" }
    case "Duration":
      return parseDuration(text)
    default:
      return { ok: true, value: text }
  }
}

function parseNumber(kind: FieldKind & { type: "Numeric" | "Percentage" | "Currency" }, text: string): ParsedInput {
  let bare = text.replace(/[,\s]/g, "")
  if (kind.type === "Percentage") bare = bare.replace(/%$/, "")
  if (kind.type === "Currency" && kind.currency !== "" && bare.toUpperCase().endsWith(kind.currency.toUpperCase())) bare = bare.slice(0, -kind.currency.length)
  if (!NUMBER.test(bare)) return { ok: false, message: `${decimalsHint(kind.decimals)}, or empty to clear` }
  const fraction = bare.split(".")[1]?.replace(/0+$/, "") ?? ""
  if (kind.decimals !== null && fraction.length > kind.decimals) return { ok: false, message: `${decimalsHint(kind.decimals)}, or empty to clear` }
  return { ok: true, value: String(Number(bare)) }
}

const DURATION = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/i

function parseDuration(text: string): ParsedInput {
  const match = DURATION.exec(text)
  if (!match || (match[1] === undefined && match[2] === undefined)) return { ok: false, message: "Use hours and minutes like 2h 30m or 90m, or empty to clear" }
  const minutes = Math.round(Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0)
  return { ok: true, value: String(minutes) }
}

/** The text an editor starts from for a stored value: a duration in hours and minutes, anything else as stored. */
export function inputText(kind: FieldKind, raw: string | null): string {
  if (raw === null) return ""
  return kind.type === "Duration" && /^\d+$/.test(raw) ? formatMinutes(Number(raw)) : raw
}

/** What an empty input shows, so a field typed for the first time says what it takes. */
export function inputPlaceholder(kind: FieldKind): string {
  switch (kind.type) {
    case "Date":
      return "YYYY-MM-DD"
    case "Duration":
      return "2h 30m"
    case "Numeric":
    case "Percentage":
      return "number"
    case "Currency":
      return kind.currency ? `amount in ${kind.currency}` : "amount"
    default:
      return ""
  }
}

/** Whether Wrike's answer holds what was written. A field that does not apply is answered without it. */
export function kept(written: FieldWrite, stored: string | undefined): boolean {
  if (written === null) return stored === undefined
  if (stored === undefined) return false
  if (!Array.isArray(written)) return stored === written
  const read = choicesOf(stored)
  return read.length === written.length && written.every((choice) => read.includes(choice))
}
