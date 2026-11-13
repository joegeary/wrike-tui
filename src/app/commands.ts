import { GROUP_KEYS, SORT_KEYS, type GroupKey, type SortKey } from "../domain/list"
import { THEME_NAMES, type ThemeName } from "../domain/settings"
import { currentView, detailsItems, mentionSuggestions, MULTI_PICKERS, navCursorRow, openHistory, selectedAttachment, selectedComment } from "./selectors"
import type { Action, State } from "./state"

export type Context = "global" | "nav" | "list" | "task" | "details" | "edit" | "picker" | "text" | "mention" | "compose" | "confirm" | "palette" | "help"

/** The contexts a pane can be in while browsing. The palette lists the commands of these. */
export const BROWSE_CONTEXTS: ReadonlySet<Context> = new Set(["global", "nav", "list", "task", "details"])

export const COMMAND_GROUPS = ["Navigate", "Task", "List", "View", "Favorites", "Theme", "App"] as const
export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export type Command = {
  /** Stable, for example `list.group.status`. The keymap binds keys to it. */
  id: string
  title: string
  group: CommandGroup
  /** Extra words the palette matches. */
  keywords?: string[]
  contexts: Context[]
  /** The command is offered only while this holds. */
  when?: (state: State) => boolean
  /** A short label for the status bar, or null where the command has nothing to offer there. */
  hint?: string | ((state: State) => string | null)
  run: (state: State) => Action
}

const GROUP_LABELS: Record<GroupKey, string> = { status: "status", importance: "importance", assignee: "assignee", due: "due date", folder: "folder", none: "nothing" }
const SORT_LABELS: Record<SortKey, string> = { due: "due date", importance: "importance", status: "status", title: "title", updated: "last update", created: "creation date" }
const THEME_LABELS: Record<ThemeName, string> = { terminal: "terminal colors", dark: "dark", light: "light", "high-contrast": "high contrast" }

const inTasks = (state: State) => state.scope.kind !== "inbox"
const inInbox = (state: State) => state.scope.kind === "inbox"
const onFavorite = (state: State) => navCursorRow(state)?.kind === "favorite"
const onComment = (state: State) => selectedComment(state) !== null
const onAttachment = (state: State) => selectedAttachment(state) !== null
const selecting = (state: State) => onComment(state) || onAttachment(state)
const hasItems = (state: State) => state.details.state === "ready" && detailsItems(state.details.value).length > 0
const suggesting = (state: State) => mentionSuggestions(state) !== null
const editingComment = (state: State) => state.mode.kind === "compose" && state.mode.editing !== null
const olderHistory = (state: State) => {
  const history = openHistory(state)
  return history !== null && history.next !== null && history.loading === null
}
const multi = (state: State) => state.mode.kind === "picker" && MULTI_PICKERS.has(state.mode.field)

const command = (id: string, title: string, group: CommandGroup, contexts: Context[], run: Command["run"], extra: Partial<Command> = {}): Command => ({
  id,
  title,
  group,
  contexts,
  run,
  ...extra,
})

