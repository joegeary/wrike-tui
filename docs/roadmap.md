# Roadmap

wrike-tui is a keyboard-first terminal client for Wrike. It takes its shape
from [zen-linear](https://github.com/praxis-labs-io/zen-linear), a terminal
client for Linear: three panes, vim movement, a details page that edits in
place, and a key legend that always says what works where you are.

This page compares what zen-linear does with what Wrike and its API can do,
then lays out the phases that close the gap.

## What the Wrike API can and cannot reach

Wrike exposes two public surfaces, and wrike-tui uses both with the same
personal token.

The **REST API v4** (`https://<host>/api/v4`) covers tasks, folders, projects,
spaces, comments, workflows, contacts, attachments, dependencies, time logs and
approvals. It returns JSON shaped as `{ kind, data: [...] }`. The rate limit is
about 400 requests a minute, and a 429 means back off and retry.

The **MCP server** (`https://mcp.wrike.com/v2`) is the only public way to read
the Inbox and a task's field history. Its `get_my_inbox` tool returns
notifications (mentions, assignments, status changes, comments) with the item,
the author and the comment text. Its `get_item_history` tool returns each
change with its author, time and old and new values. REST's
`GET /tasks/{id}/tasks_history` answers with nothing but the task's ID. The
same Bearer token works on both surfaces. Nothing on either surface can
mark a notification read or archive it, so the Inbox is read-only until Wrike
adds that.

Four gaps shape the design.

1. **No Inbox endpoint in REST.** wrike-tui reads the Inbox through MCP and
   resolves each item to a REST task through the legacy ID converter
   (`GET /ids?type=ApiV2Task`).
2. **No "My to-do" endpoint.** Wrike's My to-do is a smart list of tasks
   assigned to you plus tasks you pinned by hand. The pinned half has no API.
   wrike-tui builds My to-do from active tasks assigned to you, grouped by when
   they are due.
3. **OAuth needs a client secret and a registered app.** Wrike supports only
   the authorization code flow, with no PKCE. A personal access token is the
   first login path. OAuth with your own registered app comes later.
4. **Search matches titles only.** `GET /tasks?title=` is a contains match on
   the title. Descriptions and comments are not searchable through the API.

## zen-linear against Wrike

| zen-linear | Wrike equivalent | API | Phase |
| --- | --- | --- | --- |
| Browser OAuth with PKCE | Personal access token in the OS keyring | `GET /contacts?me=true` to verify | 1 |
| `LINEAR_API_KEY` override | `WRIKE_TOKEN` override | same | 1 |
| Workspace search with `/` | Task title search, and a jump by permalink or ID | `GET /tasks?title=`, `GET /tasks?permalink=` | 1 |
| No inbox | Inbox of mentions, assignments and status changes | MCP `get_my_inbox` | 1 |
| My issues view | My to-do, grouped by due date | `GET /tasks?responsibles=[me]&status=Active` | 1 |
| Details page: metadata, markdown description | Same, HTML description rendered as markdown | `GET /tasks/{id}` | 1 |
| Comments on the details page | Comments, oldest first | `GET /tasks/{id}/comments` | 1 |
| Write a comment with `c` | Same | `POST /tasks/{id}/comments` | 1 |
| Edit mode: title, state, assignee, priority, due date, description | Title, custom status, assignees, importance, start and due dates, description | `PUT /tasks/{id}` | 1 |
| `m` assign to me, `u` unassign | Same | `PUT /tasks/{id}` with `addResponsibles` or `removeResponsibles` | 1 |
| `o` open in browser, `y` copy URL, `i` copy ID | Same, with the Wrike permalink | `permalink` field | 1 |
| `?` key legend for the current pane | Same | none | 1 |
| Three panes, `h`/`l`, `1`/`2`/`3`, `v` zoom | Same | none | 1 |
| Navigation tree of teams, cycles, projects | Spaces, folders and projects tree | `GET /spaces`, `GET /folders` | 2 |
| Favorites that write back to Linear | Local favorites (Wrike has no starred API) | local file | 2 |
| Group, subgroup, sort chain, seven filters | Group by status, importance, assignee, folder, due; filter on the same | client side over `GET /tasks` | 2 |
| Configurable columns | Same | none | 2 |
| Sub-issues with Space to expand | Subtasks | `subTaskIds`, `superTaskIds` | 2 |
| Session restore and a cached tree at launch | Same | local files | 2 |
| `config.json` and five themes | `config.json` and four themes | none | 2 |
| `:` command palette scoped to the pane | Same | none | 2 |
| Threaded replies, edit and delete own comments | Edit only within 5 minutes of posting; delete. Replies are deferred. | `PUT` and `DELETE /comments/{id}` | 3 |
| Activity merged into the comment stream | Field history merged by time | MCP `get_item_history` | 3 |
| Images drawn in the description (Kitty) | Attachments listed, opened, previewed | `GET /tasks/{id}/attachments` | 3 |
| No @mention helper | @mention autocomplete in comments | `GET /contacts` | 3 |
| Labels | Folders a task is filed in (a task can live in many), or custom fields | `addParents`, `removeParents` | 4 |
| `n` new issue form, `N` sub-issue | New task in a folder, new subtask | `POST /folders/{id}/tasks` | 4 |
| Relations | Dependencies | `/tasks/{id}/dependencies` | 4 |
| Estimate | Effort allocation | `effortAllocation` | 4 |
| Archive | Cancel, or move to the Recycle Bin | `PUT status=Cancelled`, `DELETE /tasks/{id}` | 4 |
| No bulk action | Bulk edit of up to 100 tasks | `PUT /tasks/{ids}` | 4 |
| Cycles, milestones | Milestone tasks; no cycles | `dates.type=Milestone` | 4 |
| None | Custom fields, custom item types | `/customfields`, `/custom_item_types` | 4 |
| None | Blueprints and request forms | `/folder_blueprints`, `/request_forms` | 4 |
| None | Time logs and timesheets | `/tasks/{id}/timelogs` | 5 |
| None | Approvals waiting on me | `GET /approvals` | 5 |
| More than one workspace, `w` to switch | More than one Wrike account, one token each | per-account token | 5 |
| Browser OAuth | OAuth with your own registered app, loopback redirect | `login.wrike.com/oauth2` | 5 |
| Rebindable keys | Same | none | 5 |
| Hand an issue to a coding agent | Hand a task to Claude Code with its context | none | 5 |
| Self-update and install scripts | Same | GitHub releases | 5 |

## Phase 1. First release

The goal is a client you can live in for the daily loop: see what needs you,
find a task, read it, change it, answer it.

- **Auth.** `wrike-tui auth login` reads a personal access token without
  echoing it, finds the data center that accepts it, and stores it in the OS
  keyring. `auth status` and `auth logout` round it out. `WRIKE_TOKEN` in the
  environment overrides the keyring.
- **Inbox.** Unread notifications, newest first, with the type, the task, the
  author and the first line of the comment. `a` toggles read ones in. Enter
  opens the task. A notification on a folder or project opens in the browser.
- **My to-do.** Active tasks assigned to you, grouped into Overdue, Today, This
  week, Later and No date.
- **Search.** `/` takes a query. A pasted permalink or a numeric ID opens that
  task. Anything else is a title search across the account.
- **Open a task.** Status, importance, assignees, dates, folders, the
  description rendered as markdown, and the comments.
- **Edit a task.** `e` walks the fields. Title and dates are typed in place.
  Status, importance and assignees open a picker. The description opens in
  `$EDITOR` as markdown. `c` writes a comment. `m` takes the task.

## Phase 2. Navigate the workspace

Done. The navigation pane is a tree of spaces, folders and projects, and the
list pane groups, subgroups, sorts, filters and chooses columns. Lists load a
page at a time and nest subtasks. A `:` palette lists the commands that apply
where you are. Favorites are local. Sessions restore and the tree paints from
a cache at launch. A config file holds the theme, the columns and the
defaults.

Deferred: filtering the tree by name, and showing the total a list will reach
(Wrike's first page reports it) beside how much is loaded.

## Phase 3. Conversation and activity

Your own comments can be edited inside Wrike's five-minute window and deleted
any time. Field history folds into the comment stream by time. Attachments
list, open and preview. Comments gain @mention completion.

Done: editing and deleting your own comments, @mention completion, field
history in the comment stream with `H` to hide it, and attachments with a
thumbnail of a selected image.

Deferred: threaded replies. Wrike refused a reply on the account this was
built against with "Replying to comments is not allowed on this item", and no
task in that account has a thread to show. Replies wait until there is an
account that allows them to build and test against.

Descriptions with checklists, highlights, underline, images or tables open as
markdown too, with an extended syntax for each (task lists for checklists).
Done: 1,065 of the 1,122 descriptions in the test corpus open as markdown and
save back unchanged, up from 599 of which 595 did not.

## Phase 4. Create and reshape work

New tasks and subtasks, filing a task into more folders, dependencies, effort,
milestones, custom fields and custom item types. Bulk edit across a selection.
Cancel and delete. Launch a blueprint or submit a request form.

Done: new tasks with `n`, in the scoped folder or a picked one, and subtasks
with `N` in the parent's first folder. Filing a task in another folder with
`L` and taking it out of one from the palette, never the last, because Wrike
moves a task with no folder to the account root. Cancel from the palette,
picking among several Cancelled statuses. Delete with `D` to the Recycle Bin,
where Wrike's 400 for a task already there counts as deleted.

## Phase 5. Wrike's own power features

Time logs and a timesheet view. Approvals that wait on you. More than one
account. OAuth with your own app. Rebindable keys. Handing a task to Claude
Code with its context. Release builds, install scripts and self-update.
