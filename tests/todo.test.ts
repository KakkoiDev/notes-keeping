import { describe, expect, test } from 'claude-code/testing'

import { addUpdate, create, sections, setTodo } from '../hooks/notes'
import {
  EMPTY,
  bridgeMoves,
  candidates,
  context,
  cycle,
  cleanLabel,
  clip,
  changeLine,
  cycleItem,
  diffSnapshot,
  format,
  idFor,
  isBackground,
  openObjectives,
  snapshotOf,
  sourceOf,
  stamped,
  items,
  keyOf,
  keysOf,
  labelPrompt,
  mentions,
  moved,
  parse,
  reconcile,
  settle,
  shown,
  pausedContext,
  row,
  withoutIds,
} from '../hooks/todo'

// The captain's heading layout; the text is a stand-in with his list shapes.
const CAPTAIN = [
  '# Objectives',
  '',
  'I want a todo list kept by the plugin',
  'An objective can be of status:',
  '- to-do',
  '1. ongoing',
  '',
  '## Updates',
  '',
  '[Update] 2026-10-17-02',
  'I want to see it live in the sidepanel.',
  'And keep it in the md file.',
  '',
  '[Update] 2026-10-17-03',
  '- Use the captain status names',
  '',
  '# Important',
  '',
  '# Chat',
  '',
].join('\n')

// The captain's real file shape (numbered objectives with wrapped lines, links and bullets under them; updates with a label
// line, nested bullets and a quoted line), with other words.
const REAL_NOTES = [
  '# Initial Prompt',
  '',
  '# Objectives',
  '',
  'All workers died during the weekend.',
  '',
  '1. Make sure the following prs are reviewed with /review (with diagrams):',
  '- https://example.com/pull/1',
  '- https://example.com/pull/2',
  'And update the status of the associated tasks. I need to show progress to the manager.',
  '',
  '2. Fix the bleeding between chats and remake the example video. And make me a manual testing guide.',
  'ex: thinking 15!= seen in chat B, this is wrong on 2 points: never asked for that calculation and should not be',
  'seen in chat A and chat B.',
  'Video is in the PR description if you have trouble finding it.',
  '',
  '3. Share the experiment page + link to the POC repo',
  'https://example.com/poc',
  'I want the update:',
  '- https://example.com/page-1',
  '5879a429 to add there all our data. This is a data dump that agents are supposed to look at.',
  '-',
  'https://example.com/page-2',
  'This is the digest I want to share, it is a companion document. It is here to make it easy',
  ' to share what we did and why we chose the solution.',
  '- https://example.com/page-3 I',
  'think the data here should be found in the digest.',
  'Make sure that all documents refer to the other 2. We need to make it possible to find all the',
  'research done on the topic.',
  '',
  '4. Make sure that all experiments have system diagrams.',
  'The digest should contain the chosen diagram on top to clarify what was there before and what we are',
  'doing now.',
  '',
  '5. Finish the bench tool. Make it ready to share.',
  '',
  '## Updates',
  '',
  '[UPDATE] 26-10-2026-10-58',
  '- Make a plugin: Notes-Keeping',
  'Plugin to keep track of work done in sessions, even long ones, even after compaction.',
  'Workflow:',
  '- /notes-keeping init',
  '  - create timestamped md document',
  '  - include initial prompt: the initial prompt is the plan for the session. What we figured we want to accomplish.',
  '  Should be under the section `# Initial Prompt`',
  '',
  '[Update] 2026-10-26-12-07',
  'Project: cleanroom-poc',
  'As a thought experiment, I would like to copy a product in a cleanroom style',
  '- Run project locally',
  '',
  '[Update] 2026-10-17-02',
  'I want to have a todo list generated and maintained by the plugin',
  'An objective can be of status:',
  '- todo',
  '- in progress',
  '',
  '[UPDATE] 2026-10-27-08-55',
  '"URGENT: fix memory issues, need to free space"',
  '',
  '# Todo',
  '',
  '# Important',
  '',
  '# Chat',
  '',
].join('\n')

describe('todo lines', () => {
  test('markers read and write back as - [ ] todo, - [~] in-progress, - [x] done, - [-] declined; other lines stay', () => {
    const body = '- [ ] one\n* [~] two\n- [X] three\n- [-] four\nnotes by hand\n- [?] odd'
    expect(items(body).map(item => item.status)).toEqual(['todo', 'in-progress', 'done', 'declined'])
    expect(format(parse(body))).toBe('- [ ] one\n- [~] two\n- [x] three\n- [-] four\nnotes by hand\n- [?] odd')
  })

  test('a click moves todo to in-progress to done to declined and back around', () => {
    expect([cycle('todo'), cycle('in-progress'), cycle('done'), cycle('declined')]).toEqual(['in-progress', 'done', 'declined', 'todo'])
    expect(withoutIds(cycleItem('- [ ] one\n- [ ] two', keyOf('Two')))).toBe('- [ ] one\n- [~] two')
  })

  test('- [!] reads and writes back as blocked; a click on a blocked item sets it back to todo', () => {
    expect(items('- [!] spawn it').map(item => item.status)).toEqual(['blocked'])
    expect(format(parse('- [!] spawn it'))).toBe('- [!] spawn it')
    expect(cycle('blocked')).toBe('todo')
  })

  test('- [/] reads and writes back as paused with its reason; the reason sits before the id', () => {
    const body = '- [/] **Ship**: Ship the bridge <!-- paused:waiting on the review slot --> <!-- id:ab12cd3 -->'
    expect(items(body)).toEqual([{ status: 'paused', label: 'Ship', text: 'Ship the bridge', reason: 'waiting on the review slot', id: 'ab12cd3' }])
    expect(format(parse(body))).toBe(body)
    expect(items('- [/] no reason yet')).toEqual([{ status: 'paused', text: 'no reason yet' }])
    expect(row(items(body)[0] ?? { status: 'todo', text: '' })).toBe('[/] Ship (paused: waiting on the review slot)')
  })

  test('pausing sets the reason; any later status drops it; a click on a paused item sets it back to todo', () => {
    const paused = withoutIds(cycleItem('- [ ] one\n- [~] two', keyOf('two'), () => 'paused', 'the CI queue is full'))
    expect(paused).toBe('- [ ] one\n- [/] two <!-- paused:the CI queue is full -->')
    expect(cycle('paused')).toBe('todo')
    expect(withoutIds(cycleItem(paused, keyOf('two')))).toBe('- [ ] one\n- [ ] two')
  })

  test('a reason cannot close its comment: -- is written as a single dash and the text is one line', () => {
    expect(withoutIds(cycleItem('- [ ] one', keyOf('one'), () => 'paused', 'wait -->\nfor  CI'))).toBe('- [/] one <!-- paused:wait -> for CI -->')
  })
})

