import { describe, expect, test } from "bun:test"
import { customStatusId, taskId, userId, type TaskId } from "../../src/domain/ids"
import { DEFAULT_SPECS, NOBODY, withFilter, withSort, type Filter, type ListSpec } from "../../src/domain/list"
import type { Task, TaskDates } from "../../src/domain/model"
import { cursorIndex, MORE_ROW, shapeList, taskRowId, type ListRow, type RowId, type ShapeContext } from "../../src/domain/shape"

const TODAY = "2026-11-12" // a Thursday
const PAT = userId("PAT")
const RILEY = userId("RILEY")
const due = (day: string): TaskDates => ({ type: "Milestone", due: day })

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id: taskId(id),
    title: `Task ${id}`,
    statusId: customStatusId("NEW"),
    statusGroup: "Active",
    importance: "Normal",
    dates: { type: "Backlog" },
    assigneeIds: [],
    parentIds: [],
    subTaskIds: [],
    superTaskIds: [],
    permalink: "https://www.wrike.com/open.htm?id=1",
    descriptionHtml: "",
    createdDate: "2026-10-01T00:00:00Z",
    updatedDate: "2026-11-01T00:00:00Z",
    ...extra,
  }
}

const ctx = (extra: Partial<ShapeContext> = {}): ShapeContext => ({
  today: TODAY,
  statuses: new Map([
    [customStatusId("NEW"), { name: "New", order: 0 }],
    [customStatusId("WIP"), { name: "In Progress", order: 1 }],
    [customStatusId("DONE"), { name: "Completed", order: 2 }],
  ]),
  contacts: new Map([
    [PAT, { name: "Pat Example" }],
    [RILEY, { name: "Riley Demo" }],
  ]),
  folders: new Map([
    ["F1", "Platform"],
    ["F2", "Launch"],
  ]),
  collapsed: new Set(),
  expanded: new Set(),
  more: null,
  ...extra,
})

const flat: ListSpec = { group: "none", subgroup: "none", sort: [{ key: "title", dir: "asc" }], filters: [], completed: false, columns: ["title"] }
const spec = (extra: Partial<ListSpec>): ListSpec => ({ ...flat, ...extra })

/** Rows as text: `# label count` for a group, the task ID indented by depth, `+`/`-` for closed and open subtasks. */
const sketch = (rows: ListRow[]) =>
  rows.map((row) => {
    if (row.kind === "group") return `${"  ".repeat(row.depth)}# ${row.label} ${row.count}${row.collapsed ? " (closed)" : ""}`
    if (row.kind === "more") return `... ${row.label}`
    return `${"  ".repeat(row.depth)}${row.task.id}${row.hasChildren ? (row.expanded ? " -" : " +") : ""}`
  })

const a = task("A", { statusId: customStatusId("WIP"), importance: "High", dates: due("2026-11-10"), assigneeIds: [PAT], parentIds: ["F1"], updatedDate: "2026-11-05T00:00:00Z" })
const b = task("B", { importance: "Low", dates: due("2026-11-12"), assigneeIds: [PAT, RILEY], parentIds: ["F9", "F2"], createdDate: "2026-10-05T00:00:00Z" })
const c = task("C", { statusId: customStatusId("DONE"), statusGroup: "Completed", dates: due("2026-11-14"), assigneeIds: [RILEY], parentIds: ["F1"], updatedDate: "2026-11-09T00:00:00Z" })
const d = task("D", { statusId: customStatusId("GONE"), dates: due("2026-12-01"), parentIds: ["F9"] })
const e = task("E", { importance: "High", createdDate: "2026-09-01T00:00:00Z" })
const all = [c, e, a, d, b]

