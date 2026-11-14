import type { OAuthApp } from "./oauth"

// A release build defines both from the repository's secrets. Any other build defines neither and has no shared app.
declare const WRIKE_OAUTH_CLIENT_ID: string | undefined
declare const WRIKE_OAUTH_CLIENT_SECRET: string | undefined

/** The Wrike app built into release builds, whose redirect URI is `SHARED_REDIRECT`. */
export const SHARED_APP: OAuthApp | null =
  typeof WRIKE_OAUTH_CLIENT_ID === "string" && typeof WRIKE_OAUTH_CLIENT_SECRET === "string"
    ? { clientId: WRIKE_OAUTH_CLIENT_ID, clientSecret: WRIKE_OAUTH_CLIENT_SECRET }
    : null

/** The one redirect URI registered for the shared app. `oauth.port` and `oauth.redirectUri` in config.json do not apply to it. */
export const SHARED_REDIRECT = { uri: "http://127.0.0.1:8765/callback", port: 8765 } as const
