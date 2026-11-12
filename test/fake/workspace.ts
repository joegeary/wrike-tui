import { addDays } from "../../src/domain/dates"

export type FakeFolder = {
  id: string
  title: string
  childIds: string[]
  scope: string
  project?: { authorId: string; ownerIds: string[]; status: string; customStatusId: string; createdDate: string }
}

export type FakeSpace = { id: string; title: string; avatarUrl: string; accessType: string; archived: boolean }

export const SPACE = {
  personal: "IEAAAAAAI4AAAS00",
  support: "IEAAAAAAI4AAAS01",
  engineering: "IEAAAAAAI4AAAS02",
  operations: "IEAAAAAAI4AAAS03",
  archived: "IEAAAAAAI4AAAS09",
} as const

export const FOLDER = {
  platform: "IEAAAAAAI4AAAA01",
  launch: "IEAAAAAAI4AAAA02",
  support: "IEAAAAAAI4AAAA03",
  runbooks: "IEAAAAAAI4AAAA04",
  incidents: "IEAAAAAAI4AAAA05",
  shared: "IEAAAAAAI4AAAA06",
  empty: "IEAAAAAAI4AAAA07",
  requests: "IEAAAAAAI4AAAB01",
} as const

/** The shape measured on a production account: one space of about 3,500 folders, six levels deep, 18 of them under two parents. */
export const BIG_TREE = { perLevel: [4, 6, 6, 4, 3], deepest: 1070, multiParent: 18 } as const
/** One folder of more than 1,000 tasks, so a list of it needs six pages. */
export const BIG_FOLDER = { active: 1040, subtasks: 90, closed: 110 } as const

const AREAS = ["Billing", "Catalog", "Delivery", "Fleet", "Grants", "Intake", "Ledger", "Metering", "Notices", "Payroll", "Quotas", "Routing"]
const KINDS = ["Requests", "Reviews", "Rollouts", "Audits", "Backlog", "Plans", "Reports", "Vendors"]

