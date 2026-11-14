import { TextAttributes } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { ME, PAT, STATUS, TASK } from "../fake/data"
import { openApp } from "./harness"

let app: Awaited<ReturnType<typeof openApp>>
afterEach(() => app.close())

const WIDE = { width: 200, height: 50 }

/** The frame's lines between the list pane's borders, trimmed. */
function listPane(frame: string): string[] {
  return frame
    .split("\n")
    .slice(1, -3)
    .map((line) => line.split("││")[1]?.trim() ?? "")
    .filter((line) => line !== "")
}

describe("Inbox", () => {
  test("lists unread notifications with type, task, author and comment, and Enter opens the task", async () => {
    app = await openApp(WIDE)
    const inbox = await app.see("Enable SSO on sandbox")
    expect(inbox).toContain("2 Inbox")
    expect(inbox).toMatch(/● Mention\s+Enable SSO on sandbox\s+35m/)
    expect(inbox).toContain("Pat Example: @Sam Sample can we run trainings in the sandbox?")
    expect(inbox).toMatch(/● Assign\s+Rotate API keys for the staging cluster\s+2h/)
    expect(inbox).toMatch(/● Other\s+Approval requested\s+1d/)
    expect(inbox).toMatch(/│ {3}Inbox\s+6 │/)
    expect(inbox).not.toContain("Added the escalation matrix")

    await app.press("enter")
    const details = await app.see("Register the sandbox as a service provider", "Comments (3)")
    expect(details).toMatch(/Status\s+● In Progress/)
    expect(details).toMatch(/Importance\s+High/)
    expect(details).toMatch(/Assignees\s+Sam Sample, Pat Example/)
    expect(details).toMatch(/Due\s+2026-11-11 {2}Nov 11, overdue/)
    expect(details).toMatch(/Folders\s+Platform, Q4 Launch/)
    expect(details).toContain("https://www.wrike.com/open.htm?id=4598459101")
    expect(details).toContain("@Sam Sample can we run trainings in the sandbox?")
    expect(details).toContain("Pilot accounts are created in PR 7")
    expect(details).not.toContain("](https://example.test/pull/7)")
    expect(app.fake.requests).toContain(`GET /api/v4/ids?ids=%5B%224598459101%22%5D&type=ApiV2Task`)
    expect(app.store.getState().focus).toBe("details")
  })

  test("a shows read notifications too", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("a")
    const frame = await app.see("Added the escalation matrix", "2 Inbox (with read)")
    expect(frame).toMatch(/○ Comment\s+Write onboarding guide for new support agents/)
  })
})

test("My to-do groups my active tasks by due date", async () => {
  app = await openApp(WIDE)
  await app.see("Enable SSO on sandbox")
  await app.press("t")
  const frame = await app.see("2 My to-do", "Overdue 1")
  const expected = [
    "▾ Overdue 1",
    "! Enable SSO on sandbox",
    "▾ Today 1",
    "Rotate API keys for the staging cluster",
    "▾ This week 1",
    "Draft the Q4 launch checklist",
    "▾ Later 2",
    "↓ Write onboarding guide for new support agents",
    "↓ Archive last year's dashboards",
    "▾ No date 1",
    "Clean up stale feature flags",
  ]
  const lines = listPane(frame)
  expect(lines).toHaveLength(expected.length)
  expected.forEach((start, index) => expect(lines[index]).toStartWith(start))
  expect(frame).toMatch(/Enable SSO on sandbox\s+In Progress\s+Nov 11/)
  expect(frame).not.toContain("Fix login redirect loop")
})

describe("Search", () => {
  test("a title query lists matching tasks across the account", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("/")
    await app.see("title, permalink or task ID")
    await app.type("fix")
    await app.press("enter")
    const frame = await app.see("2 Search: fix", "Fix login redirect loop")
    expect(frame).toMatch(/Fix flaky export test\s+Completed/)
    expect(frame).toMatch(/│ {3}Search\s+2 │/)
  })

  test("a numeric ID opens that task, and an unknown one says nothing matches", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("/")
    await app.type("4598459105")
    await app.press("enter")
    await app.see("Clean up stale feature flags", "No description.", "No comments yet. Press c to write one.")
    await app.press("/")
    await app.type("999")
    await app.press("enter")
    await app.see('No task matches "999".')
  })
})

