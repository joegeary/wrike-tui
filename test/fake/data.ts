import { addDays } from "../../src/domain/dates"
import { buildWorkspace, bulkTasks, FOLDER, SPACE } from "./workspace"

export type FakeTask = {
  id: string
  accountId: string
  title: string
  description: string
  briefDescription: string
  parentIds: string[]
  superParentIds: string[]
  sharedIds: string[]
  responsibleIds: string[]
  status: "Active" | "Completed" | "Deferred" | "Cancelled"
  importance: "High" | "Normal" | "Low"
  createdDate: string
  updatedDate: string
  dates: { type: "Backlog" | "Milestone" | "Planned"; start?: string; due?: string; duration?: number }
  scope: string
  authorIds: string[]
  customStatusId: string
  hasAttachments: boolean
  permalink: string
  priority: string
  superTaskIds: string[]
  subTaskIds: string[]
  dependencyIds: string[]
  metadata: unknown[]
  customFields: unknown[]
}

export type FakeAttachment = {
  id: string
  authorId: string
  name: string
  createdDate: string
  version: number
  type: string
  contentType?: string
  size?: number
  taskId: string
  width?: number
  height?: number
}

/** A real 24 by 16 PNG, the size of thumbnail Wrike's preview route answers with. */
export const PREVIEW_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAACu0lEQVR4nAXBoRJFQBiA0b9Lim6ztsED2KwJulHF/eZ2MxtVowuazAMImry6Iul7zxFBIiRBUiRDcqRASqRGGqRDfkiPDMiEzMiK7MiBXMiNPMiHBESEOCJOiFPijDgnLohL4pq4Ie6If8Q98UA8Ec/EK/FOfBBfxDfxQ/wRB2IRVIRKUCkqQ+WoAlWialSD6lA/VI8aUBNqRq2oHXWgLtSNelAfKqBE0BE6QafoDJ2jC3SJrtENukP/0D16QE/oGb2id/SBvtA3+kF/6IAWwUSYBJNiMkyOKTAlpsY0mA7zw/SYATNhZsyK2TEH5sLcmAfzYQJGhCqiSqhSqowqpyqoSqqaqqHqqH5UPdVANVHNVCvVTnVQXVQ31UP1UQUqEdqINqFNaTPanLagLWlr2oa2o/3R9rQD7UQ70660O+1Be9HetA/tRxtoRbARNsGm2AybYwtsia2xDbbD/rA9dsBO2Bm7Ynfsgb2wN/bBftiAFcFFuASX4jJcjitwJa7GNbgO98P1uAE34WbcittxB+7C3bgH9+ECToQxYkwYU8aMMWcsGEvGmrFh7Bh/jD3jwDgxzowr4854MF6MN+PD+DEGRhGWiCVhSVkylpylYClZapaGpWP5sfQsA8vEMrOsLDvLwXKx3CwPy8cSWETYIraELWXL2HK2gq1kq9kato7tx9azDWwT28y2su1sB9vFdrM9bB9bYBPhjDgTzpQz48w5C86Ss+ZsODvOH2fPOXBOnDPnyrlzHpwX5835cH6cgVMEH+ETfIrP8Dm+wJf4Gt/gO/wP3+MH/ISf8St+xx/4C3/jH/yHD3gR3og34U15M96ct+AteWvehrfj/fH2vAPvxDvzrrw778F78d68D+/HG3hFCBEhIaSEjJATCkJJqAkNoSP8CD1hIEyEmbASdsJBuAg34SF8hED4A50hMp/gkjpnAAAAAElFTkSuQmCC",
  "base64",
)

export type FakeComment = { id: string; authorId: string; text: string; createdDate: string; updatedDate: string; taskId: string }

export const ACCOUNT = "IEAAAAAA"
export const ME = "KUAAAA01"
export const PAT = "KUAAAA02"
export const RILEY = "KUAAAA03"
export const JORDAN = "KUAAAA04"

