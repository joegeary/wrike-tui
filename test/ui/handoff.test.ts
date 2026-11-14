import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { browserCommand, copyText, editInEditor, editorCommand } from "../../src/ui/handoff"

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

  test("an editor that only strips trailing whitespace on save is a cancel", async () => {
    const editor = await script("trim", 'sed -i -E "s/[[:space:]]+$//" "$1"')
    expect(await editInEditor(renderer(), { EDITOR: editor }, "```\ncode  \n```\nline\t", "md")).toBeNull()
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
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(editorCommand({ VISUAL: "code --wait", EDITOR: "nano" }, platform)).toEqual(["code", "--wait"])
      expect(editorCommand({ EDITOR: "nano" }, platform)).toEqual(["nano"])
    }
    expect(editorCommand({}, "linux")).toEqual(["vi"])
    expect(editorCommand({}, "darwin")).toEqual(["vi"])
  })

  test("on Windows without VISUAL and EDITOR, Microsoft Edit when it is on PATH, and Notepad when it is not", () => {
    expect(editorCommand({}, "win32", (command) => command === "edit")).toEqual(["edit"])
    expect(editorCommand({}, "win32", () => false)).toEqual(["notepad"])
  })
})

describe("browserCommand", () => {
  test("BROWSER wins on every platform, with its arguments", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) expect(browserCommand({ BROWSER: "firefox --new-tab" }, platform)).toEqual(["firefox", "--new-tab"])
  })

  test("without BROWSER, xdg-open on Linux, open on macOS, and the URL handler on Windows, which takes the link as one argument", () => {
    expect(browserCommand({}, "linux")).toEqual(["xdg-open"])
    expect(browserCommand({}, "darwin")).toEqual(["open"])
    expect(browserCommand({}, "win32")).toEqual(["rundll32", "url.dll,FileProtocolHandler"])
  })
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
})
