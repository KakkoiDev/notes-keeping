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
printf '\n' "" ; printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
