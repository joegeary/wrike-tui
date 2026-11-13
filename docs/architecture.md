# Architecture

wrike-tui is TypeScript on Bun, rendered by OpenTUI through
`@opentui/react`. `bun build --compile` produces one binary.

## Layers

Data flows one way. Each layer depends only on the layers under it.

    src/cli/        argv parsing, `auth login|logout|status`, launching the TUI
    src/ui/         React components that render state and dispatch actions,
                    and the terminal handoffs (editor, browser, clipboard)
    src/app/        the app state machine (reducer, with its handlers in
                    reduce/), the command registry, the keymap table, the nav
                    rows, the palette, the session, effects, the clock ticker
    src/persist/    the files on disk: config, session, favorites, cache
    src/auth/       token resolution and storage, data-center probing
    src/wrike/      HTTP transport, REST client, MCP inbox client, zod schemas
    src/domain/     branded IDs, the task and workspace models, scopes, list
                    shaping, pure functions over them

`src/wrike/` is the only place that knows the wire format. It parses every
response with zod and returns domain types, so nothing above it sees raw JSON.
`src/domain/` and the reducer in `src/app/` are pure and carry most of the
unit tests.

## Auth

The token resolves in this order.

1. `WRIKE_TOKEN` in the environment.
2. The OS keyring through `Bun.secrets`, service `wrike-tui`, name `token`.

`auth login` reads the token with echo off, then probes the known hosts in
order (`www.wrike.com`, `app-us2.wrike.com`, `app-eu.wrike.com`) with
`GET /api/v4/contacts?me=true`. The first 200 wins. The token goes to the
keyring and the profile goes to `$XDG_CONFIG_HOME/wrike-tui/profile.json`:

```ts
type Profile = { host: string; accountId: string; userId: UserId; name: string }
```

`WRIKE_HOST` overrides the stored host. `auth logout` deletes both.

A token from the keyring starts with the stored profile and makes no request.
A token from `WRIKE_TOKEN` is probed on every start, because the stored
profile may belong to a different token.

These variables exist for development and tests.

| Variable | Effect |
| --- | --- |
| `WRIKE_BASE_URL` | Replaces the whole REST base. It may be plain http. |
| `WRIKE_MCP_URL` | Replaces the MCP endpoint. |
| `WRIKE_TUI_KEYRING_SERVICE` | Renames the keyring service, so a test run never reads or writes the real token. |
| `WRIKE_TUI_READ_ONLY=1` | The transport refuses every request that is not a GET, before it is sent. |
| `WRIKE_TUI_NO_RESTORE=1` | The launch skips the session and starts on the Inbox. |
| `WRIKE_TUI_FRAME_LOG=<file>` | Appends one line per key press: the key and the milliseconds to the next composed frame. |

## Wire

**Transport.** One `request()` builds `https://<host>/api/v4/<path>`, sends
`Authorization: bearer <token>`, and encodes array and object query params as
JSON strings the way Wrike expects (`responsibles=["KUAJ25LC"]`). Writes use
`PUT`, `POST` or `DELETE` with an `application/x-www-form-urlencoded` body.
`requestPage()` is the same call and also returns `nextPageToken` as `next`.

A 429 retries up to three times. It waits for the `Retry-After` header when
Wrike sends one, as seconds or as an HTTP date, capped at 60 seconds. Without
the header it backs off exponentially.

In read-only mode a request that is not a GET fails with `read_only` before
anything is sent, and the status bar shows "read-only mode: not saved". The MCP
client only reads, so the mode does not touch it. Errors become one tagged
union:

```ts
type WrikeError =
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "read_only" }
  | { kind: "invalid"; message: string }
  | { kind: "network"; message: string }
  | { kind: "server"; status: number; message: string }
```

Inside the wire layer a failure is thrown as `WrikeFailure`, which carries the
union. The effect runner is the one place that catches it, and it hands the
reducer a `Result<T>`. The reducer never sees an exception.

**REST client.** One object with one method per call the app makes, and no
more:

| Method | Call |
| --- | --- |
| `me()` | `GET /contacts?me=true` |
| `contacts()` | `GET /contacts?types=["Person"]`. Deactivated people stay, marked inactive, so old tasks show their names; pickers offer active people and anyone already chosen |
| `workflows()` | `GET /workflows` |
| `spaceWorkflows()` | `GET /spaces`, then `GET /spaces/{id}/workflows` for each space |
| `spaces()` | `GET /spaces`, then the spaces that are not archived |
| `spaceTree(id)` | `GET /spaces/{id}/folders`, as a map of folder nodes |
| `tasks(query, { completed, pageToken })` | One page of a task list, see below |
| `taskByPermalink(url)` | `GET /tasks?permalink=<url>` |
| `taskIdFromLegacy(n)` | `GET /ids?ids=[n]&type=ApiV2Task` |
| `task(id)` | `GET /tasks/{id}` |
| `updateTask(id, patch)` | `PUT /tasks/{id}` |
| `comments(id)` | `GET /tasks/{id}/comments`, sorted oldest first |
| `addComment(id, body)` | `POST /tasks/{id}/comments`, with `plainText=true` unless the comment holds a mention |
| `updateComment(id, body)` | `PUT /comments/{id}`, the same parameters |
| `deleteComment(id)` | `DELETE /comments/{id}` |
| `folders(ids)` | `GET /folders/{ids}` for the titles of a task's parents |

