# Codex tmux notes popup design

## Status

This document records the captain-approved behavior and the implemented v1 contract.
It defines observable behavior, component boundaries, protocols, state transitions, safety rules, and verification.

## Outcome

Pressing `C-a N` in a mapped Codex tmux pane always opens one centered five-view workspace for that exact pane, session, and note.
A fresh explicit tmux selection starts on Notes with the selection prefilled; no fresh selection starts on Todos with an empty draft.
Todos, Objectives, Updates, Important, and Notes remain navigable without closing. Durable writes require an explicit category or status action.
Unsaved draft, cancel, invalid input, missing infrastructure, stale mapping, and ambiguous targets never mutate a note.

## Problem

Codex has no selected-text hook and its lifecycle hook payload does not identify terminal selection boundaries.
The captain needs an explicit action that moves exact selected bytes from one tmux pane into the note bound to that same Codex session.
The current Codex adapter and Claude pane also write notes through different orchestration paths, so adding a third independent Markdown writer would create lost-update, attribution, and format-drift risks.
V1 therefore uses tmux only for explicit capture and one dependency-free notes mutation engine for durable writes.

## Non-negotiable ground rule

No selected text enters notes-keeping until the captain explicitly presses `C-a N`.
The implementation must not scrape a pane, read scrollback, poll Codex transcripts, poll terminal selection, or automatically read the macOS clipboard.

## Approved v1 decisions

The following values are requirements rather than open product choices.

1. The capture binding is `C-a N`; workspace navigation is `1`-`5`, Shift+T/O/U/I/N, or Tab; Notes category keys are `t`, `u`, `o`, and `i`.
2. `t`, `u`, `o`, and `i` commit the current Notes draft immediately, while editing and navigation remain in memory.
3. The binding always uses a centered tmux popup over the source Codex pane. Save stays in the workspace; close returns to the pane.
4. A copied selection is fresh for 30 seconds and is limited to 64 KiB after byte-preserving capture and before decoding.
5. Outer whitespace is trimmed, while internal newlines and valid UTF-8 are preserved.
6. Objective sets an empty objective section and otherwise appends an update.
7. Important writes `[AI_AGENT]` attribution.
8. The action-log actor is `captain`, and audit metadata records transport `tmux/codex`.
9. No durable capture queue exists, and a missing TUI service fails visibly.
10. `p` is a manual clipboard-to-unsaved-preview fallback only.
11. Direct capture and every workspace view require an exact pane registration, while same-real-cwd matching is allowed only in an explicit picker.
12. Drafts stay in memory, prompt before exit when unsaved, and have no crash recovery in v1.
13. Existing tmux `pbcopy` behavior stays unchanged.
14. Missing or stale selection state focuses Todos instead of becoming an error.
15. HTTP/HTTPS and Markdown links use OSC 8 terminal hyperlinks where supported; v1 does not claim Codex transcript anchors or host-native click handling.

## Scope

V1 adds a standalone notes TUI service and popup client, a tmux sender and bindings, pane registration in Codex hooks, and one mutation boundary shared by the TUI and Codex adapter.
V1 preserves the existing note format, local Git history, Firstmate bridge behavior, and Codex per-turn context.
V1 does not launch or supervise Codex, Claude, Firstmate, or tmux.
V1 does not add a durable inbox, crash-recovered drafts, transcript anchors, app-server integration, or automatic capture.
V1 does not change the terminal's existing `pbcopy` exposure.

## Alternatives considered

### On-demand popup with no service

The popup could read the tmux buffer and invoke the engine directly.
This removes a daemon but makes capture ownership, claim-once state, acknowledgment recovery, and draft lifetime depend on popup process arguments or temporary files.
It is rejected because the approved flow requires no selected text in argv, environment, or durable capture files.

### Minimal stateless forwarding daemon

A daemon could authenticate and immediately forward a selection to a popup.
This reduces state but cannot enforce one claim, expiry, cancel, or retry by event ID after the sender has handed off the bytes.
It is rejected because visible non-destructive failure and replay safety need event state.

### Stateful owner-only service

The selected design keeps captures and drafts in memory, authenticates peer UID, and delegates every durable mutation to the shared engine.
The cost is lifecycle management and a local socket, bounded by explicit start, stop, install, and rollback commands.

## Risks, limits, and mitigations

