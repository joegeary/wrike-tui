import { kept } from "../../domain/fields"
import { customStatusId, userId, type TaskId, type UserId } from "../../domain/ids"
import { cancelStatuses, IMPORTANCES, type Task } from "../../domain/model"
import { describeError } from "../../wrike/errors"
import { bulkStatuses, heldTask, pickerOptions } from "../selectors"
import type { Action, BulkJob, BulkOutcome, BulkPicker, BulkTask, CancelPlan, ConfirmTarget, Flash, PickerMode, State, TaskCommand, Update } from "../state"
import { failure, info, putTask, then } from "./core"
import { historyStale } from "./load"
import { dropTask, refuseReadOnly } from "./work"

/** The task commands that act on every marked task. The rest act on the task under the cursor. */
const ON_MARKS: ReadonlySet<TaskCommand> = new Set<TaskCommand>(["status", "importance", "assignees", "assign-me", "set-field", "cancel", "delete"])
export const actsOnMarks = (command: TaskCommand) => ON_MARKS.has(command)

const named = (task: Task): BulkTask => ({ id: task.id, title: task.title })
const count = (n: number) => (n === 1 ? "1 task" : `${n} tasks`)

/** A picker over the marked tasks. `assigned` is who is on all of them, chosen to start with. */
function picker(change: BulkPicker, tasks: Task[], cursor = 0, assigned: UserId[] = []): PickerMode {
  return { kind: "picker", field: "bulk", change, tasks: tasks.map(named), assigned, query: "", cursor, chosen: [...assigned], origin: "browse" }
}

/** Sends one change to the tasks, or says nothing would change. */
export function runBulk(state: State, job: BulkJob, closed: State = state): Update {
  const size = job.kind === "cancel" ? job.plan.length : job.tasks.length
  return [{ ...closed, flash: info(`Saving ${count(size)}...`) }, [{ kind: "bulk", job }]]
}

/** Every marked task's Cancelled status, a pick when their one workflow has several, or why they cannot be cancelled together. */
function cancelMarked(state: State, tasks: Task[]): Update {
  const open = tasks.filter((task) => task.statusGroup !== "Cancelled")
  if (open.length === 0) return [{ ...state, flash: info("The marked tasks are already cancelled") }, []]
  const choices = open.map((task) => cancelStatuses(state.workflows, task.statusId))
  if (choices.some((statuses) => statuses.length === 0)) return [{ ...state, flash: info("A marked task's workflow has no Cancelled status") }, []]
  if (choices.every((statuses) => statuses.length === 1)) {
    const plan: CancelPlan[] = open.map((task, at) => ({ ...named(task), statusId: choices[at]![0]!.id }))
    return [{ ...state, mode: { kind: "confirm", target: { kind: "cancel-tasks", plan } } }, []]
  }
  if (bulkStatuses(state, open, "cancel").length === 0) {
    return [{ ...state, flash: info("The marked tasks' workflows differ. Cancel one workflow at a time") }, []]
  }
  return [{ ...state, mode: picker("cancel", open) }, []]
}

/** A task command on the marked tasks of the list. */
export function onMarks(state: State, command: TaskCommand, tasks: Task[]): Update {
  if (state.readOnly) return refuseReadOnly(state)
  const ready: State = { ...state, zoom: false }
  switch (command) {
    case "status": {
      if (bulkStatuses(state, tasks, "status").length === 0) return [{ ...state, flash: info("The marked tasks use different workflows. Mark tasks of one workflow") }, []]
      const shared = tasks.every((task) => task.statusId === tasks[0]!.statusId) ? tasks[0]!.statusId : null
      const at = bulkStatuses(state, tasks, "status").findIndex((status) => status.id === shared)
      return [{ ...ready, mode: picker("status", tasks, Math.max(0, at)) }, []]
    }
    case "importance": {
      const shared = tasks.every((task) => task.importance === tasks[0]!.importance) ? tasks[0]!.importance : null
      return [{ ...ready, mode: picker("importance", tasks, Math.max(0, IMPORTANCES.findIndex((importance) => importance === shared))) }, []]
    }
    case "assignees": {
      const assigned = tasks[0]!.assigneeIds.filter((id) => tasks.every((task) => task.assigneeIds.includes(id)))
      return [{ ...ready, mode: picker("assignees", tasks, 0, assigned) }, []]
    }
    case "assign-me": {
      const me = state.profile.userId
      const lacking = tasks.filter((task) => !task.assigneeIds.includes(me))
      if (lacking.length === 0) return [{ ...state, flash: info("The marked tasks are already assigned to you") }, []]
      return runBulk(state, { kind: "update", tasks: lacking.map(named), patch: { field: "assignees", add: [me], remove: [] }, done: "Assigned to you" })
    }
    case "set-field":
      return [{ ...ready, mode: { kind: "picker", field: "set-field", taskIds: tasks.map((task) => task.id), query: "", cursor: 0, chosen: [], origin: "browse" } }, []]
    case "cancel":
      return cancelMarked(ready, tasks)
    case "delete":
      return [{ ...ready, mode: { kind: "confirm", target: { kind: "delete-tasks", tasks: tasks.map(named) } } }, []]
    default:
      return [state, []]
  }
}