describe("Editing a task", () => {
  test("s changes the status through the picker", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("s")
    const picker = await app.see("─ Status ─", "On Hold")
    expect(picker).toMatch(/▸ ● In Progress\s+Active/)
    expect(picker).not.toContain("Legacy Review")
    await app.type("comp")
    expect(await app.see("Filter: comp")).not.toContain("On Hold")
    await app.press("enter")
    const saved = await app.see("Status set to Completed")
    expect(saved).toMatch(/Status\s+● Completed/)
    expect(saved).toMatch(/My to-do\s+5 /)
    expect(app.fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.sso}`, params: { customStatus: STATUS.completed } }])
  })

  test("e walks the fields and the title is typed in place", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("e")
    expect(await app.see("Edit mode")).toMatch(/▸ Enable SSO on sandbox/)
    await app.press("j")
    expect(await app.frame()).toMatch(/▸ Status\s+● In Progress/)
    await app.press("k", "enter")
    await app.type(" v2")
    await app.press("left", "left", "left")
    await app.type(",")
    await app.press("enter")
    const saved = await app.see("Title saved")
    expect(saved).toMatch(/▸ Enable SSO on sandbox, v2/)
    expect(app.fake.writes.at(-1)).toEqual({ method: "PUT", path: `/tasks/${TASK.sso}`, params: { title: "Enable SSO on sandbox, v2" } })
    await app.press("esc")
    expect(await app.frame()).not.toContain("Edit mode")
  })

  test("A toggles assignees and p sets the importance", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("A")
    const picker = await app.see("─ Assignees ─")
    // A blank column keeps the email off the right border, as on the left.
    expect(picker).toMatch(/│ {3}\[x\] Pat Example\s+pat\.example@example\.test │/)
    expect(picker).toMatch(/\[ \] Riley Demo/)
    expect(picker).not.toContain("Former Colleague")
    await app.type("ril")
    await app.press(" ", "enter")
    expect(await app.see("Assignees updated")).toMatch(/Assignees\s+Sam Sample, Pat Example, Riley Demo/)
    await app.press("p", "down", "down", "enter")
    expect(await app.see("Importance set to Low")).toMatch(/Importance\s+Low/)
    expect(app.fake.writes.map((write) => write.params)).toEqual([{ addResponsibles: '["KUAAAA03"]' }, { importance: "Low" }])
  })

  test("E round-trips a simple description through markdown", async () => {
    app = await openApp(WIDE)
    app.outside.editor = (initial) => initial.replace("two pilot accounts", "**three** pilot accounts")
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("E")
    await app.see("Description saved from markdown", "Test with three pilot accounts")
    expect(app.outside.edited).toEqual([{ initial: expect.stringContaining("## Goal\n\nStaff sign in"), extension: "md" }])
    const { description } = app.fake.writes[0]!.params
    expect(description).toStartWith("<h2>Goal</h2>Staff sign in to the sandbox")
    expect(description).toContain("<li>Test with <b>three</b> pilot accounts</li>")
    expect(description).toContain('<a href="https://example.test/runbooks/sso">SSO runbook</a>')
  })

  test("E opens a description with rich formatting as raw HTML, and an unchanged file saves nothing", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("j", "enter")
    await app.see("Rotate before the audit")
    await app.press("E")
    await app.see("Description unchanged")
    expect(app.outside.edited).toEqual([{ initial: expect.stringContaining('<span style="color:#d73a49">old prefixes</span>'), extension: "html" }])
    expect(app.fake.writes).toEqual([])
  })

  test("an editor that cannot start is reported and nothing is saved", async () => {
    app = await openApp(WIDE)
    app.outside.editor = () => {
      throw new Error("Executable not found in $PATH: \"nvim\"")
    }
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("E")
    await app.see('Could not run the editor: Executable not found in $PATH: "nvim"')
    expect(app.fake.writes).toEqual([])
  })
})

describe("A formatted description", () => {
  async function openChecklistTask() {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("/")
    await app.type("4598459103")
    await app.press("enter")
    return app.see("Draft the Q4 launch checklist", "Comments (0)", "☑ Book the venue", /│Venue\s+│Riley Sam\s+│/)
  }

  test("reads as checkboxes and plain text in the details pane, with no style markers", async () => {
    const frame = await openChecklistTask()
    expect(frame).toContain("☐ Send the invites")
    expect(frame).toContain("Partners first")
    expect(frame).toContain("Budget is fixed at 10k.")
    expect(frame).toContain("See the venue (https://example.test/venue) and its plan (image)")
    for (const marker of ["[x]", "[ ]", "{color", "==", "++", "{rel", "<br>", "&#32;", "\\"]) expect(frame).not.toContain(marker)
  })

  test("E opens it as markdown, and ticking a box saves Wrike's checklist with every other style intact", async () => {
    await openChecklistTask()
    const stored = app.fake.data.tasks.find((task) => task.id === TASK.checklist)!.description
    app.outside.editor = (initial) => initial.replace("- [ ] {color:#191919}Send", "- [x] {color:#191919}Send")
    await app.press("E")
    await app.see("Description saved from markdown")
    expect(app.outside.edited).toEqual([
      {
        initial: [
          "One page, owners named per line.\\",
          "- [x] Book the venue",
          "- [ ] {color:#191919}Send the invites{color}",
          "  - Partners first",
          "",
          "",
          "=={#ffcc80}Budget== is ++fixed++ at {color:#D81B60}10k{color}.\\",
          "See [the venue](https://example.test/venue){rel=nofollow} and its plan ![](//storage.example.test/plan.png)\\",
          "| **Item** | **Owner** |",
          "| --- | --- |",
          "| Venue | Riley<br>Sam |",
        ].join("\n"),
        extension: "md",
      },
    ])
    expect(app.fake.writes[0]!.params.description).toBe(stored.replace('<input type="checkbox" /><span', '<input type="checkbox" checked="checked" /><span'))
  })
})

describe("Comments", () => {
  test("c posts a comment and shows it at the end of the thread", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.see("─ New comment ─", "Write a comment")
    await app.type("Yes, the sandbox is ready for trainings.")
    await app.press("enter")
    const posted = await app.see("Comment posted", "Comments (4)", "Yes, the sandbox is ready for trainings.")
    expect(posted).not.toContain("─ New comment ─")
    expect(app.fake.writes).toEqual([
      { method: "POST", path: `/tasks/${TASK.sso}/comments`, params: { text: "Yes, the sandbox is ready for trainings.", plainText: "true" } },
    ])
  })
})

describe("Writing below the fold", () => {
  test("c brings the newest comment into view above the box, and the mention list does not hide it", async () => {
    app = await openApp({ width: 160, height: 30 })
    const sso = app.fake.data.tasks.find((task) => task.id === TASK.sso)!
    sso.description += Array.from({ length: 30 }, (_, i) => `<br />Step ${i + 1}`).join("")
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    const opened = await app.see("Step 1")
    // The comment as the details stream draws it, not the Inbox row that quotes it.
    const newest = /│ +@Sam Sample can we run trainings in the sandbox\? +[█▄▀]?│/
    expect(opened).not.toMatch(newest)
    await app.press("c")
    await app.see("─ New comment ─", newest)
    await app.type("Thanks @ri")
    await app.see("─ Mention ─", "Riley Demo", newest)
  })
})

describe("Selecting comments", () => {
  test("] and [ select a comment with a bar beside it, and Esc clears the selection", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("]")
    const first = await app.see(/┃Riley Demo/, /┃The identity provider team needs the entity ID by Friday\./)
    expect(first).toMatch(/ Sam Sample\s+\w{3} \d+ \d\d:\d\d/)
    await app.press("]", "]", "]")
    const last = await app.see(/┃Pat Example/)
    expect(last).not.toContain("┃Riley Demo")
    await app.press("[")
    await app.see(/┃Sam Sample/)
    await app.press("?")
    const legend = await app.see("─ Keys ─")
    expect(legend).toMatch(/\]\s+Select the next item/)
    expect(legend).toMatch(/\[\s+Select the previous item/)
    expect(legend).toMatch(/Esc\s+Clear the selection/)
    await app.press("esc", "esc")
    const cleared = await app.see(/^(?![\s\S]*┃)/)
    expect(cleared).toContain("Comments (3)")
  })
})

describe("Editing my comment", () => {
  test("Enter edits my newest comment in its five minutes, with the time left ticking", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("The sandbox is ready")
    await app.press("enter")
    await app.see("Comment posted", "Comments (4)")
    const posted = app.fake.data.comments[0]!
    await app.press("[")
    await app.see(/┃Sam Sample\s+\w{3} \d+ \d\d:\d\d\s+editable for 5:00/)
    app.advance(108)
    await app.see(/┃Sam Sample\s+\w{3} \d+ \d\d:\d\d\s+editable for 3:12/)
    await app.press("enter")
    await app.see("─ Edit comment, 3:12 left ─", "The sandbox is ready", "Enter save  Ctrl+E editor  Esc discard")
    await app.type(" for trainings.")
    await app.press("enter")
    const saved = await app.see("Comment saved", "The sandbox is ready for trainings.")
    expect(saved).toContain("Comments (4)")
    expect(app.fake.writes.at(-1)).toEqual({ method: "PUT", path: `/comments/${posted.id}`, params: { text: "The sandbox is ready for trainings.", plainText: "true" } })

    app.advance(200)
    const closed = await app.see(/┃Sam Sample\s+\w{3} \d+ \d\d:\d\d\s+│/)
    expect(closed).not.toContain("editable for")
    await app.press("enter")
    await app.see("Comments can only be edited in the 5 minutes after posting")
    expect(app.fake.writes).toHaveLength(2)
  })
})

describe("The comment box", () => {
  /** Opens the SSO task and posts `text` through the editor, which takes what one line cannot. */
  async function postThroughEditor(text: string) {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    app.outside.editor = () => text
    await app.press("c")
    await app.type("x")
    await app.press("ctrl+e")
    await app.see("Comment posted", "Comments (4)")
    app.outside.editor = (initial) => initial
  }

  /** Opens my newest comment in the box, presses `keys`, saves, and gives what Wrike stored before and after. */
  async function editWith(keys: () => Promise<void>) {
    const before = app.fake.data.comments[0]!.text
    await app.press("[", "enter")
    await app.see(/─ Edit comment, \d:\d\d left ─/)
    await keys()
    await app.press("enter")
    await app.see("Comment saved")
    return { before, after: app.fake.data.comments[0]!.text }
  }

  test("an edit saved after one keystroke changes exactly that keystroke, across lines", async () => {
    await postThroughEditor("First line.\nSecond line.")
    const { before, after } = await editWith(() => app.type("!"))
    expect(before).toBe("First line.<br />Second line.")
    expect(after).toBe(`${before}!`)
  })

  test("an edit saved after one keystroke keeps a mention on the second line", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("@pa")
    await app.press("tab")
    await app.type("please review")
    app.outside.editor = (initial) => `Heads up\n${initial}`
    await app.press("ctrl+e")
    await app.see("Comment posted")
    app.outside.editor = (initial) => initial
    const { before, after } = await editWith(() => app.type("!"))
    expect(before).toBe(`Heads up<br /><a class="stream-user-id avatar" rel="${PAT}">&#64;Pat Example</a> please review`)
    expect(after).toBe(`${before}!`)
  })

  test("an edit of a comment over 1,000 characters keeps all of it", async () => {
    const long = "word ".repeat(260).trim()
    await postThroughEditor(long)
    const { after } = await editWith(() => app.press("backspace"))
    expect(after).toBe(long.slice(0, -1))
  })

  test("a comment typed past 1,000 characters posts whole", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("abcdefghij".repeat(105))
    await app.press("enter")
    await app.see("Comment posted")
    expect(app.fake.writes.at(-1)!.params.text).toBe("abcdefghij".repeat(105))
  })

  test("Alt+Enter and Ctrl+J start a new line, the box grows to show it, and Enter posts them all", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.see("Alt+Enter new line")
    await app.type("First line.")
    await app.press("alt+enter")
    await app.type("Second line.")
    await app.see(/│First line\. +││\n.*│Second line\. +││/)
    await app.press("ctrl+j")
    await app.type("Third, after Ctrl+J.")
    await app.press("enter")
    await app.see("Comment posted")
    expect(app.fake.writes.at(-1)!.params).toEqual({ text: "First line.\nSecond line.\nThird, after Ctrl+J.", plainText: "true" })
  })

  test("a comment longer than Wrike's 10,000 characters is refused and the draft stays", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    app.outside.editor = () => "a".repeat(10_001)
    await app.press("c")
    await app.type("x")
    await app.press("ctrl+e")
    await app.see("Wrike takes up to 10,000 characters in a comment, and this one has 10,001", "─ New comment ─")
    expect(app.fake.writes).toEqual([])
    await app.press("backspace", "enter")
    await app.see("Comment posted")
    expect(app.fake.writes.at(-1)!.params.text).toHaveLength(10_000)
  })
})

