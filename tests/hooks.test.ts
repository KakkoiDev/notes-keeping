import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { nextStatus } from '../hooks/todos'

const HOME = '/home/me'
const ROOT = '/work/firstmate'
const DIR = `${HOME}/.notes-keeping`
const SESSION = 'abcdef12-3456-4789-8abc-def012345678'
const NEXT_ID = 'fedcba98-0000-4000-8000-000000000000'
const NOW = `${DIR}/2026-10-26-10-58-firstmate-abcdef12.md`
const FILE = '2026-10-26-10-58-firstmate-abcdef12.md'
const ACTION = 'app:cycleDiffBase'
const PYTHON = `${HOME}/.laya-venv/bin/python`

type Ask = { lines: { id: string; text: string }[]; statuses: { id: string; text: string }[]; answer: string }
// What the fake Laya answers; left undefined, the call fails.
const laya: { answer: ((ask: Ask) => unknown) | undefined; asks: Ask[] } = { answer: undefined, asks: [] }

async function flush(): Promise<void> {
  for (let i = 0; i < 5000; i++) await Promise.resolve()
}

type Fs = Record<string, string>
type Git = { calls: string[][]; remotes: string }
// isPlaced: whether a pane opened unasked is drawn; isFocusable: whether it may take the keyboard (no draft in the prompt).
// shown: the one pane the dock draws; the rest are tabs behind it. A pane holding the keyboard refuses another's focus.
type Ui = {
  panes: Map<string, { isFocused: boolean }>
  shown: string | undefined
  opened: { id: string; focus: boolean }[]
  closed: string[]
  status: (string | undefined)[]
  toasts: string[]
  isPlaced: boolean
  isFocusable: boolean
  fills: { text: string; mode: string }[]
  isFillable: boolean
}

