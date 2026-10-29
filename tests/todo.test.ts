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

  test('a reply moves an item only when it shares a word with it, Laya and the reply agree, and the move is forward', () => {
    expect(moved(item, 'The toggle works, tests pass.', verdict('finished', 0.9))).toMatchObject({ status: 'done', label: 'finished' })
    expect(moved(item, 'The notes pane toggle is partway there.', verdict('started', 0.7))).toMatchObject({ status: 'in-progress' })
    expect(moved(item, 'Test suite is green, 42 pass.', verdict('finished', 0.99))).toBeUndefined()
    expect(moved(item, 'The toggle was reworked.', verdict('finished', 0.59))).toBeUndefined()
    expect(moved(item, 'The toggle was moved.', verdict('not-mentioned', 0.99))).toBeUndefined()
    expect(moved({ ...item, status: 'in-progress' }, 'The toggle is half done.', verdict('started', 0.99))).toBeUndefined()
    expect(moved({ ...item, status: 'done' }, 'The toggle is dropped.', verdict('rejected', 0.99))).toBeUndefined()
    expect(moved(item, 'The toggle is dropped.', verdict('rejected', 0.99))).toBeUndefined()
  })

  test('a reply that says partway outweighs Laya calling it finished; a reply with no cue word moves only at Laya 0.9', () => {
    expect(moved(item, 'The toggle is half wired up, the rest is still open.', verdict('finished', 0.9))).toMatchObject({ status: 'in-progress', label: 'started' })
    expect(moved(item, 'The toggle landed.', verdict('finished', 0.59))).toMatchObject({ status: 'done' })
    expect(moved(item, 'The toggle was reworked.', verdict('finished', 0.89))).toBeUndefined()
    expect(moved(item, 'The toggle was reworked.', verdict('finished', 0.9))).toMatchObject({ status: 'done' })
  })

  test('a status the captain set needs Laya at 0.9, with or without a cue word', () => {
    const hand = { ...item, status: 'in-progress' as const }
    expect(moved(hand, 'The toggle was reworked.', verdict('finished', 0.89), [], true)).toBeUndefined()
    expect(moved(hand, 'The toggle was reworked.', verdict('finished', 0.6), [], true)).toBeUndefined()
    expect(moved(hand, 'The toggle was reworked.', verdict('finished', 0.9), [], true)).toMatchObject({ status: 'done' })
    expect(moved(hand, 'The toggle was reworked.', verdict('finished', 0.6), [], false)).toBeUndefined()
  })

  // Audit 2026-10-29, section 3.5 A: Laya leaning "started" on the Sentry item, rejected at 0.05, declined it on one refusal cue.
  test('Laya never declines an item, on a refusal cue or on its own however sure; a finish cue still closes one', () => {
    const sentry = { status: 'in-progress' as const, text: 'Investigate the Sentry production alert' }
    const weak = { label: 'started', p: 0.85, probs: { 'not-mentioned': 0, started: 0.85, finished: 0.1, rejected: 0.05 } }
    for (const reply of [
      'The Sentry alert was skipped this turn.',
      'Sentry alert: out of scope until we get access.',
      "I won't touch the Sentry alert now.",
      'The Sentry alert is not something I can open without a login.',
    ]) {
      expect(moved(sentry, reply, weak)).toBeUndefined()
    }
    expect(moved(sentry, 'The Sentry alert was dropped.', verdict('rejected', 0.9))).toBeUndefined()
    expect(moved(sentry, 'The Sentry alert was dropped.', verdict('rejected', 0.99))).toBeUndefined()
    expect(moved(sentry, 'The Sentry alert went nowhere.', verdict('rejected', 0.99))).toBeUndefined()
    // Done is the AI's to set: a finish cue lifts Laya's finished as a start cue lifts started.
    expect(moved(sentry, 'The Sentry alert is done.', weak)).toMatchObject({ status: 'done', label: 'finished' })
    expect(moved(sentry, 'The Sentry alert went out.', verdict('finished', 0.89))).toBeUndefined()
    expect(moved(sentry, 'The Sentry alert went out.', verdict('finished', 0.95))).toMatchObject({ status: 'done', p: 0.95 })
    // A start still moves on the cue: it says work began, nothing is closed.
    expect(moved({ ...sentry, status: 'todo' }, 'Started on the Sentry alert.', verdict('not-mentioned', 0.6))).toMatchObject({ status: 'in-progress' })
  })

  // 2026-10-29 00:48Z: a firstmate report declined this item while its worker was running (PR 40 then shipped it). The
  // refusal cue was "Dropping" in the sentence after the one naming the editor key; Laya itself said rejected 0.19.
  test('a refusal cue in a sentence that carries on from the item does not decline it while work on it is running', () => {
    const editor = { status: 'todo' as const, text: 'I would like to be able to use hx (my system editor) when updating my objectives (maybe a u: update, e: open in editor) and I want e: Queue to be relabeled to q: Queue' }
    const reply = [
      'Editor key (`e` opens hx, Queue becomes `q`): worker running.',
      '- mid-task-ask on editor key, disagree: Jev said invalidates (0.33), I chose follow-up. Dropping the legend narrows the scope; it doesn\'t invalidate the work.',
    ].join('\n')
    const probs = { 'not-mentioned': 0.29, started: 0.245, finished: 0.274, rejected: 0.19 }
    expect(moved(editor, reply, { label: 'not-mentioned', p: 0.29, probs })).toBeUndefined()
  })

  // held3 eval case: "not" was taken for the start of the item's own word "notes", so "will not" lost its refusal and
  // "written" closed the item.
  test('a short reply word that only starts an item word is not removed from the cue: a refusal there is no finish', () => {
    const notes = { status: 'todo' as const, text: 'Release notes for the todo list feature' }
    const probs = { 'not-mentioned': 0.38, started: 0.03, finished: 0.19, rejected: 0.39 }
    expect(moved(notes, 'Release notes will not be written, the PR body covers them.', { label: 'rejected', p: 0.39, probs })).toBeUndefined()
    expect(moved(notes, 'Release notes are written.', { label: 'rejected', p: 0.39, probs })).toMatchObject({ status: 'done' })
  })

  // 2026-10-29: three Laya moves to done on a finish word the reply did not say of the item. Replies cut from firstmate's
  // real ones; probabilities are Laya's (aac6fef/laya-mlx) on the whole real reply and item.
  const publicRepo = { status: 'todo' as const, text: "I want to move notes-keeping's plugin to a public repo on KakkoiDev" }
  const review = { status: 'in-progress' as const, text: 'review this pr https://github.com/acme/webapp/pull/27921' }
  const reviewSiblings = [review.text, 'review this pr: https://github.com/acme/webapp/pull/27787']
  const tickets = { status: 'in-progress' as const, text: 'i want to update the notion tickets, indicate all the closed prs and also update the status on all the poc experiments we ran' }

  test('a word inside a link in the reply names only the item holding that link', () => {
    const reply = [
      'Done this turn:',
      '- **pr-review-enhanced is installed** and working. PR https://github.com/KakkoiDev/example/pull/45 is merged and applied to `~/dotfiles`.',
      '  - exploration-video and terminal-demo work again too. The cause was an agent-skills version that was never pushed.',
    ].join('\n')
    const probs = { 'not-mentioned': 0.21, started: 0.338, finished: 0.24, rejected: 0.211 }
    expect(moved(publicRepo, reply, { label: 'started', p: 0.338, probs })).toBeUndefined()
    const linked = 'The PR 27921 review is posted: request changes, 4 inline comments on https://github.com/acme/webapp/pull/27921. Done.'
    expect(moved(review, linked, { label: 'started', p: 0.477, probs: { 'not-mentioned': 0.202, started: 0.477, finished: 0.273, rejected: 0.049 } }, reviewSiblings)).toMatchObject({ status: 'done' })
    const moved45 = 'The notes-keeping plugin is moved to a public repo on KakkoiDev: https://github.com/KakkoiDev/notes-keeping. Merged.'
    expect(moved(publicRepo, moved45, { label: 'finished', p: 0.603, probs: { 'not-mentioned': 0.135, started: 0.228, finished: 0.603, rejected: 0.034 } })).toMatchObject({ status: 'done' })
  })

  test('a finish word followed by "but not" says the work is partway, not finished', () => {
    const reply = [
      'Captain, the PR 27921 review is written but not posted. It is waiting on you.',
      '',
      '**PR 27921 review** (https://github.com/acme/webapp/pull/27921):',
      '- Drafted: request changes, 4 inline comments. Not posted; the PR still shows 0 reviews.',
    ].join('\n')
    const probs = { 'not-mentioned': 0.221, started: 0.336, finished: 0.308, rejected: 0.136 }
    expect(moved(review, reply, { label: 'started', p: 0.336, probs }, reviewSiblings)).toBeUndefined()
    expect(moved({ ...review, status: 'todo' }, reply, { label: 'started', p: 0.336, probs }, reviewSiblings)).toMatchObject({ status: 'in-progress' })
  })

  test('a cue word inside quotes is a word talked about, not a status', () => {
    const reply = ['- **To close it:** open ego-lite, find the space "ego-lite-check", close it.', '', 'Pushback on "done":', '- `/reload-plugins` reloaded plugins, not hooks ("0 hooks").'].join('\n')
    const probs = { 'not-mentioned': 0.469, started: 0.092, finished: 0.224, rejected: 0.215 }
    expect(moved(tickets, reply, { label: 'not-mentioned', p: 0.469, probs })).toBeUndefined()
    const finished = 'The Notion tickets now mark every closed PR, and the POC experiment statuses are updated. Done.'
    expect(moved(tickets, finished, { label: 'started', p: 0.543, probs: { 'not-mentioned': 0.17, started: 0.543, finished: 0.23, rejected: 0.058 } })).toMatchObject({ status: 'done' })
  })

  test('a cue only counts in a sentence about the item, and not inside the item own words', () => {
    const counter = 'Keep a count of moves Laya declined to make'
    expect(moved({ status: 'todo', text: counter }, 'The skipped-move counter is started and shows in the log.', verdict('finished', 0.71), [counter])).toMatchObject({ status: 'in-progress' })
    expect(moved({ status: 'todo', text: counter }, 'The counter for skipped moves is begun; I added the field but nothing increments it.', verdict('started', 0.51), [counter])).toMatchObject({ status: 'in-progress' })
    expect(moved(item, 'The toggle is reworked. Other thing was dropped.', verdict('finished', 0.95), [item.text, 'Other thing'])).toMatchObject({ status: 'done', label: 'finished' })
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
    expect(settle(memory, [])).toEqual({ seen: ['gone'], ai: {}, pins: [], labeled: [], bridge: {} })
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
  test('lists every item under the legend', () => {
    const text = context('- [ ] a\n- [~] b\n- [x] c')
    expect(text).toContain('([ ] todo, [~] in-progress, [x] done, [-] declined, [!] blocked)')
    expect(text).toContain('- [ ] a\n- [~] b\n- [x] c')
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
    expect(settle(memory, edited)).toEqual({ seen: [], ai: { ab12cd3: 'in-progress' }, pins: ['ab12cd3'], labeled: ['ab12cd3'], bridge: { ab12cd3: 'in-progress' } })
    // The captain set it back to todo; the same report does not move it again.
    expect(bridgeMoves(edited, { ab12cd3: 'in-progress' }, memory)).toEqual({})
    expect(bridgeMoves(edited, { ab12cd3: 'done' }, memory)).toEqual({ ab12cd3: { from: 'todo', to: 'done' } })
    expect(diffSnapshot(snapshotOf([{ status: 'todo', text: 'Review this PR', id: 'ab12cd3' }]), edited, edited)).toEqual([])
  })

  test('memory kept under text keys before ids moves to the ids; the snapshot does not report the items as new', () => {
    const memory = { seen: [], ai: { a: 'done' as const }, pins: ['a'], labeled: ['a'], bridge: { a: 'done' as const } }
    const list = [{ status: 'done' as const, text: 'A', id: 'ab12cd3' }]
    expect(settle(memory, list)).toEqual({ seen: [], ai: { ab12cd3: 'done' }, pins: ['ab12cd3'], labeled: ['ab12cd3'], bridge: { ab12cd3: 'done' } })
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
})
