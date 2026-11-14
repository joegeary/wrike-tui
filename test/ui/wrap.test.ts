import { describe, expect, test } from "bun:test"
import { wrapRuns, type Run } from "../../src/ui/wrap"

const plain = (text: string): Run<string>[] => [{ text, style: "text" }]
const lines = (runs: Run<string>[], width: number) => wrapRuns(runs, width).map((line) => line.map((run) => run.text).join(""))

describe("wrapRuns", () => {
  test("breaks at spaces and drops the space it breaks at", () => {
    expect(lines(plain("Dealers keep at least 35% on every trim."), 20)).toEqual(["Dealers keep at", "least 35% on every", "trim."])
  })

  test("a closing paren and the period after it stay together", () => {
    for (let width = 8; width <= 24; width++) {
      const wrapped = lines(plain("see the sheet (https://x.test/a-b)."), width)
      expect(wrapped.filter((line) => /^[.,;:!?)\]}]+$/.test(line))).toEqual([])
      expect(wrapped.join("")).toContain(").")
    }
  })

  test("a word that fits a line of its own moves down whole", () => {
    expect(lines(plain("in the pricing sheet (https://x.test/finance/model)."), 34)).toEqual(["in the pricing sheet", "(https://x.test/finance/model)."])
  })

  test("a word wider than the line breaks after a slash or hyphen, and never before closing punctuation", () => {
    expect(lines(plain("(https://fernhill.test/finance/atlas-pricing)."), 20)).toEqual(["(https://fernhill.", "test/finance/atlas-", "pricing)."])
  })

  test("with no place to break, it cuts at the width", () => {
    expect(lines(plain("abcdefghijkl"), 5)).toEqual(["abcde", "fghij", "kl"])
  })

  test("keeps styles, line breaks and leading indentation", () => {
    const runs: Run<string>[] = [
      { text: "  Goal: ", style: "bold" },
      { text: "ship it\nthen rest", style: "text" },
    ]
    expect(wrapRuns(runs, 40)).toEqual([
      [{ text: "  Goal: ", style: "bold" }, { text: "ship it", style: "text" }],
      [{ text: "then rest", style: "text" }],
    ])
  })

  test("counts wide characters as two columns", () => {
    expect(lines(plain("日本語 テキスト"), 7)).toEqual(["日本語", "テキス", "ト"])
  })

  test("a width of zero leaves the text as it is", () => {
    expect(lines(plain("one two three"), 0)).toEqual(["one two three"])
  })
})
