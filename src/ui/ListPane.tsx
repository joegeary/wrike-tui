import { useRef } from "react"
import { listRows, statusOf, type ListRow } from "../app/selectors"
import type { Loadable, State, View } from "../app/state"
import { dueDay, type InboxEntry, type Task } from "../domain/model"
import { retryText } from "../wrike/errors"
import { fit, fitRight, humanize, listDay, relativeTime } from "./format"
import { windowCount, windowStart } from "./layout"
import { Pane } from "./Pane"
import { statusColor, theme } from "./theme"
import { TextInput } from "./TextInput"

const TITLES: Record<View, string> = { inbox: "Inbox", todo: "My to-do", search: "Search" }
const STATUS_WIDTH = 13
const DUE_WIDTH = 9
/** Below this inner width a task row drops its status column. */
const WIDE_ROW = 52

const rowHeight = (row: ListRow) => (row.kind === "entry" ? 2 : 1)

function paneTitle(state: State): string {
  const list = state.lists[state.view]
  const suffix = list.state === "loading" && list.previous ? " (refreshing)" : ""
  if (state.view === "inbox") return `${TITLES.inbox}${state.includeRead ? " (with read)" : ""}${suffix}`
  if (state.view === "search" && state.searchQuery) return `${TITLES.search}: ${state.searchQuery}${suffix}`
  return `${TITLES[state.view]}${suffix}`
}

function emptyText(state: State): string {
  switch (state.view) {
    case "inbox":
      return state.includeRead ? "The Inbox is empty." : "No unread notifications. Press a to show read ones."
    case "todo":
      return "No active task is assigned to you."
    case "search":
      return `No task matches "${state.searchQuery}".`
  }
}

function Notice({ list, state, width }: { list: Loadable<unknown[]>; state: State; width: number }) {
  if (list.state === "error") {
    return (
      <text fg={theme.error} wrapMode="word" width={width}>
        {retryText(list.error)}
      </text>
    )
  }
  if (list.state === "idle") {
    return <text fg={theme.dim} wrapMode="word" width={width}>Press / to search by title, or paste a permalink or a task ID.</text>
  }
  if (list.state === "loading" && !list.previous) return <text fg={theme.dim}>Loading...</text>
  if (list.state === "ready" && list.value.length === 0) {
    return <text fg={theme.dim} wrapMode="word" width={width}>{emptyText(state)}</text>
  }
  return null
}

function EntryRow({ entry, state, width, selected }: { entry: InboxEntry; state: State; width: number; selected: boolean }) {
  const bg = selected ? theme.selection : undefined
  // A type this version does not know keeps Wrike's own name for it, as the title when there is no item.
  const other = entry.kind === "Other" ? humanize(entry.label) : null
  const kind = fit(entry.kind, 8)
  const when = fitRight(relativeTime(entry.ts, state.clock.now), 6)
  const title = fit(entry.item?.title ?? other ?? "No linked item", Math.max(0, width - 2 - 9 - 7))
  const comment = entry.commentText?.split("\n")[0]
  const who = [entry.author?.name ?? "Wrike", ...(other && entry.item ? [other] : [])].join(", ")
  const second = `${who}${comment ? `: ${comment}` : ""}`
  return (
    <>
      <text wrapMode="none" bg={bg}>
        <span fg={entry.unread ? theme.accent : theme.dim}>{entry.unread ? "● " : "○ "}</span>
        <span fg={theme.heading}>{`${kind} `}</span>
        <span fg={entry.item ? theme.text : theme.dim}>{title}</span>
        <span fg={theme.dim}>{` ${when}`}</span>
      </text>
      <text wrapMode="none" bg={bg} fg={theme.dim}>
        {`  ${fit(second, width - 2)}`}
      </text>
    </>
  )
}

function TaskRow({ task, state, width, selected }: { task: Task; state: State; width: number; selected: boolean }) {
  const status = statusOf(state, task)
  const due = dueDay(task.dates)
  const overdue = due !== null && due < state.clock.today && task.statusGroup === "Active"
  const wide = width >= WIDE_ROW
  const titleWidth = Math.max(0, width - 2 - (wide ? STATUS_WIDTH + 1 : 0) - DUE_WIDTH)
  const marker = task.importance === "High" ? "!" : task.importance === "Low" ? "↓" : " "
  return (
    <text wrapMode="none" bg={selected ? theme.selection : undefined}>
      <span fg={task.importance === "High" ? theme.error : theme.dim}>{`${marker} `}</span>
      <span fg={task.statusGroup === "Active" ? theme.text : theme.dim}>{fit(task.title, titleWidth)}</span>
      {wide ? <span fg={statusColor(status?.color)}>{` ${fit(status?.name ?? task.statusGroup, STATUS_WIDTH)}`}</span> : null}
      <span fg={overdue ? theme.error : theme.dim}>{fitRight(due ? listDay(due, state.clock.today) : "", DUE_WIDTH)}</span>
    </text>
  )
}

function Heading({ row, width }: { row: ListRow & { kind: "heading" }; width: number }) {
  const label = `── ${row.name} ${row.count} `
  return (
    <text wrapMode="none" fg={row.name === "Overdue" ? theme.error : theme.heading}>
      {label + "─".repeat(Math.max(0, width - Bun.stringWidth(label)))}
    </text>
  )
}

export function ListPane(props: { state: State; width: number; height: number; onDraft: (text: string) => void }) {
  const { state } = props
  const inner = props.width - 2
  const searching = state.mode.kind === "search-input"
  const rows = listRows(state)
  const heights = rows.map(rowHeight)
  const cursor = state.cursor[state.view]
  const cursorRow = rows.findIndex((row) => row.kind !== "heading" && row.index === cursor)
  const list: Loadable<unknown[]> = state.lists[state.view]
  const notice = <Notice list={list} state={state} width={inner} />
  const showsNotice = list.state === "error" || rows.length === 0
  const available = props.height - 2 - (searching ? 1 : 0) - (list.state === "error" ? 2 : 0)

  const firstRow = useRef(0)
  let start = windowStart(heights, Math.max(0, cursorRow), available, firstRow.current)
  // Keep a bucket heading on screen with its first task.
  if (start > 0 && start === cursorRow && rows[start - 1]?.kind === "heading" && heights[start]! < available) start -= 1
  firstRow.current = start
  const visible = rows.slice(start, start + windowCount(heights, start, available))

  return (
    <Pane number={2} title={paneTitle(state)} width={props.width} focused={state.focus === "list" && state.mode.kind === "browse"}>
      {state.mode.kind === "search-input" ? (
        <box flexDirection="row" height={1}>
          <text fg={theme.accent}>/ </text>
          <TextInput value={state.mode.draft} placeholder="title, permalink or task ID" onInput={props.onDraft} />
        </box>
      ) : null}
      {showsNotice ? notice : null}
      {visible.map((row) => {
        switch (row.kind) {
          case "heading":
            return <Heading key={`heading-${row.name}`} row={row} width={inner} />
          case "entry":
            return <EntryRow key={row.entry.id} entry={row.entry} state={state} width={inner} selected={row.index === cursor} />
          case "task":
            return <TaskRow key={row.task.id} task={row.task} state={state} width={inner} selected={row.index === cursor} />
        }
      })}
    </Pane>
  )
}
