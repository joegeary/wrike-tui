// Compiles dist/wrike-tui. The release workflow sets WRIKE_TUI_VERSION to the tag's version; a local build
// leaves it unset and carries "<package.json version>-dev", which `wrike-tui update` refuses to replace.
import pkg from "../package.json"

const release = process.env.WRIKE_TUI_VERSION
if (release !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(release)) {
  console.error(`WRIKE_TUI_VERSION must look like 1.2.3, not ${JSON.stringify(release)}`)
  process.exit(2)
}
const version = release ?? `${pkg.version}-dev`

const build = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "--compile",
    "--define",
    'process.env.NODE_ENV="production"',
    "--define",
    `WRIKE_TUI_VERSION=${JSON.stringify(version)}`,
    "src/main.tsx",
    "--outfile",
    "dist/wrike-tui",
  ],
  { cwd: `${import.meta.dir}/..`, stdio: ["inherit", "inherit", "inherit"] },
)
process.exit(build.exitCode ?? 1)
