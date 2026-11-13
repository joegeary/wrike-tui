import { useRef } from "react"
import { contactName, currentList, currentView, folderTitles, listCursor, listRows, statusOf, type PaneRow } from "../app/selectors"
import type { State } from "../app/state"
import type { ColumnKey, GroupKey } from "../domain/list"
import { dueDay, permalinkId, startDay, type InboxEntry } from "../domain/model"
import { scopeTitle } from "../domain/scope"
import type { ListRow } from "../domain/shape"
import { retryText } from "../wrike/errors"
import { fit, fitAfter, fitRight, humanize, listDay, relativeTime, truncate } from "./format"
import { windowCount, windowStart } from "./layout"
import { Pane, titleRoom } from "./Pane"
import { statusColor, useTheme, type Color, type Theme } from "./theme"
import { TextInput } from "./TextInput"

/** The columns a row gives each field, its separating space included. The title takes what is left. */
const COLUMN_WIDTHS: Record<Exclude<ColumnKey, "title">, number> = { importance: 2, status: 14, assignees: 15, due: 9, start: 9, updated: 8, folder: 17, id: 12 }
/** When the title would get fewer columns than this, columns are dropped, the first of these first. */
const MIN_TITLE = 24
const DROP_ORDER: ColumnKey[] = ["id", "folder", "start", "updated", "assignees", "status"]
const GROUP_LABELS: Record<GroupKey, string> = { status: "status", importance: "importance", assignee: "assignee", due: "due", folder: "folder", none: "" }

const rowHeight = (row: PaneRow) => (row.kind === "entry" ? 2 : 1)

/** The columns that fit, in the order the spec lists them, always with the title. */
export function fittingColumns(columns: ColumnKey[], width: number): ColumnKey[] {
  let kept = columns.includes("title") ? columns : (["title", ...columns] as ColumnKey[])
  const fixed = (list: ColumnKey[]) => list.reduce((sum, column) => sum + (column === "title" ? 0 : COLUMN_WIDTHS[column]), 0)
  for (const drop of DROP_ORDER) {
    if (width - fixed(kept) >= MIN_TITLE) break
    kept = kept.filter((column) => column !== drop)
  }
  return kept
}

/** The scope, how much is loaded and how it is shaped. A long scope name gives way, so the count and the shaping always show. */
function paneTitle(state: State, room: number): string {
  const { scope } = state
  if (scope.kind === "inbox") {
    const refreshing = state.inbox.state === "loading" && state.inbox.previous ? " (refreshing)" : ""
    return `Inbox${state.includeRead ? " (with read)" : ""}${refreshing}`
  }
  const list = currentList(state)
  const { spec } = currentView(state)
  const loaded = list && (list.items.length > 0 || (list.loading === null && list.error === null))
  const parts = [
    ...(spec.group === "none" ? [] : [GROUP_LABELS[spec.group]]),
    ...(spec.filters.length > 0 ? [`${spec.filters.length} ${spec.filters.length === 1 ? "filter" : "filters"}`] : []),
    ...(spec.completed && scope.kind !== "search" ? ["all statuses"] : []),
  ]
  const count = loaded ? `  ${list.items.length}${list.next === null ? "" : "+"}` : ""
  const refreshing = list?.loading === "first" && list.items.length > 0 ? " (refreshing)" : ""
  const shaping = `${count}${parts.map((part) => ` · ${part}`).join("")}${refreshing}`
  return `${truncate(scopeTitle(scope), Math.max(6, room - Bun.stringWidth(shaping)))}${shaping}`
}

function emptyText(state: State): string {
  const { scope } = state
  const { spec } = currentView(state)
  if (scope.kind === "inbox") return state.includeRead ? "The Inbox is empty." : "No unread notifications. Press a to show read ones."
  if (spec.filters.length > 0 && (currentList(state)?.items.length ?? 0) > 0) return "No loaded task matches the filters. Press : and clear them."
  switch (scope.kind) {
    case "todo":
      return "No active task is assigned to you."
    case "search":
      return `No task matches "${scope.query}".`
    case "space":
    case "folder":
      return spec.completed ? "No tasks here." : "No active task here. Press x to show completed ones."
  }
}