/** Deterministic pseudo-random numbers, so every run builds the same workspace. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const folderIdOf = (n: number) => `IEAAAAAAI4AAC${n.toString(36).toUpperCase().padStart(3, "0")}`

function bigTree(root: FakeFolder, requests: FakeFolder, author: string): FakeFolder[] {
  const random = sequence(7)
  const folders: FakeFolder[] = []
  let count = 0
  const make = (depth: number): FakeFolder => {
    count += 1
    const title = `${AREAS[count % AREAS.length]} ${KINDS[Math.floor(random() * KINDS.length)]} ${count}`
    const folder: FakeFolder = { id: folderIdOf(count), title, childIds: [], scope: "WsFolder" }
    if (depth >= 3 && count % 7 === 0) {
      folder.project = { authorId: author, ownerIds: [author], status: "Green", customStatusId: "IEAAAAAAJMAAAA02", createdDate: "2026-01-05T12:00:00Z" }
    }
    folders.push(folder)
    return folder
  }
  let level: FakeFolder[] = [root]
  const levels: FakeFolder[][] = []
  BIG_TREE.perLevel.forEach((fanout, depth) => {
    const next: FakeFolder[] = []
    for (const parent of level) {
      for (let child = 0; child < fanout; child++) {
        const folder = make(depth + 1)
        parent.childIds.push(folder.id)
        next.push(folder)
      }
    }
    levels.push(next)
    level = next
  })
  for (const parent of level.slice(0, BIG_TREE.deepest)) parent.childIds.push(make(6).id)
  // A folder filed under a second parent, the way Wrike lets one folder live in several places.
  const [, second, third] = levels
  for (let index = 0; index < BIG_TREE.multiParent; index++) {
    second![(index * 5 + 3) % second!.length]!.childIds.push(third![index * 7]!.id)
  }
  root.childIds.unshift(requests.id)
  return folders
}

export function buildWorkspace(author: string) {
  const space = (id: string, title: string, accessType: string, archived = false): FakeSpace => ({ id, title, avatarUrl: "", accessType, archived })
  const spaces = [
    space(SPACE.support, "Support", "Public"),
    space(SPACE.operations, "Operations", "Private"),
    space(SPACE.personal, "Sam's space", "Personal"),
    space(SPACE.engineering, "Engineering", "Public"),
    space(SPACE.archived, "Archive 2019", "Public", true),
  ]
  const folder = (id: string, title: string, childIds: string[] = [], project = false): FakeFolder => ({
    id,
    title,
    childIds,
    scope: "WsFolder",
    ...(project ? { project: { authorId: author, ownerIds: [author], status: "Green", customStatusId: "IEAAAAAAJMAAAA02", createdDate: "2026-09-01T12:00:00Z" } } : {}),
  })
  const operations = folder(SPACE.operations, "Operations")
  const requests = folder(FOLDER.requests, "Service Requests")
  const folders: FakeFolder[] = [
    folder(SPACE.personal, "Sam's space"),
    folder(SPACE.support, "Support", [FOLDER.support]),
    folder(FOLDER.support, "Support Queue"),
    folder(SPACE.engineering, "Engineering", [FOLDER.platform, FOLDER.launch, FOLDER.empty]),
    // "Shared docs" sits under both Platform and Q4 Launch.
    folder(FOLDER.platform, "Platform", [FOLDER.runbooks, FOLDER.incidents, FOLDER.shared]),
    folder(FOLDER.launch, "Q4 Launch", [FOLDER.shared], true),
    folder(FOLDER.runbooks, "Runbooks"),
    folder(FOLDER.incidents, "Incidents"),
    folder(FOLDER.shared, "Shared docs"),
    folder(FOLDER.empty, "Parking lot"),
    folder(SPACE.archived, "Archive 2019"),
    operations,
    requests,
  ]
  folders.push(...bigTree(operations, requests, author))
  return { spaces, folders }
}

const VERBS = ["Provision", "Review", "Migrate", "Document", "Approve", "Schedule", "Retire", "Reconcile", "Audit", "Extend"]
const THINGS = ["badge reader", "vendor contract", "report template", "storage quota", "shift roster", "print queue", "access group", "asset tag", "mail alias", "license pool"]

export type BulkTask = {
  n: number
  title: string
  status: "Active" | "Completed" | "Deferred" | "Cancelled"
  statusKey: "new" | "inProgress" | "inReview" | "completed" | "onHold" | "cancelled"
  importance: "High" | "Normal" | "Low"
  due: string | null
  assignee: number | null
  superTask: number | null
}

/** The tasks of the big folder. Subtasks hang off the first active tasks, one or two each. */
export function bulkTasks(today: string): BulkTask[] {
  const random = sequence(11)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const tasks: BulkTask[] = []
  const total = BIG_FOLDER.active + BIG_FOLDER.closed
  for (let n = 1; n <= total; n++) {
    const closed = n > BIG_FOLDER.active
    const subtask = !closed && n > BIG_FOLDER.active - BIG_FOLDER.subtasks
    const roll = random()
    tasks.push({
      n,
      title: `${pick(VERBS)} the ${pick(THINGS)} ${String(n).padStart(4, "0")}`,
      status: closed ? (["Completed", "Completed", "Cancelled", "Deferred"] as const)[n % 4]! : "Active",
      statusKey: closed ? (["completed", "completed", "cancelled", "onHold"] as const)[n % 4]! : pick(["new", "new", "inProgress", "inReview"] as const),
      importance: roll < 0.12 ? "High" : roll < 0.8 ? "Normal" : "Low",
      due: random() < 0.15 ? null : addDays(today, Math.floor(random() * 90) - 20),
      assignee: random() < 0.2 ? null : Math.floor(random() * 3),
      superTask: subtask ? 1 + ((n * 3) % 60) : null,
    })
  }
  return tasks
}
