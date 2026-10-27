import type { Sections } from '../types'

export type Status = 'todo' | 'in-progress' | 'done' | 'declined'
// label: the short name the model wrote for the item, shown in its place; the text stays whole beside it.
export type Item = { status: Status; text: string; label?: string }
export type Line = { item: Item } | { raw: string }
// A candidate with isSure is an item as written (an update, a numbered objective); the others wait for Laya.
export type Candidate = { text: string; isSure: boolean }
// What Laya answered for one item and one reply: its top label and the probability of every option.
export type Verdict = { label: string; p: number; probs: Record<string, number> }
export type Decision = { status: Status; label: string; p: number }
// What the todo list remembers between runs: candidate lines already judged, the status the AI last wrote
// per item, the items whose status the captain set (by hand or click), which the log flags when Laya changes them,
// the items a label was asked for, each asked once, and the status the bridge last reported per linked item.
export type Memory = { seen: string[]; ai: Record<string, Status>; pins: string[]; labeled: string[]; bridge: Record<string, Status> }

export const STATUSES: readonly Status[] = ['todo', 'in-progress', 'done', 'declined']
export const EMPTY: Memory = { seen: [], ai: {}, pins: [], labeled: [], bridge: {} }
// A line is dropped as background only when Laya is this sure it is not a task.
export const BACKGROUND_FLOOR = 0.8
// A status moves when Laya, with the reply's cue added, reaches CHANGE_FLOOR on the option the cue names, or CUELESS_FLOOR
// on any other option; a status the captain set by hand needs HAND_FLOOR. Laya alone is not calibrated: its confidence
// did not rise with its precision.
export const CHANGE_FLOOR = 0.5
export const CUELESS_FLOOR = 0.9
export const HAND_FLOOR = 0.9
// How many nats a cue word in the reply adds to the option it names.
const CUE_WEIGHT = 8

const MARKS: Record<Status, string> = { todo: ' ', 'in-progress': '~', done: 'x', declined: '-' }
const ITEM = /^\s*[-*]\s+\[([ ~xX-])\]\s+(\S.*?)\s*$/
const UPDATE_TAG = /^\[update\]/i
// - [ ] **Short label**: the whole text
const LABELED = /^\*\*(.+?)\*\*:\s+(\S.*)$/
const MAX_TEXT = 120
const MAX_LABEL = 48
const MAX_LABEL_WORDS = 6
const RANK: Record<Status, number> = { todo: 0, 'in-progress': 1, done: 2, declined: 2 }
// Laya's option names; its question says "refused or dropped" for rejected.
const REPLY: Record<string, Status> = { started: 'in-progress', finished: 'done', rejected: 'declined' }
// Checked in this order, so a refusal wins over a start and a start over a finish.
const CUES: [string, RegExp][] = [
  ['rejected', /\b(rejected|won't|will not|not (do|doing|build|building|write|writing|add|adding|worth|something)|(was|were|is|are|been|being|be|i|we|got|get) (\w+ )?skipp(ed|ing)|decided against|leav(e|ing) (it )?(out|undone|as it is)|leav(e|ing) .{0,30} out|out of scope|dropp(ed|ing)|refus\w+|declin\w+)\b|見送|やらない|行わない|手を付けません|範囲外|しません/i],
  ['started', /\b(started|starting|begun|began|begin|beginning|working on|in progress|under ?way|partway|partly|half|in the middle|continu\w+|still|more (to do|remains|is open)|not (yet|drawn|hooked|connected|wired))\b|着手|始め|途中|進めて|半分/i],
  ['finished', /\b(done|finish\w*|complete[d]?|implemented|landed|committed|fixed|verified|works|written|added|merged|in and)\b|完了|実装し|済み|仕上げ|通りました/i],
]
const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'your', 'should', 'must', 'into', 'also', 'then', 'than', 'when', 'what', 'they', 'them', 'their', 'there', 'here', 'just', 'make', 'been', 'were', 'does', 'done'])

