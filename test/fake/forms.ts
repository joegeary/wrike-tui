/**
 * Request forms in the shapes of Wrike's published MCP tool schemas. Nothing
 * here was measured live: the real `get_requestform` answered with a server
 * error during the probe.
 */

export type FakeFormField = { id: string; title: string; type: string; mandatory: boolean; helperText?: string; options?: { id: string; title: string }[] }
export type FakeFormPage = {
  id: string
  title: string
  visibility: "ENTRY" | "ORPHAN" | "AFTER_PAGE" | "ON_CONDITION"
  afterPages?: string[]
  visibleWhenAny?: { field: string; option: string; fieldTitle: string; optionTitle: string }[]
  fields: FakeFormField[]
}
export type FakeForm = { id: string; title: string; description: string; pages: FakeFormPage[] }

export const FORM = {
  access: "w:rf:101",
  bug: "w:rf:102",
  design: "w:rf:103",
} as const

export const FORM_OPTION = {
  vpn: "w:rfopt:vpn",
  database: "w:rfopt:database",
  console: "w:rfopt:console",
  staging: "w:rfopt:staging",
  production: "w:rfopt:production",
  high: "w:rfopt:high",
  normal: "w:rfopt:normal",
  low: "w:rfopt:low",
} as const

/**
 * The access form has every shape the client follows: an entry page with a
 * mandatory combo box, a page shown only when "Database" is picked, a page
 * that follows the entry page, and an orphan that is never offered.
 */
export function seedForms(): FakeForm[] {
  return [
    {
      id: FORM.access,
      title: "Access request",
      description: "Ask the platform team for VPN, database or console access",
      pages: [
        {
          id: "w:rfpg:access-1",
          title: "Request",
          visibility: "ENTRY",
          fields: [
            { id: "w:rffld:summary", title: "Summary", type: "TEXT_FIELD", mandatory: true },
            {
              id: "w:rffld:kind",
              title: "Access type",
              type: "COMBO_BOX",
              mandatory: true,
              options: [
                { id: FORM_OPTION.vpn, title: "VPN" },
                { id: FORM_OPTION.database, title: "Database" },
                { id: FORM_OPTION.console, title: "Admin console" },
              ],
            },
            { id: "w:rffld:details", title: "Details", type: "TEXT_AREA", mandatory: false, helperText: "Who needs it, and why." },
          ],
        },
        {
          id: "w:rfpg:access-2",
          title: "Database",
          visibility: "ON_CONDITION",
          afterPages: ["w:rfpg:access-1"],
          visibleWhenAny: [{ field: "w:rffld:kind", option: FORM_OPTION.database, fieldTitle: "Access type", optionTitle: "Database" }],
          fields: [
            { id: "w:rffld:database", title: "Database name", type: "TEXT_FIELD", mandatory: true },
            {
              id: "w:rffld:environments",
              title: "Environments",
              type: "CHECK_BOX",
              mandatory: false,
              options: [
                { id: FORM_OPTION.staging, title: "Staging" },
                { id: FORM_OPTION.production, title: "Production" },
              ],
            },
          ],
        },
        {
          id: "w:rfpg:access-3",
          title: "Timing",
          visibility: "AFTER_PAGE",
          afterPages: ["w:rfpg:access-1"],
          fields: [
            { id: "w:rffld:needed", title: "Needed by", type: "DATE", mandatory: false },
            {
              id: "w:rffld:importance",
              title: "Importance",
              type: "IMPORTANCE",
              mandatory: false,
              options: [
                { id: FORM_OPTION.high, title: "High" },
                { id: FORM_OPTION.normal, title: "Normal" },
                { id: FORM_OPTION.low, title: "Low" },
              ],
            },
            { id: "w:rffld:screenshot", title: "Screenshot", type: "ATTACHMENT", mandatory: false },
          ],
        },
        { id: "w:rfpg:access-9", title: "Retired questions", visibility: "ORPHAN", fields: [{ id: "w:rffld:retired", title: "Cost center", type: "TEXT_FIELD", mandatory: true }] },
      ],
    },
    {
      id: FORM.bug,
      title: "Bug report",
      description: "Report a defect with a screen recording",
      pages: [
        {
          id: "w:rfpg:bug-1",
          title: "Defect",
          visibility: "ENTRY",
          fields: [
            { id: "w:rffld:bug-title", title: "What broke", type: "TEXT_FIELD", mandatory: true },
            { id: "w:rffld:recording", title: "Screen recording", type: "ATTACHMENT", mandatory: true },
            { id: "w:rffld:reviewer", title: "Reviewer", type: "USER", mandatory: false },
          ],
        },
      ],
    },
    {
      id: FORM.design,
      title: "Design request",
      description: "Mockups, icons and illustrations",
      pages: [{ id: "w:rfpg:design-1", title: "Design", visibility: "ENTRY", fields: [{ id: "w:rffld:design-need", title: "What do you need", type: "TEXT_AREA", mandatory: true }] }],
    },
  ]
}
