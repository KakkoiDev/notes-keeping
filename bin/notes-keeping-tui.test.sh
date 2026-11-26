#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"
TMP_ROOT="${TMPDIR:-/tmp}"
H="$(mktemp -d "$TMP_ROOT/nk-tui.XXXXXX")"
export PYTHONDONTWRITEBYTECODE=1
export NOTES_KEEPING_DIR="$H/notes"
export NOTES_KEEPING_CODEX_STATE="$H/state"
export GIT_AUTHOR_NAME='notes-keeping test'
export GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
mkdir -p "$H/project"

SERVER="nk-tui-$$"
tmux -L "$SERVER" -f /dev/null new-session -d -s notes -c "$H/project" 'sleep 120'
tmux -L "$SERVER" split-window -d -t notes:0 -c "$H/project" 'sleep 120'
SOCKET="$(tmux -L "$SERVER" display-message -p '#{socket_path}')"
SESSION="$(tmux -L "$SERVER" display-message -p '#{session_id}')"
PANES=()
while IFS= read -r pane; do PANES+=("$pane"); done < <(tmux -L "$SERVER" list-panes -F '#{pane_id}')
trap '"$ROOT/bin/notes-keeping-tui" stop >/dev/null 2>&1 || true; tmux -L "$SERVER" kill-server >/dev/null 2>&1 || true' EXIT

hook() {
  local codex_id="$1" pane="$2"
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}\n' "$codex_id" "$H/project" |
    TMUX="$SOCKET,1,0" TMUX_PANE="$pane" "$ROOT/bin/notes-keeping-codex" hook >/dev/null
}

binding() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["path"])' "$NOTES_KEEPING_CODEX_STATE/sessions/$1.json"
}

event() {
  local pane="$1" event_id="$2" category="$3" text="$4" action="${5:-save}"
  TUI="$ROOT/bin/notes-keeping-tui" SOCKET="$SOCKET" PANE="$pane" SESSION="$SESSION" EVENT="$event_id" CATEGORY="$category" TEXT="$text" ACTION="$action" python3 - <<'PY'
import hashlib, importlib.machinery, os, time
module = importlib.machinery.SourceFileLoader('notes_keeping_tui', os.environ['TUI']).load_module()
body = os.environ['TEXT'].encode()
header = {
    'type': 'capture',
    'eventId': os.environ['EVENT'],
    'tmuxServer': os.environ['SOCKET'],
    'paneId': os.environ['PANE'],
    'tmuxSessionId': os.environ['SESSION'],
    'bufferName': 'test-buffer',
    'copiedAt': time.time(),
    'bodyHash': hashlib.sha256(body).hexdigest(),
}
module.request(header, body)
module.request({'type': 'claim', 'eventId': os.environ['EVENT']})
if os.environ['ACTION'] == 'cancel':
    module.request({'type': 'cancel', 'eventId': os.environ['EVENT']})
else:
    response, _ = module.request({'type': 'mutate', 'eventId': os.environ['EVENT'], 'kind': os.environ['CATEGORY']})
    if response.get('status') != 'result' or not response.get('ok'):
        raise SystemExit(response)
PY
}

hook codex001 "${PANES[0]}"
hook codex002 "${PANES[1]}"
NOTE_ONE="$(binding codex001)"
NOTE_TWO="$(binding codex002)"
"$ROOT/bin/notes-keeping-tui" start >/dev/null

TUI="$ROOT/bin/notes-keeping-tui" SOCKET="$SOCKET" PANE="${PANES[0]}" python3 - <<'PY'
import importlib.machinery, os
module = importlib.machinery.SourceFileLoader('notes_keeping_tui_panel_branch', os.environ['TUI']).load_module()
opened = []
module.open_workspace = lambda server, pane, session, cwd: opened.append((server, pane, session, cwd))
module.capture(os.environ['SOCKET'], os.environ['PANE'])
assert len(opened) == 1
assert opened[0][0:2] == (os.environ['SOCKET'], os.environ['PANE'])
preview = module.linked('See [docs](https://example.com/a) and https://example.com/b.')
assert preview.count('\x1b]8;;https://') == 2
assert 'https://example.com/b\x1b\\' in preview and '\x1b\\.' in preview
assert 'javascript:alert(1)' in module.linked('javascript:alert(1)')
assert module.VIEWS == ('Todos', 'Objectives', 'Updates', 'Important', 'Notes', 'Paste', 'Chat', 'Queue', 'History', 'Logs', 'Work')
assert module.NAVIGATION['1'] == 0 and module.NAVIGATION['5'] == 4
PY

