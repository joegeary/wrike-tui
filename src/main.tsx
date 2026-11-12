#!/usr/bin/env bun
import { keyringStore } from "./auth/token"
import { run } from "./cli/run"
import { readSecret } from "./cli/secret"
import { launch } from "./ui/launch"

const code = await run(process.argv.slice(2), {
  env: process.env,
  tokens: keyringStore(process.env),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readSecret,
  launch: (session) => launch(session, process.env),
})
process.exit(code)
