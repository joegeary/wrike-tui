# Use it from scripts

Three commands print for scripts and never open the client. They use the
login that `wrike-tui auth login` stored, or `WRIKE_TOKEN`.

| Command | What it prints |
| --- | --- |
| `wrike-tui tasks --mine --json` | Your active tasks, one JSON object a line |
| `wrike-tui inbox --json` | The Inbox, one JSON object a line |
| `wrike-tui export <task>` | The path of the task.md it wrote |

## Errors

A command that fails prints one line on stderr, nothing on stdout, and exits
with a code that is not 0:

- `1` when Wrike failed, the task does not exist, or nobody is logged in.
- `2` when the command line is wrong, such as an unknown option or a
  missing task.

Without a login the line is the same one `wrike-tui` prints: "Not logged
in. Run `wrike-tui auth login`, or set WRIKE_TOKEN."

## tasks --mine --json

```sh
wrike-tui tasks --mine --json
```

It prints every active task assigned to you, latest change first. Subtasks
are left out, as in Wrike's own task search. It reads every page Wrike
returns.

| Field | Value |
| --- | --- |
| `id` | The number in the permalink, which Wrike shows as the task ID |
| `taskId` | The API task ID |
| `title` | The title, with tabs and line breaks made one space |
| `link` | The permalink |
| `importance` | `High`, `Normal` or `Low` |
| `status` | The custom status name, or `Unknown` |
| `statusGroup` | `Active`, `Completed`, `Deferred` or `Cancelled` |
| `color` | Wrike's name for the status color, or `Gray` |
| `due` | The due day as `YYYY-MM-DD`, or `null` |
| `updated` | The day of the last change as `YYYY-MM-DD` |
| `folders` | The titles of the folders and projects the task is in. Folders whose title starts with `Sprint:` are left out. |
| `subtasks` | How many subtasks it has |
| `description` | The description as plain text. List items start with `• `. |

```json
{"id":"4598459101","taskId":"IEAAAAAAKQAAAA01","title":"Enable SSO on sandbox","link":"https://www.wrike.com/open.htm?id=4598459101","importance":"High","status":"In Progress","statusGroup":"Active","color":"Turquoise","due":"2026-11-11","updated":"2026-11-11","folders":["Platform","Q4 Launch"],"subtasks":0,"description":"Register the sandbox as a service provider."}
```

## inbox --json

```sh
wrike-tui inbox --json
```

It prints the Inbox newest first, read and unread notifications both. Wrike
returns up to the 100 newest. The Inbox comes from Wrike's MCP server, the
same as in the client. When it cannot load, the command fails with the reason
the client shows, for example when the MCP server refuses an OAuth login.

| Field | Value |
| --- | --- |
| `id` | The notification ID |
| `kind` | `Mention`, `Assign`, `Comment`, `Status` or `Other` |
| `label` | Wrike's name for the notification type |
| `unread` | `true` for an unread notification |
| `ts` | When it happened, as Wrike sent it |
| `item` | `{id, title, link, type}` for the task, folder or project, or `null`. `id` is the permalink number and `type` is `TASK`, `FOLDER` or `PROJECT`. |
| `author` | The name of the person who caused it, or `null` |
| `text` | The comment text, or `null` |

## export

```sh
wrike-tui export 4598459107
wrike-tui export IEAAAAAAKQAAAA07
wrike-tui export 'https://www.wrike.com/open.htm?id=4598459107'
```

It writes the task the way the `a` key does for a coding agent: task.md and
the task's screenshots, in the same folder. Then it prints the full path of
task.md and nothing else. The task can be its permalink number, its API ID or
its permalink. Quote a permalink in the shell, since `?` is a glob
character.

[Coding agents](agents.md#what-is-written-to-disk) says where the folder is
and what goes in it.
