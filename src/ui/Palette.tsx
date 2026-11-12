import { keyLabel } from "../app/keymap"
import { paletteLines } from "../app/palette"
import type { Mode, State } from "../app/state"
import { fit, fitRight } from "./format"
import { Overlay } from "./Overlay"
import { useTheme } from "./theme"

const MAX_ROWS = 18
const WIDTH = 60
const KEYS_WIDTH = 12

/** The `:` palette: the commands that apply where it was opened, under group headings until something is typed. */
export function Palette({ state, mode, screen }: { state: State; mode: Mode & { kind: "palette" }; screen: { width: number; height: number } }) {
  const theme = useTheme()
  const lines = paletteLines(state, mode.query)
  const rows = Math.max(1, Math.min(MAX_ROWS, lines.length, screen.height - 6))
  const cursorLine = lines.findIndex((line) => line.kind === "command" && line.index === mode.cursor)
  // The heading above the first command stays in view with it.
  const first = Math.max(0, Math.min(cursorLine - Math.floor(rows / 2), lines.length - rows))
  const inner = Math.min(WIDTH, screen.width) - 2
  return (
    <Overlay title="Commands" width={WIDTH} height={rows + 4} screen={screen}>
      <text wrapMode="none">
        <span fg={theme.accent}> : </span>
        <span fg={theme.text}>{mode.query}</span>
        <span fg={theme.accent}>▏</span>
      </text>
      <text wrapMode="none" fg={theme.border}>{"─".repeat(inner)}</text>
      {lines.length === 0 ? <text fg={theme.dim}> No command matches.</text> : null}
      {lines.slice(first, first + rows).map((line) => {
        if (line.kind === "heading") return <text key={`heading-${line.label}`} wrapMode="none" fg={theme.heading}>{` ${fit(line.label, inner - 1)}`}</text>
        const selected = line.index === mode.cursor
        return (
          <text key={line.command.id} wrapMode="none" bg={selected ? theme.selection : undefined}>
            <span fg={theme.accent}>{selected ? " ▸ " : "   "}</span>
            <span fg={theme.text}>{fit(line.command.title, inner - 3 - KEYS_WIDTH - 1)}</span>
            <span fg={selected ? theme.selectedDim : theme.dim}>{`${fitRight(line.keys.slice(0, 2).map(keyLabel).join(" "), KEYS_WIDTH)} `}</span>
          </text>
        )
      })}
    </Overlay>
  )
}
