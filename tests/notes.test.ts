import { describe, expect, test } from 'claude-code/testing'

import {
  addChat,
  addTurn,
  addImportant,
  addSession,
  addUpdate,
  carryOver,
  chatNotes,
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
  stampIds,
  summary,
} from '../hooks/notes'
import { candidates, items } from '../hooks/todo'

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

  test('carryOver leaves behind an objective whose item is done by id, after either text was edited, and keeps the ids', () => {
    const previous = '# Objectives\n\n1. Ship the exporter, reworded <!-- id:aaaaaaa -->\n\n2. Fix the login bug <!-- id:bbbbbbb -->\n\n# Todo\n\n- [x] Ship it <!-- id:aaaaaaa -->\n- [~] Fix login <!-- id:bbbbbbb -->\n\n# Important\n\n# Chat\n'
    const md = carryOver(create('New plan', ID), previous, 'old.md')
    expect(sections(md).objectives).toBe('2. Fix the login bug <!-- id:bbbbbbb -->\n\nNew plan')
    expect(sections(md).todo).toBe('- [~] Fix login <!-- id:bbbbbbb -->')
  })

  test('carryOver again after this file stamped ids on what it carried copies nothing twice', () => {
    const previous = '# Objectives\n\nOld plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [~] old change\n\n# Important\n\n# Chat\n'
    const once = carryOver(create('New plan', ID), previous, 'old.md')
    const list = [{ status: 'in-progress' as const, text: 'old change', id: 'aaaaaaa' }, { status: 'todo' as const, text: 'Old plan', id: 'bbbbbbb' }]
    const stamped = stampIds(setTodo(once, '- [~] old change <!-- id:aaaaaaa -->\n- [ ] Old plan <!-- id:bbbbbbb -->'), list)
    expect(sections(stamped).updates).toBe('[UPDATE] 2026-10-24-10-00\nold change <!-- id:aaaaaaa -->')
    const twice = sections(carryOver(stamped, previous, 'old.md'))
    expect(twice.updates).toBe('[UPDATE] 2026-10-24-10-00\nold change <!-- id:aaaaaaa -->')
    expect(twice.objectives).toBe('Old plan <!-- id:bbbbbbb -->\n\nNew plan')
    expect(twice.todo).toBe('- [~] old change <!-- id:aaaaaaa -->\n- [ ] Old plan <!-- id:bbbbbbb -->')
  })

  test('carryOver gives a carried update and objective the id this file already holds for the same item text, so each todo still finds its line by id', () => {
    const previous = '# Objectives\n\nShip the exporter <!-- id:ccccccc -->\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nfix the login bug <!-- id:aaaaaaa -->\n\n# Todo\n\n- [~] Ship the exporter <!-- id:ccccccc -->\n- [~] fix the login bug <!-- id:aaaaaaa -->\n\n# Important\n\n# Chat\n'
    const here = setTodo(create('', ID), '- [ ] fix the login bug <!-- id:bbbbbbb -->\n- [ ] Ship the exporter <!-- id:ddddddd -->')
    const md = carryOver(here, previous, 'old.md')
    const s = sections(md)
    expect(s.updates).toBe('[UPDATE] 2026-10-24-10-00\nfix the login bug <!-- id:bbbbbbb -->')
    expect(s.objectives).toBe('Ship the exporter <!-- id:ddddddd -->')
    expect(s.todo).toBe('- [ ] fix the login bug <!-- id:bbbbbbb -->\n- [ ] Ship the exporter <!-- id:ddddddd -->')
    const ids = candidates(s).map(c => c.id)
    for (const item of items(s.todo)) expect(ids).toContain(item.id)
  })

  test('summary and the panel text leave the ids out', () => {
    expect(summary('# Objectives\n\nShip it <!-- id:aaaaaaa -->\n')).toBe('Ship it')
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

  test('addTurn records a pasted text that notes are on whole, once, ahead of the first note on it', () => {
    const whole = 'Can we ship Friday?\nQA is still open.\nDocs are done.'
    const pairs = [
      { agent: 'QA is still open.', user: 'who owns QA?', pasted: { whole } },
      { agent: 'Merge?', user: 'Yes' },
      { agent: 'Can we ship Friday?', user: 'not yet', pasted: { whole } },
    ]
    expect(sections(addTurn(create('Plan', ID), pairs, 'carry on')).chat).toBe(
      [
        `[PASTED TEXT]\n${whole}\n[END PASTED TEXT]`,
        '[PASTED]\nQA is still open.\n[USER] who owns QA?',
        '[AI_AGENT] Merge?\n[USER] Yes',
        '[PASTED]\nCan we ship Friday?\n[USER] not yet',
        '[USER] carry on',
      ].join('\n\n'),
    )
  })

  test('a reply anchored to a transcript row carries its note id, row and occurrence after the quoted text, and reads back', () => {
    const note = { id: 'k3x9', row: '2cc6721d-79e7-4487-9aaa-a9ef47567336', at: 1 }
    let md = addChat(create('Plan', ID), 'Merge?', 'Yes')
    md = addChat(md, 'Look:\n\nthe second line', 'Why?', note)
    md = addTurn(md, [{ agent: 'Push?', user: 'No', note: { ...note, id: 'p7q2', at: 0 } }], 'carry on')
    expect(sections(md).chat).toBe(
      [
        '[AI_AGENT] Merge?',
        '[USER] Yes',
        '',
        `[AI_AGENT] Look:\n\nthe second line <!-- note:k3x9 row:${note.row} at:1 -->`,
        '[USER] Why?',
        '',
        `[AI_AGENT] Push? <!-- note:p7q2 row:${note.row} at:0 -->`,
        '[USER] No',
        '',
        '[USER] carry on',
      ].join('\n'),
    )
    expect(chatNotes(sections(md).chat)).toEqual([
      { id: 'k3x9', row: note.row, at: 1, agent: 'Look:\n\nthe second line', user: 'Why?' },
      { id: 'p7q2', row: note.row, at: 0, agent: 'Push?', user: 'No' },
    ])
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
