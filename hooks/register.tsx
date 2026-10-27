import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Notes, Pair, Select, Todo, View } from '../types'
import {
  AGENT_TAG,
  USER_TAG,
  addChat,
  addImportant,
  addSession,
  addTurn,
  addUpdate,
  carryOver,
  chatPair,
  create,
  fileName,
  inject,
  nameParts,
  newestFirst,
  projectName,
  sections,
  setObjectives,
  setTodo,
  stamp,
  summary,
} from './notes'
import { EMPTY, bridgeMoves, candidates, cleanLabel, context, cycleItem, diffSnapshot, format, isBackground, items, keyOf, keysOf, labelPrompt, moved, parse, pin, reconcile, row, settle, shown, snapshotOf } from './todo'
import type { Applied, Item, Memory, Move, Status, Verdict } from './todo'
import { TodoSlot } from './todos'

const NAME = 'notes-keeping'
const PANE = 'notes-keeping'
const SELECT = 'notes-keeping-select'
const TITLE = 'Notes'
const DIR = '.notes-keeping'
// An engine action with no handler mounted at the prompt; a Global binding of the chord in the user's keybindings.json presses it.
const ACTION = 'app:cycleDiffBase'
const CHORD = 'ctrl+q'
const GIT_MS = 10_000
const POLL_MS = 600
const REFRESH_MS = 5_000
const PREVIEW = 60
const HISTORY_CAP = 20
const HEAD_CHARS = 200
const NEAR = 2

const LAYA_PYTHON = '.laya-venv/bin/python'
const LAYA_MS = 60_000
const LABEL_MODEL = 'haiku'
const LABEL_MS = 20_000
const LOG = 'todo-changes.log'
// An executable under the session root, run only when present: `status` reports linked items' statuses, `notify` takes changes on stdin.
const BRIDGE = 'config/notes-keeping-bridge'
const BRIDGE_MS = 10_000

const SUBCOMMANDS = ['init', 'objectives', 'update', 'important', 'reply', 'replies', 'todo', 'history', 'show', 'hide']

const USAGE = [
  'Usage: /notes-keeping <subcommand>',
  '  init [--new] [objectives]  start this session\'s notes; text sets the objectives',
  '  objectives <text>          set the objectives; once set, add an [UPDATE] under ## Updates',
  '  update <text>              same as objectives',
  '  important [text]           add text, or the selected text, to # Important',
  '  reply <text>               queue the selected text and your reply; they go out with your next message',
  '  replies                    open the panel at the queue: every reply editable, s moves all into the prompt',
  '  todo [sync]                show the todo list; sync runs Laya over the objectives and the last reply now',
  '  history [n|file]           list earlier notes; pick one to copy its objectives, updates and todo items here',
  `  show | hide                open or close the notes panel (also ${CHORD}) at the todo list; t todos, o objectives, i important, c chat, e queue, h history, s send queue`,
  `${CHORD} works once ~/.claude/keybindings.json binds it: { "bindings": [{ "context": "Global", "bindings": { "${CHORD}": "${ACTION}" } }] }`,
  'Every write starts the notes file when the session has none.',
].join('\n')

const notes = atom({ plugin: 'notes-keeping', key: 'notes' } as const, null as Notes | null)
const select = atom({ plugin: 'notes-keeping', key: 'select' } as const, null as Select | null)
const handled = atom({ plugin: 'notes-keeping', key: 'handled' } as const, '')
const queue = atom({ plugin: 'notes-keeping', key: 'queue' } as const, [] as Pair[])
const editing = atom({ plugin: 'notes-keeping', key: 'editing' } as const, false)
const view = atom({ plugin: 'notes-keeping', key: 'view' } as const, 'todos' as View)
const isNotesOpen = atom({ plugin: 'notes-keeping', key: 'isNotesOpen' } as const, false)

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error'
}

function bindKey(sessionId: string): string {
  return `session:${sessionId}`
}

function headKey(sessionId: string): string {
  return `head:${sessionId}`
}

