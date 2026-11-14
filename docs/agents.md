# Hand a task to a coding agent

Press `w` on a task and pick what you want done. A coding agent starts in the
right folder with the task, its comments and its screenshots already in hand.
You land in an interactive session with it, the same as if you had started it
yourself.

wrike-tui never talks to a model and holds no key for one. It writes the task
to a folder on your disk and starts an agent CLI that is already on your
machine, such as `claude`, `codex` or `cursor-agent`. What the agent sends
anywhere is up to the agent and how you set it up.

## Start one

1. Select a task in the list, or open it in the details pane.
2. Press `w`, or run "Hand to an agent" from the `:` palette.
3. Pick a prompt and press `Enter`. `Esc` cancels.
4. When the config does not say where the agent runs, pick a folder from the
   second list. It offers the folder you started wrike-tui in and every path
   your config names.

The agent then starts in one of two places:

- **A new Herdr tab**, when wrike-tui runs inside Herdr and `herdr-app` is on
  your `PATH`. wrike-tui
  stays where it is, and the status bar says "Claude started in a new Herdr
  tab".
- **This terminal** everywhere else. The agent takes it over the way
  `$EDITOR` does. When you quit the agent, wrike-tui comes back and fetches
  the task again, since the agent may have changed it.

## The prompts

Four prompts come built in:

| Prompt | What the agent is asked |
| --- | --- |
| Implement | Implement the task, keep the changes focused, and run the tests. |
| Plan | Make a plan. Change no code yet. |
| Investigate | Find the code the task concerns and explain the cause or the approach. Change nothing. |
| Context only | Read the task, sum it up in a few lines, and wait for instructions. |

Your own list in `agent.prompts` replaces them. A prompt with an empty name or
an empty text is left out.

The agent receives one short message: the prompt, then where the task is.

```
Make a plan for this Wrike task. Do not change any code yet.

The Wrike task is in /home/you/.local/state/wrike-tui/agent/IEAAAAAQKQ.../task.md. Read it first. Its screenshots are in the same folder: login-error.png.
```

The task itself stays in the file. A long task with its comments could pass
the size limit one argument has on Linux.

## Where the agent runs

`agent.folders` sends tasks to a folder on disk by the Wrike folder or project
they are in. A task matches through any folder it is in, and through that
folder's parents as far as wrike-tui has loaded the tree in the navigation
pane. The nearest folder wins.

Name a Wrike folder by its title. A title matches whatever its case. wrike-tui
does not show a folder's ID anywhere, so titles are enough. If two folders
share a title, the folder's ID from Wrike's API also works, and on the same
folder an ID wins over a title.

When no folder matches, `agent.workspace` is used. Without it, you pick the
folder each time.

`~` is your home folder in every path, and a path that does not start with `/`
is relative to your home folder. A folder that does not exist stops the
handoff with a message in the status bar.

## Configure it

Everything is optional. With no `agent` block at all, `w` runs `claude`, picks
Herdr or the terminal by itself, and asks for the folder.

```json
{
  "agent": {
    "command": ["claude"],
    "open": "auto",
    "workspace": "~/dev/scratch",
    "folders": {
      "Mobile app": "~/dev/mobile",
      "Platform": "~/dev/api"
    },
    "prompts": [
      { "name": "Plan", "prompt": "Make a plan for this task. Do not change any code yet." },
      { "name": "Fix it", "prompt": "Fix this bug. Write a failing test first." }
    ]
  }
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `command` | `["claude"]` | The agent CLI and its fixed flags. The message goes last. `claude`, `codex` and `cursor-agent` all take a first prompt that way. |
| `open` | `"auto"` | `"auto"` uses Herdr when wrike-tui runs inside it and `herdr-app` is on your `PATH`, and the terminal otherwise. `"herdr"` always uses Herdr and refuses outside it. `"terminal"` always uses the terminal. |
| `workspace` | none | The folder used when no entry in `folders` matches. |
| `folders` | none | A Wrike folder or project, by title or ID, to the folder on disk its tasks run in. |
| `prompts` | the four above | The prompts to pick from, each a `name` and a `prompt`. |

A command that is not on your `PATH` stops the handoff and says so, for
example "claude is not on your PATH". An `agent` block wrike-tui cannot read,
such as `"open": "tmux"`, is treated like any other setting it cannot read:
`config.json` is renamed to `config.json.bad`, the status bar says so, and the
defaults load.

## What is written to disk

Each handoff writes a folder for the task in the state folder:
`~/.local/state/wrike-tui/agent/<task ID>/` on Linux and macOS, and
`%LOCALAPPDATA%\wrike-tui\state\agent\<task ID>\` on Windows.
`XDG_STATE_HOME` moves it on every platform. The folder is emptied and
written again each time you hand that task off. It stays after the agent
starts, because the agent reads it while it runs.

- `task.md` holds the title, the link, the status, the importance, the
  assignees, the dates, the custom fields that have values, the folders, the
  description, a list of the attachments, and the comments oldest first with
  their authors' names.
- Every image stored in Wrike is saved beside it at full size under its own
  name, up to 10 MB each. Larger images, other files and linked files such as
  Google Docs are named in `task.md` and not downloaded. A download that fails
  is named there too, and the handoff goes on without it.
