import type { CustomStatusId, UserId } from "./ids"
import type { Importance, TaskDates } from "./model"

export type TaskPatch =
  | { field: "title"; title: string }
  | { field: "status"; statusId: CustomStatusId }
  | { field: "importance"; importance: Importance }
  | { field: "assignees"; add: UserId[]; remove: UserId[] }
  | { field: "dates"; dates: TaskDates }
  | { field: "description"; html: string }

/** A request parameter before encoding. Arrays and objects travel as JSON strings. */
export type ParamValue = string | number | boolean | readonly string[] | { readonly [key: string]: unknown }
export type Params = Record<string, ParamValue>

export function patchParams(patch: TaskPatch): Params {
  switch (patch.field) {
    case "title":
      return { title: patch.title }
    case "status":
      return { customStatus: patch.statusId }
    case "importance":
      return { importance: patch.importance }
    case "assignees":
      return {
        ...(patch.add.length > 0 ? { addResponsibles: patch.add } : {}),
        ...(patch.remove.length > 0 ? { removeResponsibles: patch.remove } : {}),
      }
    case "dates":
      return { dates: datesParam(patch.dates) }
    case "description":
      return { description: patch.html }
  }
}

function datesParam(dates: TaskDates): { [key: string]: unknown } {
  switch (dates.type) {
    case "Backlog":
      return { type: "Backlog" }
    case "Milestone":
      return { type: "Milestone", due: dates.due }
    case "Planned":
      return { type: "Planned", start: dates.start, due: dates.due }
  }
}

export function assigneePatch(current: UserId[], chosen: UserId[]): TaskPatch & { field: "assignees" } {
  return {
    field: "assignees",
    add: chosen.filter((id) => !current.includes(id)),
    remove: current.filter((id) => !chosen.includes(id)),
  }
}
