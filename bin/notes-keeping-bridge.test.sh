#!/usr/bin/env bash
# Tests for notes-keeping-bridge. Each case runs against a fresh temporary FM_HOME. Notes go through the bin/fm-inbox.sh
# of the firstmate checkout at FM_ROOT (default ~/Code/firstmate).
set -uo pipefail

BRIDGE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/notes-keeping-bridge"
TMP_ROOT="${TMPDIR:-/tmp}"
export FM_ROOT="${FM_ROOT:-$HOME/Code/firstmate}"
[ -x "$FM_ROOT/bin/fm-inbox.sh" ] || { echo "no firstmate checkout at FM_ROOT=$FM_ROOT" >&2; exit 1; }
pass=0
fail=0

home() {
  H="$(mktemp -d "$TMP_ROOT/nk-bridge.XXXXXX")"
  mkdir -p "$H/state"
}

b() { FM_HOME="$H" "$BRIDGE" "$@"; }
st() { b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])'; }

check() {  # <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
  fi
}

home
check 'no links prints an empty object' '{}' "$(b status /n.md)"

home
b link pr-review 'Review this PR: https://x/pull/1'
check 'a linked task with no state files reports null' '{"Review this PR: https://x/pull/1": {"status": null, "task": "pr-review"}}' "$(b status /n.md)"
: > "$H/state/pr-review.meta"
echo "working [at=1]: started" > "$H/state/pr-review.status"
check 'a task with a meta is in-progress' '{"Review this PR: https://x/pull/1": {"status": "in-progress", "task": "pr-review"}}' "$(b status /n.md)"
printf 'done [at=2]: PR https://x/pull/2\nresolved [at=3]: cleared\n' >> "$H/state/pr-review.status"
check 'a done line with a PR opened is in-progress: nothing landed' '{"Review this PR: https://x/pull/1": {"status": "in-progress", "task": "pr-review"}}' "$(b status /n.md)"
printf 'done [at=4]: ready in branch fm/pr-review\n' >> "$H/state/pr-review.status"
check 'a done line with a branch ready to land is in-progress' 'in-progress' "$(st)"
: > "$H/state/pr-review.pr-poll-merge-notified"
check 'a merged PR reports done while the meta is still there' 'done' "$(st)"
rm "$H/state/pr-review.pr-poll-merge-notified"
rm "$H/state/pr-review.meta"
check 'a done line with no meta and no outcome reports null' 'None' "$(st)"
echo "failed [at=5]: broke" >> "$H/state/pr-review.status"
check 'a failed task with no meta reports null' '{"Review this PR: https://x/pull/1": {"status": null, "task": "pr-review"}}' "$(b status /n.md)"
: > "$H/state/pr-review.status"
: > "$H/state/pr-review.meta"
b block pr-review --reason 'no slot'
check 'an old-style line without a stamp counts' 'in-progress' "$(printf 'done: PR x\n' > "$H/state/pr-review.status"; st)"

home
b link scout-x id:ab12cd3 --by firstmate
printf 'window=w\nkind=scout\nmodel=opus\n' > "$H/state/scout-x.meta"
printf 'working [at=1]: started\ndone [at=2]: report at /r.md\n' > "$H/state/scout-x.status"
check 'a scout whose last state line is done stays in-progress: its report does not finish the todo' 'in-progress' "$(st)"
printf 'window=w\nkind=ship\n' > "$H/state/scout-x.meta"
check 'a ship task whose last state line is done stays in-progress until its done outcome' 'in-progress' "$(st)"

home
b link first 'Ship  the BRIDGE'
b link second 'ship the bridge'
: > "$H/state/second.meta"
check 'the latest link for an item wins, matched case and space blind' '{"ship the bridge": {"status": "in-progress", "task": "second"}}' "$(b status /n.md)"
b unlink 'SHIP the bridge'
check 'unlink drops the item' '{}' "$(b status /n.md)"
b unlink 'ship the bridge' 2>/dev/null
check 'unlink of an unlinked item fails' '1' "$?"

home
b link pr-review id:ab12cd3 --by firstmate
printf '{"task": "pr-review", "outcome": "done", "at": %d, "report": "/r.md"}\n' "$(( $(date +%s) + 1 ))" >> "$H/state/notes-todo-links.jsonl"
check 'a done outcome recorded at cleanup reports done once the status and meta are gone' '{"id:ab12cd3": {"status": "done", "task": "pr-review", "id": "ab12cd3", "by": "firstmate"}}' "$(b status /n.md)"
printf '{"task": "pr-review", "outcome": "failed", "at": %d}\n' "$(( $(date +%s) + 2 ))" >> "$H/state/notes-todo-links.jsonl"
check 'a later failed outcome reports null' 'None' "$(b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])')"

