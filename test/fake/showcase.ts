import { addDays } from "../../src/domain/dates"
import { ACCOUNT, ME, permalink, STATUS, type FakeAttachment, type FakeComment, type FakeCustomField, type FakeData, type FakeTask } from "./data"
import type { FakeFolder, FakeSpace } from "./workspace"

/**
 * The README's screenshots run on this dataset: Fernhill Cycles, a made-up
 * bike maker a few months before it launches an e-bike. The tests never load
 * it, so it can change for looks. The people, the company and its domain are
 * invented.
 */

const PRIYA = "KUAAAA02"
const MARCUS = "KUAAAA03"
const TOMAS = "KUAAAA04"
const HANNAH = "KUAAAA05"
const OWEN = "KUAAAA06"
const GRACE = "KUAAAA07"

const SPACE = {
  product: "IEAAAAAAI4SCS001",
  marketing: "IEAAAAAAI4SCS002",
  operations: "IEAAAAAAI4SCS003",
  care: "IEAAAAAAI4SCS004",
  personal: "IEAAAAAAI4SCS005",
} as const

const FOLDER = {
  atlas: "IEAAAAAAI4SC0001",
  assets: "IEAAAAAAI4SC0002",
  dealerKit: "IEAAAAAAI4SC0003",
  website: "IEAAAAAAI4SC0004",
  roadmap: "IEAAAAAAI4SC0005",
  research: "IEAAAAAAI4SC0006",
  spring: "IEAAAAAAI4SC0007",
  brand: "IEAAAAAAI4SC0008",
  events: "IEAAAAAAI4SC0009",
  suppliers: "IEAAAAAAI4SC0010",
  warehouse: "IEAAAAAAI4SC0011",
  warranty: "IEAAAAAAI4SC0012",
  helpCenter: "IEAAAAAAI4SC0013",
} as const

/** The tasks the screenshots open by title. */
export const SHOWCASE = {
  space: "Product",
  project: "Atlas e-bike launch",
  detailsTask: "Finalize pricing for Atlas trims",
  conversationTask: "Press release, second draft",
} as const

const FIELD = {
  workstream: "IEAAAAAAJUSC0001",
  channels: "IEAAAAAAJUSC0002",
  budget: "IEAAAAAAJUSC0003",
  confidence: "IEAAAAAAJUSC0004",
  effort: "IEAAAAAAJUSC0005",
  reviewDate: "IEAAAAAAJUSC0006",
  customerFacing: "IEAAAAAAJUSC0007",
  region: "IEAAAAAAJUSC0008",
} as const

const LEGACY_BASE = 5120330100
const DOMAIN = "fernhill.test"