| Risk or limit | Consequence | Mitigation |
| --- | --- | --- |
| tmux custom copy binding | Installer could break copy behavior | Probe exact supported binding shapes and fail without editing on any mismatch |
| Service exits with a draft | Unsaved draft disappears | State this v1 limit, never imply recovery, and require discard confirmation while service lives |
| Pane reuse | Selection could target an old session | Bind socket, pane, tmux session, pane process, generation, cwd, renewable lease, session binding, and note `Sessions:` line |
| ACK loss or service restart | Caller may retry a completed mutation | Persist request hash and result receipt; recover from full event marker atomically written with note |
| Concurrent Claude, Codex, or popup write | Newer content could be lost | Serialize semantic operations under repository lock; compare-and-swap trusted full-document replacements |
| Dirty notes Git repository | Unrelated notes could enter commit | Stage and commit only the intended note path and return saved-with-warning on Git failure |
| macOS/Linux credential API differences | Owner check could silently weaken | Use `getpeereid` on macOS and `SO_PEERCRED` on Linux; unsupported platforms fail service startup |
| Clipboard fallback | Global clipboard has no pane provenance | Read only after explicit `p`, keep preview unsaved, and require explicit target and save |

## Existing implementation constraints

`hooks/codex-hooks.json` currently registers only `SessionStart` and `UserPromptSubmit`.
`bin/notes-keeping-codex` binds a Codex session to a note using a session JSON file, but that file currently contains only the note path.
The adapter currently performs unlocked direct writes and ignores Git command failures.
The adapter supports `show`, `status`, `add`, `objective`, and `update`, but not `important` or drafts.
Its current `objective` command always replaces objectives, which differs from the approved empty-then-update rule.
`hooks/register.tsx` already implements the approved objective rule inside its process.
`hooks/notes.ts` already escapes inserted section headings and provides `addImportant` with `[AI_AGENT]` support.
`hooks/actors.ts` already defines `captain` as the human actor.
The repository has no tracked `package.json` or lockfile, so implementation must either remain dependency-free under the existing Bun runtime or deliberately add and document a package boundary.

## User experience

### Service start

`notes-keeping-tui serve` starts one per-user background service for popup state and mutations.
`notes-keeping-tui start` starts it in the background, and `notes-keeping-tui stop` stops only that owned service.
The installer may arrange startup, but startup failure must remain visible and must not be hidden by a fallback transport.
The service creates no selected-text files.
The standalone TUI may also connect to this service for manual browsing and same-real-cwd selection.

### Copy and capture

1. The captain selects text in a Codex pane by mouse or normal tmux copy mode.
2. The normal tmux copy action still writes the tmux paste buffer and still invokes the existing `pbcopy` command.
3. After tmux completes that explicit copy, a small helper stamps only tmux server identity, source pane ID, exact buffer name, and monotonic and wall-clock copy times.
4. The stamp never contains selection bytes, a note path, or a Codex session ID.
5. The captain stays in the source pane and presses `C-a N`; if no fresh stamp exists, the exact mapped workspace opens focused on Todos.
6. The sender verifies the stamp belongs to the current pane and is no older than 30 seconds.
7. The sender reads only the stamped tmux buffer with `save-buffer -b <exact-name> -`.
8. The sender validates size, NUL absence, and UTF-8 before sending one bounded frame to the local service.
9. The service validates the source registration, stores the snapshot in memory under a random event ID, and acknowledges acceptance.
10. Only after acceptance does the sender open a centered popup targeted at the source pane.
11. A fresh capture uses the popup title `Send selection (<N> bytes)` and the workspace header shows all views, short Codex session ID, note filename, and source pane.

The popup preview must render control-looking text as inert text.
Selection content must never become shell syntax, a tmux format, an argv element, an environment value, a title, or a log field.
Selection-derived text appears only in the inert popup body.
HTTP/HTTPS and Markdown links in that inert body are blue, underlined OSC 8 hyperlinks. Whether and how a click opens them is controlled by tmux and the terminal.

### Five-view workspace

