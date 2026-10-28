import type { NameParts, Sections } from '../types'
import type { Item } from './todo'
import { format, idOf, items, keyOf, openObjectives, parse, stamped, withoutIds } from './todo'

export const OBJECTIVES = '# Objectives'
export const UPDATES = '## Updates'
export const TODO = '# Todo'
export const IMPORTANT = '# Important'
export const CHAT = '# Chat'
export const AGENT_TAG = '[AI_AGENT]'
export const USER_TAG = '[USER]'
export const CONTINUATION = 'Continuation of:'
export const SESSIONS = 'Sessions:'

// Headings a file may open with: this mod's, a hand-written one, and the one files before Objectives used.
const OBJECTIVE_HEADINGS = [OBJECTIVES, '# Goals', '# Initial Prompt']
const HEADINGS = [...OBJECTIVE_HEADINGS, UPDATES, TODO, IMPORTANT, CHAT]
const NAME = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(.+)-([0-9a-zA-Z]{8})(?:-(\d+))?\.md$/
const HEAD_LINE = new RegExp(`^(${CONTINUATION}|${SESSIONS}) (.*)(?:\\n+|$)`)

const pad = (n: number) => String(n).padStart(2, '0')

export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`
}

export function stampKey(name: string): string | undefined {
  const m = NAME.exec(name)
  if (m === null) return undefined
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${(m[8] ?? '0').padStart(4, '0')}`
}

export function nameParts(name: string): NameParts | undefined {
  const m = NAME.exec(name)
  if (m === null) return undefined
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, project: m[6] ?? '', shortId: m[7] ?? '' }
}

export function isNotesFile(name: string): boolean {
  return stampKey(name) !== undefined
}

export function projectName(dir: string): string {
  return dir.replace(/\/+$/, '').split('/').pop() || 'root'
}

export function fileName(project: string, sessionId: string, ms: number, taken: readonly string[]): string {
  const base = `${stamp(ms)}-${project}-${sessionId.slice(0, 8)}`
  if (!taken.includes(`${base}.md`)) return `${base}.md`
  let n = 2
  while (taken.includes(`${base}-${n}.md`)) n++
  return `${base}-${n}.md`
}

export function newestFirst(names: readonly string[]): string[] {
  const key = (name: string) => stampKey(name) ?? ''
  return names.filter(isNotesFile).sort((a, b) => (key(b) < key(a) ? -1 : key(b) > key(a) ? 1 : 0))
}

// A line of inserted text that equals a section heading would split the file on the next parse.
function escapeHeadings(text: string): string {
  return text
    .split('\n')
    .map(line => (HEADINGS.includes(line.trimEnd()) ? `\\${line}` : line))
    .join('\n')
}

export function create(objectives: string, sessionId: string): string {
  const body = escapeHeadings(objectives.trim())
  return `${OBJECTIVES}\n\n${SESSIONS} ${sessionId}\n\n${body === '' ? '' : `${body}\n\n`}${UPDATES}\n\n${IMPORTANT}\n\n${CHAT}\n`
}

type Initial = { continuation: string | undefined; sessions: string[]; body: string }

// The Continuation of: and Sessions: lines open the objectives section, before its body.
function readInitial(text: string): Initial {
  const out: Initial = { continuation: undefined, sessions: [], body: '' }
  let rest = text
  for (let m = HEAD_LINE.exec(rest); m !== null; m = HEAD_LINE.exec(rest)) {
    if (m[1] === CONTINUATION) out.continuation = m[2]
    else out.sessions = (m[2] ?? '').split(',').map(id => id.trim()).filter(id => id !== '')
    rest = rest.slice(m[0].length)
  }
  out.body = rest.trim()
  return out
}

function writeInitial(initial: Initial): string {
  return [
    initial.continuation === undefined ? '' : `${CONTINUATION} ${initial.continuation}`,
    initial.sessions.length === 0 ? '' : `${SESSIONS} ${initial.sessions.join(', ')}`,
    initial.body,
  ]
    .filter(part => part !== '')
    .join('\n\n')
}

function lineStart(md: string, heading: string, from = 0): number {
  const lines = md.split('\n')
  let at = 0
  for (const line of lines) {
    if (at >= from && line.trimEnd() === heading) return at
    at += line.length + 1
  }
  return -1
}

// The first objectives heading in the file, as written there.
function objectivesStart(md: string): { start: number; heading: string } | undefined {
  const found = OBJECTIVE_HEADINGS.map(heading => ({ start: lineStart(md, heading), heading })).filter(f => f.start >= 0)
  return found.sort((a, b) => a.start - b.start)[0]
}

