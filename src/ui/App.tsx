import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useSyncExternalStore } from "react"
import { normalizeKey, resolveKey } from "../app/keymap"
import type { Store } from "../app/store"
import type { UiBridge } from "./bridge"
import { DetailsPane } from "./DetailsPane"
import { Help } from "./Help"
import { MIN_HEIGHT, MIN_WIDTH, paneWidths } from "./layout"
import { ListPane } from "./ListPane"
import { NavPane } from "./NavPane"
import { Palette } from "./Palette"
import { Picker } from "./Picker"
import { RequestForm } from "./RequestForm"
import { StatusBar } from "./StatusBar"
import { ThemeProvider, THEMES } from "./theme"

export function App({ store, bridge }: { store: Store; bridge: UiBridge }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const screen = useTerminalDimensions()
  const onDraft = useCallback((text: string) => store.dispatch({ type: "draft", text }), [store])
  const theme = THEMES[state.settings.theme]

  useKeyboard((event) => {
    const key = normalizeKey(event)
    if (!key) return
    // A key the keymap gives meaning to is not also typed into the focused field, so Enter posts a comment and does not start a line.
    if (resolveKey(store.getState(), key)) event.preventDefault()
    store.dispatch({ type: "key", key })
  })

  if (screen.width < MIN_WIDTH || screen.height < MIN_HEIGHT) {
    return (
      <box width="100%" height="100%" backgroundColor={theme.background}>
        <text fg={theme.warning} wrapMode="word">{`wrike-tui needs at least ${MIN_WIDTH} columns and ${MIN_HEIGHT} rows. Press q to quit.`}</text>
      </box>
    )
  }

  const widths = paneWidths(screen.width, state.focus, state.zoom, state.settings.navWidth)
  const { mode } = state
  return (
    <ThemeProvider value={theme}>
      <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background}>
        <box flexDirection="row" flexGrow={1} flexShrink={1}>
          {widths.nav > 0 ? <NavPane state={state} width={widths.nav} height={screen.height - 1} /> : null}
          {widths.list > 0 ? <ListPane state={state} width={widths.list} height={screen.height - 1} onDraft={onDraft} /> : null}
          {widths.details > 0 ? <DetailsPane state={state} width={widths.details} bridge={bridge} onDraft={onDraft} /> : null}
        </box>
        <StatusBar state={state} width={screen.width} />
        {mode.kind === "picker" ? <Picker state={state} mode={mode} screen={screen} /> : null}
        {mode.kind === "palette" ? <Palette state={state} mode={mode} screen={screen} /> : null}
        {mode.kind === "help" ? <Help state={state} screen={screen} bridge={bridge} /> : null}
        {mode.kind === "form" ? <RequestForm state={state} mode={mode} screen={screen} onDraft={onDraft} /> : null}
      </box>
    </ThemeProvider>
  )
}
