import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatNote, Fleet, FleetRow, Notes, Opened, Pair, Select, Todo, View, WorkGroup } from '../types'
import { hrefOf, marked, noteOf } from './anchor'
import type { ActorId } from './actors'
import { actorLabel } from './actors'
import type { Entry } from './logs'
import { importLegacy, logRow, readRows } from './logs'
import {
  AGENT_TAG,
  USER_TAG,
  addChat,
  addImportant,
  addLogs,
  addSession,
  addTurn,
  addUpdate,
  carryOver,
  chatNotes,
  chatPair,
  create,
  dropEmptyUpdate,
  fileName,
  inject,
  injectPrevious,
  logsHint,
  nameParts,
  newestFirst,
  projectName,
  sections,
  setObjectives,
  setTodo,
  stamp,
  stampIds,
  summary,
  updateLine,
  withoutLogs,
} from './notes'
import { EMPTY, bridgeMoves, candidateKeys, candidates, changeLine, cleanLabel, context, cycle, cycleItem, diffSnapshot, emptyUpdates, format, idFor, idOf, isBackground, items, keyOf, labelPrompt, legend, moved, parse, pin, reconcile, row, settle, shown, snapshotOf, sourceOf, withIds, withoutIds } from './todo'
import type { Applied, Candidate, Change, Item, Memory, Move, Status, Verdict } from './todo'
import { TodoSlot, nextShown, rowId, rowKey, selectedOf, stepStatus } from './todos'
import type { Landing } from './todos'
import { WorkSlot, answerText, copyText, details, groupOf, nameOf, needsYou, reportHead, selectedRow, workStatus } from './work'

const NAME = 'notes-keeping'
const PANE = 'notes-keeping'
const SELECT = 'notes-keeping-select'
const TITLE = 'Notes'
const DIR = '.notes-keeping'
// An engine action with no handler mounted at the prompt; a Global binding of the chord in the user's keybindings.json presses it.
const ACTION = 'app:cycleDiffBase'
const CHORD = 'ctrl+q'
// Only the diff panel Claude Code drew before cc-plugin-diff handles it, so a PaneField binding of it reaches the update box's editor Button.
const EDITOR_ACTION = 'app:toggleDiffNoiseFilter'
const EDITOR_CHORD = 'ctrl+e'
const GIT_MS = 10_000
const POLL_MS = 600
const REFRESH_MS = 5_000
// How long a still selection the clipboard never took (copy on select off) waits before it counts as released.
const HOLD_MS = 3_000
const PASTE_MS = 2_000
const PREVIEW = 60
const HISTORY_CAP = 20
// The most of a report the Work report view draws.
const REPORT_CHARS = 60_000
const NOTE = 'note:'
// The engine's mark opening a reply on macOS, as Claude Code 2.1.314 draws it.
const BULLET = '⏺ '
const HEAD_CHARS = 200
const NEAR = 2

const LAYA_PYTHON = '.laya-venv/bin/python'
const LAYA_MS = 60_000
const LABEL_MODEL = 'haiku'
const LABEL_MS = 20_000
// Where Laya and bridge moves were logged before the # Logs section; read once per notes file, never written.
const LEGACY_LOG = 'todo-changes.log'
const LOG_ROWS = 200
// An executable under the session root, run only when present: `status` reports linked items' statuses, `notify` takes changes on stdin,
// `pending` hands out the updates firstmate queued for a notes file and `answer` takes the outcome of one on stdin.
const BRIDGE = 'config/notes-keeping-bridge'
const BRIDGE_MS = 10_000
// fm-crew-state.sh took up to 7 seconds on a loaded home.
const CREW_MS = 30_000
// The ! rows already notified, as <task>@<hold stamp>.
const NOTIFIED = 'fleet:notified'

const SUBCOMMANDS = ['init', 'objectives', 'update', 'important', 'reply', 'replies', 'todo', 'history', 'show', 'hide', 'debug']

const USAGE = [
  'Usage: /notes-keeping <subcommand>',
  '  init [--new] [objectives]  start this session\'s notes; text sets the objectives',
  '  objectives <text>          set the objectives; once set, add an [UPDATE] under ## Updates',
  '  update <text>              same as objectives',
  '  important [text]           add text, or the selected text, to # Important',
  '  reply <text>               queue the selected text and your reply; they go out with your next message',
  '  replies                    open the panel at the queue: every reply editable, s moves all into the prompt',
  '  todo [sync]                show the todo list; sync runs Laya over the objectives and the last reply now',
  '  history [n|file]           list earlier notes; pick one to copy its objectives, updates and open todo items here',
  `  show | hide                open or close the notes panel (also ${CHORD}) at the todo list; t todos, o objectives (u update, e editor), i important, c chat, q queue, h history, l logs, s send queue`,
  '  debug                      the selection poll: how often it ran, when last, the live selection, and why recent ones opened no pane',
  `${CHORD} works once ~/.claude/keybindings.json binds it: { "bindings": [{ "context": "Global", "bindings": { "${CHORD}": "${ACTION}" } }] }`,
  `${EDITOR_CHORD} in the update box opens the editor on the new update once it binds { "context": "PaneField", "bindings": { "${EDITOR_CHORD}": "${EDITOR_ACTION}" } }`,
  'Every write starts the notes file when the session has none.',
].join('\n')

const notes = atom({ plugin: 'notes-keeping', key: 'notes' } as const, null as Notes | null)
const select = atom({ plugin: 'notes-keeping', key: 'select' } as const, null as Select | null)
const handled = atom({ plugin: 'notes-keeping', key: 'handled' } as const, '')
const queue = atom({ plugin: 'notes-keeping', key: 'queue' } as const, [] as Pair[])
const editing = atom({ plugin: 'notes-keeping', key: 'editing' } as const, false)
const draft = atom({ plugin: 'notes-keeping', key: 'draft' } as const, '')
const view = atom({ plugin: 'notes-keeping', key: 'view' } as const, 'todos' as View)
const isNotesOpen = atom({ plugin: 'notes-keeping', key: 'isNotesOpen' } as const, false)
const picked = atom({ plugin: 'notes-keeping', key: 'picked' } as const, null as Opened | null)
const cursor = atom({ plugin: 'notes-keeping', key: 'cursor' } as const, null as string | null)
const todoCursor = atom({ plugin: 'notes-keeping', key: 'todoCursor' } as const, null as string | null)
const hidden = atom({ plugin: 'notes-keeping', key: 'hidden' } as const, [] as Status[])
// The todo item the Item view shows, by its row id.
const todoOpen = atom({ plugin: 'notes-keeping', key: 'todoOpen' } as const, null as string | null)
// The note the Note view shows, by its id.
const noteOpen = atom({ plugin: 'notes-keeping', key: 'noteOpen' } as const, null as string | null)
// The last `bridge fleet` read; null while the session root has no bridge.
const fleet = atom({ plugin: 'notes-keeping', key: 'fleet' } as const, null as Fleet | null)
const workHidden = atom({ plugin: 'notes-keeping', key: 'workHidden' } as const, ['gone'] as WorkGroup[])
const workCursor = atom({ plugin: 'notes-keeping', key: 'workCursor' } as const, null as string | null)
// The fleet row the Work item view shows, by its task id.
const workOpen = atom({ plugin: 'notes-keeping', key: 'workOpen' } as const, null as string | null)
const workAnswering = atom({ plugin: 'notes-keeping', key: 'workAnswering' } as const, false)
// The last fm-crew-state.sh line read for a row.
const crew = atom({ plugin: 'notes-keeping', key: 'crew' } as const, null as { task: string; text: string } | null)

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error'
}

function bindKey(sessionId: string): string {
  return `session:${sessionId}`
}

function headKey(sessionId: string): string {
  return `head:${sessionId}`
}

// Set by an attach from the panel: the next prompt carries the attached file.
function attachedKey(sessionId: string): string {
  return `attached:${sessionId}`
}

// Set by a compaction of the main conversation: the next prompt carries the whole notes file.
function compactedKey(sessionId: string): string {
  return `compacted:${sessionId}`
}

// The file a /clear or a /resume left behind; the next session id to look for its notes takes it.
let carried: string | undefined
// A session that starts with messages was continued or resumed: its first prompt carries the notes.
let resumed = false
// The selection the last poll read: a drag still under way changes it between polls.
let seen = ''
// When the selection last changed.
let stillSince = 0
// False once pbpaste failed: a still selection then counts as released.
let canPaste = true
// Opening or closing the dock reflows the transcript, and the kept selection then covers other text.
let isReflowed = false
// The bar stands in for a pane the terminal cannot seat: the reason is told once, not on every selection.
let isTold = false
// What the selection poll did, for /notes-keeping debug: its ticks, the last one's time, and its last outcomes as they changed.
let ticks = 0
let lastTick = 0
const outcomes: { at: number; text: string }[] = []
let landing: Landing | undefined

async function boundPath($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  const path = await $.store.get(bindKey(id))
  // A deleted notes file unbinds the session: its next write starts a new one.
  if (typeof path === 'string') return (await $.fs.exists(path)) ? path : undefined
  if (carried === undefined) return undefined
  const kept = carried
  carried = undefined
  await $.store.set(bindKey(id), kept)
  warn($, told('', await save($, kept, addSession(await readText($, kept), id), 'session')))
  return kept
}

async function readText($: EngineInterface, path: string): Promise<string> {
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text : ''
}

