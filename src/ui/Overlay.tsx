import type { ReactNode } from "react"
import { theme } from "./theme"

export function Overlay(props: { title: string; width: number; height: number; screen: { width: number; height: number }; children: ReactNode }) {
  const width = Math.min(props.width, props.screen.width - 2)
  const height = Math.min(props.height, props.screen.height - 1)
  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((props.screen.width - width) / 2))}
      top={Math.max(0, Math.floor((props.screen.height - 1 - height) / 2))}
      width={width}
      height={height}
      zIndex={10}
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      title={` ${props.title} `}
      titleColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
    >
      {props.children}
    </box>
  )
}
