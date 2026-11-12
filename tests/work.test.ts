import { describe, expect, test } from 'claude-code/testing'

import type { FleetRow } from '../types'
import { ageOf, callsShown, details, needsYou, reportHead, reportLines, selectedRow, todoLines, unlinkedRows, unlinkedText, waitingText, workStatus } from '../hooks/work'

const NOW = Date.UTC(2026, 10, 5, 2, 0, 0)
const S = Math.floor(NOW / 1000)
const row = (task: string, extra: Partial<FleetRow> = {}): FleetRow => ({
  task, kind: 'scout', title: null, word: 'working', at: S - 60, flag: '', waiting: '', window: `s:fm-${task}`, live: true, gone: false,
  pr: null, report: null, summary: null, todos: [], answer: null, ...extra,
})
const CLEANROOM = {
  title: 'Cleanroom POC - report (step 1 blocked)',
  outcome: 'BLOCKED at spec step 1. Local webapp app is not running.',
  ask: 'Start the webapp API server and web frontend locally.',
  at: S - 9 * 86400,
}

describe('waiting', () => {
  test('a gone worker reads "gone:" and the last line, not the bridge sentence', () => {
    expect(waitingText('firstmate: worker gone; last: webapp app not running')).toBe('gone: webapp app not running')
    expect(waitingText('firstmate: worker gone; no state line')).toBe('gone: no state line')
    expect(waitingText('worker: implementing')).toBe('worker: implementing')
  })
})

describe('unlinked rows', () => {
  test('the Work view lists the calls and live workers no open to-do links; gone rows only while shown', () => {
    const rows = [
      row('call', { flag: '!', word: 'call', live: false }),
      row('linked-call', { flag: '!', word: 'call', live: false, todos: ['ab12cd3'] }),
      row('run'),
      row('linked', { todos: ['ab12cd3'] }),
      row('ended', { word: 'finished', live: false }),
      row('old', { word: 'done', live: false, gone: true }),
    ]
    expect(unlinkedRows(rows, []).map(r => r.task)).toEqual(['call', 'run'])
    expect(unlinkedRows(rows, ['gone']).map(r => r.task)).toEqual(['call', 'run', 'old'])
  })
})

describe('report lines', () => {
  test('a row with a report summary gets its age, title and outcome; the ask only where the row waits on someone', () => {
    const r = row('cleanroom-poc', { flag: '?', report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM })
    expect(reportLines(r, NOW)).toEqual([
      'report 9d  Cleanroom POC - report (step 1 blocked): BLOCKED at spec step 1. Local webapp app is not running.',
      'needs  Start the webapp API server and web frontend locally.',
    ].map(line => (line.length <= 85 ? line : `${line.slice(0, 84)}…`)))
    expect(reportLines({ ...r, flag: '' }, NOW)).toHaveLength(1)
  })

  test('a report with no outcome shows its title alone; one that could not be read shows its path; no report, no line', () => {
    expect(reportLines(row('x', { report: '/r.md', summary: { title: 'T', outcome: null, ask: null, at: S - 120 } }), NOW)).toEqual(['report 2m  T'])
    expect(reportLines(row('x', { report: '/gone/r.md' }), NOW)).toEqual(['report  /gone/r.md (not readable)'])
    expect(reportLines(row('x'), NOW)).toEqual([])
  })
})

describe('report head', () => {
  test('the reader opens on the title with its age and b at the right edge, then the kind and the to-do; no path line', () => {
    const r = row('cleanroom-poc', { report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM })
    expect(reportHead(r, NOW, { label: 'Fix the cleanroom', mark: '[~]' })).toEqual([
      `${'Cleanroom POC - report (step 1 blocked)'.padEnd(89 - '9d ago · b: back'.length)}9d ago · b: back`,
      'scout · to-do: Fix the cleanroom [~]',
    ])
    expect(reportHead(r, NOW)).toEqual([`${'Cleanroom POC - report (step 1 blocked)'.padEnd(89 - '9d ago · b: back'.length)}9d ago · b: back`, 'scout'])
  })

  test('while a call on it is open, the reader pins what the report needs, with a: answer at the right edge', () => {
    const r = row('cleanroom-poc', { report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM })
    expect(reportHead(r, NOW, undefined, CLEANROOM.ask)[2]).toBe(`${`! Needs you: ${CLEANROOM.ask}`.padEnd(89 - 'a: answer'.length)}a: answer`)
  })
})

describe('details', () => {
  test('the details put the report summary right under the name, before the raw state line', () => {
    const r = row('cleanroom-poc', { flag: '?', word: 'blocked', live: false, report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM, waiting: 'firstmate: worker gone; last: app down' })
    expect(details(r, 'cleanroom-poc', NOW, undefined).slice(0, 6)).toEqual([
      'cleanroom-poc  ·  cleanroom-poc  ·  scout  ·  worker window gone',
      'report  Cleanroom POC - report (step 1 blocked)  (9d ago, v reads it here)',
      'outcome BLOCKED at spec step 1. Local webapp app is not running.',
      'needs   Start the webapp API server and web frontend locally.',
      'last    blocked 1m ago: gone: app down',
      'PR      none recorded',
    ])
  })
})

