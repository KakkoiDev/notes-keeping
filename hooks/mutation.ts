import type { ActorId } from './actors'
import { logRow } from './logs'
import { AGENT_TAG, addImportant, addLogs, addUpdate, sections, setObjectives, setTodo, stamp } from './notes'
import { cycleItem, format, idOf, items, keyOf, parse, type Change, type Status, withIds } from './todo'

export type MutationKind = 'status' | 'add' | 'objective' | 'update' | 'important'

export type MutationRequest = {
  kind: MutationKind
  text?: string
  selector?: string
  status?: Status
  reason?: string
  actor: ActorId
  transport: string
  eventId: string
  requestHash: string
  at: number
}

export type MutationApplied = {
  markdown: string
  subject: string
  message: string
  saved: boolean
  changes: Change[]
}

// SHA-256 without a runtime import, so Claude's restricted hook loader and the Bun CLI share one revision format.
export function revisionOf(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const rotate = (value: number, by: number) => (value >>> by) | (value << (32 - by))
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const w = Array<number>(64).fill(0)
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!
      const b = w[i - 2]!
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, q] = h
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)
      const choose = (e! & f!) ^ (~e! & g!)
      const t1 = (q! + s1 + choose + k[i]! + w[i]!) >>> 0
      const s0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!)
      const t2 = (s0 + majority) >>> 0
      q = g
      g = f
      f = e
      e = (d! + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    const next = [a!, b!, c!, d!, e!, f!, g!, q!]
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) >>> 0
  }
  return h.map(value => value.toString(16).padStart(8, '0')).join('')
}

function metadata(request: MutationRequest): string {
  return `transport=${request.transport} event=${request.eventId} hash=${request.requestHash}`
}

function contentNote(text: string, request: MutationRequest): string {
  const meta = metadata(request)
  return request.transport === 'tmux/codex' ? meta : `${text} ${meta}`
}

function textOf(request: MutationRequest): string {
  const text = request.text?.trim() ?? ''
  if (text === '') throw new Error(`${request.kind} needs text`)
  return text
}

function findItem(markdown: string, selector: string) {
  const list = items(sections(markdown).todo)
  const wanted = selector.replace(/^id:/, '')
  const found = list.filter(item =>
    item.id === wanted || keyOf(item.text) === keyOf(selector) || (item.label !== undefined && keyOf(item.label) === keyOf(selector)),
  )
  if (found.length === 0) throw new Error(`no todo item matches: ${selector}`)
  if (found.length > 1) throw new Error(`todo item is ambiguous: ${selector}`)
  return found[0]!
}

export function applyMutation(markdown: string, request: MutationRequest): MutationApplied {
  const meta = metadata(request)
  if (request.kind === 'status') {
    if (request.selector === undefined || request.status === undefined) throw new Error('status needs selector and status')
    const item = findItem(markdown, request.selector)
    const body = cycleItem(sections(markdown).todo, idOf(item), () => request.status!, request.reason)
    const changed = items(body).find(one => idOf(one) === idOf(item)) || { ...item, status: request.status }
    const note = [request.reason, meta].filter(Boolean).join(' ')
    const out = addLogs(setTodo(markdown, body), [
      logRow({ at: request.at, actor: request.actor, action: 'status', item: changed, from: item.status, to: request.status, note }),
    ])
    return {
      markdown: out,
      subject: 'todo',
      message: `${changed.label || changed.text}: ${item.status} -> ${request.status}`,
      saved: out !== markdown,
      changes: [{ item: changed, from: item.status, to: request.status }],
    }
  }

  const text = textOf(request)
  if (request.kind === 'add') {
    const current = sections(markdown).todo
    const duplicate = items(current).find(item => keyOf(item.text) === keyOf(text))
    if (duplicate !== undefined) {
      return {
        markdown,
        subject: 'todo',
        message: `Already exists: ${duplicate.id ?? '-'} ${duplicate.label || duplicate.text}`,
        saved: false,
        changes: [],
      }
    }
    const body = format(withIds(parse([current, `- [ ] ${text}`].filter(Boolean).join('\n'))))
    const item = items(body).find(one => keyOf(one.text) === keyOf(text))!
    const out = addLogs(setTodo(markdown, body), [
      logRow({ at: request.at, actor: request.actor, action: 'added', item, to: 'todo', note: meta }),
    ])
    return {
      markdown: out,
      subject: 'todo',
      message: `${item.id} ${item.text}`,
      saved: true,
      changes: [{ item, to: 'todo' }],
    }
  }

  if (request.kind === 'objective') {
    const isSet = sections(markdown).objectives === ''
    const out = isSet ? setObjectives(markdown, text) : addUpdate(markdown, stamp(request.at), text)
    const action = isSet ? 'objective' : 'update'
    return {
      markdown: addLogs(out, [logRow({ at: request.at, actor: request.actor, action, note: contentNote(text, request) })]),
      subject: action,
      message: isSet ? 'Objectives set' : 'Added as update',
      saved: true,
      changes: [],
    }
  }

  if (request.kind === 'update') {
    const out = addUpdate(markdown, stamp(request.at), text)
    return {
      markdown: addLogs(out, [logRow({ at: request.at, actor: request.actor, action: 'update', note: contentNote(text, request) })]),
      subject: 'update',
      message: 'Update added',
      saved: true,
      changes: [],
    }
  }

  const out = addImportant(markdown, AGENT_TAG, text)
  return {
    markdown: addLogs(out, [logRow({ at: request.at, actor: request.actor, action: 'important', note: meta })]),
    subject: 'important',
    message: 'Important added',
    saved: true,
    changes: [],
  }
}