home
printf '{"task": "pr-review", "outcome": "done", "at": 1}\n' >> "$H/state/notes-todo-links.jsonl"
b link pr-review 'Review again'
check 'an outcome older than the link is an earlier run of the task id and reports null' '{"Review again": {"status": null, "task": "pr-review"}}' "$(b status /n.md)"
: > "$H/state/pr-review.meta"
check 'a meta still reports in-progress over an outcome' 'in-progress' "$(printf '{"task": "pr-review", "outcome": "done", "at": %d}\n' "$(( $(date +%s) + 1 ))" >> "$H/state/notes-todo-links.jsonl"; b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])')"

home
b link pr-review id:ab12cd3
check 'a link by id prints under id:<id> with the id' '{"id:ab12cd3": {"status": null, "task": "pr-review", "id": "ab12cd3"}}' "$(b status /n.md)"
: > "$H/state/pr-review.meta"
b link other 'Ship the bridge'
check 'links by id and by text are listed side by side' '{"id:ab12cd3": {"status": "in-progress", "task": "pr-review", "id": "ab12cd3"}, "Ship the bridge": {"status": null, "task": "other"}}' "$(b status /n.md)"
b unlink id:ab12cd3
check 'unlink by id drops only that link' '{"Ship the bridge": {"status": null, "task": "other"}}' "$(b status /n.md)"

home
b link pr-review id:ab12cd3 --by firstmate
check 'a link made with --by names who made it' '{"id:ab12cd3": {"status": null, "task": "pr-review", "id": "ab12cd3", "by": "firstmate"}}' "$(b status /n.md)"
b link other --by crew-7 'Ship the bridge'
check '--by before the item text is not part of the text' '{"id:ab12cd3": {"status": null, "task": "pr-review", "id": "ab12cd3", "by": "firstmate"}, "Ship the bridge": {"status": null, "task": "other", "by": "crew-7"}}' "$(b status /n.md)"
b link third 'Write docs' --by 2>/dev/null
check '--by without a name is refused' '2' "$?"

home
b link ../etc 'x' 2>/dev/null
check 'a task id with a path is refused' '2' "$?"
b bogus 2>/dev/null
check 'an unknown verb prints usage and exits 2' '2' "$?"
check 'a refused link writes nothing' 'absent' "$([ -e "$H/state/notes-todo-links.jsonl" ] && echo present || echo absent)"