function engine(
  on: On,
  fs: Fs,
  store: Record<string, unknown> = {},
  selection: () => string | undefined = () => undefined,
  head: { text: string } = { text: '' },
  session: { id: string } = { id: SESSION },
) {
  laya.answer = undefined
  laya.asks = []
  const clock = mock.clock(on, { now: new Date(2026, 9, 26, 10, 58).getTime() })
  mock.store(on, store)
  mock.env(on, { HOME })
  const git: Git = { calls: [], remotes: '' }
  const ui: Ui = { panes: new Map(), shown: undefined, opened: [], closed: [], status: [], toasts: [], isPlaced: true, isFocusable: true, fills: [], isFillable: true }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: session.id }))
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: head.text === '' ? [] : [{ role: 'user', text: head.text, toolUses: [] }] }))
  on('fs.read', (_$, e) => {
    const text = fs[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    fs[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: Object.keys(fs).some(path => path === e.path || path.startsWith(`${e.path}/`)) }))
  on('fs.list', (_$, e) => ({
    value: Object.keys(fs)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === PYTHON) {
      const ask = JSON.parse(e.init?.stdin ?? '{}') as Ask
      laya.asks.push(ask)
      const stdout = laya.answer === undefined ? '' : JSON.stringify(laya.answer(ask))
      return { value: { exitCode: laya.answer === undefined ? 1 : 0, stdout, stderr: laya.answer === undefined ? 'boom' : '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    git.calls.push([...e.argv])
    if (e.argv[3] === 'init') fs[`${DIR}/.git/HEAD`] = 'ref: refs/heads/main\n'
    const stdout = e.argv[3] === 'remote' ? git.remotes : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.selection', () => {
    const text = selection()
    return { value: text === undefined ? undefined : { text } }
  })
  on('ui.open', (_$, e) => {
    const focus = e.focus === true
    ui.opened.push({ id: e.id, focus })
    if (!ui.isPlaced) return { value: { isPlaced: false as const, reason: 'narrow' } }
    const isHeld = [...ui.panes].some(([id, pane]) => id !== e.id && pane.isFocused)
    const isFocused = focus && ui.isFocusable && !isHeld
    ui.panes.set(e.id, { isFocused })
    if (isFocused || ui.shown === undefined) ui.shown = e.id
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    ui.closed.push(e.id)
    ui.panes.delete(e.id)
    if (ui.shown === e.id) ui.shown = ui.panes.keys().next().value
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...ui.panes].map(([id, pane]) => ({ id, title: id, isShown: id === ui.shown, isFocused: pane.isFocused, isPlaced: true })),
  }))
  on('ui.status', (_$, e) => {
    ui.status.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    ui.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: ui.isFillable }
  })
  on('ui.toast', (_$, e) => {
    ui.toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, git, ui }
}

function run($: Engine, args: string) {
  return $.command.run({
    command: 'notes-keeping',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
}

function commits(git: Git): string[] {
  return git.calls.filter(argv => argv[3] === 'commit').map(argv => argv[6] ?? '')
}

function submitting(on: On) {
  const sent: { text: string; context: readonly string[] | undefined }[] = []
  on('prompt.submit', (_$, e) => {
    sent.push({ text: e.text, context: e.context })
    return { text: e.text }
  })
  return sent
}

function submit($: Engine, text: string, origin: 'composer' | 'sdk' = 'composer') {
  return $.prompt.submit({ text, wait: false, origin: { kind: origin } })
}

test('init, objectives, update and important write the session notes file and commit each write', async ($, on) => {
  const fs: Fs = {}
  const { git } = engine(on, fs, {}, () => 'Agent says merge?')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })

  expect((await run($, 'init')).text).toBe(`Notes started: ${NOW}`)
  expect(fs[NOW]).toBe(`# Objectives\n\nSessions: ${SESSION}\n\n## Updates\n\n# Important\n\n# Chat\n`)
  expect((await run($, 'init')).text).toContain('already keeps')
  expect((await run($, 'objectives Plan the day')).text).toBe('Objectives set.')
  expect((await run($, 'update Change of plan')).text).toBe('Objectives updated under ## Updates.')
  expect((await run($, 'objectives Later goal')).text).toBe('Objectives updated under ## Updates.')
  expect((await run($, 'init Via init')).text).toBe(`This session keeps ${NOW}.\nObjectives updated under ## Updates.`)
  await run($, 'important')
  await run($, 'important typed by me')

  expect(fs[NOW]).toBe(
    [
      '# Objectives',
      '',
      `Sessions: ${SESSION}`,
      '',
      'Plan the day',
      '',
      '## Updates',
      '',
      '[UPDATE] 2026-10-26-10-58',
      'Change of plan',
      '',
      '[UPDATE] 2026-10-26-10-58',
      'Later goal',
      '',
      '[UPDATE] 2026-10-26-10-58',
      'Via init',
      '',
      '# Todo',
      '',
      '- [ ] Change of plan',
      '- [ ] Later goal',
      '- [ ] Via init',
      '',
      '# Important',
      '',
      '[AI_AGENT] Agent says merge?',
      '',
      '[USER] typed by me',
      '',
      '# Chat',
      '',
    ].join('\n'),
  )
  expect(commits(git).filter(subject => !subject.startsWith('todo:'))).toEqual([
    `init: ${FILE}`,
    `objectives: ${FILE}`,
    `update: ${FILE}`,
    `update: ${FILE}`,
    `update: ${FILE}`,
    `important: ${FILE}`,
    `important: ${FILE}`,
  ])
  expect(git.calls.filter(argv => argv[3] === 'init')).toEqual([['git', '-C', DIR, 'init', '-q']])
  expect(git.calls.some(argv => argv.includes('push'))).toBe(false)
})

test('init with text sets the objectives; init --new starts a second file for the session', async ($, on) => {
  const fs: Fs = {}
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init one')
  expect(fs[NOW]).toBe(`# Objectives\n\nSessions: ${SESSION}\n\none\n\n## Updates\n\n# Important\n\n# Chat\n`)
  expect((await run($, 'init --new two')).text).toBe(`Notes started: ${DIR}/2026-10-26-10-58-firstmate-abcdef12-2.md`)
  expect(fs[`${DIR}/2026-10-26-10-58-firstmate-abcdef12-2.md`]).toContain('\n\ntwo\n')
})

test('a write with no notes file starts one, tells the user, and never takes the first prompt', async ($, on) => {
  const fs: Fs = {}
  const { git, ui } = engine(on, fs, {}, undefined, { text: 'First prompt of the session' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  expect((await run($, 'important keep me')).text).toBe('Added to # Important.')
  expect(ui.toasts).toEqual([`Notes started: ${NOW}`])
  expect(fs[NOW]).toBe(`# Objectives\n\nSessions: ${SESSION}\n\n## Updates\n\n# Important\n\n[USER] keep me\n\n# Chat\n`)
  expect(commits(git)).toEqual([`init: ${FILE}`, `important: ${FILE}`])
})

test('an unknown subcommand names the nearest one; a bare command or a bare objectives prints usage and writes nothing', async ($, on) => {
  const fs: Fs = {}
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  const typo = (await run($, 'udpate the plan')).text ?? ''
  expect(typo.split('\n')[0]).toBe('unknown subcommand udpate, did you mean update?')
  expect(typo).toContain('Usage: /notes-keeping <subcommand>')
  expect((await run($, 'zzzzzzzz')).text?.split('\n')[0]).toBe('unknown subcommand zzzzzzzz')
  expect((await run($, '')).text?.startsWith('Usage: /notes-keeping <subcommand>')).toBe(true)
  expect((await run($, 'objectives')).text).toBe('Usage: /notes-keeping objectives <text>')
  expect((await run($, 'update')).text).toBe('Usage: /notes-keeping update <text>')
  expect(Object.keys(fs)).toEqual([])
})

test('a write warns while the notes repository has a remote', async ($, on) => {
  const { git } = engine(on, {})
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  expect((await run($, 'init plan')).text).toBe(`Notes started: ${NOW}`)
  git.remotes = 'origin\n'
  expect((await run($, 'update more')).text).toBe(
    `Objectives updated under ## Updates.\nWarning: ${DIR} has a git remote (origin). notes-keeping never pushes, but a push would publish your notes.`,
  )
})

test('Claude is denied Edit and Write on the notes folder; other paths pass', async ($, on) => {
  engine(on, {})
  const passed: string[] = []
  on('tool.call', (_$, e) => {
    passed.push(e.tool)
    return { result: {} }
  })
  const edit = await $.tool.call({ tool: 'Edit', file_path: NOW, old_string: 'a', new_string: 'b' })
  const write = await $.tool.call({ tool: 'Write', file_path: `${DIR}/new.md`, content: 'x' })
  const other = await $.tool.call({ tool: 'Write', file_path: `${HOME}/.notes-keeping-old/x.md`, content: 'x' })
  expect(JSON.stringify(edit)).toContain("is the user's notes")
  expect(JSON.stringify(write)).toContain("is the user's notes")
  expect(JSON.stringify(other)).not.toContain("is the user's notes")
  expect(passed).toEqual(['Write'])
})

test('a queued reply goes out with the next composer Enter, recorded as one turn in # Chat, once', async ($, on) => {
  const fs: Fs = {}
  const sent = submitting(on)
  const { git, ui } = engine(on, fs, {}, () => 'Shall I merge?')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')

  expect((await run($, 'reply Merge it')).text).toBe('Reply queued; it goes out with your next message.')
  expect(fs[NOW]?.endsWith('# Chat\n')).toBe(true)
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. /notes-keeping replies: edit, remove, send')

  await submit($, 'from a script', 'sdk')
  await $.prompt.submit({ text: 'meta', wait: false, isMeta: true, origin: { kind: 'composer' } })
  await submit($, 'carry on')
  await submit($, 'plain')

  expect(sent.map(row => row.text)).toEqual([
    'from a script',
    'meta',
    '[AI_AGENT] Shall I merge?\n[USER] Merge it\n\ncarry on',
    'plain',
  ])
  expect(fs[NOW]?.endsWith('# Chat\n\n[AI_AGENT] Shall I merge?\n[USER] Merge it\n\n[USER] carry on\n')).toBe(true)
  expect(ui.status.at(-1)).toBeUndefined()
  expect(commits(git)).toEqual([`init: ${FILE}`, `reply: ${FILE}`])
})

test('a slash command leaves the queue for the next typed message', async ($, on) => {
  const sent = submitting(on)
  engine(on, {}, {}, () => 'Q?')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'reply A')
  await $.prompt.submit({ text: '/model', wait: false, command: { name: 'model', args: '' }, origin: { kind: 'composer' } })
  await submit($, 'next')
  expect(sent.map(row => row.text)).toEqual(['/model', '[AI_AGENT] Q?\n[USER] A\n\nnext'])
})

test('after /clear the new session id keeps the notes file and the reply queue is dropped', async ($, on) => {
  const fs: Fs = {}
  const session = { id: SESSION }
  const sent = submitting(on)
  const { git, ui } = engine(on, fs, {}, () => 'Q?', undefined, session)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')
  await run($, 'reply dropped')

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  expect(ui.status.at(-1)).toBeUndefined()
  session.id = NEXT_ID
  expect((await run($, 'update after clear')).text).toBe('Objectives updated under ## Updates.')
  expect((await run($, 'init')).text).toContain(`already keeps ${NOW}`)
  await submit($, 'fresh')
  expect(sent.map(row => row.text)).toEqual(['fresh'])
  expect(fs[NOW]).toContain(`Sessions: ${SESSION}, ${NEXT_ID}\n\nPlan\n`)
  expect(fs[NOW]).toContain('after clear')
  expect(fs[NOW]).not.toContain('dropped')
  expect(commits(git).filter(subject => !subject.startsWith('todo:'))).toEqual([`init: ${FILE}`, `session: ${FILE}`, `update: ${FILE}`])
})

test('a session that ends by exit hands nothing to the next id: its first write starts a new file', async ($, on) => {
  const fs: Fs = {}
  const session = { id: SESSION }
  engine(on, fs, {}, undefined, undefined, session)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: { id: SESSION } })
  session.id = NEXT_ID
  expect((await run($, 'update x')).text).toBe('Objectives set.')
  expect(fs[`${DIR}/2026-10-26-10-58-firstmate-fedcba98.md`]).toContain(`Sessions: ${NEXT_ID}\n\nx\n`)
  expect(fs[NOW]).not.toContain(NEXT_ID)
})

