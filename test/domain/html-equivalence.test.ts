import { describe, expect, test } from "bun:test"
import { sameHtml } from "../../src/domain/html-equivalence"

describe("sameHtml", () => {
  test.each([
    ["entity spelling", "say &#34;hi&#34; &#39;now&#39; a&#61;b &#64;x", "say &quot;hi&quot; 'now' a=b @x"],
    ["void element spelling", "a<br />b", "a<br>b"],
    ["attribute order and quotes", '<a href="u" rel="r">x</a>', "<a rel='r' href=u>x</a>"],
  ])("ignores %s", (_name, a, b) => {
    expect(sameHtml(a, b)).toBe(true)
  })

  test.each([
    ["a different tag that renders alike", "<b>x</b>", "<strong>x</strong>"],
    ["a trailing break", "x<br /><br />", "x"],
    ["collapsible whitespace", "a  b", "a b"],
    ["a non-breaking space", "a&nbsp;", "a"],
    ["whitespace moved out of a tag", "<s>a </s>b", "<s>a</s> b"],
    ["a dropped attribute", '<a href="u" rel="r">x</a>', '<a href="u">x</a>'],
    ["an attribute value", '<span style="color: #FFFFFF;">x</span>', '<span style="color: #ffffff;">x</span>'],
    ["nesting order", "<b><i>x</i></b>", "<i><b>x</b></i>"],
    ["an empty element", '<a href="u"></a>x', "x"],
  ])("tells apart %s", (_name, a, b) => {
    expect(sameHtml(a, b)).toBe(false)
  })
})
