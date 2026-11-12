import type { ReactNode } from "react"
import { truncate } from "./format"
import { useTheme } from "./theme"

/** The corners, the dash before the title, the spaces around it and the pane number. A title wider than what is left is not drawn at all. */
const TITLE_CHROME = 8

/** The columns a pane of this width has for its title, after its number. */
export const titleRoom = (width: number) => Math.max(0, width - TITLE_CHROME)

export function Pane(props: { number: number; title: string; width: number; focused: boolean; children: ReactNode }) {
  const theme = useTheme()
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.accent : theme.border}
      title={` ${props.number} ${truncate(props.title, titleRoom(props.width))} `}
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
