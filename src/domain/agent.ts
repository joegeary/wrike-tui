import { basename, isAbsolute, join, sep } from "node:path"
import type { Env } from "../auth/config"
import type { FolderRef } from "./model"

export const AGENT_OPENS = ["auto", "herdr", "terminal"] as const
/** Where the agent runs: a new Herdr tab, this terminal, or Herdr when wrike-tui runs inside it and the terminal otherwise. */
export type AgentOpen = (typeof AGENT_OPENS)[number]

/** What the agent is asked to do with the task, as the picker offers it. */
export type AgentPrompt = { name: string; prompt: string }

/** The `agent` block of config.json as written. Every part is optional and kept as written, so a save writes it back unchanged. */
export type AgentConfig = {
  command?: string[]
  open?: AgentOpen
  workspace?: string
  folders?: Record<string, string>
  prompts?: AgentPrompt[]
}

/** The `agent` block with its defaults filled in. Paths are still as written. */
export type AgentSettings = {
  command: string[]
  open: AgentOpen
  workspace: string | null
  folders: Record<string, string>
  prompts: AgentPrompt[]
}

/** The home folder, and the folder wrike-tui was started in. */
export type Places = { home: string; cwd: string }

export const BUILT_IN_PROMPTS: readonly AgentPrompt[] = [
  { name: "Implement", prompt: "Implement this Wrike task. Keep the changes focused on what it asks for, and run the tests before you finish." },
  { name: "Plan", prompt: "Make a plan for this Wrike task. Do not change any code yet." },
  { name: "Investigate", prompt: "Investigate this Wrike task. Find the code it concerns and explain the cause or the approach. Do not change anything." },
  { name: "Context only", prompt: "Read this Wrike task and sum it up in a few lines. Then wait for my instructions." },
]

const DEFAULT_COMMAND = ["claude"]

/**
 * The block with its defaults. A prompt with an empty name or text is
 * dropped, and when none is left the built-in prompts are offered.
 */
export function agentSettings(config: AgentConfig | undefined): AgentSettings {
  const prompts = (config?.prompts ?? []).filter((entry) => entry.name.trim() !== "" && entry.prompt.trim() !== "")
  return {
    command: config?.command ?? DEFAULT_COMMAND,
    open: config?.open ?? "auto",
    workspace: config?.workspace?.trim() ? config.workspace : null,
    folders: config?.folders ?? {},
    prompts: prompts.length > 0 ? prompts : [...BUILT_IN_PROMPTS],
  }
}

/** `~` is the home folder, and a relative path is relative to it. */
export function expandPath(path: string, home: string): string {
  const trimmed = path.trim()
  if (trimmed === "~") return home
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(home, trimmed.slice(2))
  return isAbsolute(trimmed) ? trimmed : join(home, trimmed)
}

/** A path as people read it, with `~` for the home folder. */
export function tildePath(path: string, home: string): string {
  if (path === home) return "~"
  return path.startsWith(home + sep) ? `~${sep}${path.slice(home.length + sep.length)}` : path
}

/**
 * The folders a task is in, then their parents, then theirs, as far as
 * `parentsOf` knows the tree: one list per level, the nearest level first.
 * A folder reached twice counts at its nearest level.
 */
export function folderLevels(folders: readonly FolderRef[], parentsOf: (folder: FolderRef) => readonly FolderRef[]): FolderRef[][] {
  const seen = new Set<string>()
  const unseen = (candidates: readonly FolderRef[]) =>
    candidates.filter((folder) => {
      if (seen.has(folder.id)) return false
      seen.add(folder.id)
      return true
    })
  const levels: FolderRef[][] = []
  for (let level = unseen(folders); level.length > 0; level = unseen(level.flatMap(parentsOf))) levels.push(level)
  return levels
}

const sameTitle = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" }) === 0

/**
 * The path `folders` gives the nearest folder that matches, by ID or by title.
 * On one level an ID wins over a title. A title matches whatever its case.
 */
export function matchFolder(folders: Readonly<Record<string, string>>, levels: readonly FolderRef[][]): string | null {
  const keys = Object.keys(folders)
  for (const level of levels) {
    for (const folder of level) if (Object.hasOwn(folders, folder.id)) return folders[folder.id]!
    for (const folder of level) {
      const key = folder.title.trim() === "" ? undefined : keys.find((candidate) => sameTitle(candidate, folder.title))
      if (key !== undefined) return folders[key]!
    }
  }
  return null
}

/** The folder the agent runs in: the matching folder's path, else `workspace`, else null so the person picks one. */
export function resolveWorkspace(settings: AgentSettings, levels: readonly FolderRef[][], home: string): string | null {
  const path = matchFolder(settings.folders, levels) ?? settings.workspace
  return path === null ? null : expandPath(path, home)
}

