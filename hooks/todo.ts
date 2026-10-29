import type { Sections } from '../types'

export type Status = 'todo' | 'in-progress' | 'done' | 'declined'
// label: the short name the model wrote for the item, shown in its place; the text stays whole beside it.
// id: set once, kept when the text is edited; the item's objective or update line carries the same id.
export type Item = { status: Status; text: string; label?: string; id?: string }
export type Line = { item: Item } | { raw: string }
// A candidate with isSure is an item as written (an update, a numbered objective); the others wait for Laya.
export type Candidate = { text: string; isSure: boolean; id?: string }
// What Laya answered for one item and one reply: its top label and the probability of every option.
export type Verdict = { label: string; p: number; probs: Record<string, number> }
export type Decision = { status: Status; label: string; p: number }
// What the todo list remembers between runs: candidate lines already judged, the status the AI last wrote
// per item, the items whose status the captain set (by hand or click), which the log flags when Laya changes them,
// the items a label was asked for, each asked once, the status the bridge last reported per linked item, and the status
// the captain clicked per item, which Laya leaves alone while the item keeps it.
export type Memory = { seen: string[]; ai: Record<string, Status>; pins: string[]; labeled: string[]; bridge: Record<string, Status> }

export const STATUSES: readonly Status[] = ['todo', 'in-progress', 'done', 'declined']
export const EMPTY: Memory = { seen: [], ai: {}, pins: [], labeled: [], bridge: {} }
// A line is dropped as background only when Laya is this sure it is not a task.
export const BACKGROUND_FLOOR = 0.8
// A status moves to the one a start or finish cue in the reply names when Laya, with the cue added, reaches CHANGE_FLOOR,
// and to the other at CUELESS_FLOOR. A status set outside the plugin needs HAND_FLOOR. Laya alone is not calibrated: its
// confidence did not rise with its precision.
export const CHANGE_FLOOR = 0.5
export const CUELESS_FLOOR = 0.9
export const HAND_FLOOR = 0.9
// How many nats a start or finish cue in the reply adds to its option.
const CUE_WEIGHT = 8

const MARKS: Record<Status, string> = { todo: ' ', 'in-progress': '~', done: 'x', declined: '-' }

export function markOf(status: Status): string {
  return `[${MARKS[status]}]`
}

// One entry of the marker legend Claude reads with the list and the pane draws: `[~] in-progress`.
export function legend(status: Status): string {
  return `${markOf(status)} ${status}`
}
const ITEM = /^\s*[-*]\s+\[([ ~xX-])\]\s+(\S.*?)\s*$/
const UPDATE_TAG = /^\[update\]/i
// - [ ] **Short label**: the whole text
const LABELED = /^\*\*(.+?)\*\*:\s+(\S.*)$/
// A trailing <!-- id:x --> on an item line or on the first line of its objective or update.
const ID = /\s*<!-- id:([a-z0-9]+) -->\s*$/
const IDS = /[ \t]*<!-- id:[a-z0-9]+ -->/g
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

// What an item is keyed by: its id, else its text key (an item written before ids).
export function idOf(item: { text: string; id?: string }): string {
  return item.id ?? keyOf(item.text)
}

function splitId(line: string): { line: string; id?: string } {
  const m = ID.exec(line)
  return m === null ? { line } : { line: line.slice(0, m.index), id: m[1] }
}

// Text as shown: id tokens removed.
export function withoutIds(text: string): string {
  return text.replace(IDS, '')
}

// FNV-1a of the text key in base 36; a taken id is hashed again with a counter.
export function idFor(text: string, taken: ReadonlySet<string>): string {
  for (let n = 0; ; n++) {
    let h = 0x811c9dc5
    for (const ch of n === 0 ? keyOf(text) : `${keyOf(text)}\n${n}`) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
    const id = h.toString(36).padStart(7, '0')
    if (!taken.has(id)) return id
  }
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
      const split = splitId(line)
      const m = ITEM.exec(split.line)
      if (m === null) return { raw: line }
      const status = statusOf(m[1] ?? ' ')
      const rest = m[2] ?? ''
      const named = LABELED.exec(rest)
      const item: Item = named === null ? { status, text: rest } : { status, text: named[2] ?? '', label: named[1] ?? '' }
      return { item: split.id === undefined ? item : { ...item, id: split.id } }
    })
}