test('history lists earlier notes of every project newest first and continues the picked one whole', async ($, on) => {
  const old = `${DIR}/2026-10-24-09-00-firstmate-11111111.md`
  const before = '# Initial Prompt\n\nOld plan\nA deleted line\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] Old plan\n- [~] old change\n\n# Important\n\n[USER] old fact\n\n# Chat\n\n[AI_AGENT] q\n[USER] old chat\n'
  const writes: string[] = []
  const fs: Fs = new Proxy<Fs>(
    { [old]: before, [`${DIR}/2026-10-25-18-30-dotfiles-22222222.md`]: '# Objectives\n\nYesterday plan\n' },
    { set: (target, path, text) => (writes.push(String(path)), Reflect.set(target, path, text)) },
  )
  const store: Record<string, unknown> = { [`todo:${old}`]: { seen: ['old plan', 'a deleted line'], ai: {}, pins: [] } }
  engine(on, fs, store)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Today plan')

  const list = (await run($, 'history')).text ?? ''
  expect(list.split('\n').slice(0, 3)).toEqual([
    ' 1. 2026-10-25 18:30  dotfiles  22222222  Yesterday plan',
    ' 2. 2026-10-24 09:00  firstmate  11111111  Old plan',
    '',
  ])

  const picked = await run($, 'history 2')
  expect(picked.text).toContain('Continuing 2026-10-24-09-00-firstmate-11111111.md')
  expect(picked.context?.[0]).toContain(`Session notes kept by notes-keeping: ${old}`)
  expect(picked.context?.[0]).toContain((fs[old] ?? 'missing').trimEnd())
  expect(fs[NOW]?.startsWith(`# Objectives\n\nContinuation of: 2026-10-24-09-00-firstmate-11111111.md\n\nSessions: ${SESSION}\n\nOld plan\nA deleted line\n\nToday plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] Old plan\n- [~] old change\n`)).toBe(true)
  fs[PYTHON] = ''
  fakeLaya()
  await run($, 'todo sync')
  const asked = laya.asks.flatMap(ask => ask.lines.map(line => line.text))
  expect(asked).toContain('Today plan')
  expect(asked).not.toContain('A deleted line')

  await run($, 'update new requirement')
  await run($, 'history 2')
  expect(fs[old]).toBe(before)
  expect(writes).not.toContain(old)
  expect(fs[NOW]?.match(/old change/g)?.length).toBe(2)
})

