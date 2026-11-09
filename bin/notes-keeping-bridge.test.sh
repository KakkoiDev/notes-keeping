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
printf 'window=w\nkind=ship\ntodo=id:ab12cd3\n' > "$H/state/run-a.meta"
check 'a meta whose todo= names an item id links it with no link record: in-progress from spawn' '{"id:ab12cd3": {"status": "in-progress", "task": "run-a", "id": "ab12cd3"}}' "$(b status /n.md)"
b block run-a --reason 'no slot'
check 'a meta-named item reports its task block with the reason' '{"id:ab12cd3": {"status": "blocked", "task": "run-a", "id": "ab12cd3", "reason": "no slot"}}' "$(b status /n.md)"
b link other id:ab12cd3 --by firstmate
check 'a link record for the item wins over a meta that names it' '{"id:ab12cd3": {"status": null, "task": "other", "id": "ab12cd3", "by": "firstmate"}}' "$(b status /n.md)"
b unlink id:ab12cd3
check 'an unlink of the item wins over a meta that names it' '{}' "$(b status /n.md)"

home
printf 'window=w\nkind=ship\ntodo=Ship the bridge\n' > "$H/state/run-b.meta"
check 'a meta todo= in text links nothing: only an id names an item' '{}' "$(b status /n.md)"

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
# picked: whether firstmate acknowledged the inbox note a request filed, read from its own records (the request's
# reservation names the note; firstmate's drain --ack moves the note to handled/).
home
out=$(printf 'Review: todo -> done (captain)\n' | b notify /notes/a.md)
request=${out#request_id=}
check 'notify prints the request id of the note it filed' 'yes' "$(case "$out" in request_id=nk-*) echo yes ;; *) echo no ;; esac)"
check 'that request id is the one the note carries' '1' "$(grep -c "^request_id=$request\$" "$H"/state/inbox/*.note)"
check 'picked: a note firstmate has not acknowledged is null' "{\"$request\": null}" "$(b picked "$request")"
note_id=$(cat "$H/state/inbox/.requests/$request")
FM_HOME="$H" "$FM_ROOT/bin/fm-inbox.sh" drain --ack "$note_id" --no-dispatch 'bridge test' >/dev/null
at=$(python3 -c 'import os,sys; from datetime import datetime, timezone; print(datetime.fromtimestamp(int(os.stat(sys.argv[1]).st_ctime), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$H/state/inbox/handled/$note_id.note")
check 'picked: once drain --ack moved the note to handled/, the UTC time of that move' "{\"$request\": \"$at\"}" "$(b picked "$request")"
check 'picked: a request with no reservation is null, and several requests are answered at once' "{\"$request\": \"$at\", \"nk-0000000000000000\": null}" "$(b picked "$request" nk-0000000000000000)"
b picked ../x >/dev/null 2>&1
check 'picked: a request id that is not nk-<hex> is refused' '2' "$?"

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
b block spawn-x --reason 'stalled a third time' --by firstmate
echo "needs-decision [key=k] [at=7]: pick one" >> "$H/state/spawn-x.status"
check 'a state line with two bracket tags after the block clears it' 'in-progress' "$(st)"

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
check 'a live worker is a row: word, waiting from the worker, its stamp, window, PR and todos' "working|worker: implementing the view|$((NOW - 60))|s:fm-run-a|https://x/pull/7|['ab12cd3']|True|False|" "$(field run-a '"|".join(str(r[k]) for k in ["word", "waiting", "at", "window", "pr", "todos", "live", "gone", "flag"])')"

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
check 'an unlinked worker gone with an open wait is a gone record, counted and not flagged' 'True||1' "$(field died '"|".join([str(r["gone"]), r["flag"], str(len([x for x in d["rows"] if x["task"] == "died"]))])')"
check 'an unlinked worker gone after a done line is a gone record' 'True' "$(field finished 'r["gone"]')"
check 'an unlinked worker gone with no state line is a gone record' 'True' "$(field silent 'r["gone"]')"
check 'gone records are left out of the shown rows and counted at the top' ' 3' "$(ids) $(f fleet "$H/notes.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["gone"])')"
printf '# Todo\n\n- [ ] Env <!-- id:ab12cd3 -->\n- [ ] Fin <!-- id:cd34ef5 -->\n' > "$H/notes.md"
b link died id:ab12cd3
b link finished id:cd34ef5
check 'a worker gone with an open wait and linked to an open item is a ? row, word gone, saying the worker is gone' '?|False|gone|firstmate: worker gone; last: waiting on captain: env file' "$(field died '"|".join([r["flag"], str(r["gone"]), r["word"], r["waiting"]])')"
check 'a worker gone after a done line and linked to an open item is a finished row' 'False|finished|' "$(field finished '"|".join([str(r["gone"]), r["word"], r["flag"]])')"
check 'only the unlinked one is counted gone' '1' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["gone"])')"
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
printf '# Todo\n\n- [ ] Ship it <!-- id:ab12cd3 -->\n- [~] Review it <!-- id:cd34ef5 -->\n- [x] Done one <!-- id:ef56ab7 -->\n- [ ] Other <!-- id:zz99zz9 -->\n' > "$H/notes.md"
tasks "hold-x,queued,captain,-,\"Hold X\",$TODAY,captain,\"-\",\"pick\",none,\"Captain hold set: $SET\\nCaptain hold origin: run-a\""
meta run-a 's:fm-run-a'
live 's:fm-run-a'
echo "working [at=$NOW]: x" > "$H/state/run-a.status"
b link run-a id:ab12cd3
b link run-a id:cd34ef5
b link run-a id:ef56ab7
check 'a task linked to two open items carries both, in file order; a done item is left out' "['ab12cd3', 'cd34ef5']" "$(field run-a 'r["todos"]')"
check 'a hold carries the open items its origin task is linked to' "['ab12cd3', 'cd34ef5']" "$(field hold-x 'r["todos"]')"
b link hold-x id:zz99zz9
check 'and the item linked to the hold itself, in file order' "['ab12cd3', 'cd34ef5', 'zz99zz9']" "$(field hold-x 'r["todos"]')"