export const STATUS = {
  new: "IEAAAAAAJMAAAA01",
  inProgress: "IEAAAAAAJMAAAA02",
  inReview: "IEAAAAAAJMAAAA03",
  completed: "IEAAAAAAJMAAAA04",
  onHold: "IEAAAAAAJMAAAA05",
  cancelled: "IEAAAAAAJMAAAA06",
  legacy: "IEAAAAAAJMAAAA07",
  triage: "IEAAAAAAJMAAAB01",
  waiting: "IEAAAAAAJMAAAB02",
  resolved: "IEAAAAAAJMAAAB03",
} as const

export const TASK = {
  sso: "IEAAAAAAKQAAAA01",
  keys: "IEAAAAAAKQAAAA02",
  checklist: "IEAAAAAAKQAAAA03",
  onboarding: "IEAAAAAAKQAAAA04",
  flags: "IEAAAAAAKQAAAA05",
  dashboards: "IEAAAAAAKQAAAA06",
  login: "IEAAAAAAKQAAAA07",
  exportTest: "IEAAAAAAKQAAAA08",
  tls: "IEAAAAAAKQAAAA09",
  reproduce: "IEAAAAAAKQAAAA10",
  patch: "IEAAAAAAKQAAAA11",
  macros: "IEAAAAAAKQAAAA12",
} as const

export const bulkTaskId = (n: number) => `IEAAAAAAKQAB${String(n).padStart(4, "0")}`

export const permalink = (legacyId: number) => `https://www.wrike.com/open.htm?id=${legacyId}`
const LEGACY_BASE = 4598459100

