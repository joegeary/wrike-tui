import { agentSettings, folderLevels, programName, resolveWorkspace, type AgentPrompt } from "../../domain/agent"
import type { FolderRef, Task } from "../../domain/model"
import { fieldDefs, pickerOptions } from "../selectors"
import { shown, type AgentPicker, type Details, type PickerMode, type State, type Update } from "../state"
import { info } from "./core"
import { refresh } from "./load"

/** `a` on a task: pick what the agent is asked to do. */
export function agentCommand(state: State): Update {
  return [{ ...state, mode: { kind: "picker", field: "agent-prompt", query: "", cursor: 0, chosen: [], origin: "browse" } }, []]
}

/** Each folder's parents, from every space tree the app has loaded. */
function parentIndex(trees: State["trees"]): Map<string, FolderRef[]> {
  const parents = new Map<string, FolderRef[]>()
  for (const loadable of trees.values()) {
    for (const node of shown(loadable)?.values() ?? []) {
      for (const child of node.childIds) parents.set(child, [...(parents.get(child) ?? []), { id: node.id, title: node.title }])
    }
  }
  return parents
}

/** The folders the task is in, then their ancestors as far as the loaded trees go, the nearest level first. */
function taskFolderLevels(state: State, task: Task, details: Details): FolderRef[][] {
  const parents = parentIndex(state.trees)
  const titles = new Map<string, string>([...parents.values()].flat().map((folder) => [folder.id, folder.title]))
  for (const folder of details.folders) titles.set(folder.id, folder.title)
  const direct = task.parentIds.map((id): FolderRef => ({ id: id as FolderRef["id"], title: titles.get(id) ?? "" }))
  return folderLevels(direct, (folder) => parents.get(folder.id) ?? [])
}

/** The task that is open, with everything drawn beside it, or null while it loads. */
const openDetails = (state: State): Details | null => shown(state.details) ?? null

/** Writes the task out and starts the agent in `workspace`. */
function handOff(state: State, details: Details, prompt: AgentPrompt, workspace: string): Update {
  const settings = agentSettings(state.settings.agent)
  const handoff = { details, prompt, workspace, settings, contacts: state.contacts, workflows: state.workflows, fields: fieldDefs(state.customFields) }
  const flash = info(`Writing the task for ${programName(settings.command)}...`)
  return [{ ...state, mode: { kind: "browse" }, flash }, [{ kind: "hand-to-agent", handoff }]]
}

/** Enter on a prompt: the agent starts where the config sends this task, or the person picks the folder. */
export function submitAgentPicker(state: State, mode: PickerMode & { field: AgentPicker }): Update {
  const details = openDetails(state)
  const option = pickerOptions(state, mode)[mode.cursor]
  if (!details) return [{ ...state, mode: { kind: "browse" }, flash: info("The task is still loading") }, []]
  if (!option) return [state, []]
  if (mode.field === "agent-workspace") return handOff(state, details, mode.prompt, option.id)
  const settings = agentSettings(state.settings.agent)
  const prompt = settings.prompts[Number(option.id)]
  if (!prompt) return [state, []]
  const workspace = resolveWorkspace(settings, taskFolderLevels(state, details.task, details), state.places.home)
  if (workspace === null) return [{ ...state, mode: { kind: "picker", field: "agent-workspace", prompt, query: "", cursor: 0, chosen: [], origin: "browse" } }, []]
  return handOff(state, details, prompt, workspace)
}

/** The agent gave the terminal back. It may have changed the task through Wrike, so everything on screen is fetched again. */
export function agentReturned(state: State): Update {
  return refresh({ ...state, flash: null })
}
