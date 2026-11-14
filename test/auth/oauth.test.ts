import { expect, test } from "bun:test"
import { authorizeUrl } from "../../src/auth/oauth"

test("the browser is sent to Wrike asking for the scopes the REST API and the MCP server need, with a PKCE challenge", () => {
  const url = new URL(authorizeUrl("client-1", "http://localhost:8765/callback", "state-1", "challenge-1"))
  expect(`${url.origin}${url.pathname}`).toBe("https://login.wrike.com/oauth2/authorize/v4")
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: "client-1",
    response_type: "code",
    redirect_uri: "http://localhost:8765/callback",
    state: "state-1",
    scope: "Default,wsReadWrite",
    code_challenge: "challenge-1",
    code_challenge_method: "S256",
  })
})
