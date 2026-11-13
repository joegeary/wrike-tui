import { COMMENT_LIMIT, commentBody, editableComment, editWindowLeft, followEdit, refindMentions, typedMention, type Mention } from "../../domain/comment"
import type { CommentId, TaskId } from "../../domain/ids"
import type { Comment } from "../../domain/model"
import { describeError } from "../../wrike/errors"
import { contactName, detailsItems, mentionName, mentionSuggestions, openTask, sameItem, selectedComment } from "../selectors"
import type { Action, Compose, State, Update } from "../state"
import { clamp, failure, info } from "./core"

const EMPTY = "Write the comment first, or press Esc to discard"
const tooLong = (length: number) =>
  `Wrike takes up to ${COMMENT_LIMIT.toLocaleString("en-US")} characters in a comment, and this one has ${length.toLocaleString("en-US")}. Shorten it, or press Esc to discard`

/** Steps the selection through the details items. With nothing selected, `]` starts at the first and `[` at the last. */
export function selectItem(state: State, by: 1 | -1): Update {
  if (state.details.state !== "ready") return [state, []]
  const items = detailsItems(state.details.value)
  if (items.length === 0) return [{ ...state, flash: info("This task has no comments yet") }, []]
  const at = items.findIndex((item) => sameItem(item, state.selected))
  const next = at < 0 ? (by === 1 ? 0 : items.length - 1) : clamp(at + by, items.length)
  return [{ ...state, selected: items[next]! }, []]
}

export const newComment = (): Compose => composeOn("", null, [])

const composeOn = (draft: string, editing: CommentId | null, mentions: Mention[]): Compose => ({ kind: "compose", draft, editing, mentions, pick: 0, dismissed: null })

/** The draft as typed: mentions follow the edit, the highlight goes back to the first suggestion, and a closed list stays closed for its own `@`. */
export function composeDraft(mode: Compose, draft: string): Compose {
  const dismissed = mode.dismissed !== null && typedMention(draft)?.at === mode.dismissed ? mode.dismissed : null
  return { ...mode, draft, mentions: followEdit(mode.draft, draft, mode.mentions), pick: 0, dismissed }
}

/** Tab or Enter on a suggestion: the typed `@letters` become `@Full Name` and a mention of that person. */
export function pickMention(state: State): Update {
  const found = mentionSuggestions(state)
  if (state.mode.kind !== "compose" || !found) return [state, []]
  const contact = found.contacts[clamp(state.mode.pick, found.contacts.length)]!
  const mention: Mention = { at: found.at, id: contact.id, name: contact.name }
  const draft = `${state.mode.draft.slice(0, found.at)}@${contact.name} `
  return [{ ...state, mode: { ...state.mode, draft, mentions: [...state.mode.mentions, mention], pick: 0, dismissed: null } }, []]
}

/** Esc on the list closes it and leaves the comment box open. */
export function closeMentions(state: State): Update {
  const found = mentionSuggestions(state)
  if (state.mode.kind !== "compose" || !found) return [state, []]
  return [{ ...state, mode: { ...state.mode, dismissed: found.at } }, []]
}

const notMine = (state: State, comment: Comment) => `This is ${contactName(state, comment.authorId)}'s comment, not yours`

/** Why the selected comment cannot be edited, or null when it can. */
function editRefusal(state: State, comment: Comment): string | null {
  if (comment.authorId !== state.profile.userId) return notMine(state, comment)
  if (editWindowLeft(comment.createdDate, state.clock.now) <= 0) return "Comments can only be edited in the 5 minutes after posting"
  return null
}

/** `d` on a comment of mine asks first. Deleting has no time limit, in Wrike as here. */
export function deleteComment(state: State): Update {
  const comment = selectedComment(state)
  if (!comment) return [state, []]
  if (comment.authorId !== state.profile.userId) return [{ ...state, flash: info(notMine(state, comment)) }, []]
  return [{ ...state, mode: { kind: "confirm-delete", id: comment.id } }, []]
}

/** `y` while asked: the comment is deleted. */
export function confirmDelete(state: State): Update {
  const task = openTask(state)
  if (state.mode.kind !== "confirm-delete" || !task) return [state, []]
  return [{ ...state, mode: { kind: "browse" }, flash: info("Deleting the comment...") }, [{ kind: "delete-comment", taskId: task.id, id: state.mode.id }]]
}

export const keepComment = (state: State): Update => [{ ...state, mode: { kind: "browse" }, flash: info("Kept the comment") }, []]

