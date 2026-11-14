import { describe, expect, test } from "bun:test"
import { safeFileName, skipReason, taskMarkdown, type AttachmentOutcome, type TaskSheet } from "../../src/domain/agent-context"
import type { CustomField } from "../../src/domain/fields"
import { attachmentId, commentId, customFieldId, folderId, userId } from "../../src/domain/ids"
import type { Attachment, Comment } from "../../src/domain/model"
import { contacts, ME, PAT, RILEY, task, workflows } from "../support/app"

const attachment = (name: string, extra: Partial<Attachment> = {}): Attachment => ({
  id: attachmentId(`A-${name}`),
  name,
  storage: "Wrike",
  contentType: "image/png",
  size: 180_000,
  authorId: PAT,
  createdDate: "2026-11-11T09:00:00Z",
  ...extra,
})

const comment = (id: string, authorId: typeof ME, text: string, createdDate: string): Comment => ({ id: commentId(id), authorId, text, createdDate })

const POINTS: CustomField = { id: customFieldId("F1"), title: "Story Points", kind: { type: "Numeric", decimals: 0 }, readOnly: false, archived: false }
const LABELS: CustomField = { id: customFieldId("F2"), title: "Labels", kind: { type: "Multiple", options: ["auth", "sso"], allowOther: false }, readOnly: false, archived: false }

const sheet = (extra: Partial<TaskSheet> = {}): TaskSheet => ({
  task: task("T7", "Fix login redirect loop", { type: "Planned", start: "2026-11-10", due: "2026-11-14" }, {
    statusId: workflows[0]!.statuses[1]!.id,
    importance: "High",
    assigneeIds: [PAT, RILEY],
    descriptionHtml: "<p>The session cookie is <strong>dropped</strong> after the callback.</p><ul><li>Chrome</li><li>Firefox</li></ul>",
    fields: [
      { id: POINTS.id, value: "5" },
      { id: LABELS.id, value: '["auth","sso"]' },
      { id: customFieldId("F3"), value: "" },
    ],
  }),
  comments: [
    comment("C2", PAT, `<a class="stream-user-id avatar" rel="${RILEY}">@Riley Demo</a> can you check Safari?`, "2026-11-12T10:30:00Z"),
    comment("C1", RILEY, "Repro steps attached.<br />It loops after the callback.", "2026-11-11T09:05:00Z"),
  ],
  contacts: new Map(contacts.map((contact) => [contact.id, contact])),
  workflows,
  fields: new Map([[POINTS.id, POINTS], [LABELS.id, LABELS]]),
  folders: [{ id: folderId("PLAT"), title: "Platform" }, { id: folderId("LAUNCH"), title: "Q4 Launch" }],
  attachments: [],
  ...extra,
})

describe("task.md", () => {
  test("names the task's fields, folders and set custom fields, with people by name", () => {
    const markdown = taskMarkdown(sheet())
    expect(markdown).toStartWith(`# Fix login redirect loop

- Link: https://www.wrike.com/open.htm?id=7
- Status: In Progress
- Importance: High
- Assignees: Pat Example, Riley Demo
- Start: 2026-11-10
- Due: 2026-11-14
- Created: 2026-10-01 00:00 UTC
- Folders: Platform, Q4 Launch

## Custom fields

- Story Points: 5
- Labels: auth, sso

## Description
`)
  })

  test("writes the description as Markdown", () => {
    expect(taskMarkdown(sheet())).toContain("## Description\n\nThe session cookie is __dropped__ after the callback.\n\n- Chrome\n- Firefox\n\n## Comments")
  })

  test("lists the comments oldest first under their authors' names, with mentions as names", () => {
    const markdown = taskMarkdown(sheet())
    expect(markdown).toEndWith(`## Comments

### Riley Demo, 2026-11-11 09:05 UTC

Repro steps attached.  
It loops after the callback.

### Pat Example, 2026-11-12 10:30 UTC

__@Riley Demo__ can you check Safari?
`)
  })

  test("says when there is no description, no comment, no date and nobody assigned", () => {
    const bare = taskMarkdown(sheet({ task: task("T8", "Empty", { type: "Backlog" }, { assigneeIds: [] }), comments: [], folders: [] }))
    expect(bare).toContain("- Assignees: nobody\n- Dates: none\n")
    expect(bare).toContain("- Folders: none Wrike could name\n")
    expect(bare).toContain("## Description\n\nNo description.\n\n## Comments\n\nNo comments.\n")
    expect(bare).not.toContain("## Custom fields")
    expect(bare).not.toContain("## Attachments")
  })

  test("lists every attachment and tells the saved, the skipped and the failed apart", () => {
    const outcomes: AttachmentOutcome[] = [
      { kind: "saved", attachment: attachment("callback-loop.png"), file: "callback-loop.png" },
      { kind: "saved", attachment: attachment("shot.png", { id: attachmentId("A-shot-2") }), file: "shot (2).png" },
      { kind: "skipped", attachment: attachment("har-capture.txt", { contentType: "text/plain" }), why: "not an image" },
      { kind: "skipped", attachment: attachment("Login flow notes", { storage: "Google" }), why: "linked from Google" },
      { kind: "skipped", attachment: attachment("huge.png"), why: "over 10 MB" },
      { kind: "failed", attachment: attachment("whiteboard.jpg"), why: "Wrike answered 500" },
    ]
    expect(taskMarkdown(sheet({ attachments: outcomes }))).toContain(`## Attachments

- callback-loop.png: saved in this folder
- shot.png: saved in this folder as shot (2).png
- har-capture.txt: not downloaded, not an image
- Login flow notes: not downloaded, linked from Google
- huge.png: not downloaded, over 10 MB
- whiteboard.jpg: could not be downloaded, Wrike answered 500

## Comments`)
  })
})

describe("attachments for the agent", () => {
  test("only an image Wrike stores, up to 10 MB, is downloaded", () => {
    expect(skipReason(attachment("a.png"))).toBeNull()
    expect(skipReason(attachment("a.png", { size: null }))).toBeNull()
    expect(skipReason(attachment("big.png", { size: 10 * 1024 * 1024 + 1 }))).toBe("over 10 MB")
    expect(skipReason(attachment("notes.txt", { contentType: "text/plain" }))).toBe("not an image")
    expect(skipReason(attachment("Doc", { storage: "Google", contentType: "image/png" }))).toBe("linked from Google")
  })

  test("a file keeps its name without path separators or control characters, and a clash gets a number", () => {
    expect(safeFileName("callback-loop.png", new Set())).toBe("callback-loop.png")
    expect(safeFileName("../../etc/passwd", new Set())).toBe("etcpasswd")
    expect(safeFileName(".env.png", new Set())).toBe("env.png")
    expect(safeFileName("a\\b/c\x07d\n.png", new Set())).toBe("abcd.png")
    expect(safeFileName("..", new Set())).toBe("attachment")
    expect(safeFileName("shot.png", new Set(["shot.png"]))).toBe("shot (2).png")
    expect(safeFileName("Shot.PNG", new Set(["shot.png", "Shot (2).PNG"]))).toBe("Shot (3).PNG")
    expect(safeFileName("task.md", new Set())).toBe("task (2).md")
  })
})
