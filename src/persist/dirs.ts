import { homedir } from "node:os"
import { posix, win32 } from "node:path"
import type { Env } from "../auth/config"

/** The folders wrike-tui keeps its files in. Each one already ends in `wrike-tui`. */
export type AppDirs = { config: string; state: string; cache: string }

/**
 * The XDG variables win on every platform. Without them Linux and macOS use
 * the XDG defaults under the home folder, and Windows keeps the config in the
 * roaming `%APPDATA%` and the state and cache in the machine's `%LOCALAPPDATA%`.
 */
export function appDirs(env: Env, platform: NodeJS.Platform = process.platform, home: string = homedir()): AppDirs {
  if (platform === "win32") {
    const { join } = win32
    const roaming = env.APPDATA || join(home, "AppData", "Roaming")
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local")
    return {
      config: env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "wrike-tui") : join(roaming, "wrike-tui"),
      state: env.XDG_STATE_HOME ? join(env.XDG_STATE_HOME, "wrike-tui") : join(local, "wrike-tui", "state"),
      cache: env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, "wrike-tui") : join(local, "wrike-tui", "cache"),
    }
  }
  const { join } = posix
  return {
    config: join(env.XDG_CONFIG_HOME || join(home, ".config"), "wrike-tui"),
    state: join(env.XDG_STATE_HOME || join(home, ".local", "state"), "wrike-tui"),
    cache: join(env.XDG_CACHE_HOME || join(home, ".cache"), "wrike-tui"),
  }
}
