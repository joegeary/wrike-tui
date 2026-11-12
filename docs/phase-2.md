# Phase 2 design. Navigate the workspace

Phase 2 turns the navigation pane into the Wrike workspace and turns the list
pane into a list you can shape. It also adds the `:` palette, favorites, a
config file with themes, and a session that comes back the way you left it.
This document is the design. When Phase 2 lands, its content moves into
`architecture.md` and this file is deleted.

## What the real API showed

These come from read-only probes against a production account.

- **Spaces.** `GET /spaces` returned 8 spaces, and `userIsMember=true` only 3.
  People work in spaces they are not members of, so the tree shows every
  non-archived space the token can see. `accessType` is `Public`, `Private` or
  `Personal`.
- **Folder trees are big.** The account-wide `GET /folders` returned 9,185
  folders, 1.5 MB, in 670 ms, a third of it Recycle Bin. One space alone,
  `GET /spaces/{id}/folders`, returned 3,550 folders, 520 KB, in 530 ms, six
  levels deep. Trees load one space at a time, when the space is opened, and
  are cached on disk.
- **Tree mode** nodes carry `id`, `title`, `childIds`, `scope`, and `project`
  (with `status`, `customStatusId`, `ownerIds`) on projects. The space itself
  is a node in its own tree and is the root.
- **Folders have several parents.** One folder sat under two folders and a
  space at once, and 18 folders in one space had more than one parent. The
  workspace is a graph. A nav row is identified by its **path** of IDs from
  the space, never by folder ID alone, and the same folder can be drawn in
  more than one place.
- **Following `parentIds` upward** can reach the account root
  (`IEAA5UTEI7777777`, "logical folder"), which answers 400. Never walk
  upward to find a space. Find a folder's spaces from the loaded trees.
- **Folder task lists are big.** One folder held over 1,000 tasks. With
  `descendants=true&status=Active` it returned 404 in 350 ms, and 468 with
  `subTasks=true` (98 of them subtasks). A whole space's active tasks went
  past 1,000 and took 3 s. `GET /spaces/{id}/tasks` needs `descendants=true`
  or it returns nothing.
- **Paging.** Responses carry `nextPageToken`. A follow-up request must send
  `nextPageToken` **and the same `fields` again**, or the optional fields are
  missing. Pages did not overlap.

## Navigation pane

The pane is one list of rows built by a pure function:

```ts
type SpaceId = Brand<string, "SpaceId">
type FolderId = Brand<string, "FolderId">

type Space = { id: SpaceId; title: string; access: "Public" | "Private" | "Personal" }
type FolderNode = {
  id: FolderId
  title: string
  childIds: FolderId[]
  kind: "space" | "folder" | "project"
  project: { statusId: CustomStatusId | null; ownerIds: UserId[] } | null
}
type SpaceTree = Map<FolderId, FolderNode>   // the space's own node is the root

type NavPath = Brand<string, "NavPath">       // e.g. "space:MQA/IEA1/IEA2", "fav:3", "view:todo"

type NavRow =
  | { kind: "heading"; label: string }                                  // cursor steps over it
  | { kind: "view"; path: NavPath; view: "inbox" | "todo" | "search"; count: number | null }
  | { kind: "node"; path: NavPath; depth: number; node: FolderNode | Space;
      expandable: boolean; expanded: boolean; loading: boolean }
  | { kind: "favorite"; path: NavPath; favorite: Favorite; depth: 0 }

function navRows(input: {
  counts: ViewCounts
  favorites: Favorite[]
  spaces: Loadable<Space[]>
  trees: Map<SpaceId, Loadable<SpaceTree>>
  expanded: Set<NavPath>
}): NavRow[]
```

Order: the three views (Inbox, My to-do, Search), then **Favorites** when
there are any, then **Spaces**, sorted Personal first, then by title. Children
of a folder are drawn in `childIds` order. A folder seen again on the same
path (a cycle) is not expanded again.

