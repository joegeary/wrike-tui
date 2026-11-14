import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Screen } from "./screen"

export type Fonts = { regular: string; bold: string; italic: string; boldItalic: string }

export type Frame = {
  screen: Screen
  /** The colors a cell without its own falls back to. */
  foreground: string
  background: string
  /** Where the terminal's cursor stands, drawn as a bar. Null hides it. */
  cursor: { x: number; y: number; color: string } | null
  title: string
}

/** Cell size in CSS pixels. JetBrains Mono advances 0.6 em, so 15 px gives whole-pixel cells. */
const FONT_SIZE = 15
const CELL = { width: 9, height: 19 }
const PADDING = 14
const TITLE_BAR = 30
/** Room around the window. None, since a soft shadow does not survive the palette the PNG is reduced to. */
const MARGIN = 0
const SCALE = 2

/** The page's size in CSS pixels. */
export function pageSize(screen: Screen) {
  return {
    width: screen.width * CELL.width + 2 * PADDING + 2 * MARGIN,
    height: screen.height * CELL.height + 2 * PADDING + TITLE_BAR + 2 * MARGIN,
  }
}

/**
 * The page draws the grid on a canvas: backgrounds first, then each glyph in
 * its cell, so columns never drift. Box drawing, block elements and the check
 * boxes are drawn as shapes, so lines meet across cells the way a terminal
 * draws them.
 */