`tasks()` serves four queries, 200 tasks to a page.

| Query | First page |
| --- | --- |
| `mine` | `GET /tasks?responsibles=[me]&subTasks=true&sortField=DueDate` |
| `title` | `GET /tasks?title=<q>&sortField=UpdatedDate&sortOrder=Desc` |
| `space` | `GET /spaces/{id}/tasks?descendants=true&subTasks=true` |
| `folder` | `GET /folders/{id}/tasks?descendants=true&subTasks=true` |

A first page adds `status=Active` unless completed tasks are wanted, and
`fields=["responsibleIds","parentIds","description","subTaskIds","superTaskIds"]`,
because Wrike leaves those out of a list and the app's `Task` always carries
them. A follow-up page sends only `nextPageToken` and the same `fields`.

These facts come from read-only probes against a production account, and the
client is built around them.

- `GET /spaces` returned 8 spaces, and `userIsMember` was true for 3. People
  work in spaces they are not members of, so the tree shows every space that
  is not archived.
- One space's tree had 3,550 folders, 760 KB, six levels deep, and took about
  580 ms. Trees load one space at a time, when the space is opened, and are
  cached on disk.
- A tree node carries `id`, `title`, `childIds`, `scope`, and `project` on a
  project. The space itself is a node of its own tree, the first one, with the
  space's ID.
- A folder can have several parents. 18 folders in one space had more than
  one. The workspace is a graph, so a nav row is identified by its path of IDs
  from the space, and one folder can be drawn in several places.
- Walking `parentIds` upward can reach the account root, which answers 400.
  The client never walks upward. It finds a folder's title in the loaded trees.
- `GET /spaces/{id}/tasks` returns nothing without `descendants=true`.
- A follow-up page that does not repeat `fields` comes back without the
  optional fields. Pages did not overlap. The first page carries
  `responseSize`, the total, which the client does not use yet.
- A first page of 200 tasks took 150 ms for a folder and 2.7 s for a space
  with over 100,000 active tasks. Later pages took 100 to 200 ms.

These facts about comments come from probes against a production account.

- `PUT /comments/{id}` with `text`, and `plainText=true` for plain text,
  answers 200 with the comment. Wrike enforces no time limit, and
  `updatedDate` does not change, so an edit leaves no trace.
- `DELETE /comments/{id}` answers 200 with an empty `data`. A second delete
  answers 404, `resource_not_found`.
- A mention is stored as `<a class="stream-user-id avatar"
  rel="KUAB6OAK">&#64;Joe Geary</a>`: the REST contact ID and `&#64;` with the
  full name. HTML posted without `plainText` is stored as sent, so a comment
  with a mention must go as HTML.

`spaceWorkflows()` runs at most once per session. The reducer asks for it the
first time a task in a list or in the details has a status that the account
workflows do not hold.

**MCP inbox client.** Inbox has no REST endpoint, so `inbox()` talks to
`https://mcp.wrike.com/v2` with the same Bearer token through
`@modelcontextprotocol/sdk` (`StreamableHTTPClientTransport`). It calls
`get_my_inbox` with `{ includeRead, limit: 100 }`, takes the JSON from the
tool result's text content, and parses it with zod into `InboxEntry[]`. The
connection is opened lazily and reused. A failed call drops the connection, so
the next refresh connects again.

## Domain

IDs are branded so a legacy numeric ID can never reach a v4 call.

```ts
type TaskId = Brand<string, "TaskId">          // v4, e.g. "IEAGIITRKQAB5JHX"
type LegacyItemId = Brand<string, "LegacyItemId"> // numeric, from "w:itm:4598459124"
type UserId = Brand<string, "UserId">
type CustomStatusId = Brand<string, "CustomStatusId">
type SpaceId = Brand<string, "SpaceId">
type FolderId = Brand<string, "FolderId">
type CommentId = Brand<string, "CommentId">

type StatusGroup = "Active" | "Completed" | "Deferred" | "Cancelled"
type Importance = "High" | "Normal" | "Low"
type CustomStatus = { id: CustomStatusId; name: string; group: StatusGroup; color: string; hidden: boolean }
type Workflow = { id: string; name: string; statuses: CustomStatus[] }

// Days are "YYYY-MM-DD". Wrike's time of day is dropped at the wire.
type TaskDates =
  | { type: "Backlog" }
  | { type: "Milestone"; due: string }
  | { type: "Planned"; start: string; due: string; duration?: number }

type Task = {
  id: TaskId
  title: string
  statusId: CustomStatusId
  statusGroup: StatusGroup
  importance: Importance
  dates: TaskDates
  assigneeIds: UserId[]
  parentIds: string[]
  subTaskIds: TaskId[]
  superTaskIds: TaskId[]
  permalink: string
  descriptionHtml: string
  createdDate: string
  updatedDate: string
}

type Comment = { id: CommentId; authorId: UserId; text: string; createdDate: string }
type Contact = { id: UserId; name: string; email: string | null }

type InboxKind = "Mention" | "Assign" | "Comment" | "Status" | "Other"
type InboxEntry = {
  id: string
  kind: InboxKind
  label: string   // the wire notificationType, shown when kind is "Other"
  unread: boolean
  ts: string
  item: { legacyId: LegacyItemId; title: string; baseType: "TASK" | "FOLDER" | "PROJECT"; permalink: string } | null
  author: { name: string } | null
  commentText: string | null
}
```