describe("grouping", () => {
  test("none draws no group rows", () => {
    expect(sketch(shapeList(all, flat, ctx()))).toEqual(["A", "B", "C", "D", "E"])
  })

  test("status follows the workflow order, and a status no workflow holds comes last under its group name", () => {
    expect(sketch(shapeList(all, spec({ group: "status" }), ctx()))).toEqual(["# New 2", "B", "E", "# In Progress 1", "A", "# Completed 1", "C", "# Active 1", "D"])
  })

  test("importance runs High, Normal, Low", () => {
    expect(sketch(shapeList(all, spec({ group: "importance" }), ctx()))).toEqual(["# High 2", "A", "E", "# Normal 2", "C", "D", "# Low 1", "B"])
  })

  test("assignee draws a task under each of its people, and nobody's tasks last", () => {
    const rows = shapeList(all, spec({ group: "assignee" }), ctx())
    expect(sketch(rows)).toEqual(["# Pat Example 2", "A", "B", "# Riley Demo 2", "B", "C", "# Unassigned 2", "D", "E"])
    expect(rows.filter((row) => row.kind === "task" && row.task.id === "B").map((row) => row.id)).toEqual(["task:B", "task:B#2"] as never)
  })

  test("due uses the My to-do buckets, in their order", () => {
    expect(sketch(shapeList(all, spec({ group: "due" }), ctx()))).toEqual([
      "# Overdue 1", "A", "# Today 1", "B", "# This week 1", "C", "# Later 1", "D", "# No date 1", "E",
    ])
  })

  test("folder uses the first parent drawn in a loaded tree, else Other folders", () => {
    expect(sketch(shapeList(all, spec({ group: "folder" }), ctx()))).toEqual(["# Launch 1", "B", "# Platform 2", "A", "C", "# Other folders 2", "D", "E"])
  })

  test("a subgroup splits each group again, one level in", () => {
    expect(sketch(shapeList(all, spec({ group: "importance", subgroup: "status" }), ctx()))).toEqual([
      "# High 2", "  # New 1", "E", "  # In Progress 1", "A",
      "# Normal 2", "  # Completed 1", "C", "  # Active 1", "D",
      "# Low 1", "  # New 1", "B",
    ])
  })

  test("a subgroup equal to the group, or with no group, does nothing", () => {
    expect(sketch(shapeList(all, spec({ group: "importance", subgroup: "importance" }), ctx()))).toEqual(sketch(shapeList(all, spec({ group: "importance" }), ctx())))
    expect(sketch(shapeList(all, spec({ group: "none", subgroup: "status" }), ctx()))).toEqual(["A", "B", "C", "D", "E"])
  })

  test("a collapsed group keeps its row and count and hides its tasks, and so does a subgroup", () => {
    const rows = shapeList(all, spec({ group: "importance", subgroup: "status" }), ctx({ collapsed: new Set(["importance:High", "importance:Normal/status:DONE"]) }))
    expect(sketch(rows)).toEqual(["# High 2 (closed)", "# Normal 2", "  # Completed 1 (closed)", "  # Active 1", "D", "# Low 1", "  # New 1", "B"])
  })
})

describe("sorting", () => {
  const ids = (sort: ListSpec["sort"]) => sketch(shapeList(all, spec({ sort }), ctx()))

  test("each key in both directions", () => {
    expect(ids([{ key: "title", dir: "desc" }])).toEqual(["E", "D", "C", "B", "A"])
    expect(ids([{ key: "importance", dir: "asc" }])).toEqual(["A", "E", "C", "D", "B"])
    expect(ids([{ key: "status", dir: "asc" }])).toEqual(["B", "E", "A", "C", "D"])
    expect(ids([{ key: "updated", dir: "desc" }])).toEqual(["C", "A", "B", "D", "E"])
    expect(ids([{ key: "created", dir: "asc" }])).toEqual(["E", "A", "C", "D", "B"])
  })

  test("a task with no due date sorts last in either direction", () => {
    expect(ids([{ key: "due", dir: "asc" }])).toEqual(["A", "B", "C", "D", "E"])
    expect(ids([{ key: "due", dir: "desc" }])).toEqual(["D", "C", "B", "A", "E"])
  })

  test("later terms break the ties of earlier ones", () => {
    expect(ids([{ key: "importance", dir: "asc" }, { key: "title", dir: "desc" }])).toEqual(["E", "A", "D", "C", "B"])
    expect(ids([{ key: "importance", dir: "desc" }, { key: "due", dir: "desc" }])).toEqual(["B", "D", "C", "A", "E"])
  })

  test("titles sort the way people read them", () => {
    const titled = [task("1", { title: "item 10" }), task("2", { title: "Item 9" }), task("3", { title: "apple" })]
    expect(shapeList(titled, flat, ctx()).map((row) => (row.kind === "task" ? row.task.title : ""))).toEqual(["apple", "Item 9", "item 10"])
  })

  test("choosing a sort key puts it first and keeps the rest as tie breakers, and choosing it again flips it", () => {
    const once = withSort(DEFAULT_SPECS.folder, "due")
    expect(once.sort).toEqual([{ key: "due", dir: "asc" }, { key: "importance", dir: "asc" }, { key: "title", dir: "asc" }])
    expect(withSort(once, "due").sort[0]).toEqual({ key: "due", dir: "desc" })
    expect(withSort(once, "updated").sort.map((term) => term.key)).toEqual(["updated", "due", "importance", "title"])
  })
})