describe('labels', () => {
  test('a label is written before the whole text and reads back apart from it; the text and the key stay the same', () => {
    const body = '- [~] **Todo list in the panel**: I want a todo list kept by the plugin: shown live\n- [ ] Plain item'
    const [first, second] = items(body)
    expect(first).toEqual({ status: 'in-progress', label: 'Todo list in the panel', text: 'I want a todo list kept by the plugin: shown live' })
    expect(second).toEqual({ status: 'todo', text: 'Plain item' })
    expect(format(parse(body))).toBe(body)
    expect(keyOf(first?.text ?? '')).toBe('i want a todo list kept by the plugin: shown live')
    expect(cycleItem(body, keyOf(first?.text ?? ''))).toContain('- [x] **Todo list in the panel**: I want a todo list kept by the plugin: shown live')
  })

  test('the model reply becomes a label only when it is one short line', () => {
    expect(cleanLabel('Todo list in panel')).toBe('Todo list in panel')
    expect(cleanLabel('  "Short labels for todos."\n')).toBe('Short labels for todos')
    expect(cleanLabel('**Bold label**')).toBe('Bold label')
    expect(cleanLabel('ToDoの短い名前。')).toBe('ToDoの短い名前')
    expect(cleanLabel('one two three four five six seven')).toBeUndefined()
    expect(cleanLabel('')).toBeUndefined()
    expect(cleanLabel('a*b')).toBeUndefined()
    expect(cleanLabel('x'.repeat(49))).toBeUndefined()
    expect(labelPrompt('Fix the flicker')).toContain('Item: Fix the flicker')
  })

  test('reconcile sets a label on an item without one, keeps one already there, and remembers each item asked', () => {
    const out = reconcile('- [ ] A\n- [ ] **Mine**: B', EMPTY, { add: [], set: {}, seen: [], labels: { a: 'Label A', b: 'Other' }, labeled: ['a', 'b'] })
    expect(withoutIds(out.body)).toBe('- [ ] **Label A**: A\n- [ ] **Mine**: B')
    expect(out.memory.labeled).toEqual(['a', 'b'])
    expect(settle(out.memory, [{ status: 'todo', text: 'A' }]).labeled).toEqual(['a'])
  })
})

describe('todo section in the notes file', () => {
  test('sits between ## Updates and # Important, appears only on the first write, and the captain\'s file reads without it', () => {
    expect(sections(CAPTAIN).todo).toBe('')
    const md = setTodo(CAPTAIN, '- [ ] one')
    expect(md).toContain('\n\n# Todo\n\n- [ ] one\n\n# Important\n')
    expect(sections(md).todo).toBe('- [ ] one')
    expect(sections(md).updates).toContain('- Use the captain status names')
    expect(sections(md).updates).not.toContain('# Todo')
    expect(sections(setTodo(md, '- [x] one')).todo).toBe('- [x] one')
    expect(sections(addUpdate(md, 'now', 'later')).todo).toBe('- [ ] one')
    expect(sections(addUpdate(md, 'now', 'later')).updates).toContain('later')
  })

  test('a hand-edited todo section round-trips through a write elsewhere in the file', () => {
    const md = setTodo(create('Plan', 'id'), '- [~] by hand\nkept note')
    expect(sections(addUpdate(md, 't', 'x')).todo).toBe('- [~] by hand\nkept note')
  })

  test('an emptied list leaves the bare heading', () => {
    expect(setTodo(setTodo(CAPTAIN, '- [ ] one'), '')).toContain('# Todo\n\n# Important')
  })
})

