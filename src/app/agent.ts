import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Env } from "../auth/config"
import { agentMessage, launchPlan, launchRefusal, programName, startedText, type LaunchCheck } from "../domain/agent"
import { safeFileName, SCREENSHOT_LIMIT, skipReason, TASK_FILE, taskMarkdown, type AttachmentOutcome } from "../domain/agent-context"
import { appDirs } from "../persist/dirs"
import type { WrikeClient } from "../wrike/client"
import { describeError, toWrikeError } from "../wrike/errors"
import type { Action, AgentHandoff } from "./state"

/** What a handoff needs from outside the app. */
export type AgentDeps = {
  /** `<state>/agent`, which holds one folder per task. */
  dir: string
  env: Env
  home: string
  /** True when a program of that name can be run. */
  onPath(program: string): boolean
  isDirectory(path: string): Promise<boolean>
  /** Gives the terminal to the agent in `cwd` and resolves when it exits. */
  terminal(argv: string[], cwd: string): Promise<void>
  /** Runs herdr-app and resolves to Herdr's error, or null when the tab opened. */
  herdr(argv: string[]): Promise<string | null>
}

/** Where a handoff and `wrike-tui export` write a task, one folder per task. */
export const agentDir = (env: Env) => join(appDirs(env).state, "agent")

/** What task.md is written from. */
export type TaskContext = Pick<AgentHandoff, "details" | "contacts" | "workflows" | "fields">

const reason = (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown))

/**
 * Empties the task's folder and writes task.md into it with the task's
 * screenshots beside it. A download that fails is listed in task.md and
 * never stops the rest. Resolves to the task file and the screenshots saved.
 */
export async function writeContext(client: WrikeClient, dir: string, context: TaskContext): Promise<{ taskFile: string; screenshots: string[] }> {
  const { task, attachments, comments, folders } = context.details
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const taken = new Set<string>()
  const outcomes: AttachmentOutcome[] = []
  for (const attachment of attachments) {
    const skipped = skipReason(attachment)
    if (skipped !== null) {
      outcomes.push({ kind: "skipped", attachment, why: skipped })
      continue
    }
    try {
      const bytes = await client.attachmentFile(attachment.id, SCREENSHOT_LIMIT)
      if (bytes === null) {
        outcomes.push({ kind: "skipped", attachment, why: "over 10 MB" })
        continue
      }
      const file = safeFileName(attachment.name, taken)
      taken.add(file)
      await Bun.write(join(dir, file), bytes)
      outcomes.push({ kind: "saved", attachment, file })
    } catch (thrown) {
      outcomes.push({ kind: "failed", attachment, why: describeError(toWrikeError(thrown)) })
    }
  }
  const markdown = taskMarkdown({ task, comments, folders, contacts: context.contacts, workflows: context.workflows, fields: context.fields, attachments: outcomes })
  const taskFile = join(dir, TASK_FILE)
  await Bun.write(taskFile, markdown)
  return { taskFile, screenshots: outcomes.flatMap((outcome) => (outcome.kind === "saved" ? [outcome.file] : [])) }
}

/**
 * Checks the agent can start, writes the task for it, and starts it. Every
 * refusal and failure ends in the status bar. An agent that had the terminal
 * reports back once it exits.
 */
export async function handToAgent(client: WrikeClient, deps: AgentDeps, handoff: AgentHandoff, dispatch: (action: Action) => void): Promise<void> {
  const fail = (text: string) => dispatch({ type: "flash", flash: { tone: "error", text } })
  const { settings, workspace } = handoff
  const check: LaunchCheck = { settings, env: deps.env, onPath: deps.onPath, workspace, workspaceExists: await deps.isDirectory(workspace), home: deps.home }
  const refused = launchRefusal(check)
  if (refused) return fail(refused.message)

  let written: { taskFile: string; screenshots: string[] }
  try {
    written = await writeContext(client, join(deps.dir, handoff.details.task.id), handoff)
  } catch (thrown) {
    return fail(`Could not write the task for the agent: ${reason(thrown)}`)
  }

  const message = agentMessage(handoff.prompt.prompt, written.taskFile, written.screenshots)
  const plan = launchPlan({ ...check, title: handoff.details.task.title, message })
  const program = programName(settings.command)
  switch (plan.kind) {
    case "refused":
      return fail(plan.message)
    case "herdr": {
      const error = await deps.herdr(plan.argv).catch((thrown: unknown) => reason(thrown))
      if (error !== null) return fail(`Herdr did not open a tab: ${error}`)
      return dispatch({ type: "flash", flash: { tone: "info", text: startedText(settings.command) } })
    }
    case "terminal":
      try {
        await deps.terminal(plan.argv, plan.cwd)
      } catch (thrown) {
        return fail(`Could not start ${program}: ${reason(thrown)}`)
      }
      return dispatch({ type: "agent-returned" })
  }
}
