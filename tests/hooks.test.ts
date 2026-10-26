import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HOME = '/home/me'
const ROOT = '/work/firstmate'
const DIR = `${HOME}/.notes-keeping`
const SESSION = 'abcdef12-3456-4789-8abc-def012345678'
const NOW = `${DIR}/2026-10-26-10-58-firstmate-abcdef12.md`

type Fs = Record<string, string>
type Git = { calls: string[][]; remotes: string }

function engine(
  on: On,
  fs: Fs,
  store: Record<string, unknown> = {},
  selection: () => string | undefined = () => undefined,
  head: { text: string } = { text: 'First prompt of the session' },
  session: { id: string } = { id: SESSION },
) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 26, 10, 58).getTime() })
  mock.store(on, store)
  mock.env(on, { HOME })
  const filled: string[] = []
  const git: Git = { calls: [], remotes: '' }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: session.id }))
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: [{ role: 'user', text: head.text, toolUses: [] }] }))
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
    git.calls.push([...e.argv])
    if (e.argv[3] === 'init') fs[`${DIR}/.git/HEAD`] = 'ref: refs/heads/main\n'
    const stdout = e.argv[3] === 'remote' ? git.remotes : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.selection', () => {
    const text = selection()
    return { value: text === undefined ? undefined : { text } }
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  return { filled, clock, git }
}

function run($: Engine, args: string) {
  return $.command.run({
    command: 'notes-keeping',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
}

test('init, update, important and reply write the session notes file and commit each write', async ($, on) => {
  const fs: Fs = {}
  const { filled, git } = engine(on, fs, {}, () => 'Agent says merge?')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })

  expect((await run($, 'init')).text).toBe(`Notes started: ${NOW}`)
  expect((await run($, 'init again')).text).toContain('already keeps')
  await run($, 'update Change of plan')
  await run($, 'important')
  await run($, 'important typed by me')
  expect((await run($, 'reply Merge it')).text).toBe('Added to # Chat and to the prompt box.')

  expect(fs[NOW]).toBe(
    [
      '# Initial Prompt',
      '',
      `Sessions: ${SESSION}`,
      '',
      'First prompt of the session',
      '',
      '## Updates',
      '',
      '[UPDATE] 2026-10-26-10-58',
      'Change of plan',
      '',
      '# Important',
      '',
      '[AI_AGENT] Agent says merge?',
      '',
      '[USER] typed by me',
      '',
      '# Chat',
      '',
      '[AI_AGENT] Agent says merge?',
      '[USER] Merge it',
      '',
    ].join('\n'),
  )
  expect(filled).toEqual(['[AI_AGENT] Agent says merge?\n[USER] Merge it\n'])

  const file = '2026-10-26-10-58-firstmate-abcdef12.md'
  expect(git.calls.filter(argv => argv[3] === 'commit').map(argv => argv[6])).toEqual([
    `init: ${file}`,
    `update: ${file}`,
    `important: ${file}`,
    `important: ${file}`,
    `reply: ${file}`,
  ])
  expect(git.calls.filter(argv => argv[3] === 'init')).toEqual([['git', '-C', DIR, 'init', '-q']])
  expect(git.calls.some(argv => argv.includes('push'))).toBe(false)
})