function sectionEnd(md: string, start: number, stops: readonly string[]): number {
  const ends = stops.map(h => lineStart(md, h, start + 1)).filter(i => i > start)
  return ends.length === 0 ? md.length : Math.min(...ends)
}

function ensure(md: string): string {
  let out = md.trimEnd()
  if (objectivesStart(out) === undefined) out = `${OBJECTIVES}\n\n${out}`.trimEnd()
  if (lineStart(out, UPDATES) < 0) {
    const at = [TODO, IMPORTANT, CHAT].map(h => lineStart(out, h)).filter(i => i >= 0)
    const cut = at.length === 0 ? out.length : Math.min(...at)
    out = `${out.slice(0, cut).trimEnd()}\n\n${UPDATES}\n\n${out.slice(cut)}`.trimEnd()
  }
  if (lineStart(out, IMPORTANT) < 0) {
    const cut = lineStart(out, CHAT) < 0 ? out.length : lineStart(out, CHAT)
    out = `${out.slice(0, cut).trimEnd()}\n\n${IMPORTANT}\n\n${out.slice(cut)}`.trimEnd()
  }
  if (lineStart(out, CHAT) < 0) out = `${out}\n\n${CHAT}`
  return `${out}\n`
}

function appendTo(md: string, heading: string, stops: readonly string[], block: string): string {
  const doc = ensure(md)
  const start = lineStart(doc, heading)
  const end = sectionEnd(doc, start, stops)
  const head = doc.slice(0, end).trimEnd()
  const tail = doc.slice(end)
  return `${head}\n\n${escapeHeadings(block.trim())}\n${tail === '' ? '' : `\n${tail}`}`
}

export function addUpdate(md: string, when: string, text: string): string {
  return appendTo(md, UPDATES, [TODO, IMPORTANT, CHAT], `[UPDATE] ${when}\n${text.trim()}`)
}

export function addImportant(md: string, tag: string, text: string): string {
  return appendTo(md, IMPORTANT, [CHAT], `${tag} ${text.trim()}`)
}

export function chatPair(agent: string, user: string): string {
  return `${AGENT_TAG} ${agent.trim()}\n${USER_TAG} ${user.trim()}`
}

export function addChat(md: string, agent: string, user: string): string {
  return appendTo(md, CHAT, [], chatPair(agent, user))
}

// One turn that carried replies: each pair, then the message the user typed with them.
export function addTurn(md: string, pairs: readonly { agent: string; user: string }[], message: string): string {
  const blocks = pairs.map(pair => chatPair(pair.agent, pair.user))
  return appendTo(md, CHAT, [], [...blocks, `${USER_TAG} ${message.trim()}`].join('\n\n'))
}

function readObjectives(doc: string): Initial {
  const { start, heading } = objectivesStart(doc) ?? { start: 0, heading: OBJECTIVES }
  return readInitial(doc.slice(start + heading.length, sectionEnd(doc, start, [UPDATES, TODO, IMPORTANT, CHAT])).trim())
}

// Rewrites the objectives section under the heading the file already uses.
function changeInitial(md: string, change: (initial: Initial) => Initial): string {
  const doc = ensure(md)
  const { start, heading } = objectivesStart(doc) ?? { start: 0, heading: OBJECTIVES }
  const end = sectionEnd(doc, start, [UPDATES, TODO, IMPORTANT, CHAT])
  const initial = writeInitial(change(readObjectives(doc)))
  return `${doc.slice(0, start)}${heading}\n\n${initial === '' ? '' : `${initial}\n\n`}${doc.slice(end)}`
}

// A hand-written file can stack two objective headings (# Initial Prompt over # Goals); the text under them counts.
function objectivesText(body: string): string {
  return body
    .split('\n')
    .filter(line => !OBJECTIVE_HEADINGS.includes(line.trimEnd()))
    .join('\n')
    .trim()
}

// A stacked heading (# Goals under # Initial Prompt) stays above the text.
export function setObjectives(md: string, text: string): string {
  return changeInitial(md, initial => {
    const kept = initial.body.split('\n').filter(line => OBJECTIVE_HEADINGS.includes(line.trimEnd()))
    return { ...initial, body: [...kept, escapeHeadings(text.trim())].join('\n\n') }
  })
}

export function setContinuation(md: string, previous: string): string {
  return changeInitial(md, initial => ({ ...initial, continuation: previous }))
}

export function addSession(md: string, sessionId: string): string {
  return changeInitial(md, initial =>
    initial.sessions.includes(sessionId) ? initial : { ...initial, sessions: [...initial.sessions, sessionId] },
  )
}

