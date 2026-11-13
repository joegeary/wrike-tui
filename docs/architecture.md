# Architecture

wrike-tui is TypeScript on Bun, rendered by OpenTUI through
`@opentui/react`. `bun build --compile` produces one binary.

## Layers

Data flows one way. Each layer depends only on the layers under it.

    src/cli/        argv parsing, `auth login|logout|status`, `update`, launching
                    the TUI
    src/ui/         React components that render state and dispatch actions,
                    and the terminal handoffs (editor, browser, clipboard)
    src/app/        the app state machine (reducer, with its handlers in
                    reduce/), the command registry, the keymap table, the nav
                    rows, the palette, the session, effects, the clock ticker
    src/persist/    the files on disk: config, session, favorites, cache
    src/auth/       token resolution and storage, data-center probing
    src/wrike/      HTTP transport, REST client, MCP client, zod schemas
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
`bytes()` is a GET whose answer is a file, not JSON. It returns the body in
memory and writes it nowhere.

A 429 retries up to three times. It waits for the `Retry-After` header when
Wrike sends one, as seconds or as an HTTP date, capped at 60 seconds. Without
the header it backs off exponentially.

In read-only mode a request that is not a GET fails with `read_only` before
anything is sent, and the status bar shows "read-only mode: not saved". The MCP
client refuses `submit_requestform`, its one write, the same way. A 429 from the MCP server is
`rate_limited` too, and so is a tool result whose text is not JSON and says
"rate limit", which is how Wrike's MCP server reports one. Errors become one tagged
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
  | { kind: "unavailable"; message: string }   // MCP said in plain text to retry later
```

A tool result whose text is not JSON and says "A server error occurred" or
"Retry later", as `get_requestform` answered during the probe, is
`unavailable`, and the form screen offers to try again.

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
| `customFields()` | `GET /customfields`, every definition; one in a shape this version cannot read is left out |
| `spaceWorkflows()` | `GET /spaces`, then `GET /spaces/{id}/workflows` for each space |
| `spaces()` | `GET /spaces`, then the spaces that are not archived |
| `spaceTree(id)` | `GET /spaces/{id}/folders`, as a map of folder nodes |
| `tasks(query, { completed, pageToken })` | One page of a task list, see below |
| `taskByPermalink(url)` | `GET /tasks?permalink=<url>` |
| `taskIdFromLegacy(n)` | `GET /ids?ids=[n]&type=ApiV2Task` |
| `task(id)` | `GET /tasks/{id}` |
| `updateTask(id, patch)` | `PUT /tasks/{id}` |
| `updateTasks(ids, patch)` | `PUT /tasks/{a},{b},...`, 100 IDs to a request. Importance goes one task at a time. A request that fails fails only its tasks, and the rest are still sent |
| `createTask(task)` | `POST /folders/{id}/tasks` with `title`, and `responsibles` and `superTasks` when set. The ID may be a space's |
| `deleteTask(id)` | `DELETE /tasks/{id}`. Wrike's 400 for a task already in the Recycle Bin comes back as `"already-deleted"`, not as an error |
| `comments(id)` | `GET /tasks/{id}/comments`, sorted oldest first |
| `addComment(id, body)` | `POST /tasks/{id}/comments`, with `plainText=true` unless the comment holds a mention |
| `updateComment(id, body)` | `PUT /comments/{id}`, the same parameters |
| `deleteComment(id)` | `DELETE /comments/{id}` |
| `folders(ids)` | `GET /folders/{ids}` for the IDs and titles of a task's parents, in the order of `ids` |
| `attachments(id)` | `GET /tasks/{id}/attachments`, sorted oldest first |
| `attachmentPreview(id)` | `GET /attachments/{id}/preview`, a small PNG of an image, through `bytes()` |
| `attachmentUrl(id)` | `GET /attachments/{id}/url`, a temporary signed link that opens without the token |
| `inbox(options)`, `history(item, page)`, the request form calls | the MCP client, below |

`tasks()` serves four queries, 200 tasks to a page.

| Query | First page |
| --- | --- |
| `mine` | `GET /tasks?responsibles=[me]&subTasks=true&sortField=DueDate` |
| `title` | `GET /tasks?title=<q>&sortField=UpdatedDate&sortOrder=Desc` |
| `space` | `GET /spaces/{id}/tasks?descendants=true&subTasks=true` |
| `folder` | `GET /folders/{id}/tasks?descendants=true&subTasks=true` |

A first page adds `status=Active` unless completed tasks are wanted, and
`fields=["responsibleIds","parentIds","description","subTaskIds","superTaskIds","customFields"]`,
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

These facts about creating and reshaping tasks come from probes against a
production account.

- `POST /folders/{id}/tasks` with `title` creates a task in that folder,
  project or space. A subtask is the same call with `superTasks=["<parent>"]`
  and lands in the folder named in the path. `POST /tasks/{id}/tasks` answers
  `method_not_found`.
- `PUT /tasks/{id}` with `addParents` or `removeParents` files a task in
  folders or takes it out. Removing every parent answers 200 and moves the
  task to the account root, `IEAA5UTEI7777777`, so the client never removes
  a task's last folder.
- `DELETE /tasks/{id}` moves the task to the Recycle Bin, where its `scope`
  is `RbTask`. Its subtasks are detached and stay active as top-level tasks.
  Deleting it again answers 400 `invalid_request`, "Operation is not allowed
  on deleted Folder/Task".
- Cancelling is a status change to a status in the Cancelled group of the
  task's workflow.

These facts about bulk updates come from probes against a production account.

- `PUT /tasks/{a},{b}` takes `customStatus`, `addResponsibles`,
  `removeResponsibles` and `customFields` for up to 100 tasks at once.
- `importance` there answers 400 "Parameter 'importance' is not allowed".

These facts about custom fields come from probes against a production account.

- `GET /customfields` returned 107 definitions shaped
  `{id, title, type, settings, archived, sharedIds, sharing, description}`.
  Types were DropDown, Text, Checkbox, Numeric, Multiple, Percentage, Date,
  Currency, Duration and CalculatedNumeric. Choices are in `settings.values`
  and `settings.options[{value, color?}]`, beside `allowOtherValues` and
  `readOnly`. Numeric, Currency and Percentage carry `decimalPlaces`, Currency
  a `currency` code, Date `allowTime`.
- A task carries `customFields: [{id, value}]`, and every value is a string:
  Numeric `"7"`, Percentage `"40"`, Date `"2026-11-20"`. A Multiple written as
  a list reads back as plain text for one choice and as a JSON-array string
  for several.
- `PUT /tasks/{id}` with `customFields=[{"id":..,"value":..}]` writes a field.
  `value: null` clears it. An empty string leaves it as it was.
- Wrike stores any string in any field, `"abc"` in a Numeric and
  `"next week"` in a Date, so the client checks what it sends.
- Checkbox, Currency and Duration writes on a task the field did not apply to
  answered 200 and were not stored. A write to a read-only field answers 200.
  No call says which fields apply to a task: a folder's `customColumnIds` are
  its table columns.

`spaceWorkflows()` runs at most once per session. The reducer asks for it the
first time a task in a list or in the details has a status that the account
workflows do not hold.

**MCP client.** The Inbox and field history have no usable REST endpoint, so
`src/wrike/mcp.ts` talks to `https://mcp.wrike.com/v2` with the same Bearer
token through `@modelcontextprotocol/sdk` (`StreamableHTTPClientTransport`).
Each call takes the JSON from the tool result's text content and parses it
with zod. The connection is opened on the first call and shared by every
call after it. A failed call drops and closes the connection it used, unless
another call has already replaced it, so the next call connects again.

