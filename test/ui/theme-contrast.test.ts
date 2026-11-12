import { describe, expect, test } from "bun:test"
import { THEMES } from "../../src/ui/theme"

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const TEXT = ["text", "dim", "accent", "heading", "error", "warning", "success", "link"] as const
type HexTheme = Record<(typeof TEXT)[number] | "background" | "panel" | "selection" | "selectedDim", string> & { status: Record<string, string> }
// WCAG AA for normal text is 4.5 to 1. The high-contrast theme promises AAA, 7 to 1.
const MINIMUM = { dark: 4.5, light: 4.5, "high-contrast": 7 } as const

describe.each(Object.keys(MINIMUM) as (keyof typeof MINIMUM)[])("the %s theme", (name) => {
  // These three themes are all hex. Only the terminal theme uses palette indexes, which have no fixed color to measure.
  const theme = THEMES[name] as unknown as HexTheme
  const minimum = MINIMUM[name]
  const failures = (pairs: [string, string, string][]) =>
    pairs.filter(([, fg, bg]) => contrast(fg, bg) < minimum).map(([label, fg, bg]) => `${label} ${contrast(fg, bg).toFixed(2)}`)

  test("every text color reads on the background and on panels", () => {
    const colors = [...TEXT.map((token) => [token, theme[token]] as const), ...Object.entries(theme.status).map(([status, color]) => [`status ${status}`, color] as const)]
    expect(failures(colors.flatMap(([label, fg]) => [[`${label} on background`, fg, theme.background], [`${label} on panel`, fg, theme.panel]] as [string, string, string][]))).toEqual([])
  })

  test("the cursor row keeps its text readable", () => {
    const { selection } = theme
    expect(failures([["text", theme.text, selection], ["accent", theme.accent, selection], ["selectedDim", theme.selectedDim, selection]])).toEqual([])
  })
})