The service resolves the exact pane mapping and asks the shared engine for structured Todos, Objectives, Updates, and Important data; the TUI never parses Markdown.
The fifth Notes view owns an in-memory draft. Fresh capture prefills it and focuses Notes; an ordinary open leaves it empty and focuses Todos.
`1`-`5`, Shift+T/O/U/I/N, and Tab switch views without closing or losing the draft.
Todos shows all statuses, supports `j`/`k` and arrows, and cycles the selected item with Enter through the existing status semantics.
Objectives, Updates, and Important are readable views of their shared-engine sections. Notes supports edit, explicit category save, and discard confirmation.
`q` or `Esc` closes without a write unless a category or status action already succeeded. A dirty unsaved Notes draft requires discard confirmation.
All status and category writes use actor `captain`, transport `tmux/codex`, the shared lock, action log, local Git commit, and bridge notification.
URLs and Markdown links in every view use the same terminal-supported OSC 8 rendering.

### Category actions

`t` adds one open todo through the shared todo parser, allocates its normal ID, appends a `captain` action-log row, commits locally, and sends the existing Firstmate bridge notification.
An equivalent existing todo produces no write and returns its existing label and ID.

`u` appends one timestamped `[UPDATE]` block, appends a `captain` action-log row, and commits locally.

`o` sets objectives only when the current objective body is empty.
When objectives are not empty, `o` appends a timestamped `[UPDATE]` block instead.
The acknowledgment says either `Objectives set` or `Added as update`.

`i` appends `[AI_AGENT] <text>` under `# Important`, appends a `captain` action-log row, and commits locally.

`e` in Notes edits the in-memory draft, and Ctrl+S keeps the edit in the workspace without a durable write.
The draft requires one of the four category keys to save.
Closing a dirty unsaved draft requires explicit discard confirmation.

`q` or `Esc` closes the popup and writes nothing unless the captain already made an explicit save or status action.

Successful direct actions keep the popup open, switch to the saved category view, and display `Saved: <result>` only after a successful mutation acknowledgment.
Warnings are appended to that acknowledgment when Git commit or bridge notification fails after the note was saved.

### Manual clipboard fallback

Inside the TUI, `p` explicitly runs `pbpaste` once and places its output into an unsaved editable preview.
The preview has no Codex provenance and cannot use a direct category action until the captain confirms a target and presses Enter.
The service never invokes `pbpaste` during startup, refresh, direct capture, or retry.

## Component design

### 1. Codex hook adapter

`bin/notes-keeping-codex hook` remains the entry point for Codex lifecycle hooks.
After normal session-to-note binding, it registers the current tmux source when both `TMUX` and `TMUX_PANE` are present.
Absence of tmux never breaks normal notes hooks, but it leaves direct capture unavailable.

On a non-compaction `SessionStart`, registration receives a fresh random generation.
On `UserPromptSubmit` and compaction `SessionStart`, registration refreshes liveness without changing generation and renews a ten-minute lease.
A configured `SessionEnd` removes a record only when session ID and generation still match, so an old end event cannot remove a replacement session in a reused pane.
An already-running Codex session can be mapped once with `notes-keeping-codex register-current <codex-session-id>`; the command resolves the existing note by its `Sessions:` entry and accepts no note path.

Registration is a separate operation from selection capture and carries no selected text.

### 2. Pane registry

The registry lives under the configured Codex state directory, not beside arbitrary projects.
Its directory is owner-only `0700`, and records are owner-only `0600` with atomic replacement.

The canonical key is `sha256(tmuxServerIdentity + NUL + paneId)`.
The record is:

```json
{
  "version": 1,
  "tmuxServer": "/private/tmp/tmux-501/default",
  "paneId": "%17",
  "tmuxSessionId": "$3",
  "codexSessionId": "019abc...",
  "notePath": "/Users/me/.notes-keeping/2026-11-20-project-019abc12.md",
  "realCwd": "/Users/me/Code/project",
  "generation": "128-bit-random-value",
  "panePid": 12345,
  "registeredAt": "2026-11-20T09:00:00Z",
  "refreshedAt": "2026-11-20T09:10:00Z",
  "leaseExpiresAt": "2026-11-20T09:20:00Z"
}
```

`tmuxServer` is derived from the server endpoint in `TMUX`, canonicalized without the client PID and index fields.
`paneId` comes from `TMUX_PANE`, and `tmuxSessionId` is resolved structurally from tmux for diagnostics and reuse checks.
`notePath` comes only from `ensureSession`, never from the sender or popup.
`realCwd` and the configured notes root use filesystem real paths.

The service accepts direct capture only if all of these checks pass at the same instant:

