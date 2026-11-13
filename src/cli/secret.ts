import { createInterface } from "node:readline"

const CTRL_C = 0x03
const CTRL_D = 0x04
const BACKSPACE = [0x08, 0x7f]

/** Reads one line without echoing it. Piped input is read as is, so scripts can feed the token. */
export async function readSecret(prompt: string): Promise<string | null> {
  process.stderr.write(prompt)
  const stdin = process.stdin
  if (!stdin.isTTY) {
    const text = await Bun.stdin.text()
    return text.split("\n")[0]?.trim() || null
  }

  stdin.setRawMode(true)
  stdin.resume()
  try {
    return await new Promise<string | null>((resolve) => {
      let typed = ""
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === CTRL_C || byte === CTRL_D) return finish(null)
          if (byte === 0x0d || byte === 0x0a) return finish(typed.trim() || null)
          if (BACKSPACE.includes(byte)) typed = typed.slice(0, -1)
          else if (byte >= 0x20) typed += String.fromCharCode(byte)
        }
      }
      const finish = (value: string | null) => {
        stdin.off("data", onData)
        resolve(value)
      }
      stdin.on("data", onData)
    })
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
    process.stderr.write("\n")
  }
}

/** Reads one line with echo on. Null when it is empty, on Ctrl-C, at the end of input, or when `signal` aborts. */
export function readLine(prompt: string, signal?: AbortSignal): Promise<string | null> {
  const lines = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      signal?.removeEventListener("abort", onAbort)
      lines.close()
      resolve(value)
    }
    const onAbort = () => {
      process.stderr.write("\n")
      finish(null)
    }
    if (signal?.aborted) return finish(null)
    signal?.addEventListener("abort", onAbort)
    lines.on("SIGINT", () => finish(null))
    lines.on("close", () => finish(null))
    lines.question(prompt, (answer) => finish(answer.trim() || null))
  })
}