export function keyOf(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function statusOf(mark: string): Status {
  const found = STATUSES.find(status => MARKS[status] === mark.toLowerCase())
  return found ?? 'todo'
}

export function parse(body: string): Line[] {
  return body
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const m = ITEM.exec(line)
      if (m === null) return { raw: line }
      const status = statusOf(m[1] ?? ' ')
      const rest = m[2] ?? ''
      const named = LABELED.exec(rest)
      return { item: named === null ? { status, text: rest } : { status, text: named[2] ?? '', label: named[1] ?? '' } }
    })
}

function written(item: Item): string {
  return item.label === undefined ? item.text : `**${item.label}**: ${item.text}`
}

export function format(lines: readonly Line[]): string {
  return lines.map(line => ('item' in line ? `- [${MARKS[line.item.status]}] ${written(line.item)}` : line.raw)).join('\n')
}

// What a list shows for an item: its label, else its text cut to one short line.
export function shown(item: Item): string {
  return item.label ?? clip(item.text)
}

export function row(item: Item): string {
  return `[${MARKS[item.status]}] ${shown(item)}`
}

export function items(body: string): Item[] {
  return parse(body).flatMap(line => ('item' in line ? [line.item] : []))
}

export function cycle(status: Status): Status {
  return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length] ?? 'todo'
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function clip(text: string): string {
  const one = oneLine(text)
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1).trimEnd()}…` : one
}

// A single Latin word (a status name in a list of statuses) is not a task.
function isPhrase(line: string): boolean {
  return /\s/.test(line) || /[\u3040-\u30ff\u3400-\u9fff]/.test(line)
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()
}

const NUMBERED = /^\s*\d+[.)]\s+/
const BULLET = /^\s*[-*]\s+/
const LINK = /^\s*https?:\/\//
const SENTENCE_END = /[.!?:。！？]$/
// A one-line "Name: value" label at the top of an update, not a task.
const LABEL = /^\w+(?: \w+)?: \S+$/

function isDetail(line: string): boolean {
  return BULLET.test(line) || NUMBERED.test(line) || LINK.test(line)
}

function unquote(text: string): string {
  return text.replace(/^["'“「](.*)["'”」]$/, '$1')
}

// The first sentence of a block: its first line plus the wrapped lines under it, which carry on in lower case or digits
// until a line ends a sentence. Bullets, numbers and links under it are details, not part of it.
function head(lines: readonly string[]): string {
  let out = stripBullet(lines[0] ?? '')
  for (const next of lines.slice(1)) {
    if (SENTENCE_END.test(out) || isDetail(next) || !/^[a-z0-9]/.test(next.trim())) break
    out = `${out} ${next.trim()}`
  }
  return unquote(out)
}

type Block = { isNumbered: boolean; lines: string[]; first: number; last: number }

// A numbered line opens a block that runs to the next numbered line, blank lines and bullets inside it; outside one, a
// blank line ends a paragraph.
function blocks(text: string): Block[] {
  const out: Block[] = []
  let isAfterBlank = false
  text.split('\n').forEach((line, at) => {
    if (line.trim() === '') {
      isAfterBlank = true
      return
    }
    const last = out[out.length - 1]
    if (NUMBERED.test(line)) out.push({ isNumbered: true, lines: [line], first: at, last: at })
    else if (last === undefined || (isAfterBlank && !last.isNumbered)) out.push({ isNumbered: false, lines: [line], first: at, last: at })
    else {
      last.lines.push(line)
      last.last = at
    }
    isAfterBlank = false
  })
  return out
}

// A paragraph of bullets is a list of items; a paragraph that opens with text and then lists is one item, its bullets details.
function objectiveHeads(block: Block): string[] {
  if (block.isNumbered || !BULLET.test(block.lines[0] ?? '')) return [head(block.lines)]
  const lists: string[][] = []
  for (const line of block.lines) {
    if (BULLET.test(line)) lists.push([line])
    else lists[lists.length - 1]?.push(line)
  }
  return lists.map(head)
}

// Each [UPDATE] block is one candidate: its first line of text, past a "Project: x" label. Text before the first tag is a block too.
function updateBlocks(updates: string): string[] {
  const parts: string[][] = [[]]
  for (const line of updates.split('\n')) {
    if (UPDATE_TAG.test(line.trim())) parts.push([])
    else parts[parts.length - 1]?.push(line)
  }
  return parts.flatMap(part => {
    const lines = part.filter(line => line.trim() !== '')
    const at = lines.findIndex(line => !LABEL.test(stripBullet(line)))
    return at < 0 ? [] : [head(lines.slice(at))]
  })
}

// Items added before the text was kept whole carry it cut at MAX_TEXT: a line matches under either key.
export function keysOf(text: string): string[] {
  return [...new Set([keyOf(text), keyOf(clip(text))])]
}

export function labelPrompt(text: string): string {
  return [
    `Write a label of 2 to ${MAX_LABEL_WORDS} words for this todo item, in the item's language, so it can be read at a glance in a list.`,
    'Reply with the label alone: no quotes, no trailing period.',
    '',
    `Item: ${text}`,
  ].join('\n')
}

