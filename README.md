# notes-keeping

Session notes in `~/.notes-keeping/<date>-<time>-<project>-<session>.md`, committed in that folder's own git repository (never pushed). Sections: `# Objectives` (with `## Updates`), `# Important`, `# Chat`.

## Commands

`/notes-keeping <subcommand>`; every write starts the notes file when the session has none.

| Command | Does |
| --- | --- |
| `init [--new] [objectives]` | start this session's notes; text sets the objectives |
| `objectives <text>`, `update <text>` | set the objectives; once set, add an `[UPDATE]` under `## Updates` |
| `important [text]` | add text, or the selected text, to `# Important` |
| `reply <text>` | queue the selected text and your reply |
| `replies` | open the Replies pane |
| `history [n\|file]` | list earlier notes; pick one to continue it here |
| `show`, `hide` | open or close the Notes pane |

## Selection pane

Select text in the transcript and hold still. The Selection pane opens:

| Key | Does |
| --- | --- |
| `r` | Reply: type the reply, Enter queues it with the selected text |
| `i` | Important: add the selected text to `# Important` |
| `x` | Dismiss |

Any other key hands the keyboard back to the prompt and closes the pane. On a terminal too narrow for the pane, the same actions are a band above the prompt on keys `1`, `2`, `3`.

## Queued replies

A queued reply is a selected text plus your answer. The status line shows `notes: n replies queued`. Queued replies go out ahead of your next message when you press Enter, or you move them into the prompt yourself first.

Open the Replies pane with `/notes-keeping replies`, or click `[edit queue]` beside the Notes button under the prompt.

| Where | Key | Does |
| --- | --- | --- |
| Replies pane | `1`-`9` | open that reply (rows past 9: click) |
| Replies pane | `s` | send queue: put every queued reply into the prompt box, clear the queue, record them in `# Chat`; you press Enter |
| An opened reply | `e` | Edit: a field holding the reply text; Enter keeps the change |
| An opened reply | `d` | Remove it from the queue |
| An opened reply | `b` | Back to the list |
| Under the prompt | click `[send queue: n]` | same as `s` |
| Under the prompt | click `[edit queue]` | open the Replies pane |
| Any pane | Esc | close |

## Notes pane

Toggle with `/notes-keeping show` / `hide`, the `Notes` button under the prompt, or ctrl+q once bound (below).

| Key | Does |
| --- | --- |
| `o` | Set objectives, or add an update once they are set; Enter keeps it |

## ctrl+q

The button's chord works only when `~/.claude/keybindings.json` binds it. The file is not managed by this repo:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    { "context": "Global", "bindings": { "ctrl+q": "app:cycleDiffBase" } }
  ]
}
```

## Tests

`claude plugin test .` and `claude plugin validate .` from this folder.