const NOTES = '# Objectives\n\nThe plan\n\n## Updates\n\n[UPDATE] t\nnew goal\n\n# Important\n\n[USER] agreed X\n\n# Chat\n\n[AI_AGENT] q\n[USER] a\n'
const BOUND = `${DIR}/2026-10-26-10-50-firstmate-abcdef12.md`

test('the first prompt after a compaction carries the whole notes file, once', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, head)

  await submit($, 'one')
  await submit($, 'two')
  const summary = (body: string) => `This session is being continued from a previous conversation that ran out of context. ${'x'.repeat(300)} ${body}`
  head.text = summary('first summary')
  await submit($, 'three')
  await submit($, 'four')
  head.text = summary('second summary')
  await submit($, 'five')

  expect(sent.map(row => row.context?.length ?? 0)).toEqual([0, 0, 1, 0, 1])
  const notes = sent[2]?.context?.[0] ?? ''
  expect(notes).toContain(`Session notes kept by notes-keeping: ${BOUND}`)
  expect(notes).toContain(NOTES.trimEnd())
})

test('a session continued with claude -c carries the notes on its first prompt, once', async ($, on) => {
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, { text: 'Earlier prompt' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await submit($, 'back again')
  await submit($, 'and more')
  expect(sent.map(row => row.context?.length ?? 0)).toEqual([1, 1])
  expect(sent[0]?.context?.[0]).toContain(NOTES.replace('# Important', '# Todo\n\n- [ ] new goal\n\n# Important').trimEnd())
  expect(sent[1]?.context?.[0]).toContain('Work on: new goal')
})

test('a fresh session gets no notes on its first prompt', async ($, on) => {
  const head = { text: '' }
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, head)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  head.text = 'first'
  await submit($, 'first')
  expect(sent.map(row => row.context)).toEqual([undefined])
})

test('a session with no notes file gets no context after a compaction', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  engine(on, {}, {}, undefined, head)
  await submit($, 'one')
  head.text = 'summary'
  await submit($, 'two')
  expect(sent.map(row => row.context)).toEqual([undefined, undefined])
})

const SELECT_PANE = {
  plugin: 'notes-keeping',
  component: 'Pane',
  requestId: 'notes-keeping-select',
  props: { title: 'Selection', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const NOTES_PANE = { ...SELECT_PANE, requestId: 'notes-keeping', props: { ...SELECT_PANE.props, title: 'Notes' } } as const
const REPLIES_PANE = { ...SELECT_PANE, requestId: 'notes-keeping-replies', props: { ...SELECT_PANE.props, title: 'Replies' } } as const

const BAND = {
  plugin: 'notes-keeping',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const HINT = {
  plugin: 'notes-keeping',
  component: 'PromptHint',
  requestId: 'hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

function engineDraws(on: On) {
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine') as RenderElement)
}

test('a selection opens a focused pane: i keeps it, r queues a reply, x dismisses; each answered text stays down', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n' }
  let selection: string | undefined
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await clock.advance(1200)
  expect(ui.opened).toEqual([])

  selection = 'Keep this fact'
  await clock.advance(1200)
  expect(ui.opened).toEqual([{ id: 'notes-keeping-select', focus: true }])
  const first = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  expect((await first.find({ key: 'important' }))?.props.hotkey).toBe('i')
  expect((await first.find({ key: 'dismiss' }))?.props.hotkey).toBe('x')
  expect((await first.find({ key: 'reply-open' }))?.props).toMatchObject({ hotkey: 'r', action: ACTION })
  await first.press({ key: 'important' })
  expect(fs[BOUND]).toContain('# Important\n\n[AI_AGENT] Keep this fact\n\n# Chat')
  expect(ui.closed).toEqual(['notes-keeping-select'])
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(1)
  await first.unmount()

  selection = 'Shall I push?'
  await clock.advance(1200)
  const second = await $.ui.mount({ ...SELECT_PANE, surface: 'desktop' })
  await second.press({ key: 'reply-open' })
  expect(ui.opened.at(-1)).toEqual({ id: 'notes-keeping-select', focus: true })
  expect((await second.find({ key: 'reply' }))?.props.autoFocus).toBe(true)
  await second.input({ key: 'reply', text: '   ' })
  expect(await second.find({ key: 'reply' })).toBeDefined()
  await second.input({ key: 'reply', text: 'Push now' })
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. /notes-keeping replies: edit, remove, send')
  expect(fs[BOUND]?.endsWith('# Chat\n')).toBe(true)
  await clock.advance(1200)
  expect(await second.find({ key: 'reply' })).toBeUndefined()
  await second.unmount()

  selection = 'Noise'
  await clock.advance(1200)
  const third = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await third.press({ key: 'dismiss' })
  expect(fs[BOUND]).not.toContain('Noise')
  await third.unmount()
  const opens = ui.opened.length
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(opens)

  selection = undefined
  await clock.advance(1200)
  selection = 'Noise'
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(opens + 1)
})

test('a selection while the notes panel holds the keyboard shows the Selection pane, focused, with no Esc', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run($, 'show')
  expect(ui.shown).toBe('notes-keeping')
  expect(ui.panes.get('notes-keeping')?.isFocused).toBe(true)
  selection = 'Keep this fact'
  await clock.advance(1200)
  expect(ui.shown).toBe('notes-keeping-select')
  expect(ui.panes.get('notes-keeping-select')?.isFocused).toBe(true)
})

test('a selection still changing between polls, as during a drag, opens nothing until it holds', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'al'
  await clock.advance(600)
  selection = 'alpha br'
  await clock.advance(600)
  selection = 'alpha bravo'
  await clock.advance(600)
  expect(ui.opened).toEqual([])
  await clock.advance(600)
  expect(ui.opened).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('a key that is none of the hotkeys hands focus back to the prompt and closes the menu', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  expect(ui.panes.get('notes-keeping-select')).toEqual({ isFocused: true })
  await clock.advance(1200)
  expect(ui.closed).toEqual([])
  ui.panes.set('notes-keeping-select', { isFocused: false })
  await clock.advance(1200)
  expect(ui.closed).toEqual(['notes-keeping-select'])
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(1)
})

test('switching to the Notes tab keeps the Selection pane and both tabs; it closes only when the prompt takes the keyboard', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  await clock.advance(600)
  await run($, 'show')
  expect([...ui.panes.keys()]).toEqual(['notes-keeping-select', 'notes-keeping'])
  // The person clicks the Notes tab: it is shown and takes the keyboard.
  ui.shown = 'notes-keeping'
  ui.panes.set('notes-keeping', { isFocused: true })
  ui.panes.set('notes-keeping-select', { isFocused: false })
  await clock.advance(1200)
  expect(ui.closed).toEqual([])
  // Back on the Selection tab, then a key that is none of r/i/x hands the keyboard to the prompt.
  ui.shown = 'notes-keeping-select'
  ui.panes.set('notes-keeping', { isFocused: false })
  ui.panes.set('notes-keeping-select', { isFocused: true })
  await clock.advance(600)
  ui.panes.set('notes-keeping-select', { isFocused: false })
  await clock.advance(600)
  expect(ui.closed).toEqual(['notes-keeping-select'])
})

test('the open pane outlives the selection the terminal drops when the dock narrows the transcript', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  let selection: string | undefined
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha bravo'
  await clock.advance(1200)
  selection = undefined
  await clock.advance(1200)
  await clock.advance(1200)
  expect(ui.closed).toEqual([])
  const pane = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await pane.press({ key: 'important' })
  expect(fs[BOUND]).toContain('[AI_AGENT] alpha bravo')
  await pane.unmount()
  selection = 'alpha bravo'
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(1)
})