describe('lines from real fleet output', () => {
  const callOn = (question: string) => row('c', { word: 'call', todos: ['t1'], call: { question, options: [], at: S - 3600, state: 'open' } })
  test('a call line keeps a capitalized name or acronym as written, lowers a plain first word', () => {
    expect(todoLines([callOn('PROJ-790: send it?')], 't1', 'todo', NOW)[0].text).toMatch(/^    ! your call: PROJ-790: send it\?/)
    expect(todoLines([callOn('XiaoXiao STEP 2 reply')], 't1', 'todo', NOW)[0].text).toMatch(/^    ! your call: XiaoXiao STEP 2 reply/)
    expect(todoLines([callOn('Post the reply?')], 't1', 'todo', NOW)[0].text).toMatch(/^    ! your call: post the reply\?/)
  })
  test('an open call line ends in its age and a: answer, and carries the task the click opens', () => {
    const [line] = todoLines([callOn('Post the reply?')], 't1', 'todo', NOW)
    expect(line).toEqual({ text: `${'    ! your call: post the reply?'.padEnd(89 - 'open · 1h · a: answer'.length)}open · 1h · a: answer`, isCall: true, task: 'c' })
  })
  test('a worker line names a PR link in its text as <repo>#<n>', () => {
    const done = row('w', { word: 'done', todos: ['t1'], waiting: 'PR https://github.com/acme/webapp/pull/28276', live: false })
    expect(todoLines([done], 't1', 'done', NOW)[0].text).toBe('      worker finished 1m ago · PR webapp#28276')
  })
  test('a worker line whose text already names its PR does not name it again', () => {
    const pr = 'https://github.com/acme/webapp/pull/28077'
    const done = row('w', { word: 'done', todos: ['t1'], waiting: `PR ${pr} checks green`, pr, live: false })
    expect(todoLines([done], 't1', 'done', NOW)[0].text).toBe('      worker finished 1m ago · PR webapp#28077 checks green')
  })
  test('a worker line with no time carries no age', () => {
    const stopped = row('w', { word: 'stopped', todos: ['t1'], at: null, live: false })
    expect(todoLines([stopped], 't1', 'done', NOW)[0].text).toBe('      worker stopped')
  })
  test('the reader head leaves out a kind the row does not have', () => {
    expect(reportHead(row('w', { kind: null, summary: CLEANROOM }), NOW, { label: 'Fix it', mark: '[~]' })[1]).toBe('to-do: Fix it [~]')
  })
})

describe('ages', () => {
  test('an age is the largest whole unit: s under a minute, m under an hour, h under a day, then d; no time is -, a time ahead is 0s', () => {
    expect(ageOf(null, NOW)).toBe('-')
    expect(ageOf(S, NOW)).toBe('0s')
    expect(ageOf(S + 30, NOW)).toBe('0s')
    expect(ageOf(S - 59, NOW)).toBe('59s')
    expect(ageOf(S - 60, NOW)).toBe('1m')
    expect(ageOf(S - 3599, NOW)).toBe('59m')
    expect(ageOf(S - 3600, NOW)).toBe('1h')
    expect(ageOf(S - 86399, NOW)).toBe('23h')
    expect(ageOf(S - 86400, NOW)).toBe('1d')
  })
})

describe('calls that need the captain', () => {
  const rows = [
    row('free-call', { flag: '!', word: 'call', live: false }),
    row('shown-call', { flag: '!', word: 'call', live: false, todos: ['ab12cd3'] }),
    row('hidden-call', { flag: '!', word: 'call', live: false, todos: ['zz99zz9'] }),
    row('ask', { flag: '?' }),
    row('run'),
  ]

  test('only ! rows need the captain; no fleet needs nothing', () => {
    expect(needsYou(null)).toEqual([])
    expect(needsYou({ rows, calls: 3, at: S }).map(r => r.task)).toEqual(['free-call', 'shown-call', 'hidden-call'])
  })

  test('the Todos tab counts calls linked to a shown to-do or to none, not those whose to-dos are all hidden', () => {
    expect(callsShown(null, new Set())).toBe(0)
    expect(callsShown({ rows, calls: 3, at: S }, new Set(['ab12cd3']))).toBe(2)
    expect(callsShown({ rows, calls: 3, at: S }, new Set())).toBe(1)
  })

  test('the status line names the count, singular or plural, and is gone at zero', () => {
    expect(workStatus(0)).toBeUndefined()
    expect(workStatus(1)).toBe('calls: 1 needs you · ctrl+q')
    expect(workStatus(2)).toBe('calls: 2 need you · ctrl+q')
  })
})

describe('the line under the Todos list', () => {
  test('counts the calls and live workers no to-do links, and the calls closed today without the captain; none of them, no line', () => {
    expect(unlinkedText({ rows: [row('linked', { todos: ['ab12cd3'] })], calls: 0, at: S })).toBeUndefined()
    expect(unlinkedText({ rows: [row('c', { word: 'call', flag: '!', live: false }), row('w'), row('w2'), row('ended', { word: 'finished', live: false }), row('old', { gone: true })], calls: 1, at: S })).toBe('Not on a to-do: 1 call, 2 workers')
    expect(unlinkedText({ rows: [row('w')], calls: 0, at: S, closedToday: 2 })).toBe('Not on a to-do: 1 worker · 2 calls closed without you today')
    expect(unlinkedText({ rows: [], calls: 0, at: S, closedToday: 1 })).toBe('Not on a to-do: nothing live · 1 call closed without you today')
  })
})

describe('selection in the Work view', () => {
  test('the ring stays on its row while shown, else the first row; no rows, none', () => {
    const rows = [row('a'), row('b')]
    expect(selectedRow(rows, 'b')).toBe('b')
    expect(selectedRow(rows, 'gone')).toBe('a')
    expect(selectedRow(rows, null)).toBe('a')
    expect(selectedRow([], 'a')).toBeUndefined()
  })
})