fleet_home
mkdir -p "$H/data/fin-a" "$H/data/arch-b"
printf '# Fin A report\n\nOutcome: shipped the fix.\nNeeds: nothing\n' > "$H/data/fin-a/report.md"
touch -t 202611050100.00 "$H/data/fin-a/report.md"
FIN_AT=$(python3 -c "import os; print(int(os.path.getmtime('$H/data/fin-a/report.md')))")
printf '# Done archive\n\n## Archived 2026-11-04\n- [x] arch-b - Archived scout (repo: webapp) (kind: scout) PR https://x/pull/5 (done 2026-11-04)\n- [x] other - not linked (done 2026-11-04)\n' > "$H/data/done-archive.md"
tasks "fin-a,done,ship,-,\"Fin A\",$TODAY,-,-,-,none,-" "stop-c,in_flight,ship,-,\"Stop C\",$TODAY,-,-,-,none,-" "unlinked-d,done,ship,-,\"Unlinked\",$TODAY,-,-,-,none,-"
printf '# Todo\n\n- [ ] Ship it <!-- id:ab12cd3 -->\n- [ ] B <!-- id:bb00000 -->\n- [ ] C <!-- id:cc00000 -->\n- [ ] E <!-- id:ee00000 -->\n' > "$H/notes.md"
b link fin-a id:ab12cd3
b link arch-b id:bb00000
b link stop-c id:cc00000
b link nowhere-e id:ee00000
check 'a linked done task with no meta and a report is a finished row with its summary and the report mtime' \
  "finished|Fin A|$FIN_AT|Fin A report|shipped the fix.|['ab12cd3']|False|" \
  "$(field fin-a '"|".join(str(x) for x in [r["word"], r["title"], r["at"], r["summary"]["title"], r["summary"]["outcome"], r["todos"], r["live"], r["flag"]])')"
