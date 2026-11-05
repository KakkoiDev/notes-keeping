Session notes in `~/.notes-keeping/<date>-<time>-<project>-<session>.md`, committed in that folder's own git repository (never pushed). Sections: `# Objectives` (with `## Updates`), `# Todo`, `# Important`, `# Chat`.

## Commands

`/notes-keeping <subcommand>`; every write starts the notes file when the session has none.

| Command | Does |
| --- | --- |
| `init [--new] [objectives]` | start this session's notes; text sets the objectives |
| `objectives <text>`, `update <text>` | set the objectives; once set, add an `[UPDATE]` under `## Updates` |
| `important [text]` | add text, or the selected text, to `# Important` |
| `reply <text>` | queue the selected text and your reply |
| `paste [--from <source>] [text]` | queue pasted text (a Slack message, an email) as its own entry; no text takes the clipboard. `--from` takes one word |
| `note <text>` | add a note to the last pasted text; each note is one more line |
| `replies` | open the panel at the queue view |
| `todo [sync]` | show the todo list; `sync` runs Laya over the objectives and the last reply now |
| `history [n\|file]` | list earlier notes; pick one to continue it here: its objectives, updates and open todo items (statuses kept) are copied into this file under a `Continuation of:` line, and the picked file is never written. Todo items marked done `[x]` or declined `[-]` are not copied, nor is an objective whose items are all done or declined (an objective with no item, or with one open, is copied) |
| `show`, `hide` | open or close the panel |
| `debug` | the selection poll: its tick count, when it last ran, the live selection, and its last ten outcomes, each one saying why a selection opened the pane or did not |

## The panel

Toggle with ctrl+q (see below), `/notes-keeping show` / `hide`, or the `Notes` button under the prompt. Esc closes it. Top to bottom:

1. A row of views and actions, keys shown on screen.
2. The current view. The panel opens on the Todos view; no other view shows the todo list.