test('a write warns while the notes repository has a remote', async ($, on) => {
  const { git } = engine(on, {})
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  expect((await run($, 'init plan')).text).toBe(`Notes started: ${NOW}`)
  git.remotes = 'origin\n'
  expect((await run($, 'update more')).text).toBe(
    `Update kept under ## Updates.\nWarning: ${DIR} has a git remote (origin). notes-keeping never pushes, but a push would publish your notes.`,
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

test('after /clear the new session id keeps the notes file and is recorded in it', async ($, on) => {
  const fs: Fs = {}
  const session = { id: SESSION }
  const { git } = engine(on, fs, {}, undefined, undefined, session)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  session.id = 'fedcba98-0000-4000-8000-000000000000'
  expect((await run($, 'update after clear')).text).toBe('Update kept under ## Updates.')
  expect((await run($, 'init')).text).toContain(`already keeps ${NOW}`)
  expect(fs[NOW]).toContain(`Sessions: ${SESSION}, fedcba98-0000-4000-8000-000000000000\n\nPlan\n`)
  expect(fs[NOW]).toContain('after clear')
  expect(git.calls.filter(argv => argv[3] === 'commit').map(argv => argv[6])).toEqual([
    'init: 2026-10-26-10-58-firstmate-abcdef12.md',
    'session: 2026-10-26-10-58-firstmate-abcdef12.md',
    'update: 2026-10-26-10-58-firstmate-abcdef12.md',
  ])
})

test('a session that ends by exit hands nothing to the next id', async ($, on) => {
  const session = { id: SESSION }
  engine(on, {}, {}, undefined, undefined, session)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: { id: SESSION } })
  session.id = 'fedcba98-0000-4000-8000-000000000000'
  expect((await run($, 'update x')).text).toContain('no notes file for this session')
})

test('init --new starts a second file for the session', async ($, on) => {
  const fs: Fs = {}
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init one')
  expect((await run($, 'init --new two')).text).toBe(`Notes started: ${DIR}/2026-10-26-10-58-firstmate-abcdef12-2.md`)
  expect(fs[`${DIR}/2026-10-26-10-58-firstmate-abcdef12-2.md`]).toContain('\n\ntwo\n')
})

test('history lists earlier notes of every project newest first and continues the picked one whole', async ($, on) => {
  const old = `${DIR}/2026-10-24-09-00-firstmate-11111111.md`
  const fs: Fs = {
    [old]: '# Initial Prompt\n\nOld plan\n\n## Updates\n\n# Important\n\n[USER] old fact\n\n# Chat\n\n[AI_AGENT] q\n[USER] old chat\n',
    [`${DIR}/2026-10-25-18-30-dotfiles-22222222.md`]: '# Initial Prompt\n\nYesterday plan\n',
  }
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Today')

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
  expect(fs[NOW]?.startsWith(`# Initial Prompt\n\nContinuation of: 2026-10-24-09-00-firstmate-11111111.md\n\nSessions: ${SESSION}\n\nToday\n`)).toBe(true)
})

const NOTES = '# Initial Prompt\n\nThe plan\n\n## Updates\n\n[UPDATE] t\nnew goal\n\n# Important\n\n[USER] agreed X\n\n# Chat\n\n[AI_AGENT] q\n[USER] a\n'

function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

function submitting(on: On) {
  const sent: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.context)
    return { text: e.text }
  })
  return sent
}

test('the first prompt after a compaction carries the whole notes file, once', async ($, on) => {
  const path = `${DIR}/2026-10-26-10-50-firstmate-abcdef12.md`
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  engine(on, { [path]: NOTES }, { [`session:${SESSION}`]: path }, undefined, head)

  await submit($, 'one')
  await submit($, 'two')
  const summary = (body: string) => `This session is being continued from a previous conversation that ran out of context. ${'x'.repeat(300)} ${body}`
  head.text = summary('first summary')
  await submit($, 'three')
  await submit($, 'four')
  head.text = summary('second summary')
  await submit($, 'five')

  expect(sent.map(context => context?.length ?? 0)).toEqual([0, 0, 1, 0, 1])
  const notes = sent[2]?.[0] ?? ''
  expect(notes).toContain(`Session notes kept by notes-keeping: ${path}`)
  expect(notes).toContain(NOTES.trimEnd())
})

test('a session with no notes file gets no context after a compaction', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  engine(on, {}, {}, undefined, head)
  await submit($, 'one')
  head.text = 'summary'
  await submit($, 'two')
  expect(sent).toEqual([undefined, undefined])
})

const BAND = {
  plugin: 'notes-keeping',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('a selection raises the band; Important and Reply write the notes and the band goes away', async ($, on) => {
  const path = `${DIR}/2026-10-26-10-50-firstmate-abcdef12.md`
  const fs: Fs = { [path]: '# Initial Prompt\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n' }
  let selection: string | undefined
  const { filled, clock } = engine(on, fs, { [`session:${SESSION}`]: path }, () => selection)
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine') as RenderElement)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'important' })).toBeUndefined()
    await ui.unmount()
  }

  selection = 'Keep this fact'
  await clock.advance(700)
  const first = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await first.press({ key: 'important' })
  expect(fs[path]).toContain('# Important\n\n[AI_AGENT] Keep this fact\n\n# Chat')
  await clock.advance(700)
  expect(await first.find({ key: 'important' })).toBeUndefined()
  await first.unmount()

  selection = 'Shall I push?'
  await clock.advance(700)
  const second = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await second.press({ key: 'reply-open' })
  await second.input({ key: 'reply', text: 'Push now' })
  expect(fs[path]?.endsWith('# Chat\n\n[AI_AGENT] Shall I push?\n[USER] Push now\n')).toBe(true)
  expect(filled).toEqual(['[AI_AGENT] Shall I push?\n[USER] Push now\n'])
  await clock.advance(700)
  expect(await second.find({ key: 'reply' })).toBeUndefined()
  expect(await second.find({ key: 'reply-open' })).toBeUndefined()
  await second.unmount()

  selection = undefined
  await clock.advance(700)
  selection = 'Shall I push?'
  await clock.advance(700)
  const third = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await third.find({ key: 'reply-open' })).toBeDefined()
  await third.unmount()
})
