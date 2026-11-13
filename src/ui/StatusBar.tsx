import { isOffered } from "../app/commands"
import { activeContexts, boundCommands, keyLabel } from "../app/keymap"
import { fieldDefs, isMultiPicker } from "../app/selectors"
import type { ConfirmTarget, State, TaskPlan } from "../app/state"
import { fieldEditor } from "../domain/fields"
import { fit } from "./format"
import { useTheme, type Color, type Theme } from "./theme"

type Hint = { key: string; text: string }

/** The commands with a hint that a key runs here, read from the keymap and the registry. */
function hints(state: State): Hint[] {
  return activeContexts(state).flatMap((context) =>
    boundCommands(context).flatMap(({ command, keys }) => {
      if (!command.hint || !isOffered(command, state)) return []
      const text = typeof command.hint === "string" ? command.hint : command.hint(state)
      return text === null ? [] : [{ key: keyLabel(keys[0]!), text }]
    }),
  )
}

function message(state: State, theme: Theme): { text: string; color: Color } {
  const { mode } = state
  if ((mode.kind === "edit-text" || mode.kind === "new-task") && mode.error) return { text: mode.error, color: theme.error }
  if (state.flash) return { text: state.flash.text, color: state.flash.tone === "error" ? theme.error : theme.success }
  if (mode.kind === "confirm") return { text: question(mode.target), color: theme.warning }
  if (mode.kind === "new-task") return { text: planText(mode.plan), color: theme.dim }
  if (mode.kind === "picker" && isMultiPicker(state, mode) && mode.field === "custom") return { text: "Type to filter. With nothing chosen, Enter clears the field.", color: theme.dim }
  if (mode.kind === "picker") return { text: "Type to filter", color: theme.dim }
  if (mode.kind === "palette") return { text: "Type to find a command", color: theme.dim }
  if (mode.kind === "filter-input") return { text: "Shows tasks whose title contains this. Empty clears it.", color: theme.dim }
  if (mode.kind === "edit") return { text: "Edit mode", color: theme.heading }
  if (mode.kind === "edit-text" && mode.field === "custom") {
    const field = fieldDefs(state.customFields).get(mode.edit.id)
    const editor = field ? fieldEditor(field) : null
    return { text: editor?.kind === "type" ? editor.hint : "", color: theme.dim }
  }
  if (mode.kind === "edit-text" && mode.field !== "title") return { text: "YYYY-MM-DD, empty clears the date", color: theme.dim }
  return { text: "", color: theme.dim }
}

const quoted = (title: string) => `"${title.length > 40 ? `${title.slice(0, 39)}…` : title}"`

const tasks = (n: number) => (n === 1 ? "1 task" : `${n} tasks`)

/** The question a confirm asks. */
function question(target: ConfirmTarget): string {
  if (target.kind === "comment") return "Delete this comment? y deletes, any other key keeps it"
  if (target.kind === "delete-tasks") {
    const n = target.tasks.length
    return `Delete ${tasks(n)}? ${n === 1 ? "It goes" : "They go"} to the Recycle Bin. y deletes, any other key keeps ${n === 1 ? "it" : "them"}`
  }
  if (target.kind === "cancel-tasks") return `Cancel ${tasks(target.plan.length)}? y cancels, any other key leaves them`
  const subtasks =
    target.subtasks === 0 ? "" : target.subtasks === 1 ? " Its subtask stays as a top-level task." : ` Its ${target.subtasks} subtasks stay as top-level tasks.`
  return `Delete ${quoted(target.title)}? It goes to the Recycle Bin.${subtasks} y deletes, any other key keeps it`
}

function planText(plan: TaskPlan): string {
  const what = plan.parent ? `A subtask of ${quoted(plan.parent.title)}` : "A new task"
  return `${what} in ${plan.folder.title}${plan.assignees.length > 0 ? ", assigned to you" : ""}`
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
      {/* Two columns always part the message from the keys, so a long one never runs into them. */}
      <text wrapMode="none" fg={color}>{` ${fit(text, Math.max(0, width - used - mark.length - 4))}  `}</text>
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