test('the text a closed dock leaves under the kept selection does not raise the pane again', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'ok received'
  await clock.advance(1200)
  const pane = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await pane.press({ key: 'dismiss' })
  await pane.unmount()
  selection = '[USER] Appr'
  await clock.advance(1200)
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(1)
  selection = undefined
  await clock.advance(1200)
  selection = 'a new pick'
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(2)
})

test('with a draft in the prompt the pane opens unfocused and stays until answered or replaced', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  ui.isFocusable = false
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  selection = undefined
  await clock.advance(1200)
  expect(ui.closed).toEqual([])
  selection = 'bravo'
  await clock.advance(1200)
  expect(ui.opened.map(open => open.id)).toEqual(['notes-keeping-select', 'notes-keeping-select'])
})

test('the band carries the menu with digit keys only when the pane is not drawn', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  let selection: string | undefined
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  selection = 'drawn in the pane'
  await clock.advance(1200)
  const placed = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await placed.find({ key: 'reply-open' })).toBeUndefined()
  await placed.unmount()

  selection = undefined
  await clock.advance(1200)
  ui.isPlaced = false
  selection = 'narrow terminal'
  await clock.advance(1200)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ key: 'reply-open' }))?.props).toMatchObject({ hotkey: '1', action: ACTION })
  expect((await band.find({ key: 'important' }))?.props.hotkey).toBe('2')
  expect((await band.find({ key: 'dismiss' }))?.props.hotkey).toBe('3')
  await band.press({ key: 'important' })
  expect(fs[BOUND]).toContain('[AI_AGENT] narrow terminal')
  expect(await band.find({ key: 'important' })).toBeUndefined()
  await band.unmount()
})

test('the Notes toggle under the prompt carries the chord action and opens and closes the notes pane', async ($, on) => {
  const { ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND })
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await hint.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect((await hint.find({ key: 'notes-toggle' }))?.props).toMatchObject({ action: ACTION, label: 'Notes: show (ctrl+q)' })
  await hint.press({ key: 'notes-toggle' })
  expect(ui.opened).toEqual([{ id: 'notes-keeping', focus: true }])
  expect((await hint.find({ key: 'notes-toggle' }))?.props.label).toBe('Notes: hide (ctrl+q)')
  await hint.press({ key: 'notes-toggle' })
  expect(ui.closed).toEqual(['notes-keeping'])
  expect((await hint.find({ key: 'notes-toggle' }))?.props.label).toBe('Notes: show (ctrl+q)')
  await hint.unmount()
})