- The registry file is owned by the current UID and is not group-writable or world-writable.
- The requested tmux server and pane exactly match the registry key and record.
- The pane currently exists on that server and still belongs to the recorded tmux session.
- The pane process identity still matches and the renewable lease has not expired.
- The pane's current real cwd equals the registered real cwd.
- The record generation is current for that pane.
- The Codex session-to-note binding still names the same note.
- Parsing the note shows the recorded Codex session ID in `Sessions:`.
- The note exists as a regular file.
- The note real path is inside the configured notes root and no path component escapes through a symlink.

No failed check may fall back to cwd, newest note, active TUI tab, another pane, or a sender-provided path.

### 3. Copy stamp helper

The tmux configuration extends both mouse and keyboard copy completion paths.
It uses tmux's normal copy command with a distinct buffer-name prefix, preserves the current `copy-command`, and then records the exact generated buffer name.
The helper is invoked only after explicit copy completion.
It never reads the buffer or stdin and never receives selection text.

One latest stamp exists per tmux server and pane.
Stamp files live in the owner-only runtime directory, contain metadata only, and are atomically replaced.
The sender deletes or invalidates a stamp after one accepted capture.
A stale or wrong-pane stamp remains non-authoritative even if its tmux buffer still exists.

### 4. Capture sender

The `C-a N` binding invokes a sender with source tmux formats supplied as fixed metadata.
The sender accepts no note path and no selection text in argv.
It resolves the stamp, reads the one named buffer to stdin or an in-memory byte array, validates it, assigns a cryptographically random 128-bit event ID, and sends a bounded frame.

The sender opens the popup only after the service replies `accepted` for that event ID.
If the service is missing, it displays `Notes TUI not running; start it and retry C-a N` in the source pane.
If popup creation itself fails after acceptance, the service discards that unclaimed event after its short memory TTL and the sender displays the tmux error.

### 5. TUI service and popup client

One per-user service owns the Unix socket, capture snapshots, draft state, event deduplication, and direct mutation requests.
The dependency-free Python service authenticates macOS peers with libc `getpeereid` through `ctypes` and Linux peers with `SO_PEERCRED`.
The popup is a short-lived client that claims exactly one event ID.
Only one popup may claim an event, and a second claim receives `already claimed` without content.

Snapshots and drafts are memory-only.
Unclaimed direct snapshots expire after 60 seconds.
Claimed direct snapshots are destroyed on mutation success, explicit cancel, confirmed discard, popup loss, or service exit.
Content-free receipts remain on disk under the owner-only state directory so service restart cannot duplicate a saved mutation.

The popup sends category intent and event ID, not note path or replacement content.
Edited drafts send their final bounded content only on explicit save.

### 6. Shared mutation boundary

All TUI writes and all `bin/notes-keeping-codex` writes pass through `bin/notes-keeping-engine` and pure semantic operations in `hooks/mutation.ts`.
Claude's native pane keeps its current UI and sends full-document replacements through the same engine with compare-and-swap revision validation.
The API accepts a trusted note binding, event ID, actor, transport, operation kind, and bounded text.
The public mutation shape never accepts an arbitrary output path from an untrusted sender.

Under one crash-released cross-process coordinator covering note writes and the shared Git repository, the mutation boundary performs these steps:

1. Resolve and validate the trusted note path again.
2. Check the content-free receipt for the full event ID, request hash, and target identity.
3. Re-read current bytes under the lock.
4. For a semantic operation, apply it once to those latest bytes without revision rebasing.
5. For a trusted full-document replacement only, compare the supplied revision and refuse a mismatch without writing.
6. Append a log row with actor `captain` and metadata `transport=tmux/codex event=<full-event-id> hash=<request-hash>`.
7. Write a same-directory temporary file with mode `0600`, flush it, atomically rename it, and flush the parent directory where supported.
8. Write a content-free receipt atomically.
9. Stage only the intended note path and commit while still under the repository coordinator.
10. Send bridge notification for todo changes.
11. Return saved, commit, and bridge outcomes separately.

Locking must be inter-process, not the current module-level Promise used by the Claude plugin.
Implementation must use an operating-system advisory lock or another crash-released primitive.
A time-based stale lock that can be stolen from a live writer is prohibited.

The semantic operation is idempotent under event replay.
The event marker is part of the atomic note replacement, so a restart between replacement and receipt creation recovers the prior outcome from the note and never reapplies content.
The same event ID and same content returns the original result without a second write.
The same event ID with different metadata or content is rejected as a protocol violation.

