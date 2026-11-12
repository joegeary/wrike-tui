#!/usr/bin/env bun
import { keyringStore } from "./auth/token"
import { run } from "./cli/run"
import { readSecret } from "./cli/secret"

const code = await run(process.argv.slice(2), {
  env: process.env,
  tokens: keyringStore(process.env),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readSecret,
  launch: async () => {
    console.error("The client is not built yet.")
  },
})
process.exit(code)
