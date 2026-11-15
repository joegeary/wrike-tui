import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  agentMessage,
  agentSettings,
  BUILT_IN_PROMPTS,
  expandPath,
  folderLevels,
  launchPlan,
  launchRefusal,
  resolveWorkspace,
  startedText,
  tabName,
  tildePath,
  workspaceChoices,
  type AgentSettings,
  type LaunchInput,
} from "../../src/domain/agent"
import { folderId } from "../../src/domain/ids"
import type { FolderRef } from "../../src/domain/model"
import { ConfigSchema } from "../../src/persist/schemas"

const HOME = "/home/sam"
const folder = (id: string, title: string): FolderRef => ({ id: folderId(id), title })

describe("agent config", () => {
  test("an absent block runs claude, picks Herdr or the terminal by itself, and offers the four built-in prompts", () => {
    const settings = agentSettings(ConfigSchema.parse({}).agent)
    expect(settings).toEqual({ command: ["claude"], open: "auto", workspace: null, folders: {}, prompts: [...BUILT_IN_PROMPTS] })
    expect(settings.prompts.map((prompt) => prompt.name)).toEqual(["Implement", "Plan", "Investigate", "Context only"])
  })

  test("prompts in the config replace the built-in ones, and one with an empty name or text is dropped", () => {
    const config = ConfigSchema.parse({
      agent: {
        command: ["codex", "--full-auto"],
        open: "terminal",
        workspace: "~/dev/scratch",
        folders: { "Mobile app": "~/dev/mobile" },
        prompts: [
          { name: "Review", prompt: "Review the change this task asks for." },
          { name: " ", prompt: "No name." },
          { name: "No text", prompt: "" },
        ],
      },
    })
    expect(agentSettings(config.agent)).toEqual({
      command: ["codex", "--full-auto"],
      open: "terminal",
      workspace: "~/dev/scratch",
      folders: { "Mobile app": "~/dev/mobile" },
      prompts: [{ name: "Review", prompt: "Review the change this task asks for." }],
    })
  })

  test("when every prompt in the config is dropped, the built-in ones are offered", () => {
    expect(agentSettings({ prompts: [{ name: "", prompt: "" }] }).prompts).toEqual([...BUILT_IN_PROMPTS])
  })

  test("the block is kept as written, so saving the config writes it back unchanged", () => {
    expect(ConfigSchema.parse({ agent: { folders: { Platform: "api" } } }).agent).toEqual({ folders: { Platform: "api" } })
  })

  test("a block of the wrong shape fails the config like any other malformed setting", () => {
    expect(ConfigSchema.safeParse({ agent: { open: "tmux" } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { command: "claude" } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { prompts: [{ name: "Plan" }] } }).success).toBe(false)
  })
})

describe("paths", () => {
  test("~ is home, and a relative path is relative to home", () => {
    expect(expandPath("~", HOME)).toBe(HOME)
    expect(expandPath("~/dev/api", HOME)).toBe(join(HOME, "dev/api"))
    expect(expandPath("dev/api", HOME)).toBe(join(HOME, "dev/api"))
    expect(expandPath("/srv/api", HOME)).toBe("/srv/api")
  })

  test("a path under home is shown with ~", () => {
    expect(tildePath(HOME, HOME)).toBe("~")
    expect(tildePath(join(HOME, "dev/api"), HOME)).toBe("~/dev/api")
    expect(tildePath("/home/samuel/dev", HOME)).toBe("/home/samuel/dev")
  })
})

describe("workspace", () => {
  // Engineering (space) > Platform > Runbooks, and Runbooks is also filed under Shared.
  const parents: Record<string, FolderRef[]> = {
    RUN: [folder("PLAT", "Platform"), folder("SHARED", "Shared")],
    PLAT: [folder("ENG", "Engineering")],
    SHARED: [folder("ENG", "Engineering")],
  }
  const levels = (...direct: FolderRef[]) => folderLevels(direct, (each) => parents[each.id] ?? [])
  const settings = (extra: Partial<AgentSettings>): AgentSettings => ({ ...agentSettings(undefined), ...extra })

  test("the folders a task is in come first, then their parents level by level, each folder once", () => {
    expect(levels(folder("RUN", "Runbooks"))).toEqual([[folder("RUN", "Runbooks")], [folder("PLAT", "Platform"), folder("SHARED", "Shared")], [folder("ENG", "Engineering")]])
  })

  test("the nearest folder named in the config wins over an ancestor", () => {
    const folders = { Engineering: "~/dev/eng", Platform: "~/dev/platform" }
    expect(resolveWorkspace(settings({ folders }), levels(folder("RUN", "Runbooks")), HOME)).toBe(join(HOME, "dev/platform"))
  })

  test("on one folder its ID wins over its title, and a title matches whatever its case", () => {
    expect(resolveWorkspace(settings({ folders: { platform: "~/by-title", PLAT: "~/by-id" } }), levels(folder("PLAT", "Platform")), HOME)).toBe(join(HOME, "by-id"))
    expect(resolveWorkspace(settings({ folders: { platform: "~/by-title" } }), levels(folder("PLAT", "Platform")), HOME)).toBe(join(HOME, "by-title"))
  })

  test("with no folder matching, the workspace is the fallback, and with none either the person picks", () => {
    const task = levels(folder("RUN", "Runbooks"))
    expect(resolveWorkspace(settings({ folders: { Mobile: "~/dev/mobile" }, workspace: "~/dev/scratch" }), task, HOME)).toBe(join(HOME, "dev/scratch"))
    expect(resolveWorkspace(settings({ folders: { Mobile: "~/dev/mobile" } }), task, HOME)).toBeNull()
  })

  test("the picker offers the folder wrike-tui started in, then every path in the config once", () => {
    const choices = workspaceChoices(settings({ workspace: "~/dev/api", folders: { Mobile: "~/dev/mobile", API: "/home/sam/dev/api" } }), { home: HOME, cwd: "/srv/site" })
    expect(choices).toEqual([
      { path: "/srv/site", why: "where wrike-tui started" },
      { path: join(HOME, "dev/api"), why: "workspace, API" },
      { path: join(HOME, "dev/mobile"), why: "Mobile" },
    ])
  })
})

