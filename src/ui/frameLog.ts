import { appendFileSync } from "node:fs"

/**
 * `WRIKE_TUI_FRAME_LOG=<file>` appends one line per key press: the key, a tab,
 * and the milliseconds from the key event to the next composed frame. It is
 * how the list's key latency is measured on a real terminal.
 */
export type FrameLog = { key(name: string): void; frame(): void }

export function createFrameLog(path: string, now: () => number = () => performance.now()): FrameLog {
  let pending: { name: string; at: number } | null = null
  return {
    key(name) {
      // A key that arrives before the last one was drawn keeps the earlier time, so a backlog shows as latency.
      pending ??= { name, at: now() }
    },
    frame() {
      if (!pending) return
      appendFileSync(path, `${pending.name}\t${(now() - pending.at).toFixed(2)}\n`)
      pending = null
    },
  }
}
