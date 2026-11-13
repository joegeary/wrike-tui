import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { ME, PAT, TASK } from "../test/fake/data"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary through the Phase 3 comment flows against the
 * fake Wrike, on the real clock: selecting comments, editing inside and
 * outside the five minutes, deleting with a confirm and after someone else
 * did, and picking a mention. The tests share one session and run in order.
 */
setDefaultTimeout(60_000)

const absent = (text: string) => new RegExp(`^(?![\\s\\S]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
/** Wrike's anchor for a mention of Pat Example. */
const PAT_MENTION = `<a class="stream-user-id avatar" rel="${PAT}">&#64;Pat Example</a>`

let e2e: E2e
let tmux: TmuxSession

beforeAll(async () => {
  e2e = await startE2e("phase-3", WIDE, { WRIKE_TOKEN: TOKEN })
  tmux = e2e.tmux
})
afterAll(() => e2e.stop())

const lastWrite = () => e2e.fake.writes.at(-1)
const myOldComment = () => e2e.fake.data.comments.find((comment) => comment.taskId === TASK.sso && comment.authorId === ME && comment.text.startsWith("Pilot"))

/** Whether the first character of `text` is drawn bold, from the SGR sequences on its line of the styled screen. */
async function isBold(text: string): Promise<boolean> {
  const line = (await tmux.styledScreen()).split("\n").find((candidate) => Bun.stripANSI(candidate).includes(text)) ?? ""
  const target = Bun.stripANSI(line).indexOf(text)
  let bold = false
  let seen = 0
  for (const [, list, char] of line.matchAll(/\x1b\[([0-9;]*)m|([\s\S])/g)) {
    if (char !== undefined) {
      if (seen === target) return bold
      seen += char.length
      continue
    }
    const params = list!.split(";").map(Number)
    for (let at = 0; at < params.length; at++) {
      const param = params[at]!
      // 38 and 48 carry a color: 5 and an index, or 2 and three channels.
      if (param === 38 || param === 48) at += params[at + 1] === 5 ? 2 : 4
      else if (param === 0) bold = false
      else if (param === 1) bold = true
      else if (param === 22) bold = false
    }
  }
  return false
}

describe("comments", () => {
  test("] and [ select a comment, and Esc clears it", async () => {
    await tmux.run(BINARY)
    await tmux.see("inbox", "2 Inbox", "Enable SSO on sandbox")
    await tmux.keys("Enter")
    await tmux.see("task-open", "Register the sandbox as a service provider", "Comments (3)")
    await tmux.keys("]")
    const first = await tmux.see("select-first", /┃Riley Demo/, /┃The identity provider team needs the entity ID by Friday\./, "Esc unselect")
    expect(first).toMatch(/ Sam Sample\s+\w{3} \d+ \d\d:\d\d/)
    await tmux.keys("Escape")
    await tmux.see("select-cleared", absent("┃"))
  })

  test("Enter on someone else's comment says so, and on my day-old one names the window", async () => {
    await tmux.keys("[", "Enter")
    await tmux.see("edit-not-mine", /┃Pat Example/, "This is Pat Example's comment, not yours")
    await tmux.keys("[", "Enter")
    await tmux.see("edit-too-late", /┃Sam Sample/, "Comments can only be edited in the 5 minutes after posting")
    expect(e2e.fake.writes).toEqual([])
    await tmux.keys("Escape")
  })

  test("@ offers people, Tab picks one, and the comment posts Wrike's mention anchor", async () => {
    await tmux.keys("c")
    await tmux.type("@pa")
    await tmux.see("mention-offered", "─ Mention ─", "▸ Pat Example  pat.example@example.test", "Tab mention")
    await tmux.keys("Tab")
    await tmux.see("mention-picked", /│@Pat Example +│/, absent("─ Mention ─"))
    await tmux.type("the sandbox is ready")
    await tmux.keys("Enter")
    await tmux.see("mention-posted", "Comment posted", "Comments (4)", "@Pat Example the sandbox is ready")
    expect(lastWrite()).toEqual({ method: "POST", path: `/tasks/${TASK.sso}/comments`, params: { text: `${PAT_MENTION} the sandbox is ready` } })
    expect(await isBold("@Pat Example the sandbox")).toBe(true)
    expect(await isBold(" the sandbox is ready")).toBe(false)
  })

  test("Enter edits my new comment inside its five minutes, mention kept", async () => {
    await tmux.keys("[")
    await tmux.see("edit-countdown", /┃Sam Sample\s+\w{3} \d+ \d\d:\d\d\s+editable for [45]:\d\d/)
    await tmux.keys("Enter")
    await tmux.see("edit-open", /─ Edit comment, [45]:\d\d left ─/, "│@Pat Example the sandbox is ready", "Enter save")
    await tmux.type(" for trainings.")
    await tmux.keys("Enter")
    await tmux.see("edit-saved", "Comment saved", "@Pat Example the sandbox is ready for trainings.")
    const posted = e2e.fake.data.comments[0]!
    expect(lastWrite()).toEqual({ method: "PUT", path: `/comments/${posted.id}`, params: { text: `${PAT_MENTION} the sandbox is ready for trainings.` } })
  })

  test("d asks, another key keeps the comment, and y deletes it", async () => {
    const posted = e2e.fake.data.comments[0]!
    await tmux.keys("d")
    await tmux.see("delete-asked", "Delete this comment? y deletes, any other key keeps it", "y delete  n keep")
    await tmux.keys("x")
    await tmux.see("delete-kept", "Kept the comment", "Comments (4)")
    await tmux.keys("d", "y")
    await tmux.see("delete-done", "Comment deleted", "Comments (3)", absent("for trainings."))
    expect(lastWrite()).toEqual({ method: "DELETE", path: `/comments/${posted.id}`, params: {} })
  })

  test("a comment deleted elsewhere goes away with a neutral message", async () => {
    await tmux.keys("]", "]")
    await tmux.see("delete-gone-selected", /┃Sam Sample/, /┃Pilot accounts are created in PR 7/)
    const gone = myOldComment()!
    e2e.fake.data.comments.splice(e2e.fake.data.comments.indexOf(gone), 1)
    await tmux.keys("d", "y")
    await tmux.see("delete-already-gone", "The comment was already deleted", "Comments (2)", absent("Pilot accounts"))
    expect(lastWrite()).toEqual({ method: "DELETE", path: `/comments/${gone.id}`, params: {} })
  })

  test("q quits", async () => {
    await tmux.keys("q")
    await tmux.run("print back-in-the-shell")
    await tmux.see("quit", /^back-in-the-shell$/m)
  })
})
