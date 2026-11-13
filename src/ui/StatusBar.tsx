import { isOffered } from "../app/commands"
import { activeContexts, boundCommands, keyLabel } from "../app/keymap"
import type { State } from "../app/state"
import { fit } from "./format"
import { useTheme, type Color, type Theme } from "./theme"

type Hint = { key: string; text: string }

/** The commands with a hint that a key runs here, read from the keymap and the registry. */
function hints(state: State): Hint[] {
  return activeContexts(state).flatMap((context) =>
    boundCommands(context).flatMap(({ command, keys }) => {
      if (!command.hint || !isOffered(command, state)) return []
      return [{ key: keyLabel(keys[0]!), text: typeof command.hint === "string" ? command.hint : command.hint(state) }]
    }),
  )
}

function message(state: State, theme: Theme): { text: string; color: Color } {
  const { mode } = state
  if (mode.kind === "edit-text" && mode.error) return { text: mode.error, color: theme.error }
  if (state.flash) return { text: state.flash.text, color: state.flash.tone === "error" ? theme.error : theme.success }
  if (mode.kind === "confirm-delete") return { text: "Delete this comment? y deletes, any other key keeps it", color: theme.warning }
  if (mode.kind === "picker") return { text: "Type to filter", color: theme.dim }
  if (mode.kind === "palette") return { text: "Type to find a command", color: theme.dim }
  if (mode.kind === "filter-input") return { text: "Shows tasks whose title contains this. Empty clears it.", color: theme.dim }
  if (mode.kind === "edit") return { text: "Edit mode", color: theme.heading }
  if (mode.kind === "edit-text" && mode.field !== "title") return { text: "YYYY-MM-DD, empty clears the date", color: theme.dim }
  return { text: "", color: theme.dim }
}

const READ_ONLY = "read-only "

/** One line: what just happened on the left, the keys that work here on the right, and a standing mark while writes are refused. */
export function StatusBar({ state, width }: { state: State; width: number }) {
  const theme = useTheme()
  const { text, color } = message(state, theme)
  const hintWidth = (hint: Hint) => Bun.stringWidth(hint.key) + 1 + Bun.stringWidth(hint.text) + 2
  const mark = state.readOnly ? READ_ONLY : ""
  const room = Math.max(0, width - 2 - Math.min(Bun.stringWidth(text), Math.floor(width / 2)) - 2 - mark.length)
  const fitting: Hint[] = []
  let used = 0
  for (const hint of hints(state)) {
    if (used + hintWidth(hint) > room) break
    fitting.push(hint)
    used += hintWidth(hint)
  }
  return (
    <box height={1} width={width} flexDirection="row" backgroundColor={theme.panel}>
      <text wrapMode="none" fg={color}>{` ${fit(text, Math.max(0, width - used - mark.length - 2))}`}</text>
      <text wrapMode="none">
        {fitting.map((hint) => (
          <span key={hint.key + hint.text}>
            <span fg={theme.accent}>{hint.key}</span>
            <span fg={theme.dim}>{` ${hint.text}  `}</span>
          </span>
        ))}
        <span fg={theme.warning}>{mark}</span>
      </text>
    </box>
  )
}