| Key | Does |
| --- | --- |
| `t` | Todos view: the todo list (see [Todo list](#todo-list)) and the notes file path |
| `n` | Paste view: paste outside text (a Slack message) and note parts of it (see [Pasted text](#pasted-text)) |
| `o` | Objectives view: objectives and updates |
| `i` | Important view |
| `c` | Chat view |
| `q` | Queue view: every queued reply in its own editable field |
| `h` | History view: earlier notes, newest first; Up and Down pick one, Enter opens a read-only preview of what it holds, `a` attaches the picked note after a `y` / `n` confirmation (same copy as `/notes-keeping history <n\|file>`, so done and declined items stay behind); the original is never written. `b` in a preview or the confirmation steps back |
| `l` | Logs view: the `# Logs` section of the notes file, newest first, read-only: time (UTC), who, item, `from -> to` (or the text of an objective or update) |
| `s` | Send queue: put every queued reply into the prompt box, clear the queue, record them in `# Chat`; you press Enter |
| `w` | Work view: firstmate's fleet, one row per task and per live captain call (see [Work view](#work-view)); shown only with a bridge, labelled `Work (N!)` while N rows need you |
| `b` | Back to the Todos view (shown in every view but Todos); from a Work row's details, back to the Work view; from its report, back to its details |
| `u` | in the Objectives view: opens an input; Enter appends the text as a new `[UPDATE]` under `## Updates` (while the objectives are still empty it sets them instead) |
| `e` | in the Objectives view: opens the notes file in `$VISUAL`, else `$EDITOR`, in a tmux popup (`tmux display-popup -E`; the session must run inside tmux), then shows and commits what the editor saved and runs the todo list over it, so an `[UPDATE]` written there becomes an item as one from `u` does; an `[UPDATE]` header the editor left with no text under it makes no item, and a toast names it. Todo runs keep writing the file while the editor is open. From the update box (after `u`, once the objectives are set), where `e` is typed into the field, ctrl+e does it instead (bind `{ "context": "PaneField", "bindings": { "ctrl+e": "app:toggleDiffNoiseFilter" } }` in `~/.claude/keybindings.json`), or a click on Open in editor: it first appends `[UPDATE] <time>` under `## Updates` holding the box's text, opens the editor on the line after it (`file:line` for hx, `+line` for vi, vim, nvim, nano, emacs and kak, the top of the file otherwise), and drops that header again if the editor leaves it empty |

Every row is also clickable. A click in the panel leaves the keyboard there, even when the prompt held it before, so its keys work next; a click on a todo row's marker also selects that row for `f`, `p` and `d`. In the Queue view, Tab to a reply, edit its text, Enter keeps it; `[remove]` beside a reply drops it.

Under the prompt, once a reply is queued: click `[send queue: n]` (same as `s`) or `[edit queue]` (opens the panel at the queue view).

## Selection pane

Select text in the transcript and hold still. The Selection pane opens (text selected inside the notes panel or the Selection pane itself does not open it; a reply box left behind the Notes tab gives way to a new selection):

| Key | Does |
| --- | --- |
| `r` | Reply: type the reply, Enter queues it with the selected text |
| `i` | Important: add the selected text to `# Important` |
| `x` | Dismiss |

Any other key hands the keyboard back to the prompt and closes the pane. The pane is opened by a timer, not by a key press, so the terminal seats it only from 144 columns (110 once you have opened it yourself and not closed it by hand). Below that the same actions are a bar above the prompt on keys `1` Reply, `2` Important, `3` Dismiss, and a toast says so once per session with the width it needs.

Leaving the pane never blocks the next selection: Esc, the close mark, `x`, `i`, a sent reply, the Ctrl+q chord, switching tabs, and a click in the transcript (which also closes an open reply box) each leave the next selection free to open the menu. Selecting the same text again after Esc opens the menu once the poll (every 600 ms) has read any other text in between, as it does during a drag; a re-selection quicker than that (a double click on the same word) does nothing while the terminal still holds the old selection, because the plugin cannot tell it from a retained one. An empty reply keeps the box open.

Queued replies go out ahead of your next message when you press Enter, unless you moved them into the prompt first with `s`.

## Pasted text

The Paste view (`n` in the panel) holds text from outside the session and takes notes on parts of it the way the transcript does:

| Step | Keys |
| --- | --- |
| Open the panel at the Paste view | ctrl+q, then `n` |
| Paste the text into the field, keep it | the terminal's paste, then Enter |
| Note a part | select it with the mouse and hold still; the Note box opens on it; type the note, Enter queues it. The panel comes back with that part highlighted |
| Leave a Note box without a note | Esc; the panel comes back at the Paste view |
| Send the notes | `s` in the panel (into the prompt), or Enter on your next message |
| Clear the text | `x` |

Each note goes out like a queued reply, as its own block with the part it is on:

```
[PASTED]
QA is still open.
[USER] who owns QA?

what should I answer?
```

Sending leaves the text in the view and clears its highlights, so the next notes start on the same text. `x` empties it. The status line counts notes on pasted text apart from replies (`notes: 1 reply, 2 notes on pasted text queued, ...`).

The commands below do the same from the prompt, sending the whole text with its notes as one block:

1. `/notes-keeping paste --from Slack <the message>` (or copy it and run `/notes-keeping paste`).
2. `/notes-keeping note <text>` once per note, or edit the notes in the Queue view (`q`), where the entry is the line `[PASTED from Slack] ...` with its notes in the field under it.
3. Press Enter on your next message (or `s` in the panel): Claude gets the text and its notes as one block ahead of what you typed, and `# Chat` records the same block:

```
[PASTED from Slack]
Can we ship Friday?
[USER] QA owner is out this week
ask for the QA list

what should I answer?
```

### Marks on replied text

A reply to text selected inside one block of Claude's reply is a note anchored there. From the moment it is queued, that text in the transcript is drawn as a link (blue, the reply's other formatting kept); a plain click on it opens the panel at the note: the quoted text, your reply, and whether it is still queued (`b` goes back). The mark comes back after scrolling, a resize and `--continue`.

In `# Chat` the anchor follows the quoted text: `[AI_AGENT] brown fox <!-- note:13y3ouz row:<message id> at:0 -->`. `row` is the transcript row the text was selected in and `at` which occurrence of the text in that row; leave the comment in place when you edit the file. The prompt Claude receives carries the pair without it.

Limits:

- Only Claude's reply text is marked; your own prompts, tool rows and a selection over several rows (which has no row) keep a note without a mark.
- The terminal reports no position inside a row, so when the same text appears twice in one block the first note marks the first occurrence, a second note on the same text the next one.
- Text in a fenced code block is not marked (a link cannot be drawn there). A mark that would cut a code span, bold or a link grows to hold it whole; a link inside the mark is drawn as its label.
- The mark takes over the drawing of that block, so it is drawn by the plugin with the engine's markdown renderer and the reply bullet (`⏺`). Clicks need the fullscreen terminal; ctrl, alt or cmd click opens the link's `https://notes-keeping.invalid/...` target instead.
- Rows from before a compaction are not drawn after `--continue`, so their notes stay in the file without a mark.

## Todo list

The list lives in the notes file under `# Todo`, between `## Updates` and `# Important`. A file without the section
gets it on the first todo write; the heading layout of older and hand-edited files is read as before.

```
# Todo

- [ ] todo
- [~] in-progress
- [x] done
- [-] declined
- [!] blocked
```

One item per line. Edit the file by hand at any time; the plugin reads it back on every run. Lines in the section that
are not items are kept as written.

An item can carry a short label before its whole text: `- [ ] **Todo labels in the panel**: for the todo items, would it
be possible to ...`. The pane, `/notes-keeping todo` and Claude's context name the item by its label; the text after it
is kept whole. See [Labels](#labels).

Every write the plugin makes to the list gives each item without one a short id at the end of its line,
`- [ ] Ship the bridge <!-- id:1kmv58p -->`, and puts the same id at the end of the objective or update line the item
came from. The id never changes: an item and its objective or update stay linked, and an item keeps its link to a
firstmate task, its hand-set mark and its bridge status, when you edit the wording of either line. Leave the id where it
is when you edit. A file from before ids works as before, matched by text (lowercased, whitespace folded), and gets its
ids on the next write; your wording is never changed. The pane, the objectives view and Claude's todo list leave the ids
out.

### Who sets what

- At session launch, after every `/notes-keeping objectives|update`, and after the editor (`e`) closes: one item per numbered objective (`1.` and on,
  with the lines wrapped under it, its bullets and links left out) and one per `[UPDATE]` block (its first sentence, past
  a `Project: x` label line, quotes removed), kept whole on one line, with no Laya call. A wrapped line joins the one above
  it when that line does not end a sentence and the next starts in lower case or a digit. Any other paragraph of the
  objectives is one candidate, and a paragraph of bullets is one per bullet: Laya judges each and it becomes an item
  unless Laya is at least 0.8 sure it is background. Lines ending in `:`, headings and single-word lines are skipped.
  A line already judged is never asked twice, so an item you delete stays deleted.
- At the end of every turn: Laya reads Claude's last reply against every open item (todo or in-progress) and may move
  it forward (todo to in-progress, either to done), except an item whose status you set by click or by hand: Laya never
  moves that one. A move needs the
  reply to share a word only that item has (two-character runs for Japanese); a link in the reply counts only for the
  item holding that same link. A start cue ("started", "partway", "still", "but not", "spawned", "running", "PR is
  open", "waiting on your merge word", "not merged") or a finish cue ("done", "merged", "fixed") outside quotes in the
  reply plus Laya at 0.5 on that option moves it; a start cue wins over a finish cue, so a worker reported spawned or
  running, or work ready but not merged, does not close its item. With no cue Laya needs 0.9 (see How accurate it is).
  Laya never declines an item, on a refusal
  cue ("skipped", "won't", "dropped") or on its own however sure: only you or firstmate decline. A refusal cue also
  keeps the other cues from counting. Done and declined items are never moved by the plugin. A move is dropped if you
  changed that item while Laya was running.
- Every change is logged in the notes file's `# Logs` section with who made it (see [Action log](#action-log)). A Laya
  move carries Laya's answer and its own probability. Undo one by clicking the item's marker.
- Click an item's marker in the pane (or Enter on it) to cycle todo, in-progress, done, declined and back, step it with `f` and
  `p` (see [In the pane](#in-the-pane)), or edit the marker by hand. Blocked is not in the cycle: a click, `f` or `p`
  on a blocked item sets it to todo. Those statuses are yours: Laya leaves them, and a firstmate bridge report or
  another click moves them.
- Firstmate, when the session root holds an executable `config/notes-keeping-bridge` (a firstmate home that opted in;
  the bridge is this plugin's `bin/notes-keeping-bridge`, and `FM_ROOT` / `FM_HOME` name the firstmate checkout and home
  when it is run from here rather than through a link in `config/`):
  - On every todo run the plugin runs `bridge status <notes file>`, which prints
    `{"<item text>": {"status": "blocked" | "in-progress" | "done" | null, "task": "<id>"}}` for every item linked to a firstmate
    task; an item linked by id (`bridge link <task> id:<id>`) is printed as `"id:<id>"` with an `"id"` field and
    matched by id, an item linked by text (older links) by its text. A linked item follows that status forward and Laya is never asked about it; a null status leaves it where it
    is. `done` comes only from a landing: firstmate saw the task's PR merge (`state/<task>.pr-poll-merge-notified`), or
    its cleanup recorded a done outcome; a task whose last
    state line is `done` (a PR opened, a branch ready to land) is still `in-progress`. The move is logged as `firstmate` with the task id. `bridge link <task> <item> --by <name>` records who made
    the link (firstmate, a crewmate); `status` then prints a `"by"` field and the log row names it. A status you set on
    a linked item stays until the bridge reports a different one.
  - `bridge block <task> --reason <text> [--by <name>]` marks a task that could not be started. Its linked items report
    `blocked` with a `"reason"` field, move to `[!]` from todo or in-progress, and the log row reads
    `<task>[, by <name>]: <reason>`. The block holds until `state/<task>.status` gets a state line written after it, or an outcome is recorded after it; the
    item then follows the status the bridge reports (in-progress, done) out of blocked.
  - After every todo write, every click, and every five seconds, the plugin runs `bridge notify <notes file>` with the
    changes since its last write on stdin: `+ [ ] <item>` for a new item, `<item>: <from> -> <to> (<who>)` for every
    status change, each followed by ` [id:<id>]` when the item has an id. `<who>` is `captain` for a click, `laya`
    for a Laya move, `firstmate <task>` for a bridge move, and `unknown` for a change found in the file that the plugin
    did not make (a hand edit, another program). The bridge files them as one inbox note whose first line, the part
    firstmate's notification shows, is the first change (`<item>` or `<item>: <from> -> <to> (<who>)`), with
    `(+N more)` when there are several.
  - Every five seconds an interactive session with a notes file runs `bridge pending <notes file>`, which hands out
    the updates firstmate queued for that file with `bridge update <notes file> <text> --by <name> --task <task-id>`.
    The plugin adds each one as an `[UPDATE]` under `## Updates`, logged as `firstmate` with `<task-id>, by <name>`,
    with the id of the item the todo run makes from it already on its line, and answers that id through
    `bridge answer <request>`; `update` prints it. An update whose text an item already has answers that item's id and
    makes no second one; an update the todo run would make no item from (a `Name: value` label alone, a text it has
    seen before) is answered with why and not written. `bridge active` prints the notes file the latest session asked
    for, within the last 15 seconds, so firstmate needs no notes file of its own.
  - `bridge open <notes file>`, read-only, prints `[{"id", "status", "text"}]` for every item under `# Todo` that is not
    done or declined, in file order, so firstmate can `link` the captain's existing item instead of queuing a duplicate.
  - Every five seconds an interactive session runs `bridge fleet <notes file>` for the [Work view](#work-view).
    `bridge waiting <task> <text>` sets the Waiting-on cell of a task's row, held until the task writes its next state
    line; `bridge crew <task>` prints `fm-crew-state.sh` for one task.

### Work view

`w` in the panel. Read-only rows from `bridge fleet`, refreshed every five seconds:

- one row per task with a meta whose tmux window is live, or whose worker is gone without a `done` state line;
- one row per live captain hold (captain kind, not done, no open blocker, no future `hold_until`, set under 14 days
  ago) whose origin task is a shown row, or that is linked to an item in this notes file. Other live holds are only
  counted: `+N other calls · /bearings`;
- a gone task record (window gone, last state line `done`) is hidden and counted, `6` shows them.

Rows sit under a header per group, in the filter order: `Needs you · N`, `Firstmate`, `Running`, `Idle`, `Done`,
`Gone`; a group with no shown row has no header.

A row's report is the `.md` path its last state line (or hold reason) names, else `data/<task>/report.md` when that
file exists. `bridge fleet` reads the report's head into a summary: the title (first `# ` heading), the outcome (a
`Status:`/`Outcome:`/`Verdict:`/`Result:`/`Conclusion:` line before the first section, else the first line under a
Summary/Outcome/Verdict/Result/Conclusion/TL;DR heading, else the first prose line), what it asks the captain (a
`Needs:`/`Decision needed:` line, else the first line under a heading such as "for the captain", "open questions" or
"decisions needed") and the file's mtime. Under the row: `report <age>  <title>: <outcome>`, and on a `!` or `?` row
`needs  <ask>`.

Columns: the linked todo item's label, else the backlog title, else the task id; the state (`call` for a hold,
`decision`, `idle` for a paused scout); the age of that state line; Waiting on. Waiting on is firstmate's text from
`bridge waiting` while it holds, else `you: <hold reason>`, `firstmate: <text>` for a decision, block or failure,
`gone: <text>` for a worker whose window is gone, `worker: <text>` while working, or the paused worker's own text.

Flags, from structured records only, never from a worker's words:

- `!` needs you: a live captain hold. A new one raises one native notification (`Firstmate`), and the status line
  under the prompt reads `work: N needs you · w`, after the queued-replies line when there is one.
- `?` firstmate's move: a last state line of `needs-decision`, `blocked` or `failed`, or a worker gone without `done`.

Rows sort `!`, then `?`, then newest first. The status-log line is the task's last event, not its current state: `r`
reads the current state.

| Key | Does |
| --- | --- |
| Up, Down, Enter | select a row; Enter opens its details: the report summary, the last line and its age, PR, report path, linked todo item (`d` opens it) |
| `a` | on a `!` or `?` row: an input; Enter fills the prompt with `<task> <key>: <text>`, and you press Enter to send it to firstmate. The plugin closes nothing itself |
| `v` | read the report in the panel: its summary, then the whole file as markdown (cut at 60,000 characters); `y` there copies its path |
| `e` | open the report in `$VISUAL` / `$EDITOR` in a tmux popup |
| `u` | open the PR in the browser |
| `y` | copy the PR link, else the report path, else the task id |
| `g` | `tmux switch-client` to the worker's window, while it is live |
| `r` | read `fm-crew-state.sh` for that one task (up to a few seconds) into its details |
| `1` to `6` | show or hide: `[!] you`, `[?] firstmate`, running, idle, done, gone |
  - Without the file nothing of this runs.
- Claude never edits the notes file; its Edit and Write on the notes folder are denied.

### In Claude's context

Every prompt carries every item that is not done or declined, in file order with no cap, and one line counting the done
and declined items it leaves out, which points to the notes file's `# Todo` section (each item with its marker, `[~]` for in-progress, and an instruction to start every
open item now, in parallel, not waiting on one answer before starting another independent one; when an item is `[!]`
blocked, an instruction to open the reply by telling the captain which items are blocked and why), each item as `label: text` with the text cut to 120 characters, or the cut text alone when it has no
label. A prompt that already
carries the whole notes file, after a compaction or a resume, does not repeat it. A compaction is seen through
`session.compact` (the main conversation's, not a skipped or precomputed one, nor a subagent's), or by a changed first
message where the engine puts its summary there.

After an attach from the History view (`a`, `y`), the next prompt also carries the attached file whole, read only,
labeled `Previous session's notes`: its Important, Chat and done or declined items included, which the copy leaves
behind. Later prompts do not repeat it. Every prompt that carries the whole notes file carries it again while the
notes still open with `Continuation of:` that file, a notes file of the folder (a line edited to name any other path
puts nothing in). Only the directly attached file goes in, not the file it continued in turn. No size cap: it is a notes file of the same kind as the current one, which goes in whole too (the largest
here were about 43 KB). `/notes-keeping history <n|file>` puts the attached file in context with its own output instead.

### Action log

Every action on the objectives and the todo list is one row at the end of the notes file, under `# Logs`, oldest first:

```
# Logs

- 2026-10-28T08:49:00Z | laya | status | id:1uxnkut Investigate the Sentry alert | in-progress -> declined | rejected 0.95
- 2026-10-28T09:07:22Z | captain | status | id:1uxnkut Investigate the Sentry alert | declined -> todo
- 2026-10-28T09:08:00Z | captain | update | - | - | Add a logs tab
```

Columns: UTC time, actor id, action (`status`, `added`, `objective`, `update`, `attach`), item id and label (`-` for
none), `from -> to` (`none -> <status>` for an added item, `-` for none), and a note (Laya's answer and probability,
the firstmate task, the copied file). The actors are listed once in `hooks/actors.ts`:

| id | kind | who |
| --- | --- | --- |
| `captain` | human | a click or key in the pane, or a command typed at the prompt or sent from the phone |
| `firstmate` | AI agent | a bridge move or an update queued through the bridge (Claude Opus 5.5 via the bridge), with the task id and `--by` name |
| `laya` | AI classifier | a Laya move or a line Laya judged a task (`aac6fef/laya-mlx` on replies, the multilingual checkpoint on objective lines) |
| `plugin` | plugin | an item made from an objective or update as written, with no Laya call |
| `unknown` | unknown | a change found in the file that the plugin did not make, or a command from another origin |

A change the plugin did not make is never logged as the captain. The section is excluded from Claude's context and
from what Laya reads; every prompt carries one line saying where it is, so Claude reads it when asked about the
history of actions or who changed a status. Only content in the objectives and updates makes todo items: lines in
`# Important`, `# Chat` or `# Logs` never do, and a write to them is not a todo change. The first rows a notes file
gets bring along its rows from the old `~/.notes-keeping/todo-changes.log`, which is no longer written and is left as
it was. The `l` view shows the newest 200 rows.

### In the pane

The list is the Todos view of the panel (`TodoSlot` in `hooks/todos.tsx`), read from the notes file on every draw. Each
row is two click targets: the marker (`[ ]`) calls the same status cycle as above, logged as the captain; the text opens
the Item view: the item's label, status and whole text, and the objective or update it came from, whole (a numbered
objective with its details and links, an update with its `[UPDATE]` header), found by id, else by text. An item written
in the list by hand says so. `b` goes back. The list refreshes every five seconds while the pane is open and on every
write.

The focus ring starts on the first shown item as the panel opens, no click needed; the selected item is drawn bright,
the others dim.

| Key | Does |
| --- | --- |
| `j`, `k` | select the next or previous shown item; stays put at either end |
| Up, Down | move the ring through every marker and text in turn (a marker or text under the ring selects its item) |
| Enter | with the ring on its marker, cycle its status: todo, in-progress, done, declined, todo; blocked goes to todo. With the ring on its text, open it as `d` does |
| `d` | open it in the Item view, as a click on its text does |
| `f` | step it forward one status; at declined it stays declined |
| `p` | step it back one status; at todo it stays todo |
| `1` `2` `3` `4` `5` | show or hide the `[ ]` todo, `[~]` in-progress, `[x]` done, `[-]` declined, `[!]` blocked items |

The row of toggles above the list is also the marker legend: `1: [ ] todo: shown  2: [~] in-progress: shown ...`,
the same marks and names, in the same order, as the legend Claude reads with the list (both come from `MARKS` in
`hooks/todo.ts`).
A hidden status is drawn dim and its items are skipped by `j`, `k`, Up and Down; when every status is hidden the list reads
`(n items, every status hidden)`. A status change or a toggle that hides the selected item moves the selection to the
next shown item, or to the one before when it was the last. A step that leaves the status as it was (`f` at declined,
`p` at todo) writes nothing and notifies nothing. The shown statuses are kept for the session: closing and opening
the panel keeps them, a new Claude session starts with all shown.

### `/notes-keeping todo [sync]`

Prints the list. `sync` runs the objectives and the last reply through Laya now.

## Labels

Laya only picks among given answers, so it cannot write one. Each item without a label is sent once to `haiku` through
the session's own client (`$.model.complete`, a 2 to 6 word label in the item's language); the reply is written into the
file as `**label**: ` before the text. An item is asked once, whatever the answer: a reply that is not one short line
(more than 6 words or 48 characters) leaves it unlabeled, and a failed call leaves it unlabeled with one toast per
session. An unlabeled item is shown by its text cut to 120 characters. A label you write or edit by hand is kept. Items
added before labels existed are asked on the next run; their text, cut at 120 characters back then, still matches its
whole source line, so they are not added again.

## Laya

Laya is a local classifier (`laya-mlx`, MLX on Apple Silicon; checkpoints `aac6fef/laya-multilingual-mlx` and `aac6fef/laya-mlx`).
No account, no key, no network after the first weight download of the two checkpoints (`laya-multilingual-mlx` for objective lines, `laya-mlx` for replies). The plugin runs `hooks/laya_todo.py` with
`~/.laya-venv/bin/python` (override with `NOTES_KEEPING_PYTHON`), one process per sync:

```
python -m venv ~/.laya-venv && ~/.laya-venv/bin/pip install laya-mlx
```

Without it the updates still become items and one toast says why; objective lines wait unjudged until Laya runs.

Cost, measured on an Apple Silicon Mac (macOS 15.5): one process per turn end, 1.3 to 1.9 s wall, of which loading is
about 1.2 s and six questions take about 100 ms (a sync that also judges objective lines loads both checkpoints: about 2.9 s); a question alone takes about 10 to 15 ms warm. The run starts after the
turn completes and never blocks it. A second turn ending during a run queues one more run with the newest reply.

### How accurate it is

Measured with the files in `eval/`. Every case is hand-written and the author of the cases also wrote the rules, so read
these as optimistic. `fixtures.json` holds a tune set and a held-out set (88 reply cases and 38 objective lines each, different
items and reply wordings, 24 of the reply cases in Japanese); `blind.json` (17 reply cases, 24 lines) and `held2.json`
and `held3.json` (40 reply cases each) are later, smaller sets; `extra_tune.json` is 15 more tune cases. Run
`collect.py <model> <out.json> [fixtures]` with the venv python, then `KEY=base GATE=v2 CUE=v3 python evalmoves.py <out.json> <split>`.

What Laya alone says about a reply is weak. Right answers out of 88 on tune, 88 on held-out, 17 on the third set: the
multilingual checkpoint 56, 45, 5; the English checkpoint (`aac6fef/laya-mlx`) 57, 56, 10, and 61, 65 with a prompt that
describes each option. It also said "started" at 0.81 for "Docs are written." and "started" at 0.02 for "half wired up".
Its confidence does not track its precision: for the multilingual checkpoint, over the 193 reply cases, a move at 0.6 or
more was right 88% of the time, at 0.9 or more 93%, at 0.95 or more 89%, at 0.99 or more 80%. Raising the floor does not make it safe.

What changed: reply statuses are scored by the English checkpoint, the multilingual one still judges objective lines
(Japanese lines need it). A move needs two things from the reply:

- Its own words. Words match by stem and by prefix ("naming" and "name"), words of four letters or more, and words
  several items share ("notes", "pane") do not count, so a reply about a sibling no longer names this item.
- A cue. Only the sentences that name the item, and the ones that carry on from them without naming another item, are read
  for the `rejected`, `started` and `finished` regexes in `hooks/todo.ts` (checked in that order), with the item's own
  words removed first so "the skipped-move counter" is not a refusal. The cued option gets +8 nats on Laya's log
  probability. The result must reach 0.5 on the cued option and 0.9 on any other. A status the captain set by hand is
  never moved (2026-10-29: the captain set Review PR #27921 back to in-progress and Laya closed it again).
- Since the actor log change, Laya never moves an item to declined: a refusal cue lifts nothing, and rejected at any
  probability leaves the item (the Sentry item was declined on one refusal cue with Laya at 0.05 on rejected, and the
  editor-key item on "Dropping" in a carry-on sentence with Laya at 0.19). Start and finish cues count as before. A
  reply word under four letters is no longer removed as the start of an item word ("not" in "notes"), so "will not be
  written" reads as a refusal, not a finish.
- Since 2026-10-29 (three false dones, each Laya under 0.32 on finished, lifted to 1.00 by a cue the reply did not
  say of the item): a link in the reply names only the item holding that same link, so the owner in
  `github.com/KakkoiDev/example/pull/45` does not name an item that says "KakkoiDev"; quoted text ("...", `...`, “...”,
  「...」) is not read for cues, so `Pushback on "done"` closes nothing; "but not" is a start cue, so "written but not
  posted" is partway. Same eval scores as before. Not fixed: one incidental word an item alone has ("ticket",
  "validation") next to a finish word about something else still closes it.

Real moves that landed right, landed wrong, or did not land (right / wrong / missed):

| set (real moves) | before (multilingual, 0.6 floor, word check) | PR 18 first version (English, cues on the whole reply) | now |
| --- | --- | --- | --- |
| tune (75; chosen here) | 49 / 7 / 14 | 62 / 2 / 4 | 70 / 0 / 5 |
| held-out (66) | 34 / 3 / 31 | 54 / 0 / 12 | 66 / 0 / 0 |
| `held2` (24) | | | 21 / 1 / 3 |
| `held3` (24) | | | 20 / 2 / 3 |
| `blind` (6) | 2 / 2 / 4 | 3 / 0 / 3 | 4 / 0 / 2 |

Do not read the 66 / 0 / 0 as accuracy. The 12 misses of the first version were all the word check failing on two items
the replies paraphrased ("the file naming" for "name stamped"). The word check and the cues were then rebuilt after
reading those misses, so the held-out set is tuning data now. `held2` was diagnosed the same way. `held3` was written
after that rule set was frozen and scored 18 right, 5 wrong, 3 missed; two causes (a refusal cue firing on the item's own
noun phrase, and "instead of" firing on any reply) were fixed and it was re-scored, so it is tuning data too. No
untouched set remains. The honest estimate is the fresh-set number: about 1 move in 5 wrong on replies written
after the rules, before those two fixes.

Per status over all five sets (`base` scores, same gate; right / wrong / missed of the real moves to that status,
wrong counting a move to that status on a case that said anything else):

| status | before | now |
| --- | --- | --- |
| started (62) | 60 / 1 / 2 | 60 / 1 / 2 |
| done (62) | 59 / 2 / 3 | 59 / 1 / 3 |
| declined (62) | 54 / 0 / 7 | 0 / 0 / 62 (never moved by Laya) |

The wrong done left is the decoy below; the other was the "not" in "notes" bug. These sets are tuning data (see above),
so read the zeros as optimistic.

The 0.9 floor for a reply with no cue is the first one that was chosen on one tune set.

Limits:

- A start or finish cue decides, Laya breaks ties. With one in the reply the result is near 1.0 whatever Laya said.
  A start word near a real finish ("merged; the hook is running in every session") keeps the item open: click it.
  Cues are read per sentence, and a sentence that follows one
  naming the item is assumed to carry on about it ("The counter is begun. I dropped the retry." reads as a refusal).
  The lists are short and English plus a few Japanese words; wording they miss falls back to Laya alone at 0.9.
- A decoy that shares two or three domain words with an item and carries a cue ("The notes folder is committed after
  every write" for "Warn when the notes folder has a remote") still moves it. Laya does not catch it either.
- Replies Laya and the cues both miss do not land. Click them.
- Objective lines (task or background), multilingual checkpoint, 0.8 floor: 0 of 18 tasks and 5 of 20 background lines
  dropped on tune, 0 of 18 and 2 of 20 on held-out. A task-verb rule dropped 19 of 20 background lines but also 6 of
  12 tasks on the third set, so it was not adopted. Background lines that become items: delete them by hand; they stay
  deleted. The typed-decisions checkpoint, per-option yes/no questions and described options did not beat the plain prompt on statuses
  for the multilingual checkpoint (tune 54, 41 and 53 of 88 against 56).
- The English checkpoint on the 24 Japanese reply cases per set: 14 and 18 right (multilingual 12 and 13). Small sample.

## ctrl+q

The Notes button's chord works only when `~/.claude/keybindings.json` binds it. This repo tracks it as
`claude-profiles/main/keybindings.json`, linked from `packages/claude/.claude/keybindings.json`:

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

`claude plugin test .` and `claude plugin validate .` from this folder; `bin/notes-keeping-bridge.test.sh` for the bridge (needs a firstmate checkout at `FM_ROOT`, default `~/Code/firstmate`).
