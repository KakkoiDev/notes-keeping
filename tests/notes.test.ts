import { describe, expect, test } from 'claude-code/testing'

import {
  addChat,
  addImportant,
  addSession,
  addUpdate,
  create,
  fileName,
  inject,
  nameParts,
  newestFirst,
  projectName,
  sections,
  setContinuation,
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
      `# Initial Prompt\n\nSessions: ${ID}\n\nPlan the day\n\n## Updates\n\n# Important\n\n# Chat\n`,
    )
    expect(sections(create('Plan', ID)).sessions).toEqual([ID])
    expect(sections(create('Plan', ID)).prompt).toBe('Plan')
  })

  test('addSession records a new session id once, keeping the continuation and the prompt', () => {
    let md = setContinuation(create('Plan', 'first'), 'old.md')
    md = addSession(md, 'second')
    md = addSession(md, 'second')
    expect(md.startsWith('# Initial Prompt\n\nContinuation of: old.md\n\nSessions: first, second\n\nPlan\n\n## Updates')).toBe(true)
    expect(sections(md).sessions).toEqual(['first', 'second'])
    expect(sections(md).continuation).toBe('old.md')
    expect(sections(md).prompt).toBe('Plan')
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
        '# Initial Prompt',
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

  test('continuation goes first under # Initial Prompt and is replaced, not stacked', () => {
    let md = setContinuation(create('Plan', ID), '25-10-2026-00-00.md')
    expect(md.startsWith(`# Initial Prompt\n\nContinuation of: 25-10-2026-00-00.md\n\nSessions: ${ID}\n\nPlan\n`)).toBe(true)
    md = setContinuation(md, '24-10-2026-09-00.md')
    expect(md.match(/Continuation of:/g)?.length).toBe(1)
    expect(sections(md).continuation).toBe('24-10-2026-09-00.md')
    expect(sections(md).prompt).toBe('Plan')
  })

  test('reads and writes the captain\'s example layout', () => {
    const example = '# Initial Prompt\n\nAll workers died.\n\n## Updates\n\n[UPDATE] 26-10-2026-10-58\n- Make a plugin\n\n\n# Important\n\n[AI_AGENT] keep this\n\n# Chat\n\n[AI_AGENT]Captain, go?\n[USER]Go.\n'
    const s = sections(example)
    expect(s.prompt).toBe('All workers died.')
    expect(s.updates).toBe('[UPDATE] 26-10-2026-10-58\n- Make a plugin')
    expect(s.important).toBe('[AI_AGENT] keep this')
    expect(s.chat).toBe('[AI_AGENT]Captain, go?\n[USER]Go.')
    expect(summary(example)).toBe('All workers died.')
    expect(sections(addImportant(example, '[USER]', 'two')).important).toBe('[AI_AGENT] keep this\n\n[USER] two')
  })

  test('a file missing sections gets them back on the next write', () => {
    const s = sections(addChat('# Initial Prompt\n\nPlan\n', 'a', 'b'))
    expect(s.prompt).toBe('Plan')
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