describe("Deleting my comment", () => {
  test("d asks, any other key keeps it, and y deletes it", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    const mine = app.fake.data.comments.find((comment) => comment.authorId === ME && comment.taskId === TASK.sso)!
    await app.press("[", "[", "d")
    await app.see("Delete this comment? y deletes, any other key keeps it", "y delete  n keep")
    await app.press("j")
    await app.see("Kept the comment", "Comments (3)")
    await app.press("d")
    await app.see("Delete this comment?")
    await app.press("y")
    const deleted = await app.see("Comment deleted", "Comments (2)")
    expect(deleted).not.toContain("Waiting on the metadata file.")
    expect(app.fake.writes).toEqual([{ method: "DELETE", path: `/comments/${mine.id}`, params: {} }])
  })
})

describe("Mentions", () => {
  test("a mention in a comment reads as a bold name", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)", /│ +@Sam Sample can we run trainings in the sandbox\? +│/)
    const mention = (await app.spans()).filter((span) => span.text === "@Sam Sample")
    expect(mention).toHaveLength(1)
    expect(mention[0]!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  })

  test("@ and letters offer people, Tab picks one, and the comment posts Wrike's mention anchor", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("@pa")
    const offered = await app.see("─ Mention ─", "▸ Pat Example  pat.example@example.test", "Tab mention  Esc close list")
    expect(offered).not.toContain("Riley Demo  riley")
    await app.press("tab")
    await app.see(/│@Pat Example +│/, /^(?![\s\S]*─ Mention ─)/)
    await app.type("can we run <trainings> & demos?")
    await app.press("enter")
    await app.see("Comment posted", "Comments (4)", "can we run <trainings> & demos?")
    expect(app.fake.writes).toEqual([
      {
        method: "POST",
        path: `/tasks/${TASK.sso}/comments`,
        params: { text: `<a class="stream-user-id avatar" rel="${PAT}">&#64;Pat Example</a> can we run &lt;trainings&gt; &amp; demos?` },
      },
    ])
  })
})

