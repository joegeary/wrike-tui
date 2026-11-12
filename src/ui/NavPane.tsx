import { useRef } from "react"
import { isSelectable, nodeScope, type NavRow, type NavView } from "../app/nav"
import { navCursorRow, navRowsOf } from "../app/selectors"
import type { State } from "../app/state"
import { scopeKey } from "../domain/scope"
import { fit, fitAfter } from "./format"
import { windowCount, windowStart } from "./layout"
import { Pane } from "./Pane"
import { useTheme, type Theme } from "./theme"

const VIEW_LABELS: Record<NavView, string> = { inbox: "Inbox", todo: "My to-do", search: "Search" }
const INDENT = 2

/** True for the row that stands for what the list pane shows. */
function isScope(state: State, row: NavRow): boolean {
  if (row.kind === "view") return row.view === state.scope.kind
  if (row.kind === "favorite") return "id" in state.scope && row.favorite.kind === state.scope.kind && row.favorite.id === state.scope.id
  return row.kind === "node" && scopeKey(nodeScope(row)) === scopeKey(state.scope)
}

function Row({ row, state, width, selected, theme }: { row: NavRow; state: State; width: number; selected: boolean; theme: Theme }) {
  const bg = selected ? theme.selection : undefined
  const dim = selected ? theme.selectedDim : theme.dim
  const current = isScope(state, row)
  switch (row.kind) {
    case "heading":
      return <text wrapMode="none" fg={theme.heading}>{` ${fit(row.label, width - 1)}`}</text>
    case "note":
      return (
        <text wrapMode="none" fg={row.tone === "error" ? theme.error : theme.dim}>
          {fitAfter(" ".repeat(row.depth * INDENT + 3), row.text, width)}
        </text>
      )
    case "view": {
      const count = row.count === null ? "" : String(row.count)
      return (
        <text wrapMode="none" bg={bg}>
          <span fg={current ? theme.accent : theme.text}>{fitAfter("   ", VIEW_LABELS[row.view], Math.max(0, width - count.length - 1))}</span>
          <span fg={dim}>{`${count} `}</span>
        </text>
      )
    }
    case "favorite":
      return (
        <text wrapMode="none" bg={bg}>
          <span fg={row.missing ? dim : theme.heading}>{" ★ "}</span>
          <span fg={row.missing ? dim : current ? theme.accent : theme.text}>{fit(`${row.favorite.title}${row.missing ? " (not found)" : ""}`, width - 3)}</span>
        </text>
      )
    case "node": {
      const marker = row.loading ? "◌" : row.expanded ? "▾" : row.expandable ? "▸" : " "
      const lead = `${" ".repeat(row.depth * INDENT + 1)}${marker} `
      const project = "kind" in row.node && row.node.kind === "project"
      return (
        <text wrapMode="none" bg={bg}>
          <span fg={dim}>{lead}</span>
          <span fg={current ? theme.accent : project ? theme.link : theme.text}>{fit(row.node.title, Math.max(0, width - lead.length))}</span>
        </text>
      )
    }
  }
}

export function NavPane({ state, width, height }: { state: State; width: number; height: number }) {
  const theme = useTheme()
  const inner = width - 2
  const rows = navRowsOf(state)
  const cursor = navCursorRow(state)
  const cursorIndex = cursor ? rows.indexOf(cursor) : 0
  const heights = rows.map(() => 1)
  const available = height - 3
  const first = useRef(0)
  let start = windowStart(heights, cursorIndex, available, first.current)
  // A heading stays on screen with the first row under it.
  if (start > 0 && start === cursorIndex && !isSelectable(rows[start - 1]!)) start -= 1
  first.current = start
  const visible = rows.slice(start, start + windowCount(heights, start, available))
  return (
    <Pane number={1} title="Wrike" width={width} focused={state.focus === "nav" && state.mode.kind === "browse"}>
      {visible.map((row, offset) => (
        <Row key={"path" in row ? row.path : `${row.kind}-${start + offset}`} row={row} state={state} width={inner} selected={row === cursor} theme={theme} />
      ))}
      <box flexGrow={1} />
      <text wrapMode="none" fg={theme.dim}>{` ${fit(state.profile.name, inner - 1)}`}</text>
    </Pane>
  )
}
