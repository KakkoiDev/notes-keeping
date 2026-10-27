import { describe, expect, test } from 'claude-code/testing'

import {
  addChat,
  addTurn,
  addImportant,
  addSession,
  addUpdate,
  carryOver,
  create,
  fileName,
  inject,
  nameParts,
  newestFirst,
  projectName,
  sections,
  setContinuation,
  setObjectives,
  setTodo,
  stamp,
  summary,
} from '../hooks/notes'

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('stamp and file names', () => {
  test('YYYY-MM-DD-HH-MM-<folder>-<session id, 8 chars> in local time, suffixed on a clash', () => {
    const ms = new Date(2026, 9, 26, 10, 5).getTime()
    expect(stamp(ms)).toBe('2026-10-26-10-05')
    expect(projectName('/Users/me/Code/firstmate/')).toBe('firstmate')
    expect(fileName('firstmate', ID, ms, [])).toBe('2026-10-26-10-05-firstmate-0a1b2c3d.md')
    expect(
      fileName('firstmate', ID, ms, ['2026-10-26-10-05-firstmate-0a1b2c3d.md', '2026-10-26-10-05-firstmate-0a1b2c3d-2.md']),
    ).toBe('2026-10-26-10-05-firstmate-0a1b2c3d-3.md')
  })

  test('nameParts reads date, time, folder and short id, dashes in the folder included', () => {
    expect(nameParts('2026-11-01-00-07-my-app-deadbeef-2.md')).toEqual({
      date: '2026-11-01',
      time: '00:07',
      project: 'my-app',
      shortId: 'deadbeef',
    })
    expect(nameParts('README.md')).toBeUndefined()
  })

  test('newestFirst orders by the stamp across projects and skips other files', () => {
    expect(
      newestFirst([
        '2026-10-25-23-59-zeta-11111111.md',
        'README.md',
        '2026-11-01-00-00-my-app-22222222.md',
        '2026-10-26-10-50-alpha-33333333.md',
        '2026-10-26-10-50-alpha-33333333-2.md',
      ]),
    ).toEqual([
      '2026-11-01-00-00-my-app-22222222.md',
      '2026-10-26-10-50-alpha-33333333-2.md',
      '2026-10-26-10-50-alpha-33333333.md',
      '2026-10-25-23-59-zeta-11111111.md',
    ])
  })
})