describe('candidates', () => {
  test('objective lines lose bullets, list introductions and one-word status names; each update is one candidate: its first line', () => {
    expect(candidates(sections(CAPTAIN))).toEqual([
      { text: 'I want a todo list kept by the plugin', isSure: false },
      { text: 'I want to see it live in the sidepanel.', isSure: true },
      { text: 'Use the captain status names', isSure: true },
    ])
  })

  test('the captain\'s real objectives shape: wrapped lines join, one item per numbered objective and per update, no fragments', () => {
    const real = candidates(sections(REAL_NOTES))
    expect(real).toEqual([
      { text: 'All workers died during the weekend.', isSure: false },
      { text: 'Make sure the following prs are reviewed with /review (with diagrams)', isSure: true },
      { text: 'Fix the bleeding between chats and remake the example video. And make me a manual testing guide.', isSure: true },
      { text: 'Share the experiment page + link to the POC repo', isSure: true },
      { text: 'Make sure that all experiments have system diagrams.', isSure: true },
      { text: 'Finish the bench tool. Make it ready to share.', isSure: true },
      { text: 'Make a plugin: Notes-Keeping', isSure: true },
      { text: 'As a thought experiment, I would like to copy a product in a cleanroom style', isSure: true },
      { text: 'I want to have a todo list generated and maintained by the plugin', isSure: true },
      { text: 'URGENT: fix memory issues, need to free space', isSure: true },
    ])
    const text = real.map(c => c.text).join('\n')
    for (const fragment of ['seen in chat A', 'doing now', 'to add there all our data', 'think the data here', 'research done']) expect(text).not.toContain(fragment)
  })

  test('a paragraph of bullets is a list of items, and a wrapped bullet is one item', () => {
    expect(candidates({ objectives: '- fix the panel flicker\n- write the docs for\n  the plugin\n- ok', updates: '' }).map(c => c.text)).toEqual([
      'fix the panel flicker',
      'write the docs for the plugin',
    ])
  })

  test('an update that opens with a label line is named by its next line; a numbered objective ending in a colon loses it', () => {
    const [one, two] = candidates({ objectives: '1. Review these:\n- https://example.com/1', updates: '[UPDATE] t\nProject: cleanroom\nCopy it as a test' })
    expect(one).toEqual({ text: 'Review these', isSure: true })
    expect(two).toEqual({ text: 'Copy it as a test', isSure: true })
  })

  test('a long line is kept whole on one line; a list shows it cut short until it has a label', () => {
    const long = `${'word '.repeat(60)}end`
    const [one] = candidates({ objectives: long, updates: '' })
    expect(one?.text).toBe(long)
    expect(shown({ status: 'todo', text: long }).length).toBeLessThanOrEqual(120)
    expect(shown({ status: 'todo', text: long }).endsWith('…')).toBe(true)
    expect(shown({ status: 'todo', text: long, label: 'Many words' })).toBe('Many words')
  })

  test('an item cut short before the text was kept whole matches its whole line', () => {
    const long = `${'word '.repeat(60)}end`
    expect(keysOf(long)).toContain(keyOf(clip(long)))
    expect(keysOf('short')).toEqual(['short'])
  })
})