/** Enter in a picker opened on the marks: the change goes to every marked task it would change. */
export function submitBulkPicker(state: State, mode: PickerMode & { field: "bulk" }): Update {
  const closed: State = { ...state, mode: { kind: "browse" } }
  const tasks = mode.tasks.flatMap((task) => heldTask(state, task.id) ?? [])
  if (mode.change === "assignees") {
    const add = mode.chosen.filter((id) => !mode.assigned.includes(userId(id))).map(userId)
    const remove = mode.assigned.filter((id) => !mode.chosen.includes(id))
    if (add.length + remove.length === 0) return [closed, []]
    return runBulk(state, { kind: "update", tasks: mode.tasks, patch: { field: "assignees", add, remove }, done: "Assignees updated" }, closed)
  }
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!option) return [state, []]
  switch (mode.change) {
    case "status": {
      const changing = tasks.filter((task) => task.statusId !== option.id).map(named)
      if (changing.length === 0) return [{ ...closed, flash: info(`The marked tasks are already ${option.label}`) }, []]
      return runBulk(state, { kind: "update", tasks: changing, patch: { field: "status", statusId: customStatusId(option.id) }, done: `Status set to ${option.label}` }, closed)
    }
    case "importance": {
      const importance = IMPORTANCES.find((candidate) => candidate === option.id)
      const changing = tasks.filter((task) => task.importance !== importance).map(named)
      if (!importance || changing.length === 0) return [closed, []]
      return runBulk(state, { kind: "update", tasks: changing, patch: { field: "importance", importance }, done: `Importance set to ${importance}` }, closed)
    }
    case "cancel":
      return runBulk(state, { kind: "cancel", plan: mode.tasks.map((task) => ({ ...task, statusId: customStatusId(option.id) })) }, closed)
  }
}

/** `y` on a confirm about marked tasks. */
export function confirmBulk(state: State, target: ConfirmTarget & { kind: "delete-tasks" | "cancel-tasks" }): Update {
  const closed: State = { ...state, mode: { kind: "browse" } }
  return target.kind === "delete-tasks" ? runBulk(closed, { kind: "delete", tasks: target.tasks }) : runBulk(closed, { kind: "cancel", plan: target.plan })
}

/** The one line that reports a bulk change: how many it reached, and why the rest failed. */
function outcomeFlash(job: BulkJob, outcome: BulkOutcome): Flash {
  const { saved, deleted, failed } = outcome
  const why = failed[0] ? describeError(failed[0].error).replace(/\.$/, "") : ""
  const check = job.kind === "update" ? job.check : undefined
  const dropped = check ? saved.filter((task) => !kept(check.value, task.fields.find((value) => value.id === check.id)?.value)).length : 0
  const reached = saved.length + deleted.length - dropped
  if (reached === 0 && failed.length > 0) return failure(`Failed on ${count(failed.length)}: ${why}`)
  const done =
    job.kind === "update"
      ? `${job.done} on ${count(reached)}`
      : job.kind === "cancel"
        ? `Cancelled ${count(reached)}`
        : `Deleted ${count(reached)}. ${reached === 1 ? "It is" : "They are"} in the Recycle Bin`
  if (failed.length > 0) return failure(`${done}, failed on ${failed.length}: ${why}`)
  if (check && dropped > 0) return failure(`${done}. Wrike did not keep ${check.title} on ${count(dropped)}. It may not apply there.`)
  return info(done)
}

/** Every task a bulk change saved is put where it is listed, and every deleted one leaves the lists. One flash reports it all. */
export function bulkDone(state: State, action: Action & { type: "bulk-done" }): Update {
  const { outcome } = action
  let update: Update = [state, []]
  for (const task of outcome.saved) update = then(update, (next) => historyStale(putTask(next, task), task))
  const gone: TaskId[] = outcome.deleted.map((entry) => entry.task.id)
  for (const id of gone) update = then(update, (next) => [dropTask(next, id), []])
  return [{ ...update[0], flash: outcomeFlash(action.job, outcome) }, update[1]]
}
