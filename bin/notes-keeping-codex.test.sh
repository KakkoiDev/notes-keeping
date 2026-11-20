#!/usr/bin/env bash
set -uo pipefail

ADAPTER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/notes-keeping-codex"
TMP_ROOT="${TMPDIR:-/tmp}"
H="$(mktemp -d "$TMP_ROOT/nk-codex.XXXXXX")"
export NOTES_KEEPING_DIR="$H/notes"
export NOTES_KEEPING_CODEX_STATE="$H/state"
export GIT_AUTHOR_NAME='notes-keeping test'
export GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export NOTES_KEEPING_BRIDGE="$H/bridge"
pass=0
fail=0

printf '%s\n' '#!/usr/bin/env bash' "cat >> \"\$NOTES_KEEPING_DIR/bridge-notify\"" > "$NOTES_KEEPING_BRIDGE"
chmod +x "$NOTES_KEEPING_BRIDGE"

check() {
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
  fi
}

hook() {
  printf '{"session_id":"thread-123","cwd":"/work/sample","hook_event_name":"%s","source":"startup"}\n' "$1" | "$ADAPTER" hook
}

hook SessionStart >/dev/null
file="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["path"])' "$H/state/sessions/thread-123.json")"
check 'session start creates a per-session notes file' yes "$([ -f "$file" ] && echo yes || echo no)"
check 'new notes file records the Codex session' yes "$(grep -q 'Sessions: thread-123' "$file" && echo yes || echo no)"

added="$($ADAPTER --file "$file" add 'Ship the adapter')"
id="${added%% *}"
check 'add writes an open item with an id' yes "$(grep -q -- "- \[ \] Ship the adapter <!-- id:$id -->" "$file" && echo yes || echo no)"
check 'add records Codex in the action log' yes "$(grep -q '| codex | added |' "$file" && echo yes || echo no)"
check 'add refuses a duplicate item' 2 "$($ADAPTER --file "$file" add 'Ship the adapter' >/dev/null 2>&1; echo $?)"

prompt="$(hook UserPromptSubmit)"
check 'prompt hook injects the notes path' yes "$(case "$prompt" in *"Codex session notes: $file"*) echo yes ;; *) echo no ;; esac)"
check 'prompt hook injects the current open todo' yes "$(case "$prompt" in *'- [ ] Ship the adapter'*) echo yes ;; *) echo no ;; esac)"

$ADAPTER --file "$file" status "$id" in-progress >/dev/null
$ADAPTER --file "$file" status "$id" paused --reason 'waiting for review' >/dev/null
check 'status changes reuse the shared marker format' yes "$(grep -q -- "- \[/\] Ship the adapter <!-- paused:waiting for review --> <!-- id:$id -->" "$file" && echo yes || echo no)"
check 'each status change gets a Codex log row' 2 "$(grep -c '| codex | status |' "$file" | tr -d ' ')"
check 'existing bridge receives adds and status changes' 3 "$(grep -Ec '^\+ \[ \] Ship the adapter|Ship the adapter: (todo -> in-progress|in-progress -> paused) \(codex\)' "$H/notes/bridge-notify" | tr -d ' ')"
check 'prompt hook includes a paused reason' yes "$(hook UserPromptSubmit | grep -q 'paused: waiting for review' && echo yes || echo no)"
check 'compaction start restores todo context' yes "$(printf '{"session_id":"thread-123","cwd":"/work/sample","hook_event_name":"SessionStart","source":"compact"}\n' | "$ADAPTER" hook | grep -q 'paused: waiting for review' && echo yes || echo no)"

$ADAPTER --file "$file" objective 'Deliver Codex support' >/dev/null
$ADAPTER --file "$file" update 'Adapter tests pass' >/dev/null
check 'objective command uses the existing notes section' yes "$(grep -q '^Deliver Codex support$' "$file" && echo yes || echo no)"
check 'update command uses the existing update format' yes "$(grep -q '^\[UPDATE\] ' "$file" && echo yes || echo no)"
check 'objective and update changes are logged' 2 "$(grep -Ec '\| codex \| (objective|update) \|' "$file" | tr -d ' ')"

same="$(hook SessionStart >/dev/null; find "$H/notes" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
check 'repeated session start reuses the binding' 1 "$same"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
