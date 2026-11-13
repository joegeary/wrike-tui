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
- **Custom fields.** The details pane lists a task's custom fields under
  Fields, each value drawn by its type. `e` walks on into them, and `Enter`
  opens the editor the type takes. "Set a field" in the `:` palette gives the
  task a field it does not have yet, with the fields the list's tasks use
  first. When Wrike accepts a write but does not keep it, because the field
  does not apply to the task, the status bar says so.
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
- **Bulk edit.** `M` marks tasks in a list, and the list title counts them.
  While tasks are marked, `s`, `p`, `A`, `m`, "Set a field", "Cancel the task"
  and `D` in the list act on all of them, and one line in the status bar says
  how many changed and why any failed. `Esc` or "Clear marks" clears them, and
  so does showing another list.
- **Request forms.** "Submit a request form" in the `:` palette searches
  Wrike's request forms as you type, then walks the one you pick a field at a
  time, through the pages your answers lead to, and sends it. The task it
  creates opens. A field that takes a file or a person can only be filled in
  the browser, and `o` opens the form there.
- **Attachments.** A task's files are listed above the comments with their
  kind, size, author and date. `Enter` on a selected file opens it in the
  browser. A selected image shows a thumbnail.

[docs/roadmap.md](docs/roadmap.md) says what is planned.
[docs/architecture.md](docs/architecture.md) says how the code is laid out.

## Install

Each release has a binary for Linux and macOS, on x64 and arm64, on the
[Releases page](https://github.com/joegeary/wrike-tui/releases).

1. Download `wrike-tui-<os>-<arch>.tar.gz` for your platform, where `<os>` is
   `linux` or `darwin` and `<arch>` is `x64` or `arm64`. With the GitHub CLI:
   `gh release download --repo joegeary/wrike-tui --pattern 'wrike-tui-linux-x64.tar.gz'`.
2. Unpack it: `tar -xzf wrike-tui-linux-x64.tar.gz`. This gives one file,
   `wrike-tui`.
3. Move `wrike-tui` to a directory on your `PATH`, for example `~/.local/bin`.

On macOS, a file downloaded in a browser is quarantined, and the first run is
refused. Clear the flag once with `xattr -d com.apple.quarantine wrike-tui`.
A download through `gh` or `curl` is not quarantined.

To check a download, get `SHA256SUMS` from the same release and run
`sha256sum --check --ignore-missing SHA256SUMS` (`shasum -a 256` on macOS).

`wrike-tui update` replaces a release binary with the newest release, after it
checks the download against `SHA256SUMS`. `wrike-tui update --check` only says
whether a newer release is out. It asks the GitHub API without a token, which
GitHub limits to 60 requests an hour.

### From source

You need [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/joegeary/wrike-tui.git
cd wrike-tui
bun install
bun run build
```

The build writes one binary to `dist/wrike-tui`. Copy it to a directory on your
`PATH`. A build from source has the version `<version>-dev`, and `wrike-tui
update` refuses to replace it. Pull and build again instead.

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
| `wrike-tui auth login --oauth` | Signs in through the browser with OAuth. |
| `wrike-tui auth status` | Shows who is logged in, how, and when an OAuth access token expires. |
| `wrike-tui auth logout` | Removes the stored login, the OAuth client secret and the profile. |
| `wrike-tui update` | Replaces a release binary with the newest release. `--check` only reports. |
| `wrike-tui --version` | Shows the version. |

### Log in with OAuth

OAuth signs in through the browser with an app you register, and renews its
access token by itself. `WRIKE_TOKEN` still wins over it when set.

1. Open Wrike's [App Console](https://www.wrike.com/appconsole.htm?#/api) and
   create an app.
2. Add the redirect URI `http://localhost:8765/callback`.
3. Run `wrike-tui auth login --oauth`. It asks for the client ID, which goes to
   `config.json`, and the client secret, which goes to the keyring without
   echo. Sign in in the browser that opens.

When no browser opens, open the printed address yourself. When the browser
cannot reach wrike-tui after you sign in, paste the address it landed on at the
prompt. A different port goes in `config.json` as `oauth.port`, and the
redirect URI must name the same port. If Wrike accepts only an HTTPS redirect,
register `https://localhost:8765/callback`, set it as `oauth.redirectUri`, and
paste the address the browser lands on.

Two things are not confirmed yet. Wrike's docs ask for an HTTPS redirect URI,
so it may refuse the plain `http://localhost` one. And Wrike's MCP server, which
serves the Inbox and field history, may refuse an OAuth access token. If it
does, those panes say so, and a permanent token is the way to have them.

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
| | `M` | Mark the task, or unmark it, and move to the next task |
| | `Esc` | Clear the marks |
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
| Request form | `Enter` | Keep the answer and go to the next field. On the review, send the form. |
| | `Ctrl+B` | Go back one field |
| | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move among the choices |
| | `Space` | Pick or drop a check box |
| | `Alt+Enter` | Start a new line in a long text field |
| | `o` | Open the form in the browser, where no text is typed |
| | `Esc` | Close the form |

Dates are typed as `YYYY-MM-DD`. An empty date clears it. "Cancel the task",
"Take out of a folder" and "Submit a request form" have no key. Run them from
the `:` palette.

With tasks marked, the status, importance and assignee keys and "Set a field"
in the list pane change every marked task, and the details pane still changes
only the open task. The assignee picker checks the people on all the marked
tasks and says "on 2 of 5" beside someone on only some. Checking a person adds
them to every marked task, and unchecking one who was on all of them removes
them. Deleting and cancelling marked tasks ask once for all of them. Cancelled
tasks that need different Cancelled statuses of one workflow get a picker, and
tasks of several such workflows are refused with a note to cancel one workflow
at a time.

Custom fields are edited by type. A drop-down picks one choice, and offers
"Other value..." when the field allows one. A multi-select toggles choices
with `Space`. A checkbox flips on `Enter`. Text, numbers, dates and durations
are typed in place: a number with no more decimal places than the field
allows, a date as `YYYY-MM-DD`, a duration in hours and minutes like `2h 30m`.
Every field clears: "Clear the field", nothing chosen, an empty input, or a
checkbox flipped off. Read-only and calculated fields say why they cannot be
edited.

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
| `$XDG_CONFIG_HOME/wrike-tui/config.json` | The theme, the width of the navigation pane, whether field history is shown, the default shaping of lists, and the OAuth app's client ID |
| `$XDG_STATE_HOME/wrike-tui/<account>/session.json` | Where you were, restored at the next start |
| `$XDG_STATE_HOME/wrike-tui/<account>/favorites.json` | Your favorites |
| `$XDG_CACHE_HOME/wrike-tui/<account>/` | The spaces, the folder trees and the custom field definitions, so the first screen draws at once |

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
`oauth` holds `clientId`, `port` (default 8765) and `redirectUri` (default
`http://localhost:<port>/callback`) for `auth login --oauth`.

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
- Request forms cannot attach files or pick people from the terminal. A
  required file or person field means finishing the form in the browser.
- Importance is changed one task at a time, because Wrike refuses it in a
  bulk update.

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

Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`. It builds
the binary on Linux x64 and arm64 and macOS arm64 and Intel runners, with
`WRIKE_TUI_VERSION=0.2.0` so the binary reports that version, runs each one
with `--version`, and publishes the tarballs and `SHA256SUMS` as a GitHub
release with generated notes.

## License

MIT. See [LICENSE](LICENSE).