describe('section writer', () => {
  test('init lays out the four headings in order and records the session id', () => {
    expect(create('  Plan the day  ', ID)).toBe(
      `# Objectives\n\nSessions: ${ID}\n\nPlan the day\n\n## Updates\n\n# Important\n\n# Chat\n`,
    )
    expect(sections(create('Plan', ID)).sessions).toEqual([ID])
    expect(sections(create('Plan', ID)).objectives).toBe('Plan')
  })

  test('addSession records a new session id once, keeping the continuation and the objectives', () => {
    let md = setContinuation(create('Plan', 'first'), 'old.md')
    md = addSession(md, 'second')
    md = addSession(md, 'second')
    expect(md.startsWith('# Objectives\n\nContinuation of: old.md\n\nSessions: first, second\n\nPlan\n\n## Updates')).toBe(true)
    expect(sections(md).sessions).toEqual(['first', 'second'])
    expect(sections(md).continuation).toBe('old.md')
    expect(sections(md).objectives).toBe('Plan')
  })

  test('update, important and chat land in their own sections', () => {
    let md = create('Plan', ID)
    md = addUpdate(md, '2026-10-26-10-58', 'Change of plan')
    md = addImportant(md, '[AI_AGENT]', 'Do not post yet')
    md = addChat(md, 'Shall I merge?', 'Merge 91')
    md = addUpdate(md, '2026-10-26-11-00', 'Second update')
    md = addChat(md, 'Next?', 'Ship it')
    expect(md).toBe(
      [
        '# Objectives',
        '',
        `Sessions: ${ID}`,
        '',
        'Plan',
        '',
        '## Updates',
        '',
        '[UPDATE] 2026-10-26-10-58',
        'Change of plan',
        '',
        '[UPDATE] 2026-10-26-11-00',
        'Second update',
        '',
        '# Important',
        '',
        '[AI_AGENT] Do not post yet',
        '',
        '# Chat',
        '',
        '[AI_AGENT] Shall I merge?',
        '[USER] Merge 91',
        '',
        '[AI_AGENT] Next?',
        '[USER] Ship it',
        '',
      ].join('\n'),
    )
  })

  test('a heading line inside added text is escaped so the file still parses', () => {
    const md = addChat(create('Plan', ID), 'Look:\n# Important\nend', 'ok')
    expect(md).toContain('\\# Important')
    const s = sections(addImportant(md, '[USER]', 'real one'))
    expect(s.important).toBe('[USER] real one')
    expect(s.chat).toContain('\\# Important')
  })

  test('continuation goes first under # Objectives and is replaced, not stacked', () => {
    let md = setContinuation(create('Plan', ID), '25-10-2026-00-00.md')
    expect(md.startsWith(`# Objectives\n\nContinuation of: 25-10-2026-00-00.md\n\nSessions: ${ID}\n\nPlan\n`)).toBe(true)
    md = setContinuation(md, '24-10-2026-09-00.md')
    expect(md.match(/Continuation of:/g)?.length).toBe(1)
    expect(sections(md).continuation).toBe('24-10-2026-09-00.md')
    expect(sections(md).objectives).toBe('Plan')
  })

  test('carryOver copies objectives, updates and open todo items with statuses, leaves done and declined ones behind; this file keeps its own status and nothing doubles', () => {
    const previous = '# Objectives\n\nOld plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] Old plan\n- [-] Dropped idea\n- [~] Carried open\n- [ ] Shared item\n- [ ] Plain open\n\n# Important\n\n[USER] old fact\n\n# Chat\n'
    let md = setTodo(create('New plan', ID), '- [~] Shared item')
    md = carryOver(md, previous, 'old.md')
    md = carryOver(md, previous, 'old.md')
    const s = sections(md)
    expect(s.continuation).toBe('old.md')
    expect(s.objectives).toBe('New plan')
    expect(s.updates).toBe('[UPDATE] 2026-10-24-10-00\nold change')
    expect(s.todo).toBe('- [~] Carried open\n- [ ] Plain open\n- [~] Shared item')
    expect(s.important).toBe('')
  })

  test('carryOver leaves behind an objective whose items are all done or declined, and keeps one with an open item or no item', () => {
    const previous = '# Objectives\n\nBackground line with no item here\n\n1. Ship the exporter\n   See the notes\n\n2. Fix the login bug\n3. Drop the legacy path\n4. Wire the audit log\n\n# Todo\n\n- [x] Ship the exporter\n- [ ] Fix the login bug\n- [-] Drop the legacy path\n- [x] Wire the audit log\n- [ ] Wire the audit log extras\n\n# Important\n\n# Chat\n'
    const md = carryOver(create('New plan', ID), previous, 'old.md')
    expect(sections(md).objectives).toBe('Background line with no item here\n\n2. Fix the login bug\n\nNew plan')
    expect(sections(md).todo).toBe('- [ ] Fix the login bug\n- [ ] Wire the audit log extras')
  })

  test('reads and writes the captain\'s example layout', () => {
    const example = '# Initial Prompt\n\nAll workers died.\n\n## Updates\n\n[UPDATE] 26-10-2026-10-58\n- Make a plugin\n\n\n# Important\n\n[AI_AGENT] keep this\n\n# Chat\n\n[AI_AGENT]Captain, go?\n[USER]Go.\n'
    const s = sections(example)
    expect(s.objectives).toBe('All workers died.')
    expect(s.updates).toBe('[UPDATE] 26-10-2026-10-58\n- Make a plugin')
    expect(s.important).toBe('[AI_AGENT] keep this')
    expect(s.chat).toBe('[AI_AGENT]Captain, go?\n[USER]Go.')
    expect(summary(example)).toBe('All workers died.')
    expect(sections(addImportant(example, '[USER]', 'two')).important).toBe('[AI_AGENT] keep this\n\n[USER] two')
  })

  test('empty objectives leave the heading bare; setObjectives fills it once, updates go under ## Updates', () => {
    const md = create('', ID)
    expect(md).toBe(`# Objectives\n\nSessions: ${ID}\n\n## Updates\n\n# Important\n\n# Chat\n`)
    expect(sections(md).objectives).toBe('')
    const set = setObjectives(md, 'Ship the band fix')
    expect(set).toBe(`# Objectives\n\nSessions: ${ID}\n\nShip the band fix\n\n## Updates\n\n# Important\n\n# Chat\n`)
    expect(summary(set)).toBe('Ship the band fix')
  })

  test('a file from before Objectives keeps its # Initial Prompt heading', () => {
    const old = `# Initial Prompt\n\nSessions: ${ID}\n\nOld plan\n\n## Updates\n\n# Important\n\n# Chat\n`
    expect(sections(old).objectives).toBe('Old plan')
    const md = addSession(old, 'second')
    expect(md.startsWith(`# Initial Prompt\n\nSessions: ${ID}, second\n\nOld plan\n\n## Updates`)).toBe(true)
    expect(md).not.toContain('# Objectives')
  })

  test("reads and writes the captain's hand-edited heading layout intact", () => {
    // The captain's hand-edited headings; the body text is a stand-in.
    const captain = '# Initial Prompt\n\n# Goals\n\nGoal one\n- step\n\n## Updates\n\n# Important\n\n# Chat\n'
    const s = sections(captain)
    expect(s.objectives).toBe('Goal one\n- step')
    expect(s.updates).toBe('')
    expect(summary(captain)).toBe('Goal one')
    let md = addSession(captain, ID)
    md = addImportant(md, '[USER]', 'kept')
    md = addUpdate(md, '2026-10-26-14-00', 'more')
    expect(md).toBe(
      `# Initial Prompt\n\nSessions: ${ID}\n\n# Goals\n\nGoal one\n- step\n\n## Updates\n\n[UPDATE] 2026-10-26-14-00\nmore\n\n# Important\n\n[USER] kept\n\n# Chat\n`,
    )
    expect(sections(md).objectives).toBe('Goal one\n- step')
    const empty = setObjectives('# Initial Prompt\n\n# Goals\n\n## Updates\n\n# Important\n\n# Chat\n', 'Filled')
    expect(empty.startsWith('# Initial Prompt\n\n# Goals\n\nFilled\n\n## Updates')).toBe(true)
  })

  test('addTurn records each queued pair, then the message typed with them', () => {
    const md = addTurn(create('Plan', ID), [{ agent: 'Merge?', user: 'Yes' }, { agent: 'Push?', user: 'No' }], 'carry on')
    expect(sections(md).chat).toBe('[AI_AGENT] Merge?\n[USER] Yes\n\n[AI_AGENT] Push?\n[USER] No\n\n[USER] carry on')
  })

  test('a file missing sections gets them back on the next write', () => {
    const s = sections(addChat('# Initial Prompt\n\nPlan\n', 'a', 'b'))
    expect(s.objectives).toBe('Plan')
    expect(s.chat).toBe('[AI_AGENT] a\n[USER] b')
  })
})

describe('inject', () => {
  test('hands over the whole file, chat included, with no cap', () => {
    let md = create('Plan', ID)
    for (let i = 0; i < 400; i++) md = addChat(md, `question ${i}`, `answer ${i}`)
    const out = inject(md, '/home/.notes-keeping/p-2026-10-26-10-50.md')
    expect(out.startsWith('Session notes kept by notes-keeping: /home/.notes-keeping/p-2026-10-26-10-50.md\n')).toBe(true)
    expect(out).toContain(md.trimEnd())
    expect(out).toContain('[USER] answer 0\n')
  })
})