async function notesDir($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/${DIR}`
}

async function publish($: EngineInterface, path: string, text: string): Promise<void> {
  await update($, notes, () => ({ path, sections: sections(text) }))
}

// Commits every write in the notes folder's own repository; never pushes. Returns what the user must hear.
async function commit($: EngineInterface, dir: string, subject: string): Promise<string[]> {
  if (!(await $.fs.exists(`${dir}/.git`))) await $.process.run(['git', '-C', dir, 'init', '-q'], { timeoutMs: GIT_MS })
  await $.process.run(['git', '-C', dir, 'add', '-A'], { timeoutMs: GIT_MS })
  const done = await $.process.run(['git', '-C', dir, 'commit', '-q', '-m', subject], { timeoutMs: GIT_MS })
  const said: string[] = []
  if (done.exitCode !== 0 && !/nothing to commit/.test(done.stdout)) {
    said.push(`git commit in ${dir} failed: ${(done.stderr.trim() || done.stdout.trim()).split('\n')[0]}`)
  }
  const remotes = (await $.process.run(['git', '-C', dir, 'remote'], { timeoutMs: GIT_MS })).stdout.trim()
  if (remotes !== '') {
    said.push(`Warning: ${dir} has a git remote (${remotes.split('\n').join(', ')}). notes-keeping never pushes, but a push would publish your notes.`)
  }
  return said
}

async function save($: EngineInterface, path: string, text: string, subject: string): Promise<string[]> {
  await $.fs.write(path, text)
  await publish($, path, text)
  return commit($, await notesDir($), `${subject}: ${path.split('/').pop()}`)
}

async function start($: EngineInterface, objectives: string): Promise<{ path: string; said: string[] }> {
  const dir = await notesDir($)
  const taken = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(entry => entry.name) : []
  const id = await $.session.id()
  const path = `${dir}/${fileName(projectName(await $.session.root()), id, await $.clock.now(), taken)}`
  await $.store.set(bindKey(id), path)
  return { path, said: await save($, path, create(objectives, id), 'init') }
}

// The session's notes file, started with empty objectives when it has none.
async function bound($: EngineInterface): Promise<{ path: string; said: string[] }> {
  const path = await boundPath($)
  if (path !== undefined) return { path, said: [] }
  const started = await start($, '')
  $.ui.toast(`Notes started: ${started.path}`)
  return started
}

// Read-modify-write jobs on the notes file run one at a time: the todo run lands beside the user's own writes.
let lock: Promise<unknown> = Promise.resolve()

function locked<T>(job: () => Promise<T>): Promise<T> {
  const run = lock.then(job, job)
  lock = run.catch(() => undefined)
  return run
}

async function edit($: EngineInterface, subject: string, change: (text: string) => string): Promise<string[]> {
  const { path, said } = await bound($)
  return locked(async () => [...said, ...(await save($, path, change(await readText($, path)), subject))])
}

type Laya = { lines: Record<string, number>; statuses: Record<string, Verdict> }

// A todo run in progress; the newest reply that arrived meanwhile runs after it.
let isSyncing = false
let waiting: string | undefined
let isToldNoLaya = false
let isToldNoLabel = false

function memoryKey(path: string): string {
  return `todo:${path}`
}

async function readMemory($: EngineInterface, path: string): Promise<Memory> {
  const saved = await $.store.get(memoryKey(path))
  return typeof saved === 'object' && saved !== null ? { ...EMPTY, ...(saved as Partial<Memory>) } : EMPTY
}

// One process per call: Laya loads in about two seconds and answers each question in about fifteen milliseconds.
async function askLaya($: EngineInterface, request: { lines: { id: string; text: string }[]; statuses: { id: string; text: string }[]; answer: string }): Promise<Laya | undefined> {
  const python = (await $.env.get('NOTES_KEEPING_PYTHON')) || `${await $.env.get('HOME')}/${LAYA_PYTHON}`
  if (!(await $.fs.exists(python))) {
    if (!isToldNoLaya) $.ui.toast(`notes-keeping todo: no Laya at ${python}; set NOTES_KEEPING_PYTHON to a Python with laya-mlx. Updates still become items.`)
    isToldNoLaya = true
    return undefined
  }
  const done = await $.process.run([python, `${$.plugin.root}/hooks/laya_todo.py`], { stdin: JSON.stringify(request), timeoutMs: LAYA_MS, env: { HF_HUB_DISABLE_PROGRESS_BARS: '1' } })
  if (done.exitCode !== 0) throw new Error(`Laya failed: ${done.stderr.trim().split('\n').pop() ?? done.exitCode}`)
  return JSON.parse(done.stdout) as Laya
}

function snapshotKey(path: string): string {
  return `notified:${path}`
}

async function bridgeOf($: EngineInterface): Promise<string | undefined> {
  const bridge = `${await $.session.root()}/${BRIDGE}`
  return (await $.fs.exists(bridge)) ? bridge : undefined
}

async function runBridge($: EngineInterface, bridge: string, verb: 'status' | 'notify' | 'pending' | 'answer' | 'fleet' | 'crew', arg: string, stdin = ''): Promise<string> {
  const done = await $.process.run([bridge, verb, arg], { stdin, timeoutMs: verb === 'crew' ? CREW_MS : BRIDGE_MS })
  if (done.exitCode !== 0) throw new Error(`bridge ${verb} failed: ${done.stderr.trim().split('\n').pop() || done.exitCode}`)
  return done.stdout
}

// by: who firstmate says set up the link, when it says. reason: why the task could not be started, while it is blocked.
type Link = { status: Status | undefined; task: string; by?: string; reason?: string }

// Every linked item by id, or by text key for a link made by text; status is undefined when the linked task has no state to report.
async function linked($: EngineInterface, bridge: string, path: string): Promise<Record<string, Link>> {
  const raw = JSON.parse(await runBridge($, bridge, 'status', path)) as Record<string, { status?: unknown; task?: unknown; id?: unknown; by?: unknown; reason?: unknown }>
  const links: Record<string, Link> = {}
  for (const [text, link] of Object.entries(raw)) {
    const status = link.status === 'in-progress' || link.status === 'done' || link.status === 'blocked' ? link.status : undefined
    const task = typeof link.task === 'string' ? link.task : ''
    links[typeof link.id === 'string' ? link.id : keyOf(text)] = {
      status,
      task,
      ...(typeof link.by === 'string' && link.by !== '' ? { by: link.by } : {}),
      ...(status === 'blocked' && typeof link.reason === 'string' && link.reason !== '' ? { reason: link.reason } : {}),
    }
  }
  return links
}

function linkOf(links: Record<string, Link>, item: Item): Link | undefined {
  return links[idOf(item)] ?? links[keyOf(item.text)]
}

// Diffs the list against the last snapshot and stores the new one; called inside `locked` with the list as read and as written.
async function snapshot($: EngineInterface, path: string, before: readonly Item[], after: readonly Item[]): Promise<Change[]> {
  const saved = await $.store.get(snapshotKey(path))
  const changes = diffSnapshot(typeof saved === 'object' && saved !== null ? (saved as Record<string, Status>) : undefined, before, after)
  await $.store.set(snapshotKey(path), snapshotOf(after))
  return changes
}

// A change found in the file was written outside the plugin: its writer is unknown.
function foundEntries(changes: readonly Change[], at: number): Entry[] {
  return changes
    .filter(change => change.isFound === true)
    .map(change => ({ at, actor: 'unknown' as const, action: change.from === undefined ? ('added' as const) : ('status' as const), item: change.item, from: change.from, to: change.to }))
}

function foundLines(changes: readonly Change[]): string[] {
  return changes.filter(change => change.isFound === true).map(change => changeLine(change, 'unknown'))
}

// The md with the entries under # Logs. The rows a file gets first bring along its rows from the old todo-changes.log.
async function logged($: EngineInterface, path: string, md: string, entries: readonly Entry[]): Promise<string> {
  if (entries.length === 0) return md
  const legacy = `${await notesDir($)}/${LEGACY_LOG}`
  const isFirst = withoutLogs(md) === md
  const old = isFirst && (await $.fs.exists(legacy)) ? importLegacy(await readText($, legacy), path.split('/').pop() ?? '', items(sections(md).todo)) : []
  return addLogs(md, [...old, ...entries.map(logRow)])
}

async function notify($: EngineInterface, bridge: string, path: string, changes: readonly string[]): Promise<void> {
  if (changes.length === 0) return
  try {
    await runBridge($, bridge, 'notify', path, `${changes.join('\n')}\n`)
  } catch (error) {
    $.ui.toast(`notes-keeping todo: ${message(error)}`)
  }
}

// The file this session is bound to, without taking a file a /clear carried over.
async function keptPath($: EngineInterface): Promise<string | undefined> {
  const path = await $.store.get(bindKey(await $.session.id()))
  return typeof path === 'string' && (await $.fs.exists(path)) ? path : undefined
}

// A todo change made in the file outside the plugin while no todo run happens is noticed here, logged, and sent on.
async function watchTodo($: EngineInterface): Promise<void> {
  const path = await keptPath($)
  if (path === undefined) return
  const bridge = await bridgeOf($)
  const changes = await locked(async () => {
    const md = await readText($, path)
    const list = items(sections(md).todo)
    const found = await snapshot($, path, list, list)
    const entries = foundEntries(found, await $.clock.now())
    if (entries.length > 0) warn($, told('', await save($, path, await logged($, path, md, entries), 'log')))
    return foundLines(found)
  })
  if (bridge !== undefined) await notify($, bridge, path, changes)
}

type Queued = { request: string; text: string; by: string; task: string }
type Answer = { id: string } | { error: string }
let isToldNoPending = false

// Appends a queued update as firstmate's, with the id of the item the todo run makes from it already on its line: an item
// that has the same text gives its own id, and an update the todo run would make no item from is not written.
async function queuedUpdate($: EngineInterface, path: string, queued: Queued): Promise<Answer> {
  const at = await $.clock.now()
  return locked(async () => {
    const md = await readText($, path)
    const out = addUpdate(md, stamp(at), queued.text)
    const fresh = candidates(sections(out))
    const c = fresh.length > candidates(sections(md)).length ? fresh.at(-1) : undefined
    if (c === undefined) return { error: 'the update makes no todo item' }
    const list = items(sections(out).todo)
    const keys = candidateKeys(c)
    const had = list.find(item => keys.includes(keyOf(item.text)))
    const { seen } = await readMemory($, path)
    if (had === undefined && keys.some(key => seen.includes(key))) return { error: 'the todo run has seen this text before and makes no item from it' }
    if (had !== undefined && had.id === undefined) return { error: 'the item with this text has no id yet' }
    const taken = new Set([...list, ...fresh].flatMap(one => (one.id === undefined ? [] : [one.id])))
    const id = had?.id ?? idFor(c.text, taken)
    const item: Item = { status: 'todo', text: c.text, id }
    const entry: Entry = { at, actor: 'firstmate', action: 'update', item, note: `${queued.task}, by ${queued.by}: ${queued.text}` }
    warn($, told('', await save($, path, await logged($, path, stampIds(out, [...list, item]), [entry]), 'update')))
    return { id }
  })
}

// Each refresh hands this session's notes file the updates firstmate queued for it, and answers each with its item's id.
async function drainQueue($: EngineInterface): Promise<void> {
  const path = await keptPath($)
  const bridge = await bridgeOf($)
  if (path === undefined || bridge === undefined) return
  let queued: Queued[]
  try {
    queued = JSON.parse(await runBridge($, bridge, 'pending', path)) as Queued[]
  } catch (error) {
    if (!isToldNoPending) $.ui.toast(`notes-keeping: ${message(error)}`)
    isToldNoPending = true
    return
  }
  for (const one of queued) {
    const answer = await queuedUpdate($, path, one).catch((error: unknown): Answer => ({ error: message(error) }))
    await runBridge($, bridge, 'answer', one.request, JSON.stringify(answer)).catch((error: unknown) => $.ui.toast(`notes-keeping: ${message(error)}`))
  }
  if (queued.length > 0) void syncTodo($, '')
}

// Laya only picks among given answers, so the label comes from a small model through the session's own client.
// Undefined when the model gives no usable label: the list then shows the text cut short.
async function askLabel($: EngineInterface, text: string): Promise<string | undefined> {
  const reply = await $.model.complete({ model: LABEL_MODEL, prompt: labelPrompt(text), maxTokens: 40, timeoutMs: LABEL_MS }).catch((error: unknown) => {
    return { isAnswered: false as const, reason: message(error) }
  })
  if (reply.isAnswered) return cleanLabel(reply.text)
  if (!isToldNoLabel) $.ui.toast(`notes-keeping todo: no label from ${LABEL_MODEL} (${reply.reason}); items show their text cut short.`)
  isToldNoLabel = true
  return undefined
}

// Items from the objectives and updates Laya or the code accepts, and status moves from the last reply.
async function runTodo($: EngineInterface, answer: string): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  const bridge = await bridgeOf($)
  let links: Record<string, Link> = {}
  if (bridge !== undefined) {
    try {
      links = await linked($, bridge, path)
    } catch (error) {
      $.ui.toast(`notes-keeping todo: ${message(error)}`)
    }
  }
  const s = sections(await readText($, path))
  const list = items(s.todo)
  const memory = settle(await readMemory($, path), list)
  const have = new Set(list.flatMap(item => [idOf(item), keyOf(item.text)]))
  // A candidate whose line carries an id is its item's even after either text was edited.
  const isHad = (c: Candidate) => candidateKeys(c).some(key => have.has(key))
  const fresh = candidates(s).filter(c => !candidateKeys(c).some(key => memory.seen.includes(key)))
  const lines = fresh.filter(c => !c.isSure && !isHad(c)).map(c => ({ id: keyOf(c.text), text: c.text }))
  // A linked item's status follows its firstmate task; Laya is not asked about it.
  const open = list.filter(item => (item.status === 'todo' || item.status === 'in-progress') && linkOf(links, item) === undefined)
  const statuses = answer.trim() === '' ? [] : open.map(item => ({ id: keyOf(item.text), text: item.text }))
  const laya = lines.length + statuses.length === 0 ? undefined : await askLaya($, { lines, statuses, answer })
  const add: Item[] = []
  // Who added each new item, by its text key: the plugin for an item as written, Laya for a line it judged a task.
  const adders: Record<string, ActorId> = {}
  const addNotes: Record<string, string> = {}
  const seen: string[] = []
  const itemOf = (c: Candidate): Item => (c.id === undefined ? { status: 'todo', text: c.text } : { status: 'todo', text: c.text, id: c.id })
  for (const c of fresh) {
    const key = keyOf(c.text)
    if (isHad(c) || c.isSure) {
      seen.push(key)
      if (!isHad(c)) {
        add.push(itemOf(c))
        adders[key] = 'plugin'
      }
      continue
    }
    const p = laya?.lines[key]
    if (p === undefined) continue
    seen.push(key)
    if (!isBackground(p)) {
      add.push(itemOf(c))
      adders[key] = 'laya'
      addNotes[key] = `task ${p.toFixed(2)}`
    }
  }
  const set: Record<string, Move> = {}
  const decided: Record<string, Verdict> = {}
  const siblings = list.map(item => item.text)
  for (const item of statuses.length === 0 ? [] : open) {
    // A host call per item lets the hooks worker answer the engine's heartbeat between items.
    await $.clock.now()
    const key = idOf(item)
    const verdict = laya?.statuses[keyOf(item.text)]
    const next = moved(item, answer, verdict, siblings, memory.pins.includes(key))
    if (next === undefined || verdict === undefined) continue
    set[key] = { from: item.status, to: next.status }
    decided[key] = { ...verdict, label: next.label, p: next.p }
  }
  // Laya's own probability for the move, and the one the start cue lifted it to when that differs.
  const said = (key: string): string => {
    const verdict = decided[key]
    if (verdict === undefined) return ''
    const own = verdict.probs[verdict.label] ?? 0
    return Math.abs(verdict.p - own) < 0.005 ? `${verdict.label} ${own.toFixed(2)}` : `${verdict.label} ${own.toFixed(2)}, ${verdict.p.toFixed(2)} with the ${verdict.label === 'started' ? 'start' : 'finish'} cue`
  }
  const reported: Record<string, Status> = {}
  for (const item of list) {
    const status = linkOf(links, item)?.status
    if (status !== undefined) reported[idOf(item)] = status
  }
  Object.assign(set, bridgeMoves(list, reported, memory))
  const unlabeled = [...list.filter(item => item.label === undefined && !memory.labeled.includes(idOf(item))), ...add]
  const named = await Promise.all(unlabeled.map(async item => [idOf(item), await askLabel($, item.text)] as const))
  const labels: Record<string, string> = {}
  for (const [key, label] of named) if (label !== undefined) labels[key] = label
  const labeled = named.map(([key]) => key)
  const added = add.map(item => (labels[idOf(item)] === undefined ? item : { ...item, label: labels[idOf(item)] }))
  // The file may have changed while Laya ran: apply onto what is there now.
  const { warned, changes } = await locked(async () => {
    const latest = await readText($, path)
    const body = sections(latest).todo
    const out = reconcile(body, await readMemory($, path), { add: added, set, seen, labels, labeled, bridge: reported })
    await $.store.set(memoryKey(path), out.memory)
    const written = items(out.body)
    const found = await snapshot($, path, items(body), written)
    const at = await $.clock.now()
    const entries = foundEntries(found, at)
    const lines = foundLines(found)
    for (const change of found.filter(change => change.isFound !== true)) {
      const key = keyOf(change.item.text)
      entries.push({ at, actor: adders[key] ?? 'plugin', action: 'added', item: change.item, to: change.to, note: addNotes[key] })
      lines.push(changeLine(change, adders[key] ?? 'plugin'))
    }
    for (const move of out.applied) {
      const item = written.find(one => idOf(one) === move.key || keyOf(one.text) === keyOf(move.text)) ?? { status: move.to, text: move.text }
      const link = links[move.key] ?? links[keyOf(move.text)]
      const task = link === undefined ? '' : link.by === undefined ? link.task : `${link.task}, by ${link.by}`
      const why = link === undefined ? said(move.key) : move.to === 'blocked' && link.reason !== undefined ? `${task}: ${link.reason}` : task
      const note = [why, ...(move.isHandSet ? ['replaced a hand-set status'] : [])].join(', ')
      entries.push({ at, actor: link === undefined ? 'laya' : 'firstmate', action: 'status', item, from: move.from, to: move.to, note })
      lines.push(changeLine({ item, from: move.from, to: move.to }, link === undefined ? 'laya' : `firstmate ${link.task}`))
    }
    const isSame = out.body === format(parse(body))
    if (isSame && entries.length === 0) return { warned: [], changes: lines }
    const todo = isSame ? latest : stampIds(setTodo(latest, out.body), written)
    return { warned: await save($, path, await logged($, path, todo, entries), 'todo'), changes: lines }
  })
  warn($, told('', warned))
  if (bridge !== undefined) await notify($, bridge, path, changes)
}

async function syncTodo($: EngineInterface, answer: string): Promise<void> {
  if (isSyncing) {
    waiting = answer === '' ? waiting ?? '' : answer
    return
  }
  isSyncing = true
  try {
    await runTodo($, answer)
  } catch (error) {
    $.ui.toast(`notes-keeping todo: ${message(error)}`)
  } finally {
    isSyncing = false
  }
  const next = waiting
  waiting = undefined
  if (next !== undefined) await syncTodo($, next)
}

// A click or Enter sets the next status, f and p the next or previous one: the captain's, logged and sent as theirs.
// It counts as hand-set: Laya leaves it. A change that leaves the line as it was writes nothing.
async function clickItem($: EngineInterface, key: string, change: (status: Status) => Status = cycle): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  const bridge = await bridgeOf($)
  const changes = await locked(async () => {
    const md = await readText($, path)
    const before = items(sections(md).todo)
    const body = cycleItem(sections(md).todo, key, change)
    if (body === cycleItem(sections(md).todo, key, status => status)) return []
    const after = items(body)
    const isIt = (item: Item) => idOf(item) === key || keyOf(item.text) === key
    const was = before.find(isIt)
    const now = after.find(isIt)
    await $.store.set(memoryKey(path), pin(await readMemory($, path), key))
    const found = await snapshot($, path, before, after)
    const at = await $.clock.now()
    const entries = foundEntries(found, at)
    const lines = foundLines(found)
    if (was !== undefined && now !== undefined) {
      entries.push({ at, actor: 'captain', action: 'status', item: now, from: was.status, to: now.status })
      lines.push(changeLine({ item: now, from: was.status, to: now.status }, 'captain'))
    }
    await save($, path, await logged($, path, stampIds(setTodo(md, body), after), entries), 'todo')
    return lines
  })
  if (bridge !== undefined) await notify($, bridge, path, changes)
}

function told(text: string, said: readonly string[]): string {
  return [text, ...said].join('\n')
}

// A press has no output row: what follows the first line goes to a toast.
function warn($: EngineInterface, text: string): void {
  const rest = text.split('\n').slice(1).join(' ')
  if (rest !== '') $.ui.toast(rest)
}

async function guard($: EngineInterface, path: string): Promise<string | undefined> {
  const dir = await notesDir($)
  return path === dir || path.startsWith(`${dir}/`)
    ? `${NAME}: ${path} is the user's notes; only the user writes them, through /notes-keeping.`
    : undefined
}

