import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Fonts } from "./draw"

/**
 * JetBrains Mono from its official release, so the pictures do not depend on
 * the fonts this machine has. JetBrains publishes no checksum for the asset,
 * so its SHA-256 is pinned here and checked before anything is unpacked.
 */
const RELEASE = {
  url: "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip",
  sha256: "6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf",
}
const FILES = { regular: "JetBrainsMono-Regular.ttf", bold: "JetBrainsMono-Bold.ttf", italic: "JetBrainsMono-Italic.ttf", boldItalic: "JetBrainsMono-BoldItalic.ttf" } as const

/** The four faces, downloaded into `tools` on the first run. */
export async function ensureFonts(tools: string): Promise<Fonts> {
  const folder = join(tools, "jetbrains-mono-2.304")
  const fonts = Object.fromEntries(Object.entries(FILES).map(([face, file]) => [face, join(folder, file)])) as Fonts
  const present = await Promise.all(Object.values(fonts).map((path) => Bun.file(path).exists()))
  if (present.every(Boolean)) return fonts

  await mkdir(folder, { recursive: true })
  console.log(`Downloading JetBrains Mono into ${folder}`)
  const response = await fetch(RELEASE.url)
  if (!response.ok) throw new Error(`Downloading ${RELEASE.url} answered ${response.status}`)
  const zip = new Uint8Array(await response.arrayBuffer())
  const sha256 = new Bun.CryptoHasher("sha256").update(zip).digest("hex")
  if (sha256 !== RELEASE.sha256) throw new Error(`${RELEASE.url} has SHA-256 ${sha256}, not the pinned ${RELEASE.sha256}. Nothing was unpacked.`)
  const archive = join(folder, "release.zip")
  await Bun.write(archive, zip)
  try {
    const unzip = Bun.spawnSync(["unzip", "-o", "-q", "-j", archive, ...Object.values(FILES).map((file) => `fonts/ttf/${file}`), "-d", folder], { stderr: "pipe" })
    if (unzip.exitCode !== 0) throw new Error(`unzip failed: ${unzip.stderr.toString()}`)
  } finally {
    await rm(archive, { force: true })
  }
  return fonts
}
