import { detailsItems, sameItem } from "../selectors"
import type { State, Update } from "../state"
import { clamp, info } from "./core"

/** Steps the selection through the details items. With nothing selected, `]` starts at the first and `[` at the last. */
export function selectItem(state: State, by: 1 | -1): Update {
  if (state.details.state !== "ready") return [state, []]
  const items = detailsItems(state.details.value)
  if (items.length === 0) return [{ ...state, flash: info("This task has no comments yet") }, []]
  const at = items.findIndex((item) => sameItem(item, state.selected))
  const next = at < 0 ? (by === 1 ? 0 : items.length - 1) : clamp(at + by, items.length)
  return [{ ...state, selected: items[next]! }, []]
}
