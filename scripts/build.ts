// Compiles dist/wrike-tui, or dist/wrike-tui.exe on Windows. The release workflow sets WRIKE_TUI_VERSION to the tag's version; a local build
// leaves it unset and carries "<package.json version>-dev", which `wrike-tui update` refuses to replace.
// The release workflow also sets WRIKE_OAUTH_CLIENT_ID and WRIKE_OAUTH_CLIENT_SECRET, which build the shared Wrike app in.
// A build without them has no shared app. Their values are never printed.
import pkg from "../package.json"

const release = process.env.WRIKE_TUI_VERSION
if (release !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(release)) {
  console.error(`WRIKE_TUI_VERSION must look like 1.2.3, not ${JSON.stringify(release)}`)
  process.exit(2)
}
const version = release ?? `${pkg.version}-dev`

const clientId = process.env.WRIKE_OAUTH_CLIENT_ID || undefined
const clientSecret = process.env.WRIKE_OAUTH_CLIENT_SECRET || undefined
if ((clientId === undefined) !== (clientSecret === undefined)) {
  const missing = clientId === undefined ? "WRIKE_OAUTH_CLIENT_ID" : "WRIKE_OAUTH_CLIENT_SECRET"
  console.error(`${missing} is not set. Set both WRIKE_OAUTH_CLIENT_ID and WRIKE_OAUTH_CLIENT_SECRET to build in the shared Wrike app, or neither.`)
  process.exit(2)
}
if (process.env.WRIKE_TUI_REQUIRE_SHARED_APP === "1" && clientId === undefined) {
  console.error("A release build needs WRIKE_OAUTH_CLIENT_ID and WRIKE_OAUTH_CLIENT_SECRET. Check the repository's Actions secrets.")
  process.exit(2)
}
const sharedApp =
  clientId !== undefined && clientSecret !== undefined
    ? ["--define", `WRIKE_OAUTH_CLIENT_ID=${JSON.stringify(clientId)}`, "--define", `WRIKE_OAUTH_CLIENT_SECRET=${JSON.stringify(clientSecret)}`]
    : []

const build = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "--compile",
    "--define",
    'process.env.NODE_ENV="production"',
    "--define",
    `WRIKE_TUI_VERSION=${JSON.stringify(version)}`,
    ...sharedApp,
    "src/main.tsx",
    "--outfile",
    process.platform === "win32" ? "dist/wrike-tui.exe" : "dist/wrike-tui",
  ],
  { cwd: `${import.meta.dir}/..`, stdio: ["inherit", "inherit", "inherit"] },
)
process.exit(build.exitCode ?? 1)
