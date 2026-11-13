import { descriptionFromEdit, editableDescription } from "../domain/description"
import type { Persistence } from "../persist/persistence"
import type { TaskPage, WrikeClient } from "../wrike/client"
import { describeError, toWrikeError, WrikeFailure } from "../wrike/errors"
import { HISTORY_PAGE, type Action, type Clock, type Details, type Effect, type OpenTarget, type Result, type ScrollTo, type TaskSource } from "./state"

export type EffectDeps = {
  client: WrikeClient
  clock(): Clock
  /** Hands the terminal to the user's editor. Resolves to null when the text came back unchanged. */
  editor(initial: string, extension: "md" | "html" | "txt"): Promise<string | null>
  openUrl(url: string): Promise<void>
  /** False when the terminal cannot take a clipboard write. */
  copy(text: string): boolean
  scroll(pane: "details" | "help", to: ScrollTo): void
  persistence: Persistence
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
  // Attachments and folder titles are decoration: neither failing must hide the task. A failed attachments call is drawn as a notice.
  const [task, attachments, comments] = await Promise.all([client.task(id), attempt(() => client.attachments(id)), client.comments(id)])
  const folders = await client.folders(task.parentIds).catch(() => [])
  return attachments.ok ? { task, attachments: attachments.value, comments, folders } : { task, attachments: [], attachmentsError: attachments.error, comments, folders }
}

/** One page of a paged list, or the single task a permalink or an ID names. */
async function loadTasks(client: WrikeClient, source: TaskSource, completed: boolean, pageToken: string | null): Promise<TaskPage> {
  switch (source.kind) {
    case "permalink": {
      const task = await client.taskByPermalink(source.url)
      return { tasks: task ? [task] : [], next: null }
    }
    case "legacy-id": {
      const id = await client.taskIdFromLegacy(source.id)
      return { tasks: id ? [await client.task(id)] : [], next: null }
    }
    default:
      return client.tasks(source, { completed, ...(pageToken ? { pageToken } : {}) })
  }
}

/** A write to disk that failed is reported once and never stops the session. */
async function persist(dispatch: (action: Action) => void, what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown)
    dispatch({ type: "flash", flash: { tone: "error", text: `Could not save ${what}: ${reason}` } })
  }
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
    case "load-tasks": {
      const result = await attempt(() => loadTasks(client, effect.source, effect.completed, effect.pageToken))
      const jump = effect.source.kind === "permalink" || effect.source.kind === "legacy-id"
      return dispatch({ type: "tasks-loaded", key: effect.key, request: effect.request, clock: deps.clock(), more: effect.pageToken !== null, jump, result })
    }
    case "load-spaces": {
      if (effect.cached) {
        const cached = await deps.persistence.loadSpaces().catch(() => null)
        if (cached?.value) dispatch({ type: "spaces-loaded", request: effect.request, from: "cache", result: { ok: true, value: cached.value.value } })
      }
      return dispatch({ type: "spaces-loaded", request: effect.request, from: "wrike", result: await attempt(() => client.spaces()) })
    }
    case "load-tree": {
      if (effect.cached) {
        const cached = await deps.persistence.loadTree(effect.space).catch(() => null)
        if (cached?.value) dispatch({ type: "tree-loaded", space: effect.space, request: effect.request, from: "cache", result: { ok: true, value: cached.value.value } })
      }
      return dispatch({ type: "tree-loaded", space: effect.space, request: effect.request, from: "wrike", result: await attempt(() => client.spaceTree(effect.space)) })
    }
    case "load-details":
      return dispatch({ type: "details-loaded", request: effect.request, result: await attempt(() => loadDetails(client, effect.target)) })
    case "load-history": {
      const page = { pageSize: HISTORY_PAGE, ...(effect.pageToken ? { pageToken: effect.pageToken } : {}) }
      const result = await attempt(() => client.history(effect.item, page))
      return dispatch({ type: "history-loaded", taskId: effect.taskId, request: effect.request, more: effect.pageToken !== null, result })
    }
    case "load-preview":
      return dispatch({ type: "preview-loaded", id: effect.id, result: await attempt(() => client.attachmentPreview(effect.id)) })
    case "open-attachment": {
      const link = await attempt(() => client.attachmentUrl(effect.id))
      if (!link.ok) return dispatch({ type: "flash", flash: { tone: "error", text: `Could not open ${effect.name}: ${describeError(link.error)}` } })
      return runEffect({ kind: "open-url", url: link.value }, deps, dispatch)
    }
    case "update-task":
      return dispatch({ type: "task-saved", done: effect.done, result: await attempt(() => client.updateTask(effect.taskId, effect.patch)) })
    case "save-comment": {
      const { taskId, editing, body } = effect
      const result = await attempt(() => (editing ? client.updateComment(editing, body) : client.addComment(taskId, body)))
      return dispatch({ type: "comment-saved", taskId, editing, result })
    }
    case "delete-comment": {
      const result = await attempt(async () => (await client.deleteComment(effect.id), null))
      return dispatch({ type: "comment-deleted", taskId: effect.taskId, id: effect.id, result })
    }
    case "edit-description": {
      const editable = editableDescription(effect.task.descriptionHtml)
      const edited = await edit(deps, dispatch, editable.text, editable.format === "markdown" ? "md" : "html")
      if (edited === undefined) return
      if (edited === null) return dispatch({ type: "flash", flash: { tone: "info", text: "Description unchanged" } })
      const html = descriptionFromEdit({ ...editable, text: edited })
      const result = await attempt(() => client.updateTask(effect.task.id, { field: "description", html }))
      return dispatch({ type: "task-saved", done: `Description saved from ${editable.format}`, result })
    }
    case "compose-in-editor": {
      const edited = await edit(deps, dispatch, effect.draft, "txt")
      return edited === undefined ? undefined : dispatch({ type: "composed", text: edited })
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
    case "scroll":
      return deps.scroll(effect.pane, effect.to)
    case "save-favorites":
      return persist(dispatch, "the favorites", () => deps.persistence.saveFavorites(effect.favorites))
    case "save-config":
      return persist(dispatch, "the config", () => deps.persistence.saveConfig(effect.settings))
    case "cache-spaces":
      return deps.persistence.saveSpaces(effect.spaces).catch(() => {})
    case "cache-tree":
      return deps.persistence.saveTree(effect.space, effect.tree).catch(() => {})
    case "quit":
      return deps.quit()
  }
}
