/**
 * Preloaded into the client for screenshots: `Date` starts at
 * WRIKE_TUI_SCREENSHOT_NOW and runs on from there, so "35m" and due days read
 * the same on every run. Timers are left alone.
 */
const start = process.env.WRIKE_TUI_SCREENSHOT_NOW
if (start) {
  const RealDate = Date
  const offset = RealDate.parse(start) - RealDate.now()
  if (Number.isNaN(offset)) throw new Error(`WRIKE_TUI_SCREENSHOT_NOW is not a time: ${start}`)
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...(args as [string]))
    }
    static override now() {
      return RealDate.now() + offset
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor
}
