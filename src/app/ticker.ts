import { countingDown } from "./selectors"
import type { Clock } from "./state"
import type { Store } from "./store"

/**
 * Keeps the reducer's clock moving while an edit window counts down on
 * screen: once as soon as a countdown starts, then every `everyMs`. The rest
 * of the time the clock is the time of the last load, as before.
 */
export function keepClock(store: Store, read: () => Clock, everyMs = 1000): () => void {
  let counting = false
  const check = () => {
    const now = countingDown(store.getState())
    const started = now && !counting
    counting = now
    if (started) store.dispatch({ type: "clock", clock: read() })
  }
  const unsubscribe = store.subscribe(check)
  const timer = setInterval(() => counting && store.dispatch({ type: "clock", clock: read() }), everyMs)
  check()
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}
