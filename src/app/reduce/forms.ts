import { answerProblem, cannotFill, firstProblem, formSteps, formUrl, submission } from "../../domain/forms"
import { describeError } from "../../wrike/errors"
import { currentStep, pickerOptions } from "../selectors"
import { shown, type Action, type FormFilling, type FormMode, type Mode, type PickerMode, type State, type Update } from "../state"
import { clamp, failure, info } from "./core"
import { isCurrent, loading, open, request } from "./load"
import { refuseReadOnly } from "./work"

type Filling = FormMode & FormFilling

/** "Submit a request form": the picker searches Wrike's forms as the text is typed. */
export function openForms(state: State): Update {
  if (state.readOnly) return refuseReadOnly(state)
  return [{ ...state, zoom: false, forms: { state: "idle" }, mode: { kind: "picker", field: "request-form", query: "", cursor: 0, chosen: [], origin: "browse" } }, []]
}

/** A change to the form picker's text asks for a search once typing pauses. */
export function formsQuery(state: State): Update {
  if (state.mode.kind !== "picker" || state.mode.field !== "request-form") return [state, []]
  const [next, number] = request(state, "forms")
  const query = state.mode.query.trim()
  if (query === "") return [{ ...next, forms: { state: "idle" } }, []]
  return [{ ...next, forms: loading(state.forms) }, [{ kind: "search-forms", request: number, query }]]
}

/** Typing paused on this text, so it is searched, unless more was typed since. */
export function formsDue(state: State, action: Action & { type: "forms-due" }): Update {
  if (!isCurrent(state, "forms", action.request)) return [state, []]
  return [state, [{ kind: "load-forms", request: action.request, query: action.query }]]
}

export function formsLoaded(state: State, action: Action & { type: "forms-loaded" }): Update {
  if (!isCurrent(state, "forms", action.request)) return [state, []]
  const { result } = action
  const forms = result.ok ? ({ state: "ready", value: result.value } as const) : ({ state: "error", error: result.error, ...(shown(state.forms) ? { previous: shown(state.forms)! } : {}) } as const)
  const mode = state.mode.kind === "picker" ? { ...state.mode, cursor: 0 } : state.mode
  return [{ ...state, forms, mode, ...(result.ok ? {} : { flash: failure(describeError(result.error)) }) }, []]
}

function loadForm(state: State, form: FormMode["form"]): Update {
  const [next, number] = request(state, "form")
  return [{ ...next, mode: { kind: "form", form, phase: "loading" } }, [{ kind: "load-form", request: number, form }]]
}

/** Enter on a form in the picker opens it. */
export function pickForm(state: State, mode: PickerMode): Update {
  const option = pickerOptions(state, mode)[mode.cursor]
  const form = shown(state.forms)?.find((candidate) => candidate.id === option?.id)
  return form ? loadForm(state, form) : [state, []]
}

/** The field at `at`, with what was answered there before in the input or under the cursor. */
function goTo(mode: Filling, at: number): Filling {
  const steps = formSteps(mode.definition, mode.answers)
  const index = clamp(at, steps.length + 1)
  const field = steps[index]?.field
  const values = field ? (mode.answers.get(field.id) ?? []) : []
  const kind = field?.kind
  const cursor = kind?.type === "choice" && !kind.multi ? Math.max(0, kind.options.findIndex((option) => option.id === values[0])) : 0
  const { error: _cleared, ...rest } = mode
  return { ...rest, at: index, draft: kind?.type === "choice" ? "" : (values[0] ?? ""), cursor }
}

export function formLoaded(state: State, action: Action & { type: "form-loaded" }): Update {
  const { mode } = state
  if (mode.kind !== "form" || !isCurrent(state, "form", action.request)) return [state, []]
  if (!action.result.ok) return [{ ...state, mode: { kind: "form", form: mode.form, phase: "failed", error: action.result.error } }, []]
  const filling: Filling = { kind: "form", form: mode.form, phase: "filling", definition: action.result.value, answers: new Map(), at: 0, draft: "", cursor: 0, sending: false }
  return [{ ...state, mode: goTo(filling, 0) }, []]
}

/** What the current field's editor holds, written into the answers. A single choice is the highlighted one; check boxes are toggled straight into them. */
function withDraft(mode: Filling): Filling {
  const step = currentStep(mode)
  if (!step || cannotFill(step.field)) return mode
  const { kind } = step.field
  const answers = new Map(mode.answers)
  if (kind.type === "choice") {
    if (kind.multi) return mode
    const option = kind.options[mode.cursor]
    if (option) answers.set(step.field.id, [option.id])
  } else answers.set(step.field.id, mode.draft.trim() === "" ? [] : [mode.draft])
  return { ...mode, answers }
}

/**
 * Enter: on a field, keeps its answer and moves on once it stands; on the
 * review, sends the form, or goes back to the first field that blocks it.
 * After a failed load it tries again.
 */
