import type { Sections } from '../types'

export type Status = 'todo' | 'in-progress' | 'done' | 'declined'
export type Item = { status: Status; text: string }
export type Line = { item: Item } | { raw: string }
export type Candidate = { text: string; isUpdate: boolean }
export type Verdict = { label: string; p: number }
// What the todo list remembers between runs: candidate lines already judged, the status the AI last wrote
// per item, and the items whose status the captain set (by hand or click), which the log flags when Laya changes them.
export type Memory = { seen: string[]; ai: Record<string, Status>; pins: string[] }

export const STATUSES: readonly Status[] = ['todo', 'in-progress', 'done', 'declined']
export const EMPTY: Memory = { seen: [], ai: {}, pins: [] }
// A line is dropped as background only when Laya is this sure it is not a task.
export const BACKGROUND_FLOOR = 0.8
// A status moves only when Laya is this sure of what the reply says.
export const CHANGE_FLOOR = 0.6

const MARKS: Record<Status, string> = { todo: ' ', 'in-progress': '~', done: 'x', declined: '-' }
const ITEM = /^\s*[-*]\s+\[([ ~xX-])\]\s+(\S.*?)\s*$/
const UPDATE_TAG = /^\[update\]/i
const MAX_TEXT = 120
const RANK: Record<Status, number> = { todo: 0, 'in-progress': 1, done: 2, declined: 2 }
// Laya's option names; its question says "refused or dropped" for rejected.
const REPLY: Record<string, Status> = { started: 'in-progress', finished: 'done', rejected: 'declined' }
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
      return m === null ? { raw: line } : { item: { status: statusOf(m[1] ?? ' '), text: m[2] ?? '' } }
    })
}

export function format(lines: readonly Line[]): string {
  return lines.map(line => ('item' in line ? `- [${MARKS[line.item.status]}] ${line.item.text}` : line.raw)).join('\n')
}

export function label(item: Item): string {
  return `[${MARKS[item.status]}] ${item.text}`
}

export function items(body: string): Item[] {
  return parse(body).flatMap(line => ('item' in line ? [line.item] : []))
}

export function cycle(status: Status): Status {
  return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length] ?? 'todo'
}

export function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1).trimEnd()}…` : one
}

// A single Latin word (a status name in a list of statuses) is not a task.
function isPhrase(line: string): boolean {
  return /\s/.test(line) || /[\u3040-\u30ff\u3400-\u9fff]/.test(line)
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()
}

// Each [UPDATE] block is one candidate: its first line of text. Text before the first tag is a block too.
function updateBlocks(updates: string): string[] {
  const blocks: string[][] = [[]]
  for (const line of updates.split('\n')) {
    if (UPDATE_TAG.test(line.trim())) blocks.push([])
    else blocks[blocks.length - 1]?.push(line)
  }
  return blocks.flatMap(block => {
    const first = block.map(stripBullet).find(line => line !== '')
    return first === undefined ? [] : [first]
  })
}

// The objectives' lines, minus list introductions ending in a colon and headings, then the updates.
export function candidates(s: Pick<Sections, 'objectives' | 'updates'>): Candidate[] {
  const lines = s.objectives
    .split('\n')
    .map(stripBullet)
    .filter(line => line !== '' && !line.endsWith(':') && !line.startsWith('#') && isPhrase(line))
    .map(text => ({ text: clip(text), isUpdate: false }))
  const updates = updateBlocks(s.updates).map(text => ({ text: clip(text), isUpdate: true }))
  return [...lines, ...updates]
}

function tokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const words = (lower.match(/[a-z0-9][a-z0-9-]{3,}/g) ?? []).filter(word => !STOP.has(word))
  const bigrams = (lower.match(/[぀-ヿ㐀-鿿]{2,}/g) ?? []).flatMap(run => Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)))
  return new Set([...words, ...bigrams])
}

// Laya answers with confidence on any pair, related or not: a reply must share a word with the item to move it.
export function mentions(item: string, answer: string): boolean {
  const reply = tokens(answer)
  return [...tokens(item)].some(token => reply.has(token))
}

export function isBackground(pTask: number): boolean {
  return 1 - pTask >= BACKGROUND_FLOOR
}

// The status a reply moves an item to, or undefined to leave it. Statuses only move forward.
export function moved(item: Item, answer: string, verdict: Verdict | undefined): Status | undefined {
  if (verdict === undefined || verdict.p < CHANGE_FLOOR) return undefined
  const next = REPLY[verdict.label]
  if (next === undefined || RANK[next] <= RANK[item.status] || !mentions(item.text, answer)) return undefined
  return next
}

// Pins every item whose status is not the one the AI last wrote, and forgets items that left the list.
export function settle(memory: Memory, list: readonly Item[]): Memory {
  const present = new Set(list.map(item => keyOf(item.text)))
  const pins = new Set(memory.pins.filter(key => present.has(key)))
  const ai: Record<string, Status> = {}
  for (const item of list) {
    const key = keyOf(item.text)
    const wrote = memory.ai[key]
    if (wrote !== undefined) ai[key] = wrote
    if (wrote === undefined ? item.status !== 'todo' : wrote !== item.status) pins.add(key)
  }
  return { seen: memory.seen, ai, pins: [...pins] }
}

export function pin(memory: Memory, key: string): Memory {
  return memory.pins.includes(key) ? memory : { ...memory, pins: [...memory.pins, key] }
}

// A click on an item sets its next status; the caller pins it.
export function cycleItem(body: string, key: string): string {
  return format(parse(body).map(line => ('item' in line && keyOf(line.item.text) === key ? { item: { ...line.item, status: cycle(line.item.status) } } : line)))
}

export type Move = { from: Status; to: Status }
export type Plan = { add: readonly Item[]; set: Readonly<Record<string, Move>>; seen: readonly string[] }
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
    const move = plan.set[key]
    if (move === undefined || move.from !== line.item.status) return line
    applied.push({ text: line.item.text, from: move.from, to: move.to, isHandSet: pins.has(key) })
    ai[key] = move.to
    pins.delete(key)
    return { item: { ...line.item, status: move.to } }
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
  return { body: format(lines), memory: { seen, ai, pins: [...pins] }, applied }
}

const SECTION_CAP = 40

// What Claude reads each turn: the list, and what to work on next.
export function context(body: string): string | undefined {
  const list = items(body)
  if (list.length === 0) return undefined
  const open = list.filter(item => item.status === 'todo' || item.status === 'in-progress')
  const focus = open.find(item => item.status === 'in-progress') ?? open[0]
  const head = focus === undefined ? 'Nothing is open.' : `Work on: ${focus.text}`
  const shown = list.slice(0, SECTION_CAP).map(item => `- [${item.status}] ${item.text}`)
  const more = list.length > SECTION_CAP ? [`(${list.length - SECTION_CAP} more in the notes file)`] : []
  return ['Todo list kept by notes-keeping (statuses: todo, in-progress, done, declined). The captain and the plugin set them; you never edit the notes file.', head, ...shown, ...more].join('\n')
}