Todo duplicate detection uses the existing normalized `keyOf` behavior.
Update, objective, and Important are deduplicated by event ID, not by text, because repeating the same prose can be intentional.

Git and bridge work occurs after the atomic note replacement.
An unrelated dirty tree is preserved because the engine stages and commits only the intended note path.
A Git failure returns `saved=true, committed=false` and must not claim rollback.
A bridge failure returns `saved=true, committed=<result>, notified=false` and keeps the saved note.

### 7. Installer and tmux configuration

`bin/install-codex` remains the installation entry point and must install or print an idempotent tmux configuration block.
That block binds `C-a N`, extends the user's existing mouse and keyboard copy completion behavior, and preserves `pbcopy` rather than replacing it.
Installation must detect unsupported tmux versions or bindings and stop with an actionable message instead of guessing.
Uninstall or reinstallation must affect only the marked notes-keeping block.

The marked block extends canonical mouse and keyboard `copy-pipe-and-cancel` bindings with a unique buffer prefix, leaves `copy-command` in force, and stamps the exact generated buffer after copy.
Installation fails closed when those bindings are noncanonical rather than overwriting custom behavior.
Exact shell quoting must be generated by code and tested with pane IDs, socket paths, and working directories containing spaces and shell metacharacters.
Selection bytes never participate in generated shell text.

## Local transport protocol

The service socket lives under the configured Codex state directory at `.codex/runtime/tui.sock`.
The implementation must reject a pre-existing symlink or socket not owned by the current UID.
The directory is `0700`, and the socket is `0600`.

The Python server verifies peer UID with libc `getpeereid` through `ctypes` on macOS or `SO_PEERCRED` on Linux before reading a request body.
Filesystem permissions alone do not satisfy this check.

Each message uses a four-byte unsigned big-endian header length, a bounded UTF-8 JSON header, a four-byte unsigned big-endian body length, and exactly that many body bytes.
The maximum header is 16 KiB, and the maximum body is 64 KiB.
Unknown versions, message types, fields, trailing bytes, invalid UTF-8 where text is required, NUL bytes, and length mismatch are rejected before state changes.

A capture request header contains protocol version, message type, event ID, tmux server identity, pane ID, tmux session ID, buffer name, copied-at time, and SHA-256 body hash.
It contains no note path.
The body contains the selected bytes.

Responses contain status code, human-safe message, and state flags only.
Responses never echo selected text.

## State machines

### Capture event

```text
new -> accepted -> claimed -> saved
                 |          -> draft
                 |          -> cancelled
                 |          -> failed
                 -> expired
```

Only `saved` may correspond to a note mutation.
`failed` includes validation, compare-and-swap conflict, permission, prewrite, and path failures.
Post-write Git or bridge failures are saved states with warnings, not failed mutations.

### Pane registration

```text
absent -> active(generation A) -> refreshed(A)
                             -> replaced(generation B)
                             -> removed(A)
```

Refresh cannot change generation.
Removal for generation A cannot remove generation B.
A reused pane with a new Codex startup always gets a new generation.

### Popup

```text
binding -> fresh selection -> workspace(Notes, prefilled draft)
        -> no fresh selection -> workspace(Todos, empty draft)
workspace -> any of five views -> any other view
          -> Notes edit -> in-memory draft -> explicit category save -> saved view
                                      -> close -> discard confirmation -> closed/stay
          -> Todo status action -> refreshed Todos
          -> close -> closed
```

## Failure behavior

| Condition | Visible result | Mutation |
| --- | --- | --- |
| No copy stamp | Workspace opens focused on Todos | None until explicit action |
| Stamp older than 30 seconds | Workspace opens focused on Todos | None until explicit action |
| Stamp belongs to another pane | Stamp discarded; workspace opens on Todos for current pane | None until explicit action |
| Buffer was deleted or replaced | Workspace opens focused on Todos | None until explicit action |
| Empty after outer trim | `Selection is empty` | None |
| NUL, invalid UTF-8, or over 64 KiB | Exact validation reason | None |
| TUI socket absent | `Notes TUI not running; start it and retry C-a N` | None |
| Peer UID mismatch | `Local transport rejected` and security log without content | None |
| Missing or stale pane registration | `Codex pane mapping is stale; submit a prompt and retry` | None |
| Ambiguous manual cwd target | Target picker stays open | None |
| Note path escapes notes root | `Unsafe note mapping rejected` | None |
| Duplicate todo | Existing label and ID | None |
| Concurrent semantic edit | Applied to latest locked bytes | Exactly once |
| Full-document revision conflict | `Note changed after it was read; retry` | None |
| ACK timeout | Query event ID before retry | At most once |
| Replay | Original result | No second write |
| Note write fails | Concrete filesystem error | None |
| Git commit fails after write | `Saved, but local history commit failed` | Saved once |
| Bridge notify fails after commit | `Saved; Firstmate notification failed` | Saved once |
| Popup closes with dirty draft | Discard confirmation | None unless explicitly saved |
| Service exits | Captures and drafts disappear | No implicit write |