describe('Laya answers', () => {
  test('a line is dropped as background only at 0.8 or more', () => {
    expect(isBackground(0.2)).toBe(true)
    expect(isBackground(0.21)).toBe(false)
    expect(isBackground(0.9)).toBe(false)
  })

  const verdict = (label: string, p: number) => {
    const labels = ['not-mentioned', 'started', 'finished', 'rejected']
    return { label, p, probs: Object.fromEntries(labels.map(name => [name, name === label ? p : (1 - p) / 3])) }
  }
  const item = { status: 'todo' as const, text: 'Add a ctrl+q toggle for the notes pane' }

  // laya-bench 2026-11-06: 19 of 22 real closes came from a cue word lifting Laya's own score under 0.5 to 1.00.
  test('a cue word in the reply does not lift Laya: a start moves at Laya 0.7 on its own score', () => {
    expect(moved(item, 'Started on the toggle, still running.', verdict('started', 0.69))).toBeUndefined()
    expect(moved(item, 'The toggle was reworked.', verdict('started', 0.7))).toMatchObject({ status: 'in-progress', label: 'started', p: 0.7 })
    expect(moved(item, 'The toggle landed.', verdict('started', 0.5))).toBeUndefined()
  })

  test('Laya never closes or declines an item, however sure', () => {
    expect(moved(item, 'The toggle works, tests pass.', verdict('finished', 0.99))).toBeUndefined()
    expect(moved(item, 'The toggle is dropped.', verdict('rejected', 0.99))).toBeUndefined()
  })

  test('a reply moves an item only when it shares a word with it, Laya says started, and the item is todo', () => {
    expect(moved(item, 'The notes pane toggle is partway there.', verdict('started', 0.7))).toMatchObject({ status: 'in-progress' })
    expect(moved(item, 'Test suite is green, 42 pass.', verdict('started', 0.99))).toBeUndefined()
    expect(moved(item, 'The toggle was moved.', verdict('not-mentioned', 0.99))).toBeUndefined()
    expect(moved({ ...item, status: 'in-progress' }, 'The toggle is half done.', verdict('started', 0.99))).toBeUndefined()
    expect(moved({ ...item, status: 'done' }, 'The toggle is half done.', verdict('started', 0.99))).toBeUndefined()
  })

  // 2026-10-29 06:32Z: the captain set Review PR #27921 back to in-progress and Laya closed it again on a finish cue.
  test('Laya never moves a status the captain set', () => {
    expect(moved(item, 'Started on the toggle.', verdict('started', 0.99), [], true)).toBeUndefined()
    expect(moved(item, 'Started on the toggle.', verdict('started', 0.99), [], false)).toMatchObject({ status: 'in-progress' })
  })

  // Audit 2026-10-29, section 3.5 A: Laya leaning "started" on the Sentry item, rejected at 0.05, declined it on one refusal cue.
  test('a refusal word in the reply does not decline an item', () => {
    const sentry = { status: 'todo' as const, text: 'Investigate the Sentry production alert' }
    const weak = { label: 'started', p: 0.6, probs: { 'not-mentioned': 0.25, started: 0.6, finished: 0.1, rejected: 0.05 } }
    for (const reply of ['The Sentry alert was skipped this turn.', "I won't touch the Sentry alert now.", 'The Sentry alert was dropped.']) {
      expect(moved(sentry, reply, weak)).toBeUndefined()
      expect(moved(sentry, reply, verdict('rejected', 0.99))).toBeUndefined()
    }
  })

  // 2026-10-29: Laya moves to done on a finish word the reply did not say of the item. Replies cut from firstmate's
  // real ones; probabilities are Laya's (aac6fef/laya-mlx) on the whole real reply and item.
  const publicRepo = { status: 'todo' as const, text: "I want to move notes-keeping's plugin to a public repo on KakkoiDev" }
  const review = { status: 'todo' as const, text: 'review this pr https://github.com/acme/webapp/pull/27921' }
  const reviewSiblings = [review.text, 'review this pr: https://github.com/acme/webapp/pull/27787']

  test('a word inside a link in the reply names only the item holding that link', () => {
    const reply = 'Done this turn: pr-review-enhanced is installed. PR https://github.com/KakkoiDev/example/pull/45 is merged.'
    expect(moved(publicRepo, reply, verdict('started', 0.9))).toBeUndefined()
    const linked = 'The review of https://github.com/acme/webapp/pull/27921 is drafted, not posted.'
    expect(moved(review, linked, verdict('started', 0.9), reviewSiblings)).toMatchObject({ status: 'in-progress' })
  })

  test('the real finish cues no longer close an item: merged, landed, written, done', () => {
    const economizer = { status: 'in-progress' as const, text: "I want to add this to firstmate's normal behavior https://github.com/microsoft/TokenEconomizer" }
    for (const said of ['TokenEconomizer is merged into firstmate.', 'The TokenEconomizer worker finished and its PR is merged.', 'TokenEconomizer is done.']) {
      expect(moved(economizer, said, verdict('finished', 0.99))).toBeUndefined()
      expect(moved({ ...economizer, status: 'todo' }, said, verdict('finished', 0.99))).toBeUndefined()
    }
  })

  test('a word the items share does not count as naming one of them', () => {
    const others = ['Add a ctrl+q toggle for the notes pane', 'Rename the notes pane to Todo', 'Write the notes docs']
    expect(mentions(others[0] ?? '', 'The notes pane now says Todo.')).toBe(true)
    expect(mentions(others[0] ?? '', 'The notes pane now says Todo.', others)).toBe(false)
    expect(mentions(others[0] ?? '', 'The toggle works.', others)).toBe(true)
    expect(mentions('Notes pane', 'The notes pane works.', ['Notes pane', 'The notes pane'])).toBe(true)
  })

  test('Japanese items and replies match on shared two-character runs', () => {
    expect(mentions('ドキュメントを書く', 'ドキュメントの執筆を始めました')).toBe(true)
    expect(mentions('ドキュメントを書く', '今日は天気がいいですね')).toBe(false)
  })

  // The hooks worker is killed when a hook does not yield for 5000 ms; the todo run calls moved() once per open item.
  test('moved() over 50 items and a long reply naming many of them stays far under the hooks worker heartbeat', () => {
    const syllables = ['ba', 'ce', 'di', 'fo', 'gu', 'ha', 'ke', 'li', 'mo', 'nu', 'pa', 're', 'si', 'to', 'vu', 'wa', 'ze', 'ji', 'qo', 'xu']
    const word = (n: number) => [Math.floor(n / 400) % 20, Math.floor(n / 20) % 20, n % 20].map(i => syllables[i]).join('')
    const shared = Array.from({ length: 30 }, (_, i) => word(7000 + i))
    const list = Array.from({ length: 50 }, (_, i) => ({
      status: 'todo' as const,
      text: [0, 1, 2, 3].map(j => word(i * 4 + j)).concat(Array.from({ length: 10 }, (_, j) => shared[(i + j * 3) % shared.length] ?? '')).join(' '),
    }))
    const siblings = list.map(one => one.text)
    const cues = ['is done and merged', 'was started, still partway', 'was dropped, out of scope', 'landed and works']
    const answer = Array.from({ length: 70 }, (_, s) => `The ${word((s % 50) * 4)} ${word(((s * 7) % 50) * 4 + 1)} ${shared[s % shared.length]} part ${cues[s % cues.length]}.`).join(' ')
    expect(answer.length).toBeGreaterThan(3500)
    const at = performance.now()
    for (const one of list.slice(0, 20)) moved(one, answer, verdict('finished', 0.9), siblings)
    expect(performance.now() - at).toBeLessThan(1000)
  })
})

