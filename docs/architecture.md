# Architecture

wrike-tui is TypeScript on Bun, rendered by OpenTUI through
`@opentui/react`. `bun build --compile` produces one binary.

## Layers

Data flows one way. Each layer depends only on the layers under it.

    src/cli/        argv parsing, `auth login|logout|status`, launching the TUI
    src/ui/         React components that render state and dispatch actions,
                    and the terminal handoffs (editor, browser, clipboard)
    src/app/        the app state machine (reducer), keymap table, effects
    src/auth/       token resolution and storage, data-center probing
    src/wrike/      HTTP transport, REST client, MCP inbox client, zod schemas
    src/domain/     branded IDs, the task model, pure functions over it

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

Three variables exist for development and tests. `WRIKE_BASE_URL` replaces the
whole REST base and may be plain http. `WRIKE_MCP_URL` replaces the MCP
endpoint. `WRIKE_TUI_KEYRING_SERVICE` renames the keyring service, so a test
run never reads or writes the real token.

## Wire

**Transport.** One `request()` builds `https://<host>/api/v4/<path>`, sends
`Authorization: bearer <token>`, and encodes array and object query params as
JSON strings the way Wrike expects (`responsibles=["KUAJ25LC"]`). Writes use
`PUT` or `POST` with an `application/x-www-form-urlencoded` body. A 429 retries
with exponential backoff up to three times. Errors become one tagged union:

```ts
type WrikeError =
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
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
| `contacts()` | `GET /contacts?types=["Person"]`, then people who are not deleted |
| `workflows()` | `GET /workflows` |
| `spaceWorkflows()` | `GET /spaces`, then `GET /spaces/{id}/workflows` for each space |
| `myTasks(userId)` | `GET /tasks?responsibles=[me]&status=Active&subTasks=true&sortField=DueDate` |
| `searchTasks(query)` | `GET /tasks?title=<q>&sortField=UpdatedDate&sortOrder=Desc&pageSize=100` |
| `taskByPermalink(url)` | `GET /tasks?permalink=<url>` |
| `taskIdFromLegacy(n)` | `GET /ids?ids=[n]&type=ApiV2Task` |
| `task(id)` | `GET /tasks/{id}` |
| `updateTask(id, patch)` | `PUT /tasks/{id}` |
| `comments(id)` | `GET /tasks/{id}/comments`, sorted oldest first |
| `addComment(id, text)` | `POST /tasks/{id}/comments` with `plainText=true` |
| `folders(ids)` | `GET /folders/{ids}` for the titles of a task's parents |

Every task list call adds `fields=["responsibleIds","parentIds","description"]`,
because Wrike leaves those out of a list and the app's `Task` always carries
them.

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
  permalink: string
  descriptionHtml: string
  updatedDate: string
}

type Comment = { id: string; authorId: UserId; text: string; createdDate: string }
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

**My to-do buckets** are a pure function of the tasks and today's date in the
user's zone: Overdue, Today, This week, Later, No date. "This week" runs
through the Sunday of the current week. Inside a bucket the order is due date,
then importance, then title.

**Search.** `classifyQuery` tells a permalink (`https://.../open.htm?id=N`), a
bare number and a title apart. A permalink or a number opens the task it
finds.

**Descriptions.** `htmlToMarkdown` renders a description for reading.
`editableDescription(html)` decides the edit format. When the HTML uses only
tags that survive a round trip through markdown (`p`, `br`, `h1` to `h6`,
`b`, `strong`, `i`, `em`, `s`, `a`, `ul`, `ol`, `li`), the editor gets
markdown and `markdownToHtml` converts it back. When the HTML holds anything
else (`u`, a highlight `span`, `img`, `table`, a mention anchor with a
`class`), the editor gets the raw HTML, so a save never strips formatting the
user did not touch. The status bar says which format was saved.

`markdownToHtml` writes only tags from Wrike's documented description set. A
paragraph break becomes `<br /><br />`, because `<p>` is not in that set.

Comments are shown as plain text through `htmlToText`.

## App state

The app is one reducer over one state object. Components never fetch. An
effect runner turns `Effect` values returned by the reducer into API calls and
dispatches the result back as actions, which is what lets the reducer stay
pure and lets tests run with a fake Wrike.

```ts
type View = "inbox" | "todo" | "search"
type Pane = "nav" | "list" | "details"

type Loadable<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T }
  | { state: "error"; error: WrikeError; previous?: T }

type Origin = "browse" | "edit"   // where a field editor returns to

type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "edit"; field: number }
  | { kind: "edit-text"; field: "title" | "start" | "due"; draft: string; error?: string; origin: Origin }
  | { kind: "picker"; field: "status" | "importance" | "assignees"; query: string; cursor: number; chosen: string[]; origin: Origin }
  | { kind: "compose"; draft: string }
  | { kind: "help" }

type State = {
  profile: Profile
  clock: { now: string; today: string }
  view: View
  focus: Pane
  zoom: boolean
  lists: { inbox: Loadable<InboxEntry[]>; todo: Loadable<Task[]>; search: Loadable<Task[]> }
  includeRead: boolean
  searchQuery: string
  cursor: Record<View, number>
  openTaskId: TaskId | null
  details: Loadable<{ task: Task; comments: Comment[]; folders: string[] }>
  contacts: Map<UserId, Contact>
  workflows: Workflow[]
  spaceWorkflows: "unloaded" | "loading" | "loaded"
  mode: Mode
  flash: { tone: "info" | "error"; text: string } | null
  afterOpen: TaskCommand | null
  requests: Record<View | "details", number>
}
```

