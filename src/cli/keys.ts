import { COMMANDS } from "../app/commands"
import { CONTEXT_TITLES, overrideContexts, type BuiltKeymap } from "../app/keymap"

const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)))

/**
 * Every command, one per line: a star when the config changed its keys, its
 * ID, where its keys work, the keys as the config writes them, and its title.
 */
export function keyLines({ keymap, changed }: BuiltKeymap): string[] {
  const rows = COMMANDS.map((command) => {
    const bound = keymap.filter((binding) => binding.command === command.id)
    const contexts = bound.length > 0 ? [...new Set(bound.map((binding) => binding.context))] : overrideContexts(command.id)
    const keys = [...new Set(bound.map((binding) => binding.key))]
    return {
      mark: changed.has(command.id) ? "*" : " ",
      cells: [command.id, contexts.map((context) => CONTEXT_TITLES[context]).join(", "), keys.length > 0 ? keys.join(" ") : "-", command.title],
    }
  })
  const header = ["COMMAND", "WHERE", "KEYS", "TITLE"]
  const widths = header.map((title, column) => Math.max(Bun.stringWidth(title), ...rows.map((row) => Bun.stringWidth(row.cells[column]!))))
  const line = (mark: string, cells: string[]) => `${mark} ${cells.map((cell, column) => (column === cells.length - 1 ? cell : pad(cell, widths[column]!))).join("  ")}`
  return [line(" ", header), ...rows.map((row) => line(row.mark, row.cells))]
}
