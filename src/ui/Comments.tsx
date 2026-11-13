import type { SyntaxStyle } from "@opentui/core"
import { contactName, sameItem } from "../app/selectors"
import type { DetailsItem, State } from "../app/state"
import { htmlToMarkdown } from "../domain/description"
import type { Comment } from "../domain/model"
import { stamp } from "./format"
import { useTheme } from "./theme"

/** The renderable ID a details item is drawn under, which scrolling into view looks for. */
export const itemAnchor = (item: DetailsItem) => `${item.kind}:${item.id}`

/** The thread, oldest first. The selected comment carries a bar on its left. */
export function Comments({ state, comments, style }: { state: State; comments: Comment[]; style: SyntaxStyle }) {
  const theme = useTheme()
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
            {...(selected ? { border: ["left"], borderStyle: "heavy", borderColor: theme.accent, backgroundColor: theme.selection } : { paddingLeft: 1 })}
          >
            <text wrapMode="none">
              <span fg={theme.accent}>{contactName(state, comment.authorId)}</span>
              <span fg={selected ? theme.selectedDim : theme.dim}>{`  ${stamp(comment.createdDate)}`}</span>
            </text>
            <markdown syntaxStyle={style} content={htmlToMarkdown(comment.text)} />
          </box>
        )
      })}
    </>
  )
}