function pageScript() {
  type Data = { frame: Frame; cell: { width: number; height: number }; fontSize: number; padding: number; titleBar: number; margin: number }
  const data = (globalThis as unknown as { DATA: Data }).DATA
  const { frame, cell, fontSize, padding, titleBar, margin } = data
  const { screen } = frame
  const canvas = document.querySelector("canvas")!
  const scale = window.devicePixelRatio
  const width = screen.width * cell.width + 2 * padding + 2 * margin
  const height = screen.height * cell.height + 2 * padding + titleBar + 2 * margin
  canvas.width = width * scale
  canvas.height = height * scale
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext("2d")!
  ctx.scale(scale, scale)

  const radius = 10
  const windowWidth = width - 2 * margin
  const windowHeight = height - 2 * margin
  ctx.beginPath()
  ctx.roundRect(margin, margin, windowWidth, windowHeight, radius)
  ctx.fillStyle = frame.background
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(margin, margin, windowWidth, windowHeight, radius)
  ctx.clip()
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)"
  ctx.fillRect(margin, margin, windowWidth, titleBar)
  ;["#f38ba8", "#f9e2af", "#a6e3a1"].forEach((color, index) => {
    ctx.beginPath()
    ctx.arc(margin + 20 + index * 20, margin + titleBar / 2, 6, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })
  ctx.font = `500 13px "Mono", monospace`
  ctx.fillStyle = "rgba(205, 214, 244, 0.6)"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(frame.title, margin + windowWidth / 2, margin + titleBar / 2 + 1)
  ctx.restore()
  // A faint edge inside the window, so it stands apart from a dark page too.
  ctx.beginPath()
  ctx.roundRect(margin + 0.5, margin + 0.5, windowWidth - 1, windowHeight - 1, radius - 0.5)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
  ctx.lineWidth = 1
  ctx.stroke()

  const left = margin + padding
  const top = margin + titleBar + padding
  const fontOf = (bold: boolean, italic: boolean) => `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontSize}px "Mono", monospace`
  ctx.font = fontOf(false, false)
  const metrics = ctx.measureText("M")
  const ascent = metrics.fontBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent
  const baseline = Math.round((cell.height - (ascent + descent)) / 2 + ascent)

  const colors = (c: (typeof screen.rows)[number][number]) => {
    let fg = c.fg ?? frame.foreground
    let bg = c.bg ?? frame.background
    if (c.inverse) [fg, bg] = [bg, fg]
    return { fg, bg }
  }

  for (let y = 0; y < screen.height; y++) {
    const row = screen.rows[y]!
    for (let x = 0; x < screen.width; ) {
      const { bg } = colors(row[x]!)
      let end = x + 1
      while (end < screen.width && colors(row[end]!).bg === bg) end++
      if (bg !== frame.background) {
        ctx.fillStyle = bg
        ctx.fillRect(left + x * cell.width, top + y * cell.height, (end - x) * cell.width, cell.height)
      }
      x = end
    }
  }

  /** Line weights toward up, right, down and left: 1 light, 2 heavy. */
  const LINES: Record<string, [number, number, number, number]> = {
    "─": [0, 1, 0, 1], "│": [1, 0, 1, 0], "━": [0, 2, 0, 2], "┃": [2, 0, 2, 0],
    "┌": [0, 1, 1, 0], "┐": [0, 0, 1, 1], "└": [1, 1, 0, 0], "┘": [1, 0, 0, 1],
    "┏": [0, 2, 2, 0], "┓": [0, 0, 2, 2], "┗": [2, 2, 0, 0], "┛": [2, 0, 0, 2],
    "├": [1, 1, 1, 0], "┤": [1, 0, 1, 1], "┬": [0, 1, 1, 1], "┴": [1, 1, 0, 1], "┼": [1, 1, 1, 1],
    "┣": [2, 2, 2, 0], "┫": [2, 0, 2, 2], "┳": [0, 2, 2, 2], "┻": [2, 2, 0, 2], "╋": [2, 2, 2, 2],
    "╴": [0, 0, 0, 1], "╵": [1, 0, 0, 0], "╶": [0, 1, 0, 0], "╷": [0, 0, 1, 0],
  }
  const ROUND: Record<string, [number, number]> = { "╭": [1, 1], "╮": [-1, 1], "╰": [1, -1], "╯": [-1, -1] }

  /** Draws a shape for the character and answers true, or answers false to leave it to the font. */
  const shape = (text: string, x0: number, y0: number, fg: string): boolean => {
    const w = cell.width
    const h = cell.height
    const cx = x0 + w / 2
    const cy = y0 + h / 2
    const light = 1
    const heavy = 2
    const lines = LINES[text]
    if (lines) {
      ctx.fillStyle = fg
      const [up, right, down, leftward] = lines
      const thick = (weight: number) => (weight === 2 ? heavy : light)
      const across = Math.max(up, down) === 2 ? heavy : light
      const along = Math.max(leftward, right) === 2 ? heavy : light
      if (leftward) ctx.fillRect(x0, cy - thick(leftward) / 2, w / 2 + across / 2, thick(leftward))
      if (right) ctx.fillRect(cx - across / 2, cy - thick(right) / 2, w / 2 + across / 2, thick(right))
      if (up) ctx.fillRect(cx - thick(up) / 2, y0, thick(up), h / 2 + along / 2)
      if (down) ctx.fillRect(cx - thick(down) / 2, cy - along / 2, thick(down), h / 2 + along / 2)
      return true
    }
    const round = ROUND[text]
    if (round) {
      const [dx, dy] = round
      const r = w / 2
      ctx.strokeStyle = fg
      ctx.lineWidth = light
      ctx.beginPath()
      ctx.moveTo(cx, dy > 0 ? y0 + h : y0)
      ctx.arcTo(cx, cy, cx + dx * r, cy, r)
      ctx.lineTo(dx > 0 ? x0 + w : x0, cy)
      ctx.stroke()
      return true
    }
    const code = text.codePointAt(0)!
    ctx.fillStyle = fg
    if (code === 0x2588) return ctx.fillRect(x0, y0, w, h), true
    if (code >= 0x2589 && code <= 0x258f) return ctx.fillRect(x0, y0, Math.max(1, Math.round((w * (0x2590 - code)) / 8)), h), true
    if (code >= 0x2581 && code <= 0x2587) {
      const part = Math.round((h * (code - 0x2580)) / 8)
      return ctx.fillRect(x0, y0 + h - part, w, part), true
    }
    if (code === 0x2580) return ctx.fillRect(x0, y0, w, Math.round(h / 2)), true
    if (code === 0x2590) return ctx.fillRect(x0 + Math.round(w / 2), y0, w - Math.round(w / 2), h), true
    if (code === 0x2610 || code === 0x2611) {
      const side = w - 1
      const bx = x0 + 0.5
      const by = cy - side / 2
      ctx.strokeStyle = fg
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(bx + 0.5, by + 0.5, side - 1, side - 1, 1.5)
      ctx.stroke()
      if (code === 0x2611) {
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(bx + side * 0.24, by + side * 0.52)
        ctx.lineTo(bx + side * 0.43, by + side * 0.72)
        ctx.lineTo(bx + side * 0.78, by + side * 0.3)
        ctx.stroke()
      }
      return true
    }
    if (code === 0x2605) {
      ctx.beginPath()
      for (let point = 0; point < 10; point++) {
        const angle = -Math.PI / 2 + (point * Math.PI) / 5
        const reach = point % 2 === 0 ? w * 0.5 : w * 0.21
        ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach)
      }
      ctx.closePath()
      ctx.fill()
      return true
    }
    return false
  }

  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  for (let y = 0; y < screen.height; y++) {
    for (let x = 0; x < screen.width; x++) {
      const c = screen.rows[y]![x]!
      if (c.spacer || c.text === " " || c.text === "") continue
      const x0 = left + x * cell.width
      const y0 = top + y * cell.height
      let { fg } = colors(c)
      ctx.globalAlpha = c.dim ? 0.6 : 1
      if (!shape(c.text, x0, y0, fg)) {
        ctx.font = fontOf(c.bold, c.italic)
        ctx.fillStyle = fg
        ctx.fillText(c.text, x0, y0 + baseline)
      }
      if (c.underline) ctx.fillRect(x0, y0 + baseline + 2, cell.width, 1)
      if (c.strike) ctx.fillRect(x0, y0 + Math.round(cell.height / 2), cell.width, 1)
    }
  }
  ctx.globalAlpha = 1
  if (frame.cursor) {
    ctx.fillStyle = frame.cursor.color
    ctx.fillRect(left + frame.cursor.x * cell.width, top + frame.cursor.y * cell.height + 2, 2, cell.height - 4)
  }
  document.title = "drawn"
}

