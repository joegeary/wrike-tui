import { RGBA, SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { contactName, statusOf } from "../app/selectors"
import { EDIT_FIELDS, type Details, type EditField, type State } from "../app/state"
import { htmlToMarkdown } from "../domain/description"
import { dueDay, startDay } from "../domain/model"
import { retryText } from "../wrike/errors"
import type { UiBridge } from "./bridge"
import { shortDay, stamp } from "./format"
import { Pane } from "./Pane"
import { statusColor, theme } from "./theme"
import { TextInput } from "./TextInput"

const LABEL_WIDTH = 12
const SCROLL_STEP = 3

function useMarkdownStyle(): SyntaxStyle {
  const renderer = useRenderer()
  const style = useMemo(() => {
    const color = (hex: string) => RGBA.fromHex(hex)
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
  }, [renderer])
  useEffect(() => () => style.destroy(), [style])
  return style
}

/** `active` is undefined outside edit mode, where no row carries a cursor column. */
function Field(props: { label: string; active?: boolean; children: ReactNode }) {
  const cursor = props.active === undefined ? "" : props.active ? "▸ " : "  "
  return (
    <box flexDirection="row">
      <text fg={props.active ? theme.accent : theme.dim} width={LABEL_WIDTH + cursor.length} wrapMode="none">
        {`${cursor}${props.label}`}
      </text>
      <box flexGrow={1} flexShrink={1} flexDirection="row">
        {props.children}
      </box>
    </box>
  )
}

const Value = (props: { children: string; fg?: string }) => (
  <text fg={props.fg ?? theme.text} wrapMode="word" flexShrink={1}>
    {props.children}
  </text>
)

function Section({ title }: { title: string }) {
  return (
    <text fg={theme.heading} marginTop={1} wrapMode="none">
      {title}
    </text>
  )
}

function Body({ state, details, onDraft }: { state: State; details: Details; onDraft: (text: string) => void }) {
  const style = useMarkdownStyle()
  const { task, comments, folders } = details
  const { mode } = state
  // The cursor column shows only inside an edit session, so a picker opened from browse does not shift the fields.
  const editing = mode.kind === "edit" || ((mode.kind === "edit-text" || mode.kind === "picker") && mode.origin === "edit")
  const active = (field: EditField) => (editing ? mode.kind === "edit" && EDIT_FIELDS[mode.field] === field : undefined)
  const typing = (field: EditField) => (mode.kind === "edit-text" && mode.field === field ? mode : null)
  const status = statusOf(state, task)
  const [start, due] = [startDay(task.dates), dueDay(task.dates)]
  const overdue = due !== null && due < state.clock.today && task.statusGroup === "Active"
  const markdown = useMemo(() => htmlToMarkdown(task.descriptionHtml), [task.descriptionHtml])
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
          <span fg={statusColor(status?.color)}>● </span>
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

      <Section title="Description" />
      {markdown === "" ? <text fg={theme.dim}>No description.</text> : <markdown syntaxStyle={style} content={markdown} />}

      <Section title={`Comments (${comments.length})`} />
      {comments.length === 0 ? <text fg={theme.dim}>No comments yet. Press c to write one.</text> : null}
      {comments.map((comment, index) => (
        <box key={comment.id} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
          <text wrapMode="none">
            <span fg={theme.accent}>{contactName(state, comment.authorId)}</span>
            <span fg={theme.dim}>{`  ${stamp(comment.createdDate)}`}</span>
          </text>
          <markdown syntaxStyle={style} content={htmlToMarkdown(comment.text)} />
        </box>
      ))}
    </>
  )
}

export function DetailsPane(props: { state: State; width: number; bridge: UiBridge; onDraft: (text: string) => void }) {
  const { state, bridge } = props
  const scroll = useRef<ScrollBoxRenderable>(null)
  const details = state.details

  useEffect(() => {
    bridge.scrollDetails = (to) => {
      const box = scroll.current
      if (!box) return
      if (to === "top") box.scrollTo(0)
      else if (to === "bottom") box.scrollTo(box.scrollHeight)
      else box.scrollBy(to === "down" ? SCROLL_STEP : -SCROLL_STEP)
    }
    return () => {
      bridge.scrollDetails = () => {}
    }
  }, [bridge])

  useEffect(() => scroll.current?.scrollTo(0), [state.openTaskId])

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
          <Body state={state} details={shownDetails} onDraft={props.onDraft} />
        </scrollbox>
      ) : null}
      {state.mode.kind === "compose" ? (
        <box border borderStyle="rounded" borderColor={theme.accent} title=" New comment " titleColor={theme.accent} height={3} flexShrink={0} flexDirection="row">
          <TextInput value={state.mode.draft} placeholder="Write a comment" onInput={props.onDraft} />
        </box>
      ) : null}
    </Pane>
  )
}
