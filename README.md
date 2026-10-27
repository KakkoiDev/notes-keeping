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

1. A row of views and actions, keys shown on screen.
2. The current view. The panel opens on the Todos view; no other view shows the todo list.

| Key | Does |
| --- | --- |
| `t` | Todos view: the todo list (see [Todo list](#todo-list)) and the notes file path |
| `o` | Objectives view: objectives and updates |
| `i` | Important view |
| `c` | Chat view |
| `e` | Queue view: every queued reply in its own editable field |
| `h` | History view: earlier notes, newest first; Tab to one, Enter copies its objectives, updates and todo items here (same copy as `/notes-keeping history <n\|file>`); the original is never written |
| `s` | Send queue: put every queued reply into the prompt box, clear the queue, record them in `# Chat`; you press Enter |
| `b` | Back to the Todos view (shown in every view but Todos) |
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

An item can carry a short label before its whole text: `- [ ] **Todo labels in the panel**: for the todo items, would it
be possible to ...`. The pane, `/notes-keeping todo` and Claude's context name the item by its label; the text after it
is kept whole and is what the item is matched and keyed by. See [Labels](#labels).

### Who sets what

- At session launch, and after every `/notes-keeping objectives|update`: one item per numbered objective (`1.` and on,
  with the lines wrapped under it, its bullets and links left out) and one per `[UPDATE]` block (its first sentence, past
  a `Project: x` label line, quotes removed), kept whole on one line, with no Laya call. A wrapped line joins the one above
  it when that line does not end a sentence and the next starts in lower case or a digit. Any other paragraph of the
  objectives is one candidate, and a paragraph of bullets is one per bullet: Laya judges each and it becomes an item
  unless Laya is at least 0.8 sure it is background. Lines ending in `:`, headings and single-word lines are skipped.
  A line already judged is never asked twice, so an item you delete stays deleted.
- At the end of every turn: Laya reads Claude's last reply against every open item (todo or in-progress), the ones you
  set by hand included, and may move it forward (todo to in-progress, in-progress to done, either to declined). A move
  needs the reply to share a word only that item has (two-character runs for Japanese) and the reply's cue words plus
  Laya to reach 0.5 on the option the reply's cue words name, 0.9 on another, or 0.9 for a status you set by hand (see How accurate it is). Done and
  declined items are never moved by the plugin. A move is dropped if you changed that item while Laya was running.
- Every status Laya changes is appended to `~/.notes-keeping/todo-changes.log` (committed with the write): time, notes
  file, item, `from -> to`, Laya's answer and confidence, and `replaced a hand-set status` when the item was one you
  set by click or by hand. Review it there.
- Click an item in the pane to cycle todo, in-progress, done, declined and back, or edit the marker by hand. Those
  statuses are yours until Laya moves them under the rule above.
- Firstmate, when the session root holds an executable `config/notes-keeping-bridge` (a firstmate home that opted in):
  - On every todo run the plugin runs `bridge status <notes file>`, which prints
    `{"<item text>": {"status": "in-progress" | "done" | null, "task": "<id>"}}` for every item linked to a firstmate
    task. A linked item follows that status forward and Laya is never asked about it; a null status leaves it where it
    is. The move is logged with `firstmate <task>`. A status you set on a linked item stays until the bridge reports a
    different one.
  - After every todo write, every click, and every five seconds, the plugin runs `bridge notify <notes file>` with the
    changes since its last write on stdin: `+ [ ] <item>` for a new item, `<item>: <from> -> <to> (captain)` for a
    status set by click or by hand. Moves Laya or the bridge made are not sent.
  - Without the file nothing of this runs.
- Claude never edits the notes file; its Edit and Write on the notes folder are denied.

### In Claude's context

Every prompt carries the list (each item with its marker, `[~]` for in-progress, and `Work on:` the ongoing item, else
the first to-do), each item as `label: text` with the text cut to 120 characters, or the cut text alone when it has no
label. A prompt that already
carries the whole notes file, after a compaction or a resume, does not repeat it.

### In the pane

The list is the Todos view of the panel (`TodoSlot` in `hooks/todos.tsx`), read from the notes file on every draw; a click calls the same status cycle as above. It refreshes every five seconds while the pane is open and on every write.

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
  probability. The result must reach 0.5 on the cued option, 0.9 on any other, and 0.9 when the captain set the status by hand (also on a cued option).

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

The hand-set floor of 0.9 (the captain's choice) is not backed by a measurement that separates it from the others, and the 0.9 floor for a
reply with no cue is the first one that was chosen on one tune set.

Limits:

- The cue words decide, Laya breaks ties. With a cue in the reply the result is near 1.0 whatever Laya said, so the
  hand-set floor only bites on replies with no cue word. Cues are read per sentence, and a sentence that follows one
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

`claude plugin test .` and `claude plugin validate .` from this folder.