async function listNotes($: EngineInterface): Promise<string[]> {
  const dir = await notesDir($)
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return newestFirst(entries.filter(entry => entry.kind === 'file').map(entry => entry.name))
}

// Sets the objectives while they are empty; after that each text is an [UPDATE] under ## Updates.
async function objectives($: EngineInterface, text: string, actor: ActorId): Promise<string> {
  const { path, said } = await bound($)
  const at = await $.clock.now()
  const when = stamp(at)
  const { isSet, written } = await locked(async () => {
    const md = await readText($, path)
    const isSet = sections(md).objectives === ''
    const out = isSet ? setObjectives(md, text) : addUpdate(md, when, text)
    const entry: Entry = { at, actor, action: isSet ? 'objective' : 'update', note: text }
    return { isSet, written: await save($, path, await logged($, path, out, [entry]), isSet ? 'objectives' : 'update') }
  })
  void syncTodo($, '')
  return told(isSet ? 'Objectives set.' : 'Objectives updated under ## Updates.', [...said, ...written])
}

async function init($: EngineInterface, args: string, actor: ActorId): Promise<string> {
  const isNew = /^--new\b/.test(args)
  const text = args.replace(/^--new\b\s*/, '').trim()
  const current = await boundPath($)
  if (current !== undefined && !isNew) {
    if (text === '') return `This session already keeps ${current}. Run /notes-keeping init --new [objectives] to start a new file for it.`
    return told(`This session keeps ${current}.`, [await objectives($, text, actor)])
  }
  const { path, said } = await start($, text)
  return told(`Notes started: ${path}`, said)
}