| Method | Tool |
| --- | --- |
| `inbox({ includeRead })` | `get_my_inbox` with `{ includeRead, limit: 100 }`, into `InboxEntry[]` |
| `history(item, { pageSize, pageToken })` | `get_item_history` with `{ scope: { type: "ITEMS", itemIds: ["w:itm:<N>"] }, requestedChanges, pageSize, nextPageToken }`, into a `HistoryPage` |

| `requestForms(text)` | `search_requestforms` with `{ textSearch, limit: 10 }`, into `FormSummary[]` |
| `requestForm(form)` | `get_requestform` with `{ form }` for the page index, then once per page that is not an orphan with `{ form, pageIds: [page], includePageIndex: false }`, into a `FormDefinition` |
| `submitRequestForm(form, answers)` | `submit_requestform` with `{ form, fields: [{ field, values }] }`, into a `Submission` |
| `submission(job)` | `get_asyncjob` with `{ jobId }`: completed, failed, or still waiting |

`N` is the number in the task's permalink. `requestedChanges` asks for title,
assignees, parents, status, start and due dates, duration, attachments and
custom fields. Changes come newest first, and only of those types. Wrike
leaves out an item with no change of them (`{"taskChanges":[]}`), which is
an empty page. An item Wrike could not read comes back with
`success: false` and an error, which becomes `invalid` with Wrike's words. REST's `GET /tasks/{id}/tasks_history` was probed first and
answers with nothing but the task's ID.

The request form tools are read from Wrike's published tool schemas and are
not verified against a live answer. REST's `GET /request_forms` lists the
forms with their pages, but submitting takes MCP IDs (`w:rf:N`, `w:rffld:S`,
`w:rfopt:S`), so the whole flow goes through MCP. Each page is loaded on its
own call because the tool fails an answer past its size limit. An option's
title and a condition's parts are read from any of the likely keys, since the
schemas do not pin them down. A submission refused with `{ retrySafe, message }`
becomes `refused`.

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
type AttachmentId = Brand<string, "AttachmentId">

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
  fields: FieldValue[]   // the custom fields set on the task
  createdDate: string
  updatedDate: string
}

type Comment = { id: CommentId; authorId: UserId; text: string; createdDate: string }
type Contact = { id: UserId; name: string; email: string | null }

// storage is "Wrike" for an upload, or the service of a linked file ("Google", "Box").
type Attachment = { id: AttachmentId; name: string; storage: string; contentType: string | null; size: number | null; authorId: UserId; createdDate: string }