TUI="$ROOT/bin/notes-keeping-tui" CWD="$H/project" python3 - <<'PY'
import importlib.machinery, os
module = importlib.machinery.SourceFileLoader('notes_keeping_tui_targets', os.environ['TUI']).load_module()
response, _ = module.request({'type': 'targets', 'cwd': os.environ['CWD']})
assert len(response['targets']) == 2
PY

event "${PANES[0]}" 11111111111111111111111111111111 add 'pane one α'
event "${PANES[1]}" 22222222222222222222222222222222 important 'pane two β'
event "${PANES[0]}" 55555555555555555555555555555555 update 'pane one update γ'
event "${PANES[1]}" 66666666666666666666666666666666 objective 'pane two objective δ'
event "${PANES[1]}" 77777777777777777777777777777777 objective 'pane two later objective ε'
grep -q 'pane one α' "$NOTE_ONE"
if grep -q 'pane one α' "$NOTE_TWO"; then exit 1; fi
grep -q '\[AI_AGENT\] pane two β' "$NOTE_TWO"
if grep -q 'pane two β' "$NOTE_ONE"; then exit 1; fi
grep -q '^pane one update γ$' "$NOTE_ONE"
if grep -q 'pane one update γ' "$NOTE_TWO"; then exit 1; fi
grep -q '^pane two objective δ$' "$NOTE_TWO"
grep -q '^pane two later objective ε$' "$NOTE_TWO"
[ "$(grep -c '^\[UPDATE\] ' "$NOTE_TWO")" -eq 1 ]
grep -q '| captain | added |' "$NOTE_ONE"
grep -q 'transport=tmux/codex event=11111111111111111111111111111111' "$NOTE_ONE"

TUI="$ROOT/bin/notes-keeping-tui" SOCKET="$SOCKET" PANE="${PANES[0]}" SESSION="$SESSION" python3 - <<'PY'
import importlib.machinery, json, os
module = importlib.machinery.SourceFileLoader('notes_keeping_tui_panel', os.environ['TUI']).load_module()
header = {'tmuxServer': os.environ['SOCKET'], 'paneId': os.environ['PANE'], 'tmuxSessionId': os.environ['SESSION']}
response, body = module.request({'type': 'workspace', **header})
workspace = json.loads(body)
items = workspace['todos']
item = next(one for one in items if one['text'] == 'pane one α')
assert response['status'] == 'workspace' and item['status'] == 'todo'
assert set(workspace) == {'todos', 'objectives', 'updates', 'important', 'chat', 'logs', 'history', 'revision'}
assert 'pane one update γ' in workspace['updates']
selector = f"id:{item['id']}"
changed, _ = module.request({'type': 'status', **header, 'selector': selector, 'todoStatus': 'in-progress'})
assert changed['status'] == 'result' and changed['saved']
_, body = module.request({'type': 'workspace', **header})
assert next(one for one in json.loads(body)['todos'] if one['id'] == item['id'])['status'] == 'in-progress'
saved, _ = module.request(
    {'type': 'direct-mutate', **header, 'eventId': '88888888888888888888888888888888', 'kind': 'important'},
    b'workspace important view',
)
assert saved['status'] == 'result' and saved['saved']
_, body = module.request({'type': 'workspace', **header})
assert 'workspace important view' in json.loads(body)['important']
# Lease timestamps are refresh evidence. Exact process, binding and generation
# still control access, including after a popup has already opened.
record_path = module.key_path('panes', header['tmuxServer'], header['paneId'])
original = module.checked_record(record_path)
aged = {**original, 'refreshedAt': '2000-01-01T00:00:00Z', 'leaseExpiresAt': '2000-01-01T00:10:00Z'}
module.atomic_json(record_path, aged)
opened, body = module.request({'type': 'workspace', **header})
current = json.loads(body)
for wrong in (
    {'panePid': 1},
    {'generation': 'wrong-generation'},
    {'tmuxSessionId': '$wrong'},
    {'codexSessionId': 'codex002'},
):
    module.atomic_json(record_path, {**aged, **wrong})
    try:
        module.request({'type': 'workspace', **header})
        raise AssertionError(wrong)
    except ValueError:
        pass
