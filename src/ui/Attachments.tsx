import { useState } from "react"
import { contactName, sameItem } from "../app/selectors"
import type { Loadable, State } from "../app/state"
import { hasPreview, type Attachment } from "../domain/model"
import { describeError } from "../wrike/errors"
import { itemAnchor } from "./Comments"
import { fileKind, fileSize, stamp } from "./format"
import { useTheme } from "./theme"

/** A thumbnail's box. With block characters a cell is one pixel wide and two tall, so Wrike's small previews fill it. */
const PREVIEW = { width: 24, height: 8 }

/** One line per file, oldest first. The selected one carries a bar on its left, and an image shows its thumbnail under it. */
export function Attachments({ state, attachments }: { state: State; attachments: Attachment[] }) {
  const theme = useTheme()
  return (
    <>
      {attachments.map((attachment) => {
        const selected = sameItem(state.selected, { kind: "attachment", id: attachment.id })
        const about = [fileKind(attachment), attachment.size === null ? null : fileSize(attachment.size), contactName(state, attachment.authorId), stamp(attachment.createdDate)]
        return (
          <box
            key={attachment.id}
            id={itemAnchor({ kind: "attachment", id: attachment.id })}
            flexDirection="column"
            {...(selected ? { border: ["left"], borderStyle: "heavy", borderColor: theme.accent, backgroundColor: theme.selection } : { paddingLeft: 1 })}
          >
            <text wrapMode="word">
              <span fg={theme.text}>{attachment.name}</span>
              <span fg={selected ? theme.selectedDim : theme.dim}>{`  ${about.filter((part) => part !== null).join("  ")}`}</span>
            </text>
            {selected && hasPreview(attachment) ? <Preview key={attachment.id} preview={state.previews.get(attachment.id)} /> : null}
          </box>
        )
      })}
    </>
  )
}

/** The thumbnail, drawn with the terminal's best image protocol, or a line that says why there is none. */
function Preview({ preview }: { preview: Loadable<Uint8Array> | undefined }) {
  const theme = useTheme()
  const [undrawable, setUndrawable] = useState(false)
  const note = (text: string) => (
    <text fg={theme.selectedDim} wrapMode="word">
      {text}
    </text>
  )
  if (preview?.state === "error") return note(`No preview: ${describeError(preview.error)}`)
  if (preview?.state !== "ready") return note("Loading the preview...")
  if (undrawable) return note("This preview cannot be drawn here. Enter opens the file.")
  return <image source={preview.value} protocol="auto" fit="fit" width={PREVIEW.width} height={PREVIEW.height} flexShrink={0} onError={() => setUndrawable(true)} />
}