function written(item: Item): string {
  const text = item.label === undefined ? item.text : `**${item.label}**: ${item.text}`
  return item.id === undefined ? text : `${text} <!-- id:${item.id} -->`
}

// Every item without an id gets one.
export function withIds(lines: readonly Line[]): Line[] {
  const taken = new Set(lines.flatMap(line => ('item' in line && line.item.id !== undefined ? [line.item.id] : [])))
  return lines.map(line => {
    if (!('item' in line) || line.item.id !== undefined) return line
    const id = idFor(line.item.text, taken)
    taken.add(id)
    return { item: { ...line.item, id } }
  })
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
function head(raw: readonly string[]): string {
  const lines = raw.map(line => splitId(line).line)
  let out = stripBullet(lines[0] ?? '')
  for (const next of lines.slice(1)) {
    if (SENTENCE_END.test(out) || isDetail(next) || !/^[a-z0-9]/.test(next.trim())) break
    out = `${out} ${next.trim()}`
  }
  return unquote(out)
}

// ats: the index of each line in the section.
type Block = { isNumbered: boolean; lines: string[]; ats: number[]; first: number; last: number }
// A candidate with where its first line sits: that line carries its id.
type Source = Candidate & { section: 'objectives' | 'updates'; at: number }

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
    if (NUMBERED.test(line)) out.push({ isNumbered: true, lines: [line], ats: [at], first: at, last: at })
    else if (last === undefined || (isAfterBlank && !last.isNumbered)) out.push({ isNumbered: false, lines: [line], ats: [at], first: at, last: at })
    else {
      last.lines.push(line)
      last.ats.push(at)
      last.last = at
    }
    isAfterBlank = false
  })
  return out
}

// A paragraph of bullets is a list of items; a paragraph that opens with text and then lists is one item, its bullets details.
function objectiveHeads(block: Block): { text: string; id?: string; at: number }[] {
  const of = (lines: string[], at: number) => ({ text: head(lines), id: splitId(lines[0] ?? '').id, at })
  if (block.isNumbered || !BULLET.test(block.lines[0] ?? '')) return [of(block.lines, block.first)]
  const lists: { lines: string[]; at: number }[] = []
  block.lines.forEach((line, i) => {
    if (BULLET.test(line)) lists.push({ lines: [line], at: block.ats[i] ?? 0 })
    else lists[lists.length - 1]?.lines.push(line)
  })
  return lists.map(list => of(list.lines, list.at))
}

