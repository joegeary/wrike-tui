import { describe, expect, test } from "bun:test"
import { htmlToText } from "../../src/domain/description"
import { inboxLines, parseTaskRef, taskLines } from "../../src/domain/headless"
import { customStatusId, legacyItemId, taskId } from "../../src/domain/ids"
import type { InboxEntry } from "../../src/domain/model"
import { mention, task, workflows } from "../support/app"

const titles = new Map([
  ["F1", "Platform"],
  ["F2", "Sprint: 2026-11-04 to 11-19"],
  ["F3", "Sprint planning"],
])

describe("taskLines", () => {
  test("maps every field, leaving out sprint folders and folders with no title", () => {
    const [line] = taskLines(
      [
        task("T7", "Fix\tlogin\r\n redirect", { type: "Planned", start: "2026-11-10", due: "2026-11-14" }, {
          statusId: workflows[0]!.statuses[1]!.id,
          importance: "High",
          parentIds: ["F1", "F2", "F3", "F9"],
          subTaskIds: [taskId("S1"), taskId("S2")],
          descriptionHtml: "<p>Cookie is <b>dropped</b>.</p>",
          updatedDate: "2026-11-11T08:30:00Z",
        }),
      ],
      workflows,
      titles,
    )
    expect(line).toEqual({
      id: "7",
      taskId: "T7",
      title: "Fix login redirect",
      link: "https://www.wrike.com/open.htm?id=7",
      importance: "High",
      status: "In Progress",
      statusGroup: "Active",
      color: "Blue",
      due: "2026-11-14",
      updated: "2026-11-11",
      folders: ["Platform", "Sprint planning"],
      subtasks: 2,
      description: "Cookie is dropped.",
    })
  })

  test("a status in no workflow is Unknown and Gray, and a backlog task has no due day", () => {
    const [line] = taskLines([task("T1", "Lost", { type: "Backlog" }, { statusId: customStatusId("GONE") })], workflows, titles)
    expect(line).toMatchObject({ status: "Unknown", color: "Gray", due: null })
  })

  test("sorts by the latest change first", () => {
    const tasks = [
      task("T1", "Old", undefined, { updatedDate: "2026-11-01T00:00:00Z" }),
      task("T2", "New", undefined, { updatedDate: "2026-11-12T00:00:00Z" }),
      task("T3", "Middle", undefined, { updatedDate: "2026-11-05T00:00:00Z" }),
    ]
    expect(taskLines(tasks, workflows, titles).map((line) => line.title)).toEqual(["New", "Middle", "Old"])
  })
})

describe("inboxLines", () => {
  const assigned: InboxEntry = { id: "n2", kind: "Assign", label: "EntitiesAssigned", unread: false, ts: "2026-11-12T16:00:00Z", item: null, author: null, commentText: null }

  test("newest first, with the item's permalink ID, the author's name and the comment text", () => {
    expect(inboxLines([mention, assigned])).toEqual([
      { id: "n2", kind: "Assign", label: "EntitiesAssigned", unread: false, ts: "2026-11-12T16:00:00Z", item: null, author: null, text: null },
      {
        id: mention.id,
        kind: "Mention",
        label: mention.label,
        unread: true,
        ts: mention.ts,
        item: { id: mention.item!.legacyId, title: mention.item!.title, link: mention.item!.permalink, type: mention.item!.baseType },
        author: mention.author!.name,
        text: mention.commentText,
      },
    ])
  })
})

describe("parseTaskRef", () => {
  test("reads a permalink, its number and an API ID", () => {
    expect(parseTaskRef("https://www.wrike.com/open.htm?id=4598459107")).toEqual({ kind: "legacy", id: legacyItemId("4598459107")! })
    expect(parseTaskRef(" 4598459107 ")).toEqual({ kind: "legacy", id: legacyItemId("4598459107")! })
    expect(parseTaskRef("IEAAAAAAKQAAAA07")).toEqual({ kind: "task", id: taskId("IEAAAAAAKQAAAA07") })
    expect(parseTaskRef("MAAAAAER7i1K")).toEqual({ kind: "task", id: taskId("MAAAAAER7i1K") })
  })

  test("refuses anything else", () => {
    for (const input of ["", "login bug", "nope", "https://example.test/open.htm", "ieaaaaaakqaaaa07"]) expect(parseTaskRef(input)).toBeNull()
  })
})

describe("htmlToText", () => {
  test("puts each paragraph and list item on its own line, with nested items indented", () => {
    expect(htmlToText("Bugs:<br /><ul><li>One<br /><ul><li>Inner</li></ul></li><li><p>Two</p></li></ul><p>After &amp; <i>done</i>&nbsp;now</p>")).toBe(
      "Bugs:\n• One\n  • Inner\n• Two\nAfter & done now",
    )
  })

  test("keeps the blank line two breaks make and drops runs of more", () => {
    expect(htmlToText("A<br /><br /><br /><br />B")).toBe("A\n\nB")
  })

  test("keeps preformatted text as written and puts table cells of a row on one line", () => {
    expect(htmlToText("<pre>  indented\n  code</pre><table><tr><td>Fix</td><td>Status</td></tr><tr><td>a</td><td>Done</td></tr></table>")).toBe(
      "  indented\n  code\nFix Status\na Done",
    )
  })

  test("an empty description is empty", () => {
    expect(htmlToText("")).toBe("")
  })
})
