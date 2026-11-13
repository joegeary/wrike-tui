import { hasPreview, type Attachment } from "../../domain/model"
import { selectedAttachment } from "../selectors"
import type { Action, State, Update } from "../state"
import { info } from "./core"

/** Enter on an attachment: Wrike gives a signed link, and the browser opens the file. The client never stores it. */
export function openAttachment(state: State): Update {
  const attachment = selectedAttachment(state)
  if (!attachment) return [state, []]
  return [{ ...state, flash: info(`Opening ${attachment.name} in the browser`) }, [{ kind: "open-attachment", id: attachment.id, name: attachment.name }]]
}

/** Fetches the thumbnail of an image the first time it is selected, and again after a fetch that failed. */
export function withPreview(state: State, attachment: Attachment | null): Update {
  if (!attachment || !hasPreview(attachment)) return [state, []]
  const held = state.previews.get(attachment.id)
  if (held && held.state !== "error") return [state, []]
  return [{ ...state, previews: new Map(state.previews).set(attachment.id, { state: "loading" }) }, [{ kind: "load-preview", id: attachment.id }]]
}

export function previewLoaded(state: State, action: Action & { type: "preview-loaded" }): Update {
  const preview = action.result.ok ? { state: "ready" as const, value: action.result.value } : { state: "error" as const, error: action.result.error }
  return [{ ...state, previews: new Map(state.previews).set(action.id, preview) }, []]
}
