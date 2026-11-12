import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { copyText, editInEditor, editorCommand, openInBrowser } from "../../src/ui/handoff"

let scripts: string

async function script(name: string, body: string): Promise<string> {
  const path = join(scripts, name)
  await Bun.write(path, `#!/usr/bin/env zsh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

function renderer() {
  const calls: string[] = []
  return { calls, suspend: async () => void calls.push("suspend"), resume: async () => void calls.push("resume") }
}

beforeAll(async () => {
  scripts = await mkdtemp(join(tmpdir(), "wrike-tui-handoff-"))
})
afterAll(() => rm(scripts, { recursive: true, force: true }))

describe("editInEditor", () => {
  test("suspends the renderer, runs the editor on the text, resumes, and returns the edit", async () => {
    const editor = await script("append", 'print -r -- "added line" >> "$1"\nprint -r -- "${1:e}" > "$0.extension"')
    const screen = renderer()
    expect(await editInEditor(screen, { EDITOR: editor }, "first line", "md")).toBe("first line\nadded line")
    expect(screen.calls).toEqual(["suspend", "resume"])
    expect((await Bun.file(`${editor}.extension`).text()).trim()).toBe("md")
  })

  test("an unchanged file is a cancel", async () => {
    const editor = await script("noop", "true")
    expect(await editInEditor(renderer(), { EDITOR: editor }, "same\n", "txt")).toBeNull()
    expect(await editInEditor(renderer(), { EDITOR: editor }, "", "txt")).toBeNull()
  })

  test("an editor that exits with an error is a cancel, even if it wrote", async () => {
    const editor = await script("abort", 'print -r -- "junk" >> "$1"\nexit 1')
    const screen = renderer()
    expect(await editInEditor(screen, { EDITOR: editor }, "keep", "md")).toBeNull()
    expect(screen.calls).toEqual(["suspend", "resume"])
  })

  test("a missing editor fails, and the renderer still resumes", async () => {
    const screen = renderer()
    await expect(editInEditor(screen, { EDITOR: join(scripts, "no-such-editor") }, "text", "md")).rejects.toThrow()
    expect(screen.calls).toEqual(["suspend", "resume"])
  })

  test("the temp file is removed afterwards", async () => {
    const editor = await script("where", 'print -r -- "${1:h}" > "$0.directory"')
    await editInEditor(renderer(), { EDITOR: editor }, "text", "md")
    const directory = (await Bun.file(`${editor}.directory`).text()).trim()
    await expect(readdir(directory)).rejects.toThrow()
  })

  test("VISUAL wins over EDITOR, arguments are kept, and vi is the fallback", () => {
    expect(editorCommand({ VISUAL: "code --wait", EDITOR: "nano" })).toEqual(["code", "--wait"])
    expect(editorCommand({ EDITOR: "nano" })).toEqual(["nano"])
    expect(editorCommand({})).toEqual(["vi"])
  })
})

test("openInBrowser runs $BROWSER with the URL and does not wait for it", async () => {
  const browser = await script("browser", 'print -r -- "$1" > "$0.url"')
  await openInBrowser({ BROWSER: browser }, "https://www.wrike.com/open.htm?id=4598459101")
  for (let attempt = 0; attempt < 100 && !(await Bun.file(`${browser}.url`).exists()); attempt++) await Bun.sleep(10)
  expect((await Bun.file(`${browser}.url`).text()).trim()).toBe("https://www.wrike.com/open.htm?id=4598459101")
})

describe("copyText", () => {
  test("outside tmux the renderer writes the OSC 52 sequence and reports whether it could", () => {
    const copied: string[] = []
    const written: string[] = []
    const terminal = { copyToClipboardOSC52: (text: string) => (copied.push(text), false) }
    expect(copyText(terminal, {}, "4598459101", (sequence) => void written.push(sequence))).toBe(false)
    expect(copied).toEqual(["4598459101"])
    expect(written).toEqual([])
  })

  test("inside tmux a plain OSC 52 sequence is written, which tmux reads itself", () => {
    const written: string[] = []
    const terminal = { copyToClipboardOSC52: () => true }
    expect(copyText(terminal, { TMUX: "/tmp/tmux-1000/default,1,0" }, "héllo", (sequence) => void written.push(sequence))).toBe(true)
    expect(written).toEqual(["\x1b]52;c;aMOpbGxv\x07"])
  })
})