module.atomic_json(record_path, aged)
try:
    module.request({'type': 'workspace', **header, 'generation': 'replaced-while-open'})
    raise AssertionError('a popup must keep its original generation')
except ValueError:
    pass

source = next(item['name'] for item in current['history'] if 'codex002' in item['name'])
_, prior = module.request({'type': 'preview', **header, 'source': source})
assert 'pane two objective δ' in json.loads(prior)['objectives']
source_path = module.notes_dir() / source
saved_source = source_path.read_bytes()
try:
    module.request({'type': 'attach', **header, 'source': '../' + source})
    raise AssertionError('outside sources must be rejected')
except ValueError:
    pass
queue, _ = module.request({'type': 'queue-read', **header})
pairs = [{'agent': 'queued cited text', 'user': 'queued reply'}]
module.request({'type': 'queue-write', **header, 'revision': queue['revision']}, json.dumps(pairs).encode())
reopen, queue_body = module.request({'type': 'queue-read', **header})
assert json.loads(queue_body) == pairs
module.request({'type': 'queue-send', **header, 'revision': reopen['revision']})
_, body = module.request({'type': 'workspace', **header})
assert '[AI_AGENT] queued cited text' in json.loads(body)['chat']
assert source_path.read_bytes() == saved_source

PY

TUI="$ROOT/bin/notes-keeping-tui" ADAPTER="$ROOT/bin/notes-keeping-codex" CWD="$H/project" SOCKET="$SOCKET" PANE="${PANES[0]}" SESSION="$SESSION" python3 - <<'PY'
import hashlib, importlib.machinery, json, os, pty, select, shlex, subprocess, time
from pathlib import Path
module = importlib.machinery.SourceFileLoader('notes_keeping_tui_navigation', os.environ['TUI']).load_module()

def run(args, keys):
    master, slave = pty.openpty()
    process = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)
    output = bytearray()
    try:
        sent = False
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    output.extend(os.read(master, 65536))
                except OSError:
                    break
                if not sent and b'[q/Esc] Close' in output:
                    os.write(master, keys)
                    sent = True
            if process.poll() is not None:
                break
        assert sent and process.wait(timeout=1) == 0, output.decode(errors='replace')
    except subprocess.TimeoutExpired as error:
        raise AssertionError(output.decode(errors='replace')) from error
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.wait()
    return output.decode(errors='replace')

header = {'tmuxServer': os.environ['SOCKET'], 'paneId': os.environ['PANE'], 'tmuxSessionId': os.environ['SESSION']}
ordinary = run([os.environ['TUI'], 'workspace-popup', os.environ['SOCKET'], os.environ['PANE'], os.environ['SESSION']], b'234567890W1q')
for expected in ('pane one α', 'No objectives yet.', 'pane one update γ', 'workspace important view', 'Draft (in memory only', 'Paste scratch', 'queued cited text', 'No replies queued.', 'pane two objective δ', 'No Firstmate bridge'):
    assert expected in ordinary, (expected, ordinary)