export function formNext(state: State, mode: FormMode): Update {
  if (mode.phase === "failed") return loadForm(state, mode.form)
  if (mode.phase !== "filling" || mode.sending) return [state, []]
  const step = currentStep(mode)
  if (step) {
    const kept = withDraft(mode)
    const problem = answerProblem(step.field, kept.answers.get(step.field.id) ?? [])
    if (problem) return [{ ...state, mode: { ...kept, error: problem } }, []]
    return [{ ...state, mode: goTo(kept, mode.at + 1) }, []]
  }
  const steps = formSteps(mode.definition, mode.answers)
  const blocking = firstProblem(steps, mode.answers)
  if (blocking >= 0) {
    const back = goTo(mode, blocking)
    return [{ ...state, mode: { ...back, error: answerProblem(steps[blocking]!.field, mode.answers.get(steps[blocking]!.field.id) ?? []) ?? undefined } }, []]
  }
  const answers = submission(steps, mode.answers)
  if (answers.length === 0) return [{ ...state, mode: { ...mode, error: "Answer at least one field before sending" } }, []]
  const [next, number] = request(state, "form")
  return [{ ...next, mode: { ...mode, sending: true, error: undefined }, flash: info("Sending the request...") }, [{ kind: "submit-form", request: number, form: mode.form.id, answers }]]
}

/** Back one field, keeping what was typed there without checking it. */
export function formBack(state: State): Update {
  const { mode } = state
  if (mode.kind !== "form" || mode.phase !== "filling" || mode.sending || mode.at === 0) return [state, []]
  return [{ ...state, mode: goTo(withDraft(mode), mode.at - 1) }, []]
}

export function formDraft(mode: Filling, text: string): Mode {
  const { error: _cleared, ...rest } = mode
  return { ...rest, draft: text }
}

/** Arrows on a choice field move the highlight. */
export function formChoiceMove(mode: Filling, by: number): Mode {
  const kind = currentStep(mode)?.field.kind
  return kind?.type === "choice" ? { ...mode, cursor: clamp(mode.cursor + by, kind.options.length) } : mode
}

/** Space on check boxes picks the highlighted one, or drops it. */
export function formChoiceToggle(mode: Filling): Mode {
  const field = currentStep(mode)?.field
  if (field?.kind.type !== "choice" || !field.kind.multi) return mode
  const option = field.kind.options[mode.cursor]
  if (!option) return mode
  const held = mode.answers.get(field.id) ?? []
  const values = held.includes(option.id) ? held.filter((id) => id !== option.id) : [...held, option.id]
  const { error: _cleared, ...rest } = mode
  return { ...rest, answers: new Map(mode.answers).set(field.id, values) }
}

export function formBrowser(state: State, mode: FormMode): Update {
  // The flash says what happened, so a refusal shown on the field gives way to it.
  const quiet: Mode = mode.phase === "filling" ? formDraft(mode, mode.draft) : mode
  return [{ ...state, mode: quiet, flash: info("Opening the form in the browser") }, [{ kind: "open-url", url: formUrl(state.profile.host, mode.form.id) }]]
}

/** Esc closes the form. While Wrike has the submission it stays, and a submission still processing is left to Wrike, not sent again. */
export function closeForm(state: State, mode: FormMode): Update {
  if (mode.phase === "filling" && mode.sending) return [{ ...state, flash: info("Wrike has the request. Wait for its answer") }, []]
  // A load, a submission or a poll still on its way is dropped when it answers.
  const [next] = request(state, "form")
  const closed: State = { ...next, mode: { kind: "browse" } }
  if (mode.phase === "processing") return [{ ...closed, flash: info("Wrike is still processing the request. It shows in Wrike when it is done, and it was not sent again") }, []]
  return [closed, []]
}

export function formSubmitted(state: State, action: Action & { type: "form-submitted" }): Update {
  const { mode } = state
  if (mode.kind !== "form" || !isCurrent(state, "form", action.request)) return [state, []]
  const closed: State = { ...state, mode: { kind: "browse" } }
  const { result } = action
  if (!result.ok) {
    if (mode.phase !== "filling") return [{ ...closed, flash: failure(`Could not follow the request: ${describeError(result.error)}`) }, []]
    return [{ ...state, flash: null, mode: { ...mode, sending: false, error: `${describeError(result.error).replace(/\.$/, "")}. Enter sends it again` } }, []]
  }
  const answer = result.value
  switch (answer.kind) {
    case "completed":
      return open({ ...closed, flash: info(`Submitted "${mode.form.title}". Opening the request`) }, { kind: "legacy", id: answer.item }, null)
    case "processing": {
      const [next, number] = request(state, "form")
      return [{ ...next, flash: null, mode: { kind: "form", form: mode.form, phase: "processing", submission: answer.submission } }, [{ kind: "poll-form", request: number, submission: answer.submission }]]
    }
    case "refused":
      if (mode.phase === "filling" && answer.retrySafe) return [{ ...state, flash: null, mode: { ...mode, sending: false, error: `Wrike refused it: ${answer.message}` } }, []]
      return [{ ...closed, flash: failure(`Wrike did not take the request: ${answer.message}`) }, []]
    case "waiting":
      return [{ ...closed, flash: info("Wrike is still processing the request. It shows in Wrike when it is done, and it was not sent again") }, []]
  }
}
