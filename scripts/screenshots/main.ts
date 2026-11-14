#!/usr/bin/env bun
/**
 * Rebuilds the README's pictures in docs/images: `bun run screenshots`, or
 * `bun run screenshots main palette` for some of them.
 *
 * Each picture starts the client from source in a detached tmux session on a
 * private socket, against the fake Wrike serving its showcase dataset. The
 * token is fake, and the config, state and cache homes are a scratch folder,
 * so nothing reaches a real Wrike account, the keyring or the user's files.
 * The client's clock is pinned, so the same picture comes out every time.
 * Needs tmux, unzip and Chromium (or Chrome), and draws without a window.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { TmuxSession } from "../../e2e/tmux"
import { SHOWCASE } from "../../test/fake/showcase"
import { createFakeWrike } from "../../test/fake/wrike"
import { THEMES } from "../../src/ui/theme"
import { drawPng, findBrowser, type Fonts } from "./draw"
import { ensureFonts } from "./fonts"
import { parseCapture, rowText, type Screen } from "./screen"

const ROOT = resolve(import.meta.dir, "../..")
const OUT = join(ROOT, "docs/images")
const SIZE = { width: 160, height: 45 }
/** A Thursday afternoon in New York, which every date on screen is counted from. */
const NOW = "2026-11-12T19:40:00Z"
const TODAY = "2026-11-12"
const TZ = "America/New_York"
const TOKEN = "fake-token"
const THEME = "dark"
const theme = THEMES[THEME]
const colorOf = (color: (typeof theme)["text"]) => {
  if (typeof color !== "string") throw new Error(`The ${THEME} theme must use hex colors for the pictures`)
  return color.toLowerCase()
}
const SELECTION = colorOf(theme.selection)

/** One running client, with what a scene needs to drive it. */
class Client {
  constructor(
    readonly tmux: TmuxSession,
    private readonly name: string,
  ) {}

  keys(...keys: string[]) {
    return this.tmux.keys(...keys)
  }

  type(text: string) {
    return this.tmux.type(text)
  }

  /** Waits until the screen settles with every expectation on it. */
  see(...expected: (string | RegExp)[]) {
    return this.tmux.see(this.name, ...expected)
  }

  async screen(): Promise<Screen> {
    return parseCapture(await this.tmux.styledScreen(), SIZE.width, SIZE.height)
  }

  /** The columns inside the pane whose title starts with `number`, read from the top border. */
  private async pane(number: 1 | 2 | 3): Promise<{ from: number; to: number }> {
    const top = rowText(await this.screen(), 0)
    const start = top.indexOf(`╭─ ${number} `)
    if (start < 0) throw new Error(`No pane ${number} on screen:\n${top}`)
    return { from: start + 1, to: top.indexOf("╮", start) }
  }

  /** The text of the selected row in a pane, found by the theme's selection color. */
  private async selected(columns: { from: number; to: number }): Promise<string | null> {
    const screen = await this.screen()
    for (let y = 1; y < screen.height; y++) {
      if (screen.rows[y]!.slice(columns.from, columns.to).some((cell) => cell.bg === SELECTION)) return rowText(screen, y, columns.from, columns.to)
    }
    return null
  }

  /** Moves down the pane with `j` until the selected row holds `text`. */
  async select(number: 1 | 2, text: string): Promise<void> {
    const columns = await this.pane(number)
    for (let step = 0; step < 40; step++) {
      const row = await this.selected(columns)
      if (row?.includes(text)) return
      await this.keys("j")
      const deadline = Date.now() + 2000
      while ((await this.selected(columns)) === row && Date.now() < deadline) await Bun.sleep(30)
    }
    throw new Error(`"${text}" never got selected in pane ${number}`)
  }
}

type Scene = {
  /** The PNG's name in docs/images. */
  name: string
  /** Whether the terminal cursor is drawn, for a picture of typing. */
  cursor?: boolean
  drive(client: Client): Promise<void>
}

async function openProject(client: Client): Promise<void> {
  await client.see("Dana Whitfield", "2 Inbox")
  await client.keys("1")
  await client.select(1, SHOWCASE.space)
  await client.keys("Space")
  await client.see(SHOWCASE.project)
  await client.select(1, SHOWCASE.project)
  await client.keys("Space", "Enter")
  await client.see("Dealer kit", `2 ${SHOWCASE.project}`, "▾ In Review")
  await client.keys("l")
}

async function openTask(client: Client, title: string, ...expected: (string | RegExp)[]): Promise<void> {
  await client.select(2, title)
  await client.keys("Enter")
  await client.see(new RegExp(`│ ${title} `), ...expected)
}

