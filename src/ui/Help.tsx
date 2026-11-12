import { browseContexts, keyLabel, KEYMAP, type Context } from "../app/keymap"
import type { State } from "../app/state"
import { fit } from "./format"
import { Overlay } from "./Overlay"
import { theme } from "./theme"

const KEY_WIDTH = 9
const COLUMN_WIDTH = 42

type Line = { kind: "title"; text: string } | { kind: "binding"; keys: string; label: string } | { kind: "gap" }

function column(contexts: Context[], gaps: boolean): Line[] {
  return contexts.flatMap((context, index): Line[] => [
    ...(gaps && index > 0 ? [{ kind: "gap" } as const] : []),
    { kind: "title", text: KEYMAP[context].title },
    ...KEYMAP[context].bindings.map((binding): Line => ({ kind: "binding", keys: binding.keys.map(keyLabel).join(" "), label: binding.label })),
  ])
}

function Column({ lines, width }: { lines: Line[]; width: number }) {
  return (
    <box flexDirection="column" width={width}>
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

/** The keys that work in the pane the legend was opened from, read from the keymap table. */
export function Help({ state, screen }: { state: State; screen: { width: number; height: number } }) {
  const contexts = browseContexts(state)
  const local = contexts.filter((context) => context !== "global")
  const fits = (gaps: boolean) => Math.max(column(local, gaps).length, column(["global"], gaps).length) + 2 <= screen.height - 1
  const gaps = fits(true)
  const [left, right] = [column(local, gaps), column(["global"], gaps)]
  const columnWidth = Math.min(COLUMN_WIDTH, Math.floor((screen.width - 4) / 2))
  return (
    <Overlay title="Keys" width={columnWidth * 2 + 2} height={Math.max(left.length, right.length) + 2} screen={screen}>
      <box flexDirection="row">
        <Column lines={left} width={columnWidth} />
        <Column lines={right} width={columnWidth} />
      </box>
    </Overlay>
  )
}
