import { describe, expect, test } from "bun:test"
import { choicesOf, fieldEditor, fieldText, inputText, kept, parseInput, type CustomField, type FieldKind } from "../../src/domain/fields"
import { customFieldId } from "../../src/domain/ids"

const field = (kind: FieldKind, extra: Partial<CustomField> = {}): CustomField => ({ id: customFieldId("F1"), title: "Field", kind, readOnly: false, archived: false, ...extra })

describe("showing a value", () => {
  test("numbers take their decimal places, a currency its code and a percentage its sign", () => {
    expect(fieldText({ type: "Numeric", decimals: 0 }, "7")).toBe("7")
    expect(fieldText({ type: "Numeric", decimals: 2 }, "1234.5")).toBe("1,234.50")
    expect(fieldText({ type: "Numeric", decimals: null }, "3.25")).toBe("3.25")
    expect(fieldText({ type: "Currency", decimals: 2, currency: "USD" }, "1250")).toBe("1,250.00 USD")
    expect(fieldText({ type: "Percentage", decimals: 0 }, "40")).toBe("40%")
    expect(fieldText({ type: "CalculatedNumeric", decimals: 1 }, "7.5")).toBe("7.5")
  })

  test("a value that does not fit its type is shown as stored, because Wrike stores any string", () => {
    expect(fieldText({ type: "Numeric", decimals: 0 }, "abc")).toBe("abc")
    expect(fieldText({ type: "Duration" }, "soon")).toBe("soon")
    expect(fieldText({ type: "Checkbox" }, "maybe")).toBe("maybe")
  })

  test("several choices read as a list, a checkbox as yes or no, a duration in hours and minutes", () => {
    expect(fieldText({ type: "Multiple", options: [], allowOther: false }, '["auth","infra"]')).toBe("auth, infra")
    expect(fieldText({ type: "Multiple", options: [], allowOther: false }, "auth")).toBe("auth")
    expect(fieldText({ type: "Checkbox" }, "true")).toBe("yes")
    expect(fieldText({ type: "Checkbox" }, "false")).toBe("no")
    expect(fieldText({ type: "Duration" }, "150")).toBe("2h 30m")
    expect(fieldText({ type: "Duration" }, "480")).toBe("8h")
    expect(fieldText({ type: "Duration" }, "45")).toBe("45m")
  })

  test("a date keeps its time only where the field takes one, and an unknown type shows the raw value", () => {
    expect(fieldText({ type: "Date", allowTime: false }, "2026-11-20")).toBe("2026-11-20")
    expect(fieldText({ type: "Date", allowTime: true }, "2026-11-20T14:30:00")).toBe("2026-11-20 14:30")
    expect(fieldText({ type: "Unknown", wireType: "Contacts" }, "KUAAAA02")).toBe("KUAAAA02")
    expect(fieldText(undefined, "anything")).toBe("anything")
  })

  test("a value that starts with a bracket but is no list is one choice", () => {
    expect(choicesOf("[draft")).toEqual(["[draft"])
    expect(choicesOf("[1,2]")).toEqual(["[1,2]"])
  })
})

describe("typing a value", () => {
  test("empty text clears the field", () => {
    expect(parseInput({ type: "Text" }, "  ")).toEqual({ ok: true, value: null })
    expect(parseInput({ type: "Numeric", decimals: 0 }, "")).toEqual({ ok: true, value: null })
  })

  test("a number is checked against its decimal places and sent as plain digits", () => {
    expect(parseInput({ type: "Numeric", decimals: 0 }, "8")).toEqual({ ok: true, value: "8" })
    expect(parseInput({ type: "Numeric", decimals: 0 }, "8.5")).toEqual({ ok: false, message: "A whole number, or empty to clear" })
    expect(parseInput({ type: "Numeric", decimals: 2 }, "1,234.50")).toEqual({ ok: true, value: "1234.5" })
    expect(parseInput({ type: "Numeric", decimals: 2 }, "1.234")).toEqual({ ok: false, message: "A number with up to 2 decimal places, or empty to clear" })
    expect(parseInput({ type: "Numeric", decimals: null }, "abc")).toEqual({ ok: false, message: "A number, or empty to clear" })
    expect(parseInput({ type: "Percentage", decimals: 0 }, "55%")).toEqual({ ok: true, value: "55" })
    expect(parseInput({ type: "Currency", decimals: 2, currency: "USD" }, "99.95 usd")).toEqual({ ok: true, value: "99.95" })
  })

  test("a date must be a real YYYY-MM-DD day", () => {
    expect(parseInput({ type: "Date", allowTime: false }, "2026-12-01")).toEqual({ ok: true, value: "2026-12-01" })
    expect(parseInput({ type: "Date", allowTime: false }, "next week")).toMatchObject({ ok: false })
    expect(parseInput({ type: "Date", allowTime: false }, "2026-02-30")).toMatchObject({ ok: false })
  })

  test("a duration is typed in hours and minutes and sent as minutes", () => {
    expect(parseInput({ type: "Duration" }, "2h 30m")).toEqual({ ok: true, value: "150" })
    expect(parseInput({ type: "Duration" }, "1.5h")).toEqual({ ok: true, value: "90" })
    expect(parseInput({ type: "Duration" }, "90m")).toEqual({ ok: true, value: "90" })
    expect(parseInput({ type: "Duration" }, "90")).toMatchObject({ ok: false })
    expect(inputText({ type: "Duration" }, "150")).toBe("2h 30m")
  })
})

describe("editors", () => {
  test("each type opens its own editor, and the ones that cannot be written say why", () => {
    expect(fieldEditor(field({ type: "DropDown", options: [], allowOther: false }))).toEqual({ kind: "pick", multi: false })
    expect(fieldEditor(field({ type: "Multiple", options: [], allowOther: false }))).toEqual({ kind: "pick", multi: true })
    expect(fieldEditor(field({ type: "Checkbox" }))).toEqual({ kind: "toggle" })
    expect(fieldEditor(field({ type: "Duration" }))).toMatchObject({ kind: "type" })
    expect(fieldEditor(field({ type: "Text" }, { readOnly: true, title: "Region" }))).toEqual({ kind: "none", why: "Region is read-only in Wrike" })
    expect(fieldEditor(field({ type: "CalculatedNumeric", decimals: 1 }, { title: "Score" }))).toEqual({ kind: "none", why: "Wrike calculates Score, so it cannot be edited" })
    expect(fieldEditor(field({ type: "Unknown", wireType: "Contacts" }, { title: "Owner" }))).toEqual({ kind: "none", why: "Owner is a Contacts field, which this version cannot edit" })
  })
})

describe("whether Wrike kept a write", () => {
  test("a value is kept when Wrike answers with it, a clear when the field is gone, and choices in any order", () => {
    expect(kept("5", "5")).toBe(true)
    expect(kept("5", undefined)).toBe(false)
    expect(kept(null, undefined)).toBe(true)
    expect(kept(null, "5")).toBe(false)
    expect(kept(["auth", "sso"], '["sso","auth"]')).toBe(true)
    expect(kept(["auth"], "auth")).toBe(true)
    expect(kept(["auth", "sso"], "auth")).toBe(false)
  })
})