export function seed(today: string, now: string) {
  const contact = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({
    id,
    firstName,
    lastName,
    type: "Person",
    profiles: [
      { accountId: ACCOUNT, email: `${firstName}.${lastName}@example.test`.toLowerCase(), role: "User", external: false, admin: false, owner: false, active: true },
    ],
    avatarUrl: `https://www.wrike.com/avatars/${id}.png`,
    timezone: "America/New_York",
    locale: "en",
    deleted: false,
    title: "",
    primaryEmail: `${firstName}.${lastName}@example.test`.toLowerCase(),
    ...extra,
  })
  const contacts = [
    contact(ME, "Sam", "Sample", { me: true }),
    contact(PAT, "Pat", "Example"),
    contact(RILEY, "Riley", "Demo"),
    contact(JORDAN, "Jordan", "Placeholder"),
    contact("KUAAAA09", "Former", "Colleague", { deleted: true }),
    { id: "KUAAAG01", firstName: "Platform Team", lastName: "", type: "Group", profiles: [], avatarUrl: "", deleted: false, memberIds: [ME, PAT] },
  ]

  const status = (id: string, name: string, group: string, color: string, hidden = false) => ({
    id,
    name,
    standardName: false,
    color,
    standard: false,
    group,
    hidden,
  })
  const workflows = [
    {
      id: "IEAAAAAAK4AAAA01",
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
        status(STATUS.legacy, "Legacy Review", "Active", "Gray", true),
      ],
    },
  ]
  const { spaces, folders } = buildWorkspace(PAT)
  const spaceWorkflows: Record<string, unknown[]> = {
    [SPACE.support]: [
      {
        id: "IEAAAAAAK4AAAA02",
        name: "Support Workflow",
        standard: false,
        hidden: false,
        customStatuses: [
          status(STATUS.triage, "Triage", "Active", "Orange"),
          status(STATUS.waiting, "Waiting on customer", "Deferred", "Purple"),
          status(STATUS.resolved, "Resolved", "Completed", "Green"),
        ],
      },
    ],
  }

  const at = (day: string) => `${day}T17:00:00`
  const planned = (start: number, due: number) => ({
    type: "Planned" as const,
    start: `${addDays(today, start)}T09:00:00`,
    due: at(addDays(today, due)),
    duration: (due - start + 1) * 480,
  })
  const milestone = (due: number) => ({ type: "Milestone" as const, due: at(addDays(today, due)) })

  let count = 0
  const task = (
    id: string,
    title: string,
    fields: Pick<FakeTask, "status" | "customStatusId" | "importance" | "dates" | "responsibleIds" | "parentIds"> & {
      description?: string
      superTaskIds?: string[]
    },
  ): FakeTask => {
    count += 1
    const description = fields.description ?? ""
    return {
      id,
      accountId: ACCOUNT,
      title,
      description,
      briefDescription: description.replace(/<[^>]+>/g, " ").slice(0, 100),
      parentIds: fields.parentIds,
      superParentIds: [],
      sharedIds: [ME, PAT],
      responsibleIds: fields.responsibleIds,
      status: fields.status,
      importance: fields.importance,
      createdDate: `${addDays(today, -30)}T12:00:00Z`,
      updatedDate: `${addDays(today, -count)}T12:00:00Z`,
      dates: fields.dates,
      scope: "WsTask",
      authorIds: [PAT],
      customStatusId: fields.customStatusId,
      hasAttachments: false,
      permalink: permalink(LEGACY_BASE + count),
      priority: `0${count}000000`,
      superTaskIds: fields.superTaskIds ?? [],
      subTaskIds: [],
      dependencyIds: [],
      metadata: [],
      customFields: [],
    }
  }

  const tasks: FakeTask[] = [
    task(TASK.sso, "Enable SSO on sandbox", {
      status: "Active",
      customStatusId: STATUS.inProgress,
      importance: "High",
      dates: planned(-5, -1),
      responsibleIds: [ME, PAT],
      parentIds: [FOLDER.platform, FOLDER.launch],
      description:
        '<h2>Goal</h2>Staff sign in to the sandbox with the same identity provider as production.<br /><br /><b>Steps</b><ul><li>Register the sandbox as a service provider</li><li>Map the <i>staff</i> and <i>admin</i> groups</li><li>Test with two pilot accounts</li></ul>See the <a href="https://example.test/runbooks/sso">SSO runbook</a> for the certificate rotation notes.',
    }),
    task(TASK.keys, "Rotate API keys for the staging cluster", {
      status: "Active",
      customStatusId: STATUS.new,
      importance: "Normal",
      dates: milestone(0),
      responsibleIds: [ME],
      parentIds: [FOLDER.platform],
      description:
        'Rotate before the audit. <u>Do not</u> reuse the <span style="color:#d73a49">old prefixes</span>.<table><tr><td>Service</td><td>Owner</td></tr><tr><td>gateway</td><td>Pat</td></tr><tr><td>worker</td><td>Riley</td></tr></table>',
    }),
    task(TASK.checklist, "Draft the Q4 launch checklist", {
      status: "Active",
      customStatusId: STATUS.inReview,
      importance: "Normal",
      dates: planned(-2, 1),
      responsibleIds: [ME, RILEY],
      parentIds: [FOLDER.launch],
      description:
        'One page, owners named per line.<br /><ul class="checklist" style="list-style-type: none;"><li><label><input type="checkbox" checked="checked" />Book the venue</label></li><li><label><input type="checkbox" /><span style="color: #191919;">Send the invites</span></label><ul style="list-style-type: circle;"><li>Partners first</li></ul></li></ul><br /><span style="background-color: #ffcc80;">Budget</span> is <u>fixed</u> at <span style="color: #D81B60;">10k</span>.<br />See <a href="https://example.test/venue" rel="nofollow">the venue</a> and its plan <img src="//storage.example.test/plan.png" /><br /><table><tr><td><b>Item</b></td><td><b>Owner</b></td></tr><tr><td>Venue</td><td>Riley<br />Sam</td></tr></table>',
    }),
    task(TASK.onboarding, "Write onboarding guide for new support agents", {
      status: "Active",
      customStatusId: STATUS.triage,
      importance: "Low",
      dates: milestone(10),
      responsibleIds: [ME],
      parentIds: [FOLDER.support],
      description: "Cover the queue views, macros and the escalation path.",
    }),
    task(TASK.flags, "Clean up stale feature flags", {
      status: "Active",
      customStatusId: STATUS.new,
      importance: "Normal",
      dates: { type: "Backlog" },
      responsibleIds: [ME],
      parentIds: [FOLDER.platform],
    }),
    task(TASK.dashboards, "Archive last year's dashboards and move the saved reports that still get traffic into the shared analytics space", {
      status: "Active",
      customStatusId: STATUS.new,
      importance: "Low",
      dates: milestone(21),
      responsibleIds: [ME],
      parentIds: [FOLDER.platform],
      description: "Keep anything opened in the last 90 days.",
    }),
    task(TASK.login, "Fix login redirect loop", {
      status: "Active",
      customStatusId: STATUS.inProgress,
      importance: "High",
      dates: milestone(2),
      responsibleIds: [PAT],
      parentIds: [FOLDER.platform],
      description: "The session cookie is dropped after the identity provider callback.",
    }),
    task(TASK.exportTest, "Fix flaky export test", {
      status: "Completed",
      customStatusId: STATUS.completed,
      importance: "Normal",
      dates: milestone(-8),
      responsibleIds: [],
      parentIds: [FOLDER.platform],
    }),
    task(TASK.tls, "Renew TLS certificate for the login domain", {
      status: "Deferred",
      customStatusId: STATUS.onHold,
      importance: "Normal",
      dates: milestone(30),
      responsibleIds: [RILEY],
      parentIds: [FOLDER.platform],
    }),
    task(TASK.reproduce, "Reproduce the redirect loop on staging", {
      status: "Active",
      customStatusId: STATUS.inProgress,
      importance: "Normal",
      dates: milestone(1),
      responsibleIds: [PAT],
      parentIds: [],
      superTaskIds: [TASK.login],
    }),
    task(TASK.patch, "Patch the callback handler", {
      status: "Active",
      customStatusId: STATUS.new,
      importance: "Normal",
      dates: { type: "Backlog" },
      responsibleIds: [RILEY],
      parentIds: [],
      superTaskIds: [TASK.login],
    }),
    // A subtask filed in a folder of its own, whose parent lives in another space.
    task(TASK.macros, "List the macros agents use most", {
      status: "Active",
      customStatusId: STATUS.new,
      importance: "Low",
      dates: milestone(6),
      responsibleIds: [RILEY],
      parentIds: [FOLDER.runbooks],
      superTaskIds: [TASK.onboarding],
    }),
  ]

  const people = [PAT, RILEY, JORDAN]
  for (const bulk of bulkTasks(today)) {
    tasks.push({
      ...task(bulkTaskId(bulk.n), bulk.title, {
        status: bulk.status,
        customStatusId: STATUS[bulk.statusKey],
        importance: bulk.importance,
        dates: bulk.due ? milestone(0) : { type: "Backlog" },
        responsibleIds: bulk.assignee === null ? [] : [people[bulk.assignee]!],
        parentIds: bulk.superTask === null ? [FOLDER.requests] : [],
        superTaskIds: bulk.superTask === null ? [] : [bulkTaskId(bulk.superTask)],
      }),
      ...(bulk.due ? { dates: { type: "Milestone" as const, due: at(bulk.due) } } : {}),
      permalink: permalink(LEGACY_BASE + 1000 + bulk.n),
      updatedDate: `${addDays(today, -(bulk.n % 200))}T12:00:00Z`,
    })
  }
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  byId.get(TASK.login)!.hasAttachments = true
  for (const child of tasks) for (const parent of child.superTaskIds) byId.get(parent)?.subTaskIds.push(child.id)

  const minutesAgo = (minutes: number) => new Date(new Date(now).getTime() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z")
  const comment = (id: string, taskId: string, authorId: string, text: string, minutes: number): FakeComment => ({
    id,
    authorId,
    text,
    createdDate: minutesAgo(minutes),
    updatedDate: minutesAgo(minutes),
    taskId,
  })
  // Newest first, the order Wrike returns.
  const comments: FakeComment[] = [
    comment("IEAAAAAAIMAAAA03", TASK.sso, PAT, `<a class="stream-user-id avatar" rel="${ME}">@Sam Sample</a> can we run trainings in the sandbox?`, 35),
    comment("IEAAAAAAIMAAAA02", TASK.sso, ME, 'Pilot accounts are created in <a href="https://example.test/pull/7">PR 7</a>.<br />Waiting on the metadata file.', 60 * 26),
    comment("IEAAAAAAIMAAAA01", TASK.sso, RILEY, "The identity provider team needs the entity ID by Friday.", 60 * 50),
    comment("IEAAAAAAIMAAAA04", TASK.login, PAT, "Repro steps attached, it loops after the callback.", 60 * 3),
  ]

  const legacyOf = (taskId: string) => Number(tasks.find((t) => t.id === taskId)!.permalink.split("=")[1])
  const notification = (
    n: number,
    notificationType: string,
    minutes: number,
    isUnread: boolean,
    target: { task: string } | { project: string; legacyId: number } | null,
    author: { id: number; name: string },
    commentText?: string,
  ) => {
    const item =
      target === null
        ? undefined
        : "task" in target
          ? {
              id: `w:itm:${legacyOf(target.task)}`,
              title: tasks.find((t) => t.id === target.task)!.title,
              itemType: "TASK",
              baseType: "TASK",
              permalink: permalink(legacyOf(target.task)),
            }
          : { id: `w:itm:${target.legacyId}`, title: target.project, itemType: "PROJECT", baseType: "PROJECT", permalink: permalink(target.legacyId) }
    return {
      notificationId: `w:obj_chng:${1057210600 + n}`,
      notificationType,
      isUnread,
      ts: minutesAgo(minutes),
      ...(item ? { item } : {}),
      author: { id: `w:usr:${author.id}`, type: "user", name: author.name },
      ...(commentText ? { commentText } : {}),
      archived: false,
    }
  }
  const pat = { id: 1961702, name: "Pat Example" }
  const riley = { id: 1961703, name: "Riley Demo" }
  const jordan = { id: 1961704, name: "Jordan Placeholder" }
  const inbox = [
    notification(1, "Mention", 35, true, { task: TASK.sso }, pat, "@Sam Sample can we run trainings in the sandbox?"),
    notification(2, "EntitiesAssigned", 60 * 2, true, { task: TASK.keys }, riley),
    notification(3, "Comment", 60 * 3, true, { task: TASK.login }, pat, "Repro steps attached, it loops after the callback."),
    notification(4, "Status", 60 * 9, true, { task: TASK.checklist }, jordan),
    notification(5, "ApprovalRequested", 60 * 27, true, null, riley),
    notification(6, "Mention", 60 * 52, true, { project: "Q4 Launch", legacyId: 4598459002 }, jordan, "@Sam Sample the launch date moved, see the updated plan."),
    notification(7, "Comment", 60 * 24 * 4, false, { task: TASK.onboarding }, riley, "Added the escalation matrix."),
    notification(8, "Status", 60 * 24 * 9, false, { task: TASK.tls }, riley),
  ]

  // Field history in get_item_history's shape, newest first, by task. A task left out has none.
  const usr = (person: { id: number; name: string }) => ({ id: `w:usr:${person.id}`, name: person.name })
  const sam = { id: 1961701, name: "Sam Sample" }
  const change = (minutes: number, author: { id: number; name: string }, type: string, action: string, payload: unknown) => ({
    timestamp: minutesAgo(minutes),
    author: usr(author),
    type,
    action,
    payload,
  })
  const statusValue = (id: string, name: string) => ({ id: `w:wfst:${id}`, name, category: "Active" })
  const folderRef = (title: string, n: number) => ({ id: `w:itm:${4598458000 + n}`, title, baseType: "FOLDER" })
  const field = (n: number, name: string) => ({ id: `w:cf:${n}`, name })
  // The payload shapes Wrike sends, measured on real tasks. EFFORT is a type the client never asks for.
  const history: Record<string, ReturnType<typeof change>[]> = {
    [TASK.login]: [
      change(20, pat, "CUSTOM_FIELDS", "UPDATE", { customField: field(1201, "Work Type"), newString: "DB" }),
      change(30, jordan, "CUSTOM_FIELDS", "UPDATE", { customField: field(1202, "Labels"), oldValues: ["auth"], newValues: ["auth", "sso"] }),
      change(60, riley, "ATTACHMENTS", "ADD", { addedAttachments: [{ name: "Login flow notes", id: "w:att:4", type: "GOOGLE" }] }),
      change(60 + 1, riley, "DUE_DATE", "UPDATE", { newValue: `${addDays(today, 2)}T17:00:00` }),
      change(60 * 2, pat, "STATUS", "UPDATE", { oldValue: statusValue(STATUS.new, "New"), newValue: statusValue(STATUS.inProgress, "In Progress") }),
      change(60 * 3 + 2, pat, "ATTACHMENTS", "ADD", { addedAttachments: [{ name: "callback-loop.png", id: "w:att:1", type: "WRIKE" }] }),
      change(60 * 4, pat, "ASSIGNEES", "ADD", { addedUsers: [usr(pat)] }),
      change(60 * 5, jordan, "ASSIGNEES", "DELETE", { removedUsers: [usr(riley)] }),
      change(60 * 6, sam, "PARENTS", "ADD", { addedParents: [folderRef("Platform", 1)] }),
      change(60 * 6 + 1, sam, "PARENTS", "DELETE", { removedParents: [folderRef("Q4 Launch", 2)] }),
      change(60 * 24, sam, "START_DATE", "UPDATE", { newValue: `${addDays(today, 1)}T09:00:00` }),
      change(60 * 24 + 1, sam, "DURATION", "UPDATE", { newValue: { durationInMinutes: 960 }, oldValue: { durationInMinutes: 480 } }),
      change(60 * 24 + 2, riley, "DUE_DATE", "UPDATE", { oldValue: `${addDays(today, -3)}T17:00:00` }),
      change(60 * 24 * 2, riley, "EFFORT", "UPDATE", { newValue: { totalEffort: 120 } }),
      change(60 * 24 * 2 + 1, pat, "ATTACHMENTS", "DELETE", { removedAttachments: [{ name: "old-capture.har" }] }),
      change(60 * 24 * 2 + 2, riley, "CUSTOM_FIELDS", "UPDATE", { customField: field(1203, "Story Points"), newNumber: 5 }),
      change(60 * 24 * 3, pat, "TITLE", "UPDATE", { oldValue: "Fix login loop", newValue: "Fix login redirect loop" }),
    ],
  }

  // The response shape of GET /tasks/{id}/attachments, newest first. A linked file has no size.
  const attachments: FakeAttachment[] = [
    { id: "IEAAAAAAIYAAAA04", authorId: RILEY, name: "Login flow notes", createdDate: minutesAgo(60), version: 1, type: "Google", contentType: "application/vnd.google-apps.document", taskId: TASK.login },
    { id: "IEAAAAAAIYAAAA03", authorId: PAT, name: "whiteboard.jpg", createdDate: minutesAgo(60 * 2), version: 1, type: "Wrike", contentType: "image/jpeg", size: 2_310_442, taskId: TASK.login, width: 4032, height: 3024 },
    { id: "IEAAAAAAIYAAAA02", authorId: PAT, name: "har-capture.txt", createdDate: minutesAgo(60 * 3 + 1), version: 2, type: "Wrike", contentType: "text/plain", size: 48_213, taskId: TASK.login },
    { id: "IEAAAAAAIYAAAA01", authorId: PAT, name: "callback-loop.png", createdDate: minutesAgo(60 * 3 + 2), version: 1, type: "Wrike", contentType: "image/png", size: 182_734, taskId: TASK.login, width: 1440, height: 960 },
  ]

  return { contacts, workflows, spaces, spaceWorkflows, folders, tasks, comments, inbox, history, attachments }
}

export type FakeData = ReturnType<typeof seed>