All errors are shown in the source pane or popup, and protocol or engine callers receive failure status.
The tmux capture wrapper returns zero after displaying an expected user error, so tmux does not overwrite that message with a generic run-shell failure.
Logs may include full event ID, byte length, content hash, source pane, category, and error class.
Logs must omit content, preview text, clipboard text, and note body excerpts.

## Security and privacy

- Direct capture reads one explicitly stamped tmux buffer and nothing else.
- `capture-pane`, scrollback APIs, transcript polling, selection polling, and automatic `pbpaste` are prohibited.
- Selected bytes travel only in stdin, memory, or a bounded local socket body.
- Selected bytes never appear in argv, environment, process title, tmux status, popup command, registry, stamp, or logs.
- Sender-controlled data cannot supply a note path.
- Every path check uses real paths and rejects symlink escape.
- Runtime files and socket are owner-only, and the server authenticates peer UID.
- Event IDs are cryptographically random, single-use, and bound to source metadata and content hash.
- Saved notes and local Git history are durable.
- Popup preview displays `Saved notes are durable local history; do not capture secrets.`
- Todo preview additionally displays `Saved todos return to Codex context on later prompts.`
- Service shutdown erases unsaved in-memory capture and draft content.

## Exact implementation inventory

| Change | File | Owned API or behavior |
| --- | --- | --- |
| Create | `hooks/mutation.ts` | Pure semantic operations for status, add, objective, update, and Important |
| Create | `bin/notes-keeping-engine` | Locked atomic persistence, event receipts, exact-path Git commits, and bridge notification |
| Modify | `hooks/register.tsx` | Preserve native Claude pane and route durable replacements through engine compare-and-swap |
| Modify | `bin/notes-keeping-codex` | Keep hook/CLI UX, register lease/generation, and delegate mutations to generic engine |
| Modify | `hooks/codex-hooks.json` | Refresh on start/prompt and generation-checked cleanup on supported end |
| Create | `bin/notes-keeping-tui` | Python peer-authenticated service, in-memory events/drafts, mapping validation, capture sender, and popup client |
| Create | `bin/notes-keeping-tmux` | Marked tmux config installer, compatibility probes, rollback, and `Prefix Shift+N` binding |
| Modify | `bin/install-codex` | Probe dependencies, install plugin/tmux block, and start owned service |
| Modify | `README.md` | Setup, interaction, privacy, recovery, compatibility, and uninstall contract |
| Modify | `bin/notes-keeping-codex.test.sh` | Adapter regression plus Important and objective branching |
| Create | `bin/notes-keeping-tui.test.sh` | Private two-pane fixture, exact routing, cancel, replay, permissions, and Git assertions |
| Modify | `codex-selection-tui-design.md` | Observable contract and Goldfish remediation owner |

No package manifest is added.
The implementation uses the existing Bun runtime, Python standard library, tmux, `lockf`, and Git.

## Operation and log schema

Structured engine requests carry `version`, `kind`, `actor`, `transport`, `eventId`, `at`, operation fields, and for trusted replacement `expectedRevision`.
Popup calls fix actor to `captain` and transport to `tmux/codex`; sender-controlled frames cannot override either or supply a note path.
Todo add and status preserve the current bridge change-line format.
Action log rows preserve the existing parser shape and put trusted metadata in the note cell as `transport=<value> event=<full-id> hash=<sha256>`.
Old rows without that metadata remain valid.
Engine responses separate `saved`, `committed`, `notified`, `replayed`, human-safe `message`, and `warnings`.
Only `saved` confirms note replacement; later Git or bridge failure becomes a warning rather than a false rollback.

## Verification design

### Pure and protocol tests

