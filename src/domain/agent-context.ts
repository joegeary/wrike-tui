import { showMentions } from "./comment"
import { displayMarkdown } from "./description"
import { fieldText, type CustomField } from "./fields"
import type { CustomFieldId, UserId } from "./ids"
import { dueDay, findStatus, hasPreview, startDay, type Attachment, type Comment, type Contact, type FolderRef, type Task, type Workflow } from "./model"

/** A screenshot over this size is listed in task.md and not downloaded. */
export const SCREENSHOT_LIMIT = 10 * 1024 * 1024
export const TASK_FILE = "task.md"

/** What became of one attachment: saved beside task.md under `file`, left out and why, or a download that failed. */
export type AttachmentOutcome =
  | { kind: "saved"; attachment: Attachment; file: string }
  | { kind: "skipped"; attachment: Attachment; why: string }
  | { kind: "failed"; attachment: Attachment; why: string }

/**
 * Why an attachment is not downloaded, or null for a screenshot that is. Only
 * an image Wrike stores is, and only up to 10 MB. A linked file lives elsewhere.
 */
export function skipReason(attachment: Attachment): string | null {
  if (attachment.storage !== "Wrike") return `linked from ${attachment.storage}`
  if (!hasPreview(attachment)) return "not an image"
  if (attachment.size !== null && attachment.size > SCREENSHOT_LIMIT) return "over 10 MB"
  return null
}

const UNSAFE = /[/\\\x00-\x1f\x7f]/g
const LONGEST = 120

/**
 * A file name to save an attachment under: its own name without path
 * separators, control characters or leading dots, never task.md, and never
 * one already taken. A clash gets a number before the extension.
 */
export function safeFileName(name: string, taken: ReadonlySet<string>): string {
  // Leading dots go too, so no name climbs a folder or hides the file.
  let clean = name.replace(UNSAFE, "").trim().replace(/^\.+/, "")
  if (clean === "") clean = "attachment"
  const dot = clean.lastIndexOf(".")
  const [stem, extension] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""]
  const short = stem.slice(0, LONGEST)
  const used = new Set([...taken, TASK_FILE].map((file) => file.toLowerCase()))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${short}${extension}` : `${short} (${n})${extension}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

export type TaskSheet = {
  task: Task
  comments: readonly Comment[]
  contacts: ReadonlyMap<UserId, Contact>
  workflows: readonly Workflow[]
  fields: ReadonlyMap<CustomFieldId, CustomField>
  /** The folders the task is in, as Wrike named them. */
  folders: readonly FolderRef[]
  attachments: readonly AttachmentOutcome[]
}

const UNKNOWN = "Unknown user"

/** A Wrike timestamp as `2026-11-12 14:03 UTC`. Anything else is kept as it came. */
function when(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(timestamp)
  return match ? `${match[1]} ${match[2]} UTC` : timestamp
}

function attachmentLine(outcome: AttachmentOutcome): string {
  const { name } = outcome.attachment
  switch (outcome.kind) {
    case "saved":
      return outcome.file === name ? `- ${name}: saved in this folder` : `- ${name}: saved in this folder as ${outcome.file}`
    case "skipped":
      return `- ${name}: not downloaded, ${outcome.why}`
    case "failed":
      return `- ${name}: could not be downloaded, ${outcome.why}`
  }
}

/**
 * The task as Markdown for a coding agent: its fields, its description, its
 * attachments, and its comments oldest first with their authors' names.
 */
export function taskMarkdown(sheet: TaskSheet): string {
  const { task } = sheet
  const name = (id: UserId) => sheet.contacts.get(id)?.name
  const start = startDay(task.dates)
  const due = dueDay(task.dates)
  const assignees = task.assigneeIds.map((id) => name(id) ?? UNKNOWN)
  const facts = [
    `- Link: ${task.permalink}`,
    `- Status: ${findStatus([...sheet.workflows], task.statusId)?.name ?? task.statusGroup}`,
    `- Importance: ${task.importance}`,
    `- Assignees: ${assignees.length > 0 ? assignees.join(", ") : "nobody"}`,
    ...(start ? [`- Start: ${start}`] : []),
    ...(due ? [`- Due: ${due}`] : []),
    ...(!start && !due ? ["- Dates: none"] : []),
    `- Created: ${when(task.createdDate)}`,
    `- Folders: ${sheet.folders.length > 0 ? sheet.folders.map((folder) => folder.title).join(", ") : "none Wrike could name"}`,
  ]
  const fields = task.fields
    .filter((value) => value.value.trim() !== "")
    .map((value) => {
      const field = sheet.fields.get(value.id)
      return `- ${field?.title ?? value.id}: ${fieldText(field?.kind, value.value)}`
    })
  const description = displayMarkdown(task.descriptionHtml).trim()
  const comments = sheet.comments
    .toSorted((a, b) => a.createdDate.localeCompare(b.createdDate))
    .map((comment) => `### ${name(comment.authorId) ?? UNKNOWN}, ${when(comment.createdDate)}\n\n${displayMarkdown(showMentions(comment.text, name)).trim()}`)
  const sections = [
    `# ${task.title}`,
    facts.join("\n"),
    ...(fields.length > 0 ? ["## Custom fields", fields.join("\n")] : []),
    "## Description",
    description === "" ? "No description." : description,
    ...(sheet.attachments.length > 0 ? ["## Attachments", sheet.attachments.map(attachmentLine).join("\n")] : []),
    "## Comments",
    ...(comments.length > 0 ? comments : ["No comments."]),
  ]
  return `${sections.join("\n\n")}\n`
}