// The model's reply as a label, or undefined when it is not one short line.
export function cleanLabel(reply: string): string | undefined {
  const first = reply.trim().split('\n')[0] ?? ''
  const bare = first.replace(/^["'`*\s]+|["'`*\s.。]+$/g, '').trim()
  if (bare === '' || bare.length > MAX_LABEL || bare.includes('*')) return undefined
  return bare.split(/\s+/).length > MAX_LABEL_WORDS ? undefined : bare
}

// Numbered objectives and updates are items as written; any other objective paragraph or bullet waits for Laya, unless it
// introduces a list (ends in a colon), is a heading or is a single word.
export function candidates(s: Pick<Sections, 'objectives' | 'updates'>): Candidate[] {
  const goals = blocks(s.objectives).flatMap(block =>
    objectiveHeads(block).flatMap(text => {
      const clean = block.isNumbered ? text.replace(/:$/, '') : text
      if (clean === '' || text.startsWith('#') || !isPhrase(clean) || (!block.isNumbered && text.endsWith(':'))) return []
      return [{ text: oneLine(clean), isSure: block.isNumbered }]
    }),
  )
  const updates = updateBlocks(s.updates).map(text => ({ text: oneLine(text), isSure: true }))
  return [...goals, ...updates]
}

// The objectives without the blocks whose items are all finished: a block is matched to its items by the text it yields as
// a candidate, and one with no item in the list stays. Blank lines the cut leaves doubled are folded.
export function openObjectives(objectives: string, list: readonly Item[]): string {
  const status = new Map(list.map(item => [keyOf(item.text), item.status] as const))
  const lines = objectives.split('\n')
  const gone = new Set<number>()
  for (const block of blocks(objectives)) {
    const linked = candidates({ objectives: block.lines.join('\n'), updates: '' }).flatMap(c => keysOf(c.text).flatMap(key => status.get(key) ?? []))
    if (linked.length > 0 && linked.every(s => s === 'done' || s === 'declined')) for (let i = block.first; i <= block.last; i++) gone.add(i)
  }
  return lines.filter((_, i) => !gone.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const stem = (word: string): string => word.replace(/(ing|ed|es|s)$/, '').replace(/y$/, 'i')

function tokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const words = (lower.match(/[a-z0-9]+/g) ?? []).filter(word => word.length >= 4 && !STOP.has(word)).map(stem)
  const bigrams = (lower.match(/[぀-ヿ㐀-鿿]{2,}/g) ?? []).flatMap(run => Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)))
  return new Set([...words, ...bigrams])
}

const same = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)))
const shares = (words: Iterable<string>, reply: ReadonlySet<string>): boolean => [...words].some(word => [...reply].some(other => same(word, other)))

// Items of one list share domain words ("notes", "pane"); a reply must share a word only this item has to move it.
// An item with no word of its own falls back to all its words. Words match by stem and by prefix.
export function mentions(item: string, answer: string, siblings: readonly string[] = []): boolean {
  const all = tokens(item)
  const others = [...new Set(siblings.filter(text => text !== item).flatMap(text => [...tokens(text)]))]
  const own = [...all].filter(token => !others.some(other => same(token, other)))
  return shares(own.length === 0 ? all : own, tokens(answer))
}