describe('memory and reconcile', () => {
  test('an item whose status differs from what the AI wrote, or a non-default one the AI never wrote, is marked hand-set', () => {
    const memory = { seen: [], ai: { one: 'todo' as const, two: 'todo' as const }, pins: [], labeled: [], bridge: {} }
    const list = [
      { status: 'in-progress' as const, text: 'One' },
      { status: 'todo' as const, text: 'Two' },
      { status: 'done' as const, text: 'Three' },
      { status: 'todo' as const, text: 'Four' },
    ]
    expect(settle(memory, list).pins.sort()).toEqual(['one', 'three'])
  })

  test('an item the captain deleted leaves the memory', () => {
    const memory = { seen: ['gone'], ai: { gone: 'todo' as const }, pins: ['gone'], labeled: ['gone'], bridge: { gone: 'done' as const } }
    expect(settle(memory, [])).toEqual({ seen: ['gone'], ai: {}, pins: [], labeled: [], bridge: {}, pauses: {} })
  })

  test('new items are added once, moves land on the status Laya read, and the AI remembers what it wrote', () => {
    const memory = { seen: [], ai: { a: 'todo' as const, b: 'todo' as const, d: 'todo' as const }, pins: [], labeled: [], bridge: {} }
    const out = reconcile('- [ ] A\n- [~] B\n- [ ] D\nnote', memory, {
      add: [{ status: 'todo', text: 'C' }, { status: 'todo', text: 'a' }],
      set: { a: { from: 'todo', to: 'done' }, b: { from: 'todo', to: 'done' }, d: { from: 'in-progress', to: 'done' } },
      seen: ['c'],
    })
    // b was hand-set to in-progress before Laya read it as todo: its status moved on, so the move is dropped.
    expect(withoutIds(out.body)).toBe('- [x] A\n- [~] B\n- [ ] D\nnote\n- [ ] C')
    expect(out.applied).toEqual([{ key: 'a', text: 'A', from: 'todo', to: 'done', isHandSet: false }])
    expect(out.memory.ai).toEqual({ a: 'done', b: 'todo', d: 'todo', c: 'todo' })
    expect(out.memory.seen).toEqual(['c', ...items(out.body).map(item => item.id)])
  })

  test('a move on a hand-set item lands, is reported as hand-set, and the item is the AI\'s again', () => {
    const memory = { seen: [], ai: { a: 'todo' as const }, pins: [], labeled: [], bridge: {} }
    const out = reconcile('- [~] A', memory, { add: [], set: { a: { from: 'in-progress', to: 'done' } }, seen: [] })
    expect(withoutIds(out.body)).toBe('- [x] A')
    expect(out.applied).toEqual([{ key: 'a', text: 'A', from: 'in-progress', to: 'done', isHandSet: true }])
    expect(out.memory.pins).toEqual([])
    expect(out.memory.ai).toEqual({ a: 'done' })
  })

  test('with no AI record an untouched todo item is not marked hand-set', () => {
    expect(settle(EMPTY, [{ status: 'todo', text: 'x' }]).pins).toEqual([])
  })
})

describe('context for Claude', () => {
  test('an item from an update holding more than its text is the whole block, a paused one with its reason', () => {
    const s = { objectives: '', updates: '[UPDATE] t\nPasted filter row\n- [ ] Review the plan\n[~] Link todos ||||| the ask after the paste' }
    const text = context('- [/] Pasted filter row <!-- paused:waiting on the captain -->\n- [ ] Plain item', s) ?? ''
    expect(text).toContain('- [/] Pasted filter row (paused: waiting on the captain)\n    - [ ] Review the plan\n    [~] Link todos ||||| the ask after the paste\n- [ ] Plain item')
  })

  test('lists every open item under the legend', () => {
    const text = context('- [ ] a\n- [~] b\n- [x] c')
    expect(text).toContain('([ ] todo, [~] in-progress, [x] done, [-] declined, [!] blocked, [/] paused)')
    expect(text).toContain('- [ ] a\n- [~] b\n1 done/declined items are not listed')
    expect(context('- [x] a')).toContain('Nothing is open.')
    expect(context('')).toBeUndefined()
  })

  test('tells Claude to work every open item now, in parallel, instead of naming one', () => {
    const text = context('- [ ] a\n- [~] b\n- [x] c') ?? ''
    expect(text).toContain('Start every open item ([ ] and [~]) now, in parallel')
    expect(text).toContain('do not wait on one answer before starting another independent item')
    expect(text).not.toContain('Work on:')
    expect(context('- [x] a')).not.toContain('in parallel')
  })

  test('a blocked item is listed with its marker and Claude is told to report it to the captain first', () => {
    const text = context('- [!] Spawn the review\n- [x] c') ?? ''
    expect(text).toContain('- [!] Spawn the review')
    expect(text).toContain('Blocked ([!]): could not be started. Open your reply by telling the captain which items are blocked and why.')
    expect(text).toContain('Nothing is open.')
    expect(context('- [ ] a')).not.toContain('Blocked ([!])')
  })

  test('every open item is listed past 40 items; done and declined items are counted with a pointer, not listed', () => {
    const closed = Array.from({ length: 45 }, (_, i) => `- [${i % 2 === 0 ? 'x' : '-'}] closed ${i}`)
    const body = ['- [ ] first open', ...closed, '- [~] late started', '- [!] late blocked', '- [ ] late open'].join('\n')
    const text = context(body) ?? ''
    expect(text).toContain('- [ ] first open\n- [~] late started\n- [!] late blocked\n- [ ] late open')
    expect(text).not.toContain('closed ')
    expect(text).toContain("45 done/declined items are not listed; read the notes file's # Todo section if you need them.")
    expect(text).not.toContain('more in the notes file')
  })

  test('each paused item is listed with its reason, and Claude is told to re-evaluate every one: resume it or keep it paused with a fresh reason', () => {
    const body = '- [ ] a\n- [/] **Ship**: Ship the bridge <!-- paused:waiting on the review slot --> <!-- id:ab12cd3 -->\n- [/] Old one\n- [x] c'
    const text = context(body) ?? ''
    expect(text).toContain('- [ ] a\n- [/] Ship: Ship the bridge (paused: waiting on the review slot)\n- [/] Old one (paused: no reason recorded)\n')
    const paused = pausedContext(body) ?? ''
    expect(text).toContain(paused)
    expect(paused).toContain('Paused ([/]): set aside on purpose, each with its reason.')
    expect(paused).toContain('Re-evaluate every paused item now')
    expect(paused).toContain('resume it, or keep it paused with a fresh reason')
    expect(paused).toContain('notes-keeping-bridge pause <task-id> --reason <text>')
    expect(paused).toContain('- [/] Ship: Ship the bridge (paused: waiting on the review slot)')
    expect(pausedContext('- [ ] a\n- [!] b')).toBeUndefined()
    expect(context('- [ ] a\n- [!] b')).not.toContain('Paused ([/])')
  })

  test('with no done or declined item there is no not-listed line', () => {
    expect(context('- [ ] a\n- [~] b')).not.toContain('not listed')
  })

  test('a labeled item is named by its label, with its text cut short after it', () => {
    const text = context(`- [ ] **Short name**: ${'word '.repeat(40)}end`) ?? ''
    expect(text).toContain('- [ ] Short name: word word')
    expect(text).toContain('…')
  })
})