Run `bin/notes-keeping-codex.test.sh` for the existing adapter, Important, objective branching, bridge, and log schema.
Run `bin/notes-keeping-tui.test.sh` for framed transport, exact two-pane targeting, cancel, replay, owner-only runtime state, and exact-path Git history.
Run `claude plugin test .` for the preserved native Claude pane.

- Frame parser accepts fragmented reads and rejects truncation, trailing bytes, oversized lengths, unknown versions, invalid UTF-8, and NUL.
- Permission tests reject wrong owner, permissive runtime directories, symlinks, and peer UID mismatch.
- Path tests reject prefix tricks, symlink escape, missing files, directories, and sender-provided paths.
- Input tests preserve multiline Unicode exactly after outer trim and reject empty or over-64-KiB content as a whole.
- Event tests prove claim-once, replay deduplication, hash mismatch rejection, expiry, and no content in result cache.
- Mutation tests cover all four direct categories, Draft no-write, actor `captain`, transport metadata, duplicate todo, objective branching, atomic write, and separate Git and bridge outcomes.

### Isolated tmux tests

`bin/notes-keeping-tui.test.sh` creates a disposable private tmux server and temporary notes root.
Cover mouse and keyboard copy paths, exact generated buffer name, buffer replacement, stale stamp, wrong pane, Unicode, multiple lines, escape-looking bytes, cancel, missing TUI, and popup failure.
Spies must fail the test if direct flow invokes `capture-pane` or `pbpaste`.
Existing `pbcopy` invocation must remain observable with a harmless test double.

### Mandatory two-pane end-to-end test

1. Start two Codex hook fixtures in two panes of one tmux session with the same real cwd.
2. Give each fixture a different Codex session ID, generation, and note.
3. Select different multiline Unicode text in each pane.
4. From each pane, send `t`, `u`, `o`, and `i`, including interleaved and concurrent sends.
5. Assert each event changes only its registered note and changes it exactly once.
6. Assert todo IDs, log actor, objective branching, Important attribution, Git commits, and bridge notification.
7. Open Draft in each pane and assert zero filesystem and Git diff before explicit save.
8. Cancel one direct capture and assert zero diff.
9. Restart one Codex fixture in the same pane, then prove the old generation cannot write and the new generation can.
10. Delete the service socket, age a stamp, replace a buffer, create an ambiguous same-cwd manual target, inject a symlink escape, and replay an event.
11. Assert every failure is visible and non-destructive.
12. Inspect process arguments, environment, runtime files, logs, and Git diff to prove selected text appears only in the intended saved note and its local Git history.

### Fault injection

Inject a concurrent note edit, process exit before rename, read-only note, Git failure, bridge failure, malformed frame, oversized frame, NUL, ACK loss, popup loss, and service restart.
No test may accept lost newer data, silent fallback, double write, cross-note write, or success text before mutation acknowledgment.

### Captain usability pass

From a real Codex pane, verify Notes focus and prefill after a fresh copy; Todos focus without one; in-popup navigation across all five views; OSC 8 link styling; all four category saves; Todo status; cancel; dirty-draft confirmation; absent-service recovery; and same-cwd disambiguation without consulting documentation.

## Acceptance criteria

V1 is acceptable only when two live Codex panes in one directory can make different multiline Unicode selections and all four direct categories always update only the correct bound note exactly once.
The binding must always open the full five-view popup for a valid mapped pane: Notes focused with fresh explicit selection, Todos focused otherwise.
Every view must remain reachable from either entry state without closing or losing an unsaved draft.
Draft must change no file before explicit save.
Cancel and every defined failure must be visible and non-destructive.
No direct path may call `capture-pane`, scrape history, poll a selection, automatically read the clipboard, accept an arbitrary note path, or persist unsaved selected text.
Transport and runtime state must be owner-only and peer-authenticated.
The complete portable and end-to-end suite must pass on the supported tmux and Codex versions before installation guidance calls the feature ready.

## Rollout and rollback

Ship behind explicit tmux configuration so existing Codex notes behavior remains unchanged until installed.
Rollout order is shared mutation boundary, pane registration, service and protocol, popup, tmux binding, then documentation.
The installer must stop if the service or target tmux capabilities are unavailable.
Rollback removes only the marked tmux block and stops the per-user TUI service.
The exact commands are `bin/notes-keeping-tmux uninstall` and `bin/notes-keeping-tui stop`.
Rollback must leave notes, their local Git history, existing Codex hook bindings, and ordinary adapter commands intact.
