import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { PAT, TASK } from "../test/fake/data"
import { BINARY, startE2e, TOKEN, WIDE, type E2e } from "./session"
import type { TmuxSession } from "./tmux"

/**
 * Drives the compiled binary through the comment flows that need a real
 * terminal, against the fake Wrike on the real clock: a picked mention drawn
 * bold through the terminal's escape codes, and Alt+Enter as the terminal
 * sends it. The tests share one session and run in order.
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
  test("@ offers people, Tab picks one, and the comment posts Wrike's mention anchor", async () => {
    await tmux.run(BINARY)
    await tmux.see("inbox", "2 Inbox", "Enable SSO on sandbox")
    await tmux.keys("Enter")
    await tmux.see("task-open", "Register the sandbox as a service provider", "Comments (3)")
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

  test("Alt+Enter starts a line, and an edit saved after one keystroke changes exactly that keystroke", async () => {
    const posted = e2e.fake.data.comments[0]!
    await tmux.keys("[", "Enter")
    await tmux.see("lines-open", /─ Edit comment, [45]:\d\d left ─/, "Alt+Enter new line")
    await tmux.keys("M-Enter")
    await tmux.type("Second line.")
    await tmux.see("lines-typed", /│@Pat Example the sandbox is ready +│+\n.*│Second line\. +│/)
    await tmux.keys("Enter")
    await tmux.see("lines-saved", "Comment saved", "Second line.")
    const twoLines = `${PAT_MENTION} the sandbox is ready<br />Second line.`
    expect(lastWrite()).toEqual({ method: "PUT", path: `/comments/${posted.id}`, params: { text: twoLines } })
    await tmux.keys("Enter")
    await tmux.see("lines-reopened", /─ Edit comment, [45]:\d\d left ─/, /│Second line\. +│/)
    await tmux.type("!")
    await tmux.keys("Enter")
    await tmux.see("lines-resaved", "Comment saved", "Second line.!")
    expect(lastWrite()).toEqual({ method: "PUT", path: `/comments/${posted.id}`, params: { text: `${twoLines}!` } })
  })
})
