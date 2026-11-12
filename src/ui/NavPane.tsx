import { unreadCount } from "../app/selectors"
import { shown, VIEWS, type State, type View } from "../app/state"
import { fit, fitRight } from "./format"
import { Pane } from "./Pane"
import { theme } from "./theme"

const LABELS: Record<View, string> = { inbox: "Inbox", todo: "My to-do", search: "Search" }

function badge(state: State, view: View): string {
  switch (view) {
    case "inbox":
      return String(unreadCount(state) ?? "")
    case "todo":
      return String(shown(state.lists.todo)?.length ?? "")
    case "search":
      return state.searchQuery
  }
}

export function NavPane({ state, width }: { state: State; width: number }) {
  const inner = width - 2
  return (
    <Pane number={1} title="Wrike" width={width} focused={state.focus === "nav" && state.mode.kind === "browse"}>
      {VIEWS.map((view) => {
        const current = view === state.view
        const label = `${current ? "▸" : " "} ${LABELS[view]}`
        const count = fitRight(badge(state, view), Math.max(0, inner - Bun.stringWidth(label) - 2))
        return (
          <text key={view} wrapMode="none" fg={current ? theme.accent : theme.text} bg={current ? theme.selection : undefined}>
            {`${label} ${count} `}
          </text>
        )
      })}
      <box flexGrow={1} />
      <text wrapMode="none" fg={theme.dim}>{` ${fit(state.profile.name, inner - 1)}`}</text>
    </Pane>
  )
}
