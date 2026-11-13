import { expect, test } from "bun:test"
import { corpusSummary, measureCorpus } from "../support/descriptionCorpus"

// "Unchanged" means sameHtml: the saved HTML parses to the same DOM as the stored HTML, so only
// entity spelling, <br> against <br />, and attribute order and quoting may differ. Any of
// those reads back as the same document in Wrike; nothing else is allowed to differ.
const measure = measureCorpus()
console.log(corpusSummary(measure))

// Raise this when a change opens more of the corpus as markdown. It never goes down.
const MARKDOWN_FLOOR = 941

test("every description that opens as markdown saves back unchanged when the editor changes nothing", () => {
  const first = measure.lost[0]
  expect({ lost: measure.lost.length, stored: first?.html, saved: first?.saved }).toEqual({ lost: 0, stored: undefined, saved: undefined })
})

test(`at least ${MARKDOWN_FLOOR} of the corpus opens as markdown`, () => {
  expect(measure.markdown.length).toBeGreaterThanOrEqual(MARKDOWN_FLOOR)
})