An unrecognized `notificationType` maps to `Other` and keeps its raw label
for display (`ApprovalRequested` shows as "Approval requested"), so a new
Wrike notification type never fails the parse. A
notification whose item has no ID, no permalink or another base type (a
report, a dashboard, an approval) has `item: null` and nothing to open.

**Edits** are one union, and one function, `patchParams`, turns a patch into
`PUT` params:

```ts
type TaskPatch =
  | { field: "title"; title: string }
  | { field: "status"; statusId: CustomStatusId }
  | { field: "importance"; importance: Importance }
  | { field: "assignees"; add: UserId[]; remove: UserId[] }
  | { field: "dates"; dates: TaskDates }
  | { field: "description"; html: string }
```

**Dates.** Start and due are typed as `YYYY-MM-DD`. `withDay` applies one
typed day and derives the date type from which days are set: both make a
planned task, a due date alone makes a milestone, neither makes a backlog
task. A start date without a due date is refused.

**Due buckets.** `bucketOf` puts a task in Overdue, Today, This week, Later or
No date, from its due date and today's date in the user's zone. "This week"
runs through the Sunday of the current week. Grouping by due date and the due
filter both use it.

**Search.** `classifyQuery` tells a permalink (`https://.../open.htm?id=N`), a
bare number and a title apart. A permalink or a number opens the task it
finds.

**Descriptions.** `src/domain/description/` converts a description between
Wrike's HTML and a markdown dialect. `htmlToMarkdown` (`markdown.ts`) walks
the HTML with domino and writes markdown. `markdownToHtml` (`html.ts`) reads
it back with marked and writes only the tags and attributes Wrike stores.

`editableDescription(html)` decides the edit format by trying it: it converts
the description to markdown and back, and opens markdown only when the result
is `sameHtml` as the stored HTML. Anything else opens as raw HTML, so a save
never strips formatting the user did not touch. Leading and trailing breaks
and spaces, which markdown cannot spell, ride along outside the markdown and
come back on save. A description of nothing but blank lines stays HTML. The
status bar says which format was saved.

`sameHtml` (`src/domain/html-equivalence.ts`) compares parsed DOMs: the same
elements, attributes with the same values, and the same text. Only spelling
the parser erases may differ: which entity encodes a character, `<br>` against
`<br />`, attribute order and quoting. Whitespace, empty elements and `<b>`
against `<strong>` all count.

The dialect:

| Wrike HTML | Markdown |
| --- | --- |
| `<b>`, `<strong>` | `**b**`, `__strong__` |
| `<i>`, `<em>` | `*i*`, `_em_` |
| `<s>` | `~~s~~` |
| `<u>` | `++u++` |
| `<span style="color: #hex;">` | `{color:#hex}text{color}` |
| `<span style="background-color: #hex;">` | `=={#hex}text==` (a bare `==text==` takes `#F8BBD0`) |
| `<a href rel>` | `[text](url){rel=value}` |
| `<img src />` | `![](src)` |
| `<code>`, `<pre>` | a code span, a fence |
| `<h1>` to `<h6>` | `#` to `######` |
| `<ul>`, `<ol>` | `- item`, `1. item`; a second list in a row switches to `*` or `1)` |
| `<ul style="list-style-type: circle;">`, then `square;` | a bullet list nested one, then two, bullet lists deep |
| `<ul class="checklist" style="list-style-type: none;">` with `<li><label><input type="checkbox" />` | `- [ ] text`, `- [x] text` |
| `<table><tr><td>` | a GFM pipe table; the first row is the header, `<br>` breaks a cell |

Wrike separates lines and blocks with runs of `<br>`, and the count shows on
screen. `flow.ts` holds the one table both directions use. A single `<br>`
inside text is a hard break, a backslash at the end of the line. Markdown
also reads two trailing spaces as one, but many editors strip trailing
whitespace on save, so the client never writes them; a test strips it from
every corpus description and expects the same HTML back. Two or more `<br>`
between lines are that many newlines, so each blank line in the editor is a
blank line in Wrike. A block ends at a blank line, and each further blank line
after it is a `<br>`. A `<br>` just before a block draws nothing, so it is
spelled with the backslash of a hard break.

`==` and `++` work like markdown's `_`: they open only where no letter or
digit runs into them and close only before something that is not one, so
typed prose like `a==b==c` or `i++; j++` stays text. Wrike colors parts of
words, so `{color:...}` may touch a word, and like the others it takes no space
just inside either tag.

Text that would read as markup is escaped, but only where markdown would read
it: `snake_case` and `2 * 3` stay as written, `2\*3\*4` does not. A space
markdown would drop, at the end of a line or inside bold, is written `&#32;`
(`&nbsp;` for a non-breaking one). Angle brackets stay text, so
`Bearer <token>` survives. Only an explicit `[text](url)` makes a link; a bare
URL or an `<address>` stays plain text. Hrefs and image sources go back exactly
as written.

`test/fixtures/descriptions.json` holds the shapes of 1,122 real descriptions,
every word, link and image replaced. `bun test/corpus-report.ts` prints how they
open. 1,065 open as markdown and every one of them saves back unchanged, which
`test/domain/description-corpus.test.ts` holds as a gate with a floor on the
count. The other 57 open as raw HTML: lists with Wrike's `bullet`, `indent` and
`number` classes and their `rel`, which no markdown structure implies; spans
and paragraphs with other styles; a `<br>` inside a heading or at the end of a
list item; table rows shorter than the header; markup inside `<code>`; `<b>`
and `<i>` nested the other way round from how markdown reads `***`; a
`<strong>` ending in a space right before a letter; HTML comments and empty
elements; and descriptions of nothing but blank lines.

