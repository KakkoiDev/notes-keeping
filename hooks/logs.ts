import type { ActorId } from './actors'
import type { Item, Status } from './todo'
import { keyOf, shown } from './todo'

// status: a todo item's status changed; added: a todo item appeared; objective, update: the objectives were set or an
// [UPDATE] added; attach: an earlier notes file was copied in; recorded: an inbox note for firstmate was filed (an answer to
// a call, a todo change); picked-up: firstmate acknowledged that note.
export type Action = 'status' | 'added' | 'objective' | 'update' | 'attach' | 'recorded' | 'picked-up'
export type Entry = { at: number; actor: ActorId; action: Action; item?: Item; from?: Status; to?: Status; note?: string }
export type Row = { time: string; actor: string; action: string; item: string; change: string; note: string }

const STATUS = '(todo|in-progress|done|declined)'
const ROW = /^- (\S+) \| (\S+) \| (\S+) \| (.*?) \| (.*?)(?: \| (.*))?$/
// <YYYY-MM-DD-HH-MM> <notes file> | <item text> | <from> -> <to>[ | laya <label> <p> | firstmate <task>][ | replaced a hand-set status]
const LEGACY = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})-(\\d{2}) (\\S+) \\| (.*) \\| ${STATUS} -> ${STATUS}((?: \\| .*)?)$`)

function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// A cell holds no pipe and no line break.
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
}

function itemCell(item: Item | undefined): string {
  if (item === undefined) return '-'
  return cell(item.id === undefined ? shown(item) : `id:${item.id} ${shown(item)}`)
}

export function logRow(entry: Entry): string {
  const change = entry.to === undefined ? '-' : `${entry.from ?? 'none'} -> ${entry.to}`
  const note = entry.note === undefined || entry.note.trim() === '' ? '' : ` | ${cell(entry.note)}`
  return `- ${utc(entry.at)} | ${entry.actor} | ${entry.action} | ${itemCell(entry.item)} | ${change}${note}`
}

// The last n status changes of item `id` in a # Logs section, oldest first: `  HH:MM  from -> to, <actor>` (UTC).
export function historyOf(logs: string, id: string, label: (actor: string) => string, n = 3): string[] {
  return readRows(logs)
    .filter(row => row.action === 'status' && row.change !== '-' && row.item.startsWith(`id:${id} `))
    .slice(-n)
    .map(row => `  ${row.time.slice(11, 16)}  ${row.change}, ${label(row.actor)}`)
}

export function readRows(logs: string): Row[] {
  return logs.split('\n').flatMap(line => {
    const m = ROW.exec(line.trim())
    if (m === null) return []
    return [{ time: m[1] ?? '', actor: m[2] ?? '', action: m[3] ?? '', item: m[4] ?? '', change: m[5] ?? '', note: m[6] ?? '' }]
  })
}

// The rows ~/.notes-keeping/todo-changes.log holds for one notes file, as log rows, oldest first. Its time is local to the
// minute; its Laya probability is the one the cue words lifted.
export function importLegacy(log: string, file: string, list: readonly Item[]): string[] {
  const byText = new Map(list.map(item => [keyOf(item.text), item] as const))
  return log.split('\n').flatMap(line => {
    const m = LEGACY.exec(line)
    if (m === null || m[6] !== file) return []
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
    const text = m[7] ?? ''
    const extras = (m[10] ?? '').split(' | ').map(part => part.trim()).filter(part => part !== '')
    const said = extras.find(part => /^(laya|firstmate) /.test(part))
    const actor: ActorId = said === undefined ? 'unknown' : said.startsWith('laya ') ? 'laya' : 'firstmate'
    const notes = [
      ...(said === undefined ? [] : [actor === 'laya' ? `${said.slice('laya '.length)} (posterior)` : said.slice('firstmate '.length)]),
      ...extras.filter(part => part !== said),
      'from todo-changes.log',
    ]
    const item = byText.get(keyOf(text)) ?? { status: m[9] as Status, text }
    return [logRow({ at, actor, action: 'status', item, from: m[8] as Status, to: m[9] as Status, note: notes.join(', ') })]
  })
}

// A recorded item counts as not picked up once it waited this long.
export const PICKUP_MS = 5 * 60_000
const REQUEST = /^(nk-[0-9a-f]{16}) (.*)$/

export type Unpicked = { request: string; summary: string; at: number }

export function recordedEntry(at: number, actor: ActorId, request: string, summary: string): Entry {
  return { at, actor, action: 'recorded', note: `${request} ${summary}` }
}

// pickedAt: when firstmate acknowledged the note, written HH:MM in UTC.
export function pickedEntry(at: number, request: string, pickedAt: number): Entry {
  return { at, actor: 'firstmate', action: 'picked-up', note: `${request} picked up by firstmate ${utc(pickedAt).slice(11, 16)}` }
}

// The recorded rows whose request has no picked-up row, oldest first.
export function unpicked(logs: string): Unpicked[] {
  const rows = readRows(logs)
  const done = new Set(rows.filter(row => row.action === 'picked-up').map(row => REQUEST.exec(row.note)?.[1]))
  return rows.flatMap(row => {
    const m = row.action === 'recorded' ? REQUEST.exec(row.note) : null
    if (m === null || done.has(m[1])) return []
    return [{ request: m[1] ?? '', summary: m[2] ?? '', at: Date.parse(row.time) }]
  })
}

export function overdue(list: readonly Unpicked[], now: number): Unpicked[] {
  return list.filter(one => now - one.at >= PICKUP_MS)
}

// Whether a todo note's change lines add an item: an update or objective made one, or a hand edit wrote one.
export function addsItem(lines: readonly string[]): boolean {
  return lines.some(line => line.startsWith('+ ['))
}
