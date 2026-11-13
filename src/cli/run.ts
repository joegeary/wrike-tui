import pkg from "../../package.json"
import { buildKeymap } from "../app/keymap"
import type { Env } from "../auth/config"
import { deleteProfile, readProfile, writeProfile } from "../auth/profile"
import { loadSession, probe, type Session } from "../auth/session"
import { resolveToken, type TokenStore } from "../auth/token"
import { createPersistence, persistencePaths } from "../persist/persistence"
import { describeError, toWrikeError } from "../wrike/errors"
import type { Fetch } from "../wrike/transport"
import { keyLines } from "./keys"

export type Io = {
  env: Env
  tokens: TokenStore
  out(line: string): void
  err(line: string): void
  readSecret(prompt: string): Promise<string | null>
  launch(session: Session): Promise<void>
  fetch?: Fetch
}

const USAGE = `wrike-tui ${pkg.version}
A keyboard-first terminal client for Wrike.

Usage:
  wrike-tui               Open the client
  wrike-tui auth login    Store a Wrike permanent access token in the OS keyring
  wrike-tui auth status   Show who is logged in and where the token comes from
  wrike-tui auth logout   Remove the stored token and profile
  wrike-tui keys          List every command with its keys, as config.json sets them
  wrike-tui --version

Environment:
  WRIKE_TOKEN   Use this token instead of the keyring
  WRIKE_HOST    Use this Wrike host instead of the stored one

Get a token in Wrike: profile icon, Apps & Integrations, API tab.
Press ? inside the client for the keys.`

const NOT_LOGGED_IN = "Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, sub, ...rest] = argv
  if (command === undefined) return open(io)
  if (command === "--help" || command === "-h" || command === "help") return io.out(USAGE), 0
  if (command === "--version" || command === "-v") return io.out(`wrike-tui ${pkg.version}`), 0
  if (command === "auth" && rest.length === 0) {
    if (sub === "login") return login(io)
    if (sub === "status") return status(io)
    if (sub === "logout") return logout(io)
  }
  if (command === "keys" && sub === undefined) return keys(io)
  io.err(`Unknown command: ${argv.join(" ")}\n\n${USAGE}`)
  return 2
}

async function open(io: Io): Promise<number> {
  try {
    const session = await loadSession(io.env, io.tokens, io.fetch)
    if (!session) return io.err(NOT_LOGGED_IN), 1
    await io.launch(session)
    return 0
  } catch (thrown) {
    io.err(describeError(toWrikeError(thrown)))
    return 1
  }
}

async function login(io: Io): Promise<number> {
  const token = await io.readSecret("Wrike access token: ")
  if (!token) return io.err("No token entered. Nothing was stored."), 1
  try {
    const profile = await probe(token, io.env, io.fetch)
    await io.tokens.set(token)
    await writeProfile(io.env, profile)
    io.out(`Logged in as ${profile.name} on ${profile.host}. The token is in the OS keyring.`)
    return 0
  } catch (thrown) {
    const error = toWrikeError(thrown)
    io.err(error.kind === "unauthorized" ? "No Wrike data center accepted that token. Nothing was stored." : describeError(error))
    return 1
  }
}

async function status(io: Io): Promise<number> {
  const token = await resolveToken(io.env, io.tokens)
  if (!token) return io.err(NOT_LOGGED_IN), 1
  const source = token.source === "env" ? "WRIKE_TOKEN" : "the OS keyring"
  try {
    const profile = await probe(token.token, io.env, io.fetch)
    io.out(`Logged in as ${profile.name} on ${profile.host}. The token comes from ${source}.`)
    return 0
  } catch (thrown) {
    const stored = token.source === "keyring" ? await readProfile(io.env) : null
    const who = stored ? ` for ${stored.name}` : ""
    io.err(`The token${who} from ${source} did not work. ${describeError(toWrikeError(thrown))}`)
    return 1
  }
}

/** Reads the config the way a launch does, so a file that does not parse is moved aside here too. */
async function keys(io: Io): Promise<number> {
  // The config is shared by every account, so its path needs none.
  const paths = persistencePaths(io.env, "")
  const { value: settings, movedAside } = await createPersistence(paths).loadConfig()
  if (movedAside) io.err(`Could not read ${paths.config}. Kept as ${movedAside}, using the defaults.`)
  const built = buildKeymap(settings.keys)
  for (const line of keyLines(built)) io.out(line)
  io.out("")
  io.out(`* changed by the keys in ${paths.config}`)
  for (const problem of built.problems) io.err(`Ignored: ${problem}`)
  return built.problems.length > 0 ? 1 : 0
}

async function logout(io: Io): Promise<number> {
  await io.tokens.delete()
  await deleteProfile(io.env)
  io.out("Logged out. The stored token and profile are removed.")
  if (io.env.WRIKE_TOKEN) io.out("WRIKE_TOKEN is still set in this environment and still works.")
  return 0
}
