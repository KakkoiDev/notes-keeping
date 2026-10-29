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
check 'a last state line of done is done, while the meta is still there and after a resolved line' '{"Review this PR: https://x/pull/1": {"status": "done", "task": "pr-review"}}' "$(b status /n.md)"
rm "$H/state/pr-review.meta"
check 'done survives teardown removing the meta' '{"Review this PR: https://x/pull/1": {"status": "done", "task": "pr-review"}}' "$(b status /n.md)"
echo "failed [at=4]: broke" >> "$H/state/pr-review.status"
check 'a failed task with no meta reports null' '{"Review this PR: https://x/pull/1": {"status": null, "task": "pr-review"}}' "$(b status /n.md)"
check 'an old-style line without a stamp counts' 'done' "$(printf 'done: PR x\n' > "$H/state/pr-review.status"; b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])')"

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
check 'a done line after the block reports done' 'done' "$(b status /n.md | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin).values()))["status"])')"

home
b block spawn-x --by firstmate 2>/dev/null
check 'block without --reason is refused' '2' "$?"
b block spawn-x --reason '  ' 2>/dev/null
check 'block with an empty reason is refused' '2' "$?"
b block ../x --reason 'bad' 2>/dev/null
check 'block with a task id holding a path is refused' '2' "$?"
check 'a refused block writes nothing' 'absent' "$([ -e "$H/state/notes-todo-blocks.jsonl" ] && echo present || echo absent)"

printf '\n' "" ; printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