async function todoCommand($: EngineInterface, args: string): Promise<string> {
  if (args === 'sync') await syncTodo($, '')
  else if (args !== '') return 'Usage: /notes-keeping todo [sync]'
  const path = await boundPath($)
  const list = path === undefined ? [] : items(sections(await readText($, path)).todo)
  return list.length === 0 ? 'No todo items yet.' : list.map(item => row(item)).join('\n')
}

// Copies a picked file's objectives, updates and todo items into this session's notes; the picked file is only read.
// The items it copies are logged as added by the actor who attached it.
async function attach($: EngineInterface, pick: string, actor: ActorId): Promise<{ previous: string; said: string[] }> {
  const dir = await notesDir($)
  const previous = await readText($, `${dir}/${pick}`)
  const { path, said: started } = await bound($)
  const said = await locked(async () => {
    const md = await readText($, path)
    const carried = carryOver(md, previous, pick)
    const body = format(withIds(parse(sections(carried).todo)))
    const out = stampIds(setTodo(carried, body), items(body))
    const found = await snapshot($, path, items(sections(md).todo), items(body))
    const at = await $.clock.now()
    const copied: Entry[] = found
      .filter(change => change.isFound !== true)
      .map(change => ({ at, actor, action: 'added', item: change.item, to: change.to, note: `copied from ${pick}` }))
    const entries = [...foundEntries(found, at), { at, actor, action: 'attach' as const, note: pick }, ...copied]
    // Lines the linked file's todo run already judged are not asked again here.
    const mine = await readMemory($, path)
    const seen = [...new Set([...mine.seen, ...(await readMemory($, `${dir}/${pick}`)).seen])]
    await $.store.set(memoryKey(path), { ...mine, seen })
    return [...started, ...(await save($, path, await logged($, path, out, entries), 'continue'))]
  })
  return { previous, said }
}

async function history($: EngineInterface, args: string, actor: ActorId): Promise<{ text: string; context?: string[] }> {
  const current = await boundPath($)
  const names = (await listNotes($)).filter(name => current === undefined || !current.endsWith(`/${name}`))
  if (names.length === 0) return { text: 'No earlier notes.' }
  const dir = await notesDir($)
  if (args === '') {
    const rows = await Promise.all(
      names.slice(0, HISTORY_CAP).map(async (name, i) => {
        const line = summary(await readText($, `${dir}/${name}`).catch(() => ''))
        const parts = nameParts(name)
        const label = parts === undefined ? name : `${parts.date} ${parts.time}  ${parts.project}  ${parts.shortId}`
        return `${String(i + 1).padStart(2)}. ${label}  ${line.slice(0, PREVIEW)}`
      }),
    )
    const more = names.length > HISTORY_CAP ? [`(${names.length - HISTORY_CAP} older not listed)`] : []
    return { text: [...rows, ...more, '', 'Continue one here: /notes-keeping history <n|file>'].join('\n') }
  }
  const pick = /^\d+$/.test(args) ? names[Number(args) - 1] : names.find(name => name === args || name === `${args}.md`)
  if (pick === undefined) return { text: `No earlier notes match "${args}".` }
  const { previous, said } = await attach($, pick, actor)
  return {
    text: told(`Continuing ${pick}: its objectives, updates and open todo items are copied here; ${pick} is unchanged. The whole file is now in context.`, said),
    context: [inject(previous, `${dir}/${pick}`)],
  }
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length] ?? 0
}

function unknown(sub: string): string {
  const near = SUBCOMMANDS.map(name => ({ name, d: distance(sub, name) })).sort((a, b) => a.d - b.d)[0]
  const said = near !== undefined && near.d <= NEAR ? `unknown subcommand ${sub}, did you mean ${near.name}?` : `unknown subcommand ${sub}`
  return `${said}\n${USAGE}`
}

// The engine copies a mouse selection to the clipboard when the button comes up, and reports the selection while it is
// still held; the clipboard holding the selection is the release.
async function isReleased($: EngineInterface, text: string): Promise<boolean> {
  if (!canPaste) return true
  try {
    const pasted = await $.process.run(['pbpaste'], { timeoutMs: PASTE_MS })
    if (pasted.exitCode !== 0) canPaste = false
    return pasted.exitCode !== 0 || pasted.stdout.trim() === text || (await $.clock.now()) - stillSince >= HOLD_MS
  } catch {
    canPaste = false
    return true
  }
}

// A fleet row's report path: as the bridge names it, or relative to the session root, the firstmate home.
async function reportPath($: EngineInterface, report: string): Promise<string> {
  return report.startsWith('/') ? report : `${await $.session.root()}/${report}`
}

// e on a fleet row: its report in the editor popup the notes file opens in.
async function editReport($: EngineInterface, report: string): Promise<void> {
  const path = await reportPath($, report)
  const editor = (await $.env.get('VISUAL')) || (await $.env.get('EDITOR'))
  if (!editor || !(await $.env.get('TMUX'))) {
    await $.process.run(['open', path], { timeoutMs: GIT_MS })
    return
  }
  const popup = $.process.spawn({ argv: ['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', `${editor} ${editorTarget(editor, path, undefined)}`] })
  for await (const _ of popup) continue
  await popup.result
}

// A report as the pane draws it: cut at REPORT_CHARS with a line saying so; undefined when it could not be read.
function clipReport(text: string | undefined): string | undefined {
  if (text === undefined || text === '') return undefined
  return text.length <= REPORT_CHARS ? text : `${text.slice(0, REPORT_CHARS)}\n\n(cut at ${REPORT_CHARS} characters; e opens the whole file)`
}

async function selected($: EngineInterface): Promise<string> {
  return ((await $.ui.selection())?.text ?? '').trim()
}

async function important($: EngineInterface, text: string, tag: string): Promise<string> {
  return told('Added to # Important.', await edit($, 'important', md => addImportant(md, tag, text)))
}

// The one status line the plugin has: queued replies, then the fleet rows that need the captain.
let queuedCount = 0
let callCount = 0

function pinStatus($: EngineInterface): void {
  const parts = [queuedCount === 0 ? undefined : `notes: ${queuedCount} repl${queuedCount === 1 ? 'y' : 'ies'} queued, sent with your next message. Ctrl+q: edit, remove, send`, workStatus(callCount)]
  const text = parts.filter(part => part !== undefined).join(' · ')
  $.ui.status(text === '' ? undefined : text)
}

function showQueue($: EngineInterface, n: number): void {
  queuedCount = n
  pinStatus($)
}

// Todo item labels by item id, the names fleet rows linked to an item take.
function labelsOf(current: Notes | null): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const item of current === null ? [] : items(current.sections.todo)) if (item.id !== undefined) labels[item.id] = shown(item)
  return labels
}

let isToldNoFleet = false

// Each refresh reads the fleet; a new row that needs the captain is notified once, and the status line counts them.
async function watchFleet($: EngineInterface): Promise<void> {
  const bridge = await bridgeOf($)
  if (bridge === undefined) return
  let raw: { rows: FleetRow[]; calls: number }
  try {
    raw = JSON.parse(await runBridge($, bridge, 'fleet', (await keptPath($)) ?? '')) as { rows: FleetRow[]; calls: number }
  } catch (error) {
    if (!isToldNoFleet) $.ui.toast(`notes-keeping: ${message(error)}`)
    isToldNoFleet = true
    return
  }
  const now = await $.clock.now()
  const next = await update($, fleet, () => ({ rows: raw.rows, calls: raw.calls, at: now }))
  const due = needsYou(next)
  const saved = await $.store.get(NOTIFIED)
  const sent = new Set(Array.isArray(saved) ? (saved as string[]) : [])
  const labels = labelsOf(await read($, notes))
  for (const row of due) {
    const key = `${row.task}@${row.at ?? '-'}`
    if (sent.has(key)) continue
    sent.add(key)
    await $.ui.notify(`${nameOf(row, labels)}: ${row.waiting.replace(/^you: /, '')}`, { title: 'Firstmate' }).catch(() => undefined)
  }
  await $.store.set(NOTIFIED, [...sent])
  if (due.length !== callCount) {
    callCount = due.length
    pinStatus($)
  }
}

// The selection is answered: the same text does not raise the pane again until it changes.
async function finish($: EngineInterface, selection: string): Promise<void> {
  await update($, handled, () => selection)
  await update($, select, () => null)
  await $.ui.close({ id: SELECT })
  isReflowed = true
}

// A reply to text selected in one transcript row is a note anchored there, at the first occurrence no other note holds.
async function queueReply($: EngineInterface, agent: string, user: string, row?: string): Promise<void> {
  const held = [...chatNotes((await read($, notes))?.sections.chat ?? ''), ...(await read($, queue)).flatMap(pair => (pair.note === undefined ? [] : [{ ...pair.note, agent: pair.agent }]))]
  const note = row === undefined ? undefined : { id: idFor(`${row}\n${agent}\n${user}`, new Set(held.map(one => one.id))), row, at: held.filter(one => one.row === row && one.agent === agent).length }
  const next = await update($, queue, list => [...list, note === undefined ? { agent, user } : { agent, user, note }])
  showQueue($, next.length)
  await finish($, agent)
}

// Moves every queued reply into the prompt box; the user presses Enter. Nothing is sent from here.
async function sendQueue($: EngineInterface): Promise<void> {
  const pending = await read($, queue)
  if (pending.length === 0) {
    $.ui.toast('No replies queued.')
    return
  }
  const filled = await $.prompt.fill({ text: pending.map(pair => chatPair(pair.agent, pair.user)).join('\n\n'), mode: 'insert' })
  if (!filled.isFilled) {
    $.ui.toast('The prompt box cannot take the replies now; they stay queued.')
    return
  }
  warn($, told('', await edit($, 'reply', md => pending.reduce((text, pair) => addChat(text, pair.agent, pair.user, pair.note), md))))
  await update($, queue, () => [])
  showQueue($, 0)
}

