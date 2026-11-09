import { describe, expect, test } from 'claude-code/testing'

import { ACTORS, actorLabel } from '../hooks/actors'
import { PICKUP_MS, addsItem, importLegacy, logRow, overdue, pickedEntry, readRows, recordedEntry, unpicked } from '../hooks/logs'
import { addChat, addLogs, addUpdate, create, inject, injectPrevious, logsHint, sections, setTodo } from '../hooks/notes'

const AT = Date.UTC(2026, 9, 29, 1, 12, 43, 512)

describe('actors', () => {
  test('the config names each actor once with a kind and a label, Laya by the models it runs', () => {
    expect(ACTORS.map(actor => actor.id)).toEqual(['captain', 'firstmate', 'laya', 'plugin', 'unknown'])
    expect(new Set(ACTORS.map(actor => actor.id)).size).toBe(ACTORS.length)
    expect(Object.fromEntries(ACTORS.map(actor => [actor.id, actor.kind]))).toEqual({
      captain: 'human',
      firstmate: 'ai-agent',
      laya: 'ai-agent',
      plugin: 'plugin',
      unknown: 'unknown',
    })
    expect(actorLabel('laya')).toContain('aac6fef/laya-mlx')
    expect(actorLabel('firstmate')).toContain('Claude Opus 5.5')
    expect(actorLabel('unknown')).not.toMatch(/captain|human/i)
  })
})

describe('log rows', () => {
  test('one row per action: UTC time to the second, actor id, action, item id and label, from -> to, a note', () => {
    const item = { status: 'declined' as const, text: 'Investigate the Sentry production alert', label: 'Sentry alert', id: '1uxnkut' }
    expect(logRow({ at: AT, actor: 'laya', action: 'status', item, from: 'in-progress', to: 'declined', note: 'rejected 0.95' })).toBe(
      '- 2026-10-29T01:12:43Z | laya | status | id:1uxnkut Sentry alert | in-progress -> declined | rejected 0.95',
    )
    expect(logRow({ at: AT, actor: 'plugin', action: 'added', item: { status: 'todo', text: 'Ship it' }, to: 'todo' })).toBe(
      '- 2026-10-29T01:12:43Z | plugin | added | Ship it | none -> todo',
    )
    expect(logRow({ at: AT, actor: 'captain', action: 'update', note: 'Add a logs | tab\nwith rows' })).toBe(
      '- 2026-10-29T01:12:43Z | captain | update | - | - | Add a logs / tab with rows',
    )
  })

  test('rows read back; a line that is not a row is skipped', () => {
    const text = [
      logRow({ at: AT, actor: 'captain', action: 'status', item: { status: 'done', text: 'A', id: 'ab12cd3' }, from: 'todo', to: 'done' }),
      'a hand-written line',
      logRow({ at: AT, actor: 'unknown', action: 'status', item: { status: 'todo', text: 'B' }, from: 'done', to: 'todo' }),
    ].join('\n')
    expect(readRows(text)).toEqual([
      { time: '2026-10-29T01:12:43Z', actor: 'captain', action: 'status', item: 'id:ab12cd3 A', change: 'todo -> done', note: '' },
      { time: '2026-10-29T01:12:43Z', actor: 'unknown', action: 'status', item: 'B', change: 'done -> todo', note: '' },
    ])
  })

  test('todo-changes.log rows of this notes file become log rows with their actor, matched to the item id by text', () => {
    const log = [
      '2026-10-28-17-35 mine.md | Investigate the Sentry production alert | todo -> in-progress | laya started 1.00',
      '2026-10-28-17-36 other.md | Something else | todo -> done | laya finished 0.97',
      '2026-10-28-17-49 mine.md | Investigate the Sentry production alert | in-progress -> declined | laya rejected 1.00 | replaced a hand-set status',
      '2026-10-28-18-00 mine.md | Review this pr | todo -> in-progress | firstmate pr-review',
      '2026-10-28-18-01 mine.md | A | B | todo -> done',
      'garbage',
    ].join('\n')
    const list = [{ status: 'declined' as const, text: 'Investigate the Sentry production alert', label: 'Sentry alert', id: '1uxnkut' }]
    const at = (h: number, m: number) => new Date(2026, 9, 28, h, m).toISOString().replace(/\.\d{3}Z$/, 'Z')
    expect(importLegacy(log, 'mine.md', list)).toEqual([
      `- ${at(17, 35)} | laya | status | id:1uxnkut Sentry alert | todo -> in-progress | started 1.00 (posterior), from todo-changes.log`,
      `- ${at(17, 49)} | laya | status | id:1uxnkut Sentry alert | in-progress -> declined | rejected 1.00 (posterior), replaced a hand-set status, from todo-changes.log`,
      `- ${at(18, 0)} | firstmate | status | Review this pr | todo -> in-progress | pr-review, from todo-changes.log`,
      `- ${at(18, 1)} | unknown | status | A / B | todo -> done | from todo-changes.log`,
    ])
  })
})