// The todo list sits between ## Updates and # Important; a file without one gets it on the first write.
export function setTodo(md: string, body: string): string {
  const doc = ensure(md)
  const text = body.trim() === '' ? '' : `${body.trim()}\n\n`
  const start = lineStart(doc, TODO)
  if (start < 0) {
    const at = lineStart(doc, IMPORTANT)
    return `${doc.slice(0, at)}${TODO}\n\n${text}${doc.slice(at)}`
  }
  return `${doc.slice(0, start)}${TODO}\n\n${text}${doc.slice(sectionEnd(doc, start, [IMPORTANT, CHAT]))}`
}

function setUpdates(md: string, body: string): string {
  const doc = ensure(md)
  const start = lineStart(doc, UPDATES)
  const text = body.trim() === '' ? '' : `${body.trim()}\n\n`
  return `${doc.slice(0, start)}${UPDATES}\n\n${text}${doc.slice(sectionEnd(doc, start, [TODO, IMPORTANT, CHAT]))}`
}

// Each [UPDATE] line opens an entry; text before the first one is an entry too.
function updateEntries(updates: string): string[] {
  const entries: string[][] = [[]]
  for (const line of updates.split('\n')) {
    if (/^\[update\]/i.test(line.trim())) entries.push([])
    entries[entries.length - 1]?.push(line)
  }
  return entries.map(lines => lines.join('\n').trim()).filter(entry => entry !== '')
}

// Copies a linked file's objectives, updates and open todo items (with their statuses) into this one, and names it on the
// Continuation of: line. Done and declined items, and objectives whose items are all done or declined, stay behind. Text this file already holds, ids aside, is not copied twice; on a todo item both hold, this file's status stays.
export function carryOver(md: string, previous: string, name: string): string {
  const from = sections(previous)
  const here = sections(md)
  let out = setContinuation(md, name)
  const goals = openObjectives(from.objectives, items(from.todo))
  if (goals !== '' && !withoutIds(here.objectives).includes(withoutIds(goals))) {
    out = setObjectives(out, [goals, here.objectives].filter(text => text !== '').join('\n\n'))
  }
  const own = updateEntries(here.updates)
  const ownBare = own.map(withoutIds)
  const carried = updateEntries(from.updates).filter(entry => !ownBare.includes(withoutIds(entry)))
  if (carried.length > 0) out = setUpdates(out, [...carried, ...own].join('\n\n'))
  const lines = parse(here.todo)
  const have = new Set(items(here.todo).flatMap(item => [idOf(item), keyOf(item.text)]))
  const added = items(from.todo).filter(item => item.status !== 'done' && item.status !== 'declined' && !have.has(idOf(item)) && !have.has(keyOf(item.text)))
  if (added.length > 0) out = setTodo(out, format([...added.map(item => ({ item })), ...lines]))
  return out
}

// Puts each item's id on the objective or update line it came from; a file whose lines all carry theirs comes back as is.
export function stampIds(md: string, list: readonly Item[]): string {
  const s = sections(md)
  const out = stamped(s, list)
  let doc = md
  if (out.objectives !== s.objectives) doc = setObjectives(doc, out.objectives)
  if (out.updates !== s.updates) doc = setUpdates(doc, out.updates)
  return doc
}

export function sections(md: string): Sections {
  const doc = ensure(md)
  const cut = (heading: string, stops: readonly string[]) => {
    const start = lineStart(doc, heading)
    if (start < 0) return ''
    return doc.slice(start + heading.length, sectionEnd(doc, start, stops)).trim()
  }
  const initial = readObjectives(doc)
  return {
    continuation: initial.continuation,
    sessions: initial.sessions,
    objectives: objectivesText(initial.body),
    updates: cut(UPDATES, [TODO, IMPORTANT, CHAT]),
    todo: cut(TODO, [IMPORTANT, CHAT]),
    important: cut(IMPORTANT, [CHAT]),
    chat: cut(CHAT, []),
  }
}

export function summary(md: string): string {
  const first = withoutIds(sections(md).objectives).split('\n').find(line => line.trim() !== '')
  return first?.trim() ?? '(empty)'
}

export function inject(md: string, path: string): string {
  return `Session notes kept by notes-keeping: ${path}\nThe user writes this file; you never edit it.\n\n${md.trimEnd()}`
}

export function injectPrevious(md: string, path: string): string {
  return `Previous session's notes, attached to this session's notes as ${CONTINUATION} ${path}\nRead only: the context of the work this session continues; you never edit it.\n\n${md.trimEnd()}`
}
