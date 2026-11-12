import type { ScrollBoxRenderable } from "@opentui/core"
import type { ScrollTo } from "../app/state"

const SCROLL_STEP = 3

export function scrollBox(box: ScrollBoxRenderable | null, to: ScrollTo): void {
  if (!box) return
  if (to === "top") box.scrollTo(0)
  else if (to === "bottom") box.scrollTo(box.scrollHeight)
  else box.scrollBy(to === "down" ? SCROLL_STEP : -SCROLL_STEP)
}