event_id = '99999999999999999999999999999999'
body = 'prefilled Notes navigation ζ'.encode()
module.request({'type': 'capture', 'eventId': event_id, 'bufferName': 'test-buffer', 'copiedAt': time.time(), 'bodyHash': hashlib.sha256(body).hexdigest(), **header}, body)
selected = run([os.environ['TUI'], 'popup', event_id], b'1234qy')
assert selected.index('prefilled Notes navigation ζ') < selected.index('pane one α')
assert 'pane one update γ' in selected and 'workspace important view' in selected
snapshot = next(item for item in json.loads(module.request({'type': 'workspace', **header})[1])['history'] if 'codex002' in item['name'])
source = module.notes_dir() / snapshot['name']
original = source.read_bytes()
current = module.notes_dir() / module.request({'type': 'workspace', **header})[0]['target']
before = current.read_bytes()
older = module.notes_dir() / '2000-01-01-00-00-archive-feed0001.md'
older_text = '# Objectives\n\nEarlier objective\n\n# Important\n\nOlder preview detail\n'
older.write_text(older_text)
popup = [os.environ['TUI'], 'workspace-popup', os.environ['SOCKET'], os.environ['PANE'], os.environ['SESSION']]
history = run(popup, b'9\x1b[B\r\x1b[Ab\x1b[A\rb291\x1bOBq')
assert history.index('Older preview detail') < history.index('pane two β') < history.index('No objectives yet.')
assert 'pane one α' in history[history.index('No objectives yet.'):]
assert current.read_bytes() == before and source.read_bytes() == original and older.read_text() == older_text
run([os.environ['TUI'], 'workspace-popup', os.environ['SOCKET'], os.environ['PANE'], os.environ['SESSION']], b'9\ranq')
assert current.read_bytes() == before
run([os.environ['TUI'], 'workspace-popup', os.environ['SOCKET'], os.environ['PANE'], os.environ['SESSION']], b'9\rayq')
assert 'Continuation of: ' + source.name in current.read_text()
assert '| captain | attach |' in current.read_text()
assert source.read_bytes() == original

filtered = run(popup, b'm291q').split('\x1b[2J\x1b[H')
todo_frames = [frame for frame in filtered if 'Filter:' in frame]
assert 'pane one α' in todo_frames[0]
assert 'No todos match this filter.' in todo_frames[-1], todo_frames[-1]
assert 'No todos in this session.' not in todo_frames[-1]
assert 'pane one α' not in todo_frames[-1]

fixture_pane = subprocess.check_output(
    ['tmux', '-S', header['tmuxServer'], 'split-window', '-d', '-P', '-F', '#{pane_id}', '-t', header['paneId'],
     '-c', os.environ['CWD'], 'sleep 120'],
    text=True,
).strip()
fixture_header = {**header, 'paneId': fixture_pane}
fixture_popup = [os.environ['TUI'], 'workspace-popup', header['tmuxServer'], fixture_pane, header['tmuxSessionId']]

def bind_fixture(session_id):
    subprocess.run(
        [os.environ['ADAPTER'], 'hook'],
        input=json.dumps({'session_id': session_id, 'cwd': os.environ['CWD'], 'hook_event_name': 'SessionStart', 'source': 'startup'}),
        text=True, check=True,
        env={**os.environ, 'TMUX': header['tmuxServer'] + ',1,0', 'TMUX_PANE': fixture_pane},
    )

status_rows = {
    'todo': '[ ] Fixture todo item',
    'in-progress': '[~] Fixture active item',
    'done': '[x] Fixture done item',
    'declined': '[-] Fixture declined item',
    'blocked': '[!] Fixture blocked item',
    'paused': '[/] Fixture paused item',
}
status_note = module.notes_dir() / '2099-01-01-00-00-status-cafe0001.md'
status_note.write_text('# Objectives\n\nSessions: cafe0001-fixture\n\n# Todo\n\n' +
                       '\n'.join('- ' + row for row in status_rows.values()) + '\n')
source_before = status_note.read_bytes()
bind_fixture('cafe0001-fixture')
populated = run(fixture_popup, b'm291q').split('\x1b[2J\x1b[H')
todo_frames = [frame for frame in populated if 'Filter:' in frame]
assert all(row in todo_frames[0] for row in status_rows.values())
for status, row in status_rows.items():
    assert (row in todo_frames[-1]) == (status in ('todo', 'blocked')), todo_frames[-1]

