import { theme } from "./theme"

/** The one focused text field on screen. Its text lives in the reducer as the mode's draft. */
export function TextInput(props: { value: string; placeholder?: string; onInput: (text: string) => void }) {
  return (
    <input
      focused
      flexGrow={1}
      value={props.value}
      placeholder={props.placeholder ?? ""}
      onInput={props.onInput}
      backgroundColor={theme.selection}
      focusedBackgroundColor={theme.selection}
      textColor={theme.text}
      focusedTextColor={theme.text}
      placeholderColor={theme.dim}
    />
  )
}
