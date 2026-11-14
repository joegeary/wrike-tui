import { describe, expect, test } from "bun:test"
import { appDirs } from "../../src/persist/dirs"

describe("appDirs", () => {
  test("on Linux and macOS the XDG defaults under the home folder", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(appDirs({}, platform, "/home/sam")).toEqual({
        config: "/home/sam/.config/wrike-tui",
        state: "/home/sam/.local/state/wrike-tui",
        cache: "/home/sam/.cache/wrike-tui",
      })
    }
  })

  test("on Linux and macOS the XDG variables move each folder", () => {
    const env = { XDG_CONFIG_HOME: "/x/config", XDG_STATE_HOME: "/x/state", XDG_CACHE_HOME: "/x/cache" }
    expect(appDirs(env, "darwin", "/Users/sam")).toEqual({ config: "/x/config/wrike-tui", state: "/x/state/wrike-tui", cache: "/x/cache/wrike-tui" })
  })

  test("an empty XDG variable is the same as an unset one", () => {
    expect(appDirs({ XDG_CONFIG_HOME: "" }, "linux", "/home/sam").config).toBe("/home/sam/.config/wrike-tui")
    expect(appDirs({ XDG_CONFIG_HOME: "" }, "win32", "C:\\Users\\sam").config).toBe("C:\\Users\\sam\\AppData\\Roaming\\wrike-tui")
  })

  test("on Windows the config roams under APPDATA, and the state and cache stay under LOCALAPPDATA", () => {
    const env = { APPDATA: "C:\\Users\\sam\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local" }
    expect(appDirs(env, "win32", "C:\\Users\\sam")).toEqual({
      config: "C:\\Users\\sam\\AppData\\Roaming\\wrike-tui",
      state: "C:\\Users\\sam\\AppData\\Local\\wrike-tui\\state",
      cache: "C:\\Users\\sam\\AppData\\Local\\wrike-tui\\cache",
    })
  })

  test("on Windows without APPDATA and LOCALAPPDATA the same folders under the home folder", () => {
    expect(appDirs({}, "win32", "C:\\Users\\sam")).toEqual({
      config: "C:\\Users\\sam\\AppData\\Roaming\\wrike-tui",
      state: "C:\\Users\\sam\\AppData\\Local\\wrike-tui\\state",
      cache: "C:\\Users\\sam\\AppData\\Local\\wrike-tui\\cache",
    })
  })

  test("on Windows the XDG variables still win", () => {
    const env = { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local", XDG_CONFIG_HOME: "D:\\xdg\\config", XDG_STATE_HOME: "D:\\xdg\\state", XDG_CACHE_HOME: "D:\\xdg\\cache" }
    expect(appDirs(env, "win32", "C:\\Users\\sam")).toEqual({ config: "D:\\xdg\\config\\wrike-tui", state: "D:\\xdg\\state\\wrike-tui", cache: "D:\\xdg\\cache\\wrike-tui" })
  })
})