describe("the agent's message", () => {
  test("is the prompt, then where the task and its screenshots are", () => {
    expect(agentMessage("Make a plan.", "/s/agent/T1/task.md", ["a.png", "b.jpg"])).toBe(
      "Make a plan.\n\nThe Wrike task is in /s/agent/T1/task.md. Read it first. Its screenshots are in the same folder: a.png, b.jpg.",
    )
  })

  test("leaves the screenshots out when there are none", () => {
    expect(agentMessage("Make a plan.", "/s/agent/T1/task.md", [])).toBe("Make a plan.\n\nThe Wrike task is in /s/agent/T1/task.md. Read it first.")
  })
})

describe("launch plan", () => {
  const input = (extra: Partial<LaunchInput> = {}): LaunchInput => ({
    settings: agentSettings(undefined),
    env: {},
    onPath: () => true,
    workspace: "/home/sam/dev/api",
    workspaceExists: true,
    home: HOME,
    title: "Fix login redirect loop",
    message: "Plan it.\n\nThe Wrike task is in /s/task.md. Read it first.",
    ...extra,
  })
  const MESSAGE = input().message

  test("outside Herdr the agent takes the terminal in the workspace, with the message as its last argument", () => {
    expect(launchPlan(input())).toEqual({ kind: "terminal", argv: ["claude", MESSAGE], cwd: "/home/sam/dev/api" })
  })

  test("inside Herdr, auto opens a tab named after the task, running the command and the message", () => {
    const plan = launchPlan(input({ env: { HC_TERMINAL_ID: "t7" }, settings: { ...agentSettings(undefined), command: ["claude", "--model", "opus"] } }))
    expect(plan).toEqual({
      kind: "herdr",
      argv: ["herdr-app", "do", "tab.new", "--name", "Fix login redirect loop", "--folder", "/home/sam/dev/api", "--argv", JSON.stringify(["claude", "--model", "opus", MESSAGE])],
    })
  })

  test("auto stays in the terminal inside Herdr when herdr-app is not on the PATH", () => {
    expect(launchPlan(input({ env: { HC_TERMINAL_ID: "t7" }, onPath: (program) => program !== "herdr-app" }))).toMatchObject({ kind: "terminal" })
  })

  test("terminal stays in the terminal inside Herdr", () => {
    expect(launchPlan(input({ env: { HC_TERMINAL_ID: "t7" }, settings: { ...agentSettings(undefined), open: "terminal" } }))).toMatchObject({ kind: "terminal" })
  })

  test("herdr outside Herdr is refused, not quietly run in the terminal", () => {
    expect(launchPlan(input({ settings: { ...agentSettings(undefined), open: "herdr" } }))).toEqual({ kind: "refused", message: "agent.open is herdr, but wrike-tui is not running inside Herdr" })
  })

  test("a command not on the PATH is refused by its program name, and so is an empty one", () => {
    expect(launchRefusal(input({ onPath: () => false }))).toEqual({ kind: "refused", message: "claude is not on your PATH" })
    expect(launchRefusal(input({ onPath: () => false, settings: { ...agentSettings(undefined), command: ["/opt/bin/codex"] } }))).toEqual({ kind: "refused", message: "codex is not on your PATH" })
    expect(launchRefusal(input({ settings: { ...agentSettings(undefined), command: [] } }))).toEqual({ kind: "refused", message: "agent.command in config.json names no program" })
  })

  test("a workspace that does not exist is refused, named with ~", () => {
    expect(launchPlan(input({ workspaceExists: false }))).toEqual({ kind: "refused", message: "The workspace ~/dev/api does not exist" })
  })

  test("a long title is cut for the tab, and the status bar names the program", () => {
    expect(tabName("Register the sandbox as a service provider in Okta")).toBe("Register the sandbox as a ser…")
    expect(startedText(["/usr/local/bin/claude"])).toBe("Claude started in a new Herdr tab")
  })
})
