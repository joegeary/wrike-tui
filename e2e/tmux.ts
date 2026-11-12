import { mkdir } from "node:fs/promises"
import { join } from "node:path"

// The tmux server hands its environment to the shell, and a real WRIKE_TOKEN or WRIKE_HOST must never reach the binary under test.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("WRIKE")))

/**
 * One detached tmux session on a private server socket, so the run never
 * touches the user's own tmux and never opens a window.
 */
export class TmuxSession {
  private count = 0

  /** `socket` is a path for the private tmux server's socket. */
  constructor(
    private readonly socket: string,
    private readonly captures: string,
  ) {}

  private async tmux(...args: string[]): Promise<string> {
    const run = Bun.spawn(["tmux", "-S", this.socket, "-f", "/dev/null", ...args], { stdout: "pipe", stderr: "pipe", env: CLEAN_ENV })
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
    if (code !== 0) throw new Error(`tmux ${args.join(" ")} failed: ${err}`)
    return out
  }

  async start(size: { width: number; height: number }, env: Record<string, string>): Promise<void> {
    await mkdir(this.captures, { recursive: true })
    const variables = Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`])
    await this.tmux("new-session", "-d", "-s", "main", "-x", String(size.width), "-y", String(size.height), ...variables, "zsh", "-f")
    // Lets `tmux show-buffer` read what the app copies with OSC 52.
    await this.tmux("set-option", "-s", "set-clipboard", "on")
    await this.run("PROMPT='$ '; clear")
  }

  /** Sends named keys such as `Enter`, `Escape`, `C-e`, or single characters. */
  async keys(...keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.tmux("send-keys", "-t", "main", key)
      await Bun.sleep(40)
    }
  }

  async type(text: string): Promise<void> {
    await this.tmux("send-keys", "-t", "main", "-l", text)
    await Bun.sleep(40)
  }

  async run(command: string): Promise<void> {
    await this.type(command)
    await this.keys("Enter")
  }

  async resize(width: number, height: number): Promise<void> {
    await this.tmux("resize-window", "-t", "main", "-x", String(width), "-y", String(height))
  }

  async screen(): Promise<string> {
    return this.tmux("capture-pane", "-p", "-t", "main")
  }

  /** The screen with its color escape sequences, for checks on highlighting. */
  styledScreen(): Promise<string> {
    return this.tmux("capture-pane", "-p", "-e", "-t", "main")
  }

  clipboard(): Promise<string> {
    return this.tmux("show-buffer")
  }

  /** Waits for a screen that satisfies every expectation, saves it under `name`, and returns it. */
  async see(name: string, ...expected: (string | RegExp)[]): Promise<string> {
    const deadline = Date.now() + 10_000
    let screen = ""
    let settled = ""
    while (Date.now() < deadline) {
      screen = await this.screen()
      const matches = expected.every((want) => (typeof want === "string" ? screen.includes(want) : want.test(screen)))
      // Two identical captures in a row, so a half-drawn frame is never saved.
      if (matches && screen === settled) return this.save(name, screen)
      settled = screen
      await Bun.sleep(80)
    }
    await this.save(`FAILED-${name}`, screen)
    throw new Error(`"${name}" never showed ${expected.map(String).join(" and ")}. Last screen:\n${screen}`)
  }

  private async save(name: string, screen: string): Promise<string> {
    this.count += 1
    await Bun.write(join(this.captures, `${String(this.count).padStart(2, "0")}-${name}.txt`), screen)
    return screen
  }

  async kill(): Promise<void> {
    await this.tmux("kill-server").catch(() => {})
  }
}
