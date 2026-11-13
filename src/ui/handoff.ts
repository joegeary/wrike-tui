import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Env } from "../auth/config"

/** The part of the renderer that gives the terminal away and takes it back. */
export type Suspendable = { suspend(): unknown; resume(): unknown }

const words = (command: string) => command.trim().split(/\s+/)

export function editorCommand(env: Env): string[] {
  return words(env.VISUAL || env.EDITOR || "vi")
}

/**
 * Opens `initial` in the user's editor on a temp file while the renderer is
 * suspended. Resolves to the edited text, or null when the file came back
 * unchanged or the editor exited with an error, which is how editors abort.
 */
export async function editInEditor(
  renderer: Suspendable,
  env: Env,
  initial: string,
  extension: "md" | "html" | "txt",
): Promise<string | null> {
  const directory = await mkdtemp(join(tmpdir(), "wrike-tui-"))
  const path = join(directory, `wrike.${extension}`)
  const written = initial === "" ? "" : `${initial.replace(/\n+$/, "")}\n`
  try {
    await Bun.write(path, written)
    await renderer.suspend()
    let exitCode: number
    try {
      const editor = Bun.spawn([...editorCommand(env), path], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
      exitCode = await editor.exited
    } finally {
      await renderer.resume()
    }
    if (exitCode !== 0) return null
    const edited = await Bun.file(path).text()
    return edited === written ? null : edited.replace(/\n+$/, "")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * The command that takes a URL as its last argument. Windows has no opener
 * that takes one as a plain argument: `cmd /c start` would split a signed
 * link at its `&`, so there it must be named in BROWSER.
 */
function browserCommand(env: Env, platform: NodeJS.Platform): string[] {
  if (env.BROWSER) return words(env.BROWSER)
  if (platform === "darwin") return ["open"]
  if (platform === "win32") throw new Error("Set BROWSER to a program that opens a URL given as its argument")
  return ["xdg-open"]
}

/** Starts the browser and does not wait for it, because a browser may run until its window closes. */
export async function openInBrowser(env: Env, url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  Bun.spawn([...browserCommand(env, platform), url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
}

/** The part of the renderer that writes to the terminal clipboard. */
export type ClipboardWriter = { copyToClipboardOSC52(text: string): boolean }

/**
 * Copies with OSC 52. Inside tmux the sequence is written plain, which tmux
 * handles itself. OpenTUI would wrap it in a tmux passthrough, and tmux drops
 * a passthrough unless `allow-passthrough` is on, while still reporting success.
 */
export function copyText(
  renderer: ClipboardWriter,
  env: Env,
  text: string,
  write: (sequence: string) => void = (sequence) => void process.stdout.write(sequence),
): boolean {
  if (!env.TMUX) return renderer.copyToClipboardOSC52(text)
  write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`)
  return true
}
