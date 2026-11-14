# Keys

Press `?` in the client to see the keys for the pane you are in. These are the
defaults, and [Change the keys](#change-the-keys) says how to change them.
`wrike-tui keys` prints every command with its keys as your config sets them.

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
| Confirm | `y` | Go ahead |
| | `n` or `Esc` | Keep it |
| Request form | `Enter` | Keep the answer and go to the next field. On the review, send the form. |
| | `Ctrl+B` | Go back one field |
| | the down and up arrows, or `Ctrl+N` `Ctrl+P` | Move among the choices |
| | `Space` | Pick or drop a check box |
| | `Alt+Enter` | Start a new line in a long text field |
| | `o` | Open the form in the browser, where no text is typed |
| | `Esc` | Close the form |
| Keys | `j` `k`, or the down and up arrows | Scroll |
| | `Esc`, `?` or `q` | Close |

Dates are typed as `YYYY-MM-DD`. An empty date clears it.

With tasks marked, the status, importance and assignee keys and "Set a field"
in the list pane change every marked task, and the details pane still changes
only the open task. [guide.md](guide.md#bulk-edit) has the rest.

## Commands with no key

These run from the `:` palette. Each can be given a key in `config.json`.

| Where | Commands |
| --- | --- |
| List | Group by and Subgroup by status, importance, assignee, due date, folder or nothing. Sort by due date, importance, status, title, last update or creation date. Reverse the sort. Filter by assignee, status, importance or due date. Only my tasks. Clear the filters. Choose the columns. Open every group and subtask. Close every group and subtask. |
| Task | Set a field. Cancel the task. Take out of a folder. |
| Details | Load older changes. |
| Anywhere | Submit a request form. Theme: terminal colors, dark, light or high contrast. Save as default. |

## Change the keys

Put a `keys` object in `config.json`. It maps a command ID to a key, or to a
list of keys. Those keys replace the command's default keys wherever it had
them. An empty list removes the command's keys. A command you do not list
keeps its defaults.

```json
{
  "keys": {
    "task.status": "S",
    "list.group.status": "B",
    "help.close": ["esc", "ctrl+g"],
    "app.quit": []
  }
}
```

A key is one character, such as `S`, `B` or `?`, or one of these names:
`enter`, `esc`, `space`, `tab`, `backspace`, `delete`, `insert`, `home`,
`end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right` and `f1` to `f12`.
Put `ctrl+` in front of a letter or a name for the Ctrl key, as in `ctrl+n`.
`ctrl+c` quits and is not free, and `ctrl+h`, `ctrl+i`, `ctrl+j` and `ctrl+m`
reach the client as `backspace`, `tab`, a new line and `enter`. Alt is not
supported. Names take any case.

Run `wrike-tui keys` to list every command with its ID, where it works, its
keys and its title. A star marks the commands your config changed. A command
with no key, such as `list.group.status`, can get one in the place it works.

The client checks the keys when it starts. It ignores an entry that names an
unknown command, a key it cannot read, a key that another command already has
where both work, or a single character or `space` in a picker, a text field,
the comment box, the palette or a request form, where that character must stay
typeable. The status bar names each ignored entry, and `wrike-tui keys` prints
them.

[configuration.md](configuration.md) has the rest of `config.json`.
