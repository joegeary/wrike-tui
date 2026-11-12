import { descriptionFromEdit, editableDescription } from "../domain/description"
import type { WrikeClient } from "../wrike/client"
import { toWrikeError, WrikeFailure } from "../wrike/errors"
import type { Action, Clock, Details, Effect, OpenTarget, Result } from "./state"

export type EffectDeps = {
  client: WrikeClient
  clock(): Clock
  /** Hands the terminal to the user's editor. Resolves to null when the text came back unchanged. */
  editor(initial: string, extension: "md" | "html" | "txt"): Promise<string | null>
  openUrl(url: string): Promise<void>
  /** False when the terminal cannot take a clipboard write. */
  copy(text: string): boolean
  scrollDetails(to: "up" | "down" | "top" | "bottom"): void
  quit(): void
}

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (thrown) {
    return { ok: false, error: toWrikeError(thrown) }
  }
}

async function loadDetails(client: WrikeClient, target: OpenTarget): Promise<Details> {
  const id = target.kind === "task" ? target.id : await client.taskIdFromLegacy(target.id)
  if (!id) throw new WrikeFailure({ kind: "not_found" })
  const [task, comments] = await Promise.all([client.task(id), client.comments(id)])
  // Folder titles are decoration, and a parent the token cannot read must not hide the task.
  const folders = await client.folders(task.parentIds).catch(() => [])
  return { task, comments, folders }
}

/** The edited text, null for no change, or undefined after reporting that the editor could not run. */
async function edit(
  deps: EffectDeps,
  dispatch: (action: Action) => void,
  initial: string,
  extension: "md" | "html" | "txt",
): Promise<string | null | undefined> {
  try {
    return await deps.editor(initial, extension)
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown)
    dispatch({ type: "flash", flash: { tone: "error", text: `Could not run the editor: ${reason}` } })
    return undefined
  }
}

/** Runs one effect and reports what happened as actions. The reducer never sees a thrown error. */
export async function runEffect(effect: Effect, deps: EffectDeps, dispatch: (action: Action) => void): Promise<void> {
  const { client } = deps
  switch (effect.kind) {
    case "load-reference": {
      const result = await attempt(async () => {
        const [contacts, workflows] = await Promise.all([client.contacts(), client.workflows()])
        return { contacts, workflows }
      })
      return dispatch({ type: "reference-loaded", result })
    }
    case "load-space-workflows":
      return dispatch({ type: "space-workflows-loaded", result: await attempt(() => client.spaceWorkflows()) })
    case "load-inbox": {
      const result = await attempt(() => client.inbox({ includeRead: effect.includeRead }))
      return dispatch({ type: "inbox-loaded", request: effect.request, clock: deps.clock(), result })
    }
    case "load-todo": {
      const result = await attempt(() => client.myTasks(effect.user))
      return dispatch({ type: "todo-loaded", request: effect.request, clock: deps.clock(), result })
    }
    case "search": {
      const { query } = effect
      const result = await attempt(async () => {
        switch (query.kind) {
          case "title":
            return client.searchTasks(query.text)
          case "permalink": {
            const task = await client.taskByPermalink(query.url)
            return task ? [task] : []
          }
          case "legacy-id": {
            const id = await client.taskIdFromLegacy(query.id)
            return id ? [await client.task(id)] : []
          }
        }
      })
      return dispatch({ type: "search-loaded", request: effect.request, jump: query.kind !== "title", result })
    }
    case "load-details":
      return dispatch({ type: "details-loaded", request: effect.request, result: await attempt(() => loadDetails(client, effect.target)) })
    case "update-task":
      return dispatch({ type: "task-saved", done: effect.done, result: await attempt(() => client.updateTask(effect.taskId, effect.patch)) })
    case "add-comment":
      return dispatch({ type: "comment-added", taskId: effect.taskId, result: await attempt(() => client.addComment(effect.taskId, effect.text)) })
    case "edit-description": {
      const editable = editableDescription(effect.task.descriptionHtml)
      const edited = await edit(deps, dispatch, editable.text, editable.format === "markdown" ? "md" : "html")
      if (edited === undefined) return
      if (edited === null) return dispatch({ type: "flash", flash: { tone: "info", text: "Description unchanged" } })
      const html = descriptionFromEdit({ format: editable.format, text: edited })
      const result = await attempt(() => client.updateTask(effect.task.id, { field: "description", html }))
      return dispatch({ type: "task-saved", done: `Description saved from ${editable.format}`, result })
    }
    case "compose-in-editor": {
      const edited = await edit(deps, dispatch, effect.draft, "txt")
      if (edited === undefined) return
      const text = edited?.trim()
      if (!text) return dispatch({ type: "flash", flash: { tone: "info", text: "Comment discarded" } })
      return dispatch({ type: "comment-added", taskId: effect.taskId, result: await attempt(() => client.addComment(effect.taskId, text)) })
    }
    case "open-url":
      return deps.openUrl(effect.url).catch((thrown) =>
        dispatch({ type: "flash", flash: { tone: "error", text: `Could not open the browser: ${thrown instanceof Error ? thrown.message : thrown}` } }),
      )
    case "copy":
      if (!deps.copy(effect.text)) {
        dispatch({ type: "flash", flash: { tone: "error", text: "This terminal does not accept clipboard writes (OSC 52)" } })
      }
      return
    case "scroll-details":
      return deps.scrollDetails(effect.to)
    case "quit":
      return deps.quit()
  }
}
