import { bucketTasks, type BucketName } from "../domain/buckets"
import type { UserId } from "../domain/ids"
import { findStatus, IMPORTANCES, statusChoices, type CustomStatus, type InboxEntry, type Task } from "../domain/model"
import { shown, type Mode, type State } from "./state"

export type ListRow =
  | { kind: "heading"; name: BucketName; count: number }
  | { kind: "task"; task: Task; index: number }
  | { kind: "entry"; entry: InboxEntry; index: number }

/** My to-do in display order: bucket by bucket. The cursor indexes this, so headings are never selected. */
export function todoTasks(state: State): Task[] {
  return bucketTasks(shown(state.lists.todo) ?? [], state.clock.today).flatMap((bucket) => bucket.tasks)
}

export function listRows(state: State): ListRow[] {
  switch (state.view) {
    case "inbox":
      return (shown(state.lists.inbox) ?? []).map((entry, index) => ({ kind: "entry", entry, index }))
    case "search":
      return (shown(state.lists.search) ?? []).map((task, index) => ({ kind: "task", task, index }))
    case "todo": {
      let index = 0
      return bucketTasks(shown(state.lists.todo) ?? [], state.clock.today).flatMap((bucket): ListRow[] => [
        { kind: "heading", name: bucket.name, count: bucket.tasks.length },
        ...bucket.tasks.map((task): ListRow => ({ kind: "task", task, index: index++ })),
      ])
    }
  }
}

export function itemCount(state: State): number {
  return state.view === "inbox" ? (shown(state.lists.inbox) ?? []).length : viewTasks(state).length
}

function viewTasks(state: State): Task[] {
  return state.view === "todo" ? todoTasks(state) : state.view === "search" ? (shown(state.lists.search) ?? []) : []
}

export function selectedTask(state: State): Task | null {
  return viewTasks(state)[state.cursor[state.view]] ?? null
}

export function selectedEntry(state: State): InboxEntry | null {
  return state.view === "inbox" ? ((shown(state.lists.inbox) ?? [])[state.cursor.inbox] ?? null) : null
}

export function openTask(state: State): Task | null {
  return state.details.state === "ready" ? state.details.value.task : null
}

export function statusOf(state: State, task: Task): CustomStatus | null {
  return findStatus(state.workflows, task.statusId)
}

export function contactName(state: State, id: UserId): string {
  return state.contacts.get(id)?.name ?? "Unknown user"
}

export function unreadCount(state: State): number | null {
  const entries = shown(state.lists.inbox)
  return entries ? entries.filter((entry) => entry.unread).length : null
}

export type PickerOption = { id: string; label: string; detail?: string; color?: string }

/** The options of the open picker after its filter. Needs the open task for the status picker. */
export function pickerOptions(state: State, mode: Mode & { kind: "picker" }): PickerOption[] {
  const matches = (text: string) => text.toLowerCase().includes(mode.query.toLowerCase())
  switch (mode.field) {
    case "status": {
      const task = openTask(state)
      const statuses = task ? statusChoices(state.workflows, task.statusId) : []
      return statuses
        .filter((status) => matches(status.name))
        .map((status) => ({ id: status.id, label: status.name, detail: status.group, color: status.color }))
    }
    case "importance":
      return IMPORTANCES.filter(matches).map((importance) => ({ id: importance, label: importance }))
    case "assignees":
      return [...state.contacts.values()]
        .filter((contact) => matches(contact.name) || matches(contact.email ?? ""))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((contact) => ({ id: contact.id, label: contact.name, ...(contact.email ? { detail: contact.email } : {}) }))
  }
}