`displayMarkdown` (`display.ts`) renders a description or a comment for the
details pane from the same HTML. OpenTUI's markdown shows backslash escapes
and character references as typed, and a terminal cannot show colors,
highlights or underline, so it drops those, draws checklist boxes as ☐ and ☑,
marks an image `(image)`, turns a break in a table cell into a space, and shows
at most one blank line in a row.

**Comments** render through `displayMarkdown` too, so a link reads as its
label with the URL beside it. `showMentions` first turns each mention
anchor into a bold `@Full Name`, with the person's current name when the
client knows them.

```ts
type Mention = { at: number; id: UserId; name: string }   // `@name` at offset `at` of the draft
type CommentBody = { text: string; plainText: boolean }
```

`commentBody(draft, mentions)` is what reaches Wrike. A draft without a
mention stays plain text with `plainText=true`, exactly as before mentions
existed. A draft with one is escaped HTML, newlines become `<br />`, and each
mention becomes Wrike's anchor. Only a mention picked from the list is an
anchor, so an `@name` typed by hand stays text. `followEdit` moves the
mentions with each edit of the draft, and drops one the edit touched.
`refindMentions` finds them again, in order, in text that comes back from
the editor.

`editableComment(html)` gives a comment back as text to edit, with mentions as
`@Full Name`. When the HTML holds anything but text, `<br />` and mentions, it
gives null and the edit is refused, so a save never strips formatting.

`editWindowLeft(createdDate, now)` counts down five minutes. Wrike's API takes
an edit at any age and leaves no mark of it, so the client keeps the web
app's rule and nobody reads a comment that changed long after they replied.

## Workspace

```ts
type Space = { id: SpaceId; title: string; access: "Public" | "Private" | "Personal" }
type FolderNode = {
  id: FolderId
  title: string
  childIds: FolderId[]
  kind: "space" | "folder" | "project"
  project: { statusId: CustomStatusId | null; ownerIds: UserId[] } | null
}
type SpaceTree = Map<FolderId, FolderNode>   // the space's own node is the root

type Favorite =
  | { kind: "space"; id: SpaceId; title: string }
  | { kind: "folder"; id: FolderId; title: string; project: boolean }
  | { kind: "task"; id: TaskId; title: string }
```

Wrike's API has no starred items, so favorites are local and kept per account.

## Scopes and lists

A scope is what the list pane shows.

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
  next: string | null             // nextPageToken, null when complete
  loading: "first" | "more" | null
  error: WrikeError | null
}
```

Task lists are kept per `ScopeKey`, the eight most recently shown, plus My
to-do and the current scope, which always stay. Showing a list that is still
held draws it at once and fetches its first page again behind it. The next
page loads when the cursor comes within 20 rows of the end of what is loaded,
or on `Enter` on the "Load more" row. A page never loads by itself, so a
filter that matches few tasks in a list of thousands does not fetch the whole
list. The pane title shows how much is loaded, for example
`Service Requests  200+ · status`, and loses the `+` when the list is complete.

Active tasks are the default. `x` brings in completed, cancelled and deferred
tasks, which fetches the first page again without the `status` filter. Search
starts with every status.

### Shaping

Shaping is client side, over the tasks that are loaded, in one pure function.

```ts
type GroupKey = "status" | "importance" | "assignee" | "due" | "folder" | "none"
type SortKey = "due" | "importance" | "status" | "title" | "updated" | "created"
type SortTerm = { key: SortKey; dir: "asc" | "desc" }

type Filter =
  | { kind: "assignee"; ids: UserId[] }          // the ID "nobody" stands for unassigned tasks
  | { kind: "status"; ids: CustomStatusId[] }
  | { kind: "importance"; values: Importance[] }
  | { kind: "due"; range: "overdue" | "today" | "week" | "none" }
  | { kind: "text"; query: string }              // title contains, typed with `f`

type ColumnKey = "importance" | "title" | "status" | "assignees" | "due" | "start" | "updated" | "folder" | "id"

type ListSpec = {
  group: GroupKey
  subgroup: GroupKey
  sort: SortTerm[]               // the first decides, the rest break ties
  filters: Filter[]              // at most one of each kind
  completed: boolean             // the `x` toggle
  columns: ColumnKey[]
}

type ListRow =
  | { kind: "group"; id: RowId; key: string; label: string; count: number; depth: 0 | 1; collapsed: boolean }
  | { kind: "task"; id: RowId; task: Task; depth: number; hasChildren: boolean; expanded: boolean }
  | { kind: "more"; id: RowId; label: string }

