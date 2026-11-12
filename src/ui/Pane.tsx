import type { ReactNode } from "react"
import { theme } from "./theme"

export function Pane(props: { number: number; title: string; width: number; focused: boolean; children: ReactNode }) {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.accent : theme.border}
      title={` ${props.number} ${props.title} `}
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