export function showcaseSeed(today: string, now: string): FakeData {
  const contact = (id: string, firstName: string, lastName: string, title: string, extra: Record<string, unknown> = {}) => {
    const email = `${firstName.normalize("NFD").replace(/[^A-Za-z]/g, "")}.${lastName}@${DOMAIN}`.toLowerCase()
    return {
      id,
      firstName,
      lastName,
      type: "Person",
      profiles: [{ accountId: ACCOUNT, email, role: "User", external: false, admin: false, owner: false, active: true }],
      avatarUrl: `https://www.wrike.com/avatars/${id}.png`,
      timezone: "America/Los_Angeles",
      locale: "en",
      deleted: false,
      title,
      primaryEmail: email,
      ...extra,
    }
  }
  const contacts = [
    contact(ME, "Dana", "Whitfield", "Product Marketing Lead", { me: true }),
    contact(PRIYA, "Priya", "Raman", "Finance Partner"),
    contact(MARCUS, "Marcus", "Lindqvist", "Drivetrain Engineer"),
    contact(TOMAS, "Tomás", "Ortega", "Creative Director"),
    contact(HANNAH, "Hannah", "Cho", "Dealer Enablement"),
    contact(OWEN, "Owen", "Gallagher", "Web Producer"),
    contact(GRACE, "Grace", "Adeyemi", "Customer Care Lead"),
    { id: "KUAAAG01", firstName: "Launch Team", lastName: "", type: "Group", profiles: [], avatarUrl: "", deleted: false, memberIds: [ME, PRIYA, HANNAH, OWEN] },
  ]

  const status = (id: string, name: string, group: string, color: string) => ({ id, name, standardName: false, color, standard: false, group, hidden: false })
  const workflows = [
    {
      id: "IEAAAAAAK4SC0001",
      name: "Default Workflow",
      standard: true,
      hidden: false,
      customStatuses: [
        status(STATUS.new, "New", "Active", "Blue"),
        status(STATUS.inProgress, "In Progress", "Active", "Turquoise"),
        status(STATUS.inReview, "In Review", "Active", "Yellow"),
        status(STATUS.completed, "Completed", "Completed", "Green"),
        status(STATUS.onHold, "On Hold", "Deferred", "Purple"),
        status(STATUS.cancelled, "Cancelled", "Cancelled", "Gray"),
      ],
    },
  ]
  const spaceWorkflows: Record<string, unknown[]> = {
    [SPACE.care]: [
      {
        id: "IEAAAAAAK4SC0002",
        name: "Care Workflow",
        standard: false,
        hidden: false,
        customStatuses: [
          status(STATUS.triage, "Triage", "Active", "Orange"),
          status(STATUS.waiting, "Waiting on rider", "Deferred", "Purple"),
          status(STATUS.resolved, "Resolved", "Completed", "Green"),
          status(STATUS.duplicate, "Duplicate", "Cancelled", "Gray"),
        ],
      },
    ],
  }

  const space = (id: string, title: string, accessType: string): FakeSpace => ({ id, title, avatarUrl: "", accessType, archived: false })
  const spaces = [
    space(SPACE.product, "Product", "Public"),
    space(SPACE.marketing, "Marketing", "Public"),
    space(SPACE.operations, "Operations", "Private"),
    space(SPACE.care, "Customer Care", "Public"),
    space(SPACE.personal, "Dana's space", "Personal"),
  ]
  const folder = (id: string, title: string, childIds: string[] = [], project = false): FakeFolder => ({
    id,
    title,
    childIds,
    scope: "WsFolder",
    ...(project ? { project: { authorId: ME, ownerIds: [ME], status: "Green", customStatusId: STATUS.inProgress, createdDate: `${addDays(today, -60)}T16:00:00Z` } } : {}),
  })
  const folders: FakeFolder[] = [
    folder(SPACE.product, "Product", [FOLDER.atlas, FOLDER.website, FOLDER.roadmap, FOLDER.research]),
    folder(FOLDER.atlas, "Atlas e-bike launch", [FOLDER.assets, FOLDER.dealerKit], true),
    folder(FOLDER.assets, "Launch assets"),
    folder(FOLDER.dealerKit, "Dealer kit"),
    folder(FOLDER.website, "Website refresh", [], true),
    folder(FOLDER.roadmap, "Roadmap 2027"),
    folder(FOLDER.research, "Rider research"),
    folder(SPACE.marketing, "Marketing", [FOLDER.spring, FOLDER.brand, FOLDER.events]),
    folder(FOLDER.spring, "Spring campaign", [], true),
    folder(FOLDER.brand, "Brand library"),
    folder(FOLDER.events, "Events 2027"),
    folder(SPACE.operations, "Operations", [FOLDER.suppliers, FOLDER.warehouse]),
    folder(FOLDER.suppliers, "Supplier onboarding"),
    folder(FOLDER.warehouse, "Warehouse move", [], true),
    folder(SPACE.care, "Customer Care", [FOLDER.warranty, FOLDER.helpCenter]),
    folder(FOLDER.warranty, "Warranty claims"),
    folder(FOLDER.helpCenter, "Help center articles"),
    folder(SPACE.personal, "Dana's space"),
  ]

  const planned = (start: number, due: number) => ({
    type: "Planned" as const,
    start: `${addDays(today, start)}T09:00:00`,
    due: `${addDays(today, due)}T17:00:00`,
    duration: (due - start + 1) * 480,
  })
  const milestone = (due: number) => ({ type: "Milestone" as const, due: `${addDays(today, due)}T17:00:00` })
  const backlog = { type: "Backlog" as const }
  const groupOf: Record<string, FakeTask["status"]> = {
    [STATUS.new]: "Active",
    [STATUS.inProgress]: "Active",
    [STATUS.inReview]: "Active",
    [STATUS.completed]: "Completed",
    [STATUS.onHold]: "Deferred",
    [STATUS.cancelled]: "Cancelled",
    [STATUS.triage]: "Active",
    [STATUS.waiting]: "Deferred",
  }

  const tasks: FakeTask[] = []
  const task = (
    title: string,
    fields: {
      status: string
      importance?: FakeTask["importance"]
      dates: FakeTask["dates"]
      people: string[]
      in?: string
      under?: string
      description?: string
      author?: string
    },
  ): string => {
    const n = tasks.length + 1
    const id = `IEAAAAAAKQSC${String(n).padStart(4, "0")}`
    const description = fields.description ?? ""
    tasks.push({
      id,
      accountId: ACCOUNT,
      title,
      description,
      briefDescription: description.replace(/<[^>]+>/g, " ").slice(0, 100),
      parentIds: fields.in ? [fields.in] : [],
      superParentIds: [],
      sharedIds: [ME],
      responsibleIds: fields.people,
      status: groupOf[fields.status]!,
      importance: fields.importance ?? "Normal",
      createdDate: `${addDays(today, -40 + n)}T16:00:00Z`,
      updatedDate: `${addDays(today, -(n % 9))}T18:${String(10 + n).padStart(2, "0")}:00Z`,
      dates: fields.dates,
      scope: "WsTask",
      authorIds: [fields.author ?? ME],
      customStatusId: fields.status,
      hasAttachments: false,
      permalink: permalink(LEGACY_BASE + n),
      priority: `0${n}000000`,
      superTaskIds: fields.under ? [fields.under] : [],
      subTaskIds: [],
      dependencyIds: [],
      metadata: [],
      customFields: [],
    })
    return id
  }

  const checklist = (items: [string, boolean][]) =>
    `<ul class="checklist" style="list-style-type: none;">${items
      .map(([text, done]) => `<li><label><input type="checkbox"${done ? ' checked="checked"' : ""} />${text}</label></li>`)
      .join("")}</ul>`
  const table = (rows: string[][]) =>
    `<table>${rows.map((row, index) => `<tr>${row.map((cell) => `<td>${index === 0 ? `<b>${cell}</b>` : cell}</td>`).join("")}</tr>`).join("")}</table>`

  const S = STATUS
  const atlas = FOLDER.atlas
  const pricing = task(SHOWCASE.detailsTask, {
    status: S.inProgress,
    importance: "High",
    dates: planned(-6, 4),
    people: [ME, PRIYA],
    in: atlas,
    description:
      `<b>Goal:</b> retail prices for <b>Atlas</b>, <b>Atlas Plus</b> and <b>Atlas Cargo</b> before dealer pre-orders open on Dec 1.<br /><br />` +
      checklist([
        ["Collect competitor prices", true],
        ["Margin model from Finance", true],
        ["Dealer margin sign-off", false],
        ["Final review with leadership", false],
      ]) +
      `<br />` +
      table([
        ["Trim", "Price", "Margin", "Range"],
        ["Atlas", "$2,499", "38%", "60 mi"],
        ["Atlas Plus", "$2,999", "41%", "85 mi"],
        ["Atlas Cargo", "$3,499", "36%", "70 mi"],
      ]) +
      `<br />Dealers keep <i>at least</i> 35% on every trim. The full model is in the <a href="https://${DOMAIN}/finance/atlas-pricing">pricing sheet</a>.`,
  })
  const battery = task("Certify the battery to UL 2849", { status: S.inProgress, importance: "High", dates: milestone(13), people: [MARCUS], in: atlas })
  task("Shoot the coast lifestyle photos", { status: S.inProgress, dates: planned(-2, 6), people: [TOMAS], in: FOLDER.assets })
  task("Write the dealer training deck", { status: S.inProgress, dates: milestone(9), people: [HANNAH, ME], in: FOLDER.dealerKit })
  const press = task(SHOWCASE.conversationTask, {
    status: S.inReview,
    importance: "High",
    dates: milestone(1),
    people: [ME, OWEN],
    in: FOLDER.assets,
    description: "Embargoed until launch day. Keep it to one page, with range, motor and weight up top.",
  })
  task("Product page copy and spec table", { status: S.inReview, dates: milestone(3), people: [OWEN], in: atlas })
  task("Dealer pre-order form", { status: S.inReview, dates: milestone(5), people: [HANNAH], in: FOLDER.dealerKit })
  task("Book the launch venue in Portland", { status: S.new, dates: milestone(20), people: [ME], in: atlas })
  task("Plan the demo ride tour", { status: S.new, dates: planned(14, 40), people: [HANNAH, ME], in: FOLDER.dealerKit })
  task("Order 40 demo bikes for dealers", { status: S.new, importance: "High", dates: milestone(7), people: [MARCUS, PRIYA], in: atlas })
  task("Translate the owner's manual", { status: S.new, importance: "Low", dates: milestone(30), people: [OWEN], in: atlas })
  task("Brief Care on the Atlas warranty", { status: S.new, dates: milestone(18), people: [GRACE], in: atlas })
  task("Set up launch analytics", { status: S.new, importance: "Low", dates: backlog, people: [OWEN], in: atlas })
  task("Seed Atlas with ten riders for early reviews", { status: S.onHold, dates: milestone(45), people: [TOMAS], in: atlas })
  task("Pick the launch date", { status: S.completed, dates: milestone(-21), people: [ME], in: atlas })
  task("Approve the final frame colors", { status: S.completed, dates: milestone(-12), people: [TOMAS], in: atlas })
  task("Print a catalog insert", { status: S.cancelled, dates: backlog, people: [], in: atlas })
  task("Collect competitor prices", { status: S.completed, dates: milestone(-8), people: [PRIYA], under: pricing })
  task("Dealer margin sign-off", { status: S.new, dates: milestone(2), people: [HANNAH], under: pricing })
  task("Thermal test at 40 °C ambient", { status: S.inProgress, dates: milestone(6), people: [MARCUS], under: battery })

  task("Move the blog to the new CMS", { status: S.inProgress, dates: planned(-10, 8), people: [OWEN], in: FOLDER.website })
  task("Accessibility audit of checkout", { status: S.new, importance: "High", dates: milestone(15), people: [OWEN, ME], in: FOLDER.website })
  task("New navigation prototype", { status: S.inReview, dates: milestone(2), people: [OWEN], in: FOLDER.website })
  task("Interview twenty cargo bike owners", { status: S.inProgress, dates: planned(-14, 10), people: [ME], in: FOLDER.research })
  task("Q1 roadmap review with leadership", { status: S.new, dates: milestone(26), people: [ME, MARCUS], in: FOLDER.roadmap })
  task("Storyboard the 30 second spot", { status: S.inProgress, dates: milestone(11), people: [TOMAS], in: FOLDER.spring })
  task("Media plan for March", { status: S.new, dates: milestone(22), people: [ME], in: FOLDER.spring })
  task("Refresh the logo lockups", { status: S.inReview, importance: "Low", dates: backlog, people: [TOMAS], in: FOLDER.brand })
  task("Sea Otter Classic booth", { status: S.new, dates: milestone(70), people: [HANNAH], in: FOLDER.events })
  task("Onboard the new tire supplier", { status: S.inProgress, dates: milestone(16), people: [MARCUS], in: FOLDER.suppliers })
  task("Pack the spare parts inventory", { status: S.onHold, dates: milestone(55), people: [GRACE], in: FOLDER.warehouse })
  task("Frame crack reports on 2024 Trail models", { status: S.triage, importance: "High", dates: milestone(3), people: [GRACE], in: FOLDER.warranty, author: GRACE })
  task("Replacement chargers for the Commuter line", { status: S.waiting, dates: milestone(9), people: [GRACE], in: FOLDER.warranty, author: GRACE })
  task("Write the Atlas charging guide", { status: S.new, dates: milestone(19), people: [GRACE, OWEN], in: FOLDER.helpCenter })

  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  for (const child of tasks) for (const parent of child.superTaskIds) byId.get(parent)?.subTaskIds.push(child.id)
  byId.get(press)!.hasAttachments = true

  const definition = (id: string, title: string, type: string, settings: Record<string, unknown>): FakeCustomField => ({
    id,
    accountId: ACCOUNT,
    title,
    type,
    sharedIds: [],
    sharing: { readerIds: [], writerIds: [] },
    settings: { inheritanceType: "All", applicableEntityTypes: ["WorkItem"], ...settings },
    description: "",
    archived: false,
  })
  const choices = (...values: string[]) => ({ values, options: values.map((value) => ({ value, color: "Blue" })), allowOtherValues: false, readOnly: false })
  const customFields: FakeCustomField[] = [
    definition(FIELD.workstream, "Workstream", "DropDown", choices("Pricing", "Creative", "Dealers", "Engineering", "Web", "Support")),
    definition(FIELD.channels, "Channels", "Multiple", choices("Press", "Dealers", "Web", "Social", "Email")),
    definition(FIELD.budget, "Budget", "Currency", { decimalPlaces: 0, currency: "USD" }),
    definition(FIELD.confidence, "Confidence", "Percentage", { decimalPlaces: 0 }),
    definition(FIELD.effort, "Effort (days)", "Numeric", { decimalPlaces: 0, useThousandsSeparator: false, aggregation: "Sum" }),
    definition(FIELD.reviewDate, "Review date", "Date", { allowTime: false }),
    definition(FIELD.customerFacing, "Customer facing", "Checkbox", {}),
    definition(FIELD.region, "Region", "DropDown", choices("North America", "Europe")),
  ]
  const values = (entries: Partial<Record<keyof typeof FIELD, string>>) => Object.entries(entries).map(([key, value]) => ({ id: FIELD[key as keyof typeof FIELD], value: value! }))
  byId.get(pricing)!.customFields = values({
    workstream: "Pricing",
    channels: '["Dealers","Web"]',
    budget: "4500",
    confidence: "70",
    effort: "6",
    reviewDate: addDays(today, 4),
    customerFacing: "true",
    region: "North America",
  })
  byId.get(press)!.customFields = values({ workstream: "Creative", channels: '["Press","Dealers"]', customerFacing: "true" })
  byId.get(battery)!.customFields = values({ workstream: "Engineering", budget: "18000", confidence: "55" })

  const minutesAgo = (minutes: number) => new Date(new Date(now).getTime() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z")
  let commentCount = 0
  const comment = (taskId: string, authorId: string, text: string, minutes: number): FakeComment => {
    commentCount += 1
    return { id: `IEAAAAAAIMSC${String(commentCount).padStart(4, "0")}`, authorId, text, createdDate: minutesAgo(minutes), updatedDate: minutesAgo(minutes), taskId }
  }
  const mention = (id: string, name: string) => `<a class="stream-user-id avatar" rel="${id}">@${name}</a>`
  const HOUR = 60
  const DAY = 24 * HOUR
  const comments: FakeComment[] = [
    comment(press, HANNAH, `${mention(ME, "Dana Whitfield")} dealers will ask about the pre-order window. Can we add one line on it?`, 40),
    comment(press, MARCUS, "Range is <b>85 miles</b> on the Plus with the 720 Wh pack, not 90. The 90 figure was eco mode on flat ground.", 5 * HOUR),
    comment(press, OWEN, "Second draft is attached. I cut the spec list down to range, motor and weight, and moved the rest to the product page.", DAY + 2 * HOUR),
    comment(press, PRIYA, "Pricing is still moving. Please keep the trims and prices out of the release until Tuesday.", 2 * DAY + 3 * HOUR),
    comment(pricing, ME, "Agreed. Let's take Cargo to $3,499 and keep the other two where they are.", 4 * HOUR),
    comment(pricing, HANNAH, "Dealers want at least 35% on every trim, or the Cargo will sit on the floor.", DAY + 1 * HOUR),
    comment(pricing, PRIYA, `The margin model is in the <a href="https://${DOMAIN}/finance/atlas-pricing">pricing sheet</a>. Cargo is tight at $3,299.`, 2 * DAY),
  ]

  const legacyOf = (taskId: string) => Number(byId.get(taskId)!.permalink.split("=")[1])
  const people = {
    dana: { id: 2201701, name: "Dana Whitfield" },
    priya: { id: 2201702, name: "Priya Raman" },
    marcus: { id: 2201703, name: "Marcus Lindqvist" },
    tomas: { id: 2201704, name: "Tomás Ortega" },
    hannah: { id: 2201705, name: "Hannah Cho" },
    owen: { id: 2201706, name: "Owen Gallagher" },
  }
  type Person = { id: number; name: string }
  const notification = (n: number, notificationType: string, minutes: number, isUnread: boolean, taskId: string | null, author: Person, commentText?: string) => {
    const item = taskId === null ? undefined : { id: `w:itm:${legacyOf(taskId)}`, title: byId.get(taskId)!.title, itemType: "TASK", baseType: "TASK", permalink: permalink(legacyOf(taskId)) }
    return {
      notificationId: `w:obj_chng:${2057210600 + n}`,
      notificationType,
      isUnread,
      ts: minutesAgo(minutes),
      ...(item ? { item } : {}),
      author: { id: `w:usr:${author.id}`, type: "user", name: author.name },
      ...(commentText ? { commentText } : {}),
      archived: false,
    }
  }
  const titled = (title: string) => tasks.find((candidate) => candidate.title === title)!.id
  const inbox = [
    notification(1, "Mention", 40, true, press, people.hannah, "@Dana Whitfield dealers will ask about the pre-order window. Can we add one line on it?"),
    notification(2, "Comment", 5 * HOUR, true, press, people.marcus, "Range is 85 miles on the Plus with the 720 Wh pack, not 90."),
    notification(3, "EntitiesAssigned", 6 * HOUR, true, titled("Plan the demo ride tour"), people.hannah),
    notification(4, "Status", 9 * HOUR, true, titled("New navigation prototype"), people.owen),
    notification(5, "ApprovalRequested", DAY + 2 * HOUR, true, null, people.priya),
    notification(6, "Comment", 2 * DAY, false, pricing, people.priya, "The margin model is in the pricing sheet. Cargo is tight at $3,299."),
    notification(7, "Status", 4 * DAY, false, titled("Approve the final frame colors"), people.tomas),
  ]

  const usr = (person: Person) => ({ id: `w:usr:${person.id}`, name: person.name })
  const change = (minutes: number, author: Person, type: string, action: string, payload: unknown) => ({ timestamp: minutesAgo(minutes), author: usr(author), type, action, payload })
  const statusValue = (id: string, name: string) => ({ id: `w:wfst:${id}`, name, category: "Active" })
  const field = (n: number, name: string) => ({ id: `w:cf:${n}`, name })
  // Newest first, the order get_item_history answers in.
  const history: FakeData["history"] = {
    [press]: [
      change(20, people.dana, "CUSTOM_FIELDS", "UPDATE", { customField: field(3102, "Channels"), oldValues: ["Press"], newValues: ["Press", "Dealers"] }),
      change(3 * HOUR, people.dana, "STATUS", "UPDATE", { oldValue: statusValue(S.inProgress, "In Progress"), newValue: statusValue(S.inReview, "In Review") }),
      change(DAY + 2 * HOUR + 1, people.owen, "ATTACHMENTS", "ADD", { addedAttachments: [{ name: "atlas-press-release-v2.docx", id: "w:att:2", type: "WRIKE" }] }),
      change(2 * DAY, people.owen, "DUE_DATE", "UPDATE", { oldValue: `${addDays(today, -1)}T17:00:00`, newValue: `${addDays(today, 1)}T17:00:00` }),
      change(3 * DAY, people.dana, "ASSIGNEES", "ADD", { addedUsers: [usr(people.owen)] }),
      change(3 * DAY + 5, people.dana, "STATUS", "UPDATE", { oldValue: statusValue(S.new, "New"), newValue: statusValue(S.inProgress, "In Progress") }),
    ],
    [pricing]: [
      change(4 * HOUR + 2, people.dana, "CUSTOM_FIELDS", "UPDATE", { customField: field(3104, "Confidence"), newNumber: 70 }),
      change(3 * DAY, people.priya, "STATUS", "UPDATE", { oldValue: statusValue(S.new, "New"), newValue: statusValue(S.inProgress, "In Progress") }),
    ],
  }

  const attachments: FakeAttachment[] = [
    { id: "IEAAAAAAIYSC0003", authorId: TOMAS, name: "atlas-hero-coast.jpg", createdDate: minutesAgo(6 * HOUR), version: 1, type: "Wrike", contentType: "image/jpeg", size: 3_482_113, taskId: press, width: 6000, height: 4000 },
    {
      id: "IEAAAAAAIYSC0002",
      authorId: OWEN,
      name: "atlas-press-release-v2.docx",
      createdDate: minutesAgo(DAY + 2 * HOUR + 1),
      version: 2,
      type: "Wrike",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 48_640,
      taskId: press,
    },
    { id: "IEAAAAAAIYSC0001", authorId: ME, name: "Launch messaging brief", createdDate: minutesAgo(5 * DAY), version: 1, type: "Google", contentType: "application/vnd.google-apps.document", taskId: press },
  ]

  return { contacts, workflows, spaces, spaceWorkflows, folders, tasks, comments, inbox, history, attachments, customFields, notApplying: {} }
}
