Session notes in `~/.notes-keeping/<date>-<time>-<project>-<session>.md`, committed in that folder's own git repository (never pushed). Sections: `# Objectives` (with `## Updates`), `# Todo`, `# Important`, `# Chat`.

## Commands

`/notes-keeping <subcommand>`; every write starts the notes file when the session has none.

| Command | Does |
| --- | --- |
| `init [--new] [objectives]` | start this session's notes; text sets the objectives |
| `objectives <text>`, `update <text>` | set the objectives; once set, add an `[UPDATE]` under `## Updates` |
| `important [text]` | add text, or the selected text, to `# Important` |
| `reply <text>` | queue the selected text and your reply |
| `replies` | open the panel at the queue view |
| `todo [sync]` | show the todo list; `sync` runs Laya over the objectives and the last reply now |
| `history [n\|file]` | list earlier notes; pick one to continue it here: its objectives, updates and todo items (statuses kept) are copied into this file under a `Continuation of:` line, and the picked file is never written |
| `show`, `hide` | open or close the panel |

## The panel

Toggle with ctrl+q (see below), `/notes-keeping show` / `hide`, or the `Notes` button under the prompt. Esc closes it. Top to bottom:

1. The todo slot (see [Todo list](#todo-list)).
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

Any other key hands the keyboard back to the prompt and closes the pane. The pane is opened by a timer, not by a key press, so the terminal seats it only from 144 columns (110 once you have opened it yourself and not closed it by hand). Below that the same actions are a bar above the prompt on keys `1` Reply, `2` Important, `3` Dismiss, and a toast says so once per session with the width it needs.

Queued replies go out ahead of your next message when you press Enter, unless you moved them into the prompt first with `s`.

## Todo list

The list lives in the notes file under `# Todo`, between `## Updates` and `# Important`. A file without the section
gets it on the first todo write; the heading layout of older and hand-edited files is read as before.

```
# Todo

- [ ] todo
- [~] in-progress
- [x] done
- [-] declined
```

One item per line. Edit the file by hand at any time; the plugin reads it back on every run. Lines in the section that
are not items are kept as written.

### Who sets what

- At session launch, and after every `/notes-keeping objectives|update`: each `[UPDATE]` entry becomes one item (its first
  line, cut to 120 characters). Each line of `# Objectives` is judged by Laya and becomes an item unless Laya is at least
  0.8 sure it is background. Lines ending in `:` and single-word lines are skipped. A line already judged is never asked
  twice, so an item you delete stays deleted.
- At the end of every turn: Laya reads Claude's last reply against every open item (todo or in-progress), the ones you
  set by hand included, and may move it forward (todo to in-progress, in-progress to done, either to declined). A move
  needs Laya at 0.6 or more and the reply to share a word with the item (two-character runs for Japanese). Done and
  declined items are never moved by the plugin. A move is dropped if you changed that item while Laya was running.
- Every status Laya changes is appended to `~/.notes-keeping/todo-changes.log` (committed with the write): time, notes
  file, item, `from -> to`, Laya's answer and confidence, and `replaced a hand-set status` when the item was one you
  set by click or by hand. Review it there.
- Click an item in the pane to cycle todo, in-progress, done, declined and back, or edit the marker by hand. Those
  statuses are yours until Laya moves them under the rule above.
- Claude never edits the notes file; its Edit and Write on the notes folder are denied.

### In Claude's context

Every prompt carries the list (statuses, and `Work on:` the ongoing item, else the first to-do). A prompt that already
carries the whole notes file, after a compaction or a resume, does not repeat it.

### In the pane

The list is the todo slot at the top of the panel (`TodoSlot` in `hooks/todos.tsx`), read from the notes file on every draw; a click calls the same status cycle as above. It refreshes every five seconds while the pane is open and on every write.

### `/notes-keeping todo [sync]`

Prints the list. `sync` runs the objectives and the last reply through Laya now.

## Laya

Laya is a local classifier (`laya-mlx`, the multilingual checkpoint `aac6fef/laya-multilingual-mlx`, MLX on Apple Silicon).
No account, no key, no network after the first weight download. The plugin runs `hooks/laya_todo.py` with
`~/.laya-venv/bin/python` (override with `NOTES_KEEPING_PYTHON`), one process per sync:

```
python -m venv ~/.laya-venv && ~/.laya-venv/bin/pip install laya-mlx
```

Without it the updates still become items and one toast says why; objective lines wait unjudged until Laya runs.

Cost, measured on an Apple Silicon Mac (macOS 15.5): one process per turn end, 1.3 to 1.9 s wall, of which loading is
about 1.2 s and six questions take about 100 ms; a question alone takes about 10 to 15 ms warm. The run starts after the
turn completes and never blocks it. A second turn ending during a run queues one more run with the newest reply.

What Laya gets wrong, on 22 objective lines and 15 reply cases shaped like the notes (Laya alone, then with the
plugin's floors and word check):

- Line is a task or background: 15 of 22 right alone. With the floor, no real task is dropped, 3 of 9 background lines
  are dropped, and 6 background lines still become items. Delete them by hand; they stay deleted.
- What a reply says about an item: 9 of 15 right alone, and it answers an unrelated reply with "rejected" or "finished"
  at 0.9. With the floor and the word check, no wrong move was applied, but only 3 of 11 real moves were. Expect
  statuses to lag: click them.

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
