export type WrikeError =
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "read_only" }
  | { kind: "invalid"; message: string }
  | { kind: "network"; message: string }
  | { kind: "server"; status: number; message: string }
  /** Wrike's MCP server said in plain text that it failed and to retry later. */
  | { kind: "unavailable"; message: string }

/** The one exception the wire layer throws. Callers above it read `error`. */
export class WrikeFailure extends Error {
  constructor(readonly error: WrikeError) {
    super(describeError(error))
    this.name = "WrikeFailure"
  }
}

export function toWrikeError(thrown: unknown): WrikeError {
  if (thrown instanceof WrikeFailure) return thrown.error
  return { kind: "network", message: thrown instanceof Error ? thrown.message : String(thrown) }
}

export function describeError(error: WrikeError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Wrike rejected the token. Run `wrike-tui auth login`."
    case "not_found":
      return "Wrike could not find that item."
    case "rate_limited":
      return "Wrike is rate limiting requests. Wait a moment and retry."
    case "read_only":
      return "read-only mode: not saved"
    case "invalid":
      return error.message
    case "network":
      return `Could not reach Wrike: ${error.message}`
    case "server":
      return `Wrike failed with ${error.status}: ${error.message}`
    case "unavailable":
      return `Wrike could not answer: ${error.message}`
  }
}

/** The error as a full sentence, followed by how to try again. */
export function retryText(error: WrikeError, retry: string): string {
  return `${describeError(error).replace(/\.$/, "")}. ${retry}`
}
