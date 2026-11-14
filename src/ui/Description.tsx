import { createTextAttributes, StyledText, type BoxRenderable, type SyntaxStyle, type TextChunk, type TextRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { displayBlocks } from "../domain/description"
import { wrapRuns, type Run } from "./wrap"

/** The inline tokens of a paragraph, as much of marked's shape as is drawn. */
type Inline = { type: string; raw: string; text?: string; href?: string; tokens?: Inline[] }
type Look = Omit<TextChunk, "__isChunk" | "text">

/** The longest link the terminal is handed as a hyperlink, as OpenTUI's markdown counts it. */
const MAX_LINK_BYTES = 512

/**
 * A paragraph's text in the markdown style's groups, drawn the way OpenTUI's
 * markdown draws it: markers hidden, and a link's address after its label
 * unless the terminal takes hyperlinks.
 */
function inlineRuns(tokens: Inline[], style: SyntaxStyle, hyperlinks: boolean): Run<Look>[] {
  const looks = new Map<string, Look>()
  const look = (group: string, url?: string): Look => {
    const key = `${group} ${url ?? ""}`
    let found = looks.get(key)
    if (!found) {
      const definition = style.getStyle(group) ?? style.getStyle("default")
      found = {
        fg: definition?.fg,
        bg: definition?.bg,
        attributes: createTextAttributes({ bold: definition?.bold, italic: definition?.italic, underline: definition?.underline, dim: definition?.dim }),
        ...(url ? { link: { url } } : {}),
      }
      looks.set(key, found)
    }
    return found
  }
  const runs: Run<Look>[] = []
  const walk = (inline: Inline[], group: string, url?: string) => {
    for (const token of inline) {
      switch (token.type) {
        case "strong":
          walk(token.tokens ?? [], "markup.strong", url)
          break
        case "em":
          walk(token.tokens ?? [], "markup.italic", url)
          break
        case "del":
          walk(token.tokens ?? [], "markup.strikethrough", url)
          break
        case "codespan":
          runs.push({ text: token.text ?? "", style: look("markup.raw", url) })
          break
        case "br":
          runs.push({ text: "\n", style: look("default") })
          break
        case "link": {
          const href = token.href ?? ""
          walk(token.tokens ?? [], "markup.link.label", href)
          const linked = hyperlinks && new TextEncoder().encode(href).byteLength <= MAX_LINK_BYTES
          const bare = token.text === href || token.raw === token.text || token.raw === `<${token.text}>`
          if (!linked && !bare) {
            runs.push({ text: " (", style: look("markup.link", href) })
            runs.push({ text: href, style: look("markup.link.url", href) })
            runs.push({ text: ")", style: look("markup.link", href) })
          }
          break
        }
        case "image":
          runs.push({ text: token.text || "image", style: look("markup.link.label", token.href) })
          break
        case "html":
          runs.push({ text: token.raw, style: look(group, url) })
          break
        default:
          if (token.tokens) walk(token.tokens, group, url)
          else runs.push({ text: token.text ?? token.raw, style: look(group, url) })
      }
    }
  }
  walk(tokens, "default")
  return runs
}

/** The runs as one styled text, a line break between wrapped lines. */
function wrapped(runs: Run<Look>[], width: number): StyledText {
  const chunks = wrapRuns(runs, width).flatMap((line, index): TextChunk[] => [
    ...(index === 0 ? [] : [{ __isChunk: true as const, text: "\n" }]),
    ...line.map((run) => ({ __isChunk: true as const, text: run.text, ...run.style })),
  ])
  return new StyledText(chunks)
}

/**
 * A paragraph wrapped by the pane rather than by the terminal library, whose
 * word wrap breaks after any parenthesis or period and can leave "." alone on
 * a line. It rewraps from the layout's size callback, not through React state,
 * so a key pressed right after a resize, such as G, already sees the new height.
 */
function Paragraph({ tokens, style }: { tokens: Inline[]; style: SyntaxStyle }) {
  const renderer = useRenderer()
  const box = useRef<BoxRenderable>(null)
  const text = useRef<TextRenderable>(null)
  const drawn = useRef<{ runs: Run<Look>[]; width: number } | null>(null)
  const hyperlinks = renderer.capabilities?.hyperlinks === true
  const runs = useMemo(() => inlineRuns(tokens, style, hyperlinks), [tokens, style, hyperlinks])
  const draw = useCallback(() => {
    const width = box.current?.width ?? 0
    if (!text.current || (drawn.current?.runs === runs && drawn.current.width === width)) return
    drawn.current = { runs, width }
    text.current.content = wrapped(runs, width)
  }, [runs])
  useLayoutEffect(draw, [draw])
  return (
    <box ref={box} flexDirection="column" onSizeChange={draw}>
      <text ref={text} wrapMode="none" />
    </box>
  )
}

/** Display markdown as the details pane draws it, in a description or a comment. */
export function Description({ markdown, style }: { markdown: string; style: SyntaxStyle }) {
  const blocks = useMemo(() => displayBlocks(markdown), [markdown])
  return (
    <box flexDirection="column">
      {blocks.map((block, index) =>
        block.kind === "paragraph" ? (
          <Paragraph key={index} tokens={block.tokens as Inline[]} style={style} />
        ) : block.kind === "gap" ? (
          <box key={index} height={block.lines} />
        ) : (
          <markdown key={index} syntaxStyle={style} content={block.markdown} />
        ),
      )}
    </box>
  )
}