// `from` is null when Wrike sent no old value, and `to` is null only for a cleared field.
type HistoryChange =
  | { kind: "title"; from: string | null; to: string }
  | { kind: "status"; from: string | null; to: string }
  | { kind: "assignees"; added: string[]; removed: string[] }
  | { kind: "parents"; added: string[]; removed: string[] }
  | { kind: "attachments"; added: string[]; removed: string[] }
  | { kind: "start"; from: string | null; to: string | null }
  | { kind: "due"; from: string | null; to: string | null }
  | { kind: "duration"; from: number | null; to: number | null }
  | { kind: "field"; name: string; from: string | null; to: string | null }   // a custom field
  | { kind: "other"; type: string; action: string }
// `at` is null when Wrike's timestamp is not a time.
type HistoryEntry = { at: string | null; author: string | null; change: HistoryChange }
type HistoryPage = { entries: HistoryEntry[]; next: string | null }

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

**History.** `HistorySchema` reads each change through a `Map` keyed by its
type and action (`DUE_DATE UPDATE`, `ATTACHMENTS ADD`), one payload reader per
entry, in the shapes measured on real tasks. A pair missing from the map, or
a payload that does not match its reader, becomes `other` and is still drawn
by its type and action ("custom fields changed"), so a change Wrike adds
later never fails the parse or goes missing. A field reads as cleared only
when the payload names an old value and no new one. A missing key is an
unknown shape, not a clear. A multi-select field is drawn by its new choices. An author is a name, because history names
people by their MCP ID (`w:usr:N`), which the REST contacts do not carry.
`describeChange` writes the line the stream shows: `status Active → On Hold`,
`assigned Pat Example`, `due 2026-11-12 → 2026-11-20`, `moved into Q4 Launch`,
`attached notes.txt`, `Work Type: DB`, `Labels: auth, sso`. A change whose
timestamp is not a time is drawn without one, after its neighbour on Wrike's
page.

**Custom fields.** `src/domain/fields.ts` holds the definitions and the rules
for their values.

```ts
type CustomFieldId = Brand<string, "CustomFieldId">
type FieldKind =
  | { type: "Text" } | { type: "Checkbox" } | { type: "Duration" }   // a duration is minutes
  | { type: "DropDown" | "Multiple"; options: string[]; allowOther: boolean }
  | { type: "Numeric" | "Percentage" | "CalculatedNumeric"; decimals: number | null }
  | { type: "Currency"; decimals: number | null; currency: string }
  | { type: "Date"; allowTime: boolean }
  | { type: "Unknown"; wireType: string }   // a type this version does not know
type CustomField = { id: CustomFieldId; title: string; kind: FieldKind; readOnly: boolean; archived: boolean }
type FieldValue = { id: CustomFieldId; value: string }   // as Wrike stores it
type FieldWrite = string | string[] | null               // null clears
```

The wire keeps the values as Wrike's strings and drops an empty one, which
shows nothing. `fieldText` draws a value by its type: choices as text, several
as a comma list, numbers with the field's decimal places, a currency with its
code, a percent sign, a checkbox as yes or no, a duration as `2h 30m`. A value
that does not fit its type, and an unknown type, show as stored. `parseInput`
checks typed text before it is sent: a number against the decimal places, a
date as `YYYY-MM-DD`, a duration in hours and minutes, sent as minutes because
Wrike counts every duration in minutes and hours need no guess at the length
of a working day. Empty text is a clear. `fieldEditor` names the editor a
field takes, or why it has none: read-only, calculated, or unknown. `kept`
tells whether Wrike's answer holds a write.

**Request forms.** `src/domain/forms.ts` holds a form and the rules for
walking it.

```ts
type Condition = { option: FormOptionId | null; title: string | null }   // an option picked, by ID or title
type FormFieldKind =
  | { type: "text"; lines: "one" | "many" } | { type: "date" } | { type: "number" }
  | { type: "choice"; options: FormOption[]; multi: boolean }   // combo box, check boxes, importance
  | { type: "attachment" } | { type: "unsupported"; wireType: string }   // a user field among them
type FormField = { id: FormFieldId; title: string; mandatory: boolean; helperText: string; kind: FormFieldKind; visibleWhenAny: Condition[] }
type PageVisibility = { kind: "entry" } | { kind: "orphan" } | { kind: "after"; pages: FormPageId[] } | { kind: "condition"; after: FormPageId[]; when: Condition[] }
type FormDefinition = { form: FormSummary; pages: FormPage[] }   // index order, orphans left out
type Answers = ReadonlyMap<FormFieldId, readonly string[]>
type Submission = { kind: "completed"; item: LegacyItemId } | { kind: "processing"; submission: string } | { kind: "refused"; message: string; retrySafe: boolean }
```

`formFlow` derives the pages the answers reach: the entry page, each page
after a page shown, and each conditional page whose condition an answer meets
and whose earlier pages, when it names any, are shown. Orphans never show.
`formSteps` lists their fields, leaving out a field that waits for an option
not picked. Nothing stores the path, so changing an answer changes the steps
after it. `answerProblem` refuses an empty required field, a date that is not
`YYYY-MM-DD` and a number that is not one. A field the terminal cannot fill,
a file or a person, blocks only when it is required. `submission` sends the
answered fields of the steps shown, so an answer on a page that stopped
showing stays behind. `formUrl` opens the form in Wrike's web app, by the
number of `w:rf:N` in a `formid` link, which is not verified.

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
  | { field: "parents"; add: FolderId[]; remove: FolderId[] }   // addParents, removeParents
  | { field: "custom"; id: CustomFieldId; value: FieldWrite }   // customFields=[{id, value}]
