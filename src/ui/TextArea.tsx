import type { KeyBinding, TextareaRenderable } from "@opentui/core"
import { useLayoutEffect, useRef } from "react"
import { useTheme } from "./theme"

/** Alt+Enter, which terminals tell apart from Enter, starts a new line. Enter itself belongs to the keymap. */
const NEW_LINE: KeyBinding[] = [{ name: "return", meta: true, action: "newline" }]

/**
 * A focused field of several lines. Its text lives in the reducer as the mode's
 * draft, and a draft changed there, like a picked mention, is put back here
 * with the cursor at the end.
 */
export function TextArea(props: { value: string; placeholder?: string; onInput: (text: string) => void }) {
  const theme = useTheme()
  const field = useRef<TextareaRenderable>(null)
  const value = useRef(props.value)
  value.current = props.value

  useLayoutEffect(() => {
    const area = field.current
    if (!area || area.plainText === props.value) return
    area.setText(props.value)
    area.gotoBufferEnd()
  }, [props.value])

  useLayoutEffect(() => void field.current?.gotoBufferEnd(), [])

  return (
    <textarea
      ref={field}
      focused
      flexGrow={1}
      initialValue={props.value}
      placeholder={props.placeholder ?? ""}
      keyBindings={NEW_LINE}
      onContentChange={() => {
        const text = field.current?.plainText
        if (text !== undefined && text !== value.current) props.onInput(text)
      }}
      backgroundColor={theme.selection}
      focusedBackgroundColor={theme.selection}
      textColor={theme.text}
      focusedTextColor={theme.text}
      placeholderColor={theme.dim}
    />
  )
}