describe('bridge', () => {
  const memory = { ...EMPTY, bridge: { c: 'in-progress' as const } }
  const list = [
    { status: 'todo' as const, text: 'A' },
    { status: 'done' as const, text: 'B' },
    { status: 'todo' as const, text: 'C' },
  ]

  test('a reported status moves its item forward only, and not again once reported', () => {
    // C: the captain set it back to todo after the bridge reported in-progress; the same report does not move it again.
    expect(bridgeMoves(list, { a: 'in-progress', b: 'in-progress', c: 'in-progress' }, memory)).toEqual({ a: { from: 'todo', to: 'in-progress' } })
    expect(bridgeMoves(list, { c: 'done' }, memory)).toEqual({ c: { from: 'todo', to: 'done' } })
  })

  test('a blocked report moves an open item to blocked, and a later report moves it on from blocked', () => {
    const open = [
      { status: 'todo' as const, text: 'A' },
      { status: 'in-progress' as const, text: 'B' },
      { status: 'done' as const, text: 'C' },
      { status: 'declined' as const, text: 'D' },
    ]
    expect(bridgeMoves(open, { a: 'blocked', b: 'blocked', c: 'blocked', d: 'blocked' }, EMPTY)).toEqual({
      a: { from: 'todo', to: 'blocked' },
      b: { from: 'in-progress', to: 'blocked' },
    })
    const blocked = [{ status: 'blocked' as const, text: 'A' }]
    const reported = { ...EMPTY, bridge: { a: 'blocked' as const } }
    expect(bridgeMoves(blocked, { a: 'blocked' }, reported)).toEqual({})
    expect(bridgeMoves(blocked, { a: 'in-progress' }, reported)).toEqual({ a: { from: 'blocked', to: 'in-progress' } })
    expect(bridgeMoves(blocked, { a: 'done' }, reported)).toEqual({ a: { from: 'blocked', to: 'done' } })
  })

  test('a paused report moves an open or blocked item to paused, a blocked report lands on a paused item, and a later report moves it on', () => {
    const open = [
      { status: 'todo' as const, text: 'A' },
      { status: 'in-progress' as const, text: 'B' },
      { status: 'blocked' as const, text: 'C' },
      { status: 'done' as const, text: 'D' },
    ]
    expect(bridgeMoves(open, { a: 'paused', b: 'paused', c: 'paused', d: 'paused' }, EMPTY)).toEqual({
      a: { from: 'todo', to: 'paused' },
      b: { from: 'in-progress', to: 'paused' },
      c: { from: 'blocked', to: 'paused' },
    })
    const paused = [{ status: 'paused' as const, text: 'A' }]
    const reported = { ...EMPTY, bridge: { a: 'paused' as const } }
    expect(bridgeMoves(paused, { a: 'paused' }, reported)).toEqual({})
    expect(bridgeMoves(paused, { a: 'blocked' }, reported)).toEqual({ a: { from: 'paused', to: 'blocked' } })
    expect(bridgeMoves(paused, { a: 'in-progress' }, reported)).toEqual({ a: { from: 'paused', to: 'in-progress' } })
  })

  test('reconcile writes the reason the bridge reports on a paused item, and a fresh reason replaces the old one once', () => {
    const moved = reconcile('- [ ] A', EMPTY, { add: [], set: { a: { from: 'todo', to: 'paused' } }, seen: [], bridge: { a: 'paused' }, reasons: { a: 'no slot' } })
    expect(withoutIds(moved.body)).toBe('- [/] A <!-- paused:no slot -->')
    const again = reconcile(moved.body, moved.memory, { add: [], set: {}, seen: [], bridge: { a: 'paused' }, reasons: { a: 'no slot' } })
    expect(again.body).toBe(moved.body)
    const fresh = reconcile(moved.body, moved.memory, { add: [], set: {}, seen: [], bridge: { a: 'paused' }, reasons: { a: 'the review is first' } })
    expect(withoutIds(fresh.body)).toBe('- [/] A <!-- paused:the review is first -->')
    // The captain wrote their own reason; the bridge's unchanged one does not overwrite it.
    const mine = fresh.body.replace('the review is first', 'my call')
    expect(reconcile(mine, fresh.memory, { add: [], set: {}, seen: [], bridge: { a: 'paused' }, reasons: { a: 'the review is first' } }).body).toBe(mine)
    const resumed = reconcile(fresh.body, fresh.memory, { add: [], set: { a: { from: 'paused', to: 'in-progress' } }, seen: [], bridge: { a: 'in-progress' } })
    expect(withoutIds(resumed.body)).toBe('- [~] A')
  })

  test('reconcile remembers what the bridge reported', () => {
    const out = reconcile('- [ ] A', EMPTY, { add: [], set: { a: { from: 'todo', to: 'in-progress' } }, seen: [], bridge: { a: 'in-progress' } })
    expect(withoutIds(out.body)).toBe('- [~] A')
    expect(out.memory.bridge).toEqual({ a: 'in-progress' })
    expect(out.memory.ai).toEqual({ a: 'in-progress' })
  })

  test('the snapshot diff names new items and status changes found in the file, not the moves the write made', () => {
    const before = [
      { status: 'in-progress' as const, text: 'A' },
      { status: 'todo' as const, text: 'B' },
      { status: 'todo' as const, text: 'Hand added' },
    ]
    const after = [
      { status: 'in-progress' as const, text: 'A' },
      { status: 'done' as const, text: 'B' },
      { status: 'todo' as const, text: 'Hand added' },
      { status: 'todo' as const, text: 'From an update' },
    ]
    const changes = diffSnapshot({ a: 'todo', b: 'todo' }, before, after)
    expect(changes).toEqual([
      { item: before[0], from: 'todo', to: 'in-progress', isFound: true },
      { item: before[2], to: 'todo', isFound: true },
      { item: after[3], to: 'todo', isFound: false },
    ])
    expect(diffSnapshot(undefined, before, after)).toEqual([])
  })

  test('a change line names the actor that made it, never the captain for a change found in the file', () => {
    const item = { status: 'in-progress' as const, text: 'A', id: 'ab12cd3' }
    expect(changeLine({ item, from: 'todo', to: 'in-progress' }, 'unknown')).toBe('A: todo -> in-progress (unknown) [id:ab12cd3]')
    expect(changeLine({ item, from: 'todo', to: 'in-progress' }, 'laya')).toBe('A: todo -> in-progress (laya) [id:ab12cd3]')
    expect(changeLine({ item: { status: 'todo', text: 'B' }, to: 'todo' }, 'plugin')).toBe('+ [ ] B')
  })
})

