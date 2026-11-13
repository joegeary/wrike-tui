import { describe, expect, test } from "bun:test"
import { descriptionFromEdit, editableDescription, htmlToMarkdown, markdownToHtml } from "../../src/domain/description"

describe("htmlToMarkdown", () => {
  test("renders Wrike's tags", () => {
    const html = "<h2>Plan</h2>First line<br>second line<br><br>Next <b>bold</b> and <i>soft</i> and <s>gone</s><ul><li>one</li><li>two</li></ul><a href=\"https://example.test\">link</a>"
    expect(htmlToMarkdown(html)).toBe(
      ["## Plan", "", "First line  ", "second line", "", "Next **bold** and *soft* and ~~gone~~", "- one", "- two", "", "[link](https://example.test)"].join("\n"),
    )
  })
  test("numbers ordered lists and indents nested ones", () => {
    expect(htmlToMarkdown("<ol><li>first<ul><li>inner</li></ul></li><li>second</li></ol>")).toBe(["1. first", "   - inner", "2. second"].join("\n"))
  })
  test("renders a table as a markdown table", () => {
    expect(htmlToMarkdown("<table><tr><td>Env</td><td>State</td></tr><tr><td>sandbox</td><td>up</td></tr></table>")).toBe(
      ["| Env | State |", "| --- | --- |", "| sandbox | up |"].join("\n"),
    )
  })
  test("an empty description is empty", () => {
    expect(htmlToMarkdown("")).toBe("")
  })
})

describe("markdownToHtml", () => {
  test("writes Wrike's tag set with <br> between paragraphs and no <p>", () => {
    const markdown = ["## Plan", "", "First **bold** and ~~gone~~", "", "Second", "- one", "- two", "", "[link](https://example.test)"].join("\n")
    expect(markdownToHtml(markdown)).toBe(
      '<h2>Plan</h2>First <b>bold</b> and <s>gone</s><br /><br />Second<ul><li>one</li><li>two</li></ul><a href="https://example.test">link</a>',
    )
  })
  test("an empty document clears the description", () => {
    expect(markdownToHtml("  \n")).toBe("")
  })
})

describe("a description round trip through the editor", () => {
  const roundTrip = (html: string) => descriptionFromEdit(editableDescription(html))

  test("keeps angle-bracketed text as text", () => {
    const html = "Headers: Authorization: Bearer &lt;token&gt;<br />Run &lt;script&gt;alert(1)&lt;/script&gt; literally"
    expect(roundTrip(html)).toBe(html)
  })
  test("keeps an address in angle brackets unlinked", () => {
    expect(roundTrip("Mail comes from Analytics &lt;noreply@example.test&gt; today")).toBe(
      "Mail comes from Analytics &lt;noreply@example.test&gt; today",
    )
  })
  test("leaves a bare URL as plain text", () => {
    expect(roundTrip("See https://www.wrike.com/open.htm?id=1 for details")).toBe(
      "See https://www.wrike.com/open.htm?id=1 for details",
    )
  })
  test("keeps the blank lines Wrike leaves at the end", () => {
    const html = "Done<br /><br />"
    expect(editableDescription(html)).toMatchObject({ format: "markdown", text: "Done" })
    expect(roundTrip(html)).toBe(html)
    expect(descriptionFromEdit({ ...editableDescription(html), text: "Done today" })).toBe("Done today<br /><br />")
  })
  test("keeps an explicit link", () => {
    expect(roundTrip('Fixed in <a href="https://example.test/pull/1">PR 1</a>')).toBe(
      'Fixed in <a href="https://example.test/pull/1">PR 1</a>',
    )
  })
})

describe("line breaks", () => {
  // Each blank line in the editor is a blank line in Wrike. A <br> right before a block draws nothing, so it is two spaces.
  test.each([
    ["one break inside a paragraph", "a<br />b", "a  \nb"],
    ["a blank line between paragraphs", "a<br /><br />b", "a\n\nb"],
    ["two blank lines between paragraphs", "a<br /><br /><br />b", "a\n\n\nb"],
    ["a list right under text", "a<ul><li>x</li></ul>", "a\n- x"],
    ["a list after a break", "a<br /><ul><li>x</li></ul>", "a  \n- x"],
    ["a blank line before a list", "a<br /><br /><ul><li>x</li></ul>", "a\n\n- x"],
    ["text right under a list", "<ul><li>x</li></ul>a", "- x\n\na"],
    ["a blank line after a list", "<ul><li>x</li></ul><br />a", "- x\n\n\na"],
    ["text right under a heading", "<h5>H</h5>a", "##### H\n\na"],
    ["a list inside a list item", "<ul><li>x<br /><ul><li>y</li></ul></li></ul>", "- x  \n  - y"],
    ["spaces at the ends of a line", "a <br /> b", "a&#32;  \n&#32;b"],
    ["a space inside bold", "<b>a </b> b", "**a&#32;** b"],
  ])("%s", (_name, html, markdown) => {
    expect(htmlToMarkdown(html)).toBe(markdown)
    expect(markdownToHtml(markdown)).toBe(html)
  })
})

