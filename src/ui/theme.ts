export const theme = {
  background: "#1e1e2e",
  panel: "#181825",
  selection: "#313244",
  border: "#45475a",
  accent: "#89b4fa",
  text: "#cdd6f4",
  dim: "#7f849c",
  heading: "#f9e2af",
  error: "#f38ba8",
  warning: "#fab387",
  success: "#a6e3a1",
  link: "#89dceb",
} as const

/** Wrike names status colors. Anything not listed draws in the dim color. */
const STATUS_COLORS: Record<string, string> = {
  Blue: "#89b4fa",
  Turquoise: "#94e2d5",
  DarkCyan: "#74c7ec",
  Green: "#a6e3a1",
  DarkGreen: "#a6e3a1",
  Yellow: "#f9e2af",
  Orange: "#fab387",
  Red: "#f38ba8",
  DarkRed: "#eba0ac",
  Purple: "#cba6f7",
  Pink: "#f5c2e7",
  Brown: "#f2cdcd",
  Gray: "#7f849c",
}

export const statusColor = (name: string | undefined) => (name && STATUS_COLORS[name]) || theme.dim
