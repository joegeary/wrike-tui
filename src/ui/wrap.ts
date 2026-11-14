/** Text in one style. */
export type Run<S> = { text: string; style: S }

type Cell<S> = { text: string; style: S; width: number }

/** Characters a long word may break after, the way a URL breaks at its slashes. */
const BREAK_AFTER = new Set(["/", "-", "?", "&", "=", "_", "."])
/** Punctuation that closes what comes before it, which no line may start with. */
const CLOSING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"', "’", "”", "…", "%"])

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" })

function cells<S>(runs: Run<S>[]): Cell<S>[] {
  return runs.flatMap((run) => Array.from(graphemes.segment(run.text), ({ segment }) => ({ text: segment, style: run.style, width: Bun.stringWidth(segment) })))
}

const widthOf = <S>(line: Cell<S>[]) => line.reduce((sum, cell) => sum + cell.width, 0)

/** Joins neighboring cells of one style back into runs. */
function runsOf<S>(line: Cell<S>[]): Run<S>[] {
  const runs: Run<S>[] = []
  for (const cell of line) {
    const last = runs.at(-1)
    if (last && last.style === cell.style) last.text += cell.text
    else runs.push({ text: cell.text, style: cell.style })
  }
  return runs
}

/**
 * Where to cut a word too wide for `room`: after a slash or a hyphen when one
 * fits, otherwise at the last column that fits. A cut never leaves closing
 * punctuation to start the next line, so "(url)." keeps its period.
 */
function cutAt<S>(word: Cell<S>[], room: number): number {
  let fits = 0
  for (let used = 0; fits < word.length && used + word[fits]!.width <= room; fits++) used += word[fits]!.width
  const strands = (at: number) => word.slice(at).every((cell) => CLOSING.has(cell.text)) || CLOSING.has(word[at]!.text)
  for (let at = fits; at > 0; at--) if (BREAK_AFTER.has(word[at - 1]!.text) && !strands(at)) return at
  for (let at = fits; at > 0; at--) if (!strands(at)) return at
  return Math.max(1, fits)
}

/**
 * Wraps styled text to `width` columns at spaces, keeping every word whole
 * when it fits on a line of its own. Punctuation stays on the word it closes,
 * so a line never starts with a lone period or parenthesis. A line break in
 * the text is kept. A width of zero or less leaves the text unwrapped.
 */
export function wrapRuns<S>(runs: Run<S>[], width: number): Run<S>[][] {
  const lines: Cell<S>[][] = []
  const all = cells(runs)
  const hardLines: Cell<S>[][] = [[]]
  for (const cell of all) {
    if (cell.text === "\n" || cell.text === "\r\n") hardLines.push([])
    else hardLines.at(-1)!.push(cell)
  }
  for (const hard of hardLines) {
    if (width <= 0) {
      lines.push(hard)
      continue
    }
    // Words and the spaces before them. Spaces that start the line are kept, as indentation.
    const words: { gap: Cell<S>[]; word: Cell<S>[] }[] = []
    let gap: Cell<S>[] = []
    let word: Cell<S>[] = []
    for (const cell of hard) {
      if (cell.text === " ") {
        if (word.length > 0) {
          words.push({ gap, word })
          gap = []
          word = []
        }
        gap.push(cell)
      } else word.push(cell)
    }
    if (word.length > 0 || words.length === 0) words.push({ gap, word })

    let line: Cell<S>[] = []
    const room = () => width - widthOf(line)
    for (const [index, { gap, word }] of words.entries()) {
      if (index === 0) line.push(...gap)
      else if (widthOf(gap) + widthOf(word) <= room()) line.push(...gap)
      else if (widthOf(word) <= width || widthOf(gap) >= room()) {
        lines.push(line)
        line = []
      } else line.push(...gap)
      // Only a word wider than a whole line is cut, and it fills the line it starts on.
      let rest = word
      while (widthOf(rest) > room()) {
        if (room() <= 0) {
          lines.push(line)
          line = []
          continue
        }
        const at = cutAt(rest, room())
        line.push(...rest.slice(0, at))
        lines.push(line)
        line = []
        rest = rest.slice(at)
      }
      line.push(...rest)
    }
    lines.push(line)
  }
  return lines.map(runsOf)
}
