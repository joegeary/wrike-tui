# Install

## Requirements

A Wrike account, and a terminal on macOS, Linux or Windows, on x64 or arm64.

wrike-tui keeps your login in the keyring of your operating system: the
Keychain on macOS, Credential Manager on Windows, and the Secret Service on
Linux. On Linux that means `libsecret` and a running keyring such as GNOME
Keyring or KWallet. Without a keyring, set `WRIKE_TOKEN` instead (see
[Environment variables](#environment-variables)).

Copying a URL or an ID uses the OSC 52 terminal sequence, so the terminal must
allow clipboard writes. [guide.md](guide.md#copy) has the details.

Nothing else is needed to run a release binary. Building from source needs
[Bun](https://bun.sh) 1.4 or later.

## Install

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.sh | sh
```

Windows:

```powershell
irm https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.ps1 | iex
```

Both take the binary for your machine from the newest release, check it
against the release's `SHA256SUMS`, and refuse to install a file that does not
match. They run the new binary once before it replaces anything, so a binary
that cannot run on your machine is never installed.

`install.sh` puts the binary in `~/.local/bin`, and `install.ps1` puts it in
`%LOCALAPPDATA%\Programs\wrike-tui`. `INSTALL_DIR` moves either:

```sh
curl -fsSL https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.sh | INSTALL_DIR="$HOME/bin" sh
```

`VERSION` pins either installer to a release, as `v0.2.0` or `0.2.0`. Without
it the newest release is installed. A pre-release is never picked on its own.
In PowerShell, set the variable first:

```powershell
$env:VERSION = 'v0.2.0'; irm https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.ps1 | iex
```

## Download by hand

Each release has a binary for Linux, macOS and Windows, on x64 and arm64, on
the [Releases page](https://github.com/joegeary/wrike-tui/releases).

1. Download `wrike-tui-<os>-<arch>.tar.gz` for your platform, where `<os>` is
   `linux` or `darwin` and `<arch>` is `x64` or `arm64`. With the GitHub CLI:
   `gh release download --repo joegeary/wrike-tui --pattern 'wrike-tui-linux-x64.tar.gz'`.
   On Windows, download `wrike-tui-windows-<arch>.zip`.
2. Unpack it: `tar -xzf wrike-tui-linux-x64.tar.gz`, or in PowerShell
   `Expand-Archive wrike-tui-windows-x64.zip -DestinationPath .`. This gives
   one file, `wrike-tui` (`wrike-tui.exe` on Windows).
3. Move it to a directory on your `PATH`, for example `~/.local/bin`.

### Checksums

To check a download, get `SHA256SUMS` from the same release and run
`sha256sum --check --ignore-missing SHA256SUMS` (`shasum -a 256` on macOS).
The installers and `wrike-tui update` do this for you.

### macOS quarantine

On macOS, a file downloaded in a browser is quarantined, and the first run is
refused. Clear the flag once with `xattr -d com.apple.quarantine wrike-tui`.
A download through `gh`, `curl` or `install.sh` is not quarantined.

## PATH

The installers do not change `PATH`. When the install folder is not on it,
they say so and print the line that adds it. Some shells do not carry
`~/.local/bin` on `PATH`. Add it:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Put that line in `~/.zshrc` or `~/.bashrc` to keep it.

On Windows, add the install folder to your user `PATH`:

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:LOCALAPPDATA\Programs\wrike-tui", 'User')
```

Then open a new terminal.

## Build from source

```sh
git clone https://github.com/joegeary/wrike-tui.git
cd wrike-tui
bun install
bun run build
```

The build writes one binary to `dist/wrike-tui` (`dist/wrike-tui.exe` on
Windows). Copy it to a directory on your
`PATH`. A build from source has the version `<version>-dev`, and `wrike-tui
update` refuses to replace it. Pull and build again instead.

### Develop

```sh
bun run dev         # run from source
bun run typecheck
bun run test        # unit and screen tests
bun run e2e         # build, then drive the binary in a detached tmux session
```

`bun test ./test` needs `zsh`, and `bun run e2e` needs `tmux` and `zsh`. The
tests never call Wrike. They run against a fake Wrike server with synthetic
data in `test/fake/`. You can run the client against it too:

```sh
bun test/fake/serve.ts 4010
WRIKE_TOKEN=fake-token \
WRIKE_BASE_URL=http://127.0.0.1:4010/api/v4 \
WRIKE_MCP_URL=http://127.0.0.1:4010/mcp \
bun run dev
```

These variables are for development and tests:

| Variable | Effect |
| --- | --- |
| `WRIKE_BASE_URL` | The REST API base, instead of the one for your Wrike host. |
| `WRIKE_MCP_URL` | The MCP endpoint, instead of Wrike's. |
| `WRIKE_TUI_KEYRING_SERVICE` | The keyring service name, which keeps test runs away from your real token. |
| `WRIKE_TUI_FRAME_LOG=<file>` | Appends the time from each key press to the next frame, in milliseconds, which is how list latency is measured. |
| `WRIKE_TUI_E2E_CAPTURES` | A directory that keeps the screen captures of every e2e step. |
| `WRIKE_TUI_VERSION` | The version `bun run build` writes into the binary. |

GitHub Actions runs the typecheck, `bun test ./test` and `bun run e2e` on Linux
on every push to main and every pull request. It also builds the Windows x64
and arm64 binaries and runs each with `--version`. Run it on another branch
from the Actions tab or with `gh workflow run ci.yml --ref <branch>`. When the
e2e job fails, its screen captures are attached to the run as the
`e2e-captures` artifact.

### How a release is built

Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`. It builds
the binary on Linux x64 and arm64, macOS arm64 and Intel, and Windows x64 and
arm64 runners, with `WRIKE_TUI_VERSION=0.2.0` so the binary reports that
version, and runs each one with `--version`. It publishes a tarball for each
Linux and macOS binary, a zip for each Windows one, and `SHA256SUMS` as a
GitHub release with generated notes. A tag with a suffix, such as
`v0.3.0-rc.1`, is published as a pre-release.

## Update

`wrike-tui update` replaces a release binary with the newest release, after it
checks the download against `SHA256SUMS`. On Windows it runs `install.ps1` for
the newest release into the folder of the running `wrike-tui.exe`, which
renames the running file to `wrike-tui.exe.old`. The next install or update
removes that file. `wrike-tui update --check` only says whether a newer release
is out. Both ask the GitHub API without a token, which GitHub limits to 60
requests an hour. Neither picks a pre-release.

When a newer release is out, the status bar in the client says so once and
names `wrike-tui update`. The next key clears it. A release binary asks GitHub
in the background at most once a day, and a check that fails shows nothing. A
build from source never asks. `"updateCheck": false` in
[config.json](configuration.md#every-key) turns the check off.

Running an installer again also updates, and is the way to move the binary
somewhere else with `INSTALL_DIR`. A build from source is updated with a pull
and a new build.

`wrike-tui --version` shows the version you are running.

## Log in

```sh
wrike-tui auth login
```

At a terminal, plain `auth login` asks whether you want a token or OAuth.
`auth login --token` and `auth login --oauth` skip the question.

| Command | What it does |
| --- | --- |
| `wrike-tui` | Opens the client. |
| `wrike-tui auth login` | Asks whether to log in with a token or with OAuth. |
| `wrike-tui auth login --token` | Stores a token. |
| `wrike-tui auth login --oauth` | Signs in through the browser with OAuth. |
| `wrike-tui auth status` | Shows who is logged in, how, and when an OAuth access token expires. |
| `wrike-tui auth logout` | Removes the stored login, the OAuth client secret and the profile. |
| `wrike-tui keys` | Lists every command with its keys. See [keys.md](keys.md#change-the-keys). |
| `wrike-tui update` | Replaces a release binary with the newest release. On Windows it runs `install.ps1`. `--check` only reports. |
| `wrike-tui --version` | Shows the version. |

### With a permanent access token

1. In Wrike, select your profile icon, then **Apps & Integrations**, then the
   **API** tab.
2. Create an app if you have none, then create a permanent access token and
   copy it.
3. Run `wrike-tui auth login --token` and paste the token. The prompt does not
   echo it.

`auth login` finds the Wrike data center that accepts the token and stores the
token in the keyring of your operating system. It stores your name and host in
`profile.json` in the config folder, `~/.config/wrike-tui` on Linux and macOS
and `%APPDATA%\wrike-tui` on Windows. See
[configuration.md](configuration.md#files).

### With OAuth

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
[configuration.md](configuration.md#oauth) lists the `oauth` keys.

Two things are not confirmed yet. Wrike's docs ask for an HTTPS redirect URI,
so it may refuse the plain `http://localhost` one. And Wrike's MCP server, which
serves the Inbox and field history, is expected to take an OAuth access token,
since it names the same login server wrike-tui signs in with. That is not yet
tested against a live login. If it refuses one, those panes say so, and a
permanent token is the way to have them.

## Environment variables

| Variable | Effect |
| --- | --- |
| `WRIKE_TOKEN` | Use this token instead of the keyring. Nothing is stored. |
| `WRIKE_HOST` | Use this Wrike host, for example `app-eu.wrike.com`, instead of the stored one. |
| `VISUAL`, `EDITOR` | The editor for descriptions and long comments. Without either, `vi` on Linux and macOS. On Windows it is `edit` (Microsoft Edit) when that is on `PATH`, and Notepad otherwise. See [guide.md](guide.md#the-description-as-markdown) for a Notepad caveat. |
| `BROWSER` | The command that opens a URL given as its last argument. The default is `xdg-open` on Linux, `open` on macOS, and `rundll32 url.dll,FileProtocolHandler` on Windows, which opens your default browser. |
| `WRIKE_TUI_READ_ONLY=1` | Refuse every change. A save says "read-only mode: not saved" and nothing is sent to Wrike. |
| `WRIKE_TUI_NO_RESTORE=1` | Start on the Inbox instead of where the last session ended. |
| `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` | Where the config, the session and the cache go. See [configuration.md](configuration.md#files). |

The variables for development and tests are listed under
[Develop](#develop).
