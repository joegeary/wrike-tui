import pkg from "../package.json"

// A release build defines WRIKE_TUI_VERSION as the tag's version. Anything else is a local build.
declare const WRIKE_TUI_VERSION: string | undefined

export const VERSION: string = typeof WRIKE_TUI_VERSION === "string" ? WRIKE_TUI_VERSION : `${pkg.version}-dev`
export const isLocalBuild = VERSION.endsWith("-dev")