describe("Keys and panes", () => {
  test("v gives the details pane the list's room", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("v")
    const zoomed = await app.see("3 Details")
    expect(zoomed).not.toContain("2 Inbox")
    expect(zoomed).toContain("1 Wrike")
    await app.press("v")
    await app.see("2 Inbox")
  })
})

describe("Failures", () => {
  test("a failed list load shows the error and r retries", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    app.fake.fail({ path: "/api/v4/tasks", status: 500 })
    await app.press("t")
    const failed = await app.see("Wrike failed with 500: Injected failure. Press r to retry.")
    expect(failed).toContain("Overdue 1")
    await app.press("r")
    expect(await app.see("Overdue 1")).not.toContain("Wrike failed")
  })

  test("a task whose status belongs to a space workflow still shows and changes status", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t", "j", "j", "j", "j", "j", "j", "enter")
    await app.see("Cover the queue views", /Status\s+● Triage/)
    await app.press("s")
    await app.see("Waiting on customer")
    await app.press("down", "down", "enter")
    await app.see("Status set to Resolved")
    // Space workflows load once: one request per space, and never a second round.
    const workflowLoads = app.fake.requests.filter((line) => /^GET \/api\/v4\/spaces\/[^/]+\/workflows$/.test(line))
    expect(workflowLoads.sort()).toEqual(app.fake.data.spaces.map((space) => `GET /api/v4/spaces/${space.id}/workflows`).sort())
  })
})