function Notice({ state, width, theme, empty }: { state: State; width: number; theme: Theme; empty: boolean }) {
  const list = currentList(state)
  const error = state.scope.kind === "inbox" ? (state.inbox.state === "error" ? state.inbox.error : null) : (list?.error ?? null)
  const loading = state.scope.kind === "inbox" ? state.inbox.state === "loading" || state.inbox.state === "idle" : !list || list.loading === "first"
  if (error) return <text fg={theme.error} wrapMode="word" width={width}>{retryText(error)}</text>
  if (!empty) return null
  if (loading) return <text fg={theme.dim}>Loading...</text>
  return <text fg={theme.dim} wrapMode="word" width={width}>{emptyText(state)}</text>
}

function EntryRow({ entry, state, width, selected, theme }: { entry: InboxEntry; state: State; width: number; selected: boolean; theme: Theme }) {
  const bg = selected ? theme.selection : undefined
  const dim = selected ? theme.selectedDim : theme.dim
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
        <span fg={entry.unread ? theme.accent : dim}>{entry.unread ? "● " : "○ "}</span>
        <span fg={theme.heading}>{`${kind} `}</span>
        <span fg={entry.item ? theme.text : dim}>{title}</span>
        <span fg={dim}>{` ${when}`}</span>
      </text>
      <text wrapMode="none" bg={bg} fg={dim}>
        {`  ${fit(second, width - 2)}`}
      </text>
    </>
  )
}

type Cell = { text: string; fg: Color }

function TaskRow(props: { row: ListRow & { kind: "task" }; state: State; columns: ColumnKey[]; width: number; indent: number; nested: boolean; selected: boolean; theme: Theme }) {
  const { row, state, theme, selected } = props
  const { task } = row
  const dim = selected ? theme.selectedDim : theme.dim
  const due = dueDay(task.dates)
  const start = startDay(task.dates)
  const overdue = due !== null && due < state.clock.today && task.statusGroup === "Active"
  const titleWidth = Math.max(0, props.width - props.indent - props.columns.reduce((sum, column) => sum + (column === "title" ? 0 : COLUMN_WIDTHS[column]), 0))
  const cell = (column: ColumnKey): Cell => {
    switch (column) {
      case "importance":
        return { text: task.importance === "High" ? "! " : task.importance === "Low" ? "↓ " : "  ", fg: task.importance === "High" ? theme.error : dim }
      case "title": {
        const marker = props.nested ? (row.hasChildren ? (row.expanded ? "▾ " : "▸ ") : "  ") : ""
        return { text: fitAfter(`${"  ".repeat(row.depth)}${marker}`, task.title, titleWidth), fg: task.statusGroup === "Active" ? theme.text : dim }
      }
      case "status": {
        const status = statusOf(state, task)
        return { text: ` ${fit(status?.name ?? task.statusGroup, COLUMN_WIDTHS.status - 1)}`, fg: statusColor(theme, status?.color) }
      }
      case "assignees":
        return { text: ` ${fit(task.assigneeIds.map((id) => contactName(state, id).split(" ")[0]).join(", "), COLUMN_WIDTHS.assignees - 1)}`, fg: dim }
      case "due":
        return { text: fitRight(due ? listDay(due, state.clock.today) : "", COLUMN_WIDTHS.due), fg: overdue ? theme.error : dim }
      case "start":
        return { text: fitRight(start ? listDay(start, state.clock.today) : "", COLUMN_WIDTHS.start), fg: dim }
      case "updated":
        return { text: fitRight(relativeTime(task.updatedDate, state.clock.now), COLUMN_WIDTHS.updated), fg: dim }
      case "folder": {
        const titles = folderTitles(state.trees)
        const parent = task.parentIds.find((id) => titles.has(id))
        return { text: ` ${fit(parent ? titles.get(parent)! : "", COLUMN_WIDTHS.folder - 1)}`, fg: dim }
      }
      case "id":
        return { text: fitRight(permalinkId(task.permalink) ?? "", COLUMN_WIDTHS.id), fg: dim }
    }
  }
  return (
    <text wrapMode="none" bg={selected ? theme.selection : undefined}>
      {" ".repeat(props.indent)}
      {props.columns.map((column) => {
        const { text, fg } = cell(column)
        return <span key={column} fg={fg}>{text}</span>
      })}
    </text>
  )
}

