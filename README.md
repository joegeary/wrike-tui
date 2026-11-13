# wrike-tui

A keyboard-first terminal client for [Wrike](https://www.wrike.com). It shows
your Inbox and your to-do list, finds tasks, and lets you read, edit and answer
them without leaving the terminal. It browses your spaces, folders and
projects, and shapes any list of tasks the way you want to read it.

## What it does

- **Inbox, My to-do and search.** Unread notifications, the active tasks
  assigned to you, and a search by title, permalink or task ID.
- **The workspace tree.** Every space you can see, with its folders and
  projects. A space loads its tree when you open it. `Enter` on a space, a
  folder or a project lists its tasks.
- **Lists you can shape.** Group and subgroup by status, importance, assignee,
  due date or folder. Sort by several keys. Filter by assignee, status,
  importance, due date or title. Choose the columns. Subtasks nest under their
  parent.
- **Big lists.** A list loads 200 tasks at a time, and the next page loads as
  you near the end.
- **A command palette.** `:` lists every command that applies where you are.
- **Favorites.** `F` keeps a space, a folder, a project or a task at the top of
  the navigation pane. Favorites are stored on your machine, because Wrike has
  no starred items in its API.
- **It comes back where you left it.** The scope, the open folders, the cursor,
  the shaping of each list and the open task are restored at the next start,
  and the tree is drawn from a cache before Wrike answers.
- **Themes.** The colors of your terminal by default, or `dark`, `light` and
  `high-contrast`.
- **Editing.** Title, status, importance, assignees, dates, the description in
  your editor, and comments.
- **Comments.** `]` and `[` select a comment. Your own comment can be edited
  in the five minutes after you post it, as in Wrike's web app, and deleted at
  any time. Type `@` and a few letters to mention someone.
- **Field history.** Changes to the title, status, assignees, folders, dates,
  duration and custom fields show among the comments by time, one line each.
  `H` hides them or shows them again. A task opens with its newest 50
  changes, and "Load older changes" in the `:` palette brings the next 50.
- **New tasks and subtasks.** `n` creates a task in the folder you are in, or
  in a folder you pick from My to-do, Search or the Inbox. `N` creates a
  subtask of the open task. The new task opens at once, ready for `e`.
- **Folders, cancel and delete.** `L` files a task in another folder or
  project, and "Take out of a folder" in the `:` palette removes one, never the
  last. "Cancel the task" moves it to its workflow's Cancelled status. `D`
  sends it to the Recycle Bin after you confirm with `y`.
- **Attachments.** A task's files are listed above the comments with their
  kind, size, author and date. `Enter` on a selected file opens it in the
  browser. A selected image shows a thumbnail.

[docs/roadmap.md](docs/roadmap.md) says what is planned.
[docs/architecture.md](docs/architecture.md) says how the code is laid out.

## Install from source

You need [Bun](https://bun.sh) 1.4 or later.

```sh
git clone <this repository>
cd wrike-tui
bun install
bun run build
```

The build writes one binary to `dist/wrike-tui`. Copy it to a directory on your
`PATH`.

## Log in

wrike-tui signs in with a Wrike permanent access token.

1. In Wrike, select your profile icon, then **Apps & Integrations**, then the
   **API** tab.
2. Create an app if you have none, then create a permanent access token and
   copy it.
3. Run `wrike-tui auth login` and paste the token. The prompt does not echo it.

`auth login` finds the Wrike data center that accepts the token and stores the
token in the keyring of your operating system. It stores your name and host in
`$XDG_CONFIG_HOME/wrike-tui/profile.json`.

| Command | What it does |
| --- | --- |
| `wrike-tui` | Opens the client. |
| `wrike-tui auth login` | Stores a token. |
| `wrike-tui auth status` | Shows who is logged in and where the token comes from. |
| `wrike-tui auth logout` | Removes the stored token and profile. |

### Environment

| Variable | Effect |
| --- | --- |
| `WRIKE_TOKEN` | Use this token instead of the keyring. Nothing is stored. |
| `WRIKE_HOST` | Use this Wrike host, for example `app-eu.wrike.com`, instead of the stored one. |
| `VISUAL`, `EDITOR` | The editor for descriptions and long comments. `vi` is the fallback. |
| `BROWSER` | The command that opens a URL given as its last argument. The default is `xdg-open` on Linux and `open` on macOS. Windows has no default. |
| `WRIKE_TUI_READ_ONLY=1` | Refuse every change. A save says "read-only mode: not saved" and nothing is sent to Wrike. |
| `WRIKE_TUI_NO_RESTORE=1` | Start on the Inbox instead of where the last session ended. |

## Keys

Press `?` in the client to see the keys for the pane you are in.

| Where | Key | Action |
| --- | --- | --- |
| Anywhere | `1` `2` `3` | Focus the navigation, list or details pane |
| | `h` `l`, or the left and right arrows | Move to the pane on the left or right |
| | `i` | Show the Inbox |
| | `t` | Show My to-do |
| | `/` | Search by title, or paste a permalink or a task ID to open that task |
| | `:` | Show the commands that apply here, and type to find one |
| | `r` | Refresh the list, the open task, the people, the workflows and the open spaces |
| | `v` | Zoom the details pane |
| | `H` | Show or hide field history among the comments |
| | `?` | Show the keys |
| | `q` | Quit |
| Navigation pane | `j` `k`, or the down and up arrows | Move down or up |
| | `Enter` | Show the row in the list. On a space, a folder or a project the focus stays in the tree. |
| | `Space` | Open or close a space, a folder or a project |
| | `F` | Add the row to the favorites, or remove it |
| | `J` `K` | Move a favorite down or up |
| List pane | `j` `k`, or the down and up arrows | Move down or up |
| | `g` `G` | Jump to the top or the bottom |
| | `Enter` | Open the task. A folder or project notification opens in the browser. |
| | `Space` | Open or close the subtasks of a task, or a group |
| | `x` | Show or hide completed, cancelled and deferred tasks |
| | `f` | Filter by title. An empty filter clears it. |
| | `a` | Show or hide read notifications (Inbox) |
| Details pane | `j` `k` `g` `G` | Scroll |
| | `]` `[` | Select the next or previous attachment or comment |
| | `Enter` | Open the selected file in the browser, or edit the selected comment when it is yours and under five minutes old |
| | `d` | Delete the selected comment, when it is yours. Only `y` confirms. |
| | `Esc` | Clear the selection |
| A task, in the list or the details | `e` | Edit fields |
| | `s` | Change the status |
| | `p` | Change the importance |
| | `A` | Change the assignees |
| | `m` | Assign to me |
| | `c` | Write a comment |
| | `E` | Edit the description in `$EDITOR` |
| | `o` | Open in the browser |
| | `y` | Copy the URL |
| | `Y` | Copy the ID |
| | `F` | Add the task to the favorites, or remove it |
| | `n` | New task, in the folder the list shows or in one you pick |
| | `N` | New subtask of the task |
| | `L` | File the task in another folder or project |
| | `D` | Delete the task to the Recycle Bin. Only `y` confirms. |
| Edit mode | `j` `k` | Next or previous field |
| | `Enter` | Edit the field |
| | `Esc` | Leave edit mode |
| Picker | type | Filter the list |
| | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move |
| | `Space` | Toggle a choice (assignees, filters, columns) |
| | `Enter` | Apply |
| | `Esc` | Cancel |
| Palette | type | Find a command |
| | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move |
| | `Enter` | Run the command |
| | `Esc` | Close |
| Text field | `Enter` | Save, or create the new task |
| | `Esc` | Discard |
| Comment | `Enter` | Post, or save an edit |
| | `Alt+Enter` or `Ctrl+J` | Start a new line |
| | `Ctrl+E` | Finish the comment in `$EDITOR` |
| | `Esc` | Discard |
| | `@` and letters | Offer people to mention |
| Mention list | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move |
| | `Tab` or `Enter` | Write the person's name as a mention |
| | `Esc` | Close the list and keep writing |

Dates are typed as `YYYY-MM-DD`. An empty date clears it. "Cancel the task"
and "Take out of a folder" have no key. Run them from the `:` palette.

## Shape a list

Press `:` in a list and type part of a command.

| Command | What it does |
| --- | --- |
| Group by status, importance, assignee, due date, folder or nothing | Puts the tasks under headings. `Space` closes and opens a heading. |
| Subgroup by ... | Splits each group again. |
| Sort by due date, importance, status, title, last update or creation date | Makes that the first sort key and keeps the earlier keys as tie breakers. Choosing the same key again reverses it. |
| Reverse the sort | Reverses the first sort key. |
| Filter by assignee, status, importance or due date | Opens a picker for the values. Applying nothing removes the filter. |
| Only my tasks | Filters to the tasks assigned to you. |
| Clear the filters | Removes every filter. |
| Choose the columns | Importance, status, assignees, due date, start date, updated, folder and ID. A narrow pane drops columns to keep the title readable. |
| Open every group and subtask, Close every group and subtask | Expands or collapses the whole list. |
| Save as default | Writes the theme in use, whether field history is shown, and this list's shaping as the default for lists of its kind, to the config file. |

Each list keeps its own shaping. Shaping works on the tasks that are loaded,
so a filter on a list that shows `200+` only sees the first 200 until you load
more.

## Files

| File | Holds |
| --- | --- |
| `$XDG_CONFIG_HOME/wrike-tui/config.json` | The theme, the width of the navigation pane, whether field history is shown, and the default shaping of lists |
| `$XDG_STATE_HOME/wrike-tui/<account>/session.json` | Where you were, restored at the next start |
| `$XDG_STATE_HOME/wrike-tui/<account>/favorites.json` | Your favorites |
| `$XDG_CACHE_HOME/wrike-tui/<account>/` | The spaces and folder trees, so the navigation pane draws at once |

The directories default to `~/.config`, `~/.local/state` and `~/.cache`. A
file that cannot be read is renamed to `<name>.bad` and the defaults load.

An example `config.json`. Every part is optional.

```json
{
  "theme": "dark",
  "navWidth": 36,
  "completed": false,
  "history": true,
  "lists": {
    "todo": { "group": "importance" },
    "folder": { "group": "assignee", "columns": ["importance", "title", "status", "due"] }
  }
}
```

`theme` is `terminal`, `dark`, `light` or `high-contrast`. `history` shows
field history among the comments, and is true unless you set it false.
`lists` takes the kinds `todo`, `search`, `space`, `folder` and `project`.

A description opens in your editor as markdown when saving it unchanged would
write back the same HTML. Otherwise it opens as raw HTML, so that saving never
strips formatting you did not touch. Close the editor without a change to
cancel.

Markdown covers Wrike's formatting with a few additions:

| In Wrike | In the editor |
| --- | --- |
| Checklist | `- [ ] open` and `- [x] done` |
| Table | A pipe table whose first row is the header; `<br>` breaks a line in a cell |
| Text color | `{color:#D81B60}text{color}` |
| Highlight | `=={#ffcc80}text==`; a bare `==text==` takes `#F8BBD0` |
| Underline | `++text++` |
| Image | `![](src)` |
| A link's `rel` | `[text](url){rel=nofollow}` |
| Bold, italic | `**b**` and `*i*`; `__strong__` and `_em_` keep Wrike's other tags |

Each blank line is a blank line in Wrike. A backslash at the end of a line is
a line break inside a paragraph, and one before a list or heading keeps the
break Wrike stored there. One blank line ends a list or a heading. A space markdown would drop, at the end of a
line or inside bold, reads `&#32;`.

Copy uses the OSC 52 terminal sequence, so it works over SSH when your terminal
allows it. Inside tmux, `set-clipboard` must be `external` (the default) or
`on`.

## Limits

These come from the Wrike API.

- The Inbox is read-only. Wrike has no public call to mark a notification read.
- My to-do lists the active tasks assigned to you. Tasks you pinned by hand in
  Wrike are not available through the API.
- Search matches task titles only.
- Favorites live on your machine. Wrike's API has no starred items.

## Develop

```sh
bun run dev         # run from source
bun run typecheck
bun run test        # unit and screen tests
bun run e2e         # build, then drive the binary in a detached tmux session
```

The tests never call Wrike. They run against a fake Wrike server with synthetic
data in `test/fake/`. You can run the client against it too:

```sh
bun test/fake/serve.ts 4010
WRIKE_TOKEN=fake-token \
WRIKE_BASE_URL=http://127.0.0.1:4010/api/v4 \
WRIKE_MCP_URL=http://127.0.0.1:4010/mcp \
bun run dev
```

`WRIKE_BASE_URL` and `WRIKE_MCP_URL` are development overrides for the REST API
base and the MCP endpoint. `WRIKE_TUI_KEYRING_SERVICE` changes the keyring
service name, which keeps test runs away from your real token.
`WRIKE_TUI_FRAME_LOG=<file>` appends the time from each key press to the next
frame, in milliseconds, which is how list latency is measured.

`bun test ./test` needs `zsh`, and `bun run e2e` needs `tmux` and `zsh`. Set `WRIKE_TUI_E2E_CAPTURES` to a
directory to keep the screen captures of every step.

GitHub Actions runs the typecheck, `bun test ./test` and `bun run e2e` on every
push. When the e2e job fails, its screen captures are attached to the run as
the `e2e-captures` artifact.

## License

MIT. See [LICENSE](LICENSE).
