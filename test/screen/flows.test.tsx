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

  test("Enter on a project notification opens the browser, and on one without an item says so", async () => {
    app = await openApp(WIDE)
    await app.see("Q4 Launch")
    await app.press("G", "enter")
    await app.see("Opening the project in the browser")
    expect(app.outside.opened).toEqual(["https://www.wrike.com/open.htm?id=4598459002"])
    await app.press("k", "enter")
    await app.see("This notification has nothing to open")
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

  test("a pasted permalink opens that task", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("/")
    await app.type("https://www.wrike.com/open.htm?id=4598459107")
    await app.press("enter")
    const frame = await app.see("The session cookie is dropped", "Comments (1)")
    expect(frame).toMatch(/Assignees\s+Pat Example/)
    expect(app.store.getState().focus).toBe("details")
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

  test("a bad due date is refused in place and a good one is saved", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("e", "j", "j", "j", "j", "j", "enter", "ctrl+u")
    await app.type("soon")
    await app.press("enter")
    await app.see("Use YYYY-MM-DD, or leave it empty to clear")
    expect(app.fake.writes).toEqual([])
    await app.press("ctrl+u")
    await app.type("2026-12-04")
    await app.press("enter")
    const saved = await app.see("Due date set to 2026-12-04")
    expect(saved).toMatch(/Due\s+2026-12-04 {2}Dec 4\s/)
    expect(app.fake.writes).toEqual([
      { method: "PUT", path: `/tasks/${TASK.sso}`, params: { dates: '{"type":"Planned","start":"2026-11-07","due":"2026-12-04"}' } },
    ])
  })

  test("A toggles assignees and p sets the importance", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("A")
    const picker = await app.see("─ Assignees ─")
    expect(picker).toMatch(/\[x\] Pat Example\s+pat\.example@example\.test/)
    expect(picker).toMatch(/\[ \] Riley Demo/)
    expect(picker).not.toContain("Former Colleague")
    await app.type("ril")
    await app.press(" ", "enter")
    expect(await app.see("Assignees updated")).toMatch(/Assignees\s+Sam Sample, Pat Example, Riley Demo/)
    await app.press("p", "down", "down", "enter")
    expect(await app.see("Importance set to Low")).toMatch(/Importance\s+Low/)
    expect(app.fake.writes.map((write) => write.params)).toEqual([{ addResponsibles: '["KUAAAA03"]' }, { importance: "Low" }])
  })

  test("m takes a task that is someone else's, and it joins My to-do", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("/")
    await app.type("login")
    await app.press("enter")
    await app.see("Fix login redirect loop")
    await app.press("m")
    const taken = await app.see("Assigned to you")
    expect(taken).toMatch(/Assignees\s+Pat Example, Sam Sample/)
    expect(taken).toMatch(/My to-do\s+7 /)
    expect(app.fake.writes).toEqual([{ method: "PUT", path: `/tasks/${TASK.login}`, params: { addResponsibles: `["${ME}"]` } }])
    await app.press("m")
    await app.see("Already assigned to you")
    expect(app.fake.writes).toHaveLength(1)
    expect(app.fake.data.tasks.find((task) => task.id === TASK.login)!.responsibleIds).toEqual([PAT, ME])
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
    for (const marker of ["[x]", "[ ]", "{color", "==", "++", "{rel", "<br>", "&#32;"]) expect(frame).not.toContain(marker)
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
          "One page, owners named per line.  ",
          "- [x] Book the venue",
          "- [ ] {color:#191919}Send the invites{color}",
          "  - Partners first",
          "",
          "",
          "=={#ffcc80}Budget== is ++fixed++ at {color:#D81B60}10k{color}.  ",
          "See [the venue](https://example.test/venue){rel=nofollow} and its plan ![](//storage.example.test/plan.png)  ",
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

  test("Ctrl+E finishes a comment in the editor and Esc discards a draft", async () => {
    app = await openApp(WIDE)
    app.outside.editor = (initial) => `${initial}\nSecond line from the editor.\n`
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("Never sent")
    await app.press("esc", "c")
    await app.type("First line.")
    await app.press("ctrl+e")
    await app.see("Comment posted", "Second line from the editor.")
    expect(app.fake.writes.map((write) => write.params.text)).toEqual(["First line.\nSecond line from the editor."])
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
    expect(legend).toMatch(/\]\s+Select the next comment/)
    expect(legend).toMatch(/\[\s+Select the previous comment/)
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

  test("Enter on someone else's comment says so, and an old one of mine names the window", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("[", "enter")
    await app.see("This is Pat Example's comment, not yours")
    await app.press("[", "enter")
    await app.see("Comments can only be edited in the 5 minutes after posting")
    expect(app.fake.writes).toEqual([])
  })

  test("Ctrl+E takes an edit to the editor and saves what comes back", async () => {
    app = await openApp(WIDE)
    app.outside.editor = (initial) => `${initial}\nSecond line from the editor.\n`
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("First line.")
    await app.press("enter")
    await app.see("Comment posted")
    await app.press("[", "enter")
    await app.see("─ Edit comment, 5:00 left ─")
    await app.press("ctrl+e")
    await app.see("Comment saved", "Second line from the editor.")
    expect(app.fake.writes.at(-1)).toMatchObject({ method: "PUT", params: { text: "First line.\nSecond line from the editor.", plainText: "true" } })
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

  test("a comment someone already deleted goes away with a neutral message", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("[", "[")
    const mine = app.fake.data.comments.findIndex((comment) => comment.authorId === ME && comment.taskId === TASK.sso)
    app.fake.data.comments.splice(mine, 1)
    await app.press("d", "y")
    await app.see("The comment was already deleted", "Comments (2)")
  })

  test("someone else's comment is not mine to delete", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("[", "d")
    await app.see("This is Pat Example's comment, not yours")
    expect(app.fake.writes).toEqual([])
  })

  test("read-only mode asks, then refuses and keeps the comment", async () => {
    app = await openApp(WIDE, { readOnly: true })
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("[", "[", "d", "y")
    await app.see("read-only mode: not saved", "Comments (3)", "Waiting on the metadata file.")
    expect(app.fake.writes).toEqual([])
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

  test("Esc closes the list and keeps the box, and a name typed by hand stays text", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    await app.press("c")
    await app.type("ping @ri")
    await app.see("▸ Riley Demo")
    await app.press("esc")
    await app.see("─ New comment ─", /^(?![\s\S]*─ Mention ─)/)
    await app.type("ley Demo")
    await app.press("enter")
    await app.see("Comment posted")
    expect(app.fake.writes.at(-1)?.params).toEqual({ text: "ping @riley Demo", plainText: "true" })
  })
})

describe("Keys and panes", () => {
  test("? shows the legend for the focused pane, straight from the keymap", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("?")
    const legend = await app.see("─ Keys ─")
    expect(legend).toMatch(/a\s+Toggle read notifications/)
    expect(legend).toMatch(/s\s+Change the status/)
    expect(legend).toMatch(/\/\s+Search, or open a link or ID/)
    expect(legend).not.toContain("Scroll down")
    await app.press("esc", "l", "?")
    const details = await app.see("─ Keys ─", "Scroll down")
    expect(details).not.toContain("Toggle read notifications")
    await app.press("q")
    expect(await app.frame()).not.toContain("─ Keys ─")
    expect(app.outside.quit).toBe(false)
  })

  test("o, y and Y act on the selected row, and q quits", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("t", "o", "y")
    await app.see("Copied the URL")
    await app.press("Y")
    await app.see("Copied the ID 4598459101")
    expect(app.outside.opened).toEqual(["https://www.wrike.com/open.htm?id=4598459101"])
    expect(app.outside.copied).toEqual(["https://www.wrike.com/open.htm?id=4598459101", "4598459101"])
    await app.press("q")
    expect(app.outside.quit).toBe(true)
  })

  test("under 100 columns the navigation pane hides until it is focused", async () => {
    app = await openApp({ width: 80, height: 24 })
    const narrow = await app.see("2 Inbox")
    expect(narrow).not.toContain("1 Wrike")
    expect(narrow).toContain("3 Details")
    await app.press("1")
    const nav = await app.see("1 Wrike")
    expect(nav).not.toContain("3 Details")
    await app.press("j", "enter")
    expect(await app.see("2 My to-do", "Overdue 1")).not.toContain("1 Wrike")
  })

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

  test("a terminal that is too small says what it needs", async () => {
    app = await openApp({ width: 50, height: 10 })
    await app.see("wrike-tui needs at least 60 columns and 12 rows")
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

  test("a rejected save keeps the task and shows the reason", async () => {
    app = await openApp(WIDE)
    await app.see("Enable SSO on sandbox")
    await app.press("enter")
    await app.see("Comments (3)")
    app.fake.fail({ method: "PUT", path: "/api/v4/tasks", status: 500 })
    await app.press("p", "down", "enter")
    const failed = await app.see("Wrike failed with 500: Injected failure")
    expect(failed).toMatch(/Importance\s+High/)
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