describe('ids', () => {
  test('an id on an item line reads apart from the label and text and writes back; a list never shows it', () => {
    const body = '- [~] **Short**: Ship the bridge <!-- id:ab12cd3 -->\n- [ ] Plain'
    expect(items(body)).toEqual([
      { status: 'in-progress', label: 'Short', text: 'Ship the bridge', id: 'ab12cd3' },
      { status: 'todo', text: 'Plain' },
    ])
    expect(format(parse(body))).toBe(body)
    expect(context(body)).not.toContain('id:')
  })

  test('a changed body gives every item an id, each once; an unchanged body is left as it is', () => {
    const changed = reconcile('- [ ] A\n- [ ] B <!-- id:ab12cd3 -->', EMPTY, { add: [{ status: 'todo', text: 'C' }], set: {}, seen: [] })
    expect(changed.body).toBe(`- [ ] A <!-- id:${idFor('A', new Set())} -->\n- [ ] B <!-- id:ab12cd3 -->\n- [ ] C <!-- id:${idFor('C', new Set())} -->`)
    expect(reconcile('- [ ] A', EMPTY, { add: [], set: {}, seen: [] }).body).toBe('- [ ] A')
    const taken = new Set([idFor('A', new Set())])
    expect(idFor('A', taken)).not.toBe(idFor('A', new Set()))
  })

  test('an item keeps its id, hand-set mark, AI status and bridge report when the captain edits its text', () => {
    const memory = { seen: [], ai: { ab12cd3: 'in-progress' as const }, pins: ['ab12cd3'], labeled: ['ab12cd3'], bridge: { ab12cd3: 'in-progress' as const } }
    const edited = [{ status: 'todo' as const, text: 'Review the PR again', id: 'ab12cd3' }]
    expect(settle(memory, edited)).toEqual({ seen: [], ai: { ab12cd3: 'in-progress' }, pins: ['ab12cd3'], labeled: ['ab12cd3'], bridge: { ab12cd3: 'in-progress' }, pauses: {} })
    // The captain set it back to todo; the same report does not move it again.
    expect(bridgeMoves(edited, { ab12cd3: 'in-progress' }, memory)).toEqual({})
    expect(bridgeMoves(edited, { ab12cd3: 'done' }, memory)).toEqual({ ab12cd3: { from: 'todo', to: 'done' } })
    expect(diffSnapshot(snapshotOf([{ status: 'todo', text: 'Review this PR', id: 'ab12cd3' }]), edited, edited)).toEqual([])
  })

  test('memory kept under text keys before ids moves to the ids; the snapshot does not report the items as new', () => {
    const memory = { seen: [], ai: { a: 'done' as const }, pins: ['a'], labeled: ['a'], bridge: { a: 'done' as const } }
    const list = [{ status: 'done' as const, text: 'A', id: 'ab12cd3' }]
    expect(settle(memory, list)).toEqual({ seen: [], ai: { ab12cd3: 'done' }, pins: ['ab12cd3'], labeled: ['ab12cd3'], bridge: { ab12cd3: 'done' }, pauses: {} })
    expect(diffSnapshot({ a: 'done' }, [{ status: 'done', text: 'A' }], list)).toEqual([])
    expect(diffSnapshot({ a: 'todo' }, list, list)).toEqual([{ item: list[0], from: 'todo', to: 'done', isFound: true }])
  })

  test('an item gets its id onto the objective or update line it came from, once, and the candidate reads it back', () => {
    const s = { objectives: '- fix the flicker\n- write the docs\n\n1. Ship the bridge\n   See the notes', updates: '[UPDATE] t\nProject: x\nAdd a pane' }
    const list = [
      { status: 'todo' as const, text: 'Ship the bridge', id: 'aaaaaaa' },
      { status: 'todo' as const, text: 'write the docs', id: 'bbbbbbb' },
      { status: 'todo' as const, text: 'Add a pane', id: 'ccccccc' },
      { status: 'todo' as const, text: 'Unrelated' },
    ]
    const out = stamped(s, list)
    expect(out).toEqual({
      objectives: '- fix the flicker\n- write the docs <!-- id:bbbbbbb -->\n\n1. Ship the bridge <!-- id:aaaaaaa -->\n   See the notes',
      updates: '[UPDATE] t\nProject: x\nAdd a pane <!-- id:ccccccc -->',
    })
    expect(stamped(out, list)).toEqual(out)
    expect(candidates(out)).toEqual([
      { text: 'fix the flicker', isSure: false },
      { text: 'write the docs', isSure: false, id: 'bbbbbbb' },
      { text: 'Ship the bridge', isSure: true, id: 'aaaaaaa' },
      { text: 'Add a pane', isSure: true, id: 'ccccccc' },
    ])
  })

  test('an objective whose item is done or declined is left behind by id, after either text was edited', () => {
    const objectives = '1. Ship the exporter, edited <!-- id:aaaaaaa -->\n\n2. Fix the login bug <!-- id:bbbbbbb -->\n\n3. Wire the audit log <!-- id:ccccccc -->'
    const list = [
      { status: 'done' as const, text: 'Ship the exporter', id: 'aaaaaaa' },
      { status: 'declined' as const, text: 'Fix the login bug, reworded', id: 'bbbbbbb' },
      { status: 'todo' as const, text: 'Wire the audit log', id: 'ccccccc' },
    ]
    expect(openObjectives(objectives, list)).toBe('3. Wire the audit log <!-- id:ccccccc -->')
  })

  test('an objective without an id still finds its item by text', () => {
    expect(openObjectives('1. Ship it\n\n2. Keep it', [{ status: 'done', text: 'Ship it', id: 'aaaaaaa' }, { status: 'todo', text: 'Keep it' }])).toBe('2. Keep it')
  })

  test('an item finds the objective or update it came from, whole: by id, else by text; a hand-written item finds none', () => {
    const s = {
      objectives: 'Context paragraph\n\n- fix the flicker\n  on resize too\n- write the docs <!-- id:bbbbbbb -->\n\n1. Ship the bridge <!-- id:aaaaaaa -->\n   See the notes\n   - https://example.com/spec\n\n2. Second goal',
      updates: '[UPDATE] t1\nProject: x\nAdd a pane, edited <!-- id:ccccccc -->\nwith two keys.\n\n[UPDATE] t2\nLast one',
    }
    expect(sourceOf(s, { status: 'todo', text: 'Ship the bridge, edited', id: 'aaaaaaa' })).toEqual({
      section: 'objectives',
      text: '1. Ship the bridge\n   See the notes\n   - https://example.com/spec',
    })
    expect(sourceOf(s, { status: 'todo', text: 'write the docs', id: 'bbbbbbb' })).toEqual({ section: 'objectives', text: '- write the docs' })
    expect(sourceOf(s, { status: 'todo', text: 'fix the flicker on resize too' })).toEqual({ section: 'objectives', text: '- fix the flicker\n  on resize too' })
    expect(sourceOf(s, { status: 'done', text: 'Add a pane', id: 'ccccccc' })).toEqual({
      section: 'updates',
      text: '[UPDATE] t1\nProject: x\nAdd a pane, edited\nwith two keys.',
    })
    expect(sourceOf(s, { status: 'todo', text: 'Last one', id: 'ddddddd' })).toEqual({ section: 'updates', text: '[UPDATE] t2\nLast one' })
    expect(sourceOf(s, { status: 'todo', text: 'Written by hand', id: 'eeeeeee' })).toBeUndefined()
  })

  test('an item written from a label line or a wrapped detail line finds the block that holds that line whole; a line that only contains its words does not match', () => {
    const s = {
      objectives: '3. Share the OCR page <!-- id:0o9cgvi -->\nThis is the digest. It is here to make it easy\n to share what we did and why we chose the solution we chose.\n- https://example.com/a',
      updates: '[Update] t1\nProject: webapp-cleanroom-poc\nAs a thought experiment, copy it <!-- id:0v86npk -->\n- run it locally',
    }
    expect(sourceOf(s, { status: 'todo', text: 'to share what we did and why we chose the solution we chose.', id: '0v7mo3v' })).toEqual({
      section: 'objectives',
      text: '3. Share the OCR page\nThis is the digest. It is here to make it easy\n to share what we did and why we chose the solution we chose.\n- https://example.com/a',
    })
    expect(sourceOf(s, { status: 'todo', text: 'Project: webapp-cleanroom-poc', id: '0sz9ax4' })).toEqual({
      section: 'updates',
      text: '[Update] t1\nProject: webapp-cleanroom-poc\nAs a thought experiment, copy it\n- run it locally',
    })
    expect(sourceOf(s, { status: 'todo', text: 'run it', id: 'fffffff' })).toBeUndefined()
  })
})
