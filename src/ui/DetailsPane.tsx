import { parseColor, SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { contactName, editRows, openHistory, statusOf, taskFields, type ShownField } from "../app/selectors"
import type { CustomFieldId } from "../domain/ids"
import type { Details, EditField, State } from "../app/state"
import { isDay } from "../domain/dates"
import { displayMarkdown } from "../domain/description"
import { fieldText, inputPlaceholder } from "../domain/fields"
import { dueDay, startDay } from "../domain/model"
import { retryText } from "../wrike/errors"
import type { UiBridge } from "./bridge"
import { Attachments } from "./Attachments"
import { Comments, ComposeBox, itemAnchor, streamTitle } from "./Comments"
import { shortDay, truncate } from "./format"
import { Pane } from "./Pane"
import { scrollBox } from "./scroll"
import { statusColor, useTheme, type Theme } from "./theme"
import { TextInput } from "./TextInput"

const LABEL_WIDTH = 13
/** Custom field titles run longer than the built-in labels, so their column grows to fit them, up to this. */
const MAX_FIELD_LABEL = 24

function useMarkdownStyle(theme: Theme): SyntaxStyle {
  const renderer = useRenderer()
  const style = useMemo(() => {
    const color = parseColor
    return SyntaxStyle.fromStyles(
      {
        default: { fg: color(theme.text) },
        "markup.heading": { fg: color(theme.heading), bold: true },
        "markup.strong": { fg: color(theme.text), bold: true },
        "markup.italic": { fg: color(theme.text), italic: true },
        "markup.strikethrough": { fg: color(theme.dim) },
        "markup.link": { fg: color(theme.link) },
        "markup.link.label": { fg: color(theme.link), underline: true },
        "markup.link.url": { fg: color(theme.dim) },
        "markup.raw": { fg: color(theme.warning) },
        "markup.list": { fg: color(theme.accent) },
        "markup.quote": { fg: color(theme.dim), italic: true },
      },
      renderer.nativeScene!,
    )
  }, [renderer, theme])
  useEffect(() => () => style.destroy(), [style])
  return style
}

/** `active` is undefined outside edit mode, where no row carries a cursor column. */
function Field(props: { label: string; active?: boolean; labelWidth?: number; anchor?: string; children: ReactNode }) {
  const theme = useTheme()
  const cursor = props.active === undefined ? "" : props.active ? "▸ " : "  "
  const width = props.labelWidth ?? LABEL_WIDTH
  return (
    <box flexDirection="row" {...(props.anchor ? { id: props.anchor } : {})}>
      <text fg={props.active ? theme.accent : theme.dim} width={width + cursor.length} wrapMode="none">
        {`${cursor}${truncate(props.label, width - 1)}`}
      </text>
      <box flexGrow={1} flexShrink={1} flexDirection="row">
        {props.children}
      </box>
    </box>
  )
}

function Value(props: { children: string; fg?: Theme["text"] }) {
  const theme = useTheme()
  return (
    <text fg={props.fg ?? theme.text} wrapMode="word" flexShrink={1}>
      {props.children}
    </text>
  )
}

function Section({ title }: { title: string }) {
  const theme = useTheme()
  return (
    <text fg={theme.heading} marginTop={1} wrapMode="none">
      {title}
    </text>
  )
}

/** The ID of a custom field's row, which the edit walk scrolls into view. */
const fieldAnchor = (id: CustomFieldId) => `field:${id}`

/** A field's value as text, and a date with the same short day the due date shows. */
function fieldValue(shown: ShownField, today: string): string {
  const text = fieldText(shown.field?.kind, shown.value)
  const day = shown.value.slice(0, 10)
  return shown.field?.kind.type === "Date" && isDay(day) ? `${text}  ${shortDay(day, today)}` : text
}

/**
 * The task's custom fields under their titles. A task with none draws no
 * section. The field being typed into draws its input in place, and one the
 * task does not have yet draws in its place by title while it is typed.
 */
function Fields(props: { state: State; task: Details["task"]; active: (id: CustomFieldId) => boolean | undefined; onDraft: (text: string) => void }) {
  const theme = useTheme()
  const { mode } = props.state
  const typing = mode.kind === "edit-text" && mode.field === "custom" && mode.edit.taskIds.includes(props.task.id) ? mode : null
  const fields = taskFields(props.state, props.task, typing?.edit.id ?? null)
  if (fields.length === 0) return null
  const longest = Math.max(...fields.map((shown) => Bun.stringWidth(shown.field?.title ?? shown.id)))
  const labelWidth = Math.min(MAX_FIELD_LABEL, Math.max(LABEL_WIDTH, longest + 2))
  return (
    <>
      <Section title="Fields" />
      {fields.map((shown) => (
        <Field key={shown.id} anchor={fieldAnchor(shown.id)} label={shown.field?.title ?? shown.id} labelWidth={labelWidth} active={props.active(shown.id)}>
          {typing?.edit.id === shown.id ? (
            <TextInput value={typing.draft} placeholder={shown.field ? inputPlaceholder(shown.field.kind) : ""} onInput={props.onDraft} />
          ) : (
            <Value fg={shown.field ? theme.text : theme.dim}>{fieldValue(shown, props.state.clock.today)}</Value>
          )}
        </Field>
      ))}
    </>
  )
}

/** The columns left for a row of the scrollbox: the pane's borders, the scrollbox's padding and a row's bar or indent. */
const ROW_CHROME = 5

function Body({ state, details, width, onDraft }: { state: State; details: Details; width: number; onDraft: (text: string) => void }) {
  const theme = useTheme()
  const style = useMarkdownStyle(theme)
  const { task, attachments, attachmentsError, comments, folders } = details
  const { mode } = state
  // The cursor column shows only inside an edit session, so a picker opened from browse does not shift the fields.
  const editing = mode.kind === "edit" || ((mode.kind === "edit-text" || mode.kind === "picker") && mode.origin === "edit")
  const row = mode.kind === "edit" ? editRows(state)[mode.field] : undefined
  const active = (field: EditField) => (editing ? row?.kind === "core" && row.field === field : undefined)
  const activeField = (id: CustomFieldId) => (editing ? row?.kind === "custom" && row.id === id : undefined)
  const typing = (field: EditField) => (mode.kind === "edit-text" && mode.field === field ? mode : null)
  const status = statusOf(state, task)
  const [start, due] = [startDay(task.dates), dueDay(task.dates)]
  const overdue = due !== null && due < state.clock.today && task.statusGroup === "Active"
  const markdown = useMemo(() => displayMarkdown(task.descriptionHtml), [task.descriptionHtml])
  const cursor = (field: EditField) => (editing ? (active(field) ? "▸ " : "  ") : "")

  const day = (field: "start" | "due", value: string | null) => {
    const draft = typing(field)
    if (draft) return <TextInput value={draft.draft} placeholder="YYYY-MM-DD" onInput={onDraft} />
    if (value === null) return <Value fg={theme.dim}>none</Value>
    const late = field === "due" && overdue
    return <Value fg={late ? theme.error : theme.text}>{`${value}  ${shortDay(value, state.clock.today)}${late ? ", overdue" : ""}`}</Value>
  }

  return (
    <>
      {typing("title") ? (
        <box flexDirection="row">
          <text fg={theme.accent}>{cursor("title")}</text>
          <TextInput value={typing("title")!.draft} onInput={onDraft} />
        </box>
      ) : (
        <text fg={active("title") ? theme.accent : theme.text} attributes={1} wrapMode="word">
          {`${cursor("title")}${task.title}`}
        </text>
      )}
      <box height={1} />
      <Field label="Status" active={active("status")}>
        <text wrapMode="none" flexShrink={1}>
          <span fg={statusColor(theme, status?.color)}>● </span>
          <span fg={theme.text}>{status?.name ?? task.statusGroup}</span>
        </text>
      </Field>
      <Field label="Importance" active={active("importance")}>
        <Value fg={task.importance === "High" ? theme.error : theme.text}>{task.importance}</Value>
      </Field>
      <Field label="Assignees" active={active("assignees")}>
        {task.assigneeIds.length === 0 ? (
          <Value fg={theme.dim}>nobody</Value>
        ) : (
          <Value>{task.assigneeIds.map((id) => contactName(state, id)).join(", ")}</Value>
        )}
      </Field>
      <Field label="Start" active={active("start")}>
        {day("start", start)}
      </Field>
      <Field label="Due" active={active("due")}>
        {day("due", due)}
      </Field>
      {editing ? (
        <Field label="Description" active={active("description")}>
          <Value fg={theme.dim}>Enter opens it in $EDITOR</Value>
        </Field>
      ) : null}
      <Field label="Folders" active={editing ? false : undefined}>
        {folders.length === 0 ? <Value fg={theme.dim}>none</Value> : <Value>{folders.join(", ")}</Value>}
      </Field>
      <Field label="Permalink" active={editing ? false : undefined}>
        <text fg={theme.link} wrapMode="char" flexShrink={1}>{task.permalink}</text>
      </Field>
      <Fields state={state} task={task} active={activeField} onDraft={onDraft} />

      <Section title="Description" />
      {markdown === "" ? <text fg={theme.dim}>No description.</text> : <markdown syntaxStyle={style} content={markdown} />}

      {attachmentsError ? (
        <>
          <Section title="Attachments" />
          <text fg={theme.warning} wrapMode="word">{`Did not load: ${retryText(attachmentsError)}`}</text>
        </>
      ) : null}
      {attachments.length > 0 ? (
        <>
          <Section title={`Attachments (${attachments.length})`} />
          <Attachments state={state} attachments={attachments} width={width - ROW_CHROME} />
        </>
      ) : null}

      <Section title={streamTitle(comments.length, openHistory(state))} />
      <Comments state={state} comments={comments} history={openHistory(state)} style={style} />
    </>
  )
}

export function DetailsPane(props: { state: State; width: number; bridge: UiBridge; onDraft: (text: string) => void }) {
  const { state, bridge } = props
  const theme = useTheme()
  const scroll = useRef<ScrollBoxRenderable>(null)
  const details = state.details

  useEffect(() => {
    bridge.scrollers.details = (to) => scrollBox(scroll.current, to)
    return () => void delete bridge.scrollers.details
  }, [bridge])

  useEffect(() => scroll.current?.scrollTo(0), [state.openTaskId])

  const selected = state.selected
  // A thumbnail arrives after the selection and makes the item taller, so the item is brought into view again then.
  const preview = selected?.kind === "attachment" ? state.previews.get(selected.id)?.state : undefined
  useEffect(() => {
    if (selected) scroll.current?.scrollChildIntoView(itemAnchor(selected))
  }, [selected, preview])

  // The walk can step into custom fields below the pane's fold, so the row it is on is kept in view.
  const walked = state.mode.kind === "edit" ? editRows(state)[state.mode.field] : undefined
  const walkedField = walked?.kind === "custom" ? walked.id : null
  useEffect(() => {
    if (walkedField) scroll.current?.scrollChildIntoView(fieldAnchor(walkedField))
  }, [walkedField])

  const shownDetails = details.state === "ready" ? details.value : details.state === "loading" ? details.previous : undefined
  const title = details.state === "loading" && shownDetails ? "Details (refreshing)" : "Details"

  return (
    <Pane number={3} title={title} width={props.width} focused={state.focus === "details" && state.mode.kind === "browse"}>
      {details.state === "idle" ? <text fg={theme.dim} wrapMode="word">Select a task and press Enter to open it here.</text> : null}
      {details.state === "loading" && !shownDetails ? <text fg={theme.dim}>Loading...</text> : null}
      {details.state === "error" ? (
        <text fg={theme.error} wrapMode="word">{retryText(details.error)}</text>
      ) : null}
      {shownDetails ? (
        <scrollbox ref={scroll} flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={1} scrollY>
          <Body state={state} details={shownDetails} width={props.width} onDraft={props.onDraft} />
        </scrollbox>
      ) : null}
      {state.mode.kind === "compose" ? <ComposeBox state={state} mode={state.mode} width={props.width} onDraft={props.onDraft} /> : null}
    </Pane>
  )
}
