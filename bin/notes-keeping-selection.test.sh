#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/nk-select.XXXXXX")"
export NOTES_KEEPING_DIR="$fixture/notes"
export NOTES_KEEPING_CODEX_STATE="$fixture/state"
export GIT_AUTHOR_NAME='notes-keeping test'
export GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export PYTHONDONTWRITEBYTECODE=1
export TEST_ROOT="$ROOT"
export TEST_FIXTURE="$fixture"
export TEST_TMUX="nk-select-$$"
trap '"$ROOT/bin/notes-keeping" stop >/dev/null 2>&1 || true; tmux -L "$TEST_TMUX" kill-server >/dev/null 2>&1 || true' EXIT

python3 - <<'PY'
import fcntl
import importlib.machinery
import json
import os
import pty
import re
import select
import shlex
import struct
import subprocess
import termios
import time
from pathlib import Path

root = Path(os.environ['TEST_ROOT'])
fixture = Path(os.environ['TEST_FIXTURE'])
cli = root / 'bin/notes-keeping'
adapter = root / 'bin/notes-keeping-codex'
module = importlib.machinery.SourceFileLoader('selection_tui', str(root / 'bin/notes-keeping-tui')).load_module()
server_cmd = ['tmux', '-L', os.environ['TEST_TMUX'], '-f', '/dev/null']
env = {**os.environ, 'TERM': 'xterm-256color'}
env.pop('TMUX', None)
env.pop('TMUX_PANE', None)

def tmux(*args):
    return subprocess.check_output(server_cmd + list(args), env=env, text=True).strip()

selected = 'selected fixture URI https://example.org/proof'
line = 'before ' + selected + ' after'
source_command = 'printf "%s\\n" ' + shlex.quote(line) + '; exec sleep 120'
pane = tmux('new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'notes', '-c', str(fixture), source_command)
server = tmux('display-message', '-p', '#{socket_path}')
session = tmux('display-message', '-p', '#{session_id}')
target = module.mapping_header(server, pane, session)
tmux('set-option', '-g', 'prefix', 'C-a')
tmux('set-option', '-g', 'mode-keys', 'vi')
copy_log = fixture / 'copy-command.txt'
tmux('set-option', '-s', 'copy-command', 'cat > ' + shlex.quote(str(copy_log)))
config = fixture / 'owned.conf'
config.write_bytes(subprocess.check_output([cli, 'tmux', 'print']))
tmux('source-file', str(config))
subprocess.run(
    [adapter, 'hook'], input=json.dumps({'session_id': 'selected01-fixture', 'cwd': str(fixture),
                                        'hook_event_name': 'SessionStart', 'source': 'startup'}),
    check=True, text=True, env={**env, 'TMUX': server + ',1,0', 'TMUX_PANE': pane},
)
opened, _ = module.workspace(target)
note = module.notes_dir() / opened['target']
original = note.read_bytes()
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
client = subprocess.Popen(server_cmd + ['attach-session', '-t', 'notes'], env=env,
                          stdin=slave, stdout=slave, stderr=slave)
os.close(slave)

def expect(marker, seconds=5):
    out = bytearray()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            out.extend(os.read(master, 65536))
            if marker in out:
                return bytes(out)
    raise AssertionError(f'Missing {marker!r}; terminal output {out[-1800:]!r}')

def keys(data):
    os.write(master, data)

def until_format(fmt, expected):
    for _ in range(80):
        if tmux('display-message', '-pt', pane, fmt) == expected:
            return
        time.sleep(0.05)
    raise AssertionError(f'{fmt} did not become {expected}')

def select_line_part():
    keys(b'\x01[')
    until_format('#{pane_in_mode}', '1')
    for action in ('history-top', 'start-of-line'):
        tmux('send-keys', '-t', pane, '-X', action)
    tmux('send-keys', '-t', pane, '-X', '-N', str(len('before ')), 'cursor-right')
    tmux('send-keys', '-t', pane, '-X', 'begin-selection')
    tmux('send-keys', '-t', pane, '-X', '-N', str(len(selected) - 1), 'cursor-right')
    until_format('#{selection_present}', '1')

def close_draft():
    keys(b'q')
    expect(b'Discard')
    keys(b'y')
    until_format('#{pane_in_mode}', '0')
    for _ in range(80):
        commands = subprocess.check_output(['ps', '-axo', 'command='], text=True)
        if f'{root}/bin/notes-keeping-tui popup ' not in commands:
            return
        time.sleep(0.05)
    raise AssertionError('Notes draft popup did not close')

try:
    expect(line.encode())
    select_line_part()
    keys(b'\x01N')
    direct = expect(b'Draft (in memory only')
    assert f'Send selection ({len(selected.encode())} bytes)'.encode() in direct, re.findall(rb'Send selection \([^)]*\)', direct)
    if b'selected fixture URI' not in direct.split(b'Draft (in memory only', 1)[1]:
        expect(b'selected fixture URI')
    assert not copy_log.exists(), 'direct capture ran the normal copy command'
    assert not tmux('list-buffers', '-F', '#{buffer_name}'), 'direct capture added a paste buffer'

    keys(b'r')
    composer = expect(b'Your reply')
    assert b'Reply to selected text' in composer and selected.encode() in composer
    keys(b'Unsaved reply\x1b')
    expect(b'Abandon these draft edits')
    keys(b'y')
    expect(b'Draft (in memory only')
    _, queue = module.request({'type': 'queue-read', **target})
    assert json.loads(queue) == []

    keys(b'r')
    expect(b'Your reply')
    keys(b'Synthetic reply\x13')
    expect(b'Reply queued.')
    keys(b'8')
    expect(b'Reply: Synthetic reply')
    _, queue = module.request({'type': 'queue-read', **target})
    assert json.loads(queue) == [{'agent': selected, 'user': 'Synthetic reply'}]
    close_draft()

    select_line_part()
    keys(b'y')
    until_format('#{pane_in_mode}', '0')
    stamp = module.key_path('stamps', server, pane)
    for _ in range(80):
        if stamp.exists() and copy_log.exists():
            break
        time.sleep(0.05)
    assert stamp.exists() and copy_log.read_text() == selected
    keys(b'\x01N')
    copied = expect(b'Draft (in memory only')
    if b'selected fixture URI' not in copied.split(b'Draft (in memory only', 1)[1]:
        expect(b'selected fixture URI')
    close_draft()

    subprocess.run([cli, 'stop'], check=True, stdout=subprocess.DEVNULL)
    keys(b'\x01N')
    expect(b'No todos in this session.')
    keys(b'r')
    expect(b'Open Notes with a marked tmux selection')
    keys(b'5')
    expect(b'Empty draft.')
    keys(b'r')
    expect(b'Open Notes with a marked tmux selection')
    keys(b'e')
    expect(b'Ctrl+S')
    keys(b'External terminal paste fixture\x13')
    pasted = expect(b'Draft (in memory only')
    if b'External terminal paste fixture' not in pasted:
        expect(b'External terminal paste fixture')
    close_draft()
    assert note.read_bytes() == original
    print('ok   real tmux capture, quoted reply, queue and cancel, copy preservation, empty-draft guidance, and terminal paste without note writes')
finally:
    os.close(master)
    if client.poll() is None:
        client.terminate()
        try:
            client.wait(timeout=2)
        except subprocess.TimeoutExpired:
            client.kill()
            client.wait()
PY
