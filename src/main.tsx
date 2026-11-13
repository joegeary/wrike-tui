#!/usr/bin/env bun
import { clientSecretStore, keyringStore } from "./auth/token"
import { run } from "./cli/run"
import { readLine, readSecret } from "./cli/secret"
import { openInBrowser } from "./ui/handoff"
import { launch } from "./ui/launch"

const code = await run(process.argv.slice(2), {
  env: process.env,
  tokens: keyringStore(process.env),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readSecret,
  launch: (session) => launch(session, process.env),
  oauth: {
    clientSecret: clientSecretStore(process.env),
    readLine,
    openUrl: (url) => openInBrowser(process.env, url),
    interactive: process.stdin.isTTY === true,
  },
})
process.exit(code)