function shapeList(tasks: Task[], spec: ListSpec, ctx: ShapeContext): ListRow[]
```

- **Filters** apply to every task. Several filters must all hold.
- **Subtasks** nest under a parent that is in the list after filtering, and
  are closed until `Space` opens the parent. A subtask whose parent is not
  loaded, or is filtered out, is a top-level row. A task's `depth` counts its
  parents.
- **Groups** are rows that `Space` or `Enter` closes and opens. Grouping and
  sorting act on top-level rows, and subtasks keep the same sort inside their
  parent. Status groups follow the workflow order. An assignee grouping draws
  a task under each of its people. The folder grouping uses the task's first
  parent that is in a loaded space tree, else "Other folders".
- **Sorting.** A task with no due date sorts after every dated one in either
  direction. Titles sort without regard to case and with numbers in order.

The cursor is a row identity, `task:<id>` or `group:<key>`, plus the index it
was last at. `cursorIndex` finds the row with that identity, else another
drawing of the same task, else the row now at the old index. So shaping,
paging and saves never move the cursor off its task, and when the task goes
away the cursor stays in place.

Defaults per kind of scope:

| Scope | Group | Sort | Columns |
| --- | --- | --- | --- |
| My to-do | due | due, importance, title | importance, title, status, due |
| Search | none | updated, newest first | importance, title, status, folder, updated |
| Space, folder, project | status | importance, due, title | importance, title, assignees, due |

Each scope keeps its own `ListSpec`. A scope seen for the first time starts
from the config's default for its kind.

## App state

The app is one reducer over one state object. Components never fetch. An
effect runner turns `Effect` values returned by the reducer into API calls and
file writes, and dispatches the result back as actions, which is what lets the
reducer stay pure and lets tests run with a fake Wrike.

`src/app/reducer.ts` holds `start`, `reduce` and the dispatcher that routes each
action. The handlers live in `src/app/reduce/`, split by what they change.
`core.ts` has the helpers every handler shares. `load.ts` fetches and settles
results, and shows a scope. `nav.ts` has the tree and the favorites. `lists.ts`
has the list pane: the cursor, grouping, filters and the pickers that shape it.
`task.ts` has the open task and its edits. `comments.ts` has the selection in
the details pane, the comment box, and the edits and deletes of comments. The
modules depend in one direction, `core` then `load`, then `nav`, `lists`,
`comments` and `task`, and `nav` calls into `lists` and `task` into
`comments`.
`reducer.ts` imports them all, and nothing in `reduce/` imports `reducer.ts`.

```ts
type Pane = "nav" | "list" | "details"

type Loadable<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T }
  | { state: "error"; error: WrikeError; previous?: T }

type ListView = { spec: ListSpec; cursor: RowCursor | null; collapsed: Set<string>; expanded: Set<TaskId> }

type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "filter-input"; draft: string }
  | { kind: "edit"; field: number }
  | { kind: "edit-text"; field: "title" | "start" | "due"; draft: string; error?: string; origin: Origin }
  | { kind: "picker"; field: PickerField; query: string; cursor: number; chosen: string[]; origin: Origin }
  | Compose
  | { kind: "confirm-delete"; id: CommentId }   // only `y` deletes
  | { kind: "palette"; query: string; cursor: number }
  | { kind: "help" }

type Compose = {
  kind: "compose"
  draft: string
  editing: CommentId | null      // the comment being edited, or null for a new one
  mentions: Mention[]            // they follow the draft's edits
  pick: number                   // the highlighted person while a mention is typed
  dismissed: number | null       // the `@` whose list Esc closed
}

// What `]` and `[` step through, in the order the details pane draws it. Attachments join this union.
type DetailsItem = { kind: "comment"; id: CommentId }

