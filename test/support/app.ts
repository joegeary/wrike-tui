import { reduce, start } from "../../src/app/reducer"
import { initialState, type Action, type Boot, type Details, type Effect, type State } from "../../src/app/state"
import { customStatusId, folderId, legacyItemId, spaceId, taskId, userId } from "../../src/domain/ids"
import type { Contact, InboxEntry, Task, TaskDates, Workflow } from "../../src/domain/model"
import type { ScopeKey } from "../../src/domain/scope"
import { DEFAULT_SETTINGS } from "../../src/domain/settings"
import type { FolderNode, Space, SpaceTree } from "../../src/domain/workspace"

export const ME = userId("ME")
export const PAT = userId("PAT")
export const RILEY = userId("RILEY")
export const clock = { now: "2026-11-12T16:00:00Z", today: "2026-11-12" }
export const profile = { host: "www.wrike.com", accountId: "ACC", userId: ME, name: "Sam Sample" }

export const status = (id: string, name: string, group: Workflow["statuses"][number]["group"] = "Active") => ({
  id: customStatusId(id),
  name,
  group,
  color: "Blue",
  hidden: false,
})
export const workflows: Workflow[] = [{ id: "W1", name: "Default", statuses: [status("NEW", "New"), status("WIP", "In Progress"), status("DONE", "Completed", "Completed")] }]
export const contacts: Contact[] = [
  { id: ME, name: "Sam Sample", email: "sam@example.test", active: true },
  { id: PAT, name: "Pat Example", email: "pat@example.test", active: true },
  { id: RILEY, name: "Riley Demo", email: null, active: true },
]

export function task(id: string, title: string, dates: TaskDates = { type: "Backlog" }, extra: Partial<Task> = {}): Task {
  return {
    id: taskId(id),
    title,
    statusId: customStatusId("NEW"),
    statusGroup: "Active",
    importance: "Normal",
    dates,
    assigneeIds: [ME],
    parentIds: [],
    subTaskIds: [],
    superTaskIds: [],
    permalink: `https://www.wrike.com/open.htm?id=${id.replace(/\D/g, "") || "1"}`,
    descriptionHtml: "",
    createdDate: "2026-10-01T00:00:00Z",
    updatedDate: "2026-11-10T00:00:00Z",
    ...extra,
  }
}

export const later = task("T3", "Later task", { type: "Milestone", due: "2026-12-01" })
export const overdue = task("T1", "Overdue task", { type: "Milestone", due: "2026-11-10" })
export const undated = task("T2", "Undated task")
export const todo = [later, undated, overdue]

export const mention: InboxEntry = {
  id: "n1",
  kind: "Mention",
  label: "Mention",
  unread: true,
  ts: "2026-11-12T15:00:00Z",
  item: { legacyId: legacyItemId("1")!, title: "Overdue task", baseType: "TASK", permalink: overdue.permalink },
  author: { name: "Pat Example" },
  commentText: "ping",
}
export const projectNote: InboxEntry = { ...mention, id: "n2", item: { ...mention.item!, baseType: "PROJECT", permalink: "https://www.wrike.com/open.htm?id=77" } }
export const report: InboxEntry = { ...mention, id: "n3", kind: "Other", label: "ReportReady", item: null }

export const ENG = spaceId("ENG")
export const OPS = spaceId("OPS")
export const spaces: Space[] = [
  { id: ENG, title: "Engineering", access: "Public" },
  { id: OPS, title: "Operations", access: "Private" },
]

export function tree(space: string, shape: Record<string, string[]>, projects: string[] = []): SpaceTree {
  const nodes = new Map<ReturnType<typeof folderId>, FolderNode>()
  for (const [id, children] of Object.entries(shape)) {
    nodes.set(folderId(id), {
      id: folderId(id),
      title: id === space ? "root" : `Folder ${id}`,
      childIds: children.map(folderId),
      kind: id === space ? "space" : projects.includes(id) ? "project" : "folder",
      project: projects.includes(id) ? { statusId: null, ownerIds: [] } : null,
    })
  }
  return nodes
}
/** Platform (A) holds Launch (B, a project) and C. B also sits directly under the space. */
export const engTree = tree("ENG", { ENG: ["A", "B"], A: ["B", "C"], B: [], C: [] }, ["B"])

export const boot = (extra: Partial<Boot> = {}): Boot => ({ settings: DEFAULT_SETTINGS, favorites: [], readOnly: false, flash: null, session: null, spaces: null, trees: new Map(), ...extra })

/** Applies actions in order and collects every effect. A string is a key press. */
export function play(state: State, ...actions: (Action | string)[]): { state: State; effects: Effect[] } {
  const effects: Effect[] = []
  for (const action of actions) {
    const [next, more] = reduce(state, typeof action === "string" ? { type: "key", key: action } : action)
    state = next
    effects.push(...more)
  }
  return { state, effects }
}

export const key = (text: string) => text as ScopeKey

export function tasksLoaded(scope: string, request: number, tasks: Task[], extra: { next?: string | null; more?: boolean; jump?: boolean } = {}): Action {
  return { type: "tasks-loaded", key: key(scope), request, clock, more: extra.more ?? false, jump: extra.jump ?? false, result: { ok: true, value: { tasks, next: extra.next ?? null } } }
}

/** The request number the last effect of that kind carried. */
export function requestOf(effects: Effect[], kind: Effect["kind"]): number {
  const effect = effects.findLast((candidate) => candidate.kind === kind)
  if (!effect || !("request" in effect)) throw new Error(`No ${kind} effect was emitted`)
  return effect.request
}

/** The first screen with everything answered: reference data, three notifications, three tasks of mine and two spaces. */
export function loaded(extra: Partial<Boot> = {}): State {
  const [started] = start(initialState(profile, clock, boot(extra)))
  return play(
    started,
    { type: "reference-loaded", result: { ok: true, value: { contacts, workflows } } },
    { type: "inbox-loaded", request: 1, clock, result: { ok: true, value: [mention, projectNote, report] } },
    tasksLoaded("todo", 1, todo),
    { type: "spaces-loaded", request: 1, from: "wrike", result: { ok: true, value: spaces } },
  ).state
}

/** Presses keys, then answers the list request they caused with `tasks`. */
export function showing(state: State, keys: string[], scope: string, tasks: Task[], extra: { next?: string | null } = {}): State {
  const pressed = play(state, ...keys)
  return play(pressed.state, tasksLoaded(scope, requestOf(pressed.effects, "load-tasks"), tasks, extra)).state
}

/** My to-do, shown and answered again. */
export const inTodo = (state: State = loaded()) => showing(state, ["t"], "todo", todo)

export const detailsOf = (opened: Task): Details => ({ task: opened, comments: [], folders: ["Platform"] })

/** The Engineering space opened in the nav pane with its tree loaded, the focus in the nav pane. */
export function withTree(state: State = loaded()): State {
  const opened = play(state, "1", "j", "j", "j", "space")
  return play(opened.state, { type: "tree-loaded", space: ENG, request: requestOf(opened.effects, "load-tree"), from: "wrike", result: { ok: true, value: engTree } }).state
}
