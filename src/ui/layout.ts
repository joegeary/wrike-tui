import type { Pane } from "../app/state"

export const NAV_WIDTH = 22
export const NARROW_BELOW = 100
export const MIN_WIDTH = 60
export const MIN_HEIGHT = 12

export type PaneWidths = Record<Pane, number>

/**
 * Column widths per pane, 0 for a hidden one. Under 100 columns the nav pane
 * shows only while it has the focus, and then it takes the details pane's place.
 */
export function paneWidths(width: number, focus: Pane, zoom: boolean): PaneWidths {
  const narrow = width < NARROW_BELOW
  const nav = !narrow || focus === "nav" ? NAV_WIDTH : 0
  if (zoom) return { nav, list: 0, details: width - nav }
  if (narrow && focus === "nav") return { nav, list: width - nav, details: 0 }
  const details = Math.floor(width / 2)
  return { nav, list: width - nav - details, details }
}

/**
 * The first row to draw so the cursor row stays visible, moving as little as
 * possible from the previous first row. Rows may be more than one line tall.
 */
export function windowStart(heights: number[], cursorRow: number, available: number, previous: number): number {
  let start = Math.max(0, Math.min(previous, cursorRow, heights.length - 1))
  const span = (from: number) => heights.slice(from, cursorRow + 1).reduce((sum, height) => sum + height, 0)
  while (start < cursorRow && span(start) > available) start += 1
  return start
}

/** How many rows fit from `start`. */
export function windowCount(heights: number[], start: number, available: number): number {
  let used = 0
  let count = 0
  for (const height of heights.slice(start)) {
    if (used + height > available) break
    used += height
    count += 1
  }
  return count
}
