import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { isOffered, type Context } from "../app/commands"
import { boundCommands, browseContexts, CONTEXT_TITLES, keyLabel } from "../app/keymap"
import type { State } from "../app/state"
import type { UiBridge } from "./bridge"
import { fit } from "./format"
import { Overlay } from "./Overlay"
import { scrollBox } from "./scroll"
import { useTheme } from "./theme"

const KEY_WIDTH = 9
const COLUMN_WIDTH = 42

type Line = { kind: "title"; text: string } | { kind: "binding"; keys: string; label: string } | { kind: "gap" }

function column(state: State, contexts: Context[], gaps: boolean): Line[] {
  return contexts.flatMap((context, index): Line[] => [
    ...(gaps && index > 0 ? [{ kind: "gap" } as const] : []),
    { kind: "title", text: CONTEXT_TITLES[context] },
    ...boundCommands(context)
      .filter(({ command }) => isOffered(command, state))
      .map(({ command, keys }): Line => ({ kind: "binding", keys: keys.map(keyLabel).join(" "), label: command.title })),
  ])
}

function Column({ lines, width }: { lines: Line[]; width: number }) {
  const theme = useTheme()
  return (
    <box flexDirection="column" width={width} flexShrink={0}>
      {lines.map((line, index) => {
        if (line.kind === "gap") return <text key={index}> </text>
        if (line.kind === "title") {
          return (
            <text key={index} wrapMode="none" fg={theme.heading}>
              {` ${fit(line.text, width - 1)}`}
            </text>
          )
        }
        return (
          <text key={index} wrapMode="none">
            <span fg={theme.accent}>{` ${fit(line.keys, KEY_WIDTH)}`}</span>
            <span fg={theme.text}>{fit(line.label, width - KEY_WIDTH - 1)}</span>
          </text>
        )
      })}
    </box>
  )
}

/**
 * The two columns as drawn. When the pane's keys run past the screen and the
 * Anywhere column has room under it, the pane's last keys move to the top of
 * the second column, so everything shows without scrolling. A heading never
 * ends a column.
 */
function flow(left: Line[], right: Line[], rows: number): [Line[], Line[]] {
  if (left.length <= rows || right.length >= rows) return [left, right]
  let at = rows
  if (left[at - 1]?.kind === "title") at -= 1
  return [left.slice(0, at), [...left.slice(at), ...right]]
}

/** The keys that work in the pane the legend was opened from, read from the keymap and the command registry. It scrolls when it is taller than the screen. */
export function Help({ state, screen, bridge }: { state: State; screen: { width: number; height: number }; bridge: UiBridge }) {
  const scroll = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    bridge.scrollers.help = (to) => scrollBox(scroll.current, to)
    return () => void delete bridge.scrollers.help
  }, [bridge])

  const contexts = browseContexts(state)
  const local = contexts.filter((context) => context !== "global")
  const tallest = (gaps: boolean) => Math.max(column(state, local, gaps).length, column(state, ["global"], gaps).length)
  const gaps = tallest(true) + 2 <= screen.height - 1
  const [left, right] = flow(column(state, local, gaps), column(state, ["global"], gaps), screen.height - 3)
  // On a narrow terminal the legend takes the whole width, so no pane border shows beside its own.
  const columnWidth = Math.min(COLUMN_WIDTH, Math.floor((screen.width - 2) / 2))
  return (
    <Overlay title="Keys" width={columnWidth * 2 + 2} height={Math.max(left.length, right.length) + 2} screen={screen}>
      <scrollbox ref={scroll} flexGrow={1} flexShrink={1} scrollY>
        <box flexDirection="row">
          <Column lines={left} width={columnWidth} />
          <Column lines={right} width={columnWidth} />
        </box>
      </scrollbox>
    </Overlay>
  )
}
