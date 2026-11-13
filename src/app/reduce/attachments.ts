import type { AttachmentId } from "../../domain/ids"
import { hasPreview, type Attachment } from "../../domain/model"
import { selectedAttachment } from "../selectors"
import type { Action, Loadable, State, Update } from "../state"
import { info } from "./core"

/** Enter on an attachment: Wrike gives a signed link, and the browser opens the file. The client never stores it. */
export function openAttachment(state: State): Update {
  const attachment = selectedAttachment(state)
  if (!attachment) return [state, []]
  return [{ ...state, flash: info(`Opening ${attachment.name} in the browser`) }, [{ kind: "open-attachment", id: attachment.id, name: attachment.name }]]
}

/** Thumbnails kept in memory. Selecting one moves it to the end, and the first ones drop off past this. */
const PREVIEWS_KEPT = 20

/** `previews` with `id` set as the most recently selected, the least recent dropped past the limit. */
function remember(previews: State["previews"], id: AttachmentId, preview: Loadable<Uint8Array>): State["previews"] {
  const next = new Map(previews)
  next.delete(id)
  next.set(id, preview)
  for (const oldest of next.keys()) {
    if (next.size <= PREVIEWS_KEPT) break
    next.delete(oldest)
  }
  return next
}

/** Fetches the thumbnail of an image the first time it is selected. One kept is moved to the end, and a failed one waits for r. */
export function withPreview(state: State, attachment: Attachment | null): Update {
  if (!attachment || !hasPreview(attachment)) return [state, []]
  const held = state.previews.get(attachment.id)
  if (held) return [[...state.previews.keys()].at(-1) === attachment.id ? state : { ...state, previews: remember(state.previews, attachment.id, held) }, []]
  return [{ ...state, previews: remember(state.previews, attachment.id, { state: "loading" }) }, [{ kind: "load-preview", id: attachment.id }]]
}

export function previewLoaded(state: State, action: Action & { type: "preview-loaded" }): Update {
  // A thumbnail dropped while it loaded is not put back.
  if (!state.previews.has(action.id)) return [state, []]
  const preview = action.result.ok ? { state: "ready" as const, value: action.result.value } : { state: "error" as const, error: action.result.error }
  return [{ ...state, previews: new Map(state.previews).set(action.id, preview) }, []]
}

/** r forgets the thumbnails that failed, so they are fetched again. */
export const retryPreviews = (previews: State["previews"]): State["previews"] => new Map([...previews].filter(([, preview]) => preview.state !== "error"))
