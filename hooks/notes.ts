import type { NameParts, Sections } from '../types'

export const OBJECTIVES = '# Objectives'
export const UPDATES = '## Updates'
export const IMPORTANT = '# Important'
export const CHAT = '# Chat'
export const AGENT_TAG = '[AI_AGENT]'
export const USER_TAG = '[USER]'
export const CONTINUATION = 'Continuation of:'
export const SESSIONS = 'Sessions:'

// Headings a file may open with: this mod's, a hand-written one, and the one files before Objectives used.
const OBJECTIVE_HEADINGS = [OBJECTIVES, '# Goals', '# Initial Prompt']
const HEADINGS = [...OBJECTIVE_HEADINGS, UPDATES, IMPORTANT, CHAT]
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
    const at = [IMPORTANT, CHAT].map(h => lineStart(out, h)).filter(i => i >= 0)
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
  return appendTo(md, UPDATES, [IMPORTANT, CHAT], `[UPDATE] ${when}\n${text.trim()}`)
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
  return readInitial(doc.slice(start + heading.length, sectionEnd(doc, start, [UPDATES, IMPORTANT, CHAT])).trim())
}

// Rewrites the objectives section under the heading the file already uses.
function changeInitial(md: string, change: (initial: Initial) => Initial): string {
  const doc = ensure(md)
  const { start, heading } = objectivesStart(doc) ?? { start: 0, heading: OBJECTIVES }
  const end = sectionEnd(doc, start, [UPDATES, IMPORTANT, CHAT])
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

export function sections(md: string): Sections {
  const doc = ensure(md)
  const cut = (heading: string, stops: readonly string[]) => {
    const start = lineStart(doc, heading)
    return doc.slice(start + heading.length, sectionEnd(doc, start, stops)).trim()
  }
  const initial = readObjectives(doc)
  return {
    continuation: initial.continuation,
    sessions: initial.sessions,
    objectives: objectivesText(initial.body),
    updates: cut(UPDATES, [IMPORTANT, CHAT]),
    important: cut(IMPORTANT, [CHAT]),
    chat: cut(CHAT, []),
  }
}

export function summary(md: string): string {
  const first = sections(md).objectives.split('\n').find(line => line.trim() !== '')
  return first?.trim() ?? '(empty)'
}

export function inject(md: string, path: string): string {
  return `Session notes kept by notes-keeping: ${path}\nThe user writes this file; you never edit it.\n\n${md.trimEnd()}`
}
