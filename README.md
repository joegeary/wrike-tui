# wrike-tui

A keyboard-first terminal client for [Wrike](https://www.wrike.com). It shows
your Inbox and your to-do list, finds tasks, and lets you read, edit and answer
them without leaving the terminal.

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
| `BROWSER` | The command that opens a URL. The default is `xdg-open` on Linux and `open` on macOS. |

## Keys

Press `?` in the client to see the keys for the pane you are in.

| Where | Key | Action |
| --- | --- | --- |
| Anywhere | `1` `2` `3` | Focus the navigation, list or details pane |
| | `h` `l`, or the left and right arrows | Move to the pane on the left or right |
| | `i` | Show the Inbox |
| | `t` | Show My to-do |
| | `/` | Search by title, or paste a permalink or a task ID to open that task |
| | `r` | Refresh |
| | `v` | Zoom the details pane |
| | `?` | Show the keys |
| | `q` | Quit |
| Navigation pane | `j` `k` | Next or previous view |
| | `Enter` | Go to the list |
| List pane | `j` `k`, or the down and up arrows | Move down or up |
| | `g` `G` | Jump to the top or the bottom |
| | `Enter` | Open the task. A folder or project opens in the browser. |
| | `a` | Show or hide read notifications (Inbox) |
| Details pane | `j` `k` `g` `G` | Scroll |
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
| Edit mode | `j` `k` | Next or previous field |
| | `Enter` | Edit the field |
| | `Esc` | Leave edit mode |
| Picker | type | Filter the list |
| | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move |
| | `Space` | Toggle a person (assignees) |
| | `Enter` | Apply |
| | `Esc` | Cancel |
| Text field | `Enter` | Save |
| | `Esc` | Discard |
| Comment | `Enter` | Post |
| | `Ctrl+E` | Finish the comment in `$EDITOR` |
| | `Esc` | Discard |

Dates are typed as `YYYY-MM-DD`. An empty date clears it.

A description opens in your editor as markdown when its formatting survives a
round trip through markdown. A description with underline, highlight, images or
tables opens as raw HTML, so that saving never strips formatting you did not
touch. Close the editor without a change to cancel.

Copy uses the OSC 52 terminal sequence, so it works over SSH when your terminal
allows it. Inside tmux, `set-clipboard` must be `external` (the default) or
`on`.

## Limits

These come from the Wrike API.

- The Inbox is read-only. Wrike has no public call to mark a notification read.
- My to-do lists the active tasks assigned to you. Tasks you pinned by hand in
  Wrike are not available through the API.
- Search matches task titles only.

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

`bun run e2e` needs `tmux` and `zsh`. Set `WRIKE_TUI_E2E_CAPTURES` to a
directory to keep the screen captures of every step.
