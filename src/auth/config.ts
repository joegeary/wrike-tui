export type Env = Record<string, string | undefined>

/** Wrike's data centers, in the order `auth login` tries them. */
export const HOSTS = ["www.wrike.com", "app-us2.wrike.com", "app-eu.wrike.com"] as const

const DEFAULT_MCP_URL = "https://mcp.wrike.com/v2"

export type Endpoints = { apiBase: string; mcpUrl: string }

const apiBase = (host: string) => `https://${host}/api/v4`

/** `WRIKE_BASE_URL` is a development override that replaces the whole API base, and may be plain http. */
export function candidateBases(env: Env): string[] {
  if (env.WRIKE_BASE_URL) return [env.WRIKE_BASE_URL]
  if (env.WRIKE_HOST) return [apiBase(env.WRIKE_HOST)]
  return HOSTS.map(apiBase)
}

export function endpointsFor(env: Env, host: string): Endpoints {
  return {
    apiBase: env.WRIKE_BASE_URL ?? apiBase(env.WRIKE_HOST ?? host),
    mcpUrl: env.WRIKE_MCP_URL ?? DEFAULT_MCP_URL,
  }
}

/** `WRIKE_TUI_READ_ONLY=1` makes the client refuse every write. */
export const isReadOnly = (env: Env) => env.WRIKE_TUI_READ_ONLY === "1"
