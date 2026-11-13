import { isDay } from "./dates"
import type { FormFieldId, FormOptionId, FormPageId, LegacyItemId, RequestFormId } from "./ids"

/** A form as a search lists it. */
export type FormSummary = { id: RequestFormId; title: string; description: string }

export type FormOption = { id: FormOptionId; title: string }

/**
 * Something a page or a field waits for: an option picked in another field.
 * Wrike names the option by ID or by title, so either can match.
 */
export type Condition = { option: FormOptionId | null; title: string | null }

/**
 * What a field takes. A choice is a combo box, a set of check boxes or an
 * importance. A user field needs an MCP user ID the client cannot look up,
 * so it is `unsupported` along with any type this version does not know.
 */
export type FormFieldKind =
  | { type: "text"; lines: "one" | "many" }
  | { type: "choice"; options: FormOption[]; multi: boolean }
  | { type: "date" }
  | { type: "number" }
  | { type: "attachment" }
  | { type: "unsupported"; wireType: string }

export type FormField = {
  id: FormFieldId
  title: string
  mandatory: boolean
  helperText: string
  kind: FormFieldKind
  /** The field is asked only when one of these is picked. Empty asks it always. */
  visibleWhenAny: Condition[]
}

/** Where a page sits in the form's graph. An orphan is never offered. */
export type PageVisibility =
  | { kind: "entry" }
  | { kind: "orphan" }
  | { kind: "after"; pages: FormPageId[] }
  | { kind: "condition"; after: FormPageId[]; when: Condition[] }

export type FormPage = { id: FormPageId; title: string; visibility: PageVisibility; fields: FormField[] }

/** A form with its pages in Wrike's index order, orphans left out. */
export type FormDefinition = { form: FormSummary; pages: FormPage[] }

/** Answers by field: option IDs for a choice, one string for the rest. A field with no answer is absent or empty. */
export type Answers = ReadonlyMap<FormFieldId, readonly string[]>

/** What `submit_requestform` takes for one field. */
export type FormAnswer = { field: FormFieldId; values: string[] }

/**
 * What Wrike made of a submission. `processing` must never be submitted
 * again, since that can create a second request. `refused` says whether
 * sending it again is safe.
 */
export type Submission =
  | { kind: "completed"; item: LegacyItemId }
  | { kind: "processing"; submission: string }
  | { kind: "refused"; message: string; retrySafe: boolean }

/** One field to fill, on the page it belongs to. */
export type FormStep = { page: FormPage; field: FormField }

function picked(definition: FormDefinition, answers: Answers): { ids: Set<string>; titles: Set<string> } {
  const ids = new Set<string>()
  const titles = new Set<string>()
  for (const page of definition.pages) {
    for (const field of page.fields) {
      if (field.kind.type !== "choice") continue
      for (const id of answers.get(field.id) ?? []) {
        ids.add(id)
        const option = field.kind.options.find((candidate) => candidate.id === id)
        if (option) titles.add(option.title.toLowerCase())
      }
    }
  }
  return { ids, titles }
}

const holds = (conditions: Condition[], chosen: ReturnType<typeof picked>) =>
  conditions.some((condition) => (condition.option !== null && chosen.ids.has(condition.option)) || (condition.title !== null && chosen.titles.has(condition.title.toLowerCase())))

/**
 * The pages a person walks with these answers, in index order: the entry
 * page, each page that comes after a page shown, and each conditional page
 * whose condition an answer meets and whose earlier pages, if it names any,
 * are shown. Orphans never show.
 */
export function formFlow(definition: FormDefinition, answers: Answers): FormPage[] {
  const chosen = picked(definition, answers)
  const shown = new Set<FormPageId>()
  const after = (pages: FormPageId[]) => pages.some((id) => shown.has(id))
  // A page may name a later page as the one it follows, so the walk repeats until nothing more shows.
  for (let grew = true; grew; ) {
    grew = false
    for (const page of definition.pages) {
      if (shown.has(page.id)) continue
      const { visibility } = page
      const show =
        visibility.kind === "entry" ||
        (visibility.kind === "after" && after(visibility.pages)) ||
        (visibility.kind === "condition" && holds(visibility.when, chosen) && (visibility.after.length === 0 || after(visibility.after)))
      if (show) grew = shown.add(page.id).size > 0
    }
  }
  return definition.pages.filter((page) => shown.has(page.id))
}

/** Every field to fill with these answers, page by page. A field that waits for an option shows once it is picked. */
export function formSteps(definition: FormDefinition, answers: Answers): FormStep[] {
  const chosen = picked(definition, answers)
  return formFlow(definition, answers).flatMap((page) =>
    page.fields.filter((field) => field.visibleWhenAny.length === 0 || holds(field.visibleWhenAny, chosen)).map((field) => ({ page, field })),
  )
}

/** True for a field the terminal cannot fill: a file, a person, or a type this version does not know. */
export const cannotFill = (field: FormField) => field.kind.type === "attachment" || field.kind.type === "unsupported"

/** Why an answer cannot stand, or null. A field the terminal cannot fill is a problem only when it is required. */
export function answerProblem(field: FormField, values: readonly string[]): string | null {
  const [value = ""] = values
  if (cannotFill(field)) return field.mandatory ? "Only the browser can fill this. Press o to open the form there" : null
  if (values.length === 0 || value.trim() === "") return field.mandatory ? "This field is required" : null
  if (field.kind.type === "date" && !isDay(value.trim())) return "A date is YYYY-MM-DD"
  if (field.kind.type === "number" && !Number.isFinite(Number(value.trim()))) return "A number, such as 12 or 3.5"
  return null
}

/** The first field on the way that blocks submitting, as an index into the steps, or -1. */
export function firstProblem(steps: FormStep[], answers: Answers): number {
  return steps.findIndex((step) => answerProblem(step.field, answers.get(step.field.id) ?? []) !== null)
}

/** What is sent: the answered fields the person walked past. An answer on a page that no longer shows stays behind. */
export function submission(steps: FormStep[], answers: Answers): FormAnswer[] {
  return steps.flatMap(({ field }) => {
    const values = (answers.get(field.id) ?? []).map((value) => value.trim()).filter((value) => value !== "")
    return cannotFill(field) || values.length === 0 ? [] : [{ field: field.id, values }]
  })
}

/** An answer as the review lists it: choices by title. */
export function answerText(field: FormField, values: readonly string[]): string {
  if (field.kind.type !== "choice") return values.join(", ")
  const { options } = field.kind
  return values.map((id) => options.find((option) => option.id === id)?.title ?? id).join(", ")
}

/**
 * Where the form opens in Wrike's web app, for what the terminal cannot fill.
 * Not measured: this follows Wrike's `formid` link with the number of `w:rf:N`.
 */
export function formUrl(host: string, id: RequestFormId): string {
  const number = /(\d+)$/.exec(id)?.[1] ?? ""
  return `https://${host}/workspace.htm#/forms?formid=${number}`
}
