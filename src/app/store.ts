import { runEffect, type EffectDeps } from "./effects"
import { reduce, start } from "./reducer"
import type { Action, Effect, State } from "./state"

export type Store = {
  getState(): State
  subscribe(listener: () => void): () => void
  dispatch(action: Action): void
  /** Resolves when no effect is running. For tests. */
  idle(): Promise<void>
}

/** Holds the state, applies the reducer and runs the effects it returns. */
export function createStore(initial: State, deps: EffectDeps): Store {
  let state = initial
  const listeners = new Set<() => void>()
  const running = new Set<Promise<void>>()

  function commit(next: State, effects: Effect[]) {
    if (next !== state) {
      state = next
      for (const listener of listeners) listener()
    }
    for (const effect of effects) {
      const work = runEffect(effect, deps, dispatch).finally(() => running.delete(work))
      running.add(work)
    }
  }

  function dispatch(action: Action) {
    commit(...reduce(state, action))
  }

  commit(...start(state))

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
    async idle() {
      while (running.size > 0) await Promise.all(running)
    },
  }
}
