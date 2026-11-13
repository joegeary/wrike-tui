import { currentStep } from "../app/selectors"
import type { FormFilling, FormMode, State } from "../app/state"
import { answerText, cannotFill, formSteps, type FormField } from "../domain/forms"
import { describeError } from "../wrike/errors"
import { fit, truncate } from "./format"
import { Overlay } from "./Overlay"
import { useTheme, type Theme } from "./theme"
import { TextArea } from "./TextArea"
import { TextInput } from "./TextInput"

const WIDTH = 76
const HEIGHT = 22
const MAX_CHOICES = 8

const PLACEHOLDERS: Partial<Record<FormField["kind"]["type"], string>> = { text: "Type the answer", date: "YYYY-MM-DD", number: "a number" }

/** About how many lines the helper text wraps to, each paragraph at least one. */
const helperLines = (text: string, width: number) => text.trim().split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(Bun.stringWidth(line) / width)), 0)

/** The editor of the field being filled: a line, a box of lines, a list of choices, or why the terminal cannot fill it. */
function Editor({ mode, field, inner, theme, onDraft }: { mode: FormMode & FormFilling; field: FormField; inner: number; theme: Theme; onDraft: (text: string) => void }) {
  const { kind } = field
  if (cannotFill(field)) {
    const what = kind.type === "attachment" ? "a file" : kind.type === "unsupported" ? `a ${kind.wireType.toLowerCase().replace(/_/g, " ")} value` : "this"
    const next = field.mandatory ? "It is required, so press o to finish the form in the browser." : "Enter skips it, or o opens the form in the browser."
    return <text fg={theme.warning} wrapMode="word" width={inner}>{`This field takes ${what}, which the terminal cannot fill. ${next}`}</text>
  }
  if (kind.type === "choice") {
    const chosen = mode.answers.get(field.id) ?? []
    const first = Math.max(0, Math.min(mode.cursor - Math.floor(MAX_CHOICES / 2), kind.options.length - MAX_CHOICES))
    return (
      <>
        {kind.options.slice(first, first + MAX_CHOICES).map((option, offset) => {
          const selected = first + offset === mode.cursor
          const box = kind.multi ? (chosen.includes(option.id) ? "[x] " : "[ ] ") : ""
          return (
            <text key={option.id} wrapMode="none" bg={selected ? theme.selection : undefined}>
              <span fg={theme.accent}>{selected ? " ▸ " : "   "}</span>
              <span fg={theme.text}>{fit(`${box}${option.title}`, inner - 3)}</span>
            </text>
          )
        })}
      </>
    )
  }
  return (
    <box height={kind.type === "text" && kind.lines === "many" ? 5 : 1} flexDirection="row">
      {kind.type === "text" && kind.lines === "many" ? (
        <TextArea value={mode.draft} placeholder="Alt+Enter starts a new line" onInput={onDraft} />
      ) : (
        <TextInput value={mode.draft} placeholder={PLACEHOLDERS[kind.type] ?? ""} onInput={onDraft} />
      )}
    </box>
  )
}

/** After the last field: every answer on the way, and what Enter does with them. */
function Review({ mode, inner, theme }: { mode: FormMode & FormFilling; inner: number; theme: Theme }) {
  const steps = formSteps(mode.definition, mode.answers)
  const label = Math.min(28, Math.max(...steps.map((step) => Bun.stringWidth(step.field.title))) + 2)
  return (
    <>
      <text fg={theme.heading}>Review</text>
      {steps.slice(0, HEIGHT - 9).map(({ field }) => {
        const values = mode.answers.get(field.id) ?? []
        const answer = cannotFill(field) ? "(in the browser only)" : values.length === 0 ? "" : answerText(field, values)
        return (
          <text key={field.id} wrapMode="none">
            <span fg={theme.dim}>{fit(field.title, label)}</span>
            <span fg={cannotFill(field) ? theme.dim : theme.text}>{truncate(answer.replace(/\s+/g, " "), inner - label)}</span>
          </text>
        )
      })}
      <text fg={theme.dim} marginTop={1}>{mode.sending ? "Sending..." : "Enter sends the request to Wrike."}</text>
    </>
  )
}

/** A request form over the panes, one field at a time, then a review that sends it. */
export function RequestForm({ state, mode, screen, onDraft }: { state: State; mode: FormMode; screen: { width: number; height: number }; onDraft: (text: string) => void }) {
  const theme = useTheme()
  // On a narrow terminal the form takes the whole width, so no pane border peeks out beside its own.
  const width = screen.width < WIDTH + 8 ? screen.width : WIDTH
  const inner = width - 4
  const title = `Request: ${truncate(mode.form.title, inner - 12)}`
  const body = (() => {
    switch (mode.phase) {
      case "loading":
        return <text fg={theme.dim}>Loading the form...</text>
      case "failed":
        return (
          <text fg={theme.error} wrapMode="word" width={inner}>
            {`${describeError(mode.error).replace(/\.$/, "")}. Enter tries again, o opens the form in the browser.`}
          </text>
        )
      case "processing":
        return (
          <text fg={theme.dim} wrapMode="word" width={inner}>
            Wrike is still processing the request. Checking every 5 seconds. It is not sent again.
          </text>
        )
      case "filling": {
        const steps = formSteps(mode.definition, mode.answers)
        const step = currentStep(mode)
        if (!step) return <Review mode={mode} inner={inner} theme={theme} />
        const { field, page } = step
        return (
          <>
            <text wrapMode="none">
              <span fg={theme.dim}>{fit(page.title || "Request", inner - 16)}</span>
              <span fg={theme.dim}>{`Field ${mode.at + 1} of ${steps.length}`.padStart(16)}</span>
            </text>
            <text fg={theme.heading} marginTop={1} wrapMode="word" width={inner}>
              {`${field.title}${field.mandatory ? " *" : ""}`}
            </text>
            {field.helperText ? (
              <text fg={theme.dim} wrapMode="word" width={inner} height={Math.min(4, helperLines(field.helperText, inner))}>
                {field.helperText.trim()}
              </text>
            ) : null}
            <box marginTop={1} flexDirection="column">
              <Editor mode={mode} field={field} inner={inner} theme={theme} onDraft={onDraft} />
            </box>
          </>
        )
      }
    }
  })()
  return (
    <Overlay title={title} width={width} height={HEIGHT} screen={screen}>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {body}
      </box>
    </Overlay>
  )
}