check 'a linked task in the done archive is a finished row with its kind, title, PR and done date' \
  "finished|scout|Archived scout|https://x/pull/5|$(python3 -c 'import calendar,time; print(calendar.timegm(time.strptime("2026-11-04","%Y-%m-%d")))')" \
  "$(field arch-b '"|".join(str(r[k]) for k in ["word", "kind", "title", "pr", "at"])')"
check 'a linked task still in flight with no meta is stopped' 'stopped' "$(field stop-c 'r["word"]')"
check 'a linked task with no record anywhere and no report is not a row; an unlinked one is not either' 'None None' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; rows={r["task"]: r for r in json.load(sys.stdin)["rows"]}; print(rows.get("nowhere-e"), rows.get("unlinked-d"))')"

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
check 'a call with no Question: or Options: lines asks its title and offers no options' "{'question': 'Harness decisions', 'options': [], 'at': $(python3 -c "import calendar,time; print(calendar.timegm(time.strptime('$SET','%Y-%m-%dT%H:%M:%SZ')))"), 'state': 'open'}" "$(field decide-x 'r["call"]')"
check 'a task row has no call' 'None' "$(field origin-x 'r.get("call")')"
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
tasks "ask-q,queued,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Send the proposal to the client?\\nOptions: Store-only batch 1 (recommended)\\nOptions: Measure first only\\nOptions: Close it now\""
check 'a call takes its Question: line and one option per Options: line' "Send the proposal to the client?|['Store-only batch 1 (recommended)', 'Measure first only', 'Close it now']" "$(field ask-q 'r["call"]["question"] + "|" + str(r["call"]["options"])')"

# status under a captain call: fs <item key> prints that item's status and reason from `status`.
fs() { f status "$H/notes.md" | python3 -c "import json,sys; v=json.load(sys.stdin)['$1']; print(v['status'], v.get('reason', ''))"; }
fleet_home
printf '# Todo\n\n- [~] Ship it <!-- id:ab12cd3 -->\n- [ ] Ask it <!-- id:cd34ef5 -->\n' > "$H/notes.md"
meta origin-x 's:fm-origin-x'
echo "working [at=$NOW]: studying" > "$H/state/origin-x.status"
b link origin-x id:ab12cd3
b link ask-q id:cd34ef5
check 'with no captain call the linked task reports what its state files say' 'in-progress ' "$(fs id:ab12cd3)"
tasks "ask-q,queued,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Ship to prod?\"" \
  "ask-r,queued,captain,-,\"Ask R\",$TODAY,captain,\"-\",\"other\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Which colour?\""
