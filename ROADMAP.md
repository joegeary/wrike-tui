# Roadmap

What wrike-tui does not do yet, and the release each item is expected in.
Versions are a best guess and move as the work does. What has shipped is in
the [README](README.md) and the [guide](docs/guide.md).

## 0.4.0

- Log in through the browser without registering your own app in Wrike's App
  Console. This is being researched.
- Confirm that Wrike's MCP server, which serves the Inbox and field history,
  takes an OAuth access token. It names the same login server that
  wrike-tui's OAuth login uses, so a token is expected to work. It is not yet
  tested against a live login.
- Hand a task to a coding agent, with its comments and screenshots. The agent
  starts in a new Herdr tab, or takes over the terminal the way `$EDITOR`
  does.

## 0.5.0

- Dependencies between tasks.
- Effort.
- Milestones.
- Launch a blueprint.
- Filter the navigation tree by name.
- Show the total a list will reach beside how much of it is loaded.

## 0.6.0

- Custom item types.
- Time logs and a timesheet.
- Approvals that wait on you.
- More than one Wrike account.

## Waiting on Wrike

These need something Wrike's API does not offer today.

- Mark an Inbox notification read. No public call does it.
- The tasks you pinned by hand in My to-do. The API does not return them.
- Search beyond titles. The API matches task titles only.
- Threaded replies to comments. Wrike refused a reply on the account
  wrike-tui is built against, so this waits for an account that allows them.
- Request forms against a live account. They are built and tested against the
  fake server, from Wrike's published tool schemas, because the one live call
  answered with a server error.
