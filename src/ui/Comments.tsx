import type { SyntaxStyle } from "@opentui/core"
import { contactName, editTimeLeft, mentionName, mentionSuggestions, sameItem } from "../app/selectors"
import type { Compose, DetailsItem, State } from "../app/state"
import { showMentions } from "../domain/comment"
import { displayMarkdown } from "../domain/description"
import type { Comment } from "../domain/model"
import { countdown, fit, fitAfter, stamp } from "./format"
import { TextInput } from "./TextInput"
import { useTheme } from "./theme"

/** The renderable ID a details item is drawn under, which scrolling into view looks for. */
export const itemAnchor = (item: DetailsItem) => `${item.kind}:${item.id}`

/** The thread, oldest first. The selected comment carries a bar on its left. */
export function Comments({ state, comments, style }: { state: State; comments: Comment[]; style: SyntaxStyle }) {
  const theme = useTheme()
  const left = editTimeLeft(state)
  const deleting = state.mode.kind === "confirm-delete"
  if (comments.length === 0) return <text fg={theme.dim}>No comments yet. Press c to write one.</text>
  return (
    <>
      {comments.map((comment, index) => {
        const selected = sameItem(state.selected, { kind: "comment", id: comment.id })
        return (
          <box
            key={comment.id}
            id={itemAnchor({ kind: "comment", id: comment.id })}
            flexDirection="column"
            marginTop={index === 0 ? 0 : 1}
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
    </>
  )
}

/** The comment box at the bottom of the details pane, with the people offered for a mention above it. An edit names the time left in its window. */
export function ComposeBox({ state, mode, width, onDraft }: { state: State; mode: Compose; width: number; onDraft: (text: string) => void }) {
  const theme = useTheme()
  const left = mode.editing ? editTimeLeft(state) : null
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
      <box border borderStyle="rounded" borderColor={theme.accent} title={title} titleColor={theme.accent} height={3} flexShrink={0} flexDirection="row">
        <TextInput value={mode.draft} placeholder="Write a comment, @ mentions someone" onInput={onDraft} />
      </box>
    </>
  )
}
