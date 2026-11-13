import { choicesOf, fieldEditor, inputText, parseInput, writeText, type CustomField, type FieldWrite } from "../../domain/fields"
import { anySet, CHOICE, CLEAR_FIELD, editRows, fieldDefs, OTHER_VALUE, pickerOptions, sharedValue } from "../selectors"
import { EDIT_FIELDS, type EditField, type EditRow, type EditTextMode, type Effect, type FieldEdit, type Origin, type PickerMode, type State, type Update } from "../state"
import { info } from "./core"

const isEditField = (field: string): field is EditField => (EDIT_FIELDS as readonly string[]).includes(field)

const sameRow = (a: EditRow, b: EditRow) => (a.kind === "core" ? b.kind === "core" && a.field === b.field : b.kind === "custom" && a.id === b.id)

/** Where an editor returns when it closes: the walk on the row it edited, or browsing. */
export function closeEditor(state: State, mode: EditTextMode | PickerMode): State {
  const row: EditRow | null = mode.field === "custom" ? { kind: "custom", id: mode.edit.id } : isEditField(mode.field) ? { kind: "core", field: mode.field } : null
  const edited = row ? editRows(state).findIndex((candidate) => sameRow(candidate, row)) : -1
  return { ...state, mode: mode.origin === "edit" && edited >= 0 ? { kind: "edit", field: edited } : { kind: "browse" } }
}

/** Opens the editor a custom field's type takes, or says why it has none. A checkbox has no editor: it flips at once. */
export function openFieldEditor(state: State, edit: FieldEdit, origin: Origin): Update {
  const field = fieldDefs(state.customFields).get(edit.id)
  if (!field) {
    const why = state.customFields.state === "loading" ? "The custom fields are still loading" : "Wrike did not describe this field, so it cannot be edited"
    return [{ ...state, flash: info(why) }, []]
  }
  const editor = fieldEditor(field)
  const current = sharedValue(state, edit)
  switch (editor.kind) {
    case "none":
      return [{ ...state, flash: info(editor.why) }, []]
    case "toggle":
      return writeField(state, edit, field, current === "true" ? null : "true")
    case "type":
      return [{ ...state, mode: { kind: "edit-text", field: "custom", edit, draft: inputText(field.kind, current), origin } }, []]
    case "pick": {
      const held = current === null ? [] : editor.multi ? choicesOf(current) : [current]
      const mode: PickerMode = { kind: "picker", field: "custom", edit, query: "", cursor: 0, chosen: editor.multi ? held.map((value) => CHOICE + value) : [], origin }
      const at = editor.multi ? 0 : pickerOptions(state, mode).findIndex((option) => option.id === CHOICE + held[0])
      return [{ ...state, mode: { ...mode, cursor: Math.max(0, at) } }, []]
    }
  }
}

/** Saves typed text after checking it against the field's type. A refusal keeps the text in place with the reason. */
export function submitFieldText(state: State, mode: EditTextMode & { field: "custom" }): Update {
  const field = fieldDefs(state.customFields).get(mode.edit.id)
  if (!field) return [closeEditor(state, mode), []]
  const parsed = parseInput(field.kind, mode.draft)
  if (!parsed.ok) return [{ ...state, mode: { ...mode, error: parsed.message } }, []]
  return writeField(closeEditor(state, mode), mode.edit, field, parsed.value)
}

/** Applies a custom field's picker: a choice, the chosen set, another value to type, or a clear. */
export function submitFieldPicker(state: State, mode: PickerMode & { field: "custom" }): Update {
  const field = fieldDefs(state.customFields).get(mode.edit.id)
  if (!field) return [closeEditor(state, mode), []]
  const closed = closeEditor(state, mode)
  if (field.kind.type === "Multiple") {
    const chosen = mode.chosen.flatMap((id) => (id.startsWith(CHOICE) ? [id.slice(CHOICE.length)] : []))
    return writeField(closed, mode.edit, field, chosen.length > 0 ? chosen : null)
  }
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!option) return [state, []]
  if (option.id === CLEAR_FIELD) return writeField(closed, mode.edit, field, null)
  if (option.id === OTHER_VALUE) {
    const current = sharedValue(state, mode.edit)
    const typedBefore = current !== null && field.kind.type === "DropDown" && !field.kind.options.includes(current) ? current : ""
    const draft = mode.query || typedBefore
    return [{ ...state, mode: { kind: "edit-text", field: "custom", edit: mode.edit, draft, origin: mode.origin } }, []]
  }
  return writeField(closed, mode.edit, field, option.id.slice(CHOICE.length))
}

/** Whether a value is what every edited task already holds, so writing it would change nothing. */
function unchanged(state: State, edit: FieldEdit, value: FieldWrite): boolean {
  if (value === null) return !anySet(state, edit)
  const current = sharedValue(state, edit)
  if (current === null) return false
  if (!Array.isArray(value)) return current === value
  const held = choicesOf(current)
  return held.length === value.length && value.every((choice) => held.includes(choice))
}

/** Sends the value to each edited task. Each answer is checked for it, since Wrike drops a field that does not apply and still answers 200. */
export function writeField(state: State, edit: FieldEdit, field: CustomField, value: FieldWrite): Update {
  if (unchanged(state, edit, value)) return [state, []]
  const done = value === null ? `${field.title} cleared` : `${field.title} set to ${writeText(field.kind, value)}`
  const effects = edit.taskIds.map(
    (taskId): Effect => ({ kind: "update-task", taskId, patch: { field: "custom", id: field.id, value }, done, check: { id: field.id, title: field.title, value } }),
  )
  return [{ ...state, flash: info("Saving...") }, effects]
}