// An open notes pane holding the keyboard refuses the selection pane's focus and keeps it a tab behind, so it closes first.
async function openSelect($: EngineInterface, selection: string, row: string | undefined): Promise<void> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) await hideNotes($)
  await update($, select, () => ({ mode: 'menu', selection, ...(row === undefined ? {} : { row }), isPlaced: false, hadFocus: false }))
  const opened = await $.ui.open({ id: SELECT, title: 'Selection', focus: true, closeOnEscape: true, rows: 4 })
  await update($, select, current => (current === null ? null : { ...current, isPlaced: opened.isPlaced }))
  isReflowed = true
  if (!opened.isPlaced && !isTold) {
    isTold = true
    $.ui.toast(`The selection panel waits for a wider terminal (${opened.reason}); use the bar above the prompt: 1 Reply, 2 Important, 3 Dismiss.`)
  }
}

async function openReply($: EngineInterface, current: Select): Promise<void> {
  await update($, select, () => ({ ...current, mode: 'reply', isPlaced: true, hadFocus: false }))
  await $.ui.open({ id: SELECT, title: 'Reply', focus: true, closeOnEscape: true, rows: 4 })
}

async function refresh($: EngineInterface): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  await publish($, path, await readText($, path))
}

// hx takes file:line, vi-family editors +line; another editor opens the file at its top.
function editorTarget(editor: string, path: string, line: number | undefined): string {
  const quoted = `'${path.replaceAll("'", "'\\''")}'`
  if (line === undefined) return quoted
  const name = editor.trim().split(/\s+/)[0]?.split('/').pop() ?? ''
  if (name === 'hx' || name === 'helix') return `${quoted}:${line}`
  if (['vi', 'vim', 'nvim', 'nano', 'emacs', 'kak'].includes(name)) return `+${line} ${quoted}`
  return quoted
}

// The engine keeps the terminal, so the editor runs in a tmux popup; `display-popup -E` returns when the editor exits.
// From the update box the file gets a new [UPDATE] holding the box's text first, the editor opens on it, and it is dropped if left empty.
async function openEditor($: EngineInterface, isUpdate = false): Promise<void> {
  const editor = (await $.env.get('VISUAL')) || (await $.env.get('EDITOR'))
  if (!editor) {
    $.ui.toast(`${NAME}: set $VISUAL or $EDITOR to open the notes file in your editor.`)
    return
  }
  if (!(await $.env.get('TMUX'))) {
    $.ui.toast(`${NAME}: e opens the editor in a tmux popup; this session runs outside tmux.`)
    return
  }
  const { path, said } = await bound($)
  const when = stamp(await $.clock.now())
  const line = isUpdate
    ? await locked(async () => {
        const md = addUpdate(await readText($, path), when, await read($, draft))
        await $.fs.write(path, md)
        await publish($, path, md)
        const at = updateLine(md, when)
        return at === undefined ? undefined : at + 1
      })
    : undefined
  const wasEmpty = emptyUpdates(sections(await readText($, path)).updates)
  const popup = $.process.spawn({ argv: ['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', `${editor} ${editorTarget(editor, path, line)}`] })
  let errors = ''
  for await (const chunk of popup) if (chunk.stream === 'stderr') errors += chunk.text
  const ended = await popup.result
  if (ended.code !== 0 && errors.trim() !== '') $.ui.toast(`${NAME}: the editor popup failed: ${errors.trim().split('\n')[0]}`)
  if (isUpdate) await update($, editing, () => false)
  const written = await locked(async () => {
    const md = await readText($, path)
    const kept = isUpdate ? dropEmptyUpdate(md, when) : md
    if (kept !== md) await $.fs.write(path, kept)
    await refresh($)
    const isKept = isUpdate && kept === md && updateLine(md, when) !== undefined
    for (const header of emptyUpdates(sections(kept).updates).filter(one => !wasEmpty.includes(one))) {
      $.ui.toast(`${NAME}: ${header} has no text; no todo item is made from it.`)
    }
    return commit($, await notesDir($), `${isKept ? 'update' : 'editor'}: ${path.split('/').pop()}`)
  })
  warn($, told('', [...said, ...written]))
  void syncTodo($, '')
}

async function showNotes($: EngineInterface, at: View = 'todos'): Promise<void> {
  await refresh($)
  await update($, view, () => at)
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  await update($, isNotesOpen, () => true)
}

// A close the mod asks for itself does not pass through its own ui.close hook.
async function hideNotes($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await update($, editing, () => false)
  await update($, isNotesOpen, () => false)
}

async function toggleNotes($: EngineInterface): Promise<void> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) await hideNotes($)
  else await showNotes($)
}

const OUTCOMES = 10

// One poll of the selection; returns what it did, in words for /notes-keeping debug.
async function poll($: EngineInterface): Promise<string> {
  const current = await read($, select)
  const panes = await $.ui.panes()
  const selectPane = panes.find(pane => pane.id === SELECT)
  const isFocused = selectPane?.isFocused === true
  // A key that is none of r/i/x, or a click in the transcript, hands the keyboard back to the prompt: the menu or the reply box goes with it.
  // A click on another tab hides the pane instead: it stays behind its tab until shown again.
  if (current !== null && current.hadFocus && !isFocused) {
    if (selectPane !== undefined && !selectPane.isShown) {
      await update($, select, () => ({ ...current, hadFocus: false }))
      return `${current.mode} behind another tab: ${current.selection}`
    }
    await finish($, current.selection)
    isReflowed = false
    return `${current.mode} lost the keyboard, closed: ${current.selection}`
  }
  if (current !== null && isFocused && !current.hadFocus) await update($, select, () => ({ ...current, hadFocus: true }))
  // A selection with no transcript row lies in a pane or the prompt: while a pane of this plugin is shown it is the pane's text.
  const picked = await $.ui.selection()
  const isInPane = picked !== undefined && picked.requestId === undefined && panes.some(pane => (pane.id === PANE || pane.id === SELECT) && pane.isShown)
  const text = isInPane ? '' : (picked?.text ?? '').trim()
  // The first selection read after the dock opens or closes is the old one, moved by the reflow: it counts as answered.
  if (isReflowed) {
    isReflowed = false
    if (text !== '') await update($, handled, () => text)
    return `first read after the dock moved, counted as answered: ${text}`
  }
  // A reply box in view is the one being typed in. Behind another tab, gone, or after the keyboard left it, a new selection replaces it.
  if (current?.mode === 'reply' && selectPane?.isShown === true) return `reply box open: ${current.selection}`
  // A docked pane narrows the transcript and the terminal drops the selection, so an open pane outlives it.
  if (text === '') {
    seen = ''
    if (current !== null && !current.isPlaced) await update($, select, () => null)
    if (current === null && (await read($, handled)) !== '') await update($, handled, () => '')
    return isInPane ? `selection in a notes pane: ${(picked?.text ?? '').trim()}` : 'no selection'
  }
  const answered = await read($, handled)
  if (text === answered) return `already answered: ${text}`
  // Other text is selected: the answered one is no longer held, and selecting it again raises the pane.
  if (answered !== '') await update($, handled, () => '')
  if (text === current?.selection) return `pane already open: ${text}`
  // Opening the dock mid-drag reflows the transcript under the pointer, so the pane waits for a still selection.
  if (text !== seen) {
    seen = text
    stillSince = await $.clock.now()
    return `still changing: ${text}`
  }
  if (!(await isReleased($, text))) return `held, the clipboard has not taken it: ${text}`
  await openSelect($, text, picked?.requestId)
  return `opened: ${text}`
}

// Keeps an outcome only when it differs from the last one, so a quiet poll leaves one line.
function note(at: number, text: string): void {
  if (outcomes.at(-1)?.text === text) {
    outcomes[outcomes.length - 1] = { at, text }
    return
  }
  outcomes.push({ at, text })
  if (outcomes.length > OUTCOMES) outcomes.shift()
}

function ago(now: number, at: number): string {
  return `${((now - at) / 1000).toFixed(1)} s ago`
}

async function debug($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const picked = await $.ui.selection()
  const current = await read($, select)
  const panes = await $.ui.panes()
  return [
    `poll: ${ticks} ticks, ${lastTick === 0 ? 'never ran' : `last ${ago(now, lastTick)}, every ${POLL_MS} ms`}`,
    `selection now: ${picked === undefined ? 'none' : `${JSON.stringify(picked.text)} in row ${picked.requestId ?? 'none'}`}`,
    `select: ${current === null ? 'none' : JSON.stringify(current)}; handled: ${JSON.stringify(await read($, handled))}`,
    `panes: ${panes.length === 0 ? 'none' : panes.map(pane => `${pane.id}${pane.isShown ? ' shown' : ''}${pane.isFocused ? ' focused' : ''}`).join(', ')}`,
    `clipboard read: ${canPaste ? 'yes' : 'no'}; reflow pending: ${isReflowed ? 'yes' : 'no'}`,
    'last poll outcomes, oldest first:',
    ...outcomes.map(outcome => `  ${ago(now, outcome.at)}: ${outcome.text}`),
  ].join('\n')
}

// The notes file's # Chat, parsed once per change of it.
let parsedChat = { chat: '', notes: [] as ChatNote[] }

// Every anchored reply: those in the notes file, then those still queued.
async function allNotes($: EngineInterface): Promise<ChatNote[]> {
  const chat = (await read($, notes))?.sections.chat ?? ''
  if (chat !== parsedChat.chat) parsedChat = { chat, notes: chatNotes(chat) }
  const queued = (await read($, queue)).flatMap(pair => (pair.note === undefined ? [] : [{ ...pair.note, agent: pair.agent, user: pair.user }]))
  return [...parsedChat.notes, ...queued]
}

async function openNote($: EngineInterface, id: string): Promise<void> {
  await update($, noteOpen, () => id)
  await showNotes($, 'note')
}