Four fields carry what the reducer needs to stay pure and correct.

- `clock` is the time of the last list load. The buckets and the relative
  times read it, so the reducer never asks the system for the time.
- `requests` holds the latest request number per list and for the details. A
  response that carries an older number is dropped, so a slow answer never
  overwrites a newer one.
- `afterOpen` holds a task key pressed on a list row whose task is not open
  yet. The reducer opens the task and runs the command when the details
  arrive. Every edit therefore acts on the task shown in the details pane.
- `spaceWorkflows` makes the space workflow load happen once.

A saved task replaces its copy in the details and in the lists. My to-do gains
a task that became mine and loses one that is completed or handed off, with no
refetch.

Text is typed into OpenTUI's `<input>`, which gives cursor movement and line
editing. The input reports each change as a `draft` action, so the draft still
lives in the mode.

Editing the description and composing a long comment suspend the renderer and
open `$VISUAL`, then `$EDITOR`, then `vi`, on a temp file. The effect resumes
the renderer and reads the file. An unchanged file is a cancel, and so is an
editor that exits with an error.

`o` runs `$BROWSER` when it is set, and the platform opener otherwise. `y` and
`Y` copy with the OSC 52 terminal sequence. Inside tmux the sequence is
written plain, which tmux reads itself. OpenTUI's own call wraps it in a tmux
passthrough, and tmux drops that unless `allow-passthrough` is on.

## Keys

Keys live in one table in `src/app/keymap.ts`: `context → key → command`,
where the active contexts are derived from the mode, the focused pane and the
view. The table drives dispatch, the status bar hints and the `?` legend, so a
key cannot work without being listed or be listed without working. A test
walks the table and fails on a duplicate, on a key bound twice among contexts
that are active together, and on a command with no handler or a handler with
no key.

| Where | Keys |
| --- | --- |
| Anywhere in browse | `1` `2` `3` focus a pane, `h` `l` or the arrows move between panes, `i` Inbox, `t` My to-do, `/` search, `r` refresh, `v` zoom details, `?` keys, `q` quit |
| The navigation pane | `j` `k` step through the views, `Enter` goes to the list |
| A list | `j` `k` move, `g` `G` top and bottom, `Enter` open, `a` read notifications on or off (Inbox) |
| The details pane | `j` `k` scroll, `g` `G` top and bottom |
| A task (list or details) | `e` edit fields, `s` status, `p` importance, `A` assignees, `m` assign to me, `c` comment, `E` description in the editor, `o` open in browser, `y` copy the URL, `Y` copy the ID |
| Edit mode | `j` `k` walk fields, `Enter` open the field, `Esc` leave |
| Picker | arrows or `Ctrl+N` `Ctrl+P` move, typing filters, `Backspace` erases, `Space` toggles (assignees), `Enter` applies, `Esc` cancels |
| Text field | `Enter` saves, `Esc` discards |
| Comment | `Enter` posts, `Ctrl+E` moves the draft to the editor, `Esc` discards |
| Legend | `Esc`, `?` or `q` closes |

In a picker every letter filters, so `j` and `k` do not move there. `Y` copies
the number from the permalink, which is the ID Wrike shows people and the one
search accepts.

## Layout

Three panes, left to right. Each title carries its number.

1. **Nav**, 22 columns. Inbox with its unread count, My to-do with its count,
   Search with the last query, and the user's name at the bottom.
2. **List**, flexible. Rows for the current view. An Inbox row is two lines:
   type, item and age, then author and the first line of the comment. My to-do
   shows bucket headings as rows the cursor steps over. A task row drops its
   status column when the pane is narrow.
3. **Details**, 50 percent. Title, a field block (status, importance,
   assignees, start, due, folders, permalink), the description as markdown,
   then comments, oldest first, in one scrollbox. The comment box opens at the
   bottom of the pane.

Under 100 columns the nav pane hides. Focusing it with `1` or `h` shows it in
place of the details pane until the focus leaves. `v` widens details over the
list. Pickers and the legend draw as a centered overlay. A one-line status bar
at the bottom shows the flash message on the left and the keys for the focused
context on the right. Below 60 columns or 12 rows the client asks for a larger
terminal.

## Testing

- **Unit.** `bun run test` covers the domain functions, the patch encoder, the
  HTML rules, the zod parsers (fed the response shapes saved under
  `test/fixtures/`), the transport, the auth commands, the reducer and the
  keymap table.
- **Fake Wrike.** `test/fake/wrike.ts` is one in-memory server with synthetic
  data. It serves the REST calls and a minimal MCP Streamable HTTP endpoint,
  checks the token, records every write and can be told to fail. Tests call
  its `fetch` in process. `test/fake/serve.ts` puts it on a port.
- **Screen.** `testRender` from `@opentui/react/test-utils` renders the whole
  app with the real client wired to the fake Wrike, and asserts on captured
  frames and on the recorded writes after scripted keys.
- **End to end.** `bun run e2e` compiles the binary and drives it in a
  detached tmux session on a private socket against the fake Wrike on a
  port: login, every Phase 1 flow, an 80-column terminal, logout. It saves
  every screen to `$WRIKE_TUI_E2E_CAPTURES`.
- **Live.** The same binary runs against real Wrike with `WRIKE_TOKEN`,
  read-only, in a detached tmux session. This has not been automated.
