import { describe, expect, test } from "bun:test"
import { commentBody, editableComment, showMentions, editWindowLeft, followEdit, MENTION_LIMIT, mentionMatches, refindMentions, typedMention, type Mention } from "../../src/domain/comment"
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

  test("every HTML character reference reads as its character, and one out of range as U+FFFD", () => {
    expect(editableComment("caf&eacute; &hellip; &mdash; &copy; &#x1F600; &#99999999;", nameOf)?.text).toBe("café \u2026 \u2014 \u00a9 \u{1F600} \uFFFD")
    expect(showMentions(anchor("KUNKNOWN", "&#99999999;"), nameOf)).toBe("<strong>@\uFFFD</strong>")
  })

  test("a newline in the HTML source is a space, as in a browser, and none at a line break", () => {
    expect(editableComment("first\nsecond", nameOf)?.text).toBe("first second")
    expect(editableComment("a<br />\nb\n<br />c", nameOf)?.text).toBe("a\nb\nc")
  })

  test("other markup is refused, so an edit never strips formatting", () => {
    expect(editableComment('See <a href="https://example.test">the PR</a>', nameOf)).toBeNull()
    expect(editableComment("<b>bold</b> claim", nameOf)).toBeNull()
    expect(editableComment('<a class="other" rel="KUAB6OAK">@Joe Geary</a>', nameOf)).toBeNull()
    expect(editableComment("a <!-- note --> b", nameOf)).toBeNull()
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
    expect(refindMentions("New first line\n@Joe Geary and @Pat Example", mentions)).toEqual({
      mentions: [
        { at: 15, id: JOE, name: "Joe Geary" },
        { at: 30, id: PAT, name: "Pat Example" },
      ],
      unsure: [],
    })
    expect(refindMentions("@Pat Example only", mentions)).toEqual({ mentions: [{ at: 0, id: PAT, name: "Pat Example" }], unsure: [] })
  })

  test("a name that runs on into a longer word is no longer the mention", () => {
    const mentions: Mention[] = [{ at: 0, id: PAT, name: "Pat Example" }]
    expect(refindMentions("@Pat Examples are here", mentions)).toEqual({ mentions: [], unsure: [] })
    expect(refindMentions("@Pat Example's notes, and @Pat Example.", mentions).mentions).toEqual([{ at: 0, id: PAT, name: "Pat Example" }])
  })

  test("a shorter name does not take a mention of a longer one", () => {
    const mentions: Mention[] = [
      { at: 0, id: JOE, name: "Pat Example" },
      { at: 15, id: PAT, name: "Pat" },
    ]
    expect(refindMentions("@Pat and @Pat Example", mentions).mentions).toEqual([
      { at: 0, id: PAT, name: "Pat" },
      { at: 9, id: JOE, name: "Pat Example" },
    ])
  })

  test("two people with one name stay mentions in order while both remain, and neither is guessed once one is gone", () => {
    const mentions: Mention[] = [
      { at: 3, id: JOE, name: "John Smith" },
      { at: 30, id: PAT, name: "John Smith" },
    ]
    expect(refindMentions("Hi @John Smith from sales, @John Smith from ops", mentions).mentions).toEqual([
      { at: 3, id: JOE, name: "John Smith" },
      { at: 27, id: PAT, name: "John Smith" },
    ])
    expect(refindMentions("@John Smith from ops", mentions)).toEqual({ mentions: [], unsure: ["John Smith"] })
  })
})

describe("typedMention", () => {
  test("is an @ at the start or after a space, then letters, at the end of the draft", () => {
    expect(typedMention("@jo")).toEqual({ at: 0, query: "jo" })
    expect(typedMention("Thanks\n@jo")).toEqual({ at: 7, query: "jo" })
    expect(typedMention("Thanks @")).toBeNull()
    expect(typedMention("Thanks @jo ")).toBeNull()
    expect(typedMention("mail joe@example")).toBeNull()
  })
})

describe("mentionMatches", () => {
  const person = (id: string, name: string, active = true) => ({ id: userId(id), name, email: null, active })
  const people = [person("1", "Mary-Jane Watson"), person("2", "Joe Geary"), person("3", "Former Joe", false), person("4", "Jo Ann Smith")]

  test("matches any word of an active person's name by prefix, in name order", () => {
    expect(mentionMatches(people, "jo").map((contact) => contact.name)).toEqual(["Jo Ann Smith", "Joe Geary"])
    expect(mentionMatches(people, "JANE").map((contact) => contact.name)).toEqual(["Mary-Jane Watson"])
    expect(mentionMatches(people, "eary")).toEqual([])
  })

  test("offers a short list", () => {
    const many = Array.from({ length: 9 }, (_, n) => person(String(n), `Alex ${n}`))
    expect(mentionMatches(many, "al")).toHaveLength(MENTION_LIMIT)
  })
})

describe("showMentions", () => {
  test("a mention reads as a bold @Full Name, with the person's name now", () => {
    const html = `${anchor("KUAAAA02", "Pat Old-Name")} and ${anchor("KUNKNOWN", "Gone &amp; Person")} see <a href="https://example.test">this</a>`
    expect(showMentions(html, nameOf)).toBe('<strong>@Pat Example</strong> and <strong>@Gone &amp; Person</strong> see <a href="https://example.test">this</a>')
  })
})