export function commentDeleted(state: State, action: Action & { type: "comment-deleted" }): Update {
  const { taskId, id, result } = action
  if (result.ok) return [{ ...removeComment(state, taskId, id), flash: info("Comment deleted") }, []]
  // A second delete answers 404: the comment is gone either way.
  if (result.error.kind === "not_found") return [{ ...removeComment(state, taskId, id), flash: info("The comment was already deleted") }, []]
  return [{ ...state, flash: failure(describeError(result.error)) }, []]
}

/** Opens the comment box on the selected comment, when it is mine and still in its edit window. */
export function editComment(state: State): Update {
  const comment = selectedComment(state)
  if (!comment) return [state, []]
  const refusal = editRefusal(state, comment)
  if (refusal) return [{ ...state, flash: info(refusal) }, []]
  const editable = editableComment(comment.text, mentionName(state))
  if (!editable) return [{ ...state, flash: info("This comment has formatting the client cannot edit. Press o to edit it in Wrike") }, []]
  return [{ ...state, mode: composeOn(editable.text, comment.id, editable.mentions) }, []]
}

export function submitCompose(state: State, mode: Compose): Update {
  const task = openTask(state)
  if (!task) return [{ ...state, mode: { kind: "browse" } }, []]
  const body = commentBody(mode.draft, mode.mentions)
  if (body.text === "") return [{ ...state, flash: failure(EMPTY) }, []]
  if (body.text.length > COMMENT_LIMIT) return [{ ...state, flash: failure(tooLong(body.text.length)) }, []]
  const closed: State = { ...state, mode: { kind: "browse" } }
  if (mode.editing === null) return [{ ...closed, flash: info("Posting the comment...") }, [{ kind: "save-comment", taskId: task.id, editing: null, body }]]

  const comment = state.details.state === "ready" ? state.details.value.comments.find((candidate) => candidate.id === mode.editing) : undefined
  if (!comment) return [{ ...closed, flash: info("That comment is no longer there") }, []]
  if (editWindowLeft(comment.createdDate, state.clock.now) <= 0) return [{ ...state, flash: failure("The 5-minute edit window has closed. Esc discards the edit") }, []]
  const original = editableComment(comment.text, mentionName(state))
  const unchanged = original !== null && JSON.stringify(commentBody(original.text, original.mentions)) === JSON.stringify(body)
  if (unchanged) return [{ ...closed, flash: info("Comment unchanged") }, []]
  return [{ ...closed, flash: info("Saving the comment...") }, [{ kind: "save-comment", taskId: task.id, editing: comment.id, body }]]
}

/** Ctrl+E: the draft goes to the editor, and the comment box waits for what comes back. */
export function composeEditor(state: State): Update {
  return state.mode.kind === "compose" ? [state, [{ kind: "compose-in-editor", draft: state.mode.draft }]] : [state, []]
}

/** The editor's text is submitted as if typed. An unchanged or emptied file is a cancel. */
export function composed(state: State, text: string | null): Update {
  const mode = state.mode
  if (mode.kind !== "compose") return [state, []]
  if (text === null || text.trim() === "") {
    const why = mode.editing === null ? "Comment discarded" : text === null ? "Comment unchanged" : "Edit discarded"
    return [{ ...state, mode: { kind: "browse" }, flash: info(why) }, []]
  }
  const next: Compose = { ...mode, draft: text, mentions: refindMentions(text, mode.mentions) }
  return submitCompose({ ...state, mode: next }, next)
}

function withComments(state: State, taskId: TaskId, change: (comments: Comment[]) => Comment[]): State {
  if (state.details.state !== "ready" || state.details.value.task.id !== taskId) return state
  return { ...state, details: { state: "ready", value: { ...state.details.value, comments: change(state.details.value.comments) } } }
}

function removeComment(state: State, taskId: TaskId, id: CommentId): State {
  const removed = withComments(state, taskId, (comments) => comments.filter((comment) => comment.id !== id))
  return sameItem(state.selected, { kind: "comment", id }) ? { ...removed, selected: null } : removed
}

export function commentSaved(state: State, action: Action & { type: "comment-saved" }): Update {
  const { taskId, editing, result } = action
  if (!result.ok) {
    if (editing && result.error.kind === "not_found") return [{ ...removeComment(state, taskId, editing), flash: info("That comment was deleted in Wrike") }, []]
    return [{ ...state, flash: failure(describeError(result.error)) }, []]
  }
  const saved = result.value
  if (editing) return [{ ...withComments(state, taskId, (comments) => comments.map((comment) => (comment.id === saved.id ? saved : comment))), flash: info("Comment saved") }, []]
  const posted = withComments(state, taskId, (comments) => [...comments, saved])
  return [{ ...posted, flash: info("Comment posted") }, posted === state ? [] : [{ kind: "scroll", pane: "details", to: "bottom" }]]
}
