import { activeContexts, keyLabel, KEYMAP } from "../app/keymap"
import type { State } from "../app/state"
import { fit } from "./format"
import { theme } from "./theme"

type Hint = { key: string; text: string }

function hints(state: State): Hint[] {
  return activeContexts(state).flatMap((context) =>
    KEYMAP[context].bindings.flatMap((binding) => (binding.hint ? [{ key: keyLabel(binding.keys[0]!), text: binding.hint }] : [])),
  )
}

function message(state: State): { text: string; color: string } {
  const { mode } = state
  if (mode.kind === "edit-text" && mode.error) return { text: mode.error, color: theme.error }
  if (state.flash) return { text: state.flash.text, color: state.flash.tone === "error" ? theme.error : theme.success }
  if (mode.kind === "picker") return { text: "Type to filter", color: theme.dim }
  if (mode.kind === "edit") return { text: "Edit mode", color: theme.heading }
  if (mode.kind === "edit-text" && mode.field !== "title") return { text: "YYYY-MM-DD, empty clears the date", color: theme.dim }
  return { text: "", color: theme.dim }
}

/** One line: what just happened on the left, the keys that work here on the right. */
export function StatusBar({ state, width }: { state: State; width: number }) {
  const { text, color } = message(state)
  const hintWidth = (hint: Hint) => Bun.stringWidth(hint.key) + 1 + Bun.stringWidth(hint.text) + 2
  const room = Math.max(0, width - 2 - Math.min(Bun.stringWidth(text), Math.floor(width / 2)) - 2)
  const fitting: Hint[] = []
  let used = 0
  for (const hint of hints(state)) {
    if (used + hintWidth(hint) > room) break
    fitting.push(hint)
    used += hintWidth(hint)
  }
  return (
    <box height={1} width={width} flexDirection="row" backgroundColor={theme.panel}>
      <text wrapMode="none" fg={color}>{` ${fit(text, Math.max(0, width - used - 2))}`}</text>
      <text wrapMode="none">
        {fitting.map((hint) => (
          <span key={hint.key + hint.text}>
            <span fg={theme.accent}>{hint.key}</span>
            <span fg={theme.dim}>{` ${hint.text}  `}</span>
          </span>
        ))}
      </text>
    </box>
  )
}
