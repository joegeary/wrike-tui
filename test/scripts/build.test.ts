import { expect, test } from "bun:test"

const ID = "id-value-only-in-this-test"
const SECRET = "secret-value-only-in-this-test"

/** Runs the build script with its own copy of the environment, minus the shared app's variables. */
function build(extra: Record<string, string>) {
  const { WRIKE_OAUTH_CLIENT_ID: _, WRIKE_OAUTH_CLIENT_SECRET: __, ...env } = process.env
  return Bun.spawnSync([process.execPath, "scripts/build.ts"], { cwd: `${import.meta.dir}/../..`, env: { ...env, ...extra } })
}

test.each([
  ["WRIKE_OAUTH_CLIENT_ID", { WRIKE_OAUTH_CLIENT_ID: ID }, "WRIKE_OAUTH_CLIENT_SECRET"],
  ["WRIKE_OAUTH_CLIENT_SECRET", { WRIKE_OAUTH_CLIENT_SECRET: SECRET }, "WRIKE_OAUTH_CLIENT_ID"],
])("a build with only %s fails before compiling, names what is missing and prints no value", (_, extra, missing) => {
  const result = build(extra)
  const said = `${result.stdout}${result.stderr}`
  expect(result.exitCode).not.toBe(0)
  expect(said).toStartWith(`${missing} is not set.`)
  expect(said).not.toContain(ID)
  expect(said).not.toContain(SECRET)
})

test("a release build without the shared app fails before compiling", () => {
  const result = build({ WRIKE_TUI_REQUIRE_SHARED_APP: "1" })
  expect(result.exitCode).not.toBe(0)
  expect(`${result.stderr}`).toStartWith("A release build needs WRIKE_OAUTH_CLIENT_ID and WRIKE_OAUTH_CLIENT_SECRET.")
})