test('o opens the objectives view and u focuses an inline field that sets the objectives, then updates them', async ($, on) => {
  const fs: Fs = {}
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:objectives' }))?.props).toMatchObject({ hotkey: 'o' })
  await pane.press({ key: 'view:objectives' })
  expect((await pane.find({ key: 'objectives' }))?.props).toMatchObject({ hotkey: 'u', label: 'Set objectives' })
  await pane.press({ key: 'objectives' })
  expect((await pane.find({ key: 'objectives' }))?.props).toMatchObject({ autoFocus: true })
  expect((await pane.find({ key: 'objectives' }))?.type).toBe('Input')
  await pane.input({ key: 'objectives', text: 'Ship it' })
  expect(fs[NOW]).toContain('# Objectives\n\nSessions: ' + SESSION + '\n\nShip it\n')
  expect((await pane.find({ key: 'objectives' }))?.props.label).toBe('Update objectives')
  await pane.press({ key: 'objectives' })
  await pane.input({ key: 'objectives', text: 'Then this' })
  expect(fs[NOW]).toContain('## Updates\n\n[UPDATE] 2026-10-26-10-58\nThen this\n')
  await pane.unmount()
})


test('the panel opens on an overview with the todo slot first, keys on screen, and a view per key', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nSessions: s\n\nShip it\n\n## Updates\n\n# Important\n\n[AI_AGENT] a fact\n\n# Chat\n\n[USER] hello\n' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: 'Todo' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '(no todos yet)' })).toBeDefined()
  expect((await pane.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['view:objectives', 'view:important', 'view:chat', 'view:queue', 'send'])
  expect(await pane.find({ type: 'Text', text: 'o objectives (u adds an update there), i important, c chat, e queue, s send queue, Esc closes' })).toBeDefined()
  await pane.press({ key: 'view:important' })
  expect(await pane.find({ type: 'Text', text: '[AI_AGENT] a fact' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[USER] hello' })).toBeUndefined()
  await pane.press({ key: 'view:chat' })
  expect(await pane.find({ type: 'Text', text: '[USER] hello' })).toBeDefined()
  expect((await pane.find({ key: 'view:overview' }))?.props).toMatchObject({ hotkey: 'b' })
  await pane.press({ key: 'view:overview' })
  expect(await pane.find({ key: 'view:overview' })).toBeUndefined()
  await pane.unmount()
})

test('the queue view lists every queued reply in its own editable field, removes one, and s sends them all', async ($, on) => {
  let selection = 'First question'
  const fs: Fs = { [BOUND]: NOTES }
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'reply one')
  selection = 'Second question'
  await run($, 'reply two')
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await hint.press({ key: 'edit-queue' })
  expect(ui.opened.at(-1)).toEqual({ id: 'notes-keeping', focus: true })
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:queue' }))?.props).toMatchObject({ hotkey: 'e', label: 'Queue (2)' })
  expect((await pane.find({ key: 'reply:0' }))?.props).toMatchObject({ value: 'one' })
  expect((await pane.find({ key: 'reply:1' }))?.props).toMatchObject({ value: 'two' })
  await pane.input({ key: 'reply:1', text: 'two, reworded' })
  expect((await pane.find({ key: 'reply:1' }))?.props).toMatchObject({ value: 'two, reworded' })
  await pane.press({ key: 'remove:0' })
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. /notes-keeping replies: edit, remove, send')
  expect((await pane.find({ key: 'reply:0' }))?.props).toMatchObject({ value: 'two, reworded' })
  expect(await pane.find({ key: 'reply:1' })).toBeUndefined()
  expect((await pane.find({ key: 'send' }))?.props).toMatchObject({ hotkey: 's' })
  ui.isFillable = false
  await pane.press({ key: 'send' })
  expect(await pane.find({ key: 'reply:0' })).toBeDefined()
  ui.isFillable = true
  await pane.press({ key: 'send' })
  expect(ui.fills.at(-1)).toEqual({ text: '[AI_AGENT] Second question\n[USER] two, reworded', mode: 'insert' })
  expect(fs[BOUND]).toContain('[AI_AGENT] Second question\n[USER] two, reworded')
  expect(await pane.find({ type: 'Text', text: 'No replies queued.' })).toBeDefined()
  expect(await hint.find({ key: 'send-queue' })).toBeUndefined()
  await hint.unmount()
  await pane.unmount()
})

test('the replies command opens the panel at the queue view', async ($, on) => {
  engine(on, {}, {}, () => 'Question one')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'reply answer')
  await run($, 'replies')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'reply:0' })).toBeDefined()
  expect((await run($, '')).text).toContain('open the panel at the queue: every reply editable')
  await pane.unmount()
})

test('a todo status cycles todo, in-progress, done, declined and back', () => {
  expect(nextStatus('todo')).toBe('in-progress')
  expect(nextStatus('in-progress')).toBe('done')
  expect(nextStatus('done')).toBe('declined')
  expect(nextStatus('declined')).toBe('todo')
})

test('u in the objectives view opens an input whose text lands as a new [UPDATE] under ## Updates, and its hint is on screen', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nSessions: s\n\nShip it\n\n## Updates\n\n# Important\n\n# Chat\n' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  expect(await pane.find({ type: 'Text', text: 'u adds an update under Updates, Enter keeps it, b goes back' })).toBeDefined()
  expect((await pane.find({ key: 'objectives' }))?.props).toMatchObject({ hotkey: 'u', label: 'Update objectives' })
  await pane.press({ key: 'objectives' })
  expect((await pane.find({ key: 'objectives' }))?.type).toBe('Input')
  await pane.input({ key: 'objectives', text: 'Add the todo slot' })
  expect(fs[BOUND]).toContain('## Updates\n\n[UPDATE] 2026-10-26-10-58\nAdd the todo slot\n')
  expect(fs[BOUND]).toContain('Ship it')
  const hotkeys = (await pane.findAll({ type: 'Button' })).map(button => button.props.hotkey)
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
  await pane.unmount()
})