// The file a /clear or a /resume left behind; the next session id to look for its notes takes it.
let carried: string | undefined
// A session that starts with messages was continued or resumed: its first prompt carries the notes.
let resumed = false
// The selection the last poll read: a drag still under way changes it between polls.
let seen = ''
// Closing the dock widens the transcript, and the kept selection then covers other text.
let isClosed = false
// The bar stands in for a pane the terminal cannot seat: the reason is told once, not on every selection.
let isTold = false

async function boundPath($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  const path = await $.store.get(bindKey(id))
  if (typeof path === 'string') return path
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

async function runBridge($: EngineInterface, bridge: string, verb: 'status' | 'notify', path: string, stdin = ''): Promise<string> {
  const done = await $.process.run([bridge, verb, path], { stdin, timeoutMs: BRIDGE_MS })
  if (done.exitCode !== 0) throw new Error(`bridge ${verb} failed: ${done.stderr.trim().split('\n').pop() || done.exitCode}`)
  return done.stdout
}

type Link = { status: Status | undefined; task: string }

// Every linked item by key; status is undefined when the linked task has no state to report.
async function linked($: EngineInterface, bridge: string, path: string): Promise<Record<string, Link>> {
  const raw = JSON.parse(await runBridge($, bridge, 'status', path)) as Record<string, { status?: unknown; task?: unknown }>
  const links: Record<string, Link> = {}
  for (const [text, link] of Object.entries(raw)) {
    const status = link.status === 'in-progress' || link.status === 'done' ? link.status : undefined
    links[keyOf(text)] = { status, task: typeof link.task === 'string' ? link.task : '' }
  }
  return links
}

// Diffs the list against the last snapshot and stores the new one; called inside `locked` with the list as read and as written.
async function snapshot($: EngineInterface, path: string, before: readonly Item[], after: readonly Item[]): Promise<string[]> {
  const saved = await $.store.get(snapshotKey(path))
  const changes = diffSnapshot(typeof saved === 'object' && saved !== null ? (saved as Record<string, Status>) : undefined, before, after)
  await $.store.set(snapshotKey(path), snapshotOf(after))
  return changes
}

async function notify($: EngineInterface, bridge: string, path: string, changes: readonly string[]): Promise<void> {
  if (changes.length === 0) return
  try {
    await runBridge($, bridge, 'notify', path, `${changes.join('\n')}\n`)
  } catch (error) {
    $.ui.toast(`notes-keeping todo: ${message(error)}`)
  }
}

// A captain's hand edit made while no todo run happens is noticed here.
async function watchTodo($: EngineInterface): Promise<void> {
  const bridge = await bridgeOf($)
  if (bridge === undefined) return
  const path = await boundPath($)
  if (path === undefined) return
  const changes = await locked(async () => {
    const list = items(sections(await readText($, path)).todo)
    return snapshot($, path, list, list)
  })
  await notify($, bridge, path, changes)
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

// One line per status Laya or the bridge changed, committed with the file, so a change can be reviewed; a hand-set status it replaced says so.
async function logMoves($: EngineInterface, path: string, moves: readonly Applied[], verdicts: Record<string, Verdict>, links: Record<string, Link>): Promise<void> {
  const log = `${await notesDir($)}/${LOG}`
  const when = stamp(await $.clock.now())
  const rows = moves.map(move => {
    const key = keyOf(move.text)
    const verdict = verdicts[key]
    const link = links[key]
    const said = link !== undefined ? ` | firstmate ${link.task}` : verdict === undefined ? '' : ` | laya ${verdict.label} ${verdict.p.toFixed(2)}`
    return `${when} ${path.split('/').pop()} | ${move.text} | ${move.from} -> ${move.to}${said}${move.isHandSet ? ' | replaced a hand-set status' : ''}`
  })
  const before = (await $.fs.exists(log)) ? await readText($, log) : ''
  await $.fs.write(log, `${before}${rows.join('\n')}\n`)
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
  const have = new Set(list.map(item => keyOf(item.text)))
  const isHad = (text: string) => keysOf(text).some(key => have.has(key))
  const fresh = candidates(s).filter(c => !keysOf(c.text).some(key => memory.seen.includes(key)))
  const lines = fresh.filter(c => !c.isUpdate && !isHad(c.text)).map(c => ({ id: keyOf(c.text), text: c.text }))
  // A linked item's status follows its firstmate task; Laya is not asked about it.
  const open = list.filter(item => (item.status === 'todo' || item.status === 'in-progress') && links[keyOf(item.text)] === undefined)
  const statuses = answer.trim() === '' ? [] : open.map(item => ({ id: keyOf(item.text), text: item.text }))
  const laya = lines.length + statuses.length === 0 ? undefined : await askLaya($, { lines, statuses, answer })
  const add: Item[] = []
  const seen: string[] = []
  for (const c of fresh) {
    const key = keyOf(c.text)
    if (isHad(c.text) || c.isUpdate) {
      seen.push(key)
      if (!isHad(c.text)) add.push({ status: 'todo', text: c.text })
      continue
    }
    const p = laya?.lines[key]
    if (p === undefined) continue
    seen.push(key)
    if (!isBackground(p)) add.push({ status: 'todo', text: c.text })
  }
  const set: Record<string, Move> = {}
  for (const item of statuses.length === 0 ? [] : open) {
    const next = moved(item, answer, laya?.statuses[keyOf(item.text)])
    if (next !== undefined) set[keyOf(item.text)] = { from: item.status, to: next }
  }
  const reported: Record<string, Status> = {}
  for (const [key, link] of Object.entries(links)) if (link.status !== undefined) reported[key] = link.status
  Object.assign(set, bridgeMoves(list, reported, memory))
  const unlabeled = [...list.filter(item => item.label === undefined && !memory.labeled.includes(keyOf(item.text))), ...add]
  const named = await Promise.all(unlabeled.map(async item => [keyOf(item.text), await askLabel($, item.text)] as const))
  const labels: Record<string, string> = {}
  for (const [key, label] of named) if (label !== undefined) labels[key] = label
  const labeled = named.map(([key]) => key)
  const added = add.map(item => (labels[keyOf(item.text)] === undefined ? item : { ...item, label: labels[keyOf(item.text)] }))
  // The file may have changed while Laya ran: apply onto what is there now.
  const { said, changes } = await locked(async () => {
    const latest = await readText($, path)
    const body = sections(latest).todo
    const out = reconcile(body, await readMemory($, path), { add: added, set, seen, labels, labeled, bridge: reported })
    await $.store.set(memoryKey(path), out.memory)
    const changes = bridge === undefined ? [] : await snapshot($, path, items(body), items(out.body))
    if (out.body === format(parse(body))) return { said: [], changes }
    if (out.applied.length > 0) await logMoves($, path, out.applied, laya?.statuses ?? {}, links)
    return { said: await save($, path, setTodo(latest, out.body), 'todo'), changes }
  })
  warn($, told('', said))
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

// A click sets the next status. It counts as set by hand: the log says so when Laya later changes it.
async function clickItem($: EngineInterface, key: string): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  const bridge = await bridgeOf($)
  const changes = await locked(async () => {
    await $.store.set(memoryKey(path), pin(await readMemory($, path), key))
    const md = await readText($, path)
    const body = cycleItem(sections(md).todo, key)
    await save($, path, setTodo(md, body), 'todo')
    return bridge === undefined ? [] : await snapshot($, path, items(body), items(body))
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
async function objectives($: EngineInterface, text: string): Promise<string> {
  const { path, said } = await bound($)
  const when = stamp(await $.clock.now())
  const { isSet, written } = await locked(async () => {
    const md = await readText($, path)
    const isSet = sections(md).objectives === ''
    return { isSet, written: await save($, path, isSet ? setObjectives(md, text) : addUpdate(md, when, text), isSet ? 'objectives' : 'update') }
  })
  void syncTodo($, '')
  return told(isSet ? 'Objectives set.' : 'Objectives updated under ## Updates.', [...said, ...written])
}

async function init($: EngineInterface, args: string): Promise<string> {
  const isNew = /^--new\b/.test(args)
  const text = args.replace(/^--new\b\s*/, '').trim()
  const current = await boundPath($)
  if (current !== undefined && !isNew) {
    if (text === '') return `This session already keeps ${current}. Run /notes-keeping init --new [objectives] to start a new file for it.`
    return told(`This session keeps ${current}.`, [await objectives($, text)])
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
async function attach($: EngineInterface, pick: string): Promise<{ previous: string; said: string[] }> {
  const dir = await notesDir($)
  const previous = await readText($, `${dir}/${pick}`)
  const said = await edit($, 'continue', text => carryOver(text, previous, pick))
  // Lines the linked file's todo run already judged are not asked again here.
  const path = await boundPath($)
  if (path !== undefined) {
    await locked(async () => {
      const mine = await readMemory($, path)
      const seen = [...new Set([...mine.seen, ...(await readMemory($, `${dir}/${pick}`)).seen])]
      await $.store.set(memoryKey(path), { ...mine, seen })
    })
  }
  return { previous, said }
}

async function history($: EngineInterface, args: string): Promise<{ text: string; context?: string[] }> {
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
  const { previous, said } = await attach($, pick)
  return {
    text: told(`Continuing ${pick}: its objectives, updates and todo items are copied here; ${pick} is unchanged. The whole file is now in context.`, said),
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

async function selected($: EngineInterface): Promise<string> {
  return ((await $.ui.selection())?.text ?? '').trim()
}

async function important($: EngineInterface, text: string, tag: string): Promise<string> {
  return told('Added to # Important.', await edit($, 'important', md => addImportant(md, tag, text)))
}

function showQueue($: EngineInterface, n: number): void {
  $.ui.status(n === 0 ? undefined : `notes: ${n} repl${n === 1 ? 'y' : 'ies'} queued, sent with your next message. Ctrl+q: edit, remove, send`)
}

// The selection is answered: the same text does not raise the pane again until it changes.
async function finish($: EngineInterface, selection: string): Promise<void> {
  await update($, handled, () => selection)
  await update($, select, () => null)
  await $.ui.close({ id: SELECT })
  isClosed = true
}

async function queueReply($: EngineInterface, agent: string, user: string): Promise<void> {
  const next = await update($, queue, list => [...list, { agent, user }])
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
  warn($, told('', await edit($, 'reply', md => pending.reduce((text, pair) => addChat(text, pair.agent, pair.user), md))))
  await update($, queue, () => [])
  showQueue($, 0)
}

// An open notes pane holding the keyboard refuses the selection pane's focus and keeps it a tab behind, so it closes first.
async function openSelect($: EngineInterface, selection: string): Promise<void> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) await hideNotes($)
  await update($, select, () => ({ mode: 'menu', selection, isPlaced: false, hadFocus: false }))
  const opened = await $.ui.open({ id: SELECT, title: 'Selection', focus: true, closeOnEscape: true, rows: 4 })
  await update($, select, current => (current === null ? null : { ...current, isPlaced: opened.isPlaced }))
  if (!opened.isPlaced && !isTold) {
    isTold = true
    $.ui.toast(`The selection panel waits for a wider terminal (${opened.reason}); use the bar above the prompt: 1 Reply, 2 Important, 3 Dismiss.`)
  }
}

async function openReply($: EngineInterface, selection: string): Promise<void> {
  await update($, select, () => ({ mode: 'reply', selection, isPlaced: true, hadFocus: false }))
  await $.ui.open({ id: SELECT, title: 'Reply', focus: true, closeOnEscape: true, rows: 4 })
}

async function refresh($: EngineInterface): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  await publish($, path, await readText($, path))
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
    void syncTodo($, '')
    if (e.isInteractive) {
      $.clock.every(POLL_MS, async () => {
        const current = await read($, select)
        if (current?.mode === 'reply') return
        const selectPane = (await $.ui.panes()).find(pane => pane.id === SELECT)
        const isFocused = selectPane?.isFocused === true
        // A key that is none of r/i/x hands the keyboard back to the prompt: the menu goes with it.
        // A click on another tab hides the pane instead: it stays behind its tab until shown again.
        if (current !== null && current.hadFocus && !isFocused) {
          if (selectPane !== undefined && !selectPane.isShown) await update($, select, () => ({ ...current, hadFocus: false }))
          else await finish($, current.selection)
          return
        }
        if (current !== null && isFocused && !current.hadFocus) await update($, select, () => ({ ...current, hadFocus: true }))
        const text = await selected($)
        // The first selection read after a close is the old one, moved by the reflow: it counts as answered.
        if (isClosed) {
          isClosed = false
          if (text !== '') await update($, handled, () => text)
          return
        }
        // A docked pane narrows the transcript and the terminal drops the selection, so an open pane outlives it.
        if (text === '') {
          seen = ''
          if (current !== null && !current.isPlaced) await update($, select, () => null)
          if (current === null && (await read($, handled)) !== '') await update($, handled, () => '')
          return
        }
        if (text === (await read($, handled)) || text === current?.selection) return
        // Opening the dock mid-drag reflows the transcript under the pointer, so the pane waits for a still selection.
        if (text !== seen) {
          seen = text
          return
        }
        await openSelect($, text)
      })
      $.clock.every(REFRESH_MS, async () => {
        const panes = await $.ui.panes()
        if (panes.some(pane => pane.id === PANE)) await refresh($)
        await watchTodo($)
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

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') carried = await boundPath($)
    if (e.reason === 'clear') {
      await update($, queue, () => [])
      showQueue($, 0)
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === SELECT) {
      const current = await read($, select)
      if (current !== null) {
        await update($, handled, () => current.selection)
        await update($, select, () => null)
      }
      isClosed = true
    }
    if (e.id === PANE) {
      await update($, editing, () => false)
      await update($, isNotesOpen, () => false)
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const trimmed = e.args.trim()
    const sub = trimmed.split(/\s+/)[0] ?? ''
    const rest = trimmed.slice(sub.length).trim()
    try {
      switch (sub) {
        case 'init':
          return { text: await init($, rest) }
        case 'objectives':
        case 'update':
          if (rest === '') return { text: `Usage: /notes-keeping ${sub} <text>` }
          return { text: await objectives($, rest) }
        case 'important': {
          const text = rest || (await selected($))
          if (text === '') return { text: 'Nothing to keep: give text or select some first.' }
          return { text: await important($, text, rest === '' ? AGENT_TAG : USER_TAG) }
        }
        case 'reply': {
          const agent = await selected($)
          if (agent === '') return { text: 'Select the text to reply to first.' }
          if (rest === '') return { text: 'Usage: /notes-keeping reply <your reply>' }
          await queueReply($, agent, rest)
          return { text: 'Reply queued; it goes out with your next message.' }
        }
        case 'replies':
          await showNotes($, 'queue')
          return {}
        case 'todo':
          return { text: await todoCommand($, rest) }
        case 'history':
          return await history($, rest)
        case 'show':
          await showNotes($)
          return {}
        case 'hide':
          await hideNotes($)
          return {}
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
  // Compaction puts its summary in place of the first message, so a changed first message means one ran.
  // On this machine the managed-settings plugin bypasses classic.SessionStart, prompt.context and
  // session.compact for user plugins; prompt.submit is the hook that still reaches the model.
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
    await $.store.set(key, head)
    const md = await readText($, path)
    // The whole file carries the todo list; every other prompt carries the list alone.
    const isWhole = isResumed || (typeof seen === 'string' && seen !== head)
    const todo = isWhole || e.isMeta === true ? undefined : context(sections(md).todo)
    const added = isWhole ? [inject(md, path)] : todo === undefined ? [] : [todo]
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
        <Button key="reply-open" plain hotkey="1" action={ACTION} label="Reply" onPress={() => openReply($, current.selection)} />
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
              if (value.trim() !== '') await queueReply($, current.selection, value.trim())
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
          <Button key="reply-open" plain hotkey="r" action={ACTION} label="Reply" onPress={() => openReply($, current.selection)} />
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
    const { Box, Button, Text } = table
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
      await update($, view, () => to)
    }
    const tab = (key: string, hotkey: string, label: string, to: View) => (
      <Button key={`view:${key}`} plain hotkey={hotkey} dimColor={at !== to} label={label} onPress={go(to)} />
    )
    const nav = (
      <Box key="nav" flexDirection="row" gap={2} marginBottom={1}>
        {tab('todos', 't', 'Todos', 'todos')}
        {tab('objectives', 'o', 'Objectives', 'objectives')}
        {tab('important', 'i', 'Important', 'important')}
        {tab('chat', 'c', 'Chat', 'chat')}
        {tab('queue', 'e', `Queue (${list.length})`, 'queue')}
        {tab('history', 'h', 'History', 'history')}
        <Button key="send" plain hotkey="s" label="Send queue" onPress={() => sendQueue($)} />
        {at === 'todos' ? null : <Button key="view:back" plain hotkey="b" label="Back" onPress={go('todos')} />}
      </Box>
    )
    const slot = (
      <TodoSlot
        key="todos"
        Box={Box}
        Button={Button}
        Text={Text}
        todos={rows}
        onCycle={id => clickItem($, id)}
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
        <Text dimColor={text === ''}>{text === '' ? '(empty)' : text}</Text>
      </Box>
    )
    let content
    if (at === 'history') {
      const dir = await notesDir($)
      const own = current?.path
      const names = (await listNotes($)).filter(name => own === undefined || !own.endsWith(`/${name}`))
      const rows = await Promise.all(
        names.slice(0, HISTORY_CAP).map(async name => {
          const line = summary(await readText($, `${dir}/${name}`).catch(() => ''))
          const parts = nameParts(name)
          return { name, label: `${parts === undefined ? name : `${parts.date} ${parts.time}  ${parts.project}  ${parts.shortId}`}  ${line.slice(0, PREVIEW)}` }
        }),
      )
      content = (
        <Box key="content" flexDirection="column">
          <Text bold>Earlier notes ({names.length})</Text>
          {rows.length === 0 ? <Text dimColor>No earlier notes.</Text> : null}
          {rows.map(row => (
            <Button
              key={`attach:${row.name}`}
              plain
              label={row.label}
              onPress={async () => {
                warn($, told('', (await attach($, row.name)).said))
                $.ui.toast(`Attached ${row.name}: its objectives, updates and todo items are copied here; the original is unchanged.`)
                await go('todos')()
              }}
            />
          ))}
          {names.length > HISTORY_CAP ? <Text dimColor>{`(${names.length - HISTORY_CAP} older not listed)`}</Text> : null}
          {hint('Tab to a file, Enter attaches a copy of it to this session. b goes back')}
        </Box>
      )
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
      const control =
        isEditing && Input !== undefined ? (
          <Input
            key="objectives"
            label="Objectives"
            placeholder={hasObjectives ? 'an update to the objectives' : 'the objectives of this session'}
            submitLabel="keep"
            autoFocus
            onSubmit={async (value: string) => {
              if (value.trim() !== '') warn($, await objectives($, value.trim()))
              await update($, editing, () => false)
            }}
          />
        ) : (
          <Button
            key="objectives"
            plain
            hotkey="u"
            label={hasObjectives ? 'Update objectives' : 'Set objectives'}
            onPress={() => update($, editing, () => true)}
          />
        )
      content = (
        <Box key="content" flexDirection="column">
          {control}
          {body('Objectives', goals)}
          {body('Updates', s?.updates ?? '')}
          {hint(hasObjectives ? 'u adds an update under Updates, Enter keeps it, b goes back' : 'u sets the objectives, Enter keeps it, b goes back')}
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
          {hint('t todos, o objectives (u adds an update there), i important, c chat, e queue, h history, s send queue, Esc closes')}
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