describe("filters", () => {
  const only = (...filters: Filter[]) => sketch(shapeList(all, spec({ filters }), ctx()))

  test("assignee matches any of the people, and the nobody ID matches unassigned tasks", () => {
    expect(only({ kind: "assignee", ids: [RILEY] })).toEqual(["B", "C"])
    expect(only({ kind: "assignee", ids: [NOBODY] })).toEqual(["D", "E"])
    expect(only({ kind: "assignee", ids: [PAT, NOBODY] })).toEqual(["A", "B", "D", "E"])
  })

  test("status and importance match any of their values", () => {
    expect(only({ kind: "status", ids: [customStatusId("WIP"), customStatusId("DONE")] })).toEqual(["A", "C"])
    expect(only({ kind: "importance", values: ["High", "Low"] })).toEqual(["A", "B", "E"])
  })

  test("each due range", () => {
    expect(only({ kind: "due", range: "overdue" })).toEqual(["A"])
    expect(only({ kind: "due", range: "today" })).toEqual(["B"])
    expect(only({ kind: "due", range: "week" })).toEqual(["B", "C"])
    expect(only({ kind: "due", range: "none" })).toEqual(["E"])
  })

  test("text matches the title, whatever the case", () => {
    const named = [task("1", { title: "Rotate API keys" }), task("2", { title: "Fix login" })]
    expect(sketch(shapeList(named, spec({ filters: [{ kind: "text", query: "api K" }] }), ctx()))).toEqual(["1"])
  })

  test("several filters must all hold", () => {
    expect(only({ kind: "assignee", ids: [PAT] }, { kind: "importance", values: ["High"] })).toEqual(["A"])
    expect(only({ kind: "assignee", ids: [PAT] }, { kind: "due", range: "none" })).toEqual([])
  })

  test("a spec holds one filter of each kind", () => {
    const first = withFilter(flat, "text", { kind: "text", query: "a" })
    const second = withFilter(first, "importance", { kind: "importance", values: ["High"] })
    expect(withFilter(second, "text", { kind: "text", query: "b" }).filters).toEqual([{ kind: "importance", values: ["High"] }, { kind: "text", query: "b" }])
    expect(withFilter(second, "text", null).filters).toEqual([{ kind: "importance", values: ["High"] }])
  })
})

describe("subtasks", () => {
  const parent = task("P", { subTaskIds: [taskId("S1"), taskId("S2")] })
  const s1 = task("S1", { superTaskIds: [taskId("P")], title: "b sub", subTaskIds: [taskId("G")] })
  const s2 = task("S2", { superTaskIds: [taskId("P")], title: "a sub", importance: "High" })
  const grand = task("G", { superTaskIds: [taskId("S1")] })
  const orphan = task("O", { superTaskIds: [taskId("ELSEWHERE")], importance: "High" })
  const family = [s1, orphan, grand, parent, s2]
  const open = (...ids: string[]) => ctx({ expanded: new Set(ids.map(taskId)) })

  test("nest under a parent that is in the list, closed until opened", () => {
    expect(sketch(shapeList(family, flat, ctx()))).toEqual(["O", "P +"])
    expect(sketch(shapeList(family, flat, open("P")))).toEqual(["O", "P -", "  S2", "  S1 +"])
    expect(sketch(shapeList(family, flat, open("P", "S1")))).toEqual(["O", "P -", "  S2", "  S1 -", "    G"])
  })

  test("a subtask whose parent is not loaded is a top-level row", () => {
    expect(sketch(shapeList([orphan, s1, s2], flat, ctx()))).toEqual(["S2", "S1", "O"])
  })

  test("grouping and sorting act on top-level rows, and children keep the sort inside their parent", () => {
    const rows = shapeList(family, spec({ group: "importance", sort: [{ key: "importance", dir: "asc" }, { key: "title", dir: "asc" }] }), open("P"))
    expect(sketch(rows)).toEqual(["# High 1", "O", "# Normal 1", "P -", "  S2", "  S1 +"])
  })

  test("a subtask the filter hides is gone, and one whose parent the filter hides moves to the top level", () => {
    const high: Filter = { kind: "importance", values: ["High"] }
    expect(sketch(shapeList(family, spec({ filters: [high] }), open("P")))).toEqual(["S2", "O"])
    const normal: Filter = { kind: "importance", values: ["Normal"] }
    expect(sketch(shapeList(family, spec({ filters: [normal] }), open("P")))).toEqual(["P -", "  S1 +"])
  })

  test("an opened task with no subtask in the list has nothing to open", () => {
    expect(shapeList([parent], flat, open("P"))).toMatchObject([{ hasChildren: false, expanded: false }])
  })

  test("a loop of subtasks still draws every task, and ends", () => {
    const x = task("X", { superTaskIds: [taskId("Y")] })
    const y = task("Y", { superTaskIds: [taskId("X")] })
    expect(sketch(shapeList([x, y], flat, open("X", "Y")))).toEqual(["X -", "  Y -", "    X"])
  })
})

