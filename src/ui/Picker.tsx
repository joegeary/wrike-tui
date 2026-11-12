import { pickerOptions } from "../app/selectors"
import type { Mode, PickerField, State } from "../app/state"
import { fit } from "./format"
import { Overlay } from "./Overlay"
import { statusColor, theme } from "./theme"

const TITLES: Record<PickerField, string> = { status: "Status", importance: "Importance", assignees: "Assignees" }
const MAX_ROWS = 12
const WIDTH = 56

function emptyText(state: State, mode: Mode & { kind: "picker" }): string {
  if (mode.query !== "") return "Nothing matches the filter."
  if (mode.field === "status") {
    return state.spaceWorkflows === "loading" ? "Loading this task's workflow..." : "This task's workflow is not available."
  }
  return mode.field === "assignees" ? "No people loaded." : "Nothing to pick."
}

export function Picker({ state, mode, screen }: { state: State; mode: Mode & { kind: "picker" }; screen: { width: number; height: number } }) {
  const options = pickerOptions(state, mode)
  const rows = Math.max(1, Math.min(MAX_ROWS, options.length, screen.height - 6))
  const first = Math.max(0, Math.min(mode.cursor - Math.floor(rows / 2), options.length - rows))
  const inner = Math.min(WIDTH, screen.width - 2) - 2
  const multi = mode.field === "assignees"
  return (
    <Overlay title={TITLES[mode.field]} width={WIDTH} height={rows + 4} screen={screen}>
      <text wrapMode="none">
        <span fg={theme.dim}> Filter: </span>
        <span fg={theme.text}>{mode.query}</span>
        <span fg={theme.accent}>▏</span>
      </text>
      <text wrapMode="none" fg={theme.border}>{"─".repeat(inner)}</text>
      {options.length === 0 ? <text fg={theme.dim}>{` ${emptyText(state, mode)}`}</text> : null}
      {options.slice(first, first + rows).map((option, offset) => {
        const selected = first + offset === mode.cursor
        const box = multi ? (mode.chosen.includes(option.id) ? "[x] " : "[ ] ") : ""
        const dot = mode.field === "status" ? "● " : ""
        const detail = option.detail ?? ""
        const labelWidth = Math.max(0, inner - 3 - box.length - dot.length - (detail ? Math.min(Bun.stringWidth(detail), 28) + 2 : 0))
        return (
          <text key={option.id} wrapMode="none" bg={selected ? theme.selection : undefined}>
            <span fg={theme.accent}>{selected ? " ▸ " : "   "}</span>
            <span fg={theme.text}>{box}</span>
            <span fg={statusColor(option.color)}>{dot}</span>
            <span fg={theme.text}>{fit(option.label, labelWidth)}</span>
            <span fg={theme.dim}>{detail ? `  ${fit(detail, Math.min(Bun.stringWidth(detail), 28))}` : ""}</span>
          </text>
        )
      })}
    </Overlay>
  )
}