async function dataUrl(path: string): Promise<string> {
  return `data:font/ttf;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`
}

async function page(frame: Frame, fonts: Fonts): Promise<string> {
  const face = async (path: string, weight: string, style: string) =>
    `@font-face { font-family: "Mono"; src: url(${await dataUrl(path)}) format("truetype"); font-weight: ${weight}; font-style: ${style}; }`
  const faces = await Promise.all([face(fonts.regular, "normal", "normal"), face(fonts.bold, "bold", "normal"), face(fonts.italic, "normal", "italic"), face(fonts.boldItalic, "bold", "italic")])
  const data = { frame, cell: CELL, fontSize: FONT_SIZE, padding: PADDING, titleBar: TITLE_BAR, margin: MARGIN }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces.join("\n")}
html, body { margin: 0; background: transparent; overflow: hidden; } canvas { display: block; }</style></head>
<body><canvas></canvas><script>
globalThis.DATA = ${JSON.stringify(data)};
Promise.all(["normal", "bold", "italic", "italic bold"].map((style) => document.fonts.load(style + " ${FONT_SIZE}px Mono", "Mw─▸"))).then(() => (${pageScript.toString()})());
</script></body></html>`
}

/**
 * Reduces the PNG to a 256-color palette, which a terminal's few colors and
 * their antialiased edges fit without a visible change, at about a third of
 * the size. Without ImageMagick the full-color PNG is kept.
 */
async function shrink(drawn: string, out: string): Promise<void> {
  const magick = Bun.which("magick")
  if (!magick) {
    console.warn("ImageMagick is not installed, so the PNG is kept at full color.")
    await Bun.write(out, Bun.file(drawn))
    return
  }
  const run = Bun.spawnSync([magick, drawn, "-strip", "-dither", "None", "-colors", "256", "-define", "png:compression-level=9", `PNG8:${out}`], { stderr: "pipe" })
  if (run.exitCode !== 0) throw new Error(`magick could not reduce the picture: ${run.stderr.toString()}`)
}

const BROWSERS = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome"]

export function findBrowser(): string {
  const found = [process.env.WRIKE_TUI_SCREENSHOT_BROWSER, ...BROWSERS].flatMap((name) => (name ? [Bun.which(name)] : [])).find((path) => path)
  if (!found) throw new Error(`No headless browser found. Install Chromium, or set WRIKE_TUI_SCREENSHOT_BROWSER to one of ${BROWSERS.join(", ")}.`)
  return found
}

/**
 * Draws the frame to a PNG with headless Chromium. It never opens a window,
 * and its profile, cache and home stay in a scratch folder that is removed.
 */
export async function drawPng(frame: Frame, fonts: Fonts, out: string, browser: string): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "wrike-tui-draw-"))
  try {
    const html = join(work, "frame.html")
    await Bun.write(html, await page(frame, fonts))
    const size = pageSize(frame.screen)
    const env = { PATH: process.env.PATH ?? "", HOME: work, XDG_CONFIG_HOME: work, XDG_CACHE_HOME: work, XDG_DATA_HOME: work, TZ: "UTC" }
    const run = Bun.spawn(
      [
        browser,
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--hide-scrollbars",
        "--mute-audio",
        `--user-data-dir=${join(work, "profile")}`,
        `--force-device-scale-factor=${SCALE}`,
        "--default-background-color=00000000",
        `--window-size=${size.width},${size.height}`,
        "--virtual-time-budget=10000",
        `--screenshot=${join(work, "drawn.png")}`,
        `file://${html}`,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    )
    const drawn = join(work, "drawn.png")
    const [stderr, code] = await Promise.all([new Response(run.stderr).text(), run.exited])
    if (code !== 0 || !(await Bun.file(drawn).exists())) throw new Error(`${browser} did not write the picture:\n${stderr}`)
    await shrink(drawn, out)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
