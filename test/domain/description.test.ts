import { describe, expect, test } from "bun:test"
import { descriptionFromEdit, editableDescription, htmlToMarkdown, htmlToText, markdownToHtml } from "../../src/domain/description"

describe("htmlToMarkdown", () => {
  test("renders Wrike's tags", () => {
    const html = "<h2>Plan</h2>First line<br>second line<br><br>Next <b>bold</b> and <i>soft</i> and <s>gone</s><ul><li>one</li><li>two</li></ul><a href=\"https://example.test\">link</a>"
    expect(htmlToMarkdown(html)).toBe(
      ["## Plan", "", "First line  ", "second line", "", "Next **bold** and *soft* and ~~gone~~", "", "- one", "- two", "", "[link](https://example.test)"].join("\n"),
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

describe("htmlToText", () => {
  test("keeps mentions and underscores as typed", () => {
    expect(htmlToText('<a class="stream-user-id avatar" rel="KUAAAA01">@Sam Sample</a> see snake_case<br>next')).toBe(
      "@Sam Sample see snake_case  \nnext",
    )
  })
})

describe("markdownToHtml", () => {
  test("writes Wrike's tag set with <br> between paragraphs and no <p>", () => {
    const markdown = ["## Plan", "", "First **bold** and ~~gone~~", "", "Second", "", "- one", "- two", "", "[link](https://example.test)"].join("\n")
    expect(markdownToHtml(markdown)).toBe(
      '<h2>Plan</h2>First <strong>bold</strong> and <s>gone</s><br /><br />Second<ul><li>one</li><li>two</li></ul><a href="https://example.test">link</a>',
    )
  })
  test("an empty document clears the description", () => {
    expect(markdownToHtml("  \n")).toBe("")
  })
})

describe("editableDescription", () => {
  test("simple HTML opens as markdown and converts back", () => {
    const editable = editableDescription("Line one<br><br>Line <b>two</b>")
    expect(editable).toEqual({ format: "markdown", text: "Line one\n\nLine **two**" })
    expect(descriptionFromEdit({ format: "markdown", text: "Line one\n\nLine **2**\n" })).toBe("Line one<br /><br />Line <strong>2</strong>")
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