function isDrawn(surface: string): boolean {
  return surface === 'terminal' || surface === 'desktop'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: NAME,
      description: 'Session notes: objectives, important, queued replies, history, show, hide',
      argumentHint: 'init|objectives|update|important|reply|replies|history|show|hide [text]',
    })
    resumed = (await $.session.messages()).length > 0
    // The transcript's marks read the notes file from state, which a new process starts without.
    await refresh($)
    void syncTodo($, '')
    if (e.isInteractive) {
      $.clock.every(POLL_MS, async () => {
        ticks += 1
        lastTick = await $.clock.now()
        try {
          note(lastTick, await poll($))
        } catch (error) {
          note(lastTick, `error: ${message(error)}`)
          throw error
        }
      })
      $.clock.every(REFRESH_MS, async () => {
        const panes = await $.ui.panes()
        if (panes.some(pane => pane.id === PANE)) await refresh($)
        await watchTodo($)
        await drainQueue($)
        await watchFleet($)
      })
    }
    return next(e)
  })

  // Laya reads the reply after the turn and runs beside the next one; nothing waits for it.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') void syncTodo($, e.answer)
    return done
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && done.skip === undefined) await $.store.set(compactedKey(await $.session.id()), true)
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') carried = await boundPath($)
    if (e.reason === 'clear') {
      await update($, queue, () => [])
      showQueue($, 0)
    }
    return next(e)
  })

  // The row the focus ring stands on is the note a, in the History list, attaches, and the todo item f and p step.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element?.startsWith(NOTE) === true) await update($, cursor, () => e.element?.slice(NOTE.length) ?? null)
    const id = rowId(e.element ?? '')
    if (id !== undefined) await update($, todoCursor, () => id)
    const task = e.element?.startsWith('work:') === true ? e.element.slice('work:'.length) : undefined
    if (task !== undefined && (await read($, fleet))?.rows.some(row => row.task === task) === true) await update($, workCursor, () => task)
    return next(e)
  })

  // A click on the pane presses its Button but leaves the keyboard where it was: after the press the pane takes it back,
  // and a click on a todo row's marker selects that row. An open before the press runs drops the press.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    const isFocused = (await $.ui.panes()).find(pane => pane.id === PANE)?.isFocused !== false
    const id = /^todo(?:#\d+)?:/.test(e.element) ? rowId(e.element) : undefined
    if (id !== undefined) {
      await update($, todoCursor, () => id)
      await $.ui.focus({ requestId: PANE, key: e.element }).catch(() => undefined)
    }
    const done = await next(e)
    if (!isFocused) await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return done
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === SELECT) {
      const current = await read($, select)
      if (current !== null) {
        await update($, handled, () => current.selection)
        await update($, select, () => null)
      }
      isReflowed = true
    }
    if (e.id === PANE) {
      await update($, editing, () => false)
      await update($, isNotesOpen, () => false)
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    // A command typed at the terminal or sent from the user's phone is the captain's; any other origin is not known to be.
    const actor: ActorId = e.origin.kind === 'composer' || e.origin.kind === 'bridge' ? 'captain' : 'unknown'
    const trimmed = e.args.trim()
    const sub = trimmed.split(/\s+/)[0] ?? ''
    const rest = trimmed.slice(sub.length).trim()
    try {
      switch (sub) {
        case 'init':
          return { text: await init($, rest, actor) }
        case 'objectives':
        case 'update':
          if (rest === '') return { text: `Usage: /notes-keeping ${sub} <text>` }
          return { text: await objectives($, rest, actor) }
        case 'important': {
          const text = rest || (await selected($))
          if (text === '') return { text: 'Nothing to keep: give text or select some first.' }
          return { text: await important($, text, rest === '' ? AGENT_TAG : USER_TAG) }
        }
        case 'reply': {
          const picked = await $.ui.selection()
          const agent = (picked?.text ?? '').trim()
          if (agent === '') return { text: 'Select the text to reply to first.' }
          if (rest === '') return { text: 'Usage: /notes-keeping reply <your reply>' }
          await queueReply($, agent, rest, picked?.requestId)
          return { text: 'Reply queued; it goes out with your next message.' }
        }
        case 'replies':
          await showNotes($, 'queue')
          return {}
        case 'todo':
          return { text: await todoCommand($, rest) }
        case 'history':
          return await history($, rest, actor)
        case 'show':
          await showNotes($)
          return {}
        case 'hide':
          await hideNotes($)
          return {}
        case 'debug':
          return { text: await debug($) }
        case '':
          return { text: USAGE }
        default:
          return { text: unknown(sub) }
      }
    } catch (error) {
      return { text: `notes-keeping: ${message(error)}` }
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await guard($, e.file_path)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: its notes guard failed.` }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await guard($, e.file_path)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: its notes guard failed.` }))

  // Queued replies go out ahead of the user's own Enter, and that turn is recorded in # Chat.
  // A compaction is the flag session.compact sets, or a changed first message where compaction puts its summary there.
  // Claude Code 2.1.312 keeps the first message, and fires session.compact for this plugin in a HOME with no other plugins;
  // a managed-settings plugin has bypassed classic.SessionStart, prompt.context and session.compact for user plugins.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const pending = e.origin.kind === 'composer' && e.isMeta !== true ? await read($, queue) : []
    let text = e.text
    if (pending.length > 0) {
      text = [...pending.map(pair => chatPair(pair.agent, pair.user)), e.text].join('\n\n')
      warn($, told('', await edit($, 'reply', md => addTurn(md, pending, e.text))))
      await update($, queue, () => [])
      showQueue($, 0)
    }
    const path = await boundPath($)
    const isResumed = resumed
    resumed = false
    if (path === undefined) return next({ ...e, text })
    const key = headKey(await $.session.id())
    const seen = await $.store.get(key)
    // Every summary opens with the same sentence, so the tail and the length tell two apart.
    const first = (await $.session.messages())[0]?.text ?? ''
    const head = `${first.length}:${first.slice(-HEAD_CHARS)}`
    // The first prompt reads an empty transcript; the head is the first message once there is one.
    if (first !== '') await $.store.set(key, head)
    const compactedAt = compactedKey(await $.session.id())
    const isCompacted = (await $.store.get(compactedAt)) === true
    if (isCompacted) await $.store.delete(compactedAt)
    const md = await readText($, path)
    // The whole file carries the todo list; every other prompt carries the list alone.
    const isWhole = isResumed || isCompacted || (typeof seen === 'string' && seen !== head)
    const todo = isWhole || e.isMeta === true ? undefined : context(sections(md).todo)
    const added = isWhole ? [inject(md, path)] : todo === undefined ? [] : [`${todo}\n${logsHint(path)}`]
    // The file the notes continue: once after a panel attach, and again with the whole notes file.
    // Only a notes file of the folder: the line can be edited by hand to name any path.
    const attachedAt = attachedKey(await $.session.id())
    const isAttached = e.isMeta !== true && (await $.store.get(attachedAt)) === true
    const continued = sections(md).continuation
    if ((isWhole || isAttached) && continued !== undefined && (await listNotes($)).includes(continued)) {
      const previous = `${await notesDir($)}/${continued}`
      added.push(injectPrevious(await readText($, previous), previous))
    }
    if (isAttached) await $.store.delete(attachedAt)
    if (added.length === 0) return next({ ...e, text })
    return next({ ...e, text, context: [...(e.context ?? []), ...added] })
  })

  // Under the prompt, beside the engine's hint: the Notes toggle, always drawn, pressed by click or chord.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!isDrawn(e.surface)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, isNotesOpen)
    const waiting = (await read($, queue)).length
    return (
      <Box flexDirection="row" gap={2}>
        <Text dimColor wrap="truncate-end">
          {e.props.hint}
        </Text>
        <Button
          key="notes-toggle"
          plain
          dimColor
          action={ACTION}
          label={`Notes: ${isOpen ? 'hide' : 'show'} (${CHORD})`}
          onPress={() => toggleNotes($)}
        />
        {waiting === 0 ? null : <Button key="send-queue" plain dimColor label={`[send queue: ${waiting}]`} onPress={() => sendQueue($)} />}
        {waiting === 0 ? null : <Button key="edit-queue" plain dimColor label="[edit queue]" onPress={() => showNotes($, 'queue')} />}
      </Box>
    )
  })

  // A reply block holding text a note was written on draws it as a link through the engine's own markdown; a click opens the note.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isDrawn(e.surface) || e.props.isSummary === true) return next(e)
    const here = (await allNotes($)).filter(note => note.row === e.requestId)
    if (here.length === 0) return next(e)
    const text = marked(e.props.text, here)
    if (text === e.props.text) return next(e)
    const { Box, Markdown, Text } = $.ui.resolve(e)
    // The tree replaces the engine's drawing of the row, its two-column gutter and the bullet opening a reply included.
    return (
      <Box flexDirection="row">
        <Text color="text">{e.props.isFirstOfReply ? BULLET : '  '}</Text>
        <Box flexGrow={1}>
          <Markdown
            key="notes"
            text={text}
            pressableLinks={here.map(note => hrefOf(note.id))}
            onLinkPress={link => {
              const id = noteOf(link.href)
              if (id !== undefined) return openNote($, id)
            }}
          />
        </Box>
      </Box>
    )
  })

  // The band carries the menu only when the selection pane could not be drawn (a narrow terminal).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, select)
    if (e.props.hasSurvey || current === null || current.mode !== 'menu' || current.isPlaced || !isDrawn(e.surface)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(10, (e.viewport?.columns ?? 80) - 40)
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">
          Selected: {current.selection.replace(/\s+/g, ' ').slice(0, width)}
        </Text>
        <Button key="reply-open" plain hotkey="1" action={ACTION} label="Reply" onPress={() => openReply($, current)} />
        <Button
          key="important"
          plain
          hotkey="2"
          label="Important"
          onPress={async () => {
            warn($, await important($, current.selection, AGENT_TAG))
            await finish($, current.selection)
          }}
        />
        <Button key="dismiss" plain hotkey="3" label="Dismiss" onPress={() => finish($, current.selection)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SELECT }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // The mobile app draws no field.
    const Input = 'Input' in table ? table.Input : undefined
    const current = await read($, select)
    if (current === null) return <Text dimColor>Nothing selected.</Text>
    const preview = current.selection.replace(/\s+/g, ' ')
    if (current.mode === 'reply') {
      if (Input === undefined) return <Text dimColor>Reply from a terminal or desktop: this surface draws no field.</Text>
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {AGENT_TAG} {preview}
          </Text>
          <Input
            key="reply"
            label={USER_TAG}
            placeholder="your reply; it goes out with your next message"
            submitLabel="queue"
            autoFocus
            onSubmit={async (value: string) => {
              if (value.trim() !== '') await queueReply($, current.selection, value.trim(), current.row)
            }}
          />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {AGENT_TAG} {preview}
        </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="reply-open" plain hotkey="r" action={ACTION} label="Reply" onPress={() => openReply($, current)} />
          <Button
            key="important"
            plain
            hotkey="i"
            label="Important"
            onPress={async () => {
              warn($, await important($, current.selection, AGENT_TAG))
              await finish($, current.selection)
            }}
          />
          <Button key="dismiss" plain hotkey="x" label="Dismiss" onPress={() => finish($, current.selection)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = table
    // The mobile app draws no field.
    const Input = 'Input' in table ? table.Input : undefined
    const current = await read($, notes)
    const isEditing = await read($, editing)
    const at = await read($, view)
    const list = await read($, queue)
    const s = current?.sections
    const rows: Todo[] = s === undefined ? [] : items(s.todo).map(item => ({ id: keyOf(item.text), status: item.status, text: shown(item) }))
    const hasObjectives = s !== undefined && s.objectives !== ''
    const go = (to: View) => async () => {
      await update($, editing, () => false)
      await update($, picked, () => null)
      await update($, view, () => to)
    }
    const tab = (key: string, hotkey: string, label: string, to: View) => (
      <Button key={`view:${key}`} plain hotkey={hotkey} dimColor={at !== to} label={label} onPress={go(to)} />
    )
    const step = await read($, picked)
    const work = await read($, fleet)
    const calls = needsYou(work).length
    const back = at === 'history' && step !== null ? async () => {
          await update($, picked, () => (step.step === 'confirm' ? { ...step, step: 'preview' } : null))
        } : at === 'work-item' ? go('work') : at === 'work-report' ? go('work-item') : go('todos')
    const nav = (
      <Box key="nav" flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        {tab('todos', 't', 'Todos', 'todos')}
        {tab('objectives', 'o', 'Objectives', 'objectives')}
        {work === null ? null : tab('work', 'w', calls === 0 ? 'Work' : `Work (${calls}!)`, 'work')}
        {tab('important', 'i', 'Important', 'important')}
        {tab('chat', 'c', 'Chat', 'chat')}
        {tab('queue', 'q', `Queue (${list.length})`, 'queue')}
        {tab('history', 'h', 'History', 'history')}
        {tab('logs', 'l', 'Logs', 'logs')}
        <Button key="send" plain hotkey="s" label="Send queue" onPress={() => sendQueue($)} />
        {at === 'todos' ? null : <Button key="view:back" plain hotkey="b" label="Back" onPress={back} />}
      </Box>
    )
    const hide = await read($, hidden)
    const selected = selectedOf(rows, hide, await read($, todoCursor))
    // Selects `id` after `write` changes which rows show, and moves the ring there. The engine keeps the ring at its
    // position through the redraw that drops or adds rows, and a focus on a row already drawn lands before that
    // redraw; the row is drawn under a key not drawn before, which the focus waits for.
    const handOver = async (id: string | undefined, write: () => Promise<unknown>) => {
      if (id !== undefined) landing = { id, count: (landing?.count ?? 0) + 1 }
      const key = id === undefined ? undefined : rowKey(id, landing)
      await write()
      await update($, todoCursor, () => id ?? null)
      // The engine answers {} or { deny }; `claude plugin test` has no ring and rejects.
      if (key !== undefined) await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    }
    const change = async (id: string, to: (status: Status) => Status) => {
      const item = rows.find(row => row.id === id)
      const write = () => clickItem($, id, to)
      await (item !== undefined && hide.includes(to(item.status)) ? handOver(nextShown(rows, id, hide), write) : write())
    }
    const slot = (
      <TodoSlot
        key="todos"
        Box={Box}
        Button={Button}
        Text={Text}
        todos={rows}
        hidden={hide}
        selected={selected}
        landing={landing}
        onCycle={id => change(id, cycle)}
        onOpen={async id => {
          await update($, todoOpen, () => id)
          await update($, view, () => 'item')
        }}
        onStep={(id, by) => change(id, status => stepStatus(status, by))}
        onSelect={async id => {
          await update($, todoCursor, () => id)
          // The engine answers {} or { deny }; `claude plugin test` has no ring and rejects.
          await $.ui.focus({ requestId: PANE, key: rowKey(id, landing) }).catch(() => undefined)
        }}
        onToggle={async status => {
          const now = hide.includes(status) ? hide.filter(other => other !== status) : [...hide, status]
          const at = rows.find(item => item.id === selected)
          const id = selectedOf(rows, now, at !== undefined && now.includes(at.status) ? (nextShown(rows, at.id, now) ?? null) : (selected ?? null))
          await handOver(id, () => update($, hidden, () => now))
        }}
      />
    )
    const hint = (text: string) => (
      <Text key="hint" dimColor>
        {text}
      </Text>
    )
    const body = (title: string, text: string) => (
      <Box key="body" flexDirection="column">
        <Text bold>{title}</Text>
        <Text dimColor={text === ''}>{text === '' ? '(empty)' : withoutIds(text)}</Text>
      </Box>
    )
    let content
    if ((at === 'work' || at === 'work-item' || at === 'work-report') && work !== null) {
      const now = await $.clock.now()
      const labels = labelsOf(current)
      const hideWork = await read($, workHidden)
      const shownRows = work.rows.filter(one => !hideWork.includes(groupOf(one)))
      const task = at === 'work' ? selectedRow(shownRows, await read($, workCursor)) : await read($, workOpen)
      const row = work.rows.find(one => one.task === task)
      const isAnswering = (await read($, workAnswering)) && row !== undefined && row.flag !== '' && Input !== undefined
      const item = row === undefined || row.todo === null || s === undefined ? undefined : items(s.todo).find(one => one.id === row.todo)
      const crewRead = await read($, crew)
      const reportText =
        at !== 'work-report' || row === undefined || row.report === null ? undefined : clipReport(await readText($, await reportPath($, row.report)).catch(() => undefined))
      const actions =
        row === undefined ? null : isAnswering && Input !== undefined ? (
          <Input
            key="work:reply"
            label={row.answer ?? row.task}
            placeholder="your answer; Enter puts it in the prompt, you send it"
            submitLabel="fill"
            autoFocus
            onSubmit={async (value: string) => {
              if (value.trim() === '') return
              const filled = await $.prompt.fill({ text: answerText(row, value.trim()), mode: 'insert' })
              if (!filled.isFilled) $.ui.toast('The prompt box cannot take the answer now.')
              await update($, workAnswering, () => false)
            }}
          />
        ) : (
          <Box key="work-actions" flexDirection="row" flexWrap="wrap" columnGap={2}>
            {row.flag === '' ? null : <Button
                key="work:answer"
                plain
                hotkey="a"
                label="answer"
                onPress={async () => {
                  await update($, workAnswering, () => true)
                  // The engine answers {} or { deny }; `claude plugin test` has no ring and rejects.
                  await $.ui.focus({ requestId: PANE, key: 'work:reply' }).catch(() => undefined)
                }}
              />}
            <Button
              key="work:copy"
              plain
              hotkey="y"
              label={at === 'work-report' ? 'copy report path' : row.pr !== null ? 'copy PR link' : row.report !== null ? 'copy report path' : 'copy task id'}
              onPress={async () => {
                const text = at === 'work-report' && row.report !== null ? row.report : copyText(row)
                const copied = await $.ui.copy({ text })
                $.ui.toast(copied.isCopied ? `Copied ${text}` : `notes-keeping: the copy did not take (${copied.reason})`)
              }}
            />
            {row.report === null || at === 'work-report' ? null : (
              <Button
                key="work:view"
                plain
                hotkey="v"
                label="read report"
                onPress={async () => {
                  await update($, workOpen, () => row.task)
                  await update($, workAnswering, () => false)
                  await update($, view, () => 'work-report')
                }}
              />
            )}
            {row.report === null ? null : <Button key="work:edit" plain hotkey="e" label="report in editor" onPress={() => editReport($, row.report ?? '')} />}
            {row.pr === null ? null : <Button key="work:pr" plain hotkey="u" label="open PR" onPress={() => $.process.run(['open', row.pr ?? ''], { timeoutMs: GIT_MS })} />}
            {row.live && row.window !== null ? <Button key="work:go" plain hotkey="g" label="go to worker" onPress={() => $.process.run(['tmux', 'switch-client', '-t', row.window ?? ''], { timeoutMs: GIT_MS })} /> : null}
            {row.word === 'call' ? null : (
              <Button
                key="work:crew"
                plain
                hotkey="r"
                label="re-read"
                onPress={async () => {
                  const bridge = await bridgeOf($)
                  if (bridge === undefined) return
                  const text = await runBridge($, bridge, 'crew', row.task).catch((error: unknown) => `failed: ${message(error)}`)
                  await update($, crew, () => ({ task: row.task, text }))
                  await update($, workOpen, () => row.task)
                  await update($, view, () => 'work-item')
                }}
              />
            )}
          </Box>
        )
      content =
        at === 'work' ? (
          <Box key="content" flexDirection="column">
            <WorkSlot
              Box={Box}
              Button={Button}
              Text={Text}
              fleet={work}
              labels={labels}
              hidden={hideWork}
              selected={row?.task}
              now={now}
              onOpen={async (one: string) => {
                await update($, workOpen, () => one)
                await update($, workAnswering, () => false)
                await update($, view, () => 'work-item')
              }}
              onToggle={(group: WorkGroup) => update($, workHidden, list => (list.includes(group) ? list.filter(other => other !== group) : [...list, group]))}
            />
            {actions}
            {hint('Up and Down select, Enter: details  v: read report  e: report in editor  u: open PR  a: answer (fills the prompt)  y: copy  g: go to worker  r: re-read  1-6 filters  b back')}
          </Box>
        ) : at === 'work-report' && row !== undefined ? (
          <Box key="content" flexDirection="column">
            {reportHead(row, now).map((line, i) => (
              <Text key={`work-head:${i}`} bold={i === 0} dimColor={i === 1}>
                {line}
              </Text>
            ))}
            <Box key="work-report-body" flexDirection="column" marginY={1}>
              {reportText === undefined ? (
                <Text>{`Cannot read ${row.report ?? 'a report'}: e opens it in the editor, y copies the path`}</Text>
              ) : (
                <Markdown key="work:report-text" text={reportText} />
              )}
            </Box>
            {actions}
            {hint('y: copy the report path  e: report in editor  u: open PR  a: answer (fills the prompt)  b back to the details')}
          </Box>
        ) : row === undefined ? (
          <Box key="content" flexDirection="column">
            <Text dimColor>This row is no longer in the fleet.</Text>
            {hint('b goes back')}
          </Box>
        ) : (
          <Box key="content" flexDirection="column">
            {details(row, nameOf(row, labels), now, item === undefined ? undefined : shown(item), crewRead?.task === row.task ? crewRead.text : undefined).map((line, i) => (
              <Text key={`work-line:${i}`}>{line}</Text>
            ))}
            {item === undefined ? null : (
              <Button
                key="work:item"
                plain
                hotkey="d"
                label="open the todo item"
                onPress={async () => {
                  await update($, todoOpen, () => keyOf(item.text))
                  await update($, view, () => 'item')
                }}
              />
            )}
            {actions}
            {hint('v: read report  e: report in editor  u: open PR  a: answer (fills the prompt)  y: copy  g: go to worker  r: re-read crew state  d: todo item  b back')}
          </Box>
        )
    } else if (at === 'history') {
      const dir = await notesDir($)
      const own = current?.path
      const names = (await listNotes($)).filter(name => own === undefined || !own.endsWith(`/${name}`))
      const open = (name: string, to: Opened['step']) => async () => {
        await update($, cursor, () => name)
        await update($, picked, () => ({ name, step: to }))
      }
      if (step !== null && step.step === 'confirm') {
        content = (
          <Box key="content" flexDirection="column">
            <Text bold>Attach {step.name}?</Text>
            <Text>Its objectives, updates and open todo items are copied into this session's notes. Done and declined items stay behind. The copy cannot be undone here; the original is not changed.</Text>
            <Box flexDirection="row" gap={2}>
              <Button
                key="confirm"
                plain
                hotkey="y"
                label="Yes, attach"
                onPress={async () => {
                  warn($, told('', (await attach($, step.name, 'captain')).said))
                  await $.store.set(attachedKey(await $.session.id()), true)
                  $.ui.toast(`Attached ${step.name}: its objectives, updates and open todo items are copied here; the original is unchanged.`)
                  await update($, picked, () => null)
                  await update($, view, () => 'todos')
                }}
              />
              <Button key="cancel" plain hotkey="n" autoFocus label="No, cancel" onPress={() => update($, picked, () => ({ ...step, step: 'preview' }))} />
            </Box>
            {hint('y attaches, n or b cancels')}
          </Box>
        )
      } else if (step !== null) {
        const t = sections(await readText($, `${dir}/${step.name}`).catch(() => ''))
        content = (
          <Box key="content" flexDirection="column">
            <Text bold>{step.name}</Text>
            <Button key="attach" plain hotkey="a" label="Attach this note" onPress={open(step.name, 'confirm')} />
            {body('Objectives', [t.continuation === undefined ? '' : `Continuation of: ${t.continuation}\n\n`, t.objectives].join('').trim())}
            {body('Updates', t.updates)}
            {body('Todo', t.todo)}
            {body('Important', t.important)}
            {body('Chat', t.chat)}
            {hint('Read-only. a attaches it after a confirmation, b goes back to the list')}
          </Box>
        )
      } else {
        const rows = await Promise.all(
          names.slice(0, HISTORY_CAP).map(async name => {
            const line = summary(await readText($, `${dir}/${name}`).catch(() => ''))
            const parts = nameParts(name)
            return { name, label: `${parts === undefined ? name : `${parts.date} ${parts.time}  ${parts.project}  ${parts.shortId}`}  ${line.slice(0, PREVIEW)}` }
          }),
        )
        const marked = await read($, cursor)
        content = (
          <Box key="content" flexDirection="column">
            <Text bold>Earlier notes ({names.length})</Text>
            {rows.length === 0 ? <Text dimColor>No earlier notes.</Text> : null}
            {rows.map((row, i) => (
              <Button key={`${NOTE}${row.name}`} plain autoFocus={i === 0 ? true : undefined} dimColor={marked !== row.name} label={row.label} onPress={open(row.name, 'preview')} />
            ))}
            {names.length > HISTORY_CAP ? <Text dimColor>{`(${names.length - HISTORY_CAP} older not listed)`}</Text> : null}
            {rows.length === 0 ? null : (
              <Button
                key="attach"
                plain
                hotkey="a"
                label="Attach selected"
                onPress={async () => {
                  const name = marked !== null && names.includes(marked) ? marked : undefined
                  if (name === undefined) $.ui.toast('Select a note first: Up and Down move, Enter shows it.')
                  else await update($, picked, () => ({ name, step: 'confirm' }))
                }}
              />
            )}
            {hint('Up and Down pick a note, Enter shows what it holds, a attaches the picked one after a confirmation. b goes back')}
          </Box>
        )
      }
    } else if (at === 'queue') {
      content = (
        <Box key="content" flexDirection="column">
          <Text bold>Queued replies ({list.length})</Text>
          {list.length === 0 ? <Text dimColor>No replies queued.</Text> : null}
          {list.map((pair, i) => (
            <Box key={`queued:${i}`} flexDirection="column" marginBottom={1}>
              <Text dimColor wrap="truncate-end">
                {AGENT_TAG} {pair.agent.replace(/\s+/g, ' ')}
              </Text>
              {Input === undefined ? (
                <Text>{`${USER_TAG} ${pair.user}`}</Text>
              ) : (
                <Input
                  key={`reply:${i}`}
                  label={USER_TAG}
                  value={pair.user}
                  submitLabel="keep"
                  onSubmit={async (value: string) => {
                    if (value.trim() !== '') await update($, queue, rows => rows.map((row, j) => (j === i ? { ...row, user: value.trim() } : row)))
                  }}
                />
              )}
              <Button
                key={`remove:${i}`}
                plain
                dimColor
                label="[remove]"
                onPress={async () => {
                  const next = await update($, queue, rows => rows.filter((_, j) => j !== i))
                  showQueue($, next.length)
                }}
              />
            </Box>
          ))}
          {hint('Tab to a reply, edit it, Enter keeps it. [remove] drops it. s sends all to the prompt, b goes back.')}
        </Box>
      )
    } else if (at === 'objectives') {
      const goals = s === undefined ? '' : [s.continuation === undefined ? '' : `Continuation of: ${s.continuation}\n\n`, s.objectives].join('').trim()
      const isBoxOpen = isEditing && Input !== undefined
      const control =
        isBoxOpen ? (
          <Input
            key="objectives"
            label="Objectives"
            placeholder={hasObjectives ? 'an update to the objectives' : 'the objectives of this session'}
            submitLabel="keep"
            autoFocus
            onInput={async (value: string) => {
              await update($, draft, () => value)
            }}
            onSubmit={async (value: string) => {
              if (value.trim() !== '') warn($, await objectives($, value.trim(), 'captain'))
              await update($, editing, () => false)
            }}
          />
        ) : (
          <Button
            key="objectives"
            plain
            hotkey="u"
            label={hasObjectives ? 'Update objectives' : 'Set objectives'}
            onPress={async () => {
              await update($, draft, () => '')
              await update($, editing, () => true)
            }}
          />
        )
      content = (
        <Box key="content" flexDirection="column">
          {control}
          <Button
            key="editor"
            plain
            hotkey="e"
            {...(isBoxOpen && hasObjectives ? { action: EDITOR_ACTION } : {})}
            label="Open in editor"
            onPress={() => openEditor($, isBoxOpen && hasObjectives)}
          />
          {body('Objectives', goals)}
          {body('Updates', s?.updates ?? '')}
          {hint(
            isBoxOpen && hasObjectives
              ? `Enter keeps it, ${EDITOR_CHORD} writes it in your editor`
              : `${hasObjectives ? 'u adds an update under Updates' : 'u sets the objectives'}, Enter keeps it, e opens the notes file in your editor, b goes back`,
          )}
        </Box>
      )
    } else if (at === 'logs') {
      const all = readRows(s?.logs ?? '').reverse()
      content = (
        <Box key="content" flexDirection="column">
          <Text bold>Logs ({all.length}), newest first</Text>
          {all.length === 0 ? <Text dimColor>No actions logged yet.</Text> : null}
          {all.slice(0, LOG_ROWS).map((one, i) => (
            <Text key={`log:${i}`} wrap="truncate-end">
              {[one.time.replace('T', ' ').replace(/Z$/, ''), actorLabel(one.actor), one.item.replace(/^id:[a-z0-9]+ /, ''), one.change === '-' ? one.note : one.change].join('  ')}
            </Text>
          ))}
          {all.length > LOG_ROWS ? <Text dimColor>{`(${all.length - LOG_ROWS} older in the # Logs section of the notes file)`}</Text> : null}
          {hint('Read-only. Times are UTC. b goes back')}
        </Box>
      )
    } else if (at === 'item') {
      const openId = await read($, todoOpen)
      const item = s === undefined ? undefined : items(s.todo).find(one => keyOf(one.text) === openId)
      const from = s === undefined || item === undefined ? undefined : sourceOf(s, item)
      content =
        item === undefined ? (
          <Box key="content" flexDirection="column">
            <Text dimColor>This item is no longer in the todo list.</Text>
            {hint('b goes back')}
          </Box>
        ) : (
          <Box key="content" flexDirection="column">
            <Text bold>{item.label ?? 'Item'}</Text>
            <Text>{legend(item.status)}</Text>
            <Text>{item.text}</Text>
            {from === undefined ? (
              <Text dimColor>No objective or update holds this item: it was written in the todo list.</Text>
            ) : (
              body(from.section === 'objectives' ? 'From the objectives' : 'From an update', from.text)
            )}
            {hint('Read-only. b goes back')}
          </Box>
        )
    } else if (at === 'note') {
      const openId = await read($, noteOpen)
      const one = (await allNotes($)).find(note => note.id === openId)
      const isQueued = list.some(pair => pair.note?.id === openId)
      content = (
        <Box key="content" flexDirection="column">
          {one === undefined ? <Text dimColor>This note is no longer in the notes file or the queue.</Text> : null}
          {one === undefined ? null : <Text dimColor>{`${AGENT_TAG} ${one.agent}`}</Text>}
          {one === undefined ? null : <Text>{`${USER_TAG} ${one.user}`}</Text>}
          {isQueued ? <Text dimColor>Queued: it goes out with your next message.</Text> : null}
          {hint('Read-only. b goes back')}
        </Box>
      )
    } else if (at === 'important') {
      content = body('Important', s?.important ?? '')
    } else if (at === 'chat') {
      content = body('Chat', s?.chat ?? '')
    } else {
      content = (
        <Box key="content" flexDirection="column">
          {slot}
          {current === null ? <Text dimColor>No notes for this session yet; the first write starts them.</Text> : <Text dimColor wrap="truncate-start">{current.path}</Text>}
          {hint('t todos, o objectives (u adds an update there), i important, c chat, q queue, h history, l logs, s send queue, Esc closes')}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {nav}
        {content}
      </Box>
    )
  })
}