```

A new task is its own shape, because Wrike creates it with another call:

```ts
type FolderRef = { id: FolderId; title: string }   // a folder, project or space as a task names it
type NewTask = { title: string; folder: FolderId; parent: TaskId | null; assignees: UserId[] }
```

`cancelStatuses(workflows, status)` gives the visible statuses in the
Cancelled group of the workflow that holds the task's status.

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
mention becomes Wrike's anchor. HTML collapses runs of spaces, so every other
space of a run, and every space that starts a line, is `&nbsp;`, and reading
the comment back turns them into spaces again. Only a mention picked from the list is an
anchor, so an `@name` typed by hand stays text. `followEdit` moves the
mentions with each edit of the draft, and drops one the edit touched.
`refindMentions` finds them again in text that comes back from the editor:
each name binds its picks to its places in document order, longer names
first, and only where the name does not run on into a longer word. When two
people picked under one name no longer match the count of that name in the
text, nothing says who is still meant, so neither stays a mention, the box
stays open with the editor's text, and the status bar asks to pick again.

`editableComment(html)` gives a comment back as text to edit, with mentions as
`@Full Name`. When the HTML holds anything but text, `<br />` and mentions, it
gives null and the edit is refused, so a save never strips formatting. It
reads the HTML with domino, like the description code, so the text is what a
browser shows: every character reference decoded, and a newline in the source
a space, or nothing at the start or end of a line.

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
the details pane, the comment box, and the edits and deletes of comments.
`work.ts` creates, files, cancels and deletes tasks. `bulk.ts` runs the task
commands on marked tasks, and `fields.ts` hands it a field written to several.
`forms.ts` has the request form picker and screen. The modules depend in one
direction, `core` then `load`, then `nav`, `lists`, `comments`, `work`,
`bulk`, `fields`, `forms` and `task`, and `nav` calls into `lists` and `task`
into `comments`, `work`, `bulk` and `fields`.
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
  | { kind: "edit"; field: number }   // an index into editRows
  | EditTextMode
  | PickerMode
  | Compose
  | { kind: "new-task"; draft: string; plan: TaskPlan; error?: string }
  | { kind: "confirm"; target: ConfirmTarget }   // only `y` goes ahead
  | { kind: "palette"; query: string; cursor: number }
  | { kind: "help" }
  | FormMode

// A request form: loading, failed (Enter retries), filled a step at a time, or a submission Wrike is still processing.
type FormMode = { kind: "form"; form: FormSummary } & (
  | { phase: "loading" }
  | { phase: "failed"; error: WrikeError }
  | { phase: "filling"; definition: FormDefinition; answers: Answers; at: number; draft: string; cursor: number; error?: string; sending: boolean }
  | { phase: "processing"; submission: string }
)

type EditTextMode = { kind: "edit-text"; draft: string; error?: string; origin: Origin } &
  ({ field: "title" | "start" | "due" } | { field: "custom"; edit: FieldEdit })
type PickerMode = { kind: "picker"; query: string; cursor: number; chosen: string[]; origin: Origin } &
  (
    | { field: TaskPicker | ListPicker | WorkPicker | "request-form" }
    | { field: "set-field"; taskIds: TaskId[] }
    | { field: "custom"; edit: FieldEdit }
    | { field: "bulk"; change: "status" | "importance" | "assignees" | "cancel"; tasks: BulkTask[]; assigned: UserId[] }
  )

// A custom field being changed and the tasks the value goes to.
type FieldEdit = { id: CustomFieldId; taskIds: TaskId[] }

type Compose = {
  kind: "compose"
  draft: string
  editing: CommentId | null      // the comment being edited, or null for a new one
  mentions: Mention[]            // they follow the draft's edits
  pick: number                   // the highlighted person while a mention is typed
  dismissed: number | null       // the `@` whose list Esc closed
}

// Where a new task goes and who gets it. Only the title is still to come.
type TaskPlan = { folder: FolderRef; parent: { id: TaskId; title: string } | null; assignees: UserId[] }
type BulkTask = { id: TaskId; title: string }
type ConfirmTarget =
  | { kind: "comment"; id: CommentId }
  | { kind: "task"; id: TaskId; title: string; subtasks: number }
  | { kind: "delete-tasks"; tasks: BulkTask[] }
  | { kind: "cancel-tasks"; plan: (BulkTask & { statusId: CustomStatusId })[] }

// One change to several tasks, and what it did task by task.
type BulkJob =
  | { kind: "update"; tasks: BulkTask[]; patch: TaskPatch; done: string; check?: FieldCheck }
  | { kind: "cancel"; plan: (BulkTask & { statusId: CustomStatusId })[] }
  | { kind: "delete"; tasks: BulkTask[] }
type BulkOutcome = { saved: Task[]; deleted: { task: BulkTask; result: "deleted" | "already-deleted" }[]; failed: { task: BulkTask; error: WrikeError }[] }

// What `]` and `[` step through, in the order the details pane draws it: the attachments, then the comments.
type DetailsItem = { kind: "attachment"; id: AttachmentId } | { kind: "comment"; id: CommentId }

type State = {
  profile: Profile
  readOnly: boolean
  clock: { now: string; today: string }
  settings: Settings                          // the config file: theme, nav width, history, list defaults
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
  details: Loadable<{ task: Task; attachments: Attachment[]; attachmentsError?: WrikeError; comments: Comment[]; folders: FolderRef[] }>
  selected: DetailsItem | null                // kept by identity, cleared when another task opens
  histories: Map<TaskId, Paged<HistoryEntry>> // field history per task, kept for the session
  previews: Map<AttachmentId, Loadable<Uint8Array>>   // up to 20 thumbnails, in memory only
  contacts: Map<UserId, Contact>
  workflows: Workflow[]
  customFields: Loadable<CustomField[]>      // painted from the cache, fetched with the contacts
  spaceWorkflows: "unloaded" | "loading" | "loaded"
  mode: Mode
  flash: { tone: "info" | "error"; text: string } | null
  lastFolder: FolderRef | null                // where the last task of the session was created
  afterOpen: TaskCommand | null
  requests: Map<string, number>
  marks: Set<TaskId>                          // marked tasks of the current list, cleared when the scope changes
  forms: Loadable<FormSummary[]>              // what the form search found for the typed text
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
  `spaces`, `fields`, `tree:<spaceId>`, `list:<scopeKey>`, `history:<taskId>`,
  `forms` and `form`. A response that carries an
  older number is dropped, so a slow answer never overwrites a newer one, and
  a page that answers after a reload is not appended.
- `afterOpen` holds a task key pressed on a list row whose task is not open
  yet. The reducer opens the task and runs the command when the details
  arrive. Every edit therefore acts on the task shown in the details pane.
- `spaceWorkflows` makes the space workflow load happen once.

A saved task replaces its copy in the details and in every list that holds it.
A list of active tasks loses a task that was closed. My to-do also gains a
task that became mine and loses one that was handed off, with no refetch.

**New tasks.** `n` in a space, folder or project creates the task there. In
My to-do, Search and the Inbox it first opens a picker of folders: the folder
the last task of the session went to, the favorite folders and projects, and
every folder, project and space of the loaded trees, each with its space's
name. `N` creates a subtask of the open task, in the parent's first folder,
else the scoped folder, else a picked one. The title is typed in the list
pane. An empty title is refused. In My to-do the new task is assigned to the
user, so it shows there. Elsewhere nobody gets it. The created task joins the
list it was created from, the held lists of its folders and My to-do when it
is mine. A parent gains it in `subTaskIds` and opens in that list. The task
is selected and opened, and the flash says that `e` edits its fields.

**Filing.** `L` picks one more folder or project for the open task from the
loaded trees and the favorites, leaving out spaces and the folders it is in.
The palette's "Take out of a folder" picks one of its folders. A task in one
folder is refused with "A task stays in at least one folder", because Wrike
would move it to the account root. After either save the effect names the
task's folders again, so the Folders line follows. The list the task left
keeps it until the next refresh.

**Cancel and delete.** The palette's "Cancel the task" sets the one Cancelled
status of the task's workflow, or opens a picker when the workflow has
several. `D` asks in the status bar, like a comment delete, and says how many
subtasks stay behind as top-level tasks. Only `y` deletes. A deleted task
leaves every list and the details pane, its subtasks lose it as a parent, its
parent stops counting it, and a favorite of it is marked "not found". Wrike's
answer that it was already deleted ends the same way, with a neutral flash.

In read-only mode `n`, `N`, `D`, `L`, cancel, take out, every command on marks
and "Submit a request form" are refused before a picker, a prompt or a
question opens.

**Bulk edit.** `M` on a task row toggles its mark and moves to the next task,
past group headings. `markedTasks` is the current list's tasks that carry a
mark, in list order, so a task that left the list stops counting. The list
title shows the count, and marked rows carry a `✓` column while any are
marked. Marks clear on `Esc`, on "Clear marks" and when the scope changes.

While the list pane has the focus and tasks are marked, `onTask` hands status,
importance, assignees, assign to me, "Set a field", cancel and delete to
`bulk.ts`. The details pane always acts on the open task. Status offers the
statuses every marked task's workflow shares, and refuses tasks of different
workflows. The assignee picker starts with the people on every marked task
checked; it adds the people checked and removes the ones it started with that
were unchecked, one patch for all. Each change goes only to the tasks it would
change. A field written to several tasks goes through the same editors with a
`FieldEdit` of the marked IDs; its text is typed in the list pane, since no
details row belongs to it. Cancel finds each task's Cancelled status: one per
workflow goes to a confirm, several in one shared workflow go to a picker, and
several across workflows are refused. Delete and cancel ask once in the status
bar and go one request per task.

A bulk job is one `bulk` effect. The runner sends it to the end and reports a
`BulkOutcome`. `bulkDone` puts each saved task where it is listed, drops each
deleted one the way a single delete does, and writes one flash: "Status set
to Done on 7 tasks", "..., failed on 2: <reason>", or, for a field Wrike did
not keep, "Wrike did not keep Size on 2 tasks".

**Request forms.** "Submit a request form" opens a picker whose text is sent
to `search_requestforms` once typing pauses for 250 ms: the `search-forms`
effect waits and reports back, and only the latest request number searches.
`Enter` loads the form, its index and then each page. The form screen shows
one field at a time with its page, its place among the steps, its helper text
and its editor: a line, a box of lines for a long text, or a list of choices.
`Enter` keeps the answer and moves on once `answerProblem` accepts it, and
`Ctrl+B` goes back without checking. After the last step a review lists every
answer, and `Enter` there jumps to the first field that blocks sending, or
sends the form. While Wrike has the submission `Esc` waits. `completed` closes
the form and opens the created task through the legacy ID lookup.
`processing` polls `get_asyncjob` every 5 seconds for a minute and never
submits again; closing the form or running out of polls says the request will
show in Wrike when it is done. A `refused` answer that is safe to retry stays
on the review with Wrike's words, and one that is not closes the form. A field
the terminal cannot fill says so, and `o` opens the form in the browser.

The rows of the list pane and of the nav pane are selectors that remember
their last result, keyed on the state parts they read. A cursor move changes
none of those parts, so it does not shape the list again.

`r` reloads the list and the open task, and also the contacts, the workflows,
the custom field definitions,
the spaces list, the trees of the spaces that are open, and the open task's
history while history is shown.

**Custom fields** load at launch and on `r` beside the contacts and
workflows. The launch paints them from `fields.json` in the cache, and a fetch
that matches writes nothing.

The edit walk steps through `editRows`: the fields every task has, then the
open task's custom fields as the pane draws them, by title. The details pane
scrolls the row the walk is on into view. `Enter` on a custom field opens its
editor. A drop-down is a picker over its choices, with "Other value..." only
when the field allows one; it takes what was typed into the filter. A
multi-select is a picker that toggles with `Space`. A checkbox flips at once.
Text, numbers, dates and durations are typed in place and checked by
`parseInput`, and a refusal stays in the field with the reason in the status
bar. Every editor can clear: "Clear the field", nothing chosen, an empty
input, a checkbox flipped off. A read-only, calculated or unknown field says
why it cannot be edited.

The editors take a `FieldEdit` and never read the task list, so one value
chosen once is written to each task in `taskIds`, one update each. The
details pane passes the open task. Each update carries a `FieldCheck`, what it
sent, and `taskSaved` looks for it in Wrike's answer: a value Wrike did not
keep flashes "Wrike did not keep <field> on this task. It may not apply here."
The task is drawn as Wrike answered, so the field is not shown as set.

"Set a field" in the palette opens the `set-field` picker over the fields that
can be written: not archived, not read-only, not calculated, not unknown. The
fields set on the current list's tasks come first, the most used first, then
the rest by title. Each line shows the task's value or the kind of value the
field takes. A field the task does not have is typed in place in the Fields
section, in its title order, with a placeholder that says what it takes.

**History** is fetched after the details arrive, because the MCP call needs
the number in the task's permalink. Opening a task makes that one MCP call,
for the newest 50 changes, only while history is shown and only when the
session holds no history for the task. Reopening the task costs nothing, and
after a failed try only `r` asks again. While `r` or a reopen reloads the
task, the held history stays drawn. A save made in the app asks again for the
drawn task's history, and drops what is held for any other task, so its next
view asks once. `H` turns history off and on, and turning it on
fetches the open task's history if it was never fetched. Older pages load
only from the palette's "Load older changes". A failed or rate-limited load
keeps the comments and says so in one line above them. `settings.history`
holds the toggle, so the config sets it at launch and "Save as default"
writes it, the way the theme works.

**Attachments** load with the task, in parallel with the task and its
comments. They are decoration like the folder titles: a failed call leaves
the task drawn and says so under "Attachments", and a file in a shape this
version cannot read is left out of the list. `Enter` on a selected file asks
Wrike for a signed link (`GET /attachments/{id}/url`) and hands it to the
browser, the same handoff as `o`. A link that is not an absolute https URL is
an invalid response and is never launched. The client never downloads a
file. Selecting an image Wrike stores fetches its preview once into
`previews`, refused past 1 MB. The 20 most recently selected are kept. A
failed fetch waits for `r`, and the reload fetches the selected image again.

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

`]` and `[` select the attachments and then the comments, the order the pane
draws them. `Enter` acts on the selection, so one command, `details.act`,
holds the key: it opens a file and edits a comment. `d` deletes a comment.
Both say why when the comment is someone else's. An edit opens the
comment box on the comment's text and is refused after five minutes. A delete
asks in the status bar and only `y` sends it. A 404 on a delete means the
comment is already gone, and it leaves the thread with a neutral message. A
404 on an edit does the same.

Typing `@` and a letter at the end of the comment box lists up to five active
people with a word of their name starting so. The list is derived from the
draft, so it closes by itself once the mention is typed past. While it is
open the `mention` context comes before `compose`, and `Enter` and `Esc` act
on the list.

`o` runs `$BROWSER` when it is set, and the platform opener otherwise:
`xdg-open` on Linux and `open` on macOS. Windows has no opener that takes a
URL as a plain argument (`cmd /c start` splits it at `&`), so there `o`
asks for `BROWSER`. `y` and
`Y` copy with the OSC 52 terminal sequence. Inside tmux the sequence is
written plain, which tmux reads itself. OpenTUI's own call wraps it in a tmux
passthrough, and tmux drops that unless `allow-passthrough` is on.

## Commands and keys

One command registry, `src/app/commands.ts`, holds everything the client can
do.

```ts
type Context = "global" | "nav" | "list" | "task" | "details" | "edit" | "picker" | "text" | "mention" | "compose" | "confirm" | "palette" | "help" | "form"

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
"Save as default", "Cancel the task", "Take out of a folder", "Clear marks"
and "Submit a request form" live only in the palette, though `Esc` in the list
also clears marks. A filter command opens the picker for its values.

| Where | Keys |
| --- | --- |
| Anywhere in browse | `1` `2` `3` focus a pane, `h` `l` or the arrows move between panes, `i` Inbox, `t` My to-do, `/` search, `:` commands, `r` refresh, `v` zoom details, `H` field history on or off, `?` keys, `q` quit |
| The navigation pane | `j` `k` move, `Enter` show the row in the list, `Space` open or close the row, `F` favorite, `J` `K` move a favorite |
| A list | `j` `k` move, `g` `G` top and bottom, `Enter` open, `Space` open or close subtasks or a group, `x` completed on or off, `f` filter by title, `a` read notifications on or off (Inbox), `M` mark, `Esc` clear the marks |
| The details pane | `j` `k` scroll, `g` `G` top and bottom, `]` `[` select an attachment or a comment, `Enter` open the selected file or edit the selected comment, `d` delete the selected comment, `Esc` clear |
| A task (list or details) | `e` edit fields (the walk goes on into the custom fields), `s` status, `p` importance, `A` assignees, `m` assign to me, `c` comment, `E` description in the editor, `o` open in browser, `y` copy the URL, `Y` copy the ID, `F` favorite, `n` new task, `N` new subtask, `D` delete, `L` file in another folder |
| Edit mode | `j` `k` walk fields, `Enter` open the field, `Esc` leave |
| Picker | arrows or `Ctrl+N` `Ctrl+P` move, typing filters, `Backspace` erases, `Space` toggles (assignees, filters, columns), `Enter` applies, `Esc` cancels |
| Palette | typing filters, arrows or `Ctrl+N` `Ctrl+P` move, `Backspace` erases, `Enter` runs, `Esc` closes |
| Text field | `Enter` saves, or creates the new task, `Esc` discards |
| Comment | `Enter` posts or saves the edit, `Alt+Enter` and `Ctrl+J` start a new line, `Ctrl+E` moves the draft to the editor, `Esc` discards |
| Mention list | arrows or `Ctrl+N` `Ctrl+P` move, `Tab` or `Enter` writes the name, `Esc` closes the list |
| Confirm | `y` deletes, or cancels the marked tasks, any other key keeps them |
| Request form | `Enter` next field or send, `Ctrl+B` back, arrows or `Ctrl+N` `Ctrl+P` move among choices, `Space` toggles a check box, `o` opens the form in the browser where nothing is typed, `Esc` closes |
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
| `$XDG_CONFIG_HOME/wrike-tui/config.json` | `theme`, `navWidth` (16 to 60, default 30), `completed`, `history` (default true), and `lists`: a partial `ListSpec` per kind of scope (`todo`, `search`, `space`, `folder`, `project`) | by hand, and by the palette's "Save as default", which writes the theme in use, the history toggle and the current list's shaping for scopes of its kind |
| `$XDG_STATE_HOME/wrike-tui/<accountId>/session.json` | the scope, the nav cursor and expanded paths, the focus, the zoom, the open task, the read toggle, and the `ListSpec`, cursor, closed groups and open subtasks of up to 50 scopes | at quit, and every 30 seconds when it changed |
| `$XDG_STATE_HOME/wrike-tui/<accountId>/favorites.json` | the favorites, in order | after each change |
| `$XDG_CACHE_HOME/wrike-tui/<accountId>/spaces.json` and `tree-<spaceId>.json` | the spaces list and each opened space's tree, with the time fetched | after a fetch that differs from what was held |
| `$XDG_CACHE_HOME/wrike-tui/<accountId>/fields.json` | the custom field definitions, with the time fetched | after a fetch that differs from what was held |

Every part of the config is optional. `completed` sets whether a list starts
with closed tasks in, for every kind but search, and a kind's own `completed`
wins. Every field of the session but the scope has a default, which is how a
session written before a field existed keeps loading. A file with another
`version` is moved aside.

A launch reads the config, the favorites, the session, the cached custom
fields, the cached spaces and the cached trees of the spaces the session has
open, all before the first frame, so the first frame already shows the workspace. The fetches that follow
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
   assignees, start, due, folders, permalink), the task's custom fields under
   `Fields` by title with their values drawn by type (left out when the task
   has none), the description as markdown,
   the attachments, then comments and field history oldest first, in one
   scrollbox. `Attachments (n)` lists each file on one line, cut to the
   pane's width: name, kind, size, author and the day it was added. The
   section is left out when a task has no files. The selected file has a bar
   on its left, and a selected image draws its thumbnail below it through
   OpenTUI's `<image>` with the protocol on `auto` (kitty graphics where the
   terminal reports it, blocks inside tmux), in a 24 by 8 box. An image that cannot be decoded says so
   in a line instead. The heading `Comments (n) · 11 changes` counts the
   changes, with a `+` while older ones are not loaded. A change is one dim
   line, `author  time  change`, and wraps only when it is longer than the
   pane. The selected comment has a bar on its left and scrolls into view,
   and when it is mine its header counts down the edit window ("editable for
   3:12"). The comment box opens at the bottom of the pane, titled with the
   time left during an edit, and the list of people to mention opens above
   it.

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

## Releases and update

`src/version.ts` holds `VERSION`. `bun run build` runs `scripts/build.ts`,
which compiles with `--define WRIKE_TUI_VERSION="<version>"`. The release
workflow sets `WRIKE_TUI_VERSION` to the tag without its `v`. Anywhere else the
build defines `<package.json version>-dev`, and `bun run dev` defines nothing,
which reads as the same `-dev` version. The MCP client reports `VERSION` too.

`.github/workflows/release.yml` runs on a pushed `v*` tag. It builds on native
runners (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel`),
because OpenTUI loads a native library from a per-platform package. Each job
checks that `--version` prints the tag's version and packs
`wrike-tui-<os>-<arch>.tar.gz`, where `<os>` and `<arch>` are Bun's
`process.platform` and `process.arch`. The last job writes `SHA256SUMS` and
runs `gh release create --generate-notes`, and it is the only job with
`contents: write`.

`wrike-tui update` (`src/cli/update.ts`):

1. A `-dev` version stops with "This is a local build. Rebuild it from the
   source instead." This keeps it away from builds from source and from
   `bun run dev`, where `process.execPath` is Bun itself.
2. `GET https://api.github.com/repos/joegeary/wrike-tui/releases/latest`
   without a token. A 404 means nothing is released yet.
3. If the tag is not newer than `VERSION`, it says so. `--check` stops here.
4. It downloads the tarball for this platform and `SHA256SUMS` and checks the
   tarball's hash before it reads it. `Bun.Archive` unpacks the binary in memory.
5. It writes the binary to `.wrike-tui-update-<pid>` in the directory of
   `realpath(process.execPath)`, sets mode 755, runs it with `--version`, and
   renames it over the real path. A symlink on `PATH` keeps pointing at the
   same file, and the path always holds a whole binary. Any failure removes
   the temp file and leaves the old binary in place.

## Testing

- **Unit.** `bun run test` covers the domain functions, `shapeList` and the
  cursor identity, `navRows`, the patch encoder, the HTML rules, the comment
  rules (the body sent, the text to edit, mentions through edits), the zod
  parsers (fed the response shapes saved under `test/fixtures/`), the
  transport with paging, `Retry-After` and read-only mode, the files on disk,
  the auth commands, the reducer, the session, the palette's matching and
  scoping, and the registry and keymap tables.
- **Fake Wrike.** `test/fake/wrike.ts` is one in-memory server with synthetic
  data. It serves the REST calls and a minimal MCP Streamable HTTP endpoint
  with `get_my_inbox` and `get_item_history`, checks the token, records every
  write and every tool call, and can be told to fail. `failTool` makes a tool
  answer with plain text, the way Wrike reports a rate limit. History has the
  real response shape, a change of every kind and one of a kind the client
  does not know, and pages by `pageSize`. Attachments have the real shape of
  `GET /tasks/{id}/attachments`, the preview route answers with a real PNG,
  and the link route with a signed URL. It edits and
  deletes comments with Wrike's answers, a 404 included, and stores mention
  HTML as sent. A test can set the clock that stamps new comments. It creates
  tasks and subtasks in a folder or space, files and unfiles them with the
  account root after the last folder, and deletes them to the Recycle Bin with
  Wrike's 400 on a second delete. A deleted task leaves every list, and a
  subtask filed nowhere of its own stays in its deleted parent's folders. Its
  support workflow has two Cancelled statuses. It serves
  custom field definitions of every measured type plus an archived, a
  read-only and an unknown one, stores a field write the way Wrike does (any
  string, a list as JSON text, null clears, empty keeps), answers 200 to a
  read-only write without storing it, and drops a Checkbox, Currency or
  Duration write on a task its data marks the field as not applying to. It
  takes a bulk `PUT /tasks/{a},{b}` of up to 100 tasks and answers importance
  there with Wrike's 400. Its MCP endpoint serves `search_requestforms`,
  `get_requestform`, `submit_requestform` and `get_asyncjob` over three forms:
  one with an entry page, a page shown when "Database" is picked, a page after
  the entry page, a required combo box and an orphan page, one with a required
  file and a user field, and a plain one. A submission creates a task, and
  `forms.submitAs = "PROCESSING"` makes the next one wait one poll. Its
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
  detached tmux session on a private socket against the fake Wrike on a port.
  It covers only what needs a real terminal or a real launch: login and the
  OS keyring, the token sources, logout, the handoffs to `$EDITOR`, the
  browser and the clipboard, escape codes for the cursor row, bold mentions
  and the themes, Alt+Enter, resizing and the panes at 80 by 24, and restarts
  with the launch variables. Every flow a screen test can drive stays in the
  screen tests. It saves
  every screen to `$WRIKE_TUI_E2E_CAPTURES`. The binary runs in the time zone
  of the test process, because `bun test` runs in UTC and the fake lays its
  dates out there.
- **Live.** The same binary runs against real Wrike with `WRIKE_TOKEN` and
  `WRIKE_TUI_READ_ONLY=1` in a detached tmux session. This has been done by
  hand for every Phase 2 flow and is not part of the test suite.