home
printf '' | b notify /n.md
check 'empty change lines send no note' '0' "$(find "$H/state" -name '*.note' | wc -l | tr -d ' ')"
printf '+ [ ] Ship the bridge\nReview: todo -> in-progress (captain)\n' | b notify /notes/a.md
check 'change lines become one inbox note' '1' "$(find "$H/state/inbox" -name '*.note' | wc -l | tr -d ' ')"
note="$(cat "$H"/state/inbox/*.note)"
check 'the note names the file and carries each line' 'yes' "$(case "$note" in *'notes-keeping todo changed in /notes/a.md:'*'+ [ ] Ship the bridge'*'Review: todo -> in-progress (captain)'*) echo yes ;; *) echo no ;; esac)"
check 'one check wake is queued' '1' "$(grep -c "$(printf 'check\tinbox:')" "$H/state/.wake-queue")"
first() { awk 'found { print; exit } /^--$/ { found=1 }' "$H"/state/inbox/*.note; }
check 'several changes: the first line is the first change and the count of the rest' 'Ship the bridge (+1 more)' "$(first)"

home
printf '+ [ ] Ship the bridge\n' | b notify /Users/someone/.notes-keeping/2026-10-28-0500-dotfiles-de797323-c09d-40e7-99c3-7115776dfd51.md
check 'one add: the first line is the added item text' 'Ship the bridge' "$(first)"
check 'the wake names the added item behind a full-length notes path' '1' "$(grep -c 'Ship the bridge' "$H/state/.wake-queue")"

home
printf 'Review: todo -> done (captain)\n' | b notify /notes/a.md
check 'one status change: the first line is item, old and new status and who made it' 'Review: todo -> done (captain)' "$(first)"
note="$(cat "$H"/state/inbox/*.note)"
check 'the body still names the file and carries the change line' 'yes' "$(case "$note" in *'notes-keeping todo changed in /notes/a.md:'*'Review: todo -> done (captain)'*) echo yes ;; *) echo no ;; esac)"

home
printf 'Review: todo -> done (captain) [id:ab12cd3]\n' | b notify /notes/a.md
check 'one change with an id: the first line drops the id tag' 'Review: todo -> done (captain)' "$(first)"
check 'the body keeps the id tag' '1' "$(grep -c 'Review: todo -> done (captain) \[id:ab12cd3\]' "$H"/state/inbox/*.note)"

home
printf 'Review: todo -> declined (laya) [id:ab12cd3]\n' | b notify /notes/a.md
check 'a change Laya made says so on the first line' 'Review: todo -> declined (laya)' "$(first)"

home
printf '+ [ ] Ship the bridge [id:ab12cd3]\n' | b notify /notes/a.md
check 'one add with an id: the first line is the item text' 'Ship the bridge' "$(first)"

home
printf '+ [ ] A\n+ [x] B\nC: todo -> declined (captain)\n' | b notify /notes/a.md
check 'three changes count two more' 'A (+2 more)' "$(first)"
home
printf '+ [ ] Pasted filter row [id:ab12cd3]\n    Pasted filter row\n    - [ ] Review the plan\n    [~] Link todos ||||| the ask after the paste\nC: todo -> declined (captain)\n' | b notify /notes/a.md
check 'the indented lines of an update block are not counted as changes' 'Pasted filter row (+1 more)' "$(first)"
check 'the note carries the update block whole' '1' "$(grep -c '    \[~\] Link todos ||||| the ask after the paste' "$H"/state/inbox/*.note)"
home
b active >/dev/null 2>&1
check 'active with no session draining fails' '1' "$?"
check 'pending with nothing queued prints an empty list' '[]' "$(b pending /notes/a.md)"
check 'active names the notes file a session asked for pending updates' '/notes/a.md' "$(b active)"
printf '{"file": "/notes/a.md", "at": %d}\n' "$(( $(date +%s) - 60 ))" > "$H/state/notes-keeping-active.json"
b active >/dev/null 2>&1
check 'active fails once that session has not asked for a while' '1' "$?"

# play the plugin: hand out pending updates for <file> until one appears, then answer it with <json>
serve() {  # <file> <json>
  local got=''
  for _ in $(seq 50); do
    got="$(b pending "$1")"
    [ "$got" != '[]' ] && break
    sleep 0.1
  done
  printf '%s' "$got" > "$H/served"
  b answer "$(python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["request"])' < "$H/served")" <<< "$2"
}

home
b pending /notes/b.md >/dev/null
serve /notes/a.md '{"id": "ab12cd3"}' &
out="$(NOTES_KEEPING_BRIDGE_WAIT=5 b update /notes/a.md 'Ship the spawn todo' --by firstmate --task spawn-x)"
code=$?
wait
check 'update prints the id the plugin answered' 'ab12cd3' "$out"
check 'update exits 0 once answered' '0' "$code"
check 'pending hands out text, by and task' 'Ship the spawn todo|firstmate|spawn-x' "$(python3 -c 'import json,sys; r=json.load(sys.stdin)[0]; print("|".join([r["text"], r["by"], r["task"]]))' < "$H/served")"
check 'an answered update leaves nothing queued' '[]' "$(b pending /notes/a.md)"
check 'an answered update leaves no queue files' '' "$(cat "$H/state/notes-keeping-queue/"* 2>/dev/null)"

home
serve /notes/a.md '{"error": "the update makes no todo item"}' &
err="$(NOTES_KEEPING_BRIDGE_WAIT=5 b update /notes/a.md 'Project: x' --by firstmate --task spawn-x 2>&1 >/dev/null)"
code=$?
wait
check 'an answered error exits 1' '1' "$code"
check 'and says why' 'notes-keeping-bridge: the update makes no todo item' "$err"

home
( sleep 0.5; b pending /notes/b.md > "$H/other" ) &
NOTES_KEEPING_BRIDGE_WAIT=1 b update /notes/a.md 'Nobody drains this' --by firstmate --task spawn-x 2>/dev/null
check 'update no session takes in time exits 1' '1' "$?"
check 'and is withdrawn' '[]' "$(b pending /notes/a.md)"
wait
check 'pending for another notes file does not take it' '[]' "$(cat "$H/other")"

home
mkdir -p "$H/state/notes-keeping-queue"
printf '{"file": "/notes/a.md", "text": "Caller was killed", "by": "firstmate", "task": "spawn-x", "at": 1, "until": 2}\n' > "$H/state/notes-keeping-queue/00000000000000aa.json"
check 'pending drops an update whose caller stopped waiting, without handing it out' '[]' "$(b pending /notes/a.md)"
check 'and removes it from the queue' '' "$(ls "$H/state/notes-keeping-queue")"

home
( sleep 0.3; b pending /notes/a.md > /dev/null ) &
NOTES_KEEPING_BRIDGE_WAIT=1 b update /notes/a.md 'Taken, never answered' --by firstmate --task spawn-x 2>/dev/null
check 'an update taken but never answered gives up after a second wait and exits 1' '1' "$?"
wait

home
b update /notes/a.md 'No by' --task spawn-x 2>/dev/null
check 'update without --by is refused' '2' "$?"
b update /notes/a.md 'No task' --by firstmate 2>/dev/null
check 'update without --task is refused' '2' "$?"
b update /notes/a.md 'Bad task' --by firstmate --task ../x 2>/dev/null
check 'update with a task id holding a path is refused' '2' "$?"
b update /notes/a.md --by firstmate --task spawn-x 2>/dev/null
check 'update without text is refused' '2' "$?"
b answer nope <<< '{"id": "x"}' 2>/dev/null
check 'answer for a request nobody took fails' '1' "$?"

home
b link spawn-x id:ab12cd3 --by firstmate
b block spawn-x --reason 'no free worktree slot' --by firstmate
check 'a blocked task reports blocked with its reason' '{"id:ab12cd3": {"status": "blocked", "task": "spawn-x", "id": "ab12cd3", "by": "firstmate", "reason": "no free worktree slot"}}' "$(b status /n.md)"
: > "$H/state/spawn-x.meta"
check 'a meta written after the block does not clear it' 'blocked' "$(b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])')"
echo "working [at=5]: setup done" > "$H/state/spawn-x.status"
check 'a state line after the block clears it' '{"id:ab12cd3": {"status": "in-progress", "task": "spawn-x", "id": "ab12cd3", "by": "firstmate"}}' "$(b status /n.md)"
b block spawn-x --reason 'stalled again' --by firstmate
check 'a block after a state line holds until the next one' 'blocked stalled again' "$(b status /n.md | python3 -c 'import json,sys; v=next(iter(json.load(sys.stdin).values())); print(v["status"], v["reason"])')"
echo "done [at=6]: PR https://x/pull/3" >> "$H/state/spawn-x.status"
check 'a done line after the block clears it' 'in-progress' "$(st)"

home
b link spawn-x id:ab12cd3 --by firstmate
b pause spawn-x --reason 'the review lane comes first' --by firstmate
check 'a paused task reports paused with its reason' '{"id:ab12cd3": {"status": "paused", "task": "spawn-x", "id": "ab12cd3", "by": "firstmate", "reason": "the review lane comes first"}}' "$(b status /n.md)"
check 'the pause is appended to notes-todo-pauses.jsonl with the reason and who paused it' 'spawn-x|the review lane comes first|firstmate|0' "$(python3 -c 'import json,sys; r=json.loads(open(sys.argv[1]).read().splitlines()[-1]); print(r["task"], r["reason"], r["by"], r["lines"], sep="|")' "$H/state/notes-todo-pauses.jsonl")"
b pause spawn-x --reason '  waiting   on CI  '
check 'a fresh pause replaces the reason, its whitespace folded' 'paused waiting on CI' "$(b status /n.md | python3 -c 'import json,sys; v=next(iter(json.load(sys.stdin).values())); print(v["status"], v["reason"])')"
echo "working [at=5]: resumed" > "$H/state/spawn-x.status"
: > "$H/state/spawn-x.meta"
check 'a state line after the pause clears it' 'in-progress' "$(st)"
b pause spawn-x --reason 'held for the captain'
check 'a pause after a state line holds until the next one' 'paused held for the captain' "$(b status /n.md | python3 -c 'import json,sys; v=next(iter(json.load(sys.stdin).values())); print(v["status"], v["reason"])')"
sleep 1
b block spawn-x --reason 'no slot'
check 'a block after the pause wins: the latest of the two holds' 'blocked no slot' "$(b status /n.md | python3 -c 'import json,sys; v=next(iter(json.load(sys.stdin).values())); print(v["status"], v["reason"])')"
sleep 1
b pause spawn-x --reason 'parked again'
check 'a pause after the block wins' 'paused parked again' "$(b status /n.md | python3 -c 'import json,sys; v=next(iter(json.load(sys.stdin).values())); print(v["status"], v["reason"])')"

home
b pause spawn-x 2>/dev/null
check 'pause without --reason is refused' '2' "$?"
b pause spawn-x --reason '  ' 2>/dev/null
check 'pause with an empty reason is refused' '2' "$?"
b pause ../x --reason 'bad' 2>/dev/null
check 'pause with a task id holding a path is refused' '2' "$?"
check 'a refused pause writes nothing' 'absent' "$([ -e "$H/state/notes-todo-pauses.jsonl" ] && echo present || echo absent)"

# The four steps of firstmate data/todo-bridge-stale/repro-1793776341: blocked, resumed, done line, cleanup.
home
b link egm id:0v0nnnz --by firstmate
printf 'id=x\n' > "$H/state/egm.meta"
echo 'working [at=1]: start' > "$H/state/egm.status"
b block egm --reason 'egm missing' --by firstmate
check 'step 1: blocked' 'blocked' "$(st)"
echo 'working [at=2]: resumed' >> "$H/state/egm.status"
check 'step 2: resumed is in-progress' 'in-progress' "$(st)"
echo 'done [at=3]: finished' >> "$H/state/egm.status"
check 'step 3: a done line is in-progress until it lands' 'in-progress' "$(st)"
rm "$H/state/egm.meta" "$H/state/egm.status"
printf '{"task": "egm", "outcome": "done", "at": %d}\n' "$(( $(date +%s) + 1 ))" >> "$H/state/notes-todo-links.jsonl"
check 'step 4: a block superseded before cleanup does not return once the status is gone; the done outcome reports done' 'done' "$(st)"

home
b block spawn-x --by firstmate 2>/dev/null
check 'block without --reason is refused' '2' "$?"
b block spawn-x --reason '  ' 2>/dev/null
check 'block with an empty reason is refused' '2' "$?"
b block ../x --reason 'bad' 2>/dev/null
check 'block with a task id holding a path is refused' '2' "$?"
check 'a refused block writes nothing' 'absent' "$([ -e "$H/state/notes-todo-blocks.jsonl" ] && echo present || echo absent)"

# fleet: a fake firstmate checkout whose fm-tasks-axi.sh prints $H/tasks.txt and counts its runs, and a fake tmux on PATH
# that lists $H/windows.txt.
fleet_home() {
  home
  mkdir -p "$H/root/bin" "$H/path"
  printf '#!/usr/bin/env bash\necho x >> "%s/tasks.runs"\ncat "%s/tasks.txt" 2>/dev/null\n' "$H" "$H" > "$H/root/bin/fm-tasks-axi.sh"
  printf '#!/usr/bin/env bash\necho "$@" > "%s/crew.args"\necho "FM_HOME=$FM_HOME"\necho "state: done · source: run-step · checks green"\n' "$H" > "$H/root/bin/fm-crew-state.sh"
  printf '#!/usr/bin/env bash\ncat "%s/windows.txt" 2>/dev/null\n' "$H" > "$H/path/tmux"
  chmod +x "$H/root/bin/fm-tasks-axi.sh" "$H/root/bin/fm-crew-state.sh" "$H/path/tmux"
  : > "$H/windows.txt"
  printf 'count: 0\ntasks[0]{id,state,kind,repo,title,created,hold_kind,hold_until,hold_reason,blocked_by,body}:\n' > "$H/tasks.txt"
  printf '# Objectives\n\n# Todo\n\n- [ ] Ship it <!-- id:ab12cd3 -->\n' > "$H/notes.md"
}
f() { NOTES_KEEPING_FLEET_CACHE="$H/cache" FM_ROOT="$H/root" PATH="$H/path:$PATH" FM_HOME="$H" "$BRIDGE" "$@"; }
# meta <task> <window> [key=value ...]
meta() { local task="$1" window="$2"; shift 2; printf 'window=%s\nkind=ship\n' "$window" > "$H/state/$task.meta"; for kv in "$@"; do echo "$kv" >> "$H/state/$task.meta"; done; }
live() { echo "$1" >> "$H/windows.txt"; }
# field <task> <python expression over the row r>: the value for that task's row; rows is the whole output
field() { f fleet "$H/notes.md" | python3 -c "import json,sys; d=json.load(sys.stdin); r=next((x for x in d['rows'] if x['task']=='$1'), None); print($2)"; }
ids() { f fleet "$H/notes.md" | python3 -c "import json,sys; print(' '.join(r['task'] for r in json.load(sys.stdin)['rows'] if not r['gone']))"; }
NOW=$(date +%s)

fleet_home
check 'fleet with no tasks prints no rows and no other calls' '[] 0' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["rows"], d["calls"])')"

fleet_home
meta run-a 's:fm-run-a' todo=id:ab12cd3 pr=https://x/pull/7
live 's:fm-run-a'
echo "working [at=$((NOW - 60))]: implementing the view" > "$H/state/run-a.status"
check 'a live worker is a row: word, waiting from the worker, its stamp, window, PR and todo' "working|worker: implementing the view|$((NOW - 60))|s:fm-run-a|https://x/pull/7|ab12cd3|True|False|" "$(field run-a '"|".join(str(r[k]) for k in ["word", "waiting", "at", "window", "pr", "todo", "live", "gone", "flag"])')"

fleet_home
meta ask 's:fm-ask'
live 's:fm-ask'
echo "needs-decision [at=$NOW] [key=pr-body]: new PR body at /d/pr-body.md" > "$H/state/ask.status"
check 'a worker asking for a decision is ? with firstmate as the one it waits on, keeping a line with two brackets' '?|decision|firstmate: new PR body at /d/pr-body.md|ask pr-body|/d/pr-body.md' "$(field ask '"|".join([r["flag"], r["word"], r["waiting"], r["answer"], r["report"]])')"
echo "blocked [at=$NOW]: no slot" > "$H/state/ask.status"
check 'blocked is ? too' '?' "$(field ask 'r["flag"]')"
echo "failed [at=$NOW]: broke" > "$H/state/ask.status"
check 'failed is ? too' '?' "$(field ask 'r["flag"]')"
echo "needs-decision [at=$NOW]: the captain must merge now, URGENT, needs you" > "$H/state/ask.status"
check 'worker prose never makes a row !' '?' "$(field ask 'r["flag"]')"
echo "paused [at=$NOW]: waiting on CI" > "$H/state/ask.status"
check 'a paused ship worker is not flagged and waits on its own text' '|paused|waiting on CI' "$(field ask '"|".join([r["flag"], r["word"], r["waiting"]])')"
printf 'window=s:fm-ask\nkind=scout\n' > "$H/state/ask.meta"
check 'a paused scout is idle' 'idle' "$(field ask 'r["word"]')"

fleet_home
meta died 's:fm-died'
printf "paused [at=$((NOW - 400000))]: waiting on captain: env file\n" > "$H/state/died.status"
meta finished 's:fm-finished'
printf "done [at=$NOW]: PR https://x/pull/1\n" > "$H/state/finished.status"
meta silent 's:fm-silent'
check 'a gone worker with an open wait is ?, and says the worker is gone' '?|False|False|firstmate: worker gone; last: waiting on captain: env file' "$(field died '"|".join([r["flag"], str(r["live"]), str(r["gone"]), r["waiting"]])')"
check 'a gone worker whose last line is done is a gone record' 'True' "$(field finished 'r["gone"]')"
check 'a gone worker that never wrote a state line is ?' '?|firstmate: worker gone; no state line' "$(field silent '"|".join([r["flag"], r["waiting"]])')"
check 'gone records are left out of the shown rows' 'died silent' "$(ids | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')"
live 's:fm-finished'
check 'a live worker whose last line is done is a row, not a gone record' 'False|done' "$(field finished 'str(r["gone"]) + "|" + r["word"]')"

fleet_home
meta w 's:fm-w'
live 's:fm-w'
echo "working [at=$NOW]: a long worker line nobody can read in forty columns" > "$H/state/w.status"
f waiting w 'review the PR body' >/dev/null
check 'a waiting cell firstmate wrote replaces the worker text' 'review the PR body' "$(field w 'r["waiting"]')"
echo "paused [at=$NOW]: waiting on CI" >> "$H/state/w.status"
check 'and holds only until the task writes its next state line' 'waiting on CI' "$(field w 'r["waiting"]')"
echo "resolved [at=$NOW]: x" >> "$H/state/w.status"
f waiting w 'merge word' >/dev/null
echo "resolved [at=$NOW]: y" >> "$H/state/w.status"
check 'a line that is not a state line does not clear it' 'merge word' "$(field w 'r["waiting"]')"
f waiting ../x 'bad' 2>/dev/null
check 'waiting with a task id holding a path is refused' '2' "$?"
f waiting w '   ' 2>/dev/null
check 'waiting with no text is refused' '2' "$?"

# tasks.txt rows: id,state,kind,repo,title,created,hold_kind,hold_until,hold_reason,blocked_by,body
tasks() { { printf 'count: %d\ntasks[%d]{id,state,kind,repo,title,created,hold_kind,hold_until,hold_reason,blocked_by,body}:\n' "$#" "$#"; for row in "$@"; do printf '  %s\n' "$row"; done; printf 'help[1]:\n  - Run `tasks-axi show <id>`\n'; } > "$H/tasks.txt"; }
TODAY=$(date -u +%Y-%m-%d)
SET=$(date -u +%Y-%m-%dT%H:%M:%SZ)

fleet_home
meta origin-x 's:fm-origin-x'
live 's:fm-origin-x'
echo "working [at=$NOW]: studying" > "$H/state/origin-x.status"
tasks "origin-x,in_flight,task,-,\"Study the harness\",$TODAY,-,-,-,none,-" \
  "decide-x,queued,captain,dotfiles,\"Harness decisions\",$TODAY,captain,\"-\",\"D1 learned facts, D2 promotion scope\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\"" \
  "lone-y,queued,captain,dotfiles,\"Unrelated call\",$TODAY,captain,\"-\",\"pick a colour\",none,\"Captain hold set: $SET\""
check 'a live captain hold tied to a live task is a ! row waiting on you, answered as <task> <key>' '!|call|you: D1 learned facts, D2 promotion scope|origin-x decide-x|Harness decisions' "$(field decide-x '"|".join([r["flag"], r["word"], r["waiting"], r["answer"], r["title"]])')"
check 'a live hold tied to nothing shown is counted, not a row' '1 None' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["calls"], next((r for r in d["rows"] if r["task"]=="lone-y"), None))')"
check 'a task row takes its backlog title' 'Study the harness' "$(field origin-x 'r["title"]')"
b link lone-y id:ab12cd3
check 'a live hold linked to an item in the notes file is a ! row' '! 0' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(r for r in d["rows"] if r["task"]=="lone-y")["flag"], d["calls"])')"
printf '# Todo\n\n- [ ] Other <!-- id:zz99zz9 -->\n' > "$H/other.md"
check 'the same hold is not tied to a notes file without that item' '1' "$(f fleet "$H/other.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["calls"])')"
b unlink id:ab12cd3
b link lone-y 'Parked by text'
printf '# Todo\n\n- [/] Parked by text <!-- paused:after the review -->\n' > "$H/parked.md"
check 'a hold linked by text to a paused item is tied to it, its reason not part of the text' '0' "$(f fleet "$H/parked.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["calls"])')"

fleet_home
meta origin-x 's:fm-origin-x'
live 's:fm-origin-x'
tasks "plan-calls,queued,captain,-,\"Plan calls\",$TODAY,captain,\"-\",\"Five calls in data/sprint6-plan/report.md\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\"" \
  "abs-calls,queued,captain,-,\"Abs calls\",$TODAY,captain,\"-\",\"Read /d/plan/report.md\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\""
check 'a hold naming a home-relative report shows its absolute path under the home' "$H/data/sprint6-plan/report.md" "$(field plan-calls 'r["report"]')"
check 'a hold naming an absolute report shows it as written' '/d/plan/report.md' "$(field abs-calls 'r["report"]')"
echo "done [at=$NOW]: report at data/scout/r.md" > "$H/state/origin-x.status"
check 'a worker line naming a home-relative report shows its absolute path under the home' "$H/data/scout/r.md" "$(field origin-x 'r["report"]')"
echo "done [at=$NOW]: Exact text in report.md, see the PR" > "$H/state/origin-x.status"
check 'a bare file name with no folder is not a report path' 'None' "$(field origin-x 'r["report"]')"

fleet_home
meta origin-x 's:fm-origin-x'
live 's:fm-origin-x'
FUTURE=$(python3 -c 'import datetime; print((datetime.date.today() + datetime.timedelta(days=3)).isoformat())')
OLD=$(python3 -c 'import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
tasks "dated,queued,captain,-,\"Later\",$TODAY,captain,$FUTURE,\"after the release\",none,\"Captain hold origin: origin-x\"" \
  "aged,queued,captain,-,\"Old\",$TODAY,captain,\"-\",\"stale call\",none,\"Captain hold set: $OLD\\nCaptain hold origin: origin-x\"" \
  "gated,queued,captain,-,\"Gated\",$TODAY,captain,\"-\",\"after dep\",dep-1,\"Captain hold origin: origin-x\"" \
  "freed,queued,captain,-,\"Freed\",$TODAY,captain,\"-\",\"dep done\",dep-2,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\"" \
  "dep-1,queued,task,-,\"Dep one\",$TODAY,-,-,-,none,-" \
  "dep-2,done,task,-,\"Dep two\",$TODAY,-,-,-,none,-" \
  "agent-hold,queued,task,-,\"Agent hold\",$TODAY,firstmate,\"-\",\"waiting\",none,\"Captain hold origin: origin-x\"" \
  "closed,done,captain,-,\"Closed\",$TODAY,captain,\"-\",\"answered\",none,\"Captain hold origin: origin-x\""
check 'only live captain holds are rows: not dated, aged, blocked, non-captain or done ones' 'freed origin-x' "$(ids | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')"

fleet_home
tasks "x,queued,task,-,\"X\",$TODAY,-,-,-,none,-"
f fleet "$H/notes.md" >/dev/null
f fleet "$H/notes.md" >/dev/null
check 'the backlog is read once for calls within 30 seconds' '1' "$(wc -l < "$H/tasks.runs" | tr -d ' ')"

fleet_home
meta a 's:fm-a'; live 's:fm-a'; echo "working [at=$((NOW - 10))]: a" > "$H/state/a.status"
meta b 's:fm-b'; live 's:fm-b'; echo "working [at=$NOW]: b" > "$H/state/b.status"
meta c 's:fm-c'; live 's:fm-c'; echo "blocked [at=$((NOW - 99))]: c" > "$H/state/c.status"
tasks "h,queued,captain,-,\"H\",$TODAY,captain,\"-\",\"call\",none,\"Captain hold set: $SET\\nCaptain hold origin: a\""
check 'rows order ! first, then ?, then newest first' 'h c b a' "$(ids)"

fleet_home
meta scout-r 's:fm-scout-r'
echo "done [at=$NOW]: finished, see the PR" > "$H/state/scout-r.status"
check 'a task with no report named and none on disk has no report and no summary' 'None|None' "$(field scout-r 'str(r["report"]) + "|" + str(r["summary"])')"
mkdir -p "$H/data/scout-r"
printf '# Cleanroom POC - report (step 1 blocked)\n\nStatus: **BLOCKED** at spec step 1. App not running.\nChecked: 2026-10-26.\n\n## What was checked\n\n1. ports\n\n## What is needed from the captain\n\n1. Start the API and web locally.\n2. Tell firstmate the URL.\n' > "$H/data/scout-r/report.md"
touch -t 202610260640.00 "$H/data/scout-r/report.md"
MTIME=$(python3 -c "import os; print(int(os.path.getmtime('$H/data/scout-r/report.md')))")
check 'a task whose state line names no report takes data/<task>/report.md' "$H/data/scout-r/report.md" "$(field scout-r 'r["report"]')"
check 'the summary has the title, the Status line as outcome, the first line under the captain heading as ask, and the mtime' \
  "Cleanroom POC - report (step 1 blocked)|BLOCKED at spec step 1. App not running.|Start the API and web locally.|$MTIME" \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask", "at"])')"
printf '# Four tools\n\n30 October 2026. A study.\n\n## 1. Summary\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nNone of the four should be installed.\n\n- Needs: the captain picks one of A or B.\n' > "$H/data/scout-r/report.md"
check 'without a Status line the outcome is the first prose line under a Summary heading, past a table; a Needs: line is the ask' \
  'Four tools|None of the four should be installed.|the captain picks one of A or B.' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask"])')"
printf '# jev-decider report\n\nBranch `fm/jev-decider`, four commits.\n\n## Commits\n\n1. one\n' > "$H/data/scout-r/report.md"
check 'else the outcome is the first prose line after the title, and a report that asks nothing has no ask' \
  'jev-decider report|Branch `fm/jev-decider`, four commits.|None' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask"])')"
printf '# Sweep\n\nScout sweep, read-only.\n\n## Decisions made\n\n- kept A\n\n## Detail\n\nResult: one flake.\n\n## Questions for the captain\n\n```\ncode\n```\n\n---\n\nQ1. Close the 30 records?\n' > "$H/data/scout-r/report.md"
check 'a Result: line past the first section is not the outcome; a heading that only mentions decisions is not an ask; fences and rules under the ask heading are skipped' \
  'Scout sweep, read-only.|Q1. Close the 30 records?' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["outcome", "ask"])')"
printf 'Plain notes with no heading.\n\nSecond paragraph.\n' > "$H/data/scout-r/report.md"
check 'a report with no heading takes its first line as title and the next prose line as outcome' \
  'Plain notes with no heading.|Second paragraph.' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome"])')"
echo "done [at=$NOW]: report at /nowhere/gone.md" > "$H/state/scout-r.status"
check 'a named report that is not on disk keeps its path and has no summary' '/nowhere/gone.md|None' "$(field scout-r 'str(r["report"]) + "|" + str(r["summary"])')"

# The backlog is cached for 30 seconds per home, so a hold needs a fresh home.
fleet_home
mkdir -p "$H/data/plan"
printf '# Plan calls\n\n## Hard questions (for the captain)\n\n### H1. Ship now, or wait?\n\n- Options: A, B\n' > "$H/data/plan/report.md"
meta origin-x 's:fm-origin-x'
live 's:fm-origin-x'
tasks "plan-calls,queued,captain,-,\"Plan calls\",$TODAY,captain,\"-\",\"Five calls in data/plan/report.md\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\""
check 'a captain hold naming a report carries its summary; a heading under the captain heading is the ask' 'Plan calls|H1. Ship now, or wait?' "$(field plan-calls 'r["summary"]["title"] + "|" + r["summary"]["ask"]')"

fleet_home
f crew run-a > "$H/crew.out"
check 'crew prints fm-crew-state.sh for the task, run against this home' "run-a|FM_HOME=$H|state: done · source: run-step · checks green" "$(printf '%s|%s' "$(cat "$H/crew.args")" "$(tr '\n' '|' < "$H/crew.out" | sed 's/|$//')")"
f crew ../x 2>/dev/null
check 'crew with a task id holding a path is refused' '2' "$?"

home
printf '# Objectives\n\n- [ ] not a todo item\n\n# Todo\n\n- [ ] Ship the bridge <!-- id:ab12cd3 -->\n- [x] Done one <!-- id:dd00000 -->\n- [-] Declined one\nnot an item\n- [~] **Short**: Started one <!-- id:cc11111 -->\n- [!] Blocked one\n- [/] Paused one <!-- paused:after the review --> <!-- id:ee22222 -->\n\n# Important\n\n- [ ] not a todo item either\n' > "$H/n.md"
check 'open prints every item under # Todo that is not done or declined, in file order, with its id; a paused one with its reason' '[{"id": "ab12cd3", "status": "todo", "text": "Ship the bridge"}, {"id": "cc11111", "status": "in-progress", "text": "**Short**: Started one"}, {"id": null, "status": "blocked", "text": "Blocked one"}, {"id": "ee22222", "status": "paused", "text": "Paused one", "reason": "after the review"}]' "$(b open "$H/n.md")"
check 'open on a missing notes file exits 1' '1' "$(b open "$H/none.md" 2>/dev/null; echo $?)"

printf '\n' "" ; printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