rm -f "$H"/cache/*.json
check 'an open captain call whose origin is the linked task reports blocked, with the question as the reason' 'blocked captain call: Ship to prod?' "$(fs id:ab12cd3)"
check 'an item linked to the call itself reports blocked' 'blocked captain call: Ship to prod?' "$(fs id:cd34ef5)"
tasks "ask-q,done,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Ship to prod?\"" \
  "ask-r,queued,captain,-,\"Ask R\",$TODAY,captain,\"-\",\"other\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Which colour?\""
rm -f "$H"/cache/*.json
check 'one call answered and another still open on the task: still blocked, by the open one' 'blocked captain call: Which colour?' "$(fs id:ab12cd3)"
tasks "ask-q,done,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Ship to prod?\"" \
  "ask-r,done,captain,-,\"Ask R\",$TODAY,captain,\"-\",\"other\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Which colour?\""
rm -f "$H"/cache/*.json
check 'every call answered: the task reports what its state files say again' 'in-progress ' "$(fs id:ab12cd3)"
tasks "ask-q,queued,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\\nQuestion: Ship to prod?\""
rm -f "$H"/cache/*.json
printf '# Todo\n\n- [/] Ship it <!-- id:ab12cd3 --> <!-- paused:after the review -->\n' > "$H/notes.md"
check 'an item the notes file holds as paused is not reported blocked by an open call' 'in-progress ' "$(fs id:ab12cd3)"

# tasks with their closed date: id,state,kind,repo,title,created,closed,hold_kind,hold_until,hold_reason,blocked_by,body
ctasks() { { printf 'count: %d\ntasks[%d]{id,state,kind,repo,title,created,closed,hold_kind,hold_until,hold_reason,blocked_by,body}:\n' "$#" "$#"; for row in "$@"; do printf '  %s\n' "$row"; done; } > "$H/tasks.txt"; }

fleet_home
printf '# Todo\n\n- [~] Scope it <!-- id:ab12cd3 -->\n' > "$H/notes.md"
meta t 's:fm-t'
live 's:fm-t'
mkdir -p "$H/state/t.inbox/handled"
echo 'origin-t ans-a: 1, but measure for 1 week' > "$H/state/t.inbox/handled/002.msg"
touch -t 202611050815.00 "$H/state/t.inbox/handled/002.msg"
SENT_AT=$(python3 -c "import os; print(int(os.path.getmtime('$H/state/t.inbox/handled/002.msg')))")
READ_AT=$(python3 -c "import os; print(int(os.stat('$H/state/t.inbox/handled/002.msg').st_ctime))")
printf 'working [at=%s]: before the answer\ndone [at=%s]: proposal posted to the client\n' "$((READ_AT - 100))" "$((READ_AT + 60))" > "$H/state/t.status"
ctasks "ans-a,queued,captain,-,\"Send the proposal?\",$TODAY,-,-,-,-,none,\"Resolution recorded by fm-captain-hold.\\nDecision digest: abc\\nResolution mode: answered\\n\\nCaptain decision:\\n1, but measure for 1 week, not 2\\n\\nRouted to: t 002\\nCaptain hold origin: t\\nQuestion: Send the cut-scope proposal to the client?\\nOptions: Store-only batch 1\""
b link t id:ab12cd3
check 'an answered hold whose origin is on an open to-do stays a row, its call answered and asking nobody' "answered||Send the cut-scope proposal to the client?" "$(field ans-a 'r["call"]["state"] + "|" + r["flag"] + "|" + r["call"]["question"]')"
check 'its trail starts with what the captain said and that firstmate recorded it' "[('you', None, '1, but measure for 1 week, not 2'), ('firstmate', None, 'recorded it')]" "$(field ans-a 'str([(s["who"], s["at"], s["text"]) for s in r["trail"][:2]])')"
check 'a hold with Routed to: t 002 and t.inbox/handled/002.msg yields the 3 trail steps: sent, read, the next state line' "[('firstmate', $SENT_AT, 'sent it to the worker (message 002)'), ('worker', $READ_AT, 'read it'), ('worker', $((READ_AT + 60)), 'done: proposal posted to the client')]" "$(field ans-a 'str([(s["who"], s["at"], s["text"]) for s in r["trail"][2:]])')"
mv "$H/state/t.inbox/handled/002.msg" "$H/state/t.inbox/002.msg"
check 'a message not yet handled ends the trail at sent' "['you', 'firstmate', 'firstmate']" "$(field ans-a 'str([s["who"] for s in r["trail"]])')"
rm "$H/state/t.inbox/002.msg"
check 'a routed message with no file ends the trail at recorded' "['you', 'firstmate']" "$(field ans-a 'str([s["who"] for s in r["trail"]])')"
b unlink id:ab12cd3
check 'an answered hold on no open to-do is no row' 'None' "$(field ans-a 'r')"
check 'a live hold has an empty trail and an open call' "[]|open" "$(fleet_home; meta origin-x 's:fm-origin-x'; live 's:fm-origin-x'; tasks "ask-q,queued,captain,-,\"Ask Q\",$TODAY,captain,\"-\",\"long reason\",none,\"Captain hold set: $SET\\nCaptain hold origin: origin-x\""; field ask-q 'str(r["trail"]) + "|" + r["call"]["state"]')"

fleet_home
ctasks "moot-a,done,captain,-,\"Moot A\",$TODAY,$TODAY,-,-,-,none,\"Resolution recorded by fm-captain-hold.\\nDecision digest: d\\nResolution mode: reconciled\\n\\nReconciliation evidence:\\nfollow-up fix-b shipped the change\"" \
  "ans-b,done,captain,-,\"Ans B\",$TODAY,$TODAY,-,-,-,none,\"Resolution recorded by fm-captain-hold.\\nDecision digest: d\\nResolution mode: answered\\n\\nCaptain decision:\\nyes\"" \
  "old-c,done,captain,-,\"Old C\",2026-01-01,2026-01-02,-,-,-,none,\"Resolution recorded by fm-captain-hold.\\nDecision digest: d\\nResolution mode: repaired\\n\\nCaptain decision:\\nx\"" \
  "rel-d,done,captain,-,\"Rel D\",$TODAY,$TODAY,-,-,-,none,\"Resolution recorded by fm-captain-hold.\\nDecision digest: d\\nResolution mode: released\\n\\nCaptain decision:\\ngo\""
check 'closedToday counts the captain holds closed today without the captain: not answered, not released' '1' "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["closedToday"])')"
check 'and closed lists each with its title and evidence line' "[{'task': 'moot-a', 'title': 'Moot A', 'evidence': 'follow-up fix-b shipped the change'}]" "$(f fleet "$H/notes.md" | python3 -c 'import json,sys; print(json.load(sys.stdin)["closed"])')"

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
check 'the summary has the title, a Status: line as the outcome, and the mtime; a heading for the captain is not read as the ask' \
  "Cleanroom POC - report (step 1 blocked)|BLOCKED at spec step 1. App not running.|None|$MTIME" \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask", "at"])')"
printf '# Slack ask\n\nSource: Slack C0123456789, thread 1700000000.000100.\nGenerated 2026-11-05. No writes made.\n\n## Summary\n\nThe thread asks for nothing.\n' > "$H/data/scout-r/report.md"
check 'a report starting with metadata and no Outcome: line has no outcome: no prose line or Summary heading is guessed' \
  'Slack ask|None|None' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask"])')"
printf '# Four tools\n\nOutcome: none of the four should be installed.\nNeeds: the captain picks A or B.\n\n## 1. Summary\n\nText.\n' > "$H/data/scout-r/report.md"
check 'Outcome: and Needs: lines at the head are the outcome and the ask' \
  'Four tools|none of the four should be installed.|the captain picks A or B.' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["title", "outcome", "ask"])')"
printf '# Late heads\n\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\nOutcome: too late.\nNeeds: too late.\n' > "$H/data/scout-r/report.md"
check 'Outcome: and Needs: lines past the first 15 lines are not read' \
  'None|None' \
  "$(field scout-r '"|".join(str(r["summary"][k]) for k in ["outcome", "ask"])')"
printf 'Plain notes with no heading.\n\nSecond paragraph.\n' > "$H/data/scout-r/report.md"
check 'a report with no heading takes its first line as title and has no outcome' \
  'Plain notes with no heading.|None' \
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
check 'a captain hold naming a report carries its summary' 'Plan calls|None' "$(field plan-calls 'r["summary"]["title"] + "|" + str(r["summary"]["ask"])')"

fleet_home
f crew run-a > "$H/crew.out"
check 'crew prints fm-crew-state.sh for the task, run against this home' "run-a|FM_HOME=$H|state: done · source: run-step · checks green" "$(printf '%s|%s' "$(cat "$H/crew.args")" "$(tr '\n' '|' < "$H/crew.out" | sed 's/|$//')")"
f crew ../x 2>/dev/null
check 'crew with a task id holding a path is refused' '2' "$?"

home
printf '# Objectives\n\n- [ ] not a todo item\n\n# Todo\n\n- [ ] Ship the bridge <!-- id:ab12cd3 -->\n- [x] Done one <!-- id:dd00000 -->\n- [-] Declined one\nnot an item\n- [~] **Short**: Started one <!-- id:cc11111 -->\n- [!] Blocked one\n- [/] Paused one <!-- paused:after the review --> <!-- id:ee22222 -->\n\n# Important\n\n- [ ] not a todo item either\n' > "$H/n.md"
check 'open prints every item under # Todo that is not done or declined, in file order, with its id; a paused one with its reason' '[{"id": "ab12cd3", "status": "todo", "text": "Ship the bridge"}, {"id": "cc11111", "status": "in-progress", "text": "**Short**: Started one"}, {"id": null, "status": "blocked", "text": "Blocked one"}, {"id": "ee22222", "status": "paused", "text": "Paused one", "reason": "after the review"}]' "$(b open "$H/n.md")"
check 'open on a missing notes file exits 1' '1' "$(b open "$H/none.md" 2>/dev/null; echo $?)"

# call-answer: the captain's answer to a held call, fed to firstmate's keyed-answer intake, then one inbox note. Firstmate's
# fm-captain-hold.sh and fm-inbox.sh are stubs that record how they were run.
call_home() {
  fleet_home
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" > "%s/hold.args"\necho "FM_HOME=$FM_HOME" > "%s/hold.env"\ncat > "%s/hold.stdin"\ncat "%s/hold.out" 2>/dev/null\nexit "$(cat "%s/hold.rc" 2>/dev/null || echo 0)"\n' "$H" "$H" "$H" "$H" "$H" > "$H/root/bin/fm-captain-hold.sh"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" > "%s/inbox.args"\necho "FM_HOME=$FM_HOME" > "%s/inbox.env"\ncat > "%s/inbox.body"\nrc=$(cat "%s/inbox.rc" 2>/dev/null || echo 0)\n[ "$rc" = 0 ] || echo "inbox said no" >&2\nexit "$rc"\n' "$H" "$H" "$H" "$H" > "$H/root/bin/fm-inbox.sh"
  chmod +x "$H/root/bin/fm-captain-hold.sh" "$H/root/bin/fm-inbox.sh"
  echo 'closed: ask-q' > "$H/hold.out"
  printf 'answers: closed=1 skipped=0\n' >> "$H/hold.out"
}
ca() { local text="$1"; shift; printf '%s' "$text" | f call-answer "$@"; }
tabs() { printf '%s' "$1" | od -An -c | tr -s ' ' | tr -d '\n'; }

call_home
out=$(ca '1 Store-only batch 1' ask-q 2>&1); rc=$?
check 'call-answer exits 0 and prints the intake output when the call closed, then the request id of its note' "0|closed: ask-q
answers: closed=1 skipped=0
request_id=nk-" "$rc|$(printf '%s' "$out" | sed -E 's/nk-[0-9a-f]{16}/nk-/')"
check 'call-answer feeds the keyed-answer intake with this channel as its source, any origin' 'answers --any-origin --source notes-keeping' "$(cat "$H/hold.args")"
check 'call-answer pipes one keyed line: task, the answer, an empty label, no close mode (a question closes)' "$(printf 'ask-q\t1 Store-only batch 1\t')" "$(cat "$H/hold.stdin")"
check 'call-answer runs the intake against this home' "FM_HOME=$H" "$(cat "$H/hold.env")"

call_home
ca 'ship it' work-x --release >/dev/null 2>&1
check 'call-answer --release feeds the release close mode: a held work item resumes' "$(printf 'work-x\tship it\t\trelease')" "$(cat "$H/hold.stdin")"

call_home
ca "$(printf 'two\nlines\twith\ttabs  and   gaps')" ask-q >/dev/null 2>&1
check 'call-answer keeps the answer on one line: line breaks, tabs and runs of spaces are one space' "$(printf 'ask-q\ttwo lines with tabs and gaps\t')" "$(cat "$H/hold.stdin")"

call_home
ca '   ' ask-q >/dev/null 2>&1; rc=$?
check 'call-answer with an empty answer exits 2 and runs nothing' '2|no' "$rc|$([ -e "$H/hold.args" ] && echo yes || echo no)"
ca 'x' '../x' >/dev/null 2>&1; rc=$?
check 'call-answer with a task id holding a path exits 2 and runs nothing' '2|no' "$rc|$([ -e "$H/hold.args" ] && echo yes || echo no)"
long=$(python3 -c 'print("a" * 513)')
err=$(ca "$long" ask-q 2>&1 >/dev/null); rc=$?
check 'call-answer refuses an answer the record would cut (over 512 characters), saying so, and runs nothing' "2|yes|no" "$rc|$(case "$err" in *512*) echo yes ;; *) echo no ;; esac)|$([ -e "$H/hold.args" ] && echo yes || echo no)"
ca "$(python3 -c 'print("a" * 512)')" ask-q >/dev/null 2>&1; rc=$?
check 'call-answer takes an answer of exactly 512 characters' '0' "$rc"

call_home
printf 'skipped: ask-q (already closed)\nanswers: closed=0 skipped=1\n' > "$H/hold.out"; echo 1 > "$H/hold.rc"
err=$(ca 'late' ask-q 2>&1 >/dev/null); rc=$?
check 'call-answer exits 1 naming why when the intake skipped the call, and files no note' "1|yes|no" "$rc|$(case "$err" in *'already closed'*) echo yes ;; *) echo no ;; esac)|$([ -e "$H/inbox.args" ] && echo yes || echo no)"

call_home
ca '1 Store-only batch 1' ask-q >/dev/null 2>&1
check 'call-answer files one captain inbox note after the call closed, its first line naming the task and the answer' "note --request-id nk- -|captain answered ask-q: 1 Store-only batch 1" "$(sed -E 's/nk-[0-9a-f]{16}/nk-/' "$H/inbox.args")|$(head -1 "$H/inbox.body")"
check 'the note asks firstmate to route the answer to the worker when it changes what is built' 'yes' "$(grep -qi 'route' "$H/inbox.body" && echo yes || echo no)"
check 'the note is filed against this home' "FM_HOME=$H" "$(cat "$H/inbox.env")"

call_home
ca '1 Store-only batch 1' ask-q >/dev/null 2>&1
first=$(grep -o 'nk-[0-9a-f]*' "$H/inbox.args")
sleep 1.1
ca '1 Store-only batch 1' ask-q >/dev/null 2>&1
check 'the same answer sent twice files its note under one request id, so a replay does not wake firstmate again' "$first" "$(grep -o 'nk-[0-9a-f]*' "$H/inbox.args")"
ca 'Measure first only' ask-q >/dev/null 2>&1
check 'a different answer to the same call is its own request' 'differs' "$([ "$(grep -o 'nk-[0-9a-f]*' "$H/inbox.args")" != "$first" ] && echo differs || echo same)"

call_home
echo 1 > "$H/inbox.rc"
err=$(ca '1 Store-only batch 1' ask-q 2>&1 >/dev/null); rc=$?
check 'call-answer exits 1 when the note cannot be filed, saying the answer is recorded' "1|yes" "$rc|$(case "$err" in *recorded*) echo yes ;; *) echo no ;; esac)"

call_home
printf 'count: 0\ntasks[0]{id,state,kind,repo,title,created,hold_kind,hold_until,hold_reason,blocked_by,body}:\n' > "$H/tasks.txt"
f fleet "$H/notes.md" >/dev/null
f fleet "$H/notes.md" >/dev/null
before=$(wc -l < "$H/tasks.runs" | tr -d ' ')
ca 'go' ask-q >/dev/null 2>&1
f fleet "$H/notes.md" >/dev/null
after=$(wc -l < "$H/tasks.runs" | tr -d ' ')
check 'a recorded answer drops the 30 s backlog cache: the next fleet read sees the call closed' '1 2' "$before $after"

printf '\n' "" ; printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