`Enter` on a space or folder row scopes the list to it and opens the row.
`Space` (the key) opens or closes a row without changing the list. Opening a
space for the first time loads its tree. `h` and `l` keep moving between panes,
as everywhere else. The cursor keeps its **path** across rebuilds,
so a background refresh never moves it. If the path is gone, the cursor goes
to the nearest surviving ancestor.

`/` in the nav pane still opens task search. Filtering the tree by name is a
later phase.

## Scopes and paged lists

`View` becomes `Scope`:

```ts
type Scope =
  | { kind: "inbox" }
  | { kind: "todo" }
  | { kind: "search"; query: string }
  | { kind: "space"; id: SpaceId; title: string }
  | { kind: "folder"; id: FolderId; title: string; project: boolean }

type ScopeKey = Brand<string, "ScopeKey">   // "inbox", "todo", "search:<q>", "space:<id>", "folder:<id>"

type Paged<T> = {
  items: T[]
  next: string | null           // nextPageToken, null when complete
  loading: "first" | "more" | null
  error: WrikeError | null
}
```

Lists are kept per `ScopeKey` in a small LRU (8 scopes), so going back to a
folder you just left is instant and then revalidates.

Task lists for a space or folder call
`GET /{spaces|folders}/{id}/tasks?descendants=true&subTasks=true&pageSize=200`
with the same `fields` as Phase 1, plus `subTaskIds` and `superTaskIds`.
Active tasks are the default. `x` toggles completed, cancelled and deferred
tasks in, which refetches without the `status` filter. My to-do and search use
the same paging. The next page loads when the cursor comes within 20 rows of
the end, and the list's title shows `loaded of more` until it is complete,
for example `Devel Requests  200+`.

The transport gains `requestPage(method, path, params)` returning
`{ data, next }`. `Retry-After` on a 429 is honored when present.

## Shaping a list

Shaping is client side, over the tasks that are loaded, and is one pure
function:

```ts
type GroupKey = "status" | "importance" | "assignee" | "due" | "folder" | "none"
type SortKey = "due" | "importance" | "status" | "title" | "updated" | "created"
type SortTerm = { key: SortKey; dir: "asc" | "desc" }

type Filter =
  | { kind: "assignee"; ids: UserId[] }          // a special id stands for "nobody"
  | { kind: "status"; ids: CustomStatusId[] }
  | { kind: "importance"; values: Importance[] }
  | { kind: "due"; range: "overdue" | "today" | "week" | "none" }
  | { kind: "text"; query: string }              // title contains, typed with `f`

type ColumnKey = "importance" | "title" | "status" | "assignees" | "due" | "start" | "updated" | "folder" | "id"

type ListSpec = {
  group: GroupKey
  subgroup: GroupKey
  sort: SortTerm[]               // first decides, the rest break ties
  filters: Filter[]
  completed: boolean             // the `x` toggle
  columns: ColumnKey[]
}

type ListRow =
  | { kind: "group"; key: string; label: string; count: number; depth: 0 | 1; collapsed: boolean }
  | { kind: "task"; task: Task; depth: number; hasChildren: boolean; expanded: boolean }
  | { kind: "more"; label: string }          // "Loading more..." or "Load more"

function shapeList(tasks: Task[], spec: ListSpec, ctx: ShapeContext): ListRow[]
```

**Subtasks** nest under their parent when the parent is in the list, and are
collapsed by default. `Space` on a task with subtasks opens or closes it. A
subtask whose parent is not loaded is a top-level row. Grouping and sorting
apply to top-level rows; children keep the sort order inside their parent.

**Groups** are rows. `Space` or `Enter` on a group row collapses it. The `due`
grouping uses the My to-do buckets. The `folder` grouping uses the task's
first parent that is drawn in the current space tree, else "Other folders".

The cursor holds a **row identity** (task ID or group key), not an index, so
shaping, paging and saves never move it.

Defaults per scope kind:

| Scope | Group | Sort | Columns |
| --- | --- | --- | --- |
| My to-do | due | due, importance, title | importance, title, status, due |
| Search | none | updated desc | importance, title, status, folder, updated |
| Space, folder, project | status | importance, due, title | importance, title, assignees, due |

