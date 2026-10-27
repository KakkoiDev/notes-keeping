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
| `replies` | open the panel at the queue view |
| `history [n\|file]` | list earlier notes; pick one to continue it here |
| `show`, `hide` | open or close the panel |

## The panel

Toggle with ctrl+q (see below), `/notes-keeping show` / `hide`, or the `Notes` button under the prompt. Esc closes it. Top to bottom:

1. The todo slot (reserved, see below).
2. A row of views and actions, keys shown on screen.
3. The current view.

| Key | Does |
| --- | --- |
| `o` | Objectives view: objectives and updates |
| `i` | Important view |
| `c` | Chat view |
| `e` | Queue view: every queued reply in its own editable field |
| `s` | Send queue: put every queued reply into the prompt box, clear the queue, record them in `# Chat`; you press Enter |
| `b` | Back to the overview (shown in every view but the overview) |
| `u` | in the Objectives view: opens an input; Enter appends the text as a new `[UPDATE]` under `## Updates` (while the objectives are still empty it sets them instead) |

Every row is also clickable. In the Queue view, Tab to a reply, edit its text, Enter keeps it; `[remove]` beside a reply drops it.

Under the prompt, once a reply is queued: click `[send queue: n]` (same as `s`) or `[edit queue]` (opens the panel at the queue view).

## Selection pane

Select text in the transcript and hold still. The Selection pane opens:

| Key | Does |
| --- | --- |
| `r` | Reply: type the reply, Enter queues it with the selected text |
| `i` | Important: add the selected text to `# Important` |
| `x` | Dismiss |

Any other key hands the keyboard back to the prompt and closes the pane. On a terminal too narrow for the pane, the same actions are a band above the prompt on keys `1`, `2`, `3`.

Queued replies go out ahead of your next message when you press Enter, unless you moved them into the prompt first with `s`.

## The todo slot

The top of the panel belongs to the todo list. The contract for whoever fills it:

- State: the `todos` atom in `hooks/register.tsx`, a `Todo[]` (`{ id, text, status }`, status one of `todo`, `in-progress`, `done`, `declined`; type in `types/index.d.ts`). Write it with `update($, todos, ...)`.
- Drawing: `TodoSlot` in `hooks/todos.tsx`. One button per item; clicking calls `onCycle(id)`, which today cycles the status in the atom with `nextStatus`.
- Nothing persists todos yet; the atom is in memory.

## ctrl+q

The Notes button's chord works only when `~/.claude/keybindings.json` binds it. The file is not managed by this repo:

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
