import type { EffectDeps } from "../app/effects"

/** Lets effects reach renderables that exist only once React has mounted them. */
export type UiBridge = { scrollDetails: EffectDeps["scrollDetails"] }

export const createBridge = (): UiBridge => ({ scrollDetails: () => {} })