function GroupRow({ row, width, selected, theme }: { row: ListRow & { kind: "group" }; width: number; selected: boolean; theme: Theme }) {
  const lead = `${"  ".repeat(row.depth)}${row.collapsed ? "▸" : "▾"} `
  const label = fit(`${row.label} ${row.count}`, Math.min(Bun.stringWidth(`${row.label} ${row.count}`), Math.max(0, width - lead.length - 1)))
  return (
    <text wrapMode="none" bg={selected ? theme.selection : undefined} fg={row.label === "Overdue" ? theme.error : theme.heading}>
      {`${lead}${label} ${"─".repeat(Math.max(0, width - Bun.stringWidth(lead) - Bun.stringWidth(label) - 1))}`}
    </text>
  )
}

/** The line the list pane types into: a search, a title filter, or the title of a new task. */
const TYPING = {
  "search-input": { lead: "/ ", placeholder: "title, permalink or task ID" },
  "filter-input": { lead: "f ", placeholder: "title contains" },
  "new-task": { lead: "+ ", placeholder: "title of the new task" },
} as const

export function ListPane(props: { state: State; width: number; height: number; onDraft: (text: string) => void }) {
  const { state } = props
  const theme = useTheme()
  const inner = props.width - 2
  const { mode } = state
  const typing = mode.kind === "search-input" || mode.kind === "filter-input" || mode.kind === "new-task" ? mode : null
  const rows = listRows(state)
  const heights = rows.map(rowHeight)
  const cursor = listCursor(state)
  const failed = state.scope.kind === "inbox" ? state.inbox.state === "error" : Boolean(currentList(state)?.error)
  const available = props.height - 2 - (typing ? 1 : 0) - (failed ? 2 : 0)

  const firstRow = useRef(0)
  const start = windowStart(heights, Math.max(0, cursor), available, firstRow.current)
  firstRow.current = start
  const visible = rows.slice(start, start + windowCount(heights, start, available))
  // Tasks under a subgroup sit one step in, under their subgroup's label.
  const indent = rows.some((row) => row.kind === "group" && row.depth === 1) ? 2 : 0
  const columns = fittingColumns(currentView(state).spec.columns, inner - indent)
  const nested = rows.some((row) => row.kind === "task" && (row.hasChildren || row.depth > 0))

  return (
    <Pane number={2} title={paneTitle(state, titleRoom(props.width))} width={props.width} focused={state.focus === "list" && state.mode.kind === "browse"}>
      {typing ? (
        <box flexDirection="row" height={1}>
          <text fg={theme.accent}>{TYPING[typing.kind].lead}</text>
          <TextInput value={typing.draft} placeholder={TYPING[typing.kind].placeholder} onInput={props.onDraft} />
        </box>
      ) : null}
      <Notice state={state} width={inner} theme={theme} empty={rows.length === 0} />
      {visible.map((row, offset) => {
        const selected = start + offset === cursor
        switch (row.kind) {
          case "group":
            return <GroupRow key={row.id} row={row} width={inner} selected={selected} theme={theme} />
          case "entry":
            return <EntryRow key={row.id} entry={row.entry} state={state} width={inner} selected={selected} theme={theme} />
          case "task":
            return <TaskRow key={row.id} row={row} state={state} columns={columns} width={inner} indent={indent} nested={nested} selected={selected} theme={theme} />
          case "more":
            return (
              <text key={row.id} wrapMode="none" bg={selected ? theme.selection : undefined} fg={selected ? theme.selectedDim : theme.dim}>
                {fitAfter("  ", `${row.label}${row.label === "Load more" ? ", press Enter" : ""}`, inner)}
              </text>
            )
        }
      })}
    </Pane>
  )
}