describe("editableDescription", () => {
  test("simple HTML opens as markdown and converts back", () => {
    const editable = editableDescription("Line one<br><br>Line <b>two</b>")
    expect(editable).toMatchObject({ format: "markdown", text: "Line one\n\nLine **two**" })
    expect(descriptionFromEdit({ ...editable, text: "Line one\n\nLine **2**\n" })).toBe("Line one<br /><br />Line <b>2</b>")
  })
  test.each([
    ["underline", "plain <u>under</u>"],
    ["highlight", 'a <span style="color:#ff0000">red</span> word'],
    ["image", '<img src="https://example.test/a.png">'],
    ["table", "<table><tr><td>a</td></tr></table>"],
    ["mention anchor", '<a class="stream-user-id" rel="KUAAAA01">@Sam</a>'],
  ])("%s opens as raw HTML and saves untouched", (_name, html) => {
    expect(editableDescription(html)).toEqual({ format: "html", text: html })
    expect(descriptionFromEdit({ format: "html", text: `${html}\n` })).toBe(html)
  })
})

describe("code in a description", () => {
  const roundTrip = (html: string) => descriptionFromEdit(editableDescription(html))

  test("inline code opens as markdown and comes back as <code>", () => {
    const html = "Points at <code>grade_indicators &lt;v2&gt;</code> now"
    expect(editableDescription(html)).toMatchObject({ format: "markdown", text: "Points at `grade_indicators <v2>` now" })
    expect(roundTrip(html)).toBe(html)
  })
  test("a <pre> block opens as a fence and keeps its lines", () => {
    const html = "<h3>Rollback</h3><pre>CREATE INDEX a ON t (x);\n\n-- then\nDROP INDEX b;</pre>Done"
    expect(editableDescription(html).text).toBe("### Rollback\n\n```\nCREATE INDEX a ON t (x);\n\n-- then\nDROP INDEX b;\n```\n\nDone")
    expect(roundTrip(html)).toBe(html)
  })
  test("markup inside code keeps the description in HTML", () => {
    expect(editableDescription("<pre>a <b>b</b></pre>").format).toBe("html")
  })
})

describe("checklists", () => {
  const roundTrip = (html: string) => descriptionFromEdit(editableDescription(html))
  const CHECKLIST = '<ul class="checklist" style="list-style-type: none;">'
  const item = (text: string, checked = false) => `<li><label><input type="checkbox"${checked ? ' checked="checked"' : ""} />${text}</label></li>`

  test("open as a task list and save back as Wrike's checklist", () => {
    const html = `Before launch${CHECKLIST}${item("Book the room")}${item("<b>Send</b> the invite", true)}</ul>`
    expect(editableDescription(html)).toMatchObject({ format: "markdown", text: "Before launch\n- [ ] Book the room\n- [x] **Send** the invite" })
    expect(roundTrip(html)).toBe(html)
  })
  test("keep nested items under their parent", () => {
    const html = `${CHECKLIST}<li><label><input type="checkbox" />Venue</label>${CHECKLIST}${item("Deposit", true)}</ul></li></ul>`
    expect(editableDescription(html).text).toBe("- [ ] Venue\n  - [x] Deposit")
    expect(roundTrip(html)).toBe(html)
  })
  test("a task list typed in the editor becomes a checklist", () => {
    expect(markdownToHtml("- [ ] one\n- [X] two")).toBe(`${CHECKLIST}${item("one")}${item("two", true)}</ul>`)
  })
  test("two lists in a row stay two lists", () => {
    const html = `${CHECKLIST}${item("a")}</ul><br />${CHECKLIST}${item("b")}</ul>`
    expect(editableDescription(html).text).toBe("- [ ] a\n\n\n* [ ] b")
    expect(roundTrip(html)).toBe(html)
  })
})