The pane title says what is applied, for example
`2 Devel Requests  404 · status · 2 filters`.

## The palette

One **command registry** replaces the Phase 1 action list:

```ts
type Context = "global" | "nav" | "list" | "task" | "details" | "edit" | "picker" | "text" | "compose" | "palette" | "help"

type Command = {
  id: string                     // stable, e.g. "list.group.status"
  title: string                  // "Group by status"
  group: "Navigate" | "Task" | "List" | "View" | "Favorites" | "Theme" | "App"
  keywords?: string[]
  contexts: Context[]
  when?: (state: State) => boolean
  run: (state: State) => Action
}

type KeyBinding = { context: Context; key: string; command: string }
```

The keymap table binds keys to command IDs. The `?` legend, the status line
hints and the palette all read the registry, and the integrity test covers
both tables: every binding names a command, no key is bound twice in a
context, and every command is reachable from a key or the palette.

`:` opens the palette over the focused pane. It lists the commands whose
contexts include where it was opened, plus `global`, grouped under headings
when the query is empty and ranked flat by a fuzzy match on title and keywords
when it is not. `↑` `↓` or `Ctrl+P` `Ctrl+N` move, `Enter` runs, `Esc` closes.
Grouping, sorting, filters, columns, themes, expand all and collapse all live
in the palette. Filter commands open the Phase 1 picker for their values.

## Favorites

Wrike's API has no starred items, so favorites are local, per account, in
`$XDG_STATE_HOME/wrike-tui/<accountId>/favorites.json`:

```ts
type Favorite =
  | { kind: "space"; id: SpaceId; title: string }
  | { kind: "folder"; id: FolderId; title: string; project: boolean }
  | { kind: "task"; id: TaskId; title: string }
```

`F` on a nav node, a list row or the open task adds or removes it. `J` and `K`
move a favorite down and up in the nav pane. `Enter` on a folder or space
favorite scopes the list, and on a task favorite opens the task. Titles are
refreshed when the item is seen again, and a favorite Wrike answers 404 for is
shown dimmed with "not found" until removed.

## Config, session and cache

Three files, each parsed with zod. A file that fails to parse is moved aside
as `<name>.bad`, the defaults load, and the status bar says so once.

| File | Holds | Written |
| --- | --- | --- |
| `$XDG_CONFIG_HOME/wrike-tui/config.json` | theme, default `ListSpec` per scope kind, nav width, `completed` default | by you, and by the palette's "Save as default" |
| `$XDG_STATE_HOME/wrike-tui/<accountId>/session.json` | the scope, nav cursor path, expanded paths, list cursor, open task, the `ListSpec` of each scope used, focus, zoom | on quit and every 30 s while dirty |
| `$XDG_CACHE_HOME/wrike-tui/<accountId>/spaces.json` and `tree-<spaceId>.json` | the spaces list and each opened space tree, with the time fetched | after each fetch |

On launch the nav pane paints from the cache, the session restores, and fresh
fetches run behind it. When a fetch matches the cache nothing rebuilds. A
`WRIKE_TUI_NO_RESTORE=1` launch skips the session.

## Themes

A theme is a named set of the color tokens `src/ui/theme.ts` already uses.
Three ship: `dark` (the Phase 1 colors), `light`, and `high-contrast`. When
OpenTUI can paint ANSI palette indexes, a fourth, `terminal`, maps the tokens
to the terminal's own 16 colors and becomes the default. The palette's Theme
commands switch live and "Save as default" writes the config.

## Keys added

| Where | Keys |
| --- | --- |
| Anywhere in browse | `:` palette |
| Nav pane | `Enter` scope and open, `Space` open or close, `F` favorite, `J` `K` move a favorite |
| List | `Space` open or close subtasks or a group, `x` completed on or off, `f` filter by title, `F` favorite |
| Task | `F` favorite |

`r` reloads the list, and also contacts, workflows, the spaces list and the
open space trees.

## Out of scope for Phase 2

Creating tasks, moving tasks between folders, bulk edits, filtering the tree
by name, folder or project editing, custom fields, and rebinding keys.
