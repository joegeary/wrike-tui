import { RGBA } from "@opentui/core"
import { createContext, useContext } from "react"
import type { ThemeName } from "../domain/settings"

/** A hex color, or a color of the terminal's own palette. */
export type Color = string | RGBA

/** Wrike's names for status colors. */
const STATUS_NAMES = ["Blue", "Turquoise", "DarkCyan", "Green", "DarkGreen", "Yellow", "Orange", "Red", "DarkRed", "Purple", "Pink", "Brown", "Gray"] as const
type StatusName = (typeof STATUS_NAMES)[number]

export type Theme = {
  background: Color
  panel: Color
  selection: Color
  border: Color
  accent: Color
  text: Color
  dim: Color
  /** Dim text on a selected row, where `dim` may be the selection color itself. */
  selectedDim: Color
  heading: Color
  error: Color
  warning: Color
  success: Color
  link: Color
  status: Record<StatusName, Color>
}

const dark: Theme = {
  background: "#1e1e2e",
  panel: "#181825",
  selection: "#313244",
  border: "#45475a",
  accent: "#89b4fa",
  text: "#cdd6f4",
  dim: "#82879e",
  selectedDim: "#969aae",
  heading: "#f9e2af",
  error: "#f38ba8",
  warning: "#fab387",
  success: "#a6e3a1",
  link: "#89dceb",
  status: {
    Blue: "#89b4fa", Turquoise: "#94e2d5", DarkCyan: "#74c7ec", Green: "#a6e3a1", DarkGreen: "#a6e3a1", Yellow: "#f9e2af", Orange: "#fab387",
    Red: "#f38ba8", DarkRed: "#eba0ac", Purple: "#cba6f7", Pink: "#f5c2e7", Brown: "#f2cdcd", Gray: "#82879e",
  },
}

const light: Theme = {
  background: "#eff1f5",
  panel: "#e6e9ef",
  selection: "#ccd0da",
  border: "#9ca0b0",
  accent: "#094cd2",
  text: "#4c4f69",
  dim: "#65677a",
  selectedDim: "#555869",
  heading: "#98580c",
  error: "#d00f38",
  warning: "#b1470b",
  success: "#2d771e",
  link: "#047288",
  status: {
    Blue: "#094cd2", Turquoise: "#12747a", DarkCyan: "#047288", Green: "#2d771e", DarkGreen: "#2d771e", Yellow: "#98580c", Orange: "#b1470b",
    Red: "#d00f38", DarkRed: "#a80d2e", Purple: "#8737ef", Pink: "#af3599", Brown: "#8a5a44", Gray: "#65677a",
  },
}

const highContrast: Theme = {
  background: "#000000",
  panel: "#000000",
  selection: "#2b2b9a",
  border: "#ffffff",
  accent: "#ffff00",
  text: "#ffffff",
  dim: "#c8c8c8",
  selectedDim: "#e0e0e0",
  heading: "#00ffff",
  error: "#ff6b6b",
  warning: "#ffb000",
  success: "#00ff66",
  link: "#66d9ff",
  status: {
    Blue: "#66a3ff", Turquoise: "#00ffd0", DarkCyan: "#66d9ff", Green: "#00ff66", DarkGreen: "#00ff66", Yellow: "#ffff00", Orange: "#ffb000",
    Red: "#ff6b6b", DarkRed: "#ff6b6b", Purple: "#d9a3ff", Pink: "#ff99e6", Brown: "#ffcc99", Gray: "#c8c8c8",
  },
}

const ansi = (index: number) => RGBA.fromIndex(index)

/** The terminal's own 16 colors and its default foreground and background, so the client follows the terminal's theme. */
const terminal: Theme = {
  background: RGBA.defaultBackground(),
  panel: RGBA.defaultBackground(),
  selection: ansi(8),
  border: ansi(8),
  accent: ansi(4),
  text: RGBA.defaultForeground(),
  dim: ansi(8),
  selectedDim: ansi(7),
  heading: ansi(3),
  error: ansi(1),
  warning: ansi(11),
  success: ansi(2),
  link: ansi(6),
  status: {
    Blue: ansi(4), Turquoise: ansi(6), DarkCyan: ansi(14), Green: ansi(2), DarkGreen: ansi(10), Yellow: ansi(3), Orange: ansi(11),
    Red: ansi(1), DarkRed: ansi(9), Purple: ansi(5), Pink: ansi(13), Brown: ansi(3), Gray: ansi(8),
  },
}

export const THEMES: Record<ThemeName, Theme> = { terminal, dark, light, "high-contrast": highContrast }

const ThemeContext = createContext<Theme>(dark)
export const ThemeProvider = ThemeContext.Provider
export const useTheme = () => useContext(ThemeContext)

/** Wrike names status colors. Anything not listed draws in the dim color. */
export function statusColor(theme: Theme, name: string | undefined): Color {
  return STATUS_NAMES.find((known) => known === name) ? theme.status[name as StatusName] : theme.dim
}
