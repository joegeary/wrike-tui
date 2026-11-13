import type { SyntaxStyle } from "@opentui/core"
import { useMemo } from "react"
import { howToRun, retryHint, type Keymap } from "../app/keymap"
import { commentStream, contactName, editedComment, editTimeLeft, mentionName, mentionSuggestions, sameItem, selectedComment } from "../app/selectors"
import type { Compose, DetailsItem, Paged, State } from "../app/state"
import { showMentions } from "../domain/comment"
import { displayMarkdown } from "../domain/description"
import { describeChange, type HistoryEntry } from "../domain/history"
import type { Comment } from "../domain/model"
import { describeError } from "../wrike/errors"
import { countdown, fit, fitAfter, stamp, upperFirst } from "./format"
import { TextArea } from "./TextArea"
import { useTheme } from "./theme"

/** The renderable ID a details item is drawn under, which scrolling into view looks for. */
export const itemAnchor = (item: DetailsItem) => `${item.kind}:${item.id}`

/** The section heading: the comment count, and how much history is loaded while it is shown. */
export function streamTitle(comments: number, history: Paged<HistoryEntry> | null): string {
  const title = `Comments (${comments})`
  if (!history) return title
  if (history.items.length === 0) return history.loading ? `${title} · loading history` : history.error ? title : `${title} · no changes`
  const count = history.items.length
  return `${title} · ${count}${history.next ? "+" : ""} change${count === 1 && !history.next ? "" : "s"}`
}

type Notice = { text: string; tone: "dim" | "warning" }

/** What the stream says about history it does not show. A failed load leaves the comments in place and says so in one line. */
function historyNotices(history: Paged<HistoryEntry> | null, keymap: Keymap): Notice[] {
  if (!history) return []
  if (history.error) {
    const why = history.error.kind === "rate_limited" ? "Wrike is rate limiting history." : `History did not load: ${describeError(history.error)}`
    return [{ text: `${why} ${retryHint(keymap)}`, tone: "warning" }]
  }
  if (history.loading === "more") return [{ text: "Loading older changes...", tone: "dim" }]
  if (history.next) return [{ text: `Older changes are not loaded. ${upperFirst(howToRun(keymap, "history.older"))}.`, tone: "dim" }]
  return []
}

/** The thread and the field history by time, oldest first. A change is one dim line. The selected comment carries a bar on its left. */
export function Comments({ state, comments, history, style }: { state: State; comments: Comment[]; history: Paged<HistoryEntry> | null; style: SyntaxStyle }) {
  const theme = useTheme()
  const left = editTimeLeft(state, selectedComment(state))
  const deleting = state.mode.kind === "confirm" && state.mode.target.kind === "comment"
  const changes = history?.items
  const stream = useMemo(() => commentStream(comments, changes ?? []), [comments, changes])
  const notices = historyNotices(history, state.keymap)
  const empty = <text fg={theme.dim} marginTop={stream.length + notices.length === 0 ? 0 : 1}>No comments yet. Press c to write one.</text>
  return (
    <>
      {notices.map((notice) => (
        <text key={notice.text} fg={notice.tone === "warning" ? theme.warning : theme.dim} wrapMode="word">
          {notice.text}
        </text>
      ))}
      {stream.map((item, index) => {
        const previous = index === 0 ? null : stream[index - 1]!
        const gap = previous === null ? (notices.length === 0 ? 0 : 1) : item.kind === "change" && previous.kind === "change" ? 0 : 1
        if (item.kind === "change") {
          const { entry } = item
          return (
            <box key={`change:${index}:${entry.at}`} paddingLeft={1} marginTop={gap}>
              <text fg={theme.dim} wrapMode="word">
                {[entry.author ?? "Unknown user", entry.at === null ? null : stamp(entry.at), describeChange(entry.change)].filter((part) => part !== null).join("  ")}
              </text>
            </box>
          )
        }
        const { comment } = item
        const selected = sameItem(state.selected, { kind: "comment", id: comment.id })
        return (
          <box
            key={comment.id}
            id={itemAnchor({ kind: "comment", id: comment.id })}
            flexDirection="column"
            marginTop={gap}
            {...(selected ? { border: ["left"], borderStyle: "heavy", borderColor: deleting ? theme.error : theme.accent, backgroundColor: theme.selection } : { paddingLeft: 1 })}
          >
            <box flexDirection="row" flexWrap="wrap">
              <text wrapMode="none" flexShrink={1}>
                <span fg={theme.accent}>{contactName(state, comment.authorId)}</span>
                <span fg={selected ? theme.selectedDim : theme.dim}>{`  ${stamp(comment.createdDate)}`}</span>
              </text>
              {selected && left !== null && left > 0 ? <text fg={theme.success} wrapMode="none">{`  editable for ${countdown(left)}`}</text> : null}
            </box>
            <markdown syntaxStyle={style} content={displayMarkdown(showMentions(comment.text, mentionName(state)))} />
          </box>
        )
      })}
      {comments.length === 0 ? empty : null}
    </>
  )
}

/** The comment box grows with its lines up to this many, then scrolls. */
const COMPOSE_LINES = 8

/** The comment box at the bottom of the details pane, with the people offered for a mention above it. An edit names the time left in its window. */
export function ComposeBox({ state, mode, width, onDraft }: { state: State; mode: Compose; width: number; onDraft: (text: string) => void }) {
  const theme = useTheme()
  const left = editTimeLeft(state, editedComment(state))
  const title = mode.editing === null ? " New comment " : left !== null && left > 0 ? ` Edit comment, ${countdown(left)} left ` : " Edit comment, the window has closed "
  const suggestions = mentionSuggestions(state)
  // The pane's border and the list's own.
  const inner = width - 4
  return (
    <>
      {suggestions ? (
        <box border borderStyle="rounded" borderColor={theme.border} title=" Mention " titleColor={theme.heading} height={suggestions.contacts.length + 2} flexShrink={0} flexDirection="column">
          {suggestions.contacts.map((contact, index) => {
            const picked = index === Math.min(mode.pick, suggestions.contacts.length - 1)
            const room = Math.max(0, inner - 3 - Bun.stringWidth(contact.name))
            return (
              <text key={contact.id} wrapMode="none" bg={picked ? theme.selection : undefined}>
                <span fg={theme.accent}>{picked ? " ▸ " : "   "}</span>
                <span fg={theme.text}>{contact.name}</span>
                <span fg={picked ? theme.selectedDim : theme.dim}>{contact.email ? fitAfter("  ", contact.email, room) : fit("", room)}</span>
              </text>
            )
          })}
        </box>
      ) : null}
      <box
        border
        borderStyle="rounded"
        borderColor={theme.accent}
        title={title}
        titleColor={theme.accent}
        bottomTitle=" Alt+Enter new line "
        bottomTitleAlignment="right"
        maxHeight={COMPOSE_LINES + 2}
        flexShrink={0}
        flexDirection="row"
      >
        <TextArea value={mode.draft} placeholder="Write a comment, @ mentions someone" onInput={onDraft} />
      </box>
    </>
  )
}