// Each [UPDATE] block is one candidate: its first line of text, past a "Project: x" label. Text before the first tag is a block too.
function updateBlocks(updates: string): { text: string; id?: string; at: number }[] {
  const parts: { line: string; at: number }[][] = [[]]
  updates.split('\n').forEach((line, at) => {
    if (UPDATE_TAG.test(line.trim())) parts.push([])
    else parts[parts.length - 1]?.push({ line, at })
  })
  return parts.flatMap(part => {
    const lines = part.filter(({ line }) => line.trim() !== '')
    const at = lines.findIndex(({ line }) => !LABEL.test(stripBullet(splitId(line).line)))
    const first = lines[at]
    if (at < 0 || first === undefined) return []
    return [{ text: head(lines.slice(at).map(({ line }) => line)), id: splitId(first.line).id, at: first.at }]
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
function sources(s: Pick<Sections, 'objectives' | 'updates'>): Source[] {
  const goals = blocks(s.objectives).flatMap(block =>
    objectiveHeads(block).flatMap(({ text, id, at }): Source[] => {
      const clean = block.isNumbered ? text.replace(/:$/, '') : text
      if (clean === '' || text.startsWith('#') || !isPhrase(clean) || (!block.isNumbered && text.endsWith(':'))) return []
      return [{ text: oneLine(clean), isSure: block.isNumbered, id, section: 'objectives', at }]
    }),
  )
  const updates = updateBlocks(s.updates).map(({ text, id, at }): Source => ({ text: oneLine(text), isSure: true, id, section: 'updates', at }))
  return [...goals, ...updates]
}

export function candidates(s: Pick<Sections, 'objectives' | 'updates'>): Candidate[] {
  return sources(s).map(({ text, isSure, id }) => (id === undefined ? { text, isSure } : { text, isSure, id }))
}

// The keys a candidate is matched by: its id, if its line carries one, and its text keys.
export function candidateKeys(c: Candidate): string[] {
  return c.id === undefined ? keysOf(c.text) : [c.id, ...keysOf(c.text)]
}

// Puts an item's id on the objective or update line it came from, matched by text, when that line carries none yet.
export function stamped(s: Pick<Sections, 'objectives' | 'updates'>, list: readonly Item[]): Pick<Sections, 'objectives' | 'updates'> {
  const ids = new Map(list.flatMap(item => (item.id === undefined ? [] : [[keyOf(item.text), item.id] as const])))
  const lines = { objectives: s.objectives.split('\n'), updates: s.updates.split('\n') }
  for (const source of sources(s)) {
    if (source.id !== undefined) continue
    const id = keysOf(source.text).flatMap(key => ids.get(key) ?? [])[0]
    if (id !== undefined) lines[source.section][source.at] = `${lines[source.section][source.at] ?? ''} <!-- id:${id} -->`
  }
  return { objectives: lines.objectives.join('\n'), updates: lines.updates.join('\n') }
}

// The objectives without the blocks whose items are all finished: a block is matched to its items by the text it yields as
// a candidate, and one with no item in the list stays. Blank lines the cut leaves doubled are folded.
export function openObjectives(objectives: string, list: readonly Item[]): string {
  const byId = new Map(list.flatMap(item => (item.id === undefined ? [] : [[item.id, item.status] as const])))
  const byText = new Map(list.map(item => [keyOf(item.text), item.status] as const))
  const lines = objectives.split('\n')
  const gone = new Set<number>()
  for (const block of blocks(objectives)) {
    const linked = candidates({ objectives: block.lines.join('\n'), updates: '' }).flatMap(c =>
      c.id === undefined ? keysOf(c.text).flatMap(key => byText.get(key) ?? []) : byId.get(c.id) ?? [],
    )
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

// Token sets and each item's own words, kept per siblings array: a todo run passes one array to every moved() call,
// which otherwise rebuilds every sibling's tokens for every sentence and every item, seconds of CPU on a 50-item list.
type Words = { tokens: Map<string, Set<string>>; own: Map<string, Iterable<string>> }
const memo = new WeakMap<readonly string[], Words>()

function wordsOf(siblings: readonly string[]): Words {
  const found = memo.get(siblings)
  if (found !== undefined) return found
  const made: Words = { tokens: new Map(), own: new Map() }
  memo.set(siblings, made)
  return made
}

function tokensIn(words: Words, text: string): Set<string> {
  const found = words.tokens.get(text)
  if (found !== undefined) return found
  const made = tokens(text)
  words.tokens.set(text, made)
  return made
}

// Items of one list share domain words ("notes", "pane"); a reply must share a word only this item has to move it.
// An item with no word of its own falls back to all its words. Words match by stem and by prefix.
export function mentions(item: string, answer: string, siblings: readonly string[] = []): boolean {
  const words = wordsOf(siblings)
  let own = words.own.get(item)
  if (own === undefined) {
    const all = tokensIn(words, item)
    const others = [...new Set(siblings.filter(text => text !== item).flatMap(text => [...tokensIn(words, text)]))]
    const mine = [...all].filter(token => !others.some(other => same(token, other)))
    own = mine.length === 0 ? all : mine
    words.own.set(item, own)
  }
  return shares(own, tokensIn(words, answer))
}

// The cue the reply gives for this item, read only from the sentences about it and the ones that carry on from them,
// with the item's own words (four letters or more, as tokens are) removed so that "skipped-move counter" does not read
// as a refusal.
function cueFor(item: string, answer: string, siblings: readonly string[]): string | undefined {
  const sentences = answer.split(/(?<=[.!?。！？])\s+|\n+|;\s+/).filter(s => s.trim() !== '')
  const about = sentences.map(s => mentions(item, s, siblings))
  const other = sentences.map(s => siblings.some(text => text !== item && mentions(text, s, siblings)))
  const own = tokensIn(wordsOf(siblings), item)
  const text = sentences
    .filter((_, i) => about[i] || (i > 0 && about[i - 1] && !other[i]))
    .map(s => (s.match(/[\p{L}\p{N}_']+/gu) ?? []).filter(word => word.length < 4 || ![...own].some(token => same(stem(word.toLowerCase()), token))).join(' '))
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

// The status a reply moves an item to, or undefined to leave it. Statuses only move forward, and never to declined: a
// refusal cue only keeps the other cues from counting, and only the captain or firstmate declines an item.
export function moved(item: Item, answer: string, verdict: Verdict | undefined, siblings: readonly string[] = [], isHandSet = false): Decision | undefined {
  if (verdict === undefined || !mentions(item.text, answer, siblings)) return undefined
  const found = cueFor(item.text, answer, siblings)
  const cue = found === 'rejected' ? undefined : found
  const odds = posterior(verdict.probs, cue)
  const label = Object.keys(odds).reduce((best, key) => ((odds[key] ?? 0) > (odds[best] ?? 0) ? key : best))
  const next = REPLY[label]
  const p = odds[label] ?? 0
  const floor = Math.max(label === cue ? CHANGE_FLOOR : CUELESS_FLOOR, isHandSet ? HAND_FLOOR : 0)
  if (next === undefined || next === 'declined' || RANK[next] <= RANK[item.status] || p < floor) return undefined
  return { status: next, label, p }
}

// A record's value for an item: under its id, else under its text key (written before the item had an id).
function pick<T>(record: Readonly<Record<string, T>>, item: Item): T | undefined {
  return record[idOf(item)] ?? record[keyOf(item.text)]
}

// Pins every item whose status is not the one the AI last wrote, and forgets items that left the list. Entries kept
// under an item's text key move to its id.
export function settle(memory: Memory, list: readonly Item[]): Memory {
  const pins = new Set<string>()
  const labeled: string[] = []
  const ai: Record<string, Status> = {}
  const bridge: Record<string, Status> = {}
  for (const item of list) {
    const key = idOf(item)
    const isIn = (keys: readonly string[]) => keys.includes(key) || keys.includes(keyOf(item.text))
    const wrote = pick(memory.ai, item)
    if (wrote !== undefined) ai[key] = wrote
    const reported = pick(memory.bridge, item)
    if (reported !== undefined) bridge[key] = reported
    if (isIn(memory.pins) || (wrote === undefined ? item.status !== 'todo' : wrote !== item.status)) pins.add(key)
    if (isIn(memory.labeled)) labeled.push(key)
  }
  return { seen: memory.seen, ai, pins: [...pins], labeled, bridge }
}

export function pin(memory: Memory, key: string): Memory {
  return memory.pins.includes(key) ? memory : { ...memory, pins: [...memory.pins, key] }
}

// A click on an item, by id or text key, sets its next status; the caller pins it. The write gives every item an id.
export function cycleItem(body: string, key: string, change: (status: Status) => Status = cycle): string {
  const isIt = (item: Item) => idOf(item) === key || keyOf(item.text) === key
  return format(withIds(parse(body).map(line => ('item' in line && isIt(line.item) ? { item: { ...line.item, status: change(line.item.status) } } : line))))
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
// key: the item's key in the plan and the memory.
export type Applied = { key: string; text: string; from: Status; to: Status; isHandSet: boolean }

// Applies new items and status moves to the todo section as it is now. A move lands only on an item still in the
// status Laya read; one the captain changed meanwhile is left. A move on a hand-set item is reported so it can be logged.
// A body that changes gives every item an id; every id written is seen.
export function reconcile(body: string, memory: Memory, plan: Plan): { body: string; memory: Memory; applied: Applied[] } {
  const settled = settle(memory, items(body))
  const ai = { ...settled.ai }
  const pins = new Set(settled.pins)
  const applied: Applied[] = []
  const lines = parse(body).map(line => {
    if (!('item' in line)) return line
    const key = idOf(line.item)
    const named = pick(plan.labels ?? {}, line.item)
    const item = line.item.label === undefined && named !== undefined ? { ...line.item, label: named } : line.item
    const move = pick(plan.set, item)
    if (move === undefined || move.from !== item.status) return { item }
    applied.push({ key, text: item.text, from: move.from, to: move.to, isHandSet: pins.has(key) })
    ai[key] = move.to
    pins.delete(key)
    return { item: { ...item, status: move.to } }
  })
  const have = new Set(items(body).flatMap(item => [idOf(item), keyOf(item.text)]))
  for (const item of plan.add) {
    const keys = [idOf(item), keyOf(item.text)]
    if (keys.some(key => have.has(key))) continue
    for (const key of keys) have.add(key)
    ai[idOf(item)] = item.status
    lines.push({ item })
  }
  const out = format(lines) === format(parse(body)) ? lines : withIds(lines)
  const ids = out.flatMap(line => ('item' in line && line.item.id !== undefined ? [line.item.id] : []))
  const seen = [...new Set([...settled.seen, ...plan.seen, ...ids])]
  const labeled = [...new Set([...settled.labeled, ...(plan.labeled ?? [])])]
  return { body: format(out), memory: { seen, ai, pins: [...pins], labeled, bridge: { ...settled.bridge, ...plan.bridge } }, applied }
}

// The moves the bridge's reported statuses make: forward only, and only when the report changed since the last run,
// so a status the captain set on a linked item stays until the linked task's state changes again.
export function bridgeMoves(list: readonly Item[], reported: Readonly<Record<string, Status>>, memory: Memory): Record<string, Move> {
  const set: Record<string, Move> = {}
  for (const item of list) {
    const to = pick(reported, item)
    if (to === undefined || to === pick(memory.bridge, item) || RANK[to] <= RANK[item.status]) continue
    set[idOf(item)] = { from: item.status, to }
  }
  return set
}

export function snapshotOf(list: readonly Item[]): Record<string, Status> {
  return Object.fromEntries(list.map(item => [idOf(item), item.status]))
}

// A status change, or an added item when from is undefined. isFound: found in the file, so made outside the plugin.
export type Change = { item: Item; from?: Status; to: Status; isFound?: boolean }

// A line the bridge sends on: the actor in parentheses after a status change, the item's id when it has one.
export function changeLine(change: Change, actor: string): string {
  const { item } = change
  const line = change.from === undefined ? `+ [${MARKS[change.to]}] ${item.text}` : `${item.text}: ${change.from} -> ${change.to} (${actor})`
  return item.id === undefined ? line : `${line} [id:${item.id}]`
}

// What changed since the plugin last wrote the snapshot. `before` is the list as found, so a status that differs there,
// or an item new there, was written outside the plugin; `after` adds the items this write added. Moves the plugin made
// are not changes. With no snapshot yet nothing is reported.
export function diffSnapshot(snapshot: Readonly<Record<string, Status>> | undefined, before: readonly Item[], after: readonly Item[]): Change[] {
  if (snapshot === undefined) return []
  const out: Change[] = []
  const found = new Set<string>()
  for (const item of before) {
    found.add(idOf(item))
    found.add(keyOf(item.text))
    const was = pick(snapshot, item)
    if (was === undefined) out.push({ item, to: item.status, isFound: true })
    else if (was !== item.status) out.push({ item, from: was, to: item.status, isFound: true })
  }
  for (const item of after) {
    if (!found.has(idOf(item)) && !found.has(keyOf(item.text)) && pick(snapshot, item) === undefined) out.push({ item, to: item.status, isFound: false })
  }
  return out
}

const SECTION_CAP = 40

function brief(item: Item): string {
  return item.label === undefined ? clip(item.text) : `${item.label}: ${clip(item.text)}`
}

// What Claude reads each turn: the list, and to work every open item at once.
export function context(body: string): string | undefined {
  const list = items(body)
  if (list.length === 0) return undefined
  const isOpen = list.some(item => item.status === 'todo' || item.status === 'in-progress')
  const head = isOpen
    ? 'Start every open item ([ ] and [~]) now, in parallel: do not wait on one answer before starting another independent item.'
    : 'Nothing is open.'
  const shown = list.slice(0, SECTION_CAP).map(item => `- [${MARKS[item.status]}] ${brief(item)}`)
  const more = list.length > SECTION_CAP ? [`(${list.length - SECTION_CAP} more in the notes file)`] : []
  return [`Todo list kept by notes-keeping (${STATUSES.map(legend).join(', ')}). The captain and the plugin set them; you never edit the notes file.`, head, ...shown, ...more].join('\n')
}
