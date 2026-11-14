import { buildKeymap } from "../app/keymap"
import type { Env } from "../auth/config"
import { oauthProvider } from "../auth/oauth"
import { deleteProfile, readProfile, writeProfile } from "../auth/profile"
import { loadSession, oauthHost, probe, type Session } from "../auth/session"
import { resolveToken, type TokenStore } from "../auth/token"
import { createPersistence, persistencePaths } from "../persist/persistence"
import { VERSION } from "../version"
import { describeError, toWrikeError } from "../wrike/errors"
import type { Fetch } from "../wrike/transport"
import { keyLines } from "./keys"
import { oauthLogin, storedApp, type OAuthIo } from "./oauth"
import { update } from "./update"

export type Io = {
  env: Env
  tokens: TokenStore
  out(line: string): void
  err(line: string): void
  readSecret(prompt: string): Promise<string | null>
  launch(session: Session): Promise<void>
  fetch?: Fetch
  /** What OAuth needs. Without it `auth login --oauth` is refused and an OAuth login cannot renew itself. */
  oauth?: OAuthIo
}

const USAGE = `wrike-tui ${VERSION}
A keyboard-first terminal client for Wrike.

Usage:
  wrike-tui                     Open the client
  wrike-tui auth login          Ask which way to log in, then log in
  wrike-tui auth login --token  Store a Wrike permanent access token in the OS keyring
  wrike-tui auth login --oauth  Sign in through the browser with an app from Wrike's App Console
  wrike-tui auth status         Show who is logged in and where the token comes from
  wrike-tui auth logout         Remove the stored login, client secret and profile
  wrike-tui keys                List every command with its keys, as config.json sets them
  wrike-tui update              Replace this binary with the newest release
                                (--check only says whether one is out)
  wrike-tui --version

Environment:
  WRIKE_TOKEN   Use this token instead of the keyring
  WRIKE_HOST    Use this Wrike host instead of the stored one

Get a token in Wrike: profile icon, Apps & Integrations, API tab.
For --oauth, register an app in Wrike's App Console; docs/install.md says how.
Press ? inside the client for the keys.`

const NOT_LOGGED_IN = "Not logged in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, sub, ...rest] = argv
  if (command === undefined) return open(io)
  if (command === "--help" || command === "-h" || command === "help") return io.out(USAGE), 0
  if (command === "--version" || command === "-v") return io.out(`wrike-tui ${VERSION}`), 0
  if (command === "update" && rest.length === 0 && (sub === undefined || sub === "--check")) {
    return update(sub === "--check", io)
  }
  if (command === "auth" && sub === "login" && rest.length <= 1) {
    const way = rest[0] === "--token" ? "token" : rest[0] === "--oauth" ? "oauth" : rest[0] === undefined ? await pickLogin(io) : undefined
    if (way === "token") return login(io)
    if (way === "oauth") return io.oauth ? oauthLogin(io, io.oauth) : (io.err("OAuth login is not available here."), 1)
    if (way === null) return io.err("No way to log in picked. Nothing was stored."), 1
  }
  if (command === "auth" && rest.length === 0) {
    if (sub === "status") return status(io)
    if (sub === "logout") return logout(io)
  }
  if (command === "keys" && sub === undefined) return keys(io)
  io.err(`Unknown command: ${argv.join(" ")}\n\n${USAGE}`)
  return 2
}

async function open(io: Io): Promise<number> {
  try {
    const session = await loadSession(io.env, io.tokens, io.fetch, () => storedApp(io))
    if (!session) return io.err(NOT_LOGGED_IN), 1
    await io.launch(session)
    return 0
  } catch (thrown) {
    io.err(describeError(toWrikeError(thrown)))
    return 1
  }
}

const LOGIN_MENU = `How do you want to log in?
  1. A permanent access token (Wrike: profile icon, Apps & Integrations, API tab)
  2. OAuth through the browser (needs an app from Wrike's App Console)`

/** Asks at a terminal. Piped input has no one to ask, so it reads a token as before. */
async function pickLogin(io: Io): Promise<"token" | "oauth" | null> {
  if (!io.oauth?.interactive) return "token"
  io.out(LOGIN_MENU)
  for (;;) {
    const answer = await io.oauth.readLine("Pick 1 or 2: ")
    if (answer === null) return null
    if (answer === "1") return "token"
    if (answer === "2") return "oauth"
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
  // Asking an OAuth login for its token renews it first when it ran out.
  const provider = token.kind === "oauth" ? oauthProvider({ login: token.login, store: io.tokens, app: () => storedApp(io), fetch: io.fetch }) : null
  try {
    const current = provider ? await provider.current() : token.token
    const profile = await probe(current, oauthHost(io.env, token), io.fetch)
    if (!provider) io.out(`Logged in as ${profile.name} on ${profile.host}. The token comes from ${source}.`)
    else io.out(`Logged in as ${profile.name} on ${profile.host} with OAuth. The access token expires ${when(provider.login().expiresAt)} and renews itself.`)
    return 0
  } catch (thrown) {
    const stored = token.source === "keyring" ? await readProfile(io.env) : null
    const who = stored ? ` for ${stored.name}` : ""
    const what = provider ? "The OAuth login" : "The token"
    io.err(`${what}${who} from ${source} did not work. ${describeError(toWrikeError(thrown))}`)
    return 1
  }
}

const when = (iso: string) => `at ${new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`

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
  await io.oauth?.clientSecret.delete()
  await deleteProfile(io.env)
  io.out("Logged out. The stored login and profile are removed.")
  if (io.env.WRIKE_TOKEN) io.out("WRIKE_TOKEN is still set in this environment and still works.")
  return 0
}
