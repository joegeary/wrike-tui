import type { ScrollTo } from "../app/state"

type Scroller = (to: ScrollTo) => void

/** Lets effects reach renderables that exist only once React has mounted them. */
export type UiBridge = { scrollers: Partial<Record<"details" | "help", Scroller>> }

export const createBridge = (): UiBridge => ({ scrollers: {} })