/** Every command there is. A key, the status bar, the `?` legend and the `:` palette all read this table. */
export const COMMANDS: Command[] = [
  command("pane.nav", "Focus the navigation pane", "Navigate", ["global"], () => ({ type: "focus", pane: "nav" })),
  command("pane.list", "Focus the list pane", "Navigate", ["global"], () => ({ type: "focus", pane: "list" })),
  command("pane.details", "Focus the details pane", "Navigate", ["global"], () => ({ type: "focus", pane: "details" })),
  command("pane.left", "Go to the pane on the left", "Navigate", ["global"], () => ({ type: "focus", pane: "left" })),
  command("pane.right", "Go to the pane on the right", "Navigate", ["global"], () => ({ type: "focus", pane: "right" })),
  command("view.inbox", "Show the Inbox", "Navigate", ["global"], () => ({ type: "show", scope: { kind: "inbox" } })),
  command("view.todo", "Show My to-do", "Navigate", ["global"], () => ({ type: "show", scope: { kind: "todo" } })),
  command("app.search", "Search, or open a link or ID", "Navigate", ["global"], () => ({ type: "search" }), { hint: "search", keywords: ["find"] }),

  command("nav.down", "Next row", "Navigate", ["nav"], () => ({ type: "nav-move", by: 1 })),
  command("nav.up", "Previous row", "Navigate", ["nav"], () => ({ type: "nav-move", by: -1 })),
  command("nav.open", "Show it in the list", "Navigate", ["nav"], () => ({ type: "nav-open" }), { hint: "show" }),
  command("nav.toggle", "Open or close the row", "Navigate", ["nav"], () => ({ type: "nav-toggle" }), { hint: "open", keywords: ["expand", "collapse"] }),

  command("list.down", "Move down", "Navigate", ["list"], () => ({ type: "move", to: "down" })),
  command("list.up", "Move up", "Navigate", ["list"], () => ({ type: "move", to: "up" })),
  command("list.top", "Jump to the top", "Navigate", ["list"], () => ({ type: "move", to: "top" })),
  command("list.bottom", "Jump to the bottom", "Navigate", ["list"], () => ({ type: "move", to: "bottom" })),
  command("list.open", "Open", "Navigate", ["list"], () => ({ type: "open" }), { hint: "open" }),

  command("details.down", "Scroll down", "Navigate", ["details"], () => ({ type: "scroll", pane: "details", to: "down" })),
  command("details.up", "Scroll up", "Navigate", ["details"], () => ({ type: "scroll", pane: "details", to: "up" })),
  command("details.top", "Scroll to the top", "Navigate", ["details"], () => ({ type: "scroll", pane: "details", to: "top" })),
  command("details.bottom", "Scroll to the bottom", "Navigate", ["details"], () => ({ type: "scroll", pane: "details", to: "bottom" })),
  command("details.next", "Select the next item", "Navigate", ["details"], () => ({ type: "select", by: 1 }), {
    hint: (state) => (selecting(state) ? "next" : hasItems(state) ? "select" : null),
    keywords: ["comments", "attachments", "files"],
  }),
  command("details.previous", "Select the previous item", "Navigate", ["details"], () => ({ type: "select", by: -1 }), { keywords: ["comments", "attachments", "files"] }),
  command("details.unselect", "Clear the selection", "Navigate", ["details"], () => ({ type: "unselect" }), { when: selecting, hint: "unselect" }),
  // Enter acts on whatever is selected, so one command holds the key for both kinds.
  command("details.act", "Open or edit the selection", "Task", ["details"], (state) => (onAttachment(state) ? { type: "open-attachment" } : { type: "edit-comment" }), {
    when: selecting,
    hint: (state) => (onAttachment(state) ? "open" : "edit comment"),
    keywords: ["attachment", "comment", "browser"],
  }),
  command("comment.delete", "Delete the comment", "Task", ["details"], () => ({ type: "delete-comment" }), { when: onComment, hint: "delete" }),

  command("inbox.read", "Toggle read notifications", "List", ["list"], () => ({ type: "toggle-read" }), { when: inInbox, hint: "read" }),
  command("list.toggle", "Open or close the row", "List", ["list"], () => ({ type: "toggle-row" }), { when: inTasks, keywords: ["subtasks", "group", "expand", "collapse"] }),
  command("list.completed", "Completed tasks on or off", "List", ["list"], () => ({ type: "spec", change: { set: "completed" } }), {
    when: inTasks,
    keywords: ["cancelled", "deferred", "closed", "done"],
  }),
  command("list.filter.text", "Filter by title", "List", ["list"], () => ({ type: "filter-text" }), { when: inTasks, hint: "filter" }),
  ...GROUP_KEYS.map((group) =>
    command(`list.group.${group}`, `Group by ${GROUP_LABELS[group]}`, "List", ["list"], () => ({ type: "spec", change: { set: "group", group } }), { when: inTasks }),
  ),
  ...GROUP_KEYS.map((group) =>
    command(`list.subgroup.${group}`, `Subgroup by ${GROUP_LABELS[group]}`, "List", ["list"], () => ({ type: "spec", change: { set: "subgroup", group } }), { when: inTasks }),
  ),
  ...SORT_KEYS.map((key) =>
    command(`list.sort.${key}`, `Sort by ${SORT_LABELS[key]}`, "List", ["list"], () => ({ type: "spec", change: { set: "sort", key } }), { when: inTasks, keywords: ["order"] }),
  ),
  command("list.sort.reverse", "Reverse the sort", "List", ["list"], () => ({ type: "spec", change: { set: "reverse" } }), { when: inTasks, keywords: ["order", "descending", "ascending"] }),
  command("list.filter.assignee", "Filter by assignee", "List", ["list"], () => ({ type: "pick", field: "filter-assignee" }), { when: inTasks, keywords: ["person", "responsible"] }),
  command("list.filter.status", "Filter by status", "List", ["list"], () => ({ type: "pick", field: "filter-status" }), { when: inTasks }),
  command("list.filter.importance", "Filter by importance", "List", ["list"], () => ({ type: "pick", field: "filter-importance" }), { when: inTasks, keywords: ["priority"] }),
  command("list.filter.due", "Filter by due date", "List", ["list"], () => ({ type: "pick", field: "filter-due" }), { when: inTasks, keywords: ["overdue", "today", "week"] }),
  command("list.filter.mine", "Only my tasks", "List", ["list"], () => ({ type: "spec", change: { set: "mine" } }), { when: inTasks, keywords: ["filter", "assigned", "me"] }),
  command("list.filter.clear", "Clear the filters", "List", ["list"], () => ({ type: "spec", change: { set: "clear-filters" } }), {
    when: (state) => inTasks(state) && currentView(state).spec.filters.length > 0,
  }),
  command("list.columns", "Choose the columns", "List", ["list"], () => ({ type: "pick", field: "columns" }), { when: inTasks }),
  command("list.expand-all", "Open every group and subtask", "List", ["list"], () => ({ type: "expand-all" }), { when: inTasks, keywords: ["expand"] }),
  command("list.collapse-all", "Close every group and subtask", "List", ["list"], () => ({ type: "collapse-all" }), { when: inTasks, keywords: ["collapse"] }),

  command("task.edit", "Edit fields", "Task", ["task"], () => ({ type: "task", command: "edit" }), { hint: "edit" }),
  command("task.status", "Change the status", "Task", ["task"], () => ({ type: "task", command: "status" }), { hint: "status" }),
  command("task.importance", "Change the importance", "Task", ["task"], () => ({ type: "task", command: "importance" }), { keywords: ["priority"] }),
  command("task.assignees", "Change the assignees", "Task", ["task"], () => ({ type: "task", command: "assignees" })),
  command("task.assign-me", "Assign to me", "Task", ["task"], () => ({ type: "task", command: "assign-me" }), { hint: "mine" }),
  command("task.comment", "Write a comment", "Task", ["task"], () => ({ type: "task", command: "comment" }), { hint: "comment" }),
  command("task.description", "Description in $EDITOR", "Task", ["task"], () => ({ type: "task", command: "description" })),
  command("task.browser", "Open in the browser", "Task", ["task"], () => ({ type: "link", act: "browser" })),
  command("task.copy-url", "Copy the URL", "Task", ["task"], () => ({ type: "link", act: "copy-url" }), { keywords: ["permalink", "link"] }),
  command("task.copy-id", "Copy the ID", "Task", ["task"], () => ({ type: "link", act: "copy-id" })),

  command("favorite.toggle", "Add or remove a favorite", "Favorites", ["nav", "task"], () => ({ type: "favorite" }), { keywords: ["star", "pin"] }),
  command("favorite.down", "Move the favorite down", "Favorites", ["nav"], () => ({ type: "favorite-move", by: 1 }), { when: onFavorite }),
  command("favorite.up", "Move the favorite up", "Favorites", ["nav"], () => ({ type: "favorite-move", by: -1 }), { when: onFavorite }),

  command("view.zoom", "Zoom the details pane", "View", ["global"], () => ({ type: "zoom" })),
  command("view.history", "Field history on or off", "View", ["global"], () => ({ type: "toggle-history" }), { keywords: ["changes", "activity", "comments"] }),
  command("history.older", "Load older changes", "View", ["details"], () => ({ type: "older-history" }), { when: olderHistory, keywords: ["history", "more", "activity"] }),
  ...THEME_NAMES.map((name) =>
    command(`theme.${name}`, `Theme: ${THEME_LABELS[name]}`, "Theme", ["global"], () => ({ type: "theme", name }), { keywords: ["colors"] }),
  ),

  command("app.refresh", "Refresh", "App", ["global"], () => ({ type: "refresh" }), { keywords: ["reload"] }),
  command("app.save-defaults", "Save as default", "App", ["global"], () => ({ type: "save-defaults" }), { keywords: ["config", "theme", "columns", "grouping"] }),
  command("app.palette", "Show the commands", "App", ["global"], () => ({ type: "palette" }), { hint: "commands" }),
  command("app.help", "Show the keys", "App", ["global"], () => ({ type: "help" }), { hint: "keys" }),
  command("app.quit", "Quit", "App", ["global"], () => ({ type: "quit" }), { hint: "quit" }),

  command("edit.down", "Next field", "Task", ["edit"], () => ({ type: "field-move", by: 1 }), { hint: "next" }),
  command("edit.up", "Previous field", "Task", ["edit"], () => ({ type: "field-move", by: -1 }), { hint: "previous" }),
  command("edit.open", "Edit the field", "Task", ["edit"], () => ({ type: "field-open" }), { hint: "edit" }),
  command("edit.leave", "Leave edit mode", "Task", ["edit"], () => ({ type: "cancel" }), { hint: "done" }),

  command("picker.toggle", "Toggle the choice", "App", ["picker"], () => ({ type: "choice-toggle" }), { when: multi, hint: "toggle" }),
  command("picker.down", "Move down", "App", ["picker"], () => ({ type: "choice-move", by: 1 })),
  command("picker.up", "Move up", "App", ["picker"], () => ({ type: "choice-move", by: -1 })),
  command("picker.erase", "Erase the filter", "App", ["picker"], () => ({ type: "erase" })),
  command("picker.apply", "Apply", "App", ["picker"], () => ({ type: "submit" }), { hint: "apply" }),
  command("picker.cancel", "Cancel", "App", ["picker"], () => ({ type: "cancel" }), { hint: "cancel" }),

  command("text.save", "Save", "App", ["text"], () => ({ type: "submit" }), { hint: "save" }),
  command("text.discard", "Discard", "App", ["text"], () => ({ type: "cancel" }), { hint: "discard" }),

  command("mention.down", "Next person", "Task", ["mention"], () => ({ type: "choice-move", by: 1 }), { when: suggesting }),
  command("mention.up", "Previous person", "Task", ["mention"], () => ({ type: "choice-move", by: -1 }), { when: suggesting }),
  command("mention.pick", "Mention this person", "Task", ["mention"], () => ({ type: "mention-pick" }), { when: suggesting, hint: "mention" }),
  command("mention.close", "Close the list", "Task", ["mention"], () => ({ type: "mention-close" }), { when: suggesting, hint: "close list" }),

  command("compose.post", "Post the comment", "Task", ["compose"], () => ({ type: "submit" }), {
    when: (state) => !suggesting(state),
    hint: (state) => (editingComment(state) ? "save" : "post"),
  }),
  command("compose.editor", "Write it in $EDITOR", "Task", ["compose"], () => ({ type: "compose-editor" }), { hint: "editor" }),
  command("compose.discard", "Discard", "Task", ["compose"], () => ({ type: "cancel" }), { when: (state) => !suggesting(state), hint: "discard" }),

  command("confirm.yes", "Delete it", "Task", ["confirm"], () => ({ type: "confirm" }), { hint: "delete" }),
  command("confirm.no", "Keep it", "Task", ["confirm"], () => ({ type: "cancel" }), { hint: "keep" }),

  command("palette.down", "Move down", "App", ["palette"], () => ({ type: "choice-move", by: 1 })),
  command("palette.up", "Move up", "App", ["palette"], () => ({ type: "choice-move", by: -1 })),
  command("palette.erase", "Erase the query", "App", ["palette"], () => ({ type: "erase" })),
  command("palette.run", "Run the command", "App", ["palette"], () => ({ type: "submit" }), { hint: "run" }),
  command("palette.close", "Close", "App", ["palette"], () => ({ type: "cancel" }), { hint: "close" }),

  command("help.down", "Scroll down", "App", ["help"], () => ({ type: "scroll", pane: "help", to: "down" })),
  command("help.up", "Scroll up", "App", ["help"], () => ({ type: "scroll", pane: "help", to: "up" })),
  command("help.close", "Close", "App", ["help"], () => ({ type: "cancel" }), { hint: "close" }),
]

const BY_ID = new Map(COMMANDS.map((entry) => [entry.id, entry]))

export function commandById(id: string): Command {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`No command is registered as ${id}`)
  return found
}

export const isOffered = (entry: Command, state: State) => !entry.when || entry.when(state)