// The cue the reply gives for this item, read only from the sentences about it and the ones that carry on from them,
// with the item's own words removed so that "skipped-move counter" does not read as a refusal.
function cueFor(item: string, answer: string, siblings: readonly string[]): string | undefined {
  const sentences = answer.split(/(?<=[.!?。！？])\s+|\n+|;\s+/).filter(s => s.trim() !== '')
  const about = sentences.map(s => mentions(item, s, siblings))
  const other = sentences.map(s => siblings.some(text => text !== item && mentions(text, s, siblings)))
  const own = tokens(item)
  const text = sentences
    .filter((_, i) => about[i] || (i > 0 && about[i - 1] && !other[i]))
    .map(s => (s.match(/[\p{L}\p{N}_']+/gu) ?? []).filter(word => ![...own].some(token => same(stem(word.toLowerCase()), token))).join(' '))
    .join(' ')
  return CUES.find(([, rx]) => rx.test(text))?.[0]
}

// Laya's probabilities with the option the cue names raised, as a distribution over the options.
function posterior(probs: Record<string, number>, cue: string | undefined): Record<string, number> {
  const scores = Object.entries(probs).map(([label, p]) => [label, Math.log(Math.max(p, 1e-4)) + (label === cue ? CUE_WEIGHT : 0)] as const)
  const total = scores.reduce((sum, [, score]) => sum + Math.exp(score), 0)
  return Object.fromEntries(scores.map(([label, score]) => [label, Math.exp(score) / total]))
}

export function isBackground(pTask: number): boolean {
  return 1 - pTask >= BACKGROUND_FLOOR
}

// The status a reply moves an item to, or undefined to leave it. Statuses only move forward.
export function moved(item: Item, answer: string, verdict: Verdict | undefined, siblings: readonly string[] = [], isHandSet = false): Decision | undefined {
  if (verdict === undefined || !mentions(item.text, answer, siblings)) return undefined
  const cue = cueFor(item.text, answer, siblings)
  const odds = posterior(verdict.probs, cue)
  const label = Object.keys(odds).reduce((best, key) => ((odds[key] ?? 0) > (odds[best] ?? 0) ? key : best))
  const next = REPLY[label]
  const p = odds[label] ?? 0
  const floor = Math.max(label === cue ? CHANGE_FLOOR : CUELESS_FLOOR, isHandSet ? HAND_FLOOR : 0)
  if (next === undefined || RANK[next] <= RANK[item.status] || p < floor) return undefined
  return { status: next, label, p }
}

// Pins every item whose status is not the one the AI last wrote, and forgets items that left the list.
export function settle(memory: Memory, list: readonly Item[]): Memory {
  const present = new Set(list.map(item => keyOf(item.text)))
  const pins = new Set(memory.pins.filter(key => present.has(key)))
  const ai: Record<string, Status> = {}
  const bridge: Record<string, Status> = {}
  for (const item of list) {
    const key = keyOf(item.text)
    const wrote = memory.ai[key]
    if (wrote !== undefined) ai[key] = wrote
    const reported = memory.bridge[key]
    if (reported !== undefined) bridge[key] = reported
    if (wrote === undefined ? item.status !== 'todo' : wrote !== item.status) pins.add(key)
  }
  return { seen: memory.seen, ai, pins: [...pins], labeled: memory.labeled.filter(key => present.has(key)), bridge }
}

export function pin(memory: Memory, key: string): Memory {
  return memory.pins.includes(key) ? memory : { ...memory, pins: [...memory.pins, key] }
}

// A click on an item sets its next status; the caller pins it.
export function cycleItem(body: string, key: string): string {
  return format(parse(body).map(line => ('item' in line && keyOf(line.item.text) === key ? { item: { ...line.item, status: cycle(line.item.status) } } : line)))
}

export type Move = { from: Status; to: Status }
// labels: a label per item key, set on an item still without one; labeled: the keys a label was asked for.
export type Plan = {
  add: readonly Item[]
  set: Readonly<Record<string, Move>>
  seen: readonly string[]
  labels?: Readonly<Record<string, string>>
  labeled?: readonly string[]
  bridge?: Readonly<Record<string, Status>>
}
export type Applied = { text: string; from: Status; to: Status; isHandSet: boolean }

// Applies new items and status moves to the todo section as it is now. A move lands only on an item still in the
// status Laya read; one the captain changed meanwhile is left. A move on a hand-set item is reported so it can be logged.
export function reconcile(body: string, memory: Memory, plan: Plan): { body: string; memory: Memory; applied: Applied[] } {
  const settled = settle(memory, items(body))
  const ai = { ...settled.ai }
  const pins = new Set(settled.pins)
  const applied: Applied[] = []
  const lines = parse(body).map(line => {
    if (!('item' in line)) return line
    const key = keyOf(line.item.text)
    const named = plan.labels?.[key]
    const item = line.item.label === undefined && named !== undefined ? { ...line.item, label: named } : line.item
    const move = plan.set[key]
    if (move === undefined || move.from !== item.status) return { item }
    applied.push({ text: item.text, from: move.from, to: move.to, isHandSet: pins.has(key) })
    ai[key] = move.to
    pins.delete(key)
    return { item: { ...item, status: move.to } }
  })
  const have = new Set(items(body).map(item => keyOf(item.text)))
  for (const item of plan.add) {
    const key = keyOf(item.text)
    if (have.has(key)) continue
    have.add(key)
    ai[key] = item.status
    lines.push({ item })
  }
  const seen = [...new Set([...settled.seen, ...plan.seen])]
  const labeled = [...new Set([...settled.labeled, ...(plan.labeled ?? [])])]
  return { body: format(lines), memory: { seen, ai, pins: [...pins], labeled, bridge: { ...settled.bridge, ...plan.bridge } }, applied }
}

// The moves the bridge's reported statuses make: forward only, and only when the report changed since the last run,
// so a status the captain set on a linked item stays until the linked task's state changes again.
export function bridgeMoves(list: readonly Item[], reported: Readonly<Record<string, Status>>, memory: Memory): Record<string, Move> {
  const set: Record<string, Move> = {}
  for (const item of list) {
    const key = keyOf(item.text)
    const to = reported[key]
    if (to === undefined || to === memory.bridge[key] || RANK[to] <= RANK[item.status]) continue
    set[key] = { from: item.status, to }
  }
  return set
}

export function snapshotOf(list: readonly Item[]): Record<string, Status> {
  return Object.fromEntries(list.map(item => [keyOf(item.text), item.status]))
}

// What changed since the plugin last wrote the snapshot. `before` is the list as found, so a status that differs there
// was set outside the plugin (by the captain); `after` adds the items this write added. Moves the plugin made are not
// changes. With no snapshot yet nothing is reported.
export function diffSnapshot(snapshot: Readonly<Record<string, Status>> | undefined, before: readonly Item[], after: readonly Item[]): string[] {
  if (snapshot === undefined) return []
  const out: string[] = []
  const found = new Set<string>()
  for (const item of before) {
    const key = keyOf(item.text)
    found.add(key)
    const was = snapshot[key]
    if (was === undefined) out.push(`+ [${MARKS[item.status]}] ${item.text}`)
    else if (was !== item.status) out.push(`${item.text}: ${was} -> ${item.status} (captain)`)
  }
  for (const item of after) {
    const key = keyOf(item.text)
    if (!found.has(key) && snapshot[key] === undefined) out.push(`+ [${MARKS[item.status]}] ${item.text}`)
  }
  return out
}

const SECTION_CAP = 40

function brief(item: Item): string {
  return item.label === undefined ? clip(item.text) : `${item.label}: ${clip(item.text)}`
}

// What Claude reads each turn: the list, and what to work on next.
export function context(body: string): string | undefined {
  const list = items(body)
  if (list.length === 0) return undefined
  const open = list.filter(item => item.status === 'todo' || item.status === 'in-progress')
  const focus = open.find(item => item.status === 'in-progress') ?? open[0]
  const head = focus === undefined ? 'Nothing is open.' : `Work on: ${brief(focus)}`
  const shown = list.slice(0, SECTION_CAP).map(item => `- [${MARKS[item.status]}] ${brief(item)}`)
  const more = list.length > SECTION_CAP ? [`(${list.length - SECTION_CAP} more in the notes file)`] : []
  return ['Todo list kept by notes-keeping ([ ] todo, [~] in-progress, [x] done, [-] declined). The captain and the plugin set them; you never edit the notes file.', head, ...shown, ...more].join('\n')
}