describe("the more row", () => {
  test("ends the list while Wrike has more pages", () => {
    expect(sketch(shapeList([a], flat, ctx({ more: "available" })))).toEqual(["A", "... Load more"])
    expect(sketch(shapeList([a], flat, ctx({ more: "loading" })))).toEqual(["A", "... Loading more..."])
    expect(shapeList([], flat, ctx({ more: "available" })).at(-1)!.id).toBe(MORE_ROW)
  })
})

describe("cursor identity", () => {
  const at = (rows: ListRow[], id: string, index = 0) => cursorIndex(rows, { id: id as RowId, index })
  const grouped = spec({ group: "importance" })

  test("with no cursor yet it starts on the first task, not on a group row", () => {
    expect(cursorIndex(shapeList(all, grouped, ctx()), null)).toBe(1)
    expect(cursorIndex(shapeList(all, flat, ctx()), null)).toBe(0)
    expect(cursorIndex([], null)).toBe(-1)
  })

  test("follows its task through a regroup, a resort and a new page", () => {
    expect(at(shapeList(all, flat, ctx()), taskRowId(c.id))).toBe(2)
    expect(at(shapeList(all, grouped, ctx()), taskRowId(c.id))).toBe(4)
    expect(at(shapeList(all, spec({ sort: [{ key: "title", dir: "desc" }] }), ctx()), taskRowId(c.id))).toBe(2)
    expect(at(shapeList([task("0"), ...all], flat, ctx()), taskRowId(c.id))).toBe(3)
  })

  test("follows a task into another group after a save changed it", () => {
    const saved = all.map((candidate) => (candidate.id === c.id ? { ...c, importance: "High" as const } : candidate))
    expect(sketch(shapeList(saved, grouped, ctx())).slice(0, 4)).toEqual(["# High 3", "A", "C", "E"])
    expect(at(shapeList(saved, grouped, ctx()), taskRowId(c.id))).toBe(2)
  })

  test("stays on a group row by its key", () => {
    expect(at(shapeList(all, grouped, ctx()), "group:importance:Normal")).toBe(3)
    expect(at(shapeList(all, grouped, ctx({ collapsed: new Set(["importance:High"]) })), "group:importance:Normal")).toBe(1)
  })

  test("a second drawing of a task falls back to its first when the second is gone", () => {
    const byPerson = shapeList(all, spec({ group: "assignee" }), ctx())
    expect(at(byPerson, "task:B#2")).toBe(4)
    expect(at(shapeList(all, flat, ctx()), "task:B#2")).toBe(1)
  })

  test("when its row is gone it takes the row now at its old index, clamped to the end", () => {
    const without = all.filter((candidate) => candidate.id !== c.id)
    expect(at(shapeList(without, flat, ctx()), taskRowId(c.id), 2)).toBe(2)
    expect(at(shapeList(without, flat, ctx()), taskRowId(c.id), 9)).toBe(3)
  })
})

describe("scale", () => {
  test("a thousand tasks with subtasks shape in a few milliseconds", () => {
    const many: Task[] = []
    for (let n = 0; n < 1200; n++) {
      many.push(task(`T${n}`, {
        title: `Request ${String(n).padStart(4, "0")}`,
        importance: (["High", "Normal", "Low"] as const)[n % 3]!,
        statusId: customStatusId(["NEW", "WIP", "DONE"][n % 3]!),
        assigneeIds: n % 4 === 0 ? [] : [n % 2 ? PAT : RILEY],
        dates: n % 5 === 0 ? { type: "Backlog" } : due(`2026-11-${String(1 + (n % 28)).padStart(2, "0")}`),
        superTaskIds: n >= 1100 ? [taskId(`T${n % 50}`)] : [],
      }))
    }
    const shaped = spec({ group: "status", subgroup: "assignee", sort: DEFAULT_SPECS.folder.sort })
    const expanded = new Set<TaskId>(many.slice(0, 50).map((candidate) => candidate.id))
    shapeList(many, shaped, ctx({ expanded }))
    const started = performance.now()
    const rows = shapeList(many, shaped, ctx({ expanded }))
    const elapsed = performance.now() - started
    expect(rows.filter((row) => row.kind === "task")).toHaveLength(1200)
    expect(elapsed).toBeLessThan(50)
  })
})
