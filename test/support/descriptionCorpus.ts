import { descriptionFromEdit, editableDescription, type EditableDescription } from "../../src/domain/description"
import { sameHtml } from "../../src/domain/html-equivalence"
import corpus from "../fixtures/descriptions.json"

/** What keeps a description in raw HTML, matched on the stored HTML. The first match names it. */
const FEATURES: [name: string, pattern: RegExp][] = [
  ["checklist", /class="checklist"/],
  ["table", /<table\b/],
  ["list style", /<(?:ul|ol|li)\b[^>]*\b(?:style|class)=/],
  ["color", /style="[^"]*\bcolor:/],
  ["image", /<img\b/],
  ["underline", /<u>/],
  ["indent", /<p\b[^>]*style=/],
]

export type CorpusEntry = { html: string; editable: EditableDescription; saved: string | null }

export type CorpusMeasure = {
  total: number
  markdown: CorpusEntry[]
  /** Opened as markdown, but saving the unchanged markdown writes different HTML. */
  lost: CorpusEntry[]
  /** Descriptions left in raw HTML, counted by the first feature that names them, or "other". */
  fallback: Record<string, number>
}

export function measureCorpus(): CorpusMeasure {
  const entries = (corpus as string[]).map((html): CorpusEntry => {
    const editable = editableDescription(html)
    return { html, editable, saved: editable.format === "markdown" ? descriptionFromEdit(editable) : null }
  })
  const markdown = entries.filter((entry) => entry.editable.format === "markdown")
  const fallback: Record<string, number> = {}
  for (const entry of entries) {
    if (entry.editable.format === "markdown") continue
    const name = FEATURES.find(([, pattern]) => pattern.test(entry.html))?.[0] ?? "other"
    fallback[name] = (fallback[name] ?? 0) + 1
  }
  return {
    total: entries.length,
    markdown,
    lost: markdown.filter((entry) => !sameHtml(entry.saved!, entry.html)),
    fallback,
  }
}

export function corpusSummary(measure: CorpusMeasure): string {
  const fallback = Object.entries(measure.fallback)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `${name} ${count}`)
    .join(", ")
  return [
    `${measure.markdown.length} of ${measure.total} descriptions open as markdown`,
    `${measure.lost.length} of those save back different HTML`,
    `raw HTML: ${fallback || "none"}`,
  ].join("\n")
}
