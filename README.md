# notes-keeping

A Claude Code mod: a session notes file that survives compaction, a notes panel, and a selection band.

## Install

```sh
git clone https://github.com/KakkoiDev/notes-keeping ~/Code/notes-keeping
```

Add the clone to `CLAUDE_CODE_PLUGIN_DIRS` (colon-separated absolute paths) in the `env` of your Claude Code settings, then restart Claude Code.

License: MIT.

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

Toggle with ctrl+q (see below), `/notes-keeping show` / `hide`, or the `Notes` button under the prompt. Esc closes it. On a panel that is open while the prompt holds the keyboard (you clicked or typed there), ctrl+q and the `Notes` button hand the panel the keyboard instead of closing it; with a draft in the prompt Claude Code gives a panel no keyboard, so then they close it, and ctrl+x tab moves the keyboard to the panel. Top to bottom:

1. A row of views and actions, keys shown on screen.
2. The current view. The panel opens on the Todos view; no other view shows the todo list.

| Key | Does |
| --- | --- |
| `t` | Todos view: the todo list, each to-do with the firstmate work linked to it (see [Todo list](#todo-list)), and the notes file path; labelled `Todos (N!)` while N open calls need you |
| `n` | Paste view: paste outside text (a Slack message) and note parts of it (see [Pasted text](#pasted-text)) |
| `o` | Objectives view: objectives and updates |
| `i` | Important view |
| `c` | Chat view |
| `q` | Queue view: under a `Not picked up by firstmate` group (see [Picked up by firstmate](#picked-up-by-firstmate)), every queued reply in its own editable field. The queue holds only what you send by hand: replies and notes on pasted text. An answer to a call never enters it |
| `h` | History view: earlier notes, newest first; Up and Down pick one, Enter opens a read-only preview of what it holds, `a` attaches the picked note after a `y` / `n` confirmation (same copy as `/notes-keeping history <n\|file>`, so done and declined items stay behind); the original is never written. `b` in a preview or the confirmation steps back |
| `l` | Logs view: the `# Logs` section of the notes file, newest first, read-only: time (UTC), who, item, `from -> to` (or the text of an objective or update) |
| `s` | Send queue: put every queued reply into the prompt box, clear the queue, record them in `# Chat`; the keyboard moves to the prompt with them, so Enter sends them (ctrl+x tab returns to the panel) |
| `w` | in the Todos view, beside the line under the list: the Work view, the work no open to-do links (see [Work view](#work-view)); drawn only while there is some |
| `b` | Back to the Todos view (shown in every view but Todos); from a Work row's details, back to the Work view; from a report, back to where `v` was pressed |
| `u` | in the Objectives view: opens an input; Enter appends the text as a new `[UPDATE]` under `## Updates` (while the objectives are still empty it sets them instead) |
| `e` | in the Objectives view: opens the notes file in `$VISUAL`, else `$EDITOR`, in a tmux popup (`tmux display-popup -E`; the session must run inside tmux), then shows and commits what the editor saved and runs the todo list over it, so an `[UPDATE]` written there becomes an item as one from `u` does; an `[UPDATE]` header the editor left with no text under it makes no item, and a toast names it. Todo runs keep writing the file while the editor is open. From the update box (after `u`, once the objectives are set), where `e` is typed into the field, ctrl+e does it instead (bind `{ "context": "PaneField", "bindings": { "ctrl+e": "app:toggleDiffNoiseFilter" } }` in `~/.claude/keybindings.json`), or a click on Open in editor: it first appends `[UPDATE] <time>` under `## Updates` holding the box's text, opens the editor on the line after it (`file:line` for hx, `+line` for vi, vim, nvim, nano, emacs and kak, the top of the file otherwise), and drops that header again if the editor leaves it empty |

Every row is also clickable. A click in the panel leaves the keyboard there, even when the prompt held it before, so its keys work next; a click on a todo row's marker also selects that row for `f`, `p` and `d`. In the Queue view, Tab to a reply, edit its text, Enter keeps it; `[remove]` beside a reply drops it.

Any text the panel puts into the prompt box (`s`, and Enter in a Work view answer to a row with no open call; an answer to an open call goes to firstmate at once and leaves the keyboard in the panel) moves the keyboard to the prompt: Claude Code takes the keyboard from a panel whenever the prompt's text changes, and gives no panel the keyboard while the prompt holds a draft. ctrl+x tab moves it back to the panel (pressed again when a bar above the prompt takes it first).

Under the prompt, once a reply is queued: click `[send queue: n]` (same as `s`) or `[edit queue]` (opens the panel at the queue view).

## Selection pane

Select text in the transcript and hold still. The Selection pane opens (text selected inside the notes panel or the Selection pane itself does not open it; a reply box left behind the Notes tab gives way to a new selection):

| Key | Does |
| --- | --- |
| `r` | Reply: the box shows the whole selected text, wrapped (the pane grows to 12 rows, then scrolls); type the reply, Enter queues it with the selected text |
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

Each note goes out like a queued reply, as its own block with the part it is on. The whole pasted text goes out once ahead of the first note on it, so lines without a note reach Claude too. It is sent as is, at any length, and `# Chat` records it the same way:

```
[PASTED TEXT]
Can we ship Friday?
QA is still open.
[END PASTED TEXT]

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
- [/] paused <!-- paused:the review lane comes first -->
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

A paused item carries why it is paused on its line, before its id: `- [/] Ship the bridge <!-- paused:waiting on CI -->
<!-- id:1kmv58p -->`. The pane, the Item view and Claude's context show it as `Ship the bridge (paused: waiting on CI)`;
an item marked `[/]` by hand with no reason reads `(paused: no reason recorded)`. Any other status drops the reason.

### Who sets what

- At session launch, after every `/notes-keeping objectives|update`, and after the editor (`e`) closes: one item per numbered objective (`1.` and on,
  with the lines wrapped under it, its bullets and links left out) and one per `[UPDATE]` block (its first sentence, past
  a `Project: x` label line, quotes removed), kept whole on one line, with no Laya call. A wrapped line joins the one above
  it when that line does not end a sentence and the next starts in lower case or a digit. Any other paragraph of the
  objectives is one candidate, and a paragraph of bullets is one per bullet: Laya judges each and it becomes an item
  unless Laya is at least 0.8 sure it is background. Lines ending in `:`, headings and single-word lines are skipped.
  A line already judged is never asked twice, so an item you delete stays deleted.
- At the end of every turn: Laya reads Claude's last reply against every open item (todo or in-progress) and may move
  it forward from todo to in-progress, except an item whose status you set by click or by hand: Laya never
  moves that one. Laya never moves an item to done or declined, however sure: only you, or a linked firstmate task the
  bridge reports, close or decline an item. A move needs the
  reply to share a word only that item has (two-character runs for Japanese); a link in the reply counts only for the
  item holding that same link. Laya must answer "started" at 0.7 or more; no word in the reply raises or lowers that
  (see How accurate it is). Done and declined items are never moved by the plugin. A move is dropped if you
  changed that item while Laya was running.
- Every change is logged in the notes file's `# Logs` section with who made it (see [Action log](#action-log)). A Laya
  move carries Laya's answer and its own probability. Undo one by clicking the item's marker.
- Click an item's marker in the pane (or Enter on it) to cycle todo, in-progress, done, declined and back, step it with `f` and
  `p` (see [In the pane](#in-the-pane)), or edit the marker by hand. Blocked and paused are not in the cycle: a click,
  `f` or `p` on a blocked or paused item sets it to todo. `z` pauses the selected item: it asks why, and the reason
  is written on the item and in the log row. Those statuses are yours: Laya leaves them, and a firstmate bridge report
  or another click moves them.
- Firstmate, when the session root holds an executable `config/notes-keeping-bridge` (a firstmate home that opted in;
  the bridge is this plugin's `bin/notes-keeping-bridge`, and `FM_ROOT` / `FM_HOME` name the firstmate checkout and home
  when it is run from here rather than through a link in `config/`):
  - On every todo run, and on every five-second refresh of an interactive session, the plugin runs
    `bridge status <notes file>`. The refresh applies only these linked-item moves, with no Laya or label call and no
    new item, so a marker follows its task within one refresh instead of waiting for a turn to end; a failing refresh
    is told once. `status` prints
    `{"<item text>": {"status": "blocked" | "paused" | "in-progress" | "done" | null, "task": "<id>"}}` for every item linked to a firstmate
    task; an item linked by id (`bridge link <task> id:<id>`) is printed as `"id:<id>"` with an `"id"` field and
    matched by id, an item linked by text (older links) by its text. A linked item follows that status forward and Laya is never asked about it; a null status leaves it where it
    is. `done` comes only from a landing: firstmate saw the task's PR merge (`state/<task>.pr-poll-merge-notified`), or
    its cleanup recorded a done outcome. A task with no meta reports `in-progress` from an in-progress outcome
    (`{"task", "outcome": "in-progress", "at"}`, newer than the link), which firstmate records when it releases a
    captain hold on a task with no live worker; a task whose last
    state line is `done` (a PR opened, a branch ready to land) is still `in-progress`. The move is logged as `firstmate` with the task id. `bridge link <task> <item> --by <name>` records who made
    the link (firstmate, a crewmate); `status` then prints a `"by"` field and the log row names it. A status you set on
    a linked item stays until the bridge reports a different one.
  - A task whose `state/<task>.meta` holds `todo=id:<id>` links that item from spawn, with no `bridge link` call:
    `status` prints it with the task's status (in-progress from its meta, blocked or paused from a block or pause) and no
    `"by"` field. A link or an unlink recorded for the item wins over the meta. A `todo=` that is not `id:<id>` links
    nothing.
  - `bridge block <task> --reason <text> [--by <name>]` marks a task that could not be started. Its linked items report
    `blocked` with a `"reason"` field, move to `[!]` from todo or in-progress, and the log row reads
    `<task>[, by <name>]: <reason>`. The block holds until `state/<task>.status` gets a state line written after it, or an outcome is recorded after it; the
    item then follows the status the bridge reports (in-progress, done) out of blocked.
  - A live captain call (a captain hold in the backlog, the one the fleet shows as `!`) also reports `blocked` for every
    item linked to the call or to its origin task, with the reason `captain call: <question>`, so the item moves to
    `[!]`. Once no call on the task is open, the item follows what the bridge reports otherwise. An item you hold as
    `[/]` is not reported blocked by a call.
  - `bridge pause <task> --reason <text> [--by <name>]` marks a task set aside on purpose, appended to
    `state/notes-todo-pauses.jsonl`. Its linked items report `paused` with a `"reason"` field, move to `[/]` from todo,
    in-progress or blocked with the reason written on the item, and the log row reads `<task>[, by <name>]: <reason>`.
    Pausing it again with a fresh reason replaces the reason on the item; a reason you wrote yourself stays until the
    bridge reports a different one. The pause holds as a block does, until a state line or an outcome after it; of a
    task's latest block and latest pause, the later one is reported.
  - After every todo write, every click, and every five seconds, the plugin runs `bridge notify <notes file>` with the
    changes since its last write on stdin: `+ [ ] <item>` for a new item, `<item>: <from> -> <to> (<who>)` for every
    status change, each followed by ` [id:<id>]` when the item has an id. A new item made from an `[UPDATE]` block
    that holds more than the item's text (a pasted list, an ask after a `|||||` separator) is followed by that whole
    block, each line indented four spaces, so firstmate reads every word of it. `<who>` is `captain` for a click, `laya`
    for a Laya move, `firstmate <task>` for a bridge move, and `unknown` for a change found in the file that the plugin
    did not make (a hand edit, another program). The bridge files them as one inbox note whose first line, the part
    firstmate's notification shows, is the first change (`<item>` or `<item>: <from> -> <to> (<who>)`), with
    `(+N more)` when there are several; the indented block lines are not counted.
  - Every five seconds an interactive session with a notes file runs `bridge pending <notes file>`, which hands out
    the updates firstmate queued for that file with `bridge update <notes file> <text> --by <name> --task <task-id>`.
    The plugin adds each one as an `[UPDATE]` under `## Updates`, logged as `firstmate` with `<task-id>, by <name>`,
    with the id of the item the todo run makes from it already on its line, and answers that id through
    `bridge answer <request>`; `update` prints it. An update whose text an item already has answers that item's id and
    makes no second one; an update the todo run would make no item from (a `Name: value` label alone, a text it has
    seen before) is answered with why and not written. `bridge active` prints the notes file the latest session asked
    for, within the last 15 seconds, so firstmate needs no notes file of its own.
  - `bridge open <notes file>`, read-only, prints `[{"id", "status", "text"}]` for every item under `# Todo` that is not
    done or declined, in file order, a paused one with its `"reason"`, so firstmate can `link` the captain's existing
    item instead of queuing a duplicate.
  - Every five seconds an interactive session runs `bridge fleet <notes file>` for the work under the to-dos and the
    [Work view](#work-view). `bridge waiting <task> <text>` sets what a task's row waits on, held until the task writes
    its next state line; `bridge crew <task>` prints `fm-crew-state.sh` for one task (the panel no longer calls it).
  - `bridge call-answer <task> [--release]` takes the captain's answer to a call on stdin and records it through
    firstmate's one keyed-answer intake (`fm-captain-hold.sh answers --any-origin --source notes-keeping`), then files one
    inbox note so firstmate routes the answer to the worker. A question closes; held work needs `--release` to resume. The
    answer is one line of at most 512 characters, the length the record keeps: a longer one is refused, not cut. It
    exits 1 with the reason when the intake skipped the call (already closed, unknown) or the note could not be filed,
    and drops the 30 s `fleet` cache so the next read sees the call closed. The plugin calls it; a replay is idempotent.
  - `notify` and `call-answer` print `request_id=<request>`, the request id of the inbox note they filed.
    `bridge picked <request>...`, read-only, prints `{"<request>": "<UTC time>" | null}`: the time firstmate
    acknowledged that note (`fm-inbox.sh drain --ack` moves it to `state/inbox/handled/`; the time is the note's ctime
    there, found through the request's reservation in `state/inbox/.requests/`), null while it is not acknowledged.

### Work view

Every five seconds an interactive session reads `bridge fleet` (see `bin/notes-keeping-bridge --help` for its rows and
fields). The work is drawn under the to-dos it is linked to (see [In the pane](#in-the-pane)); the Work view, `w` under
the Todos list, holds only the work no open to-do links:

```
Work without a to-do                                           read 08:01 UTC · b: back
! Harness decisions             call         2h  you: D1 learned facts
1 worker gone without finishing · 3 calls closed without you today   [6] show gone  [x] show closed
```

- one row per captain call and per live worker that no open item links: the linked todo item's label, else the backlog
  title, else the task id; the state; the age of that state line; what it waits on (`you: <hold reason>`,
  `firstmate: <text>` for a decision, block or failure, `gone: <text>`, `worker: <text>`). Under it, when it names a
  report: `report <age>  <title>: <outcome>`, and on a `!` or `?` row `needs  <ask>`;
- `Every live worker and open call is on a to-do.` when there is none;
- the count of gone workers (window gone, no open item links them) and of the captain calls closed today by a resolution
  not in your words (moot, repaired, reconciled); `6` lists the gone ones, `x` the closed calls with their evidence line;
- live holds tied to nothing in this notes file are only counted: `+N other calls · /bearings`.

A report summary comes from the report's head only: its `# ` title, then an `Outcome:` (or `Status:`, `Verdict:`)
line and a `Needs:` line among its first 15 lines. Nothing else is read as either; a report without them shows its
title alone.

Flags, from structured records only, never from a worker's words: `!` a live captain hold (a new one raises one native
notification, `Firstmate`, and the status line under the prompt reads `calls: N need you · ctrl+q`, after the
queued-replies line when there is one); `?` firstmate's move, a last state line of `needs-decision`, `blocked` or
`failed`, or a linked worker gone without `done`.

| Key | Does |
| --- | --- |
| Up, Down, Enter | select a row; Enter opens its details: the report summary, the last line and its age, PR, report path, linked todo item (`d` opens it); there `y` copies the PR link, else the report path, `e` opens the report in the editor, `u` the PR, `g` goes to the worker's window |
| `a` | on a `!` or `?` row: an input. On an open call Enter sends the answer to firstmate at once, as the Item view does; on any other row Enter fills the prompt with `<task> <key>: <text>`, and you press Enter to send it to firstmate |
| `v` | read the report (see the report reader under [In the pane](#in-the-pane)) |
| `6` | show or hide the gone workers |
| `x` | show or hide the calls closed today without you |
  - Without the file nothing of this runs.
- Claude never edits the notes file; its Edit and Write on the notes folder are denied.

### In Claude's context

Every prompt carries every item that is not done or declined, in file order with no cap, and one line counting the done
and declined items it leaves out, which points to the notes file's `# Todo` section (each item with its marker, `[~]` for in-progress, and an instruction to start every
open item now, in parallel, not waiting on one answer before starting another independent one; that keeping the
statuses current is Claude's job, never the captain's, through the one path Claude has: link the item to its firstmate
task and record the task's outcome when it finishes (`fm-todo-guard.sh record-outcome`, or `record-close`), which the
bridge reports as done; when an item is `[!]` blocked, an instruction to open the reply by telling the captain which
items are blocked, why, and what Claude is doing to unblock each, the marker being Claude's to clear), each item as `label: text` with the text cut to 120 characters, or the cut text alone when it has no
label, a paused item followed by `(paused: <reason>)`. An item made from an `[UPDATE]` block that holds more than the
item's text is shown as that block instead, whole and uncut, its first line on the item's line and the rest indented
under it. A prompt that already
carries the whole notes file, after a compaction or a resume, does not repeat it.

When an item is `[/]` paused, every prompt also carries a paused block: each paused item with its reason, and an
instruction to re-evaluate every one now and open the reply with the verdict for each, resume it or keep it paused
with a fresh reason (`notes-keeping-bridge pause <task-id> --reason <text>` for firstmate). The prompt that carries
the whole notes file, after a compaction or a resume, carries this block too, after the file. A compaction is seen through
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

Columns: UTC time, actor id, action (`status`, `added`, `objective`, `update`, `attach`, `recorded`, `picked-up`), item id and label (`-` for
none), `from -> to` (`none -> <status>` for an added item, `-` for none), and a note (Laya's answer and probability,
the firstmate task, the copied file). An attach from History logs one `attach` row (the source notes file), one `added` row per copied todo item naming its id, and one `objective` row per copied objective no item stands for; items left behind as done or declined are not logged. An answer to a call, once firstmate records it, logs one `recorded` row (see [Picked up by firstmate](#picked-up-by-firstmate)); files from before it hold an `answer` row instead. The actors are listed once in `hooks/actors.ts`:

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

With a bridge, each to-do carries the firstmate work linked to it, by the task or by a call's origin task, under its
text (dim unless selected; a call line never dim). A to-do with no link gets no line.

```
[~] PROJ-790 scope needs clarifying
      worker finished 6h ago · PROJ-790: the smallest scope the client can accept
    ! your call: send the cut-scope proposal to the client?       open · 6h · a: answer
[~] Fix now task
      worker finished 34m ago · checks green · PR webapp#28276
      worker finished, to-do still in progress                          f: mark done
[~] Review XiaoXiao's report
      worker working 6m · posting the reply
      you answered · reached the worker 7m ago · it read it
```

- a worker line per linked worker: `worker <state> <age>` and the report's `Outcome:`, else its title, else the worker's
  last state line, then ` · PR <repo>#<n>` when it has one;
- a call line per open call: its `Question:` line (else its title), `open · <age> · a: answer` at the right edge; the
  line is a button that opens the call's card with the answer field;
- once answered, in its place: `you answered`, then `· reached the worker <age> ago` once firstmate's `Routed to:` line
  names an inbox message, and `· it read it` once that message is in `handled/`. Nothing is inferred: a missing record
  ends the line;
- when every linked worker finished and the to-do is still open: `worker finished, to-do still <status>` and
  `f: mark done`. The plugin changes no status itself.

Under the list, while there is work no open to-do links or a call closed today without you:
`Not on a to-do: <n calls>, <n workers> · <n> calls closed without you today` and `w` to show it.

The Item view (`d`, Enter on the text) adds, under the item's source, a card per linked call: `! Your call · open · asked
<age> ago`, the question, and its `Options:` lines on `1` to `9`, each sending `<n> <option>` as the answer; `a` opens a
field that sends what you type. The open field is drawn at the top of the panel, above the view tabs, so a badge, card
or worker row that comes or goes while you type does not move the keyboard off it; each call has its own field, empty
until you type in it. The answer never enters the queue and is not put in the prompt: it goes to firstmate at
once through `bridge call-answer` (with `--release` for held work, so it resumes), and a `# Logs` row (`captain`,
`recorded`, `<request> answer <task>: <answer>`) records it. The card shows the call answered, and the field closes, as
soon as you pick or press Enter, before the bridge has written it; with two open calls the keys go on to the second at
once. The fleet is then read again. An answer over 512 characters (the record's limit) is not sent: a toast says so and
the field stays open. If the bridge refuses an answer (the call is already closed), a toast gives the reason, nothing is
recorded, the call shows open again, and a typed answer is back in its open field. An answered call shows your words and its
trail, time first (UTC). Then a block per linked worker (state and age, report title, `Outcome:` line) and the item's last three
status changes from `# Logs`. Its keys, each drawn only when it acts: `v` report, `e` report in the editor, `u` PR, `g`
the worker's window, `f` and `p` status, `j` and `k` the next and previous shown to-do.

`v` opens the report reader: the report's title with its age and `b: back` at the right edge, its kind and the to-do it
is on, and while a call on that to-do is open, `! Needs you: <Needs:>` with `a: answer`; then the whole file as markdown
(cut at 60,000 characters). `y` copies its path, `e` opens it in the editor, `u` the PR, `b` goes back to where `v` was
pressed.

| Key | Does |
| --- | --- |
| `j`, `k` | select the next or previous shown item; stays put at either end |
| Up, Down | move the ring through every marker and text in turn (a marker or text under the ring selects its item) |
| Enter | with the ring on its marker, cycle its status: todo, in-progress, done, declined, todo; blocked and paused go to todo. With the ring on its text, open it as `d` does |
| `d` | open it in the Item view, as a click on its text does |
| `f` | step it forward one status; at declined it stays declined |
| `p` | step it back one status; at todo it stays todo |
| Left, Right | step it back or forward one status, as `p` and `f` do. Only after a click on the dim `left, right: previous, next status` strip at the end of the key row, which gives that strip the keyboard (Up and Down need no click); Esc returns the keyboard to the pane. Not drawn on mobile or vscode |
| `z` | pause it: a field asks why; Enter writes `[/]` with the reason, logged as the captain. Enter on an empty field pauses nothing |
| `a` | with an open call on it: its card in the Item view, the answer field open |
| `v` | with a linked report: the report reader |
| `1` `2` `3` `4` `5` `6` | show or hide the `[ ]` todo, `[~]` in-progress, `[x]` done, `[-]` declined, `[!]` blocked, `[/]` paused items |
| `m` | filter: cycles all, `[ ]` todo, `[~]` in-progress, `[x]` done, `[-]` declined, `[!]` blocked, `[/]` paused, all. One status shows alone; the legend reads `filter: <status>` (`custom` when `1`-`6` left a mix, and `m` then starts at todo). Shares the hidden statuses with `1`-`6`; the selection moves to a shown item |

The row of toggles above the list is also the marker legend: `1: [ ] todo: shown  2: [~] in-progress: shown ...`,
the same marks and names, in the same order, as the legend Claude reads with the list (both come from `MARKS` in
`hooks/todo.ts`).
A hidden status is drawn dim and its items are skipped by `j`, `k`, Up and Down; when every status is hidden the list reads
`(n items, every status hidden)`. A status change or a toggle that hides the selected item moves the selection to the
next shown item, or to the one before when it was the last. A step that leaves the status as it was (`f` at declined,
`p` at todo) writes nothing and notifies nothing. The shown statuses are kept for the session: closing and opening
the panel keeps them, a new Claude session starts with all shown.

### Picked up by firstmate

Some items reach firstmate on their own, without you sending them: an answer to a call, and a todo note that adds an
item (an update or objective that makes one, an item written in the list by hand). Neither enters the queue. Each is
recorded in `# Logs` once the bridge filed its inbox note, and a second row lands once firstmate acknowledged that note
(`fm-inbox.sh drain --ack`), read with `bridge picked` on every five-second refresh:

```
- 2026-11-09T00:12:14Z | captain | recorded | - | - | nk-fec66289fe53ff06 answer cleanroom-sec-slack-scope: yes
- 2026-11-09T00:15:12Z | firstmate | picked-up | - | - | nk-fec66289fe53ff06 picked up by firstmate 00:15
```

The time in `picked up by firstmate HH:MM` is when firstmate acknowledged the note (UTC); the row's own time is when the
plugin saw it. Status changes alone (a click, a Laya or firstmate move) are still sent to firstmate but not recorded.

An item recorded 5 minutes ago or more with no `picked-up` row is not picked up: firstmate may have crashed. The panel
header shows `N unread by firstmate` beside `Queue (n)` (a click opens the Queue view), and the Queue view opens on a
`Not picked up by firstmate (N)` group, one line per item: what it holds, then `recorded <age> ago`. An item leaves both
once its `picked-up` row lands.

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

#### laya-bench (2026-11-06): cue words removed, Laya does not close or decline

`eval/bench.py` scores Laya alone on a tune set (`fixtures.json` tune, `extra_tune.json`, `held2.json`, `real.json`
tune: 156 replies) and a held-out set (`fixtures.json` held-out, `held3.json`, `blind.json`, `real.json` held-out: 157).
`real.json` models the real wrong closes (17eirvr, 02jfb2n and others) as neutral rewrites: same labels and cue patterns,
no real names, vendors, tickets or numbers; its replies are reconstructed, because reply text was never logged. Run
`~/.laya-venv/bin/python eval/bench.py <variant> <tune|heldout> [out.json]`; `eval/variants.py` holds the 26 prompt and
input variants tried (options described, yes/no questions, the whole `[UPDATE]` block as the task, only the reply
sentences about the item, a stricter question, the typed-decisions and multilingual checkpoints).

- Close and decline: the best variant on tune (typed-decisions checkpoint, stricter question, options described, whole
  update, reply cut to the item's sentences) got 34 of 71 held-out cases right, with 5 wrong moves (35 of 70 and 3 before `real.json` was rewritten neutral), at the thresholds
  that made no wrong move on tune. 100% was not reached, so Laya still never moves an item to done or declined.
- Start: the shipped prompt, Laya's own "started" at 0.7 or more, made 16 right and 0 wrong moves on tune (16 of 37
  starts) and 8 right, 0 wrong on held-out (8 of 38). The cue words that used to add 8 nats to an option are gone: 19 of
  22 real closes came from a cue lifting Laya's own score under 0.5 to 1.00.

#### Before laya-bench: the cue rules (removed)

The tables below measured moves with the cue words on: a start, finish or refusal word in the reply's sentences about
the item added 8 nats to that option, then a 0.5 floor on it and 0.9 on any other.

Real moves that landed right, landed wrong, or did not land (right / wrong / missed):

| set (real moves) | before (multilingual, 0.6 floor, word check) | PR 18 first version (English, cues on the whole reply) | last cue rules |
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

Limits:

- Laya alone moves few items: most starts are missed. Click them.
- A decoy that shares two or three domain words with an item still passes the word check; Laya then decides alone.
- Objective lines (task or background), multilingual checkpoint, 0.8 floor: 0 of 18 tasks and 5 of 20 background lines
  dropped on tune, 0 of 18 and 2 of 20 on held-out. A task-verb rule dropped 19 of 20 background lines but also 6 of
  12 tasks on the third set, so it was not adopted. Background lines that become items: delete them by hand; they stay
  deleted. The typed-decisions checkpoint, per-option yes/no questions and described options did not beat the plain prompt on statuses
  for the multilingual checkpoint (tune 54, 41 and 53 of 88 against 56).
- The English checkpoint on the 24 Japanese reply cases per set: 14 and 18 right (multilingual 12 and 13). Small sample.

## ctrl+q

The Notes button's chord works only when `~/.claude/keybindings.json` binds it:

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