test('a selection pane the terminal cannot seat says why once and names the bar keys, instead of silently showing the bar', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  ui.isPlaced = false
  selection = 'first pick'
  await clock.advance(1200)
  const told = () => ui.toasts.filter(text => text.startsWith('The selection panel'))
  expect(told()).toEqual(['The selection panel waits for a wider terminal (narrow); use the bar above the prompt: 1 Reply, 2 Important, 3 Dismiss.'])
  selection = undefined
  await clock.advance(1200)
  selection = 'second pick'
  await clock.advance(1200)
  expect(ui.opened).toHaveLength(2)
  expect(told()).toHaveLength(1)
})

// The captain's heading layout with his list shapes; the text is a stand-in.
const CAPTAIN_NOTES = [
  '# Objectives',
  '',
  'I want a todo list kept by the plugin',
  'An objective can be of status:',
  '- to-do: not started yet',
  '- ongoing: being worked on',
  '',
  '## Updates',
  '',
  '[Update] 2026-10-17-02',
  'I want to see it live in the sidepanel.',
  'And keep it in the md file.',
  '',
  '# Important',
  '',
  '# Chat',
  '',
].join('\n')
const SESSION_BOUND = { [`session:${SESSION}`]: BOUND }

function complete($: Engine, answer: string) {
  return $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

// Laya reads an objective line as a task, as background for the to-do line and unsure for the ongoing one; replies are read by the table.
function fakeLaya(replies: Record<string, { label: string; p: number }> = {}) {
  laya.answer = ask => ({
    lines: Object.fromEntries(ask.lines.map(line => [line.id, line.text.startsWith('to-do') ? 0.05 : line.text.startsWith('ongoing') ? 0.5 : 0.95])),
    statuses: Object.fromEntries(ask.statuses.map(status => [status.id, replies[status.id] ?? { label: 'not-mentioned', p: 0.9 }])),
    predictMs: 1,
  })
}

test('at launch Laya picks items from the objectives and every update becomes one; judged lines are not asked twice', async ($, on) => {
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES, [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(laya.asks).toHaveLength(1)
  expect(laya.asks[0]?.lines.map(line => line.text)).toEqual(['I want a todo list kept by the plugin', 'to-do: not started yet', 'ongoing: being worked on'])
  expect(laya.asks[0]?.statuses).toEqual([])
  expect(fs[BOUND]).toBe(
    CAPTAIN_NOTES.replace(
      '# Important',
      '# Todo\n\n- [ ] I want a todo list kept by the plugin\n- [ ] ongoing: being worked on\n- [ ] I want to see it live in the sidepanel.\n\n# Important',
    ),
  )
  expect(commits(git)).toEqual([`todo: ${BOUND.split('/').pop()}`])

  // The captain deletes a line; a new launch does not bring it back and asks nothing.
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [ ] ongoing: being worked on\n', '')
  await run($, 'todo sync')
  expect(laya.asks).toHaveLength(1)
  expect(fs[BOUND]).not.toContain('- [ ] ongoing: being worked on')
})

test('/notes-keeping update adds an item with no Laya call for it, and todo lists the items', async ($, on) => {
  const fs: Fs = { [PYTHON]: '' }
  engine(on, fs)
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init')
  await run($, 'objectives Plan the todo pane')
  await flush()
  await run($, 'update Add a Todo pane')
  await flush()
  expect(laya.asks.flatMap(ask => ask.lines)).toEqual([{ id: 'plan the todo pane', text: 'Plan the todo pane' }])
  expect(fs[NOW]).toContain('\n# Todo\n\n- [ ] Plan the todo pane\n- [ ] Add a Todo pane\n\n# Important')
  expect((await run($, 'todo')).text).toBe('[ ] Plan the todo pane\n[ ] Add a Todo pane')
  expect((await run($, 'todo nonsense')).text).toBe('Usage: /notes-keeping todo [sync]')
})

test('without Laya installed the updates still become items, one toast says why, and the lines wait for Laya', async ($, on) => {
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES }
  const { ui } = engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(fs[BOUND]).toContain('# Todo\n\n- [ ] I want to see it live in the sidepanel.\n\n# Important')
  expect(ui.toasts.filter(text => text.includes('no Laya'))).toHaveLength(1)
  expect(ui.toasts[0]).toContain(PYTHON)

  fs[PYTHON] = ''
  fakeLaya()
  await run($, 'todo sync')
  expect(fs[BOUND]).toContain('- [ ] I want a todo list kept by the plugin')
})

test('at the end of a turn Laya reads the reply: a reply that names an item and is sure moves it, an unrelated confident one does not', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle\n- [ ] Write the docs\n- [ ] Rename the pane'), [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({
    'add a ctrl+q toggle': { label: 'finished', p: 0.9 },
    'write the docs': { label: 'rejected', p: 0.95 },
    'rename the pane': { label: 'started', p: 0.5 },
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  await complete($, 'The ctrl+q toggle works and tests pass. Pushed the branch.')
  await flush()
  expect(laya.asks.at(-1)?.answer).toBe('The ctrl+q toggle works and tests pass. Pushed the branch.')
  expect(fs[BOUND]).toContain('- [x] Add a ctrl+q toggle\n- [ ] Write the docs\n- [ ] Rename the pane')
  expect(commits(git).at(-1)).toBe(`todo: ${BOUND.split('/').pop()}`)

  // A done item is not asked about again.
  await complete($, 'Nothing else.')
  await flush()
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).toEqual(expect.arrayContaining(['write the docs', 'rename the pane']))
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).not.toContain('add a ctrl+q toggle')
})

