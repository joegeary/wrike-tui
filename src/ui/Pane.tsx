import type { ReactNode } from "react"
import { truncate } from "./format"
import { useTheme } from "./theme"

/** The corners, the dash before the title and the spaces around it. A title wider than what is left is not drawn at all. */
const TITLE_CHROME = 6

export function Pane(props: { number: number; title: string; width: number; focused: boolean; children: ReactNode }) {
  const theme = useTheme()
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.accent : theme.border}
      title={` ${truncate(`${props.number} ${props.title}`, Math.max(0, props.width - TITLE_CHROME))} `}
      titleColor={props.focused ? theme.accent : theme.dim}
      width={props.width}
      height="100%"
      flexDirection="column"
      backgroundColor={theme.background}
    >
      {props.children}
    </box>
  )
}
