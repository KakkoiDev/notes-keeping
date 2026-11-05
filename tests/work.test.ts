import { describe, expect, test } from 'claude-code/testing'

import type { FleetRow } from '../types'
import { details, groupsOf, reportHead, reportLines, waitingText } from '../hooks/work'

const NOW = Date.UTC(2026, 10, 5, 2, 0, 0)
const S = Math.floor(NOW / 1000)
const row = (task: string, extra: Partial<FleetRow> = {}): FleetRow => ({
  task, kind: 'scout', title: null, word: 'working', at: S - 60, flag: '', waiting: '', window: `s:fm-${task}`, live: true, gone: false,
  pr: null, report: null, summary: null, todo: null, answer: null, ...extra,
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

describe('groups', () => {
  test('rows fall under their group in the filter order, keeping their order; an empty or hidden group has no section', () => {
    const rows = [
      row('ask', { flag: '?', word: 'blocked' }),
      row('call', { flag: '!', word: 'call' }),
      row('run'),
      row('fin', { word: 'done' }),
      row('old', { word: 'done', gone: true }),
      row('ask2', { flag: '?', word: 'decision' }),
    ]
    expect(groupsOf(rows, ['gone']).map(g => [g.group, g.title, g.rows.map(r => r.task)])).toEqual([
      ['you', 'Needs you', ['call']],
      ['firstmate', 'Firstmate', ['ask', 'ask2']],
      ['running', 'Running', ['run']],
      ['done', 'Done', ['fin']],
    ])
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
  test('the report view opens on the title, where the file is and when it was written, the outcome and the ask', () => {
    const r = row('cleanroom-poc', { report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM })
    expect(reportHead(r, NOW)).toEqual([
      'Cleanroom POC - report (step 1 blocked)',
      '/fm/data/cleanroom-poc/report.md · written 9d ago',
      'outcome  BLOCKED at spec step 1. Local webapp app is not running.',
      'needs    Start the webapp API server and web frontend locally.',
    ])
  })
})

describe('details', () => {
  test('the details put the report summary right under the name, before the raw state line', () => {
    const r = row('cleanroom-poc', { flag: '?', word: 'blocked', live: false, report: '/fm/data/cleanroom-poc/report.md', summary: CLEANROOM, waiting: 'firstmate: worker gone; last: app down' })
    expect(details(r, 'cleanroom-poc', NOW, undefined, undefined).slice(0, 6)).toEqual([
      'cleanroom-poc  ·  cleanroom-poc  ·  scout  ·  worker window gone',
      'report  Cleanroom POC - report (step 1 blocked)  (9d ago, v reads it here)',
      'outcome BLOCKED at spec step 1. Local webapp app is not running.',
      'needs   Start the webapp API server and web frontend locally.',
      'last    blocked 1m ago: gone: app down',
      'PR      none recorded',
    ])
  })
})