const LOG = `${DIR}/todo-changes.log`

test('Laya also updates a status the captain set by hand, above the same floor, and each change is logged', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle\n- [ ] Write the docs\n- [ ] Rename the pane\n- [x] Fix the flicker'), [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({
    'add a ctrl+q toggle': { label: 'finished', p: 0.9 },
    'write the docs': { label: 'finished', p: 0.9 },
    'rename the pane': { label: 'finished', p: 0.5 },
    'fix the flicker': { label: 'rejected', p: 0.95 },
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  await complete($, 'Nothing yet.')
  await flush()
  // The captain sets two by hand; Laya reads the next reply.
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [ ] Write the docs', '- [~] Write the docs').replace('- [ ] Rename the pane', '- [~] Rename the pane')
  await complete($, 'The ctrl+q toggle, the docs, the pane rename and the flicker fix are all finished.')
  await flush()
  expect(fs[BOUND]).toContain('- [x] Add a ctrl+q toggle\n- [x] Write the docs\n- [~] Rename the pane\n- [x] Fix the flicker')
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).toEqual(expect.arrayContaining(['add a ctrl+q toggle', 'write the docs', 'rename the pane']))
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).not.toContain('fix the flicker')
  expect(fs[LOG]).toBe(
    [
      `2026-10-26-10-58 ${BOUND.split('/').pop()} | Add a ctrl+q toggle | todo -> done | laya finished 0.90`,
      `2026-10-26-10-58 ${BOUND.split('/').pop()} | Write the docs | in-progress -> done | laya finished 0.90 | replaced a hand-set status`,
      '',
    ].join('\n'),
  )
  // The log is committed with the write that changed the statuses.
  expect(git.calls.filter(argv => argv[3] === 'add').length).toBeGreaterThan(0)
  expect(commits(git).at(-1)).toBe(`todo: ${BOUND.split('/').pop()}`)
})

test('a failed Laya call changes nothing and tells the user once per failure', async ($, on) => {
  const body = '- [ ] Add a ctrl+q toggle'
  const fs: Fs = { [BOUND]: setTodoFile(body), [PYTHON]: '' }
  const { ui } = engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  const before = fs[BOUND]
  await complete($, 'The ctrl+q toggle works.')
  await flush()
  expect(fs[BOUND]).toBe(before)
  expect(ui.toasts.at(-1)).toBe('notes-keeping todo: Laya failed: boom')
})

test('a subagent turn or an interrupted turn does not run Laya', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer', agentId: 'sub' })
  await flush()
  expect(laya.asks).toHaveLength(0)
})

test('every prompt carries the todo list; a prompt that carries the whole file does not repeat it', async ($, on) => {
  const sent = submitting(on)
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle\n- [~] Write the docs') }
  engine(on, fs, { ...SESSION_BOUND }, undefined, { text: 'Earlier prompt' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await submit($, 'first')
  await submit($, 'second')
  await submit($, 'third')
  expect(sent[0]?.context).toHaveLength(1)
  expect(sent[0]?.context?.[0]).toContain('# Todo')
  for (const row of sent.slice(1)) {
    expect(row.context).toHaveLength(1)
    expect(row.context?.[0]).toContain('Work on: Write the docs')
    expect(row.context?.[0]).toContain('- [todo] Add a ctrl+q toggle\n- [in-progress] Write the docs')
  }
})

test('a click on a todo item in the notes pane sets the next status and writes the file; Laya may change it afterwards, logged as hand-set', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({ 'add a ctrl+q toggle': { label: 'finished', p: 0.9 } })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  const launched = commits(git).filter(subject => subject.startsWith('todo:')).length
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  const key = 'todo:add a ctrl+q toggle'
  expect((await pane.find({ key }))?.props.label).toBe('[ ] Add a ctrl+q toggle')
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    await pane.press({ key })
    seen.push((fs[BOUND] ?? '').match(/- \[(.)\] Add/)?.[1] ?? '?')
  }
  expect(seen).toEqual(['~', 'x', '-', ' '])
  expect(commits(git).filter(subject => subject.startsWith('todo:'))).toHaveLength(launched + 4)

  // Clicked back to todo, it is the captain's; a sure reply that names it still moves it, and the log says so.
  await complete($, 'The ctrl+q toggle works.')
  await flush()
  expect(fs[BOUND]).toContain('- [x] Add a ctrl+q toggle')
  expect(fs[LOG]).toContain('| Add a ctrl+q toggle | todo -> done | laya finished 0.90 | replaced a hand-set status')
  await pane.unmount()
})

test('the todo list is the first block of the notes pane', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [x] Done one\n- [-] Dropped one') }
  engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'todo:done one' }))?.props).toMatchObject({ label: '[x] Done one' })
  expect((await pane.find({ key: 'todo:dropped one' }))?.props).toMatchObject({ label: '[-] Dropped one' })
  await pane.unmount()
})

function setTodoFile(body: string): string {
  return CAPTAIN_NOTES.replace('# Important', `# Todo\n\n${body}\n\n# Important`)
}