bind_fixture('cafe0002-empty')
empty_response, empty_body = module.request({'type': 'workspace', **fixture_header})
assert json.loads(empty_body)['todos'] == []
empty_note = module.notes_dir() / empty_response['target']
empty_before = empty_note.read_bytes()
cancelled = run(fixture_popup, b'9\ranb1q')
assert 'No todos in this session.' in cancelled
assert '[9/H] History' in cancelled and '[a] Attach' in cancelled
assert 'Attach ' + status_note.name in cancelled and status_rows['todo'] in cancelled
assert empty_note.read_bytes() == empty_before

attached = run(fixture_popup, b'9\ray1q').split('\x1b[2J\x1b[H')[-1]
for status, row in status_rows.items():
    assert (row in attached) == (status not in ('done', 'declined')), attached
assert 'Continuation of: ' + status_note.name in empty_note.read_text()
assert status_note.read_bytes() == source_before

large_history = module.notes_dir() / '2000-01-01-00-00-archive-feed0002.md'
large_chat = ('Long archived chat line.\n' * 50_000) + 'End of archived chat.'
large_history.write_text('# Objectives\n\n# Chat\n\n' + large_chat + '\n')
_, preview = module.request({'type': 'preview', **fixture_header, 'source': large_history.name})
assert json.loads(preview)['chat'] == large_chat

_, current_body = module.request({'type': 'workspace', **header})
linked_id = next(item['id'] for item in json.loads(current_body)['todos'] if item['text'] == 'pane one α')
bridge = Path(os.environ['CWD']) / 'config/notes-keeping-bridge'
bridge.parent.mkdir()
fleet = {'rows': [{'task': 'linked-fixture', 'title': 'Linked fixture call', 'flag': '!', 'word': 'call', 'todos': [linked_id]}]}
bridge.write_text("#!/bin/sh\nprintf '%s\\n' " + shlex.quote(json.dumps(fleet)) + '\n')
bridge.chmod(0o700)
call_frames = run(popup, b'mq').split('\x1b[2J\x1b[H')
todo_frames = [frame for frame in call_frames if 'Filter:' in frame]
assert 'Open calls: 1' in todo_frames[0] and 'Linked fixture call' in todo_frames[0]
assert 'Open calls:' not in todo_frames[-1]

PY

BEFORE="$(shasum -a 256 "$NOTE_ONE")"
event "${PANES[0]}" 33333333333333333333333333333333 update 'must not save' cancel
AFTER="$(shasum -a 256 "$NOTE_ONE")"
[ "$BEFORE" = "$AFTER" ]

REQUEST='{"version":1,"kind":"update","text":"replay once","actor":"captain","transport":"tmux/codex","eventId":"44444444444444444444444444444444","at":1700000000000}'
printf '%s\n' "$REQUEST" | "$ROOT/bin/notes-keeping-engine" --file "$NOTE_ONE" >/dev/null
printf '%s\n' "$REQUEST" | "$ROOT/bin/notes-keeping-engine" --file "$NOTE_ONE" >/dev/null
[ "$(grep -c '^replay once$' "$NOTE_ONE")" -eq 1 ]

python3 - "$NOTES_KEEPING_CODEX_STATE/runtime" <<'PYTEST'
import pathlib, stat, sys
runtime = pathlib.Path(sys.argv[1])
assert stat.S_IMODE(runtime.stat().st_mode) == 0o700
assert stat.S_IMODE((runtime / "tui.sock").stat().st_mode) == 0o600
PYTEST
[ "$(git -C "$NOTES_KEEPING_DIR" rev-list --count HEAD)" -ge 4 ]

printf 'ok   two panes map to distinct notes\n'
printf 'ok   cancel makes no write\n'
printf 'ok   event replay writes once\n'
printf 'ok   runtime transport is owner-only\n'
printf 'ok   no-selection opens full workspace on Todos and same-cwd targets stay explicit\n'
printf 'ok   all workspace views, direct category save, Todo status, and OSC 8 links work\n'
printf 'ok   History arrows, preview, return, and view refresh preserve the workspace mapping\n'
printf 'ok   all six Todo statuses, filter persistence, and empty-session History attach work\n'
printf 'ok   large History previews survive the mutation lock and IPC frame\n'
printf 'ok   visible linked calls are counted and filtered calls are hidden\n'
