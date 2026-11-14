/** One terminal cell as `tmux capture-pane -e` describes it. A color is `#rrggbb`, or null for the terminal's default. */
export type Cell = {
  text: string
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  inverse: boolean
  /** The right half of a wide character, drawn by the cell before it. */
  spacer: boolean
}

export type Screen = { width: number; height: number; rows: Cell[][] }

type Style = Omit<Cell, "text" | "spacer">

const PLAIN: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false }

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`

/** The 16 base colors xterm uses, for the rare indexed color. */
const BASE = ["#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5", "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"]

function indexed(n: number): string {
  if (n < 16) return BASE[n]!
  if (n < 232) {
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    const i = n - 16
    return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6))
  }
  const gray = 8 + (n - 232) * 10
  return hex(gray, gray, gray)
}

/** Applies one SGR sequence's parameters to `style`. */
function applySgr(style: Style, params: string): Style {
  const next = { ...style }
  const codes = params === "" ? [0] : params.split(";").map((part) => Number(part.split(":")[0]))
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) Object.assign(next, PLAIN)
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 7) next.inverse = true
    else if (code === 9) next.strike = true
    else if (code === 22) next.bold = next.dim = false
    else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 27) next.inverse = false
    else if (code === 29) next.strike = false
    else if (code === 39) next.fg = null
    else if (code === 49) next.bg = null
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) next.fg = indexed(code >= 90 ? code - 82 : code - 30)
    else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) next.bg = indexed(code >= 100 ? code - 92 : code - 40)
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg"
      if (codes[i + 1] === 5) {
        next[key] = indexed(codes[i + 2]!)
        i += 2
      } else if (codes[i + 1] === 2) {
        next[key] = hex(codes[i + 2]!, codes[i + 3]!, codes[i + 4]!)
        i += 4
      }
    }
  }
  return next
}

const blank = (style: Style): Cell => ({ text: " ", ...style, spacer: false })

/**
 * Reads `capture-pane -p -e` output into a grid. tmux carries the style from
 * one line to the next, so the text is read as one stream. A wide character
 * takes two cells and tmux writes nothing for its right half.
 */
export function parseCapture(capture: string, width: number, height: number): Screen {
  const rows: Cell[][] = []
  let style = PLAIN
  const lines = capture.replace(/\n$/, "").split("\n")
  for (const line of lines.slice(0, height)) {
    const row: Cell[] = []
    // OSC sequences, such as hyperlinks, carry nothing to draw.
    const clean = line.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    const tokens = clean.matchAll(/\x1b\[([0-9;:]*)m|\x1b\[[0-9;?]*[A-Za-z]|([^\x1b])/gsu)
    for (const token of tokens) {
      if (token[1] !== undefined) {
        style = applySgr(style, token[1])
        continue
      }
      const char = token[2]
      if (char === undefined) continue
      const columns = Bun.stringWidth(char)
      if (columns === 0) {
        const last = row.at(-1)
        if (last) last.text += char
        continue
      }
      row.push({ text: char, ...style, spacer: false })
      if (columns === 2) row.push({ ...blank(style), text: "", spacer: true })
    }
    while (row.length < width) row.push(blank(style))
    rows.push(row.slice(0, width))
  }
  while (rows.length < height) rows.push(Array.from({ length: width }, () => blank(PLAIN)))
  return { width, height, rows }
}

/** The plain text of a row's cells from `from` to `to`, for finding things on screen. */
export const rowText = (screen: Screen, row: number, from = 0, to = screen.width) =>
  screen.rows[row]!.slice(from, to).map((cell) => cell.text).join("")