type State = {
  profile: Profile
  readOnly: boolean
  clock: { now: string; today: string }
  settings: Settings                          // the config file: theme, nav width, list defaults
  scope: Scope
  focus: Pane
  zoom: boolean
  inbox: Loadable<InboxEntry[]>
  includeRead: boolean
  lists: Map<ScopeKey, Paged<Task>>           // least recently shown first
  views: Map<ScopeKey, ListView>
  lastSearch: string
  spaces: Loadable<Space[]>
  trees: Map<SpaceId, Loadable<SpaceTree>>
  nav: { cursor: NavPath; expanded: Set<NavPath> }
  favorites: Favorite[]
  missing: Set<string>                        // favorites Wrike answered 404 for
  openTaskId: TaskId | null
  details: Loadable<{ task: Task; comments: Comment[]; folders: string[] }>
  selected: DetailsItem | null                // kept by identity, cleared when another task opens
  contacts: Map<UserId, Contact>
  workflows: Workflow[]
  spaceWorkflows: "unloaded" | "loading" | "loaded"
  mode: Mode
  flash: { tone: "info" | "error"; text: string } | null
  afterOpen: TaskCommand | null
  requests: Map<string, number>
}
```

Four fields carry what the reducer needs to stay pure and correct.

- `clock` is the time of the last list load. The due buckets and the relative
  times read it, so the reducer never asks the system for the time. While the
  selected comment is mine and its edit window is open, `keepClock` in
  `src/app/ticker.ts` dispatches a `clock` action at once and then every
  second, so the countdown ticks and the refusal after five minutes is exact.
  The clock only ever lags the real time, so a countdown that looks open
  starts the ticker and the first tick corrects it.
- `requests` holds the latest request number per target: `inbox`, `details`,
  `spaces`, `tree:<spaceId>` and `list:<scopeKey>`. A response that carries an
  older number is dropped, so a slow answer never overwrites a newer one, and
  a page that answers after a reload is not appended.
- `afterOpen` holds a task key pressed on a list row whose task is not open
  yet. The reducer opens the task and runs the command when the details
  arrive. Every edit therefore acts on the task shown in the details pane.
- `spaceWorkflows` makes the space workflow load happen once.

A saved task replaces its copy in the details and in every list that holds it.
A list of active tasks loses a task that was closed. My to-do also gains a
task that became mine and loses one that was handed off, with no refetch.

The rows of the list pane and of the nav pane are selectors that remember
their last result, keyed on the state parts they read. A cursor move changes
none of those parts, so it does not shape the list again.

`r` reloads the list and the open task, and also the contacts, the workflows,
the spaces list and the trees of the spaces that are open.

Text is typed into OpenTUI's `<input>`, which gives cursor movement and line
editing. The input reports each change as a `draft` action, so the draft still
lives in the mode. A picker and the palette take their text as key presses,
because every letter filters there. A key the keymap binds in the current
mode is not also typed into the field.

The comment box is a `<textarea>` instead, because a comment has lines and an
`<input>` strips newlines and stops at 1,000 characters. `Alt+Enter` and
`Ctrl+J` start a new line, the box grows to eight lines and then scrolls, and
a draft the reducer changes, like a picked mention, is put back into the field
with the cursor at the end. Wrike takes up to 10,000 characters of comment
text as sent, mention anchors included. A longer comment is refused with its
length and the draft stays in the box.

Editing the description and composing a long comment suspend the renderer and
open `$VISUAL`, then `$EDITOR`, then `vi`, on a temp file. The effect resumes
the renderer and reads the file. An unchanged file is a cancel, and so are a file
that differs only by whitespace stripped from line ends, which many editors do
on save, and an editor that exits with an error. The comment box stays open while the editor
runs, and the text that comes back goes through the same submit as `Enter`,
for a new comment and for an edit.

A comment is selected with `]` and `[`. `Enter` on it edits it and `d` deletes
it, and both say why when the comment is someone else's. An edit opens the
comment box on the comment's text and is refused after five minutes. A delete
asks in the status bar and only `y` sends it. A 404 on a delete means the
comment is already gone, and it leaves the thread with a neutral message. A
404 on an edit does the same.

Typing `@` and a letter at the end of the comment box lists up to five active
people with a word of their name starting so. The list is derived from the
draft, so it closes by itself once the mention is typed past. While it is
open the `mention` context comes before `compose`, and `Enter` and `Esc` act
on the list.

`o` runs `$BROWSER` when it is set, and the platform opener otherwise. `y` and
`Y` copy with the OSC 52 terminal sequence. Inside tmux the sequence is
written plain, which tmux reads itself. OpenTUI's own call wraps it in a tmux
passthrough, and tmux drops that unless `allow-passthrough` is on.

## Commands and keys

One command registry, `src/app/commands.ts`, holds everything the client can
do.

```ts
type Context = "global" | "nav" | "list" | "task" | "details" | "edit" | "picker" | "text" | "mention" | "compose" | "confirm" | "palette" | "help"

type Command = {
  id: string                     // stable, for example "list.group.status"
  title: string                  // "Group by status"
  group: "Navigate" | "Task" | "List" | "View" | "Favorites" | "Theme" | "App"
  keywords?: string[]
  contexts: Context[]
  when?: (state: State) => boolean
  hint?: string | ((state: State) => string)   // a short label for the status bar
  run: (state: State) => Action
}

type KeyBinding = { context: Context; key: string; command: string }
```

A command's `run` returns an intent, one of the reducer's actions, such as
`{ type: "spec", change: { set: "group", group: "status" } }`. A key press and
the palette both end there, so there is one path into the reducer for each
thing the client does.

The keymap table, `src/app/keymap.ts`, binds keys to command IDs per context.
The contexts that are active come from the mode and the focused pane. A
command whose `when` does not hold leaves its key unbound, which is how `a`
works only in the Inbox and `Space` toggles only in a picker that takes
several choices. The `?` legend, the status bar hints and the palette all read
these two tables. A test walks both and fails on a binding that names no
command, on a key that runs two commands among contexts that are active
together, on a command that neither a key nor the palette reaches, and on a
command whose intent the reducer does not handle.

`:` opens the palette over the focused pane. It lists the commands whose
contexts include one of that pane's browse contexts and whose `when` holds.
With nothing typed they come under their group headings. A query ranks them
flat by a fuzzy match on the title, and on the keywords at a small discount.
Each line shows the keys that run the command there. Grouping, subgrouping,
sorting, the filters, the columns, expand all, collapse all, the themes and
"Save as default" live only in the palette. A filter command opens the picker
for its values.

| Where | Keys |
| --- | --- |
| Anywhere in browse | `1` `2` `3` focus a pane, `h` `l` or the arrows move between panes, `i` Inbox, `t` My to-do, `/` search, `:` commands, `r` refresh, `v` zoom details, `?` keys, `q` quit |
| The navigation pane | `j` `k` move, `Enter` show the row in the list, `Space` open or close the row, `F` favorite, `J` `K` move a favorite |
| A list | `j` `k` move, `g` `G` top and bottom, `Enter` open, `Space` open or close subtasks or a group, `x` completed on or off, `f` filter by title, `a` read notifications on or off (Inbox) |
| The details pane | `j` `k` scroll, `g` `G` top and bottom, `]` `[` select a comment, and on a selected comment `Enter` edit, `d` delete, `Esc` clear |
| A task (list or details) | `e` edit fields, `s` status, `p` importance, `A` assignees, `m` assign to me, `c` comment, `E` description in the editor, `o` open in browser, `y` copy the URL, `Y` copy the ID, `F` favorite |
| Edit mode | `j` `k` walk fields, `Enter` open the field, `Esc` leave |
| Picker | arrows or `Ctrl+N` `Ctrl+P` move, typing filters, `Backspace` erases, `Space` toggles (assignees, filters, columns), `Enter` applies, `Esc` cancels |
| Palette | typing filters, arrows or `Ctrl+N` `Ctrl+P` move, `Backspace` erases, `Enter` runs, `Esc` closes |
| Text field | `Enter` saves, `Esc` discards |
| Comment | `Enter` posts or saves the edit, `Alt+Enter` and `Ctrl+J` start a new line, `Ctrl+E` moves the draft to the editor, `Esc` discards |
| Mention list | arrows or `Ctrl+N` `Ctrl+P` move, `Tab` or `Enter` writes the name, `Esc` closes the list |
| Delete confirm | `y` deletes, any other key keeps the comment |
| Legend | `j` `k` scroll, `Esc`, `?` or `q` closes |

In a picker and in the palette every letter filters, so `j` and `k` do not
move there. `Y` copies the number from the permalink, which is the ID Wrike
shows people and the one search accepts.

## Navigation pane

The pane is one list of rows built by a pure function, `navRows`, from the
view counts, the favorites, the spaces, the loaded trees and the set of
expanded paths.

```ts
type NavPath = Brand<string, "NavPath">   // "view:todo", "fav:folder:<id>", "space:<id>", "space:<id>/<folderId>/<folderId>"

type NavRow =
  | { kind: "heading"; label: string }                                  // the cursor steps over it
  | { kind: "note"; depth: number; text: string; tone: "info" | "error" }
  | { kind: "view"; path: NavPath; view: "inbox" | "todo" | "search"; count: number | null }
  | { kind: "node"; path: NavPath; depth: number; node: FolderNode | Space;
      expandable: boolean; expanded: boolean; loading: boolean }
  | { kind: "favorite"; path: NavPath; favorite: Favorite; depth: 0; missing: boolean }
```

The order is the three views, then Favorites when there are any, then Spaces,
Personal first and the rest by title. A folder's children are drawn in
`childIds` order. Only expanded paths are walked, so the cost follows what is
open and not the size of the tree. A folder met again on its own path is drawn
and never opened again.

`Enter` on a space or folder row scopes the list to it and opens the row. The
focus stays in the tree, so the next folder down is one more `Enter` away.
`Enter` on a view goes to the list. `Space` opens or closes a row without
changing the list. Opening a space for the first time loads its tree, from the
disk cache first and then from Wrike.

The cursor is a path. A rebuild never moves it, and when its row is gone it
goes to the nearest ancestor that is still drawn. A tree or the spaces list
that failed to load leaves a short note in the pane, and the status bar gives
the reason.

`F` on a tree row, a list row or the open task adds or removes a favorite.
`Enter` on a folder or space favorite scopes the list and goes to it, and on a
task favorite opens the task. A favorite's title is refreshed when the item is
seen again, in a tree, a list page or the details. A favorite Wrike answers
404 for is drawn dim with "not found" until it is seen again or removed.

## Files on disk

Each file is parsed with zod. A file that does not parse is renamed to
`<name>.bad`, the defaults load, and the status bar says so once. A write goes
through a temp file and a rename.

| File | Holds | Written |
| --- | --- | --- |
| `$XDG_CONFIG_HOME/wrike-tui/config.json` | `theme`, `navWidth` (16 to 60, default 30), `completed`, and `lists`: a partial `ListSpec` per kind of scope (`todo`, `search`, `space`, `folder`, `project`) | by hand, and by the palette's "Save as default", which writes the theme in use and the current list's shaping for scopes of its kind |
| `$XDG_STATE_HOME/wrike-tui/<accountId>/session.json` | the scope, the nav cursor and expanded paths, the focus, the zoom, the open task, the read toggle, and the `ListSpec`, cursor, closed groups and open subtasks of up to 50 scopes | at quit, and every 30 seconds when it changed |
| `$XDG_STATE_HOME/wrike-tui/<accountId>/favorites.json` | the favorites, in order | after each change |
| `$XDG_CACHE_HOME/wrike-tui/<accountId>/spaces.json` and `tree-<spaceId>.json` | the spaces list and each opened space's tree, with the time fetched | after a fetch that differs from what was held |

Every part of the config is optional. `completed` sets whether a list starts
with closed tasks in, for every kind but search, and a kind's own `completed`
wins. Every field of the session but the scope has a default, which is how a
session written before a field existed keeps loading. A file with another
`version` is moved aside.

A launch reads the config, the favorites, the session, the cached spaces and
the cached trees of the spaces the session has open, all before the first
frame, so the first frame already shows the workspace. The fetches that follow
replace what the cache painted only when they differ. The lists themselves are
not cached. They are fetched again, and the saved cursor finds its row when
the list arrives.

## Themes

A theme is a named set of the color tokens in `src/ui/theme.ts`, and
components read it from a React context. Four ship: `terminal`, `dark`,
`light` and `high-contrast`. `terminal` is the default. It paints the
terminal's own 16 colors and its default foreground and background through
OpenTUI's indexed colors, so the client follows the terminal's theme. The
palette's Theme commands switch at once, and "Save as default" writes the
config.

`test/ui/theme-contrast.test.ts` measures every text color against the
background, the panels and the cursor row. `dark` and `light` must reach WCAG
AA (4.5 to 1) and `high-contrast` AAA (7 to 1). `terminal` has no fixed colors
to measure.

## Layout

Three panes, left to right. Each title carries its number.

1. **Nav**, 30 columns unless the config says otherwise. The views with their
   counts, the favorites, the spaces and their folders, and the user's name at
   the bottom.
2. **List**, half of what the nav pane leaves. An Inbox row is two lines:
   type, item and age, then author and the first line of the comment. A task
   row draws the columns of its `ListSpec`. When the title would get fewer
   than 24 columns, columns drop in this order: ID, folder, start, updated,
   assignees, status. The title names the scope, how much is loaded and what
   is applied, and a long scope name gives way to the rest.
3. **Details**, the other half. Title, a field block (status, importance,
   assignees, start, due, folders, permalink), the description as markdown,
   then comments, oldest first, in one scrollbox. The selected comment has a bar
   on its left and scrolls into view, and when it is mine its header counts
   down the edit window ("editable for 3:12"). The comment box opens at the
   bottom of the pane, titled with the time left during an edit, and the list
   of people to mention opens above it.

Only the rows on screen are rendered, in the list and in the nav pane.

Under 100 columns the nav pane hides. Focusing it with `1` or `h` shows it in
place of the details pane until the focus leaves. `v` widens details over the
list. Pickers, the palette and the legend draw as a centered overlay, and the
legend scrolls when it is taller than the screen. A one-line status bar at the
bottom shows the flash message on the left, the keys for the focused context
on the right, and "read-only" at the far right while writes are refused. Below
60 columns or 12 rows the client asks for a larger terminal.

## Performance

Measured on the compiled binary in a detached tmux session, read-only against
a production account. Launch and tree times are the time until tmux shows the
screen, polled every 2 ms. Key times come from `WRIKE_TUI_FRAME_LOG`.

| What | Time | Bound by |
| --- | --- | --- |
| Opening the largest space, 3,550 folders, nothing cached | 464 to 653 ms from the key to the tree painted, median 511 ms, 5 runs | the `GET /spaces/{id}/folders` request, 760 KB, which took 530 to 580 ms by itself in the probes |
| The same space from the disk cache | 22 to 24 ms, 5 runs | reading and parsing the 440 KB cache file takes about 3 ms, the rest is one frame and the terminal |
| `j` in a list of 1,059 tasks, 30 keys a second | median 0.65 ms from the key to the composed frame, 95th percentile 1.05 ms, worst 1.64 ms, 150 keys | OpenTUI's scene step and text measurement, then React's reconciliation of the rows on screen. The reducer takes 0.004 ms. |
| A regroup or a resort from the palette on 1,059 tasks | 2.6 to 4.1 ms from `Enter` to the composed frame, 9 commands | `shapeList` takes about 1.2 ms, the frame the rest |
| Launch with a session and a cache, to the nav pane painted | 275 to 317 ms, 5 runs | the binary's own start takes 120 ms, and a token from `WRIKE_TOKEN` is probed with one request before anything is drawn. Against a local fake Wrike the same launch takes 206 to 216 ms. |

Both key times are far under the 50 ms where a list feels slow, with only the
rows on screen rendered. A key time ends when the frame is composed and does
not include the terminal's own drawing.

## Testing

- **Unit.** `bun run test` covers the domain functions, `shapeList` and the
  cursor identity, `navRows`, the patch encoder, the HTML rules, the comment
  rules (the body sent, the text to edit, mentions through edits), the zod
  parsers (fed the response shapes saved under `test/fixtures/`), the
  transport with paging, `Retry-After` and read-only mode, the files on disk,
  the auth commands, the reducer, the session, the palette's matching and
  scoping, and the registry and keymap tables.
- **Fake Wrike.** `test/fake/wrike.ts` is one in-memory server with synthetic
  data. It serves the REST calls and a minimal MCP Streamable HTTP endpoint,
  checks the token, records every write and can be told to fail. It edits and
  deletes comments with Wrike's answers, a 404 included, and stores mention
  HTML as sent. A test can set the clock that stamps new comments. Its
  workspace has the shape measured on a real account: a space of 3,548
  folders, six levels deep, 18 of them under two parents, and a folder of
  1,040 active tasks that pages the way Wrike does, down to a follow-up page
  that loses its optional fields when `fields` is not repeated. Tests call its
  `fetch` in process. `test/fake/serve.ts` puts it on a port.
- **Screen.** `testRender` from `@opentui/react/test-utils` renders the whole
  app with the real client wired to the fake Wrike and the real files in a
  temp directory, and asserts on captured frames, on the recorded writes and
  on the files after scripted keys. A second app opened on the same directory
  proves the session, the favorites and the cache come back. A test can move
  the clock forward, and the countdowns on screen follow it.
- **End to end.** `bun run e2e` compiles the binary and drives it in a
  detached tmux session on a private socket against the fake Wrike on a port:
  login, every Phase 1 flow, every Phase 2 flow at 160 by 45 and at 80 by 24,
  the comment flows of Phase 3 on the real clock, restarts, logout. It saves
  every screen to `$WRIKE_TUI_E2E_CAPTURES`. The binary runs in the time zone
  of the test process, because `bun test` runs in UTC and the fake lays its
  dates out there.
- **Live.** The same binary runs against real Wrike with `WRIKE_TOKEN` and
  `WRIKE_TUI_READ_ONLY=1` in a detached tmux session. This has been done by
  hand for every Phase 2 flow and is not part of the test suite.
