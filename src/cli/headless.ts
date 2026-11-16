import { resolve } from "node:path"
import { agentDir, writeContext } from "../app/agent"
import { loadDetails } from "../app/effects"
import type { Env } from "../auth/config"
import type { Session } from "../auth/session"
import { inboxLines, parseTaskRef, taskLines, type TaskRef } from "../domain/headless"
import type { CustomStatusId } from "../domain/ids"
import { findStatus, mergeWorkflows, type Task, type Workflow } from "../domain/model"
import type { WrikeClient } from "../wrike/client"
import { WrikeFailure } from "../wrike/errors"

/** The commands that print for scripts and never open the client. */
export type HeadlessCommand = { kind: "tasks" } | { kind: "inbox" } | { kind: "export"; input: string; ref: TaskRef }

const USAGE = {
  tasks: "wrike-tui tasks --mine --json",
  inbox: "wrike-tui inbox --json",
  export: "wrike-tui export <task>",
} as const

/** The folders one `GET /folders/{ids}` takes. */
const FOLDERS_PER_REQUEST = 100

/** The command `argv` names, an error line for one written wrong, or null when it names none of them. */
export function parseHeadless(argv: readonly string[]): HeadlessCommand | { error: string } | null {
  const [command, ...args] = argv
  switch (command) {
    case "tasks":
      return flagsError(command, args, ["--mine", "--json"]) ?? { kind: "tasks" }
    case "inbox":
      return flagsError(command, args, ["--json"]) ?? { kind: "inbox" }
    case "export": {
      const flag = args.find((arg) => arg.startsWith("-"))
      if (flag !== undefined) return { error: `Unknown option for export: ${flag}. Usage: ${USAGE.export}` }
      const [input, ...extra] = args
      if (input === undefined) return { error: `export needs a task: its ID, its API ID or its permalink. Usage: ${USAGE.export}` }
      if (extra.length > 0) return { error: `export takes one task. Usage: ${USAGE.export}` }
      const ref = parseTaskRef(input)
      if (!ref) return { error: `Not a task ID or permalink: ${input}. Usage: ${USAGE.export}` }
      return { kind: "export", input, ref }
    }
    default:
      return null
  }
}

/** Every flag in `required` and nothing else, in any order. */
function flagsError(command: "tasks" | "inbox", args: readonly string[], required: readonly string[]): { error: string } | null {
  const unknown = args.find((arg) => !required.includes(arg))
  if (unknown !== undefined) return { error: `Unknown option for ${command}: ${unknown}. Usage: ${USAGE[command]}` }
  const missing = required.filter((flag) => !args.includes(flag))
  if (missing.length > 0) return { error: `${command} needs ${missing.join(" and ")}. Usage: ${USAGE[command]}` }
  return null
}

export type HeadlessIo = { env: Env; out(line: string): void; err(line: string): void }

/**
 * Runs the command and prints its lines. A Wrike failure is thrown for the
 * caller to report. Lines are printed only once everything loaded, so a
 * failure leaves stdout empty.
 */
export async function runHeadless(command: HeadlessCommand, session: Session, client: WrikeClient, io: HeadlessIo): Promise<number> {
  switch (command.kind) {
    case "tasks": {
      const tasks = await allPages(client, session)
      const [workflows, titles] = await Promise.all([workflowsFor(client, tasks.map((task) => task.statusId)), folderTitles(client, tasks)])
      for (const line of taskLines(tasks, workflows, titles)) io.out(JSON.stringify(line))
      return 0
    }
    case "inbox":
      for (const line of inboxLines(await client.inbox({ includeRead: true }))) io.out(JSON.stringify(line))
      return 0
    case "export": {
      const taskFile = await exportTask(client, command.ref, io.env).catch((thrown: unknown) => {
        if (thrown instanceof WrikeFailure && thrown.error.kind === "not_found") return null
        throw thrown
      })
      if (taskFile === null) return io.err(`No Wrike task matches ${command.input}.`), 1
      io.out(taskFile)
      return 0
    }
  }
}

async function allPages(client: WrikeClient, session: Session): Promise<Task[]> {
  const tasks: Task[] = []
  let pageToken: string | null = null
  do {
    const page = await client.tasks({ kind: "assigned", user: session.profile.userId }, { completed: false, ...(pageToken ? { pageToken } : {}) })
    tasks.push(...page.tasks)
    pageToken = page.next
  } while (pageToken)
  return tasks
}

/** The account's workflows, and the spaces' own too when a status is in none of them. */
async function workflowsFor(client: WrikeClient, statuses: readonly CustomStatusId[]): Promise<Workflow[]> {
  const workflows = await client.workflows()
  if (statuses.every((id) => findStatus(workflows, id))) return workflows
  return mergeWorkflows(workflows, await client.spaceWorkflows())
}

async function folderTitles(client: WrikeClient, tasks: readonly Task[]): Promise<Map<string, string>> {
  const ids = [...new Set(tasks.flatMap((task) => task.parentIds))]
  const titles = new Map<string, string>()
  for (let at = 0; at < ids.length; at += FOLDERS_PER_REQUEST) {
    for (const folder of await client.folders(ids.slice(at, at + FOLDERS_PER_REQUEST))) titles.set(folder.id, folder.title)
  }
  return titles
}

/** Writes the task the way the `a` handoff does and resolves to its task.md. */
async function exportTask(client: WrikeClient, ref: TaskRef, env: Env): Promise<string> {
  const [details, contacts, fields] = await Promise.all([loadDetails(client, ref), client.contacts(), client.customFields()])
  const workflows = await workflowsFor(client, [details.task.statusId])
  const { taskFile } = await writeContext(client, resolve(agentDir(env), details.task.id), {
    details,
    contacts: new Map(contacts.map((contact) => [contact.id, contact])),
    workflows,
    fields: new Map(fields.map((field) => [field.id, field])),
  })
  return taskFile
}
