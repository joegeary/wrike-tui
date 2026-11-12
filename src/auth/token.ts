import type { Env } from "./config"

export type TokenStore = {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  delete(): Promise<void>
}

/** `WRIKE_TUI_KEYRING_SERVICE` namespaces the keyring entry so tests never touch the real one. */
export function keyringStore(env: Env): TokenStore {
  const entry = { service: env.WRIKE_TUI_KEYRING_SERVICE || "wrike-tui", name: "token" }
  return {
    get: () => Bun.secrets.get(entry),
    set: (token) => Bun.secrets.set({ ...entry, value: token }),
    delete: async () => void (await Bun.secrets.delete(entry)),
  }
}

export type ResolvedToken = { token: string; source: "env" | "keyring" }

export async function resolveToken(env: Env, store: TokenStore): Promise<ResolvedToken | null> {
  if (env.WRIKE_TOKEN) return { token: env.WRIKE_TOKEN, source: "env" }
  const stored = await store.get()
  return stored ? { token: stored, source: "keyring" } : null
}