const SCENES: Scene[] = [
  {
    name: "main",
    async drive(client) {
      await openProject(client)
      await openTask(client, SHOWCASE.detailsTask, "Workstream", "Atlas Cargo")
    },
  },
  {
    name: "details",
    async drive(client) {
      await openProject(client)
      await openTask(client, SHOWCASE.detailsTask, "Workstream")
      await client.keys("v")
      await client.see("Effort (days)", "Atlas Cargo", /Comments \(3\)/)
    },
  },
  {
    name: "comments",
    cursor: true,
    async drive(client) {
      await openProject(client)
      await openTask(client, SHOWCASE.conversationTask, "Workstream")
      await client.keys("v", "c")
      await client.see("─ New comment ─")
      await client.type("Range is fixed in v3, thanks @mar")
      await client.see("─ Mention ─", "Marcus Lindqvist")
    },
  },
  {
    name: "palette",
    async drive(client) {
      await openProject(client)
      await openTask(client, SHOWCASE.detailsTask, "Workstream")
      await client.keys("2", ":")
      await client.see("─ Commands ─")
      await client.type("gro")
      await client.see("Subgroup by nothing")
    },
  },
  {
    name: "bulk",
    async drive(client) {
      await openProject(client)
      await openTask(client, SHOWCASE.detailsTask, "Workstream")
      await client.keys("2", "g")
      await client.select(2, "Order 40 demo bikes")
      await client.keys("M", "M", "M", "M", "M")
      await client.see("5 marked")
      await client.keys("A")
      await client.see("Assignees of 5 marked tasks", "on 2 of 5")
    },
  },
]

async function shoot(scene: Scene, fonts: Fonts, browser: string): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), `wrike-tui-screenshot-${scene.name}-`))
  const fake = createFakeWrike({ token: TOKEN, today: TODAY, now: NOW, dataset: "showcase" })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fake.handle })
  const origin = `http://127.0.0.1:${server.port}`
  const tmux = new TmuxSession(join(work, "tmux.sock"), join(work, "captures"))
  try {
    await mkdir(join(work, "config", "wrike-tui"), { recursive: true })
    await Bun.write(join(work, "config", "wrike-tui", "config.json"), JSON.stringify({ theme: THEME, lists: { project: { group: "status" } } }))
    await tmux.start(SIZE, {
      WRIKE_TOKEN: TOKEN,
      WRIKE_BASE_URL: `${origin}/api/v4`,
      WRIKE_MCP_URL: `${origin}/mcp`,
      WRIKE_TUI_KEYRING_SERVICE: "wrike-tui-screenshots",
      WRIKE_TUI_NO_RESTORE: "1",
      WRIKE_TUI_SCREENSHOT_NOW: NOW,
      XDG_CONFIG_HOME: join(work, "config"),
      XDG_STATE_HOME: join(work, "state"),
      XDG_CACHE_HOME: join(work, "cache"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      EDITOR: "false",
      BROWSER: "false",
      TZ,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    })
    await tmux.run(`exec ${process.execPath} --preload ${join(import.meta.dir, "clock.ts")} ${join(ROOT, "src/main.tsx")}`)
    const client = new Client(tmux, scene.name)
    await scene.drive(client)
    const screen = await client.screen()
    const cursor = await tmux.cursor()
    const out = join(OUT, `${scene.name}.png`)
    await drawPng(
      {
        screen,
        foreground: colorOf(theme.text),
        background: colorOf(theme.background),
        cursor: scene.cursor && cursor.visible ? { x: cursor.x, y: cursor.y, color: colorOf(theme.text) } : null,
        title: "wrike-tui",
      },
      fonts,
      out,
      browser,
    )
    console.log(`Wrote ${out}`)
  } finally {
    await tmux.kill()
    server.stop(true)
    await rm(work, { recursive: true, force: true })
  }
}

const wanted = process.argv.slice(2)
const unknown = wanted.filter((name) => !SCENES.some((scene) => scene.name === name))
if (unknown.length > 0) {
  console.error(`No picture named ${unknown.join(", ")}. The pictures are ${SCENES.map((scene) => scene.name).join(", ")}.`)
  process.exit(2)
}
const browser = findBrowser()
const fonts = await ensureFonts(join(ROOT, ".tools"))
await mkdir(OUT, { recursive: true })
for (const scene of SCENES.filter((candidate) => wanted.length === 0 || wanted.includes(candidate.name))) await shoot(scene, fonts, browser)
