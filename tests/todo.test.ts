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
  cycleItem,
  diffSnapshot,
  format,
  isBackground,
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

describe('todo lines', () => {
  test('markers read and write back as - [ ] todo, - [~] in-progress, - [x] done, - [-] declined; other lines stay', () => {
    const body = '- [ ] one\n* [~] two\n- [X] three\n- [-] four\nnotes by hand\n- [?] odd'
    expect(items(body).map(item => item.status)).toEqual(['todo', 'in-progress', 'done', 'declined'])
    expect(format(parse(body))).toBe('- [ ] one\n- [~] two\n- [x] three\n- [-] four\nnotes by hand\n- [?] odd')
  })

  test('a click moves todo to in-progress to done to declined and back around', () => {
    expect([cycle('todo'), cycle('in-progress'), cycle('done'), cycle('declined')]).toEqual(['in-progress', 'done', 'declined', 'todo'])
    expect(cycleItem('- [ ] one\n- [ ] two', keyOf('Two'))).toBe('- [ ] one\n- [~] two')
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
    expect(out.body).toBe('- [ ] **Label A**: A\n- [ ] **Mine**: B')
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
      { text: 'I want a todo list kept by the plugin', isUpdate: false },
      { text: 'I want to see it live in the sidepanel.', isUpdate: true },
      { text: 'Use the captain status names', isUpdate: true },
    ])
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

  test('a reply moves an item (hand-set or not) only when it shares a word with it, Laya is sure, and the move is forward', () => {
    const item = { status: 'todo' as const, text: 'Add a ctrl+q toggle for the notes pane' }
    expect(moved(item, 'The toggle works, tests pass.', { label: 'finished', p: 0.9 })).toBe('done')
    expect(moved(item, 'The notes pane toggle works.', { label: 'started', p: 0.7 })).toBe('in-progress')
    expect(moved(item, 'Test suite is green, 42 pass.', { label: 'finished', p: 0.9 })).toBeUndefined()
    expect(moved(item, 'The toggle works.', { label: 'finished', p: 0.59 })).toBeUndefined()
    expect(moved(item, 'The toggle works.', { label: 'not-mentioned', p: 0.99 })).toBeUndefined()
    expect(moved({ ...item, status: 'in-progress' }, 'The toggle works.', { label: 'started', p: 0.9 })).toBeUndefined()
    expect(moved({ ...item, status: 'done' }, 'The toggle is dropped.', { label: 'rejected', p: 0.9 })).toBeUndefined()
    expect(moved(item, 'The toggle is dropped.', { label: 'rejected', p: 0.9 })).toBe('declined')
  })

  test('Japanese items and replies match on shared two-character runs', () => {
    expect(mentions('ドキュメントを書く', 'ドキュメントの執筆を始めました')).toBe(true)
    expect(mentions('ドキュメントを書く', '今日は天気がいいですね')).toBe(false)
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
    expect(out.body).toBe('- [x] A\n- [~] B\n- [ ] D\nnote\n- [ ] C')
    expect(out.applied).toEqual([{ text: 'A', from: 'todo', to: 'done', isHandSet: false }])
    expect(out.memory.ai).toEqual({ a: 'done', b: 'todo', d: 'todo', c: 'todo' })
    expect(out.memory.seen).toEqual(['c'])
  })

  test('a move on a hand-set item lands, is reported as hand-set, and the item is the AI\'s again', () => {
    const memory = { seen: [], ai: { a: 'todo' as const }, pins: [], labeled: [], bridge: {} }
    const out = reconcile('- [~] A', memory, { add: [], set: { a: { from: 'in-progress', to: 'done' } }, seen: [] })
    expect(out.body).toBe('- [x] A')
    expect(out.applied).toEqual([{ text: 'A', from: 'in-progress', to: 'done', isHandSet: true }])
    expect(out.memory.pins).toEqual([])
    expect(out.memory.ai).toEqual({ a: 'done' })
  })

  test('with no AI record an untouched todo item is not marked hand-set', () => {
    expect(settle(EMPTY, [{ status: 'todo', text: 'x' }]).pins).toEqual([])
  })
})

describe('context for Claude', () => {
  test('names the in-progress item first, else the first todo, and lists every item', () => {
    const text = context('- [ ] a\n- [~] b\n- [x] c')
    expect(text).toContain('Work on: b')
    expect(text).toContain('- [ ] a\n- [~] b\n- [x] c')
    expect(context('- [ ] a\n- [ ] b')).toContain('Work on: a')
    expect(context('- [x] a')).toContain('Nothing is open.')
    expect(context('')).toBeUndefined()
  })

  test('a labeled item is named by its label, with its text cut short after it', () => {
    const text = context(`- [ ] **Short name**: ${'word '.repeat(40)}end`) ?? ''
    expect(text).toContain('Work on: Short name: word word')
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

  test('reconcile remembers what the bridge reported', () => {
    const out = reconcile('- [ ] A', EMPTY, { add: [], set: { a: { from: 'todo', to: 'in-progress' } }, seen: [], bridge: { a: 'in-progress' } })
    expect(out.body).toBe('- [~] A')
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
    expect(diffSnapshot({ a: 'todo', b: 'todo' }, before, after)).toEqual([
      'A: todo -> in-progress (captain)',
      '+ [ ] Hand added',
      '+ [ ] From an update',
    ])
    expect(diffSnapshot(undefined, before, after)).toEqual([])
  })
})
