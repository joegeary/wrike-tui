import { describe, expect, test } from "bun:test"
import { commentBody, editableComment, editWindowLeft, followEdit, refindMentions, type Mention } from "../../src/domain/comment"
import { userId } from "../../src/domain/ids"

const JOE = userId("KUAB6OAK")
const PAT = userId("KUAAAA02")
const names = new Map([[JOE, "Joe Geary"], [PAT, "Pat Example"]])
const nameOf = (id: ReturnType<typeof userId>) => names.get(id)
/** The anchor Wrike stores for a mention, as measured on a real account. */
const anchor = (id: string, name: string) => `<a class="stream-user-id avatar" rel="${id}">&#64;${name}</a>`

describe("the edit window", () => {
  test("is five minutes from the comment's creation", () => {
    expect(editWindowLeft("2026-11-12T16:00:00Z", "2026-11-12T16:01:48Z")).toBe(192_000)
    expect(editWindowLeft("2026-11-12T16:00:00Z", "2026-11-12T16:05:00Z")).toBe(0)
    expect(editWindowLeft("2026-11-12T16:00:00Z", "2026-11-13T16:00:00Z")).toBeLessThan(0)
  })
})

describe("commentBody", () => {
  test("a comment without mentions stays plain text, trimmed", () => {
    expect(commentBody("  Removed 4 <flags>\nfor good  ", [])).toEqual({ text: "Removed 4 <flags>\nfor good", plainText: true })
  })

  test("a comment with a mention is escaped HTML with the mention as Wrike's anchor and newlines as <br />", () => {
    const draft = "  @Joe Geary can you check <this> & that?\nThanks"
    const mentions: Mention[] = [{ at: 2, id: JOE, name: "Joe Geary" }]
    expect(commentBody(draft, mentions)).toEqual({
      text: `${anchor("KUAB6OAK", "Joe Geary")} can you check &lt;this&gt; &amp; that?<br />Thanks`,
      plainText: false,
    })
  })

  test("only picked mentions become anchors, so a typed @name stays text", () => {
    const draft = "@Pat Example and @Joe Geary"
    expect(commentBody(draft, [{ at: 17, id: JOE, name: "Joe Geary" }]).text).toBe(`@Pat Example and ${anchor("KUAB6OAK", "Joe Geary")}`)
  })
})

describe("editableComment", () => {
  test("text, line breaks and entities come back as typed, mentions as @Full Name", () => {
    const html = `${anchor("KUAB6OAK", "Joe Geary")} 4 &lt;flags&gt; &amp; more<br />next line`
    expect(editableComment(html, nameOf)).toEqual({ text: "@Joe Geary 4 <flags> & more\nnext line", mentions: [{ at: 0, id: JOE, name: "Joe Geary" }] })
  })

  test("a mention takes the person's current name, or the stored one for someone unknown", () => {
    const html = `${anchor("KUAAAA02", "Pat Old-Name")}, ${anchor("KUNKNOWN", "Gone Person")}`
    expect(editableComment(html, nameOf)).toEqual({
      text: "@Pat Example, @Gone Person",
      mentions: [
        { at: 0, id: PAT, name: "Pat Example" },
        { at: 14, id: userId("KUNKNOWN"), name: "Gone Person" },
      ],
    })
  })

  test("what the client posts reads back as the same text and mentions", () => {
    const draft = "@Joe Geary 2 < 3 & done\nok"
    const mentions: Mention[] = [{ at: 0, id: JOE, name: "Joe Geary" }]
    expect(editableComment(commentBody(draft, mentions).text, nameOf)).toEqual({ text: draft, mentions })
  })

  test("other markup is refused, so an edit never strips formatting", () => {
    expect(editableComment('See <a href="https://example.test">the PR</a>', nameOf)).toBeNull()
    expect(editableComment("<b>bold</b> claim", nameOf)).toBeNull()
    expect(editableComment('<a class="other" rel="KUAB6OAK">@Joe Geary</a>', nameOf)).toBeNull()
  })
})

describe("followEdit", () => {
  const mention: Mention = { at: 4, id: JOE, name: "Joe Geary" }
  const before = "Hey @Joe Geary see"

  test("an edit before a mention moves it, an edit after it leaves it", () => {
    expect(followEdit(before, "Oh hey @Joe Geary see", [mention])).toEqual([{ ...mention, at: 7 }])
    expect(followEdit(before, "Hey @Joe Geary see this", [mention])).toEqual([mention])
    expect(followEdit(before, "y @Joe Geary see", [mention])).toEqual([{ ...mention, at: 2 }])
  })

  test("typing right after a mention keeps it, and changing its text drops it", () => {
    expect(followEdit(before, "Hey @Joe Geary, see", [mention])).toEqual([mention])
    expect(followEdit(before, "Hey @Joe Gear see", [mention])).toEqual([])
    expect(followEdit(before, "Hey @Joe Geeary see", [mention])).toEqual([])
  })
})

describe("refindMentions", () => {
  test("finds each mention again in order after the editor, and drops one that was removed", () => {
    const mentions: Mention[] = [
      { at: 0, id: JOE, name: "Joe Geary" },
      { at: 15, id: PAT, name: "Pat Example" },
    ]
    expect(refindMentions("New first line\n@Joe Geary and @Pat Example", mentions)).toEqual([
      { at: 15, id: JOE, name: "Joe Geary" },
      { at: 30, id: PAT, name: "Pat Example" },
    ])
    expect(refindMentions("@Pat Example only", mentions)).toEqual([{ at: 0, id: PAT, name: "Pat Example" }])
  })
})
