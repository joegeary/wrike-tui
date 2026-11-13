import { expect, test } from "bun:test"
import { fileKind } from "../../src/ui/format"

test("a file's kind comes from its known type, an image's subtype or its extension, never an Object property", () => {
  const upload = (contentType: string | null, name = "notes") => fileKind({ name, storage: "Wrike", contentType })
  expect(upload("application/pdf")).toBe("PDF")
  expect(upload("image/png")).toBe("PNG image")
  expect(upload("application/octet-stream", "trace.har")).toBe("HAR file")
  expect(upload("constructor")).toBe("file")
  expect(upload("toString", "a.log")).toBe("LOG file")
  expect(fileKind({ name: "Plan", storage: "Google", contentType: null })).toBe("Google")
})
