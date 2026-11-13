import { useState } from "react"
import { firstKeyLabel, howToRun, type Keymap } from "../app/keymap"
import { contactName, sameItem } from "../app/selectors"
import type { Loadable, State } from "../app/state"
import { localDay } from "../domain/dates"
import { hasPreview, type Attachment } from "../domain/model"
import { describeError } from "../wrike/errors"
import { itemAnchor } from "./Comments"
import { fileKind, fileSize, oneLine, shortDay, truncate, upperFirst } from "./format"
import { useTheme } from "./theme"

/** A thumbnail's box. With block characters a cell is one pixel wide and two tall, so Wrike's small previews fill it. */
const PREVIEW = { width: 24, height: 8 }

/**
 * One line per file, oldest first, cut to `width` so a narrow pane never
 * wraps a row. The selected one carries a bar on its left, and an image shows
 * its thumbnail under it.
 */
export function Attachments({ state, attachments, width }: { state: State; attachments: Attachment[]; width: number }) {
  const theme = useTheme()
  return (
    <>
      {attachments.map((attachment) => {
        const selected = sameItem(state.selected, { kind: "attachment", id: attachment.id })
        const day = shortDay(localDay(new Date(attachment.createdDate)), state.clock.today)
        const about = [fileKind(attachment), attachment.size === null ? null : fileSize(attachment.size), contactName(state, attachment.authorId), day]
        const name = truncate(oneLine(attachment.name), width)
        return (
          <box
            key={attachment.id}
            id={itemAnchor({ kind: "attachment", id: attachment.id })}
            flexDirection="column"
            {...(selected ? { border: ["left"], borderStyle: "heavy", borderColor: theme.accent, backgroundColor: theme.selection } : { paddingLeft: 1 })}
          >
            <text wrapMode="none">
              <span fg={theme.text}>{name}</span>
              <span fg={selected ? theme.selectedDim : theme.dim}>{truncate(`  ${about.filter((part) => part !== null).join("  ")}`, width - Bun.stringWidth(name))}</span>
            </text>
            {selected && hasPreview(attachment) ? <Preview key={attachment.id} preview={state.previews.get(attachment.id)} open={openFile(state.keymap)} /> : null}
          </box>
        )
      })}
    </>
  )
}

function openFile(keymap: Keymap): string {
  const key = firstKeyLabel(keymap, "details.act")
  return key === null ? `${upperFirst(howToRun(keymap, "details.act"))} to open the file.` : `${key} opens the file.`
}

/** The thumbnail, drawn with the terminal's best image protocol, or a line that says why there is none. */
function Preview({ preview, open }: { preview: Loadable<Uint8Array> | undefined; open: string }) {
  const theme = useTheme()
  const [undrawable, setUndrawable] = useState(false)
  const note = (text: string) => (
    <text fg={theme.selectedDim} wrapMode="word">
      {text}
    </text>
  )
  if (preview?.state === "error") return note(`No preview: ${describeError(preview.error)}`)
  if (preview?.state !== "ready") return note("Loading the preview...")
  if (undrawable) return note(`This preview cannot be drawn here. ${open}`)
  return <image source={preview.value} protocol="auto" fit="fit" width={PREVIEW.width} height={PREVIEW.height} flexShrink={0} onError={() => setUndrawable(true)} />
}