describe('recorded and picked up', () => {
  const R1 = 'nk-0123456789abcdef'
  const R2 = 'nk-fedcba9876543210'

  test('an item handed to firstmate is one recorded row: who made it, the request id of its inbox note, then what it holds', () => {
    expect(logRow(recordedEntry(AT, 'captain', R1, 'answer decide-x: 1 Store-only'))).toBe(
      `- 2026-10-29T01:12:43Z | captain | recorded | - | - | ${R1} answer decide-x: 1 Store-only`,
    )
  })

  test('its pickup is a second row by firstmate: "picked up by firstmate HH:MM", the UTC time firstmate acknowledged the note', () => {
    expect(logRow(pickedEntry(AT, R1, Date.UTC(2026, 9, 29, 1, 9, 59)))).toBe(`- 2026-10-29T01:12:43Z | firstmate | picked-up | - | - | ${R1} picked up by firstmate 01:09`)
  })

  test('the items not picked up are the recorded rows with no picked-up row for their request, oldest first, with their time', () => {
    const logs = [
      logRow(recordedEntry(AT, 'captain', R1, 'answer decide-x: yes')),
      logRow({ at: AT, actor: 'captain', action: 'status', item: { status: 'done', text: 'A' }, from: 'todo', to: 'done' }),
      logRow(recordedEntry(AT + 1000, 'plugin', R2, 'Ship it (+1 more)')),
      logRow(pickedEntry(AT + 2000, R1, AT + 1500)),
    ].join('\n')
    expect(unpicked(logs)).toEqual([{ request: R2, summary: 'Ship it (+1 more)', at: Date.UTC(2026, 9, 29, 1, 12, 44) }])
    expect(unpicked('')).toEqual([])
  })

  test('the badge counts an item once it waited about 5 minutes: at 4:59 it is not counted, at 5:00 it is', () => {
    const list = [{ request: R1, summary: 'x', at: AT }]
    expect(PICKUP_MS).toBe(5 * 60_000)
    expect(overdue(list, AT + PICKUP_MS - 1000)).toEqual([])
    expect(overdue(list, AT + PICKUP_MS)).toEqual(list)
  })

  test('a todo note is recorded when it adds an item; status changes alone, by anyone, are not', () => {
    expect(addsItem(['Review: todo -> done (captain)', '+ [ ] Ship it [id:ab12cd3]'])).toBe(true)
    expect(addsItem(['Review: todo -> done (captain) [id:ab12cd3]', 'Review: todo -> in-progress (laya)', 'Ship: todo -> done (firstmate run-a)'])).toBe(false)
  })
})

describe('# Logs section', () => {
  const md = setTodo(addUpdate(create('Ship the logs', 'sid'), '2026-10-29-10-00', 'Add a tab'), '- [ ] Ship the logs')

  test('is added last on the first row; later rows append; the other sections read without it', () => {
    const one = addLogs(md, ['- row one'])
    expect(one.trimEnd().endsWith('# Logs\n\n- row one')).toBe(true)
    const two = addLogs(addChat(one, 'agent text', 'user text'), ['- row two', '- row three'])
    expect(sections(two).logs).toBe('- row one\n- row two\n- row three')
    expect(sections(two).chat).toBe('[AI_AGENT] agent text\n[USER] user text')
    expect(two.indexOf('# Chat')).toBeLessThan(two.indexOf('# Logs'))
    expect(sections(two).todo).toBe('- [ ] Ship the logs')
    expect(addLogs(md, [])).toBe(md)
    expect(sections(md).logs).toBe('')
  })

  test('a chat line that reads # Logs is escaped so it does not open the section', () => {
    const out = addChat(md, 'see below\n# Logs', 'ok')
    expect(sections(out).logs).toBe('')
    expect(sections(out).chat).toContain('\\# Logs')
  })

  test('stays out of what Claude is handed; one line says where it is and when to read it', () => {
    const logged = addLogs(md, ['- 2026-10-29T01:12:43Z | captain | status | Ship the logs | todo -> done'])
    expect(inject(logged, '/n.md')).not.toContain('\n# Logs\n')
    expect(inject(logged, '/n.md')).not.toContain('| captain |')
    expect(inject(logged, '/n.md')).toContain(logsHint('/n.md'))
    expect(injectPrevious(logged, '/p.md')).not.toContain('| captain |')
    expect(logsHint('/n.md')).toBe(
      'Action log: the # Logs section of /n.md holds who (human or AI agent) created or changed each objective and todo, and when. It is not in this context: read it when asked about the history of actions, a chain of events, or who changed a status.',
    )
  })
})
