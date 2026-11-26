#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d /tmp/nk-cli.XXXXXX)"
release="$scratch/published"
prefix="$scratch/local"
cli="$prefix/bin/notes-keeping"
export NOTES_KEEPING_RELEASE_SOURCE="$release"
export NOTES_KEEPING_DIR="$scratch/notes"
export PLUGIN_DATA="$scratch/ignored-plugin-cache"
export GIT_AUTHOR_NAME='notes-keeping test'
export GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
trap '"$cli" stop >/dev/null 2>&1 || true' EXIT

git init -qb main "$release"
for item in bin hooks types .agents .claude-plugin .codex-plugin README.md LICENSE; do
  cp -R "$ROOT/$item" "$release/"
done
git -C "$release" add .
git -C "$release" commit -qm 'publish initial version'
first="$(git -C "$release" rev-parse --short=12 HEAD)"
"$ROOT/bin/install-cli" --prefix "$prefix"
export PATH="$prefix/bin:$PATH"
[ "$(command -v notes-keeping)" = "$cli" ]
[[ "$(notes-keeping version)" == *"+$first" ]]
notes-keeping update | grep -F "is up to date ($first)"

for _ in 1 2 3 4; do
  notes-keeping start --quiet &
done
wait
runtime="$NOTES_KEEPING_DIR/.codex/runtime"
before="$(cat "$runtime/service.pid")"
notes-keeping start --quiet
[ "$(cat "$runtime/service.pid")" = "$before" ]
[ ! -e "$PLUGIN_DATA" ]

note="$NOTES_KEEPING_DIR/2026-11-26-12-00-test-abcd1234.md"
printf '# Objectives\n\nSessions: abcdef\n\n## Updates\n\n# Important\n\n# Chat\n' > "$note"
notes-keeping --file "$note" add 'keep the installed notes' >/dev/null
cp "$note" "$scratch/saved-note"
printf 'user config\n' > "$scratch/config"
cp "$scratch/config" "$scratch/saved-config"
printf '\nPublished update.\n' >> "$release/README.md"
git -C "$release" add README.md
git -C "$release" commit -qm 'publish next version'
second="$(git -C "$release" rev-parse --short=12 HEAD)"
notes-keeping update
[[ "$(notes-keeping version)" == *"+$second" ]]
[ "$(cat "$runtime/service.pid")" = "$before" ]
cmp "$note" "$scratch/saved-note"
cmp "$scratch/config" "$scratch/saved-config"

if NOTES_KEEPING_RELEASE_SOURCE="$scratch/unavailable" notes-keeping update >/dev/null 2>&1; then
  echo 'unexpected successful update from missing source' >&2
  exit 1
fi
[[ "$(notes-keeping version)" == *"+$second" ]]
cmp "$note" "$scratch/saved-note"
cmp "$scratch/config" "$scratch/saved-config"
notes-keeping update | grep -F "is up to date ($second)"
printf 'ok   PATH install, shared startup, published update, up-to-date retry, failed update preservation\n'
