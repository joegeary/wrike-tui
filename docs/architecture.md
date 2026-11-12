# Architecture

wrike-tui is TypeScript on Bun, rendered by OpenTUI through
`@opentui/react`. `bun build --compile` produces one binary.

## Layers

Data flows one way. Each layer depends only on the layer under it.

    src/cli/        argv parsing, `auth login|logout|status`, launching the TUI
    src/auth/       token resolution and storage, data-center probing
    src/wrike/      HTTP transport, REST client, MCP inbox client, zod schemas
    src/domain/     branded IDs, the task model, pure functions over it
    src/app/        the app state machine (reducer), keymap table, effects
    src/ui/         React components that render state and dispatch actions

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

**REST client.** One object with one method per call the app makes, and no
more:

| Method | Call |
| --- | --- |
| `me()` | `GET /contacts?me=true` |
| `contacts()` | `GET /contacts` (people only, active) |
| `workflows()` | `GET /workflows`, then `GET /spaces/{id}/workflows` for a status not found there |
| `myTasks(userId)` | `GET /tasks?responsibles=[me]&status=Active&subTasks=true&sortField=DueDate` |
| `searchTasks(query)` | `GET /tasks?title=<q>&sortField=UpdatedDate&sortOrder=Desc&pageSize=100` |
| `taskByPermalink(url)` | `GET /tasks?permalink=<url>` |
| `taskIdFromLegacy(n)` | `GET /ids?ids=[n]&type=ApiV2Task` |
| `task(id)` | `GET /tasks/{id}` |
| `updateTask(id, patch)` | `PUT /tasks/{id}` |
| `comments(id)` | `GET /tasks/{id}/comments` |
| `addComment(id, text)` | `POST /tasks/{id}/comments` with `plainText=true` |
| `folders(ids)` | `GET /folders/{ids}` for the titles of a task's parents |

**MCP inbox client.** Inbox has no REST endpoint, so `inbox()` talks to
`https://mcp.wrike.com/v2` with the same Bearer token through
`@modelcontextprotocol/sdk` (`StreamableHTTPClientTransport`). It calls
`get_my_inbox` with `{ includeRead, limit: 100 }`, takes the JSON from the
tool result's text content, and parses it with zod into `InboxEntry[]`. The
connection is opened lazily and reused.

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

type InboxKind = "Mention" | "Assign" | "Comment" | "Status" | "Other"
type InboxEntry = {
  id: string
  kind: InboxKind
  unread: boolean
  ts: string
  item: { legacyId: LegacyItemId; title: string; baseType: "TASK" | "FOLDER" | "PROJECT"; permalink: string } | null
  author: { name: string } | null
  commentText: string | null
}
```

An unrecognized `notificationType` maps to `Other` and keeps its raw label
for display, so a new Wrike notification type never fails the parse.

**Edits** are one union, and one function turns a patch into `PUT` params:

```ts
type TaskPatch =
  | { field: "title"; title: string }
  | { field: "status"; statusId: CustomStatusId }
  | { field: "importance"; importance: Importance }
  | { field: "assignees"; add: UserId[]; remove: UserId[] }
  | { field: "dates"; dates: TaskDates }
  | { field: "description"; html: string }
```

**My to-do buckets** are a pure function of the tasks and today's date in the
user's zone: Overdue, Today, This week, Later, No date. Inside a bucket the
order is due date, then importance, then title.

**Descriptions.** `htmlToMarkdown` renders a description for reading.
`editableDescription(html)` decides the edit format. When the HTML uses only
tags that survive a round trip through markdown (`p`, `br`, `h1` to `h6`,
`b`, `strong`, `i`, `em`, `s`, `a`, `ul`, `ol`, `li`), the editor gets
markdown and `markdownToHtml` converts it back. When the HTML holds anything
else (`u`, a highlight `span`, `img`, `table`), the editor gets the raw HTML,
so a save never strips formatting the user did not touch. The status bar says
which format is open.

## App state

The app is one reducer over one state object. Components never fetch. An
effect runner turns `Effect` values returned by the reducer into API calls and
dispatches the result back as actions, which is what lets the reducer stay
pure and lets tests run with a fake client.

```ts
type View = "inbox" | "todo" | "search"
type Pane = "nav" | "list" | "details"

type Loadable<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T }
  | { state: "error"; error: WrikeError; previous?: T }

type Mode =
  | { kind: "browse" }
  | { kind: "search-input"; draft: string }
  | { kind: "edit"; field: number }
  | { kind: "edit-text"; field: "title" | "start" | "due"; draft: string; error?: string }
  | { kind: "picker"; field: "status" | "importance" | "assignees"; query: string; cursor: number; chosen: string[] }
  | { kind: "compose"; draft: string }
  | { kind: "help" }

type State = {
  profile: Profile
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
  mode: Mode
  flash: { tone: "info" | "error"; text: string } | null
}
```

Editing the description and composing a long comment suspend the renderer and
open `$VISUAL`, then `$EDITOR`, then `vi`, on a temp file. The effect resumes
the renderer and dispatches the file's contents. An unchanged file is a
cancel.

## Keys

Keys live in one table: `context → key → action id`, where the context is
derived from the mode and the focused pane. The table drives dispatch and the
`?` legend, so a key cannot work without being listed or be listed without
working. A test walks the table and fails on a duplicate or an action with no
handler.

| Where | Keys |
| --- | --- |
| Anywhere in browse | `1` `2` `3` focus a pane, `h` `l` move between panes, `i` Inbox, `t` My to-do, `/` search, `r` refresh, `v` zoom details, `?` keys, `q` quit |
| A list | `j` `k` move, `g` `G` top and bottom, `Enter` open, `a` read notifications on or off (Inbox) |
| A task (list or details) | `e` edit fields, `s` status, `p` importance, `A` assignees, `m` assign to me, `c` comment, `E` description in the editor, `o` open in browser, `y` copy the URL, `Y` copy the ID |
| Edit mode | `j` `k` walk fields, `Enter` open the field, `Esc` leave |
| Picker | `j` `k` or arrows move, typing filters, `Space` toggles (assignees), `Enter` applies, `Esc` cancels |
| Text field | `Enter` saves, `Esc` discards |

## Layout

Three panes, left to right. Each title carries its number.

1. **Nav**, 22 columns. Inbox with its unread count, My to-do with its count,
   Search with the last query.
2. **List**, flexible. Rows for the current view. My to-do shows bucket
   headings as rows the cursor steps over.
3. **Details**, 50 percent. Title, a field block (status, importance,
   assignees, start, due, folders, permalink), the description as markdown,
   then comments, oldest first, in one scrollbox.

Under 100 columns the nav pane hides. `v` widens details over the list. A
one-line status bar at the bottom shows the flash message on the left and the
keys for the focused context on the right.

## Testing

- **Unit.** `bun test` over the domain functions, the patch encoder, the HTML
  rules, the zod parsers (fed the real response shapes saved under
  `test/fixtures/`), the reducer and the keymap table.
- **Screen.** `testRender` from `@opentui/react/test-utils` renders the whole
  app against a fake client and asserts on captured frames after scripted
  keys: open a task from the Inbox, filter My to-do, search by permalink, edit
  a status, post a comment.
- **Live.** The compiled binary runs in a detached tmux session against real
  Wrike with `WRIKE_TOKEN`, read-only, and `tmux capture-pane` saves each frame.