export type WorkspaceChoice = { path: string; why: string }

/** What the workspace picker offers: the folder wrike-tui was started in, then every path the config names, each once. */
export function workspaceChoices(settings: AgentSettings, places: Places): WorkspaceChoice[] {
  const named: WorkspaceChoice[] = [
    { path: places.cwd, why: "where wrike-tui started" },
    ...(settings.workspace ? [{ path: expandPath(settings.workspace, places.home), why: "workspace" }] : []),
    ...Object.entries(settings.folders).map(([folder, path]) => ({ path: expandPath(path, places.home), why: folder })),
  ]
  const byPath = new Map<string, WorkspaceChoice>()
  for (const choice of named) {
    const known = byPath.get(choice.path)
    byPath.set(choice.path, known ? { ...known, why: `${known.why}, ${choice.why}` } : choice)
  }
  return [...byPath.values()]
}

/**
 * The one message the agent starts with. The task itself stays in the file:
 * Linux caps one argument at 128 KB, and a long task with its comments can pass that.
 */
export function agentMessage(prompt: string, taskFile: string, screenshots: readonly string[]): string {
  const pointer = `The Wrike task is in ${taskFile}. Read it first.`
  const images = screenshots.length > 0 ? ` Its screenshots are in the same folder: ${screenshots.join(", ")}.` : ""
  return `${prompt.trim()}\n\n${pointer}${images}`
}

/** The agent's program, as the status bar names it. */
export const programName = (command: readonly string[]) => basename(command[0] ?? "agent")

/** What the status bar says once Herdr opened the tab, such as "Claude started in a new Herdr tab". */
export function startedText(command: readonly string[]): string {
  const program = programName(command)
  return `${program.charAt(0).toUpperCase()}${program.slice(1)} started in a new Herdr tab`
}

/** A Herdr tab's name: the task title, cut to about 30 characters. */
export function tabName(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim()
  return flat.length > 30 ? `${flat.slice(0, 29).trimEnd()}…` : flat
}

export const HERDR = "herdr-app"

/** Herdr starts it in a new tab, or it takes this terminal until it exits. */
export type LaunchPlan = { kind: "herdr"; argv: string[] } | { kind: "terminal"; argv: string[]; cwd: string }
export type Refusal = { kind: "refused"; message: string }

export type LaunchCheck = {
  settings: AgentSettings
  env: Env
  /** True when a program of that name can be run. */
  onPath(program: string): boolean
  workspace: string
  workspaceExists: boolean
  home: string
}

export type LaunchInput = LaunchCheck & { title: string; message: string }

/** Inside Herdr means wrike-tui runs in a terminal Herdr started. */
const insideHerdr = (env: Env) => Boolean(env.HC_TERMINAL_ID)

function chooseOpen(check: LaunchCheck): "herdr" | "terminal" | Refusal {
  const { open } = check.settings
  if (open === "terminal") return "terminal"
  const herdr = insideHerdr(check.env) && check.onPath(HERDR)
  if (open === "auto") return herdr ? "herdr" : "terminal"
  if (!insideHerdr(check.env)) return { kind: "refused", message: "agent.open is herdr, but wrike-tui is not running inside Herdr" }
  return herdr ? "herdr" : { kind: "refused", message: `${HERDR} is not on your PATH` }
}

/** Why nothing can launch, checked before anything is downloaded or written, or null when it can. */
export function launchRefusal(check: LaunchCheck): Refusal | null {
  const program = check.settings.command[0]
  if (program === undefined || program.trim() === "") return { kind: "refused", message: "agent.command in config.json names no program" }
  if (!check.onPath(program)) return { kind: "refused", message: `${programName(check.settings.command)} is not on your PATH` }
  if (!check.workspaceExists) return { kind: "refused", message: `The workspace ${tildePath(check.workspace, check.home)} does not exist` }
  const open = chooseOpen(check)
  return typeof open === "string" ? null : open
}

/** How the agent starts: the command with the message as its last argument, in a Herdr tab or in this terminal. */
export function launchPlan(input: LaunchInput): LaunchPlan | Refusal {
  const refused = launchRefusal(input)
  if (refused) return refused
  const argv = [...input.settings.command, input.message]
  if (chooseOpen(input) === "terminal") return { kind: "terminal", argv, cwd: input.workspace }
  return { kind: "herdr", argv: [HERDR, "do", "tab.new", "--name", tabName(input.title), "--folder", input.workspace, "--argv", JSON.stringify(argv)] }
}
