# Configuration

Settings live in `config.json` in the config folder:
`~/.config/wrike-tui/config.json` on Linux and macOS, and
`%APPDATA%\wrike-tui\config.json` on Windows. `XDG_CONFIG_HOME` moves it on
every platform. There is no need to create it. Every part is optional, and a
missing part takes its default.

wrike-tui writes to the file too. "Save as default" in the `:` palette writes
the theme, the field history setting and a list's shaping, and
`auth login --oauth` writes the client ID of your own OAuth app when it asks
for one. Both keep every other key in the file.

## An example

```json
{
  "theme": "dark",
  "navWidth": 36,
  "completed": false,
  "history": true,
  "updateCheck": true,
  "lists": {
    "todo": { "group": "importance" },
    "folder": { "group": "assignee", "columns": ["importance", "title", "status", "due"] }
  },
  "keys": {
    "task.status": "S"
  },
  "oauth": {
    "clientId": "your-app-client-id"
  }
}
```

## Every key

| Key | Default | What it does |
| --- | --- | --- |
| `theme` | `terminal` | The colors. See [Themes](#themes). |
| `navWidth` | `30` | The width of the navigation pane, in columns, from 16 to 60. |
| `completed` | `false` | Whether a list starts with completed, cancelled and deferred tasks in. A list's own default wins, and search shows them unless its own default says otherwise. |
| `history` | `true` | Whether field history shows among the comments. `H` turns it on and off until you quit. |
| `updateCheck` | `true` | Whether a release binary asks GitHub once a day for a newer release and says so in the status bar. See [install.md](install.md#update). |
| `lists` | none | The shaping each kind of list starts with. See [Lists](#lists). |
| `keys` | none | Keys that replace the defaults. See [keys.md](keys.md#change-the-keys). |
| `oauth` | none | Your own OAuth app for `auth login --oauth`. See [OAuth](#oauth). |

### Lists

`lists` takes the kinds `todo`, `search`, `space`, `folder` and `project`.
Each kind takes any of these, and what it leaves out keeps the built in
default.

| Key | Values |
| --- | --- |
| `group`, `subgroup` | `status`, `importance`, `assignee`, `due`, `folder` or `none` |
| `sort` | A list of `{ "key": ..., "dir": "asc" }` or `"desc"`, where the key is `due`, `importance`, `status`, `title`, `updated` or `created`. The first decides and the rest break ties. |
| `filters` | A list of filters, at most one of each kind: `{ "kind": "importance", "values": ["High"] }`, `{ "kind": "due", "range": "overdue" }` (or `today`, `week`, `none`), `{ "kind": "text", "query": "..." }`, and `assignee` and `status` filters with `ids`. |
| `completed` | `true` or `false` |
| `columns` | Any of `importance`, `title`, `status`, `assignees`, `due`, `start`, `updated`, `folder` and `id`, in the order to draw them |

The easy way to write one is to shape a list in the client and run "Save as
default" from the `:` palette. It writes that list's shaping as the default
for lists of its kind.

The built in defaults: My to-do groups by due date and sorts by due date, then
importance, then title. Search sorts by last update, newest first, and shows
completed tasks. Spaces, folders and projects group by status and sort by
importance, then due date, then title.

### OAuth

`oauth` names your own Wrike app for `auth login --oauth`. It holds
`clientId`, `port` (default 8765) and `redirectUri` (default
`http://localhost:<port>/callback`). When only `redirectUri` is set, its port
is the one wrike-tui listens on. A value that cannot be read falls back to its
default.

A release binary signs in through the app it carries unless `clientId` is set.
When `clientId` is set, your own app wins. `port` and `redirectUri` apply only
to your own app. The app a release binary carries always comes back to
`http://127.0.0.1:8765/callback`. [install.md](install.md#with-oauth) walks
through both.

The client secret is never in this file. It is in the keyring.

## Themes

`theme` is `terminal`, `dark`, `light` or `high-contrast`. `terminal`, the
default, uses the colors of your terminal. The other three set their own.

"Theme:" in the `:` palette switches the theme while you work. "Save as
default" keeps the one in use.

## Files

wrike-tui keeps its files in three folders:

| Folder | Linux and macOS | Windows | When the variable is set |
| --- | --- | --- | --- |
| Config | `~/.config/wrike-tui` | `%APPDATA%\wrike-tui` | `$XDG_CONFIG_HOME/wrike-tui` |
| State | `~/.local/state/wrike-tui` | `%LOCALAPPDATA%\wrike-tui\state` | `$XDG_STATE_HOME/wrike-tui` |
| Cache | `~/.cache/wrike-tui` | `%LOCALAPPDATA%\wrike-tui\cache` | `$XDG_CACHE_HOME/wrike-tui` |

The XDG variables win on every platform, Windows included, when they are set
and not empty.

| File | Holds |
| --- | --- |
| Config `config.json` | The theme, the width of the navigation pane, whether field history is shown, whether to check for a newer release, the default shaping of lists, your keys, and the client ID of your own OAuth app |
| Config `profile.json` | Your name and Wrike host, written by `auth login` and removed by `auth logout` |
| State `<account>/session.json` | Where you were, restored at the next start |
| State `<account>/favorites.json` | Your favorites |
| Cache `<account>/` | The spaces, the folder trees and the custom field definitions, so the first screen draws at once |
| Cache `update-check.json` | When GitHub was last asked for a newer release, and its answer |

A file that cannot be read is renamed to `<name>.bad` and the defaults load.

The config is shared by every account. The session, the favorites and the
cache are kept per account.

The token, an OAuth login and the client secret of your own OAuth app are not
in any file.
They are in the keyring of your operating system.
