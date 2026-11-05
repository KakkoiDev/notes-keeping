import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { nextStatus } from '../hooks/todos'
import { context, idFor, items, pausedContext, withoutIds } from '../hooks/todo'
import { sections, stamp } from '../hooks/notes'

const HOME = '/home/me'
const ROOT = '/work/firstmate'
const DIR = `${HOME}/.notes-keeping`
const SESSION = 'abcdef12-3456-4789-8abc-def012345678'
const NEXT_ID = 'fedcba98-0000-4000-8000-000000000000'
const NOW = `${DIR}/2026-10-26-10-58-firstmate-abcdef12.md`
const FILE = '2026-10-26-10-58-firstmate-abcdef12.md'
const ACTION = 'app:cycleDiffBase'
const PYTHON = `${HOME}/.laya-venv/bin/python`

// An item line or its source line as written, with the id the plugin gives it; the text without ids, for assertions ids are not part of.
const tag = (text: string) => `${text} <!-- id:${idFor(text, new Set())} -->`
// The fake clock's time as a log row writes it, and a log row's item cell.
const UTC = new Date(2026, 9, 26, 10, 58).toISOString().replace(/\.\d{3}Z$/, 'Z')
// The same after one refresh tick.
const TICK = new Date(2026, 9, 26, 10, 58, 5).toISOString().replace(/\.\d{3}Z$/, 'Z')
const cell = (text: string) => `id:${idFor(text, new Set())} ${text}`
const logsOf = (md: string | undefined) => sections(md ?? '').logs.split('\n').filter(line => line !== '')
const bare = (text: string | undefined) => withoutIds(text ?? '')
// The note a reply to text selected in `row` carries in # Chat, the first in that row.
const anchor = (row: string, agent: string, user: string) => ` <!-- note:${idFor(`${row}\n${agent}\n${user}`, new Set())} row:${row} at:0 -->`

type Ask = { lines: { id: string; text: string }[]; statuses: { id: string; text: string }[]; answer: string }
const BRIDGE = `${ROOT}/config/notes-keeping-bridge`
// What the fake bridge reports for status, the change lines each notify sent, the updates pending hands out once, and each answer.
const bridge: {
  links: Record<string, { status: string | null; task: string; id?: string; by?: string; reason?: string }>
  notified: string[]
  calls: string[]
  argv: string[][]
  pending: { request: string; text: string; by: string; task: string }[]
  answers: { request: string; answer: unknown }[]
  fleet: { rows: Record<string, unknown>[]; calls: number }
  crew: string
} = { links: {}, notified: [], calls: [], argv: [], pending: [], answers: [], fleet: { rows: [], calls: 0 }, crew: '' }
// What the fake Laya answers; left undefined, the call fails.
const laya: { answer: ((ask: Ask) => unknown) | undefined; asks: Ask[] } = { answer: undefined, asks: [] }
// What the fake label model answers per prompt; left undefined, the call fails as an API error.
const model: { answer: ((prompt: string) => string) | undefined; asks: string[] } = { answer: undefined, asks: [] }
// What pbpaste prints; left undefined, the clipboard cannot be read.
const clipboard: { text: string | undefined } = { text: undefined }
// The environment past HOME, the commands spawned, what the fake editor writes into the file it opens, and the stderr it fails with.
const shell: { vars: Record<string, string>; spawned: string[][]; edit: ((text: string) => string) | undefined; error: string | undefined } = { vars: {}, spawned: [], edit: undefined, error: undefined }

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
  notices: { text: string; title: string | undefined }[]
  copied: string[]
}

function engine(
  on: On,
  fs: Fs,
  store: Record<string, unknown> = {},
  selection: () => string | { text: string } | undefined = () => undefined,
  head: { text: string } = { text: '' },
  session: { id: string } = { id: SESSION },
) {
  laya.answer = undefined
  laya.asks = []
  bridge.links = {}
  bridge.notified = []
  bridge.calls = []
  bridge.argv = []
  bridge.pending = []
  bridge.answers = []
  bridge.fleet = { rows: [], calls: 0 }
  bridge.crew = ''
  model.answer = undefined
  model.asks = []
  clipboard.text = undefined
  shell.spawned = []
  shell.edit = undefined
  shell.error = undefined
  const clock = mock.clock(on, { now: new Date(2026, 9, 26, 10, 58).getTime() })
  mock.store(on, store)
  mock.env(on, { HOME, ...shell.vars })
  shell.vars = {}
  const git: Git = { calls: [], remotes: '' }
  const ui: Ui = { panes: new Map(), shown: undefined, opened: [], closed: [], status: [], toasts: [], isPlaced: true, isFocusable: true, fills: [], isFillable: true, notices: [], copied: [] }
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
    if (e.argv[0] === 'pbpaste') {
      return { value: { exitCode: clipboard.text === undefined ? 1 : 0, stdout: clipboard.text ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === BRIDGE) {
      bridge.calls.push(e.argv[1] ?? '')
      bridge.argv.push([...e.argv])
      if (e.argv[1] === 'notify') bridge.notified.push(e.init?.stdin ?? '')
      if (e.argv[1] === 'answer') bridge.answers.push({ request: e.argv[2] ?? '', answer: JSON.parse(e.init?.stdin ?? '') })
      const stdout =
        e.argv[1] === 'status'
          ? JSON.stringify(bridge.links)
          : e.argv[1] === 'pending'
            ? JSON.stringify(bridge.pending.splice(0))
            : e.argv[1] === 'fleet'
              ? JSON.stringify(bridge.fleet)
              : e.argv[1] === 'crew'
                ? bridge.crew
                : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    git.calls.push([...e.argv])
    if (e.argv[3] === 'init') fs[`${DIR}/.git/HEAD`] = 'ref: refs/heads/main\n'
    const stdout = e.argv[3] === 'remote' ? git.remotes : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* (_$, e) {
    shell.spawned.push([...e.argv])
    const path = /'(.*)'(?::\d+)?$/.exec(e.argv.at(-1) ?? '')?.[1]
    if (shell.error !== undefined) {
      yield { stream: 'stderr' as const, text: shell.error }
      return { value: { code: 1, signal: null } }
    }
    if (path !== undefined && shell.edit !== undefined) fs[path] = shell.edit(fs[path] ?? '')
    return { value: { code: 0, signal: null } }
  })
  on('model.complete', (_$, e) => {
    model.asks.push(e.prompt)
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return {
      value:
        model.answer === undefined
          ? { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage }
          : { isAnswered: true as const, text: model.answer(e.prompt), usage },
    }
  })
  on('ui.selection', () => {
    const picked = selection()
    // A string lies in a transcript row; an object lies elsewhere (a pane, the prompt).
    return { value: picked === undefined ? undefined : typeof picked === 'string' ? { text: picked, requestId: 'row-1' } : { text: picked.text } }
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
  on('ui.notify', (_$, e) => {
    ui.notices.push({ text: e.text, title: e.title })
    return { value: { isSent: true as const, channel: 'terminal_bell' as const } }
  })
  on('ui.copy', (_$, e) => {
    ui.copied.push(e.text)
    return { value: { isCopied: true as const } }
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
      tag('Change of plan'),
      '',
      '[UPDATE] 2026-10-26-10-58',
      tag('Later goal'),
      '',
      '[UPDATE] 2026-10-26-10-58',
      tag('Via init'),
      '',
      '# Todo',
      '',
      `- [ ] ${tag('Change of plan')}`,
      `- [ ] ${tag('Later goal')}`,
      `- [ ] ${tag('Via init')}`,
      '',
      '# Important',
      '',
      '[AI_AGENT] Agent says merge?',
      '',
      '[USER] typed by me',
      '',
      '# Chat',
      '',
      '# Logs',
      '',
      `- ${UTC} | captain | objective | - | - | Plan the day`,
      `- ${UTC} | captain | update | - | - | Change of plan`,
      `- ${UTC} | captain | update | - | - | Later goal`,
      `- ${UTC} | plugin | added | ${cell('Change of plan')} | none -> todo`,
      `- ${UTC} | plugin | added | ${cell('Later goal')} | none -> todo`,
      `- ${UTC} | captain | update | - | - | Via init`,
      `- ${UTC} | plugin | added | ${cell('Via init')} | none -> todo`,
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

// $.fs.read rejects on a missing file: a binding to a deleted notes file failed every write, prompt and refresh.
test('a session bound to a notes file that was deleted starts a new one on its next write', async ($, on) => {
  const fs: Fs = {}
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: `${DIR}/2026-10-20-09-00-firstmate-abcdef12.md` })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  expect((await run($, 'important keep me')).text).toBe('Added to # Important.')
  expect(ui.toasts).toEqual([`Notes started: ${NOW}`])
  expect(fs[NOW]).toContain('[USER] keep me')
  await run($, 'important and me')
  expect(fs[NOW]).toContain('[USER] and me')
  expect(ui.toasts).toHaveLength(1)
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
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. Ctrl+q: edit, remove, send')

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
  expect(fs[NOW]?.endsWith(`# Chat\n\n[AI_AGENT] Shall I merge?${anchor('row-1', 'Shall I merge?', 'Merge it')}\n[USER] Merge it\n\n[USER] carry on\n`)).toBe(true)
  expect(ui.status.at(-1)).toBeUndefined()
  expect(commits(git)).toEqual([`init: ${FILE}`, `reply: ${FILE}`])
})

test('pasted text and the notes taken on it go out as one message with the next composer Enter, recorded in # Chat', async ($, on) => {
  const fs: Fs = {}
  const sent = submitting(on)
  const { git, ui } = engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'init Plan')

  expect((await run($, 'note too early')).text).toBe('Paste text first: /notes-keeping paste [--from <source>] <text>.')
  expect((await run($, 'paste --from Slack Can we ship Friday?\nQA is still open.')).text).toBe(
    'Pasted text queued (from Slack); add notes with /notes-keeping note <text>. It goes out with your next message.',
  )
  expect((await run($, 'note QA owner is out this week')).text).toBe('Note added to the pasted text.')
  await run($, 'note ask for the QA list')
  expect(ui.status.at(-1)).toBe('notes: 1 note on pasted text queued, sent with your next message. Ctrl+q: edit, remove, send')

  await submit($, 'what should I answer?')

  const block = '[PASTED from Slack]\nCan we ship Friday?\nQA is still open.\n[USER] QA owner is out this week\nask for the QA list'
  expect(sent.map(row => row.text)).toEqual([`${block}\n\nwhat should I answer?`])
  expect(fs[NOW]?.endsWith(`# Chat\n\n${block}\n\n[USER] what should I answer?\n`)).toBe(true)
  expect(commits(git)).toEqual([`init: ${FILE}`, `reply: ${FILE}`])
})

test('paste with no text takes the clipboard; s moves it with its note into the prompt', async ($, on) => {
  const fs: Fs = {}
  const { ui } = engine(on, fs)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  clipboard.text = 'Deploy is red\n'
  expect((await run($, 'paste')).text).toBe('Pasted text queued; add notes with /notes-keeping note <text>. It goes out with your next message.')
  clipboard.text = undefined
  expect((await run($, 'paste')).text).toBe('Nothing to paste: give text, or copy some first.')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:queue' })
  await pane.input({ key: 'reply:0', text: 'which deploy?' })
  await pane.press({ key: 'send' })
  expect(ui.fills.at(-1)).toEqual({ text: '[PASTED]\nDeploy is red\n[USER] which deploy?', mode: 'insert' })
  await pane.unmount()
})

test('the n pane: pasted text stays; a selection in it opens the note box, the noted part is highlighted, the notes go out as queued notes, then the highlights clear; x clears the text', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n' }
  let selection: string | { text: string } | undefined
  const sent = submitting(on)
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:paste' }))?.props).toMatchObject({ hotkey: 'n' })
  await pane.press({ key: 'view:paste' })
  expect((await pane.find({ key: 'paste:text' }))?.props).toMatchObject({ autoFocus: true })
  await pane.input({ key: 'paste:text', text: 'Can we ship Friday?\nQA is still open.' })
  expect(await pane.find({ key: 'paste:text' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Can we ship Friday?' })).toBeDefined()

  selection = { text: 'QA is still open.' }
  await clock.advance(1800)
  expect(ui.shown).toBe('notes-keeping-select')
  const box = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  expect((await box.find({ key: 'reply' }))?.props.autoFocus).toBe(true)
  await box.input({ key: 'reply', text: 'who owns QA?' })
  await box.unmount()
  expect(ui.shown).toBe('notes-keeping')
  expect(ui.status.at(-1)).toBe('notes: 1 note on pasted text queued, sent with your next message. Ctrl+q: edit, remove, send')
  const marks = async () => (await pane.findAll({ type: 'Text', text: 'QA is still open.' })).filter(one => one.props.inverse === true)
  expect(await marks()).toHaveLength(1)
  await clock.advance(1200)

  selection = { text: 'Can we ship Friday?' }
  await clock.advance(1800)
  expect(ui.shown).toBe('notes-keeping-select')
  hostClose(ui, 'notes-keeping-select')
  await clock.advance(1200)
  expect(ui.shown).toBe('notes-keeping')
  expect(await marks()).toHaveLength(1)

  selection = undefined
  await submit($, 'what should I answer?')
  expect(sent.map(row => row.text)).toEqual(['[PASTED]\nQA is still open.\n[USER] who owns QA?\n\nwhat should I answer?'])
  expect(await pane.find({ type: 'Text', text: 'Can we ship Friday?' })).toBeDefined()
  expect(await marks()).toHaveLength(0)

  expect((await pane.find({ key: 'paste:clear' }))?.props).toMatchObject({ hotkey: 'x' })
  await pane.press({ key: 'paste:clear' })
  expect(await pane.find({ type: 'Text', text: 'Can we ship Friday?' })).toBeUndefined()
  expect(await pane.find({ key: 'paste:text' })).toBeDefined()
  await pane.unmount()
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
  const before = '# Initial Prompt\n\nOld plan\nA deleted line\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] shipped\n- [~] old change\n\n# Important\n\n[USER] old fact\n\n# Chat\n\n[AI_AGENT] q\n[USER] old chat\n'
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
  expect(bare(fs[NOW]).startsWith(`# Objectives\n\nContinuation of: 2026-10-24-09-00-firstmate-11111111.md\n\nSessions: ${SESSION}\n\nOld plan\nA deleted line\n\nToday plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [~] old change\n\n# Important`)).toBe(true)
  expect(fs[NOW]).not.toContain('shipped')
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

test('the panel History view lists other notes newest first; Enter previews one read-only, a asks before attaching, Enter alone never attaches', async ($, on) => {
  const old = `${DIR}/2026-10-24-09-00-firstmate-11111111.md`
  const newer = `${DIR}/2026-10-25-18-30-dotfiles-22222222.md`
  const before = '# Objectives\n\nOld plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] shipped\n- [-] dropped\n- [~] old change\n- [ ] not yet\n\n# Important\n\n[USER] old fact\n\n# Chat\n'
  const writes: string[] = []
  const fs: Fs = new Proxy<Fs>(
    { [BOUND]: NOTES, [old]: before, [newer]: '# Objectives\n\nYesterday plan\n' },
    { set: (target, path, text) => (writes.push(String(path)), Reflect.set(target, path, text)) },
  )
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:history' }))?.props).toMatchObject({ hotkey: 'h', label: 'History' })
  await pane.press({ key: 'view:history' })
  const first = await pane.find({ key: 'note:2026-10-25-18-30-dotfiles-22222222.md' })
  expect(first?.props.label).toBe('2026-10-25 18:30  dotfiles  22222222  Yesterday plan')
  expect(first?.props.autoFocus).toBe(true)
  expect(await pane.find({ key: 'note:2026-10-26-10-50-firstmate-abcdef12.md' })).toBeUndefined()

  await flush()
  const kept = fs[BOUND]
  await pane.press({ key: 'attach' })
  expect(ui.toasts.at(-1)).toContain('Select a note first')

  await pane.press({ key: 'note:2026-10-24-09-00-firstmate-11111111.md' })
  expect(fs[BOUND]).toBe(kept)
  expect(await pane.find({ type: 'Text', text: 'Old plan' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^- \[x\] shipped\n- \[-\] dropped/ })).toBeDefined()
  expect((await pane.find({ key: 'attach' }))?.props).toMatchObject({ hotkey: 'a' })

  await pane.press({ key: 'attach' })
  expect(fs[BOUND]).toBe(kept)
  expect(await pane.find({ type: 'Text', text: /^Attach 2026-10-24-09-00-firstmate-11111111.md\?/ })).toBeDefined()
  expect((await pane.find({ key: 'confirm' }))?.props).toMatchObject({ hotkey: 'y' })
  expect((await pane.find({ key: 'cancel' }))?.props).toMatchObject({ hotkey: 'n', autoFocus: true })

  await pane.press({ key: 'cancel' })
  expect(fs[BOUND]).toBe(kept)
  expect(await pane.find({ key: 'confirm' })).toBeUndefined()
  await pane.press({ key: 'view:back' })
  await pane.press({ key: 'attach' })
  expect(await pane.find({ key: 'confirm' })).toBeDefined()

  await pane.press({ key: 'confirm' })
  expect(fs[old]).toBe(before)
  expect(writes).not.toContain(old)
  expect(fs[BOUND]).toContain('Continuation of: 2026-10-24-09-00-firstmate-11111111.md')
  expect(fs[BOUND]).toContain('Old plan')
  expect(fs[BOUND]).toContain('[UPDATE] 2026-10-24-10-00\nold change')
  expect(fs[BOUND]).toContain('- [~] old change')
  expect(fs[BOUND]).toContain('- [ ] not yet')
  expect(fs[BOUND]).not.toContain('shipped')
  expect(fs[BOUND]).not.toContain('dropped')
  expect(fs[BOUND]).toContain('The plan')
  expect(ui.toasts.at(-1)).toContain('the original is unchanged')
  expect(logsOf(fs[BOUND]).slice(-3)).toEqual([
    `- ${UTC} | captain | attach | - | - | 2026-10-24-09-00-firstmate-11111111.md`,
    `- ${UTC} | captain | added | ${cell('old change')} | none -> in-progress | copied from 2026-10-24-09-00-firstmate-11111111.md`,
    `- ${UTC} | captain | added | ${cell('not yet')} | none -> todo | copied from 2026-10-24-09-00-firstmate-11111111.md`,
  ])
  await pane.unmount()
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

test('every prompt, the one after a compaction too, lists the paused items with their reasons and asks for them to be re-evaluated', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  const body = '- [ ] Open one\n- [/] Parked one <!-- paused:the review lane comes first --> <!-- id:ab12cd3 -->'
  engine(on, { [BOUND]: NOTES.replace('# Important', `# Todo\n\n${body}\n\n# Important`) }, { [`session:${SESSION}`]: BOUND }, undefined, head)
  await submit($, 'one')
  head.text = `This session is being continued from a previous conversation that ran out of context. ${'x'.repeat(300)} summary`
  await submit($, 'two')
  await submit($, 'three')
  const paused = pausedContext(body) ?? 'missing'
  expect(paused).toContain('- [/] Parked one (paused: the review lane comes first)')
  for (const row of sent) expect((row.context ?? []).join('\n')).toContain(paused)
  expect(sent[1]?.context?.[0]).toContain(`Session notes kept by notes-keeping: ${BOUND}`)
  expect(sent[1]?.context?.[1]).toBe(paused)
  expect(sent[2]?.context?.[0]).toContain('- [ ] Open one')
})

test('a session continued with claude -c carries the notes on its first prompt, once', async ($, on) => {
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, { text: 'Earlier prompt' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await submit($, 'back again')
  await submit($, 'and more')
  expect(sent.map(row => row.context?.length ?? 0)).toEqual([1, 1])
  expect(bare(sent[0]?.context?.[0])).toContain(NOTES.replace('# Important', '# Todo\n\n- [ ] new goal\n\n# Important').trimEnd())
  expect(sent[1]?.context?.[0]).toContain('- [ ] new goal')
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

// Live, the first prompt of a session reads an empty transcript: its own message is not in it yet.
test('the second prompt of a fresh session, the first one the transcript holds, gets no whole notes file', async ($, on) => {
  const head = { text: '' }
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, head)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await submit($, 'one')
  head.text = 'one'
  await submit($, 'two')
  await submit($, 'three')
  expect(sent.map(row => (row.context ?? []).some(text => text.startsWith('Session notes kept by notes-keeping')))).toEqual([false, false, false])
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

const OLDER = `${DIR}/2026-10-23-08-00-firstmate-00000000.md`
const OLD = `${DIR}/2026-10-24-09-00-firstmate-11111111.md`
const OLD_NOTES = '# Objectives\n\nContinuation of: 2026-10-23-08-00-firstmate-00000000.md\n\nOld plan\n\n## Updates\n\n[UPDATE] 2026-10-24-10-00\nold change\n\n# Todo\n\n- [x] shipped\n- [-] dropped\n- [ ] not yet\n\n# Important\n\n[USER] old fact\n\n# Chat\n\n[AI_AGENT] old question\n[USER] old answer\n'

// Attaches OLD through the History view of the panel (h, pick it, a, y) in a fresh session, not a resumed one.
async function attachInPane($: Engine, on: On, fs: Fs, head: { text: string }) {
  const first = head.text
  head.text = ''
  engine(on, fs, { [`session:${SESSION}`]: BOUND }, undefined, head)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  head.text = first
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:history' })
  await pane.press({ key: `note:${OLD.split('/').pop()}` })
  await pane.press({ key: 'attach' })
  await pane.press({ key: 'confirm' })
  await pane.unmount()
}

test('the prompt after an attach from the panel carries the attached file whole, labeled as the previous notes, once', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  const fs: Fs = { [BOUND]: NOTES, [OLD]: OLD_NOTES, [OLDER]: '# Objectives\n\nOlder plan\n' }
  await attachInPane($, on, fs, head)
  await submit($, 'one')
  await submit($, 'two')

  const first = sent[0]?.context ?? []
  const previous = first.find(text => text.includes(OLD_NOTES.trimEnd()))
  expect(previous).toBeDefined()
  expect(previous?.startsWith(`Previous session's notes, attached to this session's notes as Continuation of: ${OLD}`)).toBe(true)
  expect(first.join('\n')).not.toContain('Older plan')
  expect((sent[1]?.context ?? []).join('\n')).not.toContain('old answer')
  expect(fs[OLD]).toBe(OLD_NOTES)
})

test('after a compaction the prompt carries the attached file again while the notes still continue it', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  const fs: Fs = { [BOUND]: NOTES, [OLD]: OLD_NOTES, [OLDER]: '# Objectives\n\nOlder plan\n' }
  await attachInPane($, on, fs, head)
  await submit($, 'one')
  await submit($, 'two')
  head.text = `This session is being continued from a previous conversation that ran out of context. ${'x'.repeat(300)} summary`
  await submit($, 'three')
  await submit($, 'four')
  fs[BOUND] = (fs[BOUND] ?? '').replace(/Continuation of: .*\n\n/, '')
  head.text = `${head.text} again`
  await submit($, 'five')

  const carries = (i: number) => (sent[i]?.context ?? []).some(text => text.includes('[USER] old answer'))
  expect([0, 1, 2, 3, 4].map(carries)).toEqual([true, false, true, false, false])
  const after = (sent[2]?.context ?? []).join('\n')
  expect(after).toContain(`Session notes kept by notes-keeping: ${BOUND}`)
  expect(after).toContain(`Previous session's notes, attached to this session's notes as Continuation of: ${OLD}`)
  expect(after).not.toContain('Older plan')
})

// Claude Code 2.1.312 keeps the rows from before a compaction in session.messages(): the first message does not change.
test('a compaction of the main conversation makes the next prompt carry the whole notes file and the attached one, once; a skipped, precomputed or subagent one does not', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  const fs: Fs = { [BOUND]: NOTES, [OLD]: OLD_NOTES }
  const compacting = { skip: undefined as string | undefined }
  on('session.compact', (_$, e) => (compacting.skip === undefined ? { messages: e.messages } : { skip: compacting.skip }))
  await attachInPane($, on, fs, head)
  await submit($, 'one')
  await submit($, 'two')
  const compact = (input: { trigger?: 'manual' | 'precompute'; agentId?: string } = {}) => $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'one', toolUses: [] }], ...input })
  await compact()
  await submit($, 'three')
  await submit($, 'four')
  compacting.skip = 'nothing to compact'
  await compact()
  await submit($, 'five')
  compacting.skip = undefined
  await compact({ trigger: 'precompute' })
  await compact({ agentId: 'agent-1' })
  await submit($, 'six')

  const whole = (i: number) => (sent[i]?.context ?? []).some(text => text.startsWith(`Session notes kept by notes-keeping: ${BOUND}`))
  const previous = (i: number) => (sent[i]?.context ?? []).some(text => text.includes('[USER] old answer'))
  expect([0, 1, 2, 3, 4, 5].map(whole)).toEqual([false, false, true, false, false, false])
  expect([0, 1, 2, 3, 4, 5].map(previous)).toEqual([true, false, true, false, false, false])
})

test('a Continuation of: line edited to name a file that is not a notes file puts nothing of it in context', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  const secret = `${HOME}/.ssh/id_rsa`
  const fs: Fs = { [BOUND]: NOTES.replace('The plan', 'Continuation of: ../.ssh/id_rsa\n\nThe plan'), [secret]: 'PRIVATE KEY' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND }, undefined, head)
  await submit($, 'one')
  head.text = 'summary'
  await submit($, 'two')
  expect(sent[1]?.context?.[0]).toContain('Continuation of: ../.ssh/id_rsa')
  expect(sent.flatMap(row => row.context ?? []).join('\n')).not.toContain('PRIVATE KEY')
})

test('with nothing attached no prompt carries previous notes, before or after a compaction', async ($, on) => {
  const head = { text: 'First prompt of the session' }
  const sent = submitting(on)
  engine(on, { [BOUND]: NOTES, [OLD]: OLD_NOTES }, { [`session:${SESSION}`]: BOUND }, undefined, head)
  await submit($, 'one')
  head.text = 'summary'
  await submit($, 'two')
  expect(sent.flatMap(row => row.context ?? []).join('\n')).not.toContain('Previous session')
  expect(sent.flatMap(row => row.context ?? []).join('\n')).not.toContain('old answer')
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

// Esc and the close mark are the host's close: the pane is gone without the mod having asked.
function hostClose(ui: ReturnType<typeof engine>['ui'], id: string) {
  ui.panes.delete(id)
  if (ui.shown === id) ui.shown = ui.panes.keys().next().value
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
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. Ctrl+q: edit, remove, send')
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

test('text selected inside the notes panel does not open the reply menu; text selected in the chat while it is open does', async ($, on) => {
  let selection: string | { text: string } | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run($, 'show')
  selection = { text: 'new goal' }
  await clock.advance(2400)
  expect(ui.opened.filter(open => open.id === 'notes-keeping-select')).toEqual([])
  selection = 'Keep this fact'
  await clock.advance(1800)
  expect(ui.opened.filter(open => open.id === 'notes-keeping-select')).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('after the reply box is left for the Notes tab, a new selection in the chat opens the menu again', async ($, on) => {
  let selection: string | { text: string } | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  await clock.advance(600)
  await run($, 'show')
  // The person clicks the Notes tab: it is shown and takes the keyboard; the reply box waits behind it.
  ui.shown = 'notes-keeping'
  ui.panes.set('notes-keeping', { isFocused: true })
  ui.panes.set('notes-keeping-select', { isFocused: false })
  const opens = ui.opened.length
  selection = 'bravo'
  await clock.advance(1800)
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping-select', focus: true }])
  expect(ui.shown).toBe('notes-keeping-select')
})

test('a click in the chat that selects a word while the reply box is open closes it and opens the menu for the new word', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  await clock.advance(1200)
  const opens = ui.opened.length
  ui.panes.set('notes-keeping-select', { isFocused: false })
  selection = 'bravo'
  await clock.advance(3000)
  expect(ui.closed).toEqual(['notes-keeping-select'])
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('Esc or the close mark on the menu, or on the reply box with or without a draft, leaves the next selection able to open the menu', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const picks = ['alpha', 'bravo', 'charlie']
  for (const [index, pick] of picks.entries()) {
    const before = ui.opened.length
    selection = pick
    await clock.advance(1800)
    expect(ui.opened.slice(before)).toEqual([{ id: 'notes-keeping-select', focus: true }])
    if (index > 0) {
      const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
      await menu.press({ key: 'reply-open' })
      await menu.unmount()
      await clock.advance(600)
    }
    hostClose(ui, 'notes-keeping-select')
    selection = undefined
    await clock.advance(1200)
  }
  selection = 'delta'
  await clock.advance(1800)
  expect(ui.panes.has('notes-keeping-select')).toBe(true)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  expect(await menu.find({ key: 'reply-open' })).toBeDefined()
  await menu.unmount()
})

// Mid-turn the terminal keeps the selection through Esc; a drag over the same text reads its shorter runs first.
test('after Esc on the reply box, selecting the same text again by a drag opens the menu', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'loopback jitter'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  await clock.advance(600)
  hostClose(ui, 'notes-keeping-select')
  await clock.advance(1200)
  const opens = ui.opened.length
  clipboard.text = 'loopback jitter'
  for (const run of ['lo', 'loopback', 'loopback jitte', 'loopback jitter']) {
    selection = run
    await clock.advance(600)
  }
  await clock.advance(600)
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('a reply box that never held the keyboard and is gone without a close event leaves the next selection able to open the menu', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  // A draft in the prompt keeps the keyboard: the reply box opens without it.
  ui.isFocusable = false
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  await clock.advance(1200)
  // The engine drops the pane with no ui.close hook run, as an unload does.
  ui.panes.delete('notes-keeping-select')
  ui.shown = undefined
  ui.isFocusable = true
  const opens = ui.opened.length
  selection = 'bravo'
  await clock.advance(1800)
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping-select', focus: true }])
  const shown = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  expect(await shown.find({ key: 'reply-open' })).toBeDefined()
  await shown.unmount()
})

test('the Ctrl+q chord with the reply box open leaves the reply box behind the Notes tab; the next selection replaces both', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  selection = 'alpha'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  await clock.advance(600)
  await run($, 'show')
  expect([...ui.panes.keys()]).toEqual(['notes-keeping-select', 'notes-keeping'])
  ui.panes.set('notes-keeping-select', { isFocused: false })
  selection = 'bravo'
  await clock.advance(3000)
  const shown = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  expect(await shown.find({ key: 'reply-open' })).toBeDefined()
  expect(ui.panes.has('notes-keeping')).toBe(false)
  await shown.unmount()
})

test('Esc on the Notes panel and the chord toggle leave the next selection able to open the menu', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run($, 'show')
  hostClose(ui, 'notes-keeping')
  selection = 'alpha'
  await clock.advance(1800)
  expect(ui.opened.filter(open => open.id === 'notes-keeping-select')).toHaveLength(1)
  hostClose(ui, 'notes-keeping-select')
  selection = undefined
  await clock.advance(1200)
  await run($, 'show')
  await run($, 'hide')
  selection = 'bravo'
  await clock.advance(1800)
  expect(ui.opened.filter(open => open.id === 'notes-keeping-select')).toHaveLength(2)
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

// The engine copies a mouse selection to the clipboard when the button comes up; a held button has copied nothing yet.
test('a selection held still with the mouse button down opens nothing; the pane opens once the release copies it', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  clipboard.text = 'copied earlier'
  selection = 'alpha bravo'
  await clock.advance(2400)
  expect(ui.opened).toEqual([])
  clipboard.text = 'alpha bravo\n'
  await clock.advance(600)
  expect(ui.opened).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('with copy on select off the clipboard never takes the selection: a still selection opens the pane after three seconds', async ($, on) => {
  let selection: string | undefined
  const { clock, ui } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  clipboard.text = 'copied earlier'
  selection = 'alpha bravo'
  await clock.advance(3000)
  expect(ui.opened).toEqual([])
  await clock.advance(1200)
  expect(ui.opened).toEqual([{ id: 'notes-keeping-select', focus: true }])
})

test('debug says how often the selection poll ran, when it last ran, and why the recent selections opened no pane', async ($, on) => {
  let selection: string | undefined
  const { clock } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => selection)
  expect((await run($, 'debug')).text).toContain('poll: 0 ticks, never ran')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.advance(1200)
  selection = 'alpha bravo'
  await clock.advance(600)
  clipboard.text = 'copied earlier'
  await clock.advance(600)
  const text = (await run($, 'debug')).text ?? ''
  expect(text).toContain('poll: 4 ticks, last 0.0 s ago, every 600 ms')
  expect(text).toContain('selection now: "alpha bravo" in row row-1')
  expect(text).toContain('select: none; handled: ""')
  expect(text.split('\n').slice(-3)).toEqual([
    '  1.2 s ago: no selection',
    '  0.6 s ago: still changing: alpha bravo',
    '  0.0 s ago: held, the clipboard has not taken it: alpha bravo',
  ])
})

test('debug records a poll that threw, with the error', async ($, on) => {
  let isBroken = false
  const { clock } = engine(on, { [BOUND]: NOTES }, { [`session:${SESSION}`]: BOUND }, () => {
    if (isBroken) throw new Error('selection refused')
    return undefined
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  isBroken = true
  await clock.advance(600)
  isBroken = false
  expect((await run($, 'debug')).text?.split('\n').slice(-2)).toEqual(['  0.6 s ago: no selection', '  0.0 s ago: error: no implementation for ui.selection'])
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

// The terminal keeps the selection where it was on screen: once the dock narrows the transcript, the same rows hold other text.
const PICKED = 'Jev disagreement (effort-level)\n- Fix: remove effort-level from the authority list.'
const REFLOWED = '- Right steps the status forward: todo, in progress, done, declined.\n  - Left steps it back.'

test('the reply quotes the text selected, not the text the opened dock reflows under the kept selection', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  const sent = submitting(on)
  let selection = PICKED
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.advance(1200)
  // The reflow reaches the selection after the open has resolved, before the next poll.
  selection = REFLOWED
  await clock.advance(3000)
  expect(ui.opened).toEqual([{ id: 'notes-keeping-select', focus: true }])
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.unmount()
  const box = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await box.input({ key: 'reply', text: 'ok' })
  await box.unmount()
  await submit($, 'next')
  expect(sent.at(-1)?.text).toBe(`[AI_AGENT] ${PICKED}\n[USER] ok\n\nnext`)
  expect(fs[BOUND]?.endsWith(`[USER] a\n\n[AI_AGENT] ${PICKED}${anchor('row-1', PICKED, 'ok')}\n[USER] ok\n\n[USER] next\n`)).toBe(true)
})

test('with a draft in the prompt the unfocused pane also keeps the text selected through the reflow', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => (ui.panes.has('notes-keeping-select') ? REFLOWED : PICKED))
  ui.isFocusable = false
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.advance(1200)
  await clock.advance(3000)
  expect(ui.opened).toHaveLength(1)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'important' })
  await menu.unmount()
  expect(fs[BOUND]).toContain(`[USER] agreed X\n\n[AI_AGENT] ${PICKED}\n\n# Chat`)
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
  expect(bare(fs[NOW])).toContain('## Updates\n\n[UPDATE] 2026-10-26-10-58\nThen this\n')
  await pane.unmount()
})


test('e in the objectives view opens the notes file in $EDITOR in a tmux popup, then shows and commits what it saved', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { git } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.edit = text => text.replace('The plan', 'The new plan')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  expect((await pane.find({ key: 'editor' }))?.props).toMatchObject({ hotkey: 'e', label: 'Open in editor' })
  expect(await pane.find({ type: 'Text', text: 'u adds an update under Updates, Enter keeps it, e opens the notes file in your editor, b goes back' })).toBeDefined()
  await pane.press({ key: 'editor' })
  await flush()
  expect(shell.spawned).toEqual([['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', `hx '${BOUND}'`]])
  expect(await pane.find({ type: 'Text', text: 'The new plan' })).toBeDefined()
  expect(commits(git).at(-1)).toBe('editor: 2026-10-26-10-50-firstmate-abcdef12.md')
  await pane.unmount()
})

test('an [UPDATE] written in the editor becomes a todo item when the editor closes', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.edit = text => text.replace('# Todo', '[UPDATE] 2026-10-29\nVoice audio input investigation\n\n# Todo')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(bare(fs[BOUND])).toContain('[UPDATE] 2026-10-29\nVoice audio input investigation')
  expect(items(sections(fs[BOUND] ?? '').todo).map(item => item.text)).toContain('Voice audio input investigation')
  await pane.unmount()
})

test('an [UPDATE] left empty in the editor is reported and makes no todo item', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.edit = text => text.replace('# Todo', '[UPDATE] 2026-10-29\n\n# Todo')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(bare(fs[BOUND])).toContain('[UPDATE] 2026-10-29\n\n# Todo')
  expect(ui.toasts).toContain('notes-keeping: [UPDATE] 2026-10-29 has no text; no todo item is made from it.')
  expect(items(sections(fs[BOUND] ?? '').todo).map(item => item.text)).toEqual(['new goal'])
  await pane.unmount()
})

test('e prefers $VISUAL over $EDITOR, and quotes a path holding a quote', async ($, on) => {
  const path = `${DIR}/it's.md`
  const fs: Fs = { [path]: NOTES }
  shell.vars = { VISUAL: 'code -w', EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  engine(on, fs, { [`session:${SESSION}`]: path })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(shell.spawned.map(argv => argv.at(-1))).toEqual([`code -w '${DIR}/it'\\''s.md'`])
  await pane.unmount()
})

test('e says so when the tmux popup fails', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.error = 'unknown command: display-popup\n'
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(ui.toasts.at(-1)).toBe('notes-keeping: the editor popup failed: unknown command: display-popup')
  await pane.unmount()
})

test('e outside tmux says why and opens nothing', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx' }
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(ui.toasts.at(-1)).toBe('notes-keeping: e opens the editor in a tmux popup; this session runs outside tmux.')
  expect(shell.spawned).toEqual([])
  await pane.unmount()
})

test('e with neither $VISUAL nor $EDITOR set says so and opens nothing', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { TMUX: '/tmp/tmux-1/default,1,0' }
  const { ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(ui.toasts.at(-1)).toBe('notes-keeping: set $VISUAL or $EDITOR to open the notes file in your editor.')
  expect(shell.spawned).toEqual([])
  await pane.unmount()
})

test('e from the update box opens the editor on a new [UPDATE] section holding what the box had, and keeps it', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { git } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  const seen: string[] = []
  shell.edit = text => {
    seen.push(text)
    return text.replace('half a thought', 'half a thought, finished')
  }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  expect((await pane.find({ key: 'editor' }))?.props.action).toBeUndefined()
  await pane.press({ key: 'objectives' })
  await pane.input({ key: 'objectives', text: 'half a thought', kind: 'change' })
  expect((await pane.find({ key: 'editor' }))?.props).toMatchObject({ hotkey: 'e', action: 'app:toggleDiffNoiseFilter' })
  expect(await pane.find({ type: 'Text', text: 'Enter keeps it, ctrl+e writes it in your editor' })).toBeDefined()
  await pane.press({ key: 'editor' })
  await flush()
  expect(shell.spawned).toEqual([['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', `hx '${BOUND}':11`]])
  expect(seen.map(bare)).toEqual([expect.stringContaining('## Updates\n\n[UPDATE] t\nnew goal\n\n[UPDATE] 2026-10-26-10-58\nhalf a thought\n\n#')])
  expect(bare(fs[BOUND])).toContain('new goal\n\n[UPDATE] 2026-10-26-10-58\nhalf a thought, finished\n\n#')
  expect((await pane.find({ key: 'objectives' }))?.type).toBe('Button')
  expect(commits(git)).toContain('update: 2026-10-26-10-50-firstmate-abcdef12.md')
  await pane.unmount()
})

test('e from an empty update box keeps the section the editor wrote into', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.edit = text => text.replace('[UPDATE] 2026-10-26-10-58\n', '[UPDATE] 2026-10-26-10-58\nwritten in hx\n')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(shell.spawned.map(argv => argv.at(-1))).toEqual([`hx '${BOUND}':11`])
  expect(bare(fs[BOUND])).toContain('new goal\n\n[UPDATE] 2026-10-26-10-58\nwritten in hx\n\n#')
  expect(items(sections(fs[BOUND] ?? '').todo).map(item => item.text)).toContain('written in hx')
  await pane.unmount()
})

test('e from an empty update box drops the section when the editor leaves it empty, and keeps other edits', async ($, on) => {
  const fs: Fs = { [BOUND]: NOTES }
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { git } = engine(on, fs, { [`session:${SESSION}`]: BOUND })
  shell.edit = text => text.replace('The plan', 'The new plan')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(fs[BOUND]).toContain('The new plan')
  expect(fs[BOUND]).not.toContain('[UPDATE] 2026-10-26-10-58')
  expect(bare(fs[BOUND])).toContain('## Updates\n\n[UPDATE] t\nnew goal\n\n#')
  expect(commits(git).at(-1)).toBe('editor: 2026-10-26-10-50-firstmate-abcdef12.md')
  await pane.unmount()
})

for (const [editor, argv, said] of [
  ['nvim', `nvim +11 '${BOUND}'`, 'puts the line as +N for vim'],
  ['code -w', `code -w '${BOUND}'`, 'leaves the line off for an editor it does not know'],
] as const) {
  test(`e from the update box ${said}`, async ($, on) => {
    const fs: Fs = { [BOUND]: NOTES }
    shell.vars = { EDITOR: editor, TMUX: '/tmp/tmux-1/default,1,0' }
    engine(on, fs, { [`session:${SESSION}`]: BOUND })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
    await run($, 'show')
    const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
    await pane.press({ key: 'view:objectives' })
    await pane.press({ key: 'objectives' })
    await pane.press({ key: 'editor' })
    await flush()
    expect(shell.spawned.map(argv => argv.at(-1))).toEqual([argv])
    await pane.unmount()
  })
}

test('e from the box that sets the objectives opens the file as it is', async ($, on) => {
  const fs: Fs = {}
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  engine(on, fs)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:objectives' })
  await pane.press({ key: 'objectives' })
  await pane.press({ key: 'editor' })
  await flush()
  expect(shell.spawned.map(argv => argv.at(-1))).toEqual([`hx '${NOW}'`])
  expect(fs[NOW]).not.toContain('[UPDATE]')
  await pane.unmount()
})

test('the panel opens on the Todos view, t brings it back, and the other views carry no todo list', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nSessions: s\n\nShip it\n\n## Updates\n\n# Todo\n\n- [ ] Ship it\n\n# Important\n\n[AI_AGENT] a fact\n\n# Chat\n\n[USER] hello\n' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: 'Todo' })).toBeDefined()
  expect((await pane.find({ key: 'todo:ship it' }))?.props.label).toBe('[ ]')
  expect((await pane.find({ key: 'open:ship it' }))?.props.label).toBe('Ship it')
  expect((await pane.find({ key: 'view:todos' }))?.props).toMatchObject({ hotkey: 't', dimColor: false })
  expect((await pane.findAll({ type: 'Button' })).map(button => button.key)).toEqual([
    'view:todos',
    'view:paste',
    'view:objectives',
    'view:important',
    'view:chat',
    'view:queue',
    'view:history',
    'view:logs',
    'send',
    'show:todo',
    'show:in-progress',
    'show:done',
    'show:declined',
    'show:blocked',
    'show:paused',
    'todo:ship it',
    'open:ship it',
    'select:down',
    'select:up',
    'status:next',
    'status:prev',
    'item:open',
    'item:pause',
  ])
  expect(await pane.find({ type: 'Text', text: 't todos, n paste, o objectives (u adds an update there), i important, c chat, q queue, h history, l logs, s send queue, Esc closes' })).toBeDefined()
  for (const at of ['view:objectives', 'view:important', 'view:chat', 'view:queue', 'view:logs']) {
    await pane.press({ key: at })
    expect(await pane.find({ key: 'todo:ship it' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Todo' })).toBeUndefined()
  }
  await pane.press({ key: 'view:important' })
  expect(await pane.find({ type: 'Text', text: '[AI_AGENT] a fact' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[USER] hello' })).toBeUndefined()
  await pane.press({ key: 'view:chat' })
  expect(await pane.find({ type: 'Text', text: '[USER] hello' })).toBeDefined()
  await pane.press({ key: 'view:todos' })
  expect((await pane.find({ key: 'todo:ship it' }))?.props.label).toBe('[ ]')
  await pane.press({ key: 'view:chat' })
  expect((await pane.find({ key: 'view:back' }))?.props).toMatchObject({ hotkey: 'b' })
  await pane.press({ key: 'view:back' })
  expect(await pane.find({ key: 'view:back' })).toBeUndefined()
  expect(await pane.find({ key: 'todo:ship it' })).toBeDefined()
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
  expect((await pane.find({ key: 'view:queue' }))?.props).toMatchObject({ hotkey: 'q', label: 'Queue (2)' })
  expect((await pane.find({ key: 'reply:0' }))?.props).toMatchObject({ value: 'one' })
  expect((await pane.find({ key: 'reply:1' }))?.props).toMatchObject({ value: 'two' })
  await pane.input({ key: 'reply:1', text: 'two, reworded' })
  expect((await pane.find({ key: 'reply:1' }))?.props).toMatchObject({ value: 'two, reworded' })
  await pane.press({ key: 'remove:0' })
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. Ctrl+q: edit, remove, send')
  expect((await pane.find({ key: 'reply:0' }))?.props).toMatchObject({ value: 'two, reworded' })
  expect(await pane.find({ key: 'reply:1' })).toBeUndefined()
  expect((await pane.find({ key: 'send' }))?.props).toMatchObject({ hotkey: 's' })
  ui.isFillable = false
  await pane.press({ key: 'send' })
  expect(await pane.find({ key: 'reply:0' })).toBeDefined()
  ui.isFillable = true
  await pane.press({ key: 'send' })
  expect(ui.fills.at(-1)).toEqual({ text: '[AI_AGENT] Second question\n[USER] two, reworded', mode: 'insert' })
  expect(fs[BOUND]).toContain(`[AI_AGENT] Second question${anchor('row-1', 'Second question', 'two')}\n[USER] two, reworded`)
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
  expect((await run($, '')).text).toContain('t todos, o objectives (u update, e editor), i important, c chat, q queue, h history, l logs, s send queue')
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
  expect(await pane.find({ type: 'Text', text: 'u adds an update under Updates, Enter keeps it, e opens the notes file in your editor, b goes back' })).toBeDefined()
  expect((await pane.find({ key: 'objectives' }))?.props).toMatchObject({ hotkey: 'u', label: 'Update objectives' })
  await pane.press({ key: 'objectives' })
  expect((await pane.find({ key: 'objectives' }))?.type).toBe('Input')
  await pane.input({ key: 'objectives', text: 'Add the todo slot' })
  expect(bare(fs[BOUND])).toContain('## Updates\n\n[UPDATE] 2026-10-26-10-58\nAdd the todo slot\n')
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
  '',
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

// The top label at p, the other options sharing the rest.
function verdict(said: { label: string; p: number }) {
  const labels = ['not-mentioned', 'started', 'finished', 'rejected']
  const rest = (1 - said.p) / (labels.length - 1)
  return { ...said, probs: Object.fromEntries(labels.map(label => [label, label === said.label ? said.p : rest])) }
}

// Laya reads an objective line as a task, as background for the to-do line and unsure for the ongoing one; replies are read by the table.
function fakeLaya(replies: Record<string, { label: string; p: number }> = {}) {
  laya.answer = ask => ({
    lines: Object.fromEntries(ask.lines.map(line => [line.id, line.text.startsWith('to-do') ? 0.05 : line.text.startsWith('ongoing') ? 0.5 : 0.95])),
    statuses: Object.fromEntries(ask.statuses.map(status => [status.id, verdict(replies[status.id] ?? { label: 'not-mentioned', p: 0.9 })])),
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
    CAPTAIN_NOTES.replace('I want a todo list kept by the plugin', tag('I want a todo list kept by the plugin'))
      .replace('- ongoing: being worked on', `- ${tag('ongoing: being worked on')}`)
      .replace('I want to see it live in the sidepanel.', tag('I want to see it live in the sidepanel.'))
      .replace(
        '# Important',
        `# Todo\n\n- [ ] ${tag('I want a todo list kept by the plugin')}\n- [ ] ${tag('ongoing: being worked on')}\n- [ ] ${tag('I want to see it live in the sidepanel.')}\n\n# Important`,
      ),
  )
  expect(commits(git)).toEqual([`todo: ${BOUND.split('/').pop()}`])

  // The captain deletes a line; a new launch does not bring it back and asks nothing.
  fs[BOUND] = (fs[BOUND] ?? '').replace(`- [ ] ${tag('ongoing: being worked on')}\n`, '')
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
  expect(bare(fs[NOW])).toContain('\n# Todo\n\n- [ ] Plan the todo pane\n- [ ] Add a Todo pane\n\n# Important')
  expect((await run($, 'todo')).text).toBe('[ ] Plan the todo pane\n[ ] Add a Todo pane')
  expect((await run($, 'todo nonsense')).text).toBe('Usage: /notes-keeping todo [sync]')
})

test('without Laya installed the updates still become items, one toast says why, and the lines wait for Laya', async ($, on) => {
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES }
  const { ui } = engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('# Todo\n\n- [ ] I want to see it live in the sidepanel.\n\n# Important')
  expect(ui.toasts.filter(text => text.includes('no Laya'))).toHaveLength(1)
  expect(ui.toasts[0]).toContain(PYTHON)

  fs[PYTHON] = ''
  fakeLaya()
  await run($, 'todo sync')
  expect(bare(fs[BOUND])).toContain('- [ ] I want a todo list kept by the plugin')
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
  expect(bare(fs[BOUND])).toContain('- [x] Add a ctrl+q toggle\n- [ ] Write the docs\n- [ ] Rename the pane')
  expect(commits(git).at(-1)).toBe(`todo: ${BOUND.split('/').pop()}`)

  // A done item is not asked about again.
  await complete($, 'Nothing else.')
  await flush()
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).toEqual(expect.arrayContaining(['write the docs', 'rename the pane']))
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).not.toContain('add a ctrl+q toggle')
})

const LOG = `${DIR}/todo-changes.log`

test('Laya leaves a status set by a hand edit of the file however sure; the edit is logged as an unknown writer, each move as Laya with its own probability', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle\n- [ ] Write the docs\n- [ ] Rename the pane\n- [x] Fix the flicker'), [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({
    'add a ctrl+q toggle': { label: 'finished', p: 0.96 },
    'write the docs': { label: 'finished', p: 0.97 },
    'rename the pane': { label: 'finished', p: 0.89 },
    'fix the flicker': { label: 'rejected', p: 0.95 },
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  await complete($, 'Nothing yet.')
  await flush()
  // The captain sets two by hand; Laya reads the next reply.
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [ ] Write the docs', '- [~] Write the docs').replace('- [ ] Rename the pane', '- [~] Rename the pane')
  await complete($, 'The ctrl+q toggle, the docs, the pane rename and the flicker fix were reworked.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] Add a ctrl+q toggle\n- [~] Write the docs\n- [~] Rename the pane\n- [x] Fix the flicker')
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).toEqual(expect.arrayContaining(['add a ctrl+q toggle', 'write the docs', 'rename the pane']))
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).not.toContain('fix the flicker')
  expect(logsOf(fs[BOUND])).toEqual([
    `- ${UTC} | unknown | status | ${cell('Write the docs')} | todo -> in-progress`,
    `- ${UTC} | unknown | status | ${cell('Rename the pane')} | todo -> in-progress`,
    `- ${UTC} | laya | status | ${cell('Add a ctrl+q toggle')} | todo -> done | finished 0.96`,
  ])
  // todo-changes.log is no longer written.
  expect(fs[LOG]).toBeUndefined()
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
    expect(row.context?.[0]).toContain('in parallel')
    expect(row.context?.[0]).toContain('- [ ] Add a ctrl+q toggle\n- [~] Write the docs')
  }
})

test('a click on a todo item in the notes pane sets the next status, writes the file and logs it as the captain; Laya leaves the status the captain set', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '' }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({ 'add a ctrl+q toggle': { label: 'finished', p: 0.96 } })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  laya.asks.length = 0
  const launched = commits(git).filter(subject => subject.startsWith('todo:')).length
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  const key = 'todo:add a ctrl+q toggle'
  expect((await pane.find({ key }))?.props.label).toBe('[ ]')
  expect((await pane.find({ key: 'open:add a ctrl+q toggle' }))?.props.label).toBe('Add a ctrl+q toggle')
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    await pane.press({ key })
    seen.push((fs[BOUND] ?? '').match(/- \[(.)\] Add/)?.[1] ?? '?')
  }
  expect(seen).toEqual(['~', 'x', '-', ' '])
  expect(commits(git).filter(subject => subject.startsWith('todo:'))).toHaveLength(launched + 4)

  expect(logsOf(fs[BOUND])).toEqual(
    ['todo -> in-progress', 'in-progress -> done', 'done -> declined', 'declined -> todo'].map(change => `- ${UTC} | captain | status | ${cell('Add a ctrl+q toggle')} | ${change}`),
  )

  // Clicked back to todo, it is the captain's; a sure reply that names it leaves it.
  await complete($, 'The ctrl+q toggle was reworked and merged.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [ ] Add a ctrl+q toggle')
  expect(logsOf(fs[BOUND]).at(-1)).toBe(`- ${UTC} | captain | status | ${cell('Add a ctrl+q toggle')} | declined -> todo`)
  await pane.unmount()
})

test('the todo list is the Todos view of the notes pane', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [x] Done one\n- [-] Dropped one') }
  engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'todo:done one' }))?.props).toMatchObject({ label: '[x]' })
  expect((await pane.find({ key: 'open:done one' }))?.props).toMatchObject({ label: 'Done one' })
  expect((await pane.find({ key: 'todo:dropped one' }))?.props).toMatchObject({ label: '[-]' })
  expect((await pane.find({ key: 'open:dropped one' }))?.props).toMatchObject({ label: 'Dropped one' })
  await pane.unmount()
})

function setTodoFile(body: string): string {
  return CAPTAIN_NOTES.replace('# Important', `# Todo\n\n${body}\n\n# Important`)
}

test('a linked item follows its firstmate task: the bridge moves it to in-progress and Laya is not asked about it', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr\n- [ ] Write the docs'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({ 'review this pr': { label: 'finished', p: 0.95 }, 'write the docs': { label: 'started', p: 0.9 } })
  bridge.links = { 'Review this PR': { status: 'in-progress', task: 'pr-review' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr\n- [ ] Write the docs')
  expect(logsOf(fs[BOUND])).toContain(`- ${UTC} | firstmate | status | id:${idFor('Review this pr', new Set())} Review this pr | todo -> in-progress | pr-review`)

  laya.asks.length = 0
  await complete($, 'Finished the review this PR needed; started writing the docs.')
  await flush()
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).toContain('write the docs')
  expect(laya.asks.at(-1)?.statuses.map(status => status.id)).not.toContain('review this pr')
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr\n- [~] Write the docs')

  bridge.links = { 'Review this PR': { status: 'done', task: 'pr-review' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] Review this pr')
})

test('a linked item whose task could not be started is blocked with the reason logged, and moves on when the task reports', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  bridge.links = { 'review this pr': { status: 'blocked', task: 'pr-review', by: 'firstmate', reason: 'no free worktree slot' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [!] Review this pr')
  expect(logsOf(fs[BOUND])).toContain(`- ${UTC} | firstmate | status | id:${idFor('Review this pr', new Set())} Review this pr | todo -> blocked | pr-review, by firstmate: no free worktree slot`)
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'show:blocked' }))?.props).toMatchObject({ hotkey: '5', label: '[!] blocked: shown' })
  expect((await pane.find({ key: 'todo:review this pr' }))?.props.label).toBe('[!]')
  expect((await pane.find({ key: 'open:review this pr' }))?.props.label).toBe('Review this pr')
  await pane.unmount()
  bridge.links = { 'review this pr': { status: 'in-progress', task: 'pr-review', by: 'firstmate' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr')
})

test('a linked item firstmate pauses is paused with the reason written on it and logged; a fresh reason replaces it; a later report resumes it', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  bridge.links = { 'review this pr': { status: 'paused', task: 'pr-review', by: 'firstmate', reason: 'the fix lane comes first' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [/] Review this pr <!-- paused:the fix lane comes first -->')
  expect(logsOf(fs[BOUND])).toContain(`- ${UTC} | firstmate | status | id:${idFor('Review this pr', new Set())} Review this pr | todo -> paused | pr-review, by firstmate: the fix lane comes first`)
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'show:paused' }))?.props).toMatchObject({ hotkey: '6', label: '[/] paused: shown' })
  expect((await pane.find({ key: 'todo:review this pr' }))?.props.label).toBe('[/]')
  expect((await pane.find({ key: 'open:review this pr' }))?.props.label).toBe('Review this pr (paused: the fix lane comes first)')
  await pane.unmount()
  bridge.links = { 'review this pr': { status: 'paused', task: 'pr-review', by: 'firstmate', reason: 'still behind the fix lane' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [/] Review this pr <!-- paused:still behind the fix lane -->')
  bridge.links = { 'review this pr': { status: 'in-progress', task: 'pr-review', by: 'firstmate' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr\n')
})

test('a status the captain sets on a linked item stays until the linked task changes state', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  bridge.links = { 'review this pr': { status: 'in-progress', task: 'pr-review' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr')
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [~] Review this pr', '- [ ] Review this pr')
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [ ] Review this pr')
  bridge.links = { 'review this pr': { status: 'done', task: 'pr-review' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] Review this pr')
})

test('a linked item with no task state is left alone and still kept from Laya', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({ 'review this pr': { label: 'finished', p: 0.95 } })
  bridge.links = { 'review this pr': { status: null, task: 'pr-review' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await complete($, 'The review of this PR is finished.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [ ] Review this pr')
  expect(laya.asks.flatMap(ask => ask.statuses).map(status => status.id)).not.toContain('review this pr')
  expect(laya.asks.at(-1)?.answer).toBe('The review of this PR is finished.')
})

test('the bridge is told of new items and of every status change with who made it: Laya, firstmate, the captain', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle\n- [ ] Review this pr'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya({ 'add a ctrl+q toggle': { label: 'finished', p: 0.9 } })
  // The first run takes the list as it is: nothing is new yet.
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  const seeded = bridge.notified.length

  await complete($, 'The ctrl+q toggle works.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] Add a ctrl+q toggle')
  bridge.links = { 'review this pr': { status: 'in-progress', task: 'pr-review' } }
  await complete($, 'Nothing.')
  await flush()
  expect(bare(fs[BOUND])).toContain('- [~] Review this pr')
  expect(bridge.notified.slice(seeded)).toEqual([
    `Add a ctrl+q toggle: todo -> done (laya) [id:${idFor('Add a ctrl+q toggle', new Set())}]\n`,
    `Review this pr: todo -> in-progress (firstmate pr-review) [id:${idFor('Review this pr', new Set())}]\n`,
  ])

  await run($, 'update Ship the bridge')
  await flush()
  expect(bridge.notified.at(-1)).toBe(`+ [ ] Ship the bridge [id:${idFor('Ship the bridge', new Set())}]\n`)

  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'todo:ship the bridge' })
  await flush()
  expect(bridge.notified.at(-1)).toBe(`Ship the bridge: todo -> in-progress (captain) [id:${idFor('Ship the bridge', new Set())}]\n`)
  await pane.unmount()
})

test('a hand edit made between turns reaches the bridge within one refresh', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '', [BRIDGE]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  fs[BOUND] = (fs[BOUND] ?? '').replace(`- [ ] ${tag('Add a ctrl+q toggle')}`, `- [x] ${tag('Add a ctrl+q toggle')}\n- [ ] Typed by hand`)
  await clock.advance(5_000)
  await flush()
  expect(bridge.notified).toEqual([`Add a ctrl+q toggle: todo -> done (unknown) [id:${idFor('Add a ctrl+q toggle', new Set())}]\n+ [ ] Typed by hand\n`])
  expect(logsOf(fs[BOUND])).toEqual([
    `- ${TICK} | unknown | status | ${cell('Add a ctrl+q toggle')} | todo -> done`,
    `- ${TICK} | unknown | added | Typed by hand | none -> todo`,
  ])
  // Writing the log rows is not itself a change: the next ticks send and log nothing and write nothing.
  const written = fs[BOUND]
  await clock.advance(5_000)
  await flush()
  await clock.advance(5_000)
  await flush()
  expect(bridge.notified).toHaveLength(1)
  expect(fs[BOUND]).toBe(written)
})

test('an update firstmate queues through the bridge lands under ## Updates within one refresh, logged as firstmate, and its item id is answered', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '', [BRIDGE]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  bridge.pending = [{ request: 'r1', text: 'Ship the spawn todo', by: 'firstmate', task: 'spawn-x' }]
  await clock.advance(5_000)
  await flush()
  const id = idFor('Ship the spawn todo', new Set())
  expect(bridge.answers).toEqual([{ request: 'r1', answer: { id } }])
  const when = stamp(new Date(2026, 9, 26, 10, 58, 5).getTime())
  expect(sections(fs[BOUND] ?? '').updates).toContain(`[UPDATE] ${when}\nShip the spawn todo <!-- id:${id} -->`)
  expect(fs[BOUND]).toContain(`- [ ] Ship the spawn todo <!-- id:${id} -->`)
  expect(logsOf(fs[BOUND])).toContain(`- ${TICK} | firstmate | update | id:${id} Ship the spawn todo | - | spawn-x, by firstmate: Ship the spawn todo`)
  expect(logsOf(fs[BOUND]).filter(line => / \| (captain|unknown) \| /.test(line))).toEqual([])
  // A request is answered once: the next ticks write nothing more.
  const written = fs[BOUND]
  await clock.advance(5_000)
  await flush()
  expect(bridge.answers).toHaveLength(1)
  expect(fs[BOUND]).toBe(written)
})

test('a queued update whose text an item already has answers that item\'s id and adds no second item', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Ship the spawn todo <!-- id:ab12cd3 -->'), [PYTHON]: '', [BRIDGE]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  bridge.pending = [{ request: 'r1', text: 'Ship the spawn todo', by: 'crew-7', task: 'spawn-x' }]
  await clock.advance(5_000)
  await flush()
  expect(bridge.answers).toEqual([{ request: 'r1', answer: { id: 'ab12cd3' } }])
  expect(bare(fs[BOUND]).match(/^- \[ \] Ship the spawn todo$/gm)).toHaveLength(1)
  expect(logsOf(fs[BOUND]).at(-1)).toBe(`- ${TICK} | firstmate | update | id:ab12cd3 Ship the spawn todo | - | spawn-x, by crew-7: Ship the spawn todo`)
})

test('a queued update that would make no todo item is answered with why and writes nothing', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '', [BRIDGE]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  const before = fs[BOUND]
  bridge.pending = [{ request: 'r1', text: 'Project: dotfiles', by: 'firstmate', task: 'spawn-x' }]
  await clock.advance(5_000)
  await flush()
  expect(bridge.answers).toEqual([{ request: 'r1', answer: { error: 'the update makes no todo item' } }])
  expect(fs[BOUND]).toBe(before)
})

test('a bound interactive session asks the bridge for pending updates for its own notes file on each refresh', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '', [BRIDGE]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  await clock.advance(5_000)
  await flush()
  expect(bridge.argv.filter(call => call[1] === 'pending')).toEqual([[BRIDGE, 'pending', BOUND]])
})

test('an item linked by id keeps its link and its bridge status when the captain edits its text', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Review this pr <!-- id:ab12cd3 -->\n- [ ] Write the docs <!-- id:ef45gh6 -->'), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  bridge.links = { 'id:ab12cd3': { status: 'in-progress', task: 'pr-review', id: 'ab12cd3' } }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(fs[BOUND]).toContain('- [~] Review this pr <!-- id:ab12cd3 -->')

  // The captain rewrites the item and sets it back to todo: the same report leaves it there, and Laya is still not asked.
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [~] Review this pr <!-- id:ab12cd3 -->', '- [ ] Review the PR again, with diagrams <!-- id:ab12cd3 -->')
  laya.asks.length = 0
  await complete($, 'Reviewed the PR again with diagrams; started the docs.')
  await flush()
  expect(fs[BOUND]).toContain('- [ ] Review the PR again, with diagrams <!-- id:ab12cd3 -->')
  expect(laya.asks.flatMap(ask => ask.statuses).map(status => status.text)).not.toContain('Review the PR again, with diagrams')

  bridge.links = { 'id:ab12cd3': { status: 'done', task: 'pr-review', id: 'ab12cd3', by: 'crew-7' } }
  await complete($, 'Nothing.')
  await flush()
  expect(fs[BOUND]).toContain('- [x] Review the PR again, with diagrams <!-- id:ab12cd3 -->')
  expect(logsOf(fs[BOUND])).toContain(`- ${UTC} | unknown | status | id:ab12cd3 Review the PR again, with diagrams | in-progress -> todo`)
  expect(logsOf(fs[BOUND]).at(-1)).toBe(`- ${UTC} | firstmate | status | id:ab12cd3 Review the PR again, with diagrams | todo -> done | pr-review, by crew-7, replaced a hand-set status`)
})

test('an objective line edited after it got its id stays linked to its item: no second item, and the item keeps its text', async ($, on) => {
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES, [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  const line = tag('I want a todo list kept by the plugin')
  expect(fs[BOUND]).toContain(`\n${line}\n`)
  expect(fs[BOUND]).toContain(`- [ ] ${line}`)

  fs[BOUND] = (fs[BOUND] ?? '').replace(`\n${line}\n`, `\n${line.replace('kept by the plugin', 'kept and shown by the plugin')}\n`)
  await run($, 'update Ship the bridge')
  await flush()
  expect(bare(fs[BOUND])).not.toContain('- [ ] I want a todo list kept and shown by the plugin')
  expect(fs[BOUND]).toContain(`- [ ] ${line}`)
  expect(bare(fs[BOUND]).match(/^- \[ \] /gm)).toHaveLength(4)
})

test('without the bridge file the plugin runs no bridge, and still logs a todo change made outside it as an unknown writer', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle'), [PYTHON]: '' }
  const store: Record<string, unknown> = { ...SESSION_BOUND }
  const { clock } = engine(on, fs, store)
  fakeLaya({ 'add a ctrl+q toggle': { label: 'finished', p: 0.9 } })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  await complete($, 'The ctrl+q toggle works.')
  await run($, 'update Ship the bridge')
  await flush()
  fs[BOUND] = (fs[BOUND] ?? '').replace('- [ ] Ship the bridge', '- [~] Ship the bridge')
  await clock.advance(5_000)
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] Add a ctrl+q toggle')
  expect(bridge.calls).toEqual([])
  expect(logsOf(fs[BOUND]).at(-1)).toBe(`- ${TICK} | unknown | status | ${cell('Ship the bridge')} | todo -> in-progress`)
})

test('the refresh tick binds no carried notes file to a new session id while there is no bridge', async ($, on) => {
  const fs: Fs = {}
  const session = { id: SESSION }
  const store: Record<string, unknown> = {}
  const { clock } = engine(on, fs, store, undefined, undefined, session)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run($, 'init Plan')
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  session.id = NEXT_ID
  await clock.advance(5_000)
  await flush()
  expect(store[`session:${NEXT_ID}`]).toBeUndefined()
  expect(fs[NOW]).not.toContain(NEXT_ID)
})

// The fake label model names an item by its first three words.
function fakeLabels() {
  model.answer = prompt => `"${(prompt.split('Item: ')[1] ?? '').split(' ').slice(0, 3).join(' ')}."`
}

test('a new item gets a short label from the model once, written beside its whole text and shown in the panel, the todo command and the context', async ($, on) => {
  const sent = submitting(on)
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES, [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  fakeLabels()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain(
    '# Todo\n\n- [ ] **I want a**: I want a todo list kept by the plugin\n- [ ] **ongoing: being worked**: ongoing: being worked on\n- [ ] **I want to**: I want to see it live in the sidepanel.\n\n# Important',
  )
  expect(model.asks).toHaveLength(3)

  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'open:i want a todo list kept by the plugin' }))?.props.label).toBe('I want a')
  await pane.press({ key: 'todo:i want a todo list kept by the plugin' })
  expect(bare(fs[BOUND])).toContain('- [~] **I want a**: I want a todo list kept by the plugin')
  await pane.unmount()
  expect((await run($, 'todo')).text).toBe('[~] I want a\n[ ] ongoing: being worked\n[ ] I want to')

  await submit($, 'next')
  expect(sent.at(-1)?.context?.[0]).toContain('- [~] I want a: I want a todo list kept by the plugin')

  // Labels are kept: later runs ask the model nothing.
  await run($, 'todo sync')
  await complete($, 'Nothing yet.')
  await flush()
  expect(model.asks).toHaveLength(3)
})

test('an item already in the list without a label gets one once; a label written by hand is kept', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [x] Fix the flicker in the pane\n- [ ] **Mine**: Rename the pane'), [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  fakeLabels()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [x] **Fix the flicker**: Fix the flicker in the pane\n- [ ] **Mine**: Rename the pane')
  expect(model.asks.filter(prompt => prompt.includes('Rename the pane'))).toHaveLength(0)
})

test('without a label from the model an item shows its text cut short, the whole text stays in the file, one toast says why, and it is not asked again', async ($, on) => {
  const long = `Ship the todo labels ${'and keep every word of the long line '.repeat(5)}to the end`
  const fs: Fs = { [BOUND]: CAPTAIN_NOTES.replace('## Updates\n\n', `## Updates\n\n[Update] 2026-10-17-01\n${long}\n\n`), [PYTHON]: '' }
  const { ui } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain(`\n- [ ] ${long}\n`)
  const asked = model.asks.length
  expect(asked).toBeGreaterThan(0)
  expect(ui.toasts.filter(text => text.includes('no label from haiku'))).toHaveLength(1)

  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  const label = (await pane.find({ key: `open:${long.toLowerCase()}` }))?.props.label as string
  expect(label.startsWith('Ship the todo labels')).toBe(true)
  expect(label.endsWith('…')).toBe(true)
  await pane.unmount()

  await run($, 'todo sync')
  expect(model.asks).toHaveLength(asked)
})

test('a model reply that is not a short label leaves the item unlabeled', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] Write the docs'), [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  model.answer = () => 'Here is a label you could use for this item, I think'
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(bare(fs[BOUND])).toContain('- [ ] Write the docs\n')
})

test('an item cut at 120 characters before the text was kept whole is not added again from its whole line', async ($, on) => {
  const long = `Keep the whole text ${'of a very long update line '.repeat(6)}to the end`
  const cut = `${long.slice(0, 119).trimEnd()}…`
  const notes = CAPTAIN_NOTES.replace('## Updates\n\n', `## Updates\n\n[Update] 2026-10-17-01\n${long}\n\n`)
  const fs: Fs = { [BOUND]: notes.replace('# Important', `# Todo\n\n- [ ] **Old label**: ${cut}\n\n# Important`), [PYTHON]: '' }
  const store = { ...SESSION_BOUND, [`todo:${BOUND}`]: { seen: [cut.toLowerCase()], ai: { [cut.toLowerCase()]: 'todo' }, pins: [] } }
  engine(on, fs, store)
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  expect(fs[BOUND]?.split('Keep the whole text').length).toBe(3)
  expect(bare(fs[BOUND])).toContain(`- [ ] **Old label**: ${cut}`)
})

// Every host call the plugin makes reaches one of the engine's hooks; each hook notes the time it ran.
function marking(on: On, marks: number[]): On {
  return ((event: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    // A process.spawn hook must stay an async generator; the editor's spawn is not part of the todo run.
    if (event === 'process.spawn') return (on as (...args: unknown[]) => unknown)(event, ...rest, hook)
    return (on as (...args: unknown[]) => unknown)(event, ...rest, (...args: unknown[]) => {
      marks.push(performance.now())
      return hook(...args)
    })
  }) as On
}

// The engine unloads the plugin when its hooks worker answers no heartbeat for 5000 ms while a dispatch waits on it; the todo
// run after a turn holds the worker between two host calls, so the longest such stretch is what a press during it waits on.
test('the todo run after a turn over 100 items and a long reply never holds the hooks worker for a second between host calls', { timeoutMs: 30_000 }, async ($, on) => {
  const syllables = ['ba', 'ce', 'di', 'fo', 'gu', 'ha', 'ke', 'li', 'mo', 'nu', 'pa', 're', 'si', 'to', 'vu', 'wa', 'ze', 'ji', 'qo', 'xu']
  const word = (n: number) => [Math.floor(n / 400) % 20, Math.floor(n / 20) % 20, n % 20].map(i => syllables[i]).join('')
  const shared = Array.from({ length: 40 }, (_, i) => word(7000 + i))
  const texts = Array.from({ length: 100 }, (_, i) =>
    [0, 1, 2, 3].map(j => word(i * 4 + j)).concat(Array.from({ length: 10 }, (_, j) => shared[(i + j * 3) % shared.length] ?? '')).join(' '),
  )
  const answer = Array.from({ length: 150 }, (_, s) => `The ${texts[s % texts.length]?.split(' ').slice(0, 12).join(' ')} part is done and merged.`).join(' ')
  const fs: Fs = { [BOUND]: setTodoFile(texts.map(text => `- [ ] ${text}`).join('\n')), [PYTHON]: '' }
  const marks: number[] = []
  engine(marking(on, marks), fs, { ...SESSION_BOUND })
  laya.answer = ask => ({ lines: {}, statuses: Object.fromEntries(ask.statuses.map(status => [status.id, verdict({ label: 'finished', p: 0.9 })])) })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  marks.length = 0
  await complete($, answer)
  for (let i = 0; i < 20 && !fs[BOUND]?.includes(`- [x] ${texts[99]}`); i++) await flush()
  expect(bare(fs[BOUND])).toContain(`- [x] ${texts[99]}`)
  const held = Math.max(...marks.slice(1).map((at, i) => at - (marks[i] ?? at)))
  expect(held).toBeLessThan(1000)
})

const SENTRY = 'Investigate the Sentry production alert'

// Audit 2026-10-29, sections 3.1 and 3.5: Laya, leaning "started" with rejected at 0.05, declined the Sentry item on one
// refusal cue in Claude's reply, firstmate never heard of it, and the captain's four clicks reached firstmate as "(captain)".
test('the Sentry decline: a refusal cue leaves the item, so does Laya however sure; a finish reaches firstmate as Laya, the clicks as the captain', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile(`- [ ] ${SENTRY}`), [PYTHON]: '', [BRIDGE]: '' }
  engine(on, fs, { ...SESSION_BOUND })
  let probs = { 'not-mentioned': 0, started: 0.85, finished: 0.1, rejected: 0.05 }
  laya.answer = ask => ({ lines: {}, statuses: Object.fromEntries(ask.statuses.map(status => [status.id, { label: 'started', p: probs.started, probs }])), predictMs: 1 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  const seeded = bridge.notified.length
  for (const reply of ['The Sentry alert was skipped this turn.', "I won't touch the Sentry alert now.", 'The Sentry alert is not something I can open without a login.']) {
    await complete($, reply)
    await flush()
    expect(bare(fs[BOUND])).toContain(`- [ ] ${SENTRY}`)
  }
  expect(bridge.notified.slice(seeded)).toEqual([])
  expect(logsOf(fs[BOUND])).toEqual([])

  // Laya itself sure of a refusal: still not declined. Only the captain or firstmate declines.
  probs = { 'not-mentioned': 0, started: 0.03, finished: 0.02, rejected: 0.95 }
  laya.answer = ask => ({ lines: {}, statuses: Object.fromEntries(ask.statuses.map(status => [status.id, { label: 'rejected', p: 0.95, probs }])), predictMs: 1 })
  await complete($, 'The Sentry alert is not ours; I dropped it.')
  await flush()
  expect(bare(fs[BOUND])).toContain(`- [ ] ${SENTRY}`)
  expect(bridge.notified.slice(seeded)).toEqual([])

  // A finish cue with Laya leaning started closes it, and firstmate hears it was Laya.
  probs = { 'not-mentioned': 0, started: 0.6, finished: 0.3, rejected: 0.1 }
  laya.answer = ask => ({ lines: {}, statuses: Object.fromEntries(ask.statuses.map(status => [status.id, { label: 'started', p: 0.6, probs }])), predictMs: 1 })
  await complete($, 'The Sentry alert is fixed.')
  await flush()
  const id = idFor(SENTRY, new Set())
  expect(bare(fs[BOUND])).toContain(`- [x] ${SENTRY}`)
  expect(bridge.notified.at(-1)).toBe(`${SENTRY}: todo -> done (laya) [id:${id}]\n`)
  expect(logsOf(fs[BOUND])).toEqual([`- ${UTC} | laya | status | ${cell(SENTRY)} | todo -> done | finished 0.30, 1.00 with the finish cue`])

  // Four clicks go once around the cycle: each is the captain's.
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  for (let i = 0; i < 4; i++) await pane.press({ key: `todo:${SENTRY.toLowerCase()}` })
  await flush()
  expect(bridge.notified.slice(-4)).toEqual(
    ['done -> declined', 'declined -> todo', 'todo -> in-progress', 'in-progress -> done'].map(change => `${SENTRY}: ${change} (captain) [id:${id}]\n`),
  )
  expect(logsOf(fs[BOUND]).slice(1).map(row => row.split(' | ')[1])).toEqual(['captain', 'captain', 'captain', 'captain'])
  await pane.unmount()
})

test('an objective or update from a command the captain did not type is logged as an unknown writer', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('') }
  engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await $.command.run({ command: 'notes-keeping', args: 'update From a script', origin: { kind: 'sdk' }, presentation: { isFullscreen: true, columns: 200 } })
  await flush()
  expect(logsOf(fs[BOUND])[0]).toBe(`- ${UTC} | unknown | update | - | - | From a script`)
})

test('the # Logs section stays out of Claude\'s context and Laya\'s input; every prompt says where it is', async ($, on) => {
  const sent = submitting(on)
  const row = `- ${UTC} | captain | status | id:ab12cd3 Ship the logs tab | todo -> done`
  const fs: Fs = { [BOUND]: `${setTodoFile('- [ ] Ship the logs tab <!-- id:ab12cd3 -->')}\n# Logs\n\n${row}\n- Write the release notes for the logs\n`, [PYTHON]: '' }
  engine(on, fs, { ...SESSION_BOUND }, undefined, { text: 'Earlier prompt' })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await complete($, 'Shipped the logs tab.')
  await flush()
  const asked = laya.asks.flatMap(ask => [...ask.lines.map(line => line.text), ...ask.statuses.map(status => status.text), ask.answer])
  expect(asked.join('\n')).not.toContain('release notes')
  expect(bare(fs[BOUND])).not.toContain('- [ ] Write the release notes')
  await submit($, 'first')
  await submit($, 'second')
  expect(sent[0]?.context?.[0]).toContain('# Todo')
  for (const one of sent) {
    expect(one.context?.[0]).not.toContain(row)
    expect(one.context?.[0]).toContain(`Action log: the # Logs section of ${BOUND} holds who (human or AI agent)`)
  }
})

test('the first log rows a notes file gets bring its rows from todo-changes.log along, which is left as it was', async ($, on) => {
  const name = BOUND.split('/').pop() ?? ''
  const legacy = [
    `2026-10-25-17-35 ${name} | Review this pr | todo -> in-progress | laya started 1.00`,
    '2026-10-25-17-36 other.md | Something else | todo -> done | laya finished 0.97',
    '',
  ].join('\n')
  const fs: Fs = { [BOUND]: setTodoFile('- [~] Review this pr'), [LOG]: legacy }
  engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await run($, 'update Ship the logs')
  await flush()
  const then = new Date(2026, 9, 25, 17, 35).toISOString().replace(/\.\d{3}Z$/, 'Z')
  expect(logsOf(fs[BOUND])).toEqual([
    `- ${then} | laya | status | ${cell('Review this pr')} | todo -> in-progress | started 1.00 (posterior), from todo-changes.log`,
    `- ${UTC} | captain | update | - | - | Ship the logs`,
    `- ${UTC} | plugin | added | ${cell('Ship the logs')} | none -> todo`,
  ])
  expect(fs[LOG]).toBe(legacy)
})

test('l opens the read-only Logs view: newest first, time, who by label, item, from -> to', async ($, on) => {
  const rows = [
    `- 2026-10-28T08:49:00Z | laya | status | id:1uxnkut ${SENTRY} | in-progress -> declined | rejected 0.95`,
    `- 2026-10-28T09:07:22Z | captain | status | id:1uxnkut ${SENTRY} | declined -> todo`,
    '- 2026-10-28T09:08:00Z | captain | update | - | - | Add a logs tab',
  ]
  const fs: Fs = { [BOUND]: `${setTodoFile(`- [ ] ${SENTRY} <!-- id:1uxnkut -->`)}\n# Logs\n\n${rows.join('\n')}\n` }
  engine(on, fs, { ...SESSION_BOUND })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:logs' }))?.props).toMatchObject({ hotkey: 'l', label: 'Logs' })
  await pane.press({ key: 'view:logs' })
  expect((await pane.findAll({ type: 'Text' })).map(text => text.text).filter(text => text.startsWith('2026-'))).toEqual([
    '2026-10-28 09:08:00  Captain (human)  -  Add a logs tab',
    `2026-10-28 09:07:22  Captain (human)  ${SENTRY}  declined -> todo`,
    `2026-10-28 08:49:00  Laya (AI classifier, aac6fef/laya-mlx)  ${SENTRY}  in-progress -> declined`,
  ])
  expect(await pane.find({ key: `todo:${SENTRY.toLowerCase()}` })).toBeUndefined()
  await pane.unmount()
})

test('only the objectives and updates make todo items: lines in # Important, # Chat or # Logs never do, and a hand edit there is no todo change', async ($, on) => {
  const row = `- ${UTC} | captain | update | - | - | to-do: from the logs`
  const fs: Fs = {
    [BOUND]: setTodoFile('- [ ] Add a ctrl+q toggle').replace('# Important\n', '# Important\n\nto-do: from important\n').replace('# Chat\n', '# Chat\n\nto-do: from the chat\n') + `\n# Logs\n\n${row}\n`,
    [PYTHON]: '',
    [BRIDGE]: '',
  }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  await complete($, 'Nothing changed.')
  await flush()
  expect(laya.asks.flatMap(ask => ask.lines.map(line => line.text)).filter(text => text.includes('from'))).toEqual([])
  expect(items(sections(fs[BOUND] ?? '').todo).filter(item => /from|typed/.test(item.text))).toEqual([])
  const notified = bridge.notified.length
  const rows = logsOf(fs[BOUND])
  fs[BOUND] = (fs[BOUND] ?? '').replace('to-do: from important', 'to-do: from important\nto-do: typed in important').concat('- to-do: typed in the logs\n')
  await clock.advance(5_000)
  await flush()
  expect(bridge.notified.length).toBe(notified)
  expect(logsOf(fs[BOUND]).slice(0, rows.length)).toEqual(rows)
  expect(items(sections(fs[BOUND] ?? '').todo).filter(item => /from|typed/.test(item.text))).toEqual([])
})

const KEYNAV = '# Objectives\n\nSessions: s\n\n## Updates\n\n# Todo\n\n- [ ] One\n- [~] Two\n- [x] Three\n- [-] Four\n\n# Important\n\n# Chat\n'

// The Todos view of a panel opened on four items, one per status. The kit draws no focus ring: the selection is read
// from the drawing (the one item not dimmed, the one autoFocus starts on), and the ring following it is checked live.
async function keynav($: Engine, on: On, extra: Fs = {}) {
  const fs: Fs = { [BOUND]: KEYNAV, ...extra }
  const { git } = engine(on, fs, { ...SESSION_BOUND })
  // Answers the ring helper's $.ui.focus; the plugin's own $.ui.focus never reaches a test hook.
  on('ui.focus', () => ({ value: {} }) as never)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  return { fs, git, pane }
}

// The person's Up or Down landing the notes pane's focus ring on `element`, as the engine raises it.
function ring($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: 'notes-keeping', plugin: 'notes-keeping', element, origin: { kind: 'person' } } as never)
}

function marker(fs: Fs, text: string): string | undefined {
  return fs[BOUND]?.match(new RegExp(`- \\[(.)\\] ${text}(?: <!-- id:[a-z0-9]+ -->)?\\n`))?.[1]
}

// The todo rows drawn, in order: `todo:<id>`, or `todo#<n>:<id>` for the row the selection was handed to.
async function todoRows(pane: Awaited<ReturnType<typeof keynav>>['pane']) {
  return (await pane.findAll({ type: 'Button' })).flatMap(button => {
    const id = /^todo(?:#\d+)?:([^]*)$/.exec(button.key ?? '')?.[1]
    return id === undefined ? [] : [{ id, key: button.key ?? '', props: button.props }]
  })
}

// The ids of the rows drawn as selected: the one not dimmed, the one autoFocus starts on.
async function selectedTodo(pane: Awaited<ReturnType<typeof keynav>>['pane']): Promise<string[]> {
  const rows = await todoRows(pane)
  const lit = rows.filter(row => row.props.dimColor === false).map(row => row.id)
  expect(rows.filter(row => row.props.autoFocus === true).map(row => row.id)).toEqual(lit)
  return lit
}

async function selectedKey(pane: Awaited<ReturnType<typeof keynav>>['pane']): Promise<string | undefined> {
  return (await todoRows(pane)).find(row => row.props.dimColor === false)?.key
}

test('the Todos view starts the focus ring on the first shown item, and the ringed item is drawn as the selected one', async ($, on) => {
  const { pane } = await keynav($, on)
  expect((await pane.findAll({ type: 'Button' })).filter(button => button.props.autoFocus === true).map(button => button.key)).toEqual(['todo:one'])
  expect(await selectedTodo(pane)).toEqual(['one'])
  await ring($, 'todo:three')
  expect(await selectedTodo(pane)).toEqual(['three'])
  expect((await pane.find({ key: 'todo:three' }))?.props.autoFocus).toBe(true)
  await pane.unmount()
})

test('f steps the selected item forward and p back, stopping at declined and at todo; each change notifies the bridge once', async ($, on) => {
  const { fs, git, pane } = await keynav($, on, { [BRIDGE]: '' })
  expect((await pane.find({ key: 'status:next' }))?.props).toMatchObject({ hotkey: 'f' })
  expect((await pane.find({ key: 'status:prev' }))?.props).toMatchObject({ hotkey: 'p' })
  await ring($, 'todo:one')
  const notified = bridge.notified.length
  const writes = commits(git).length
  const seen: (string | undefined)[] = []
  for (const key of ['status:next', 'status:next', 'status:next', 'status:next', 'status:prev', 'status:prev', 'status:prev', 'status:prev']) {
    await pane.press({ key })
    await flush()
    seen.push(marker(fs, 'One'))
  }
  expect(seen).toEqual(['~', 'x', '-', '-', 'x', '~', ' ', ' '])
  expect(bridge.notified.slice(notified).map(line => line.replace(/ \[id:[a-z0-9]+\]\n$/, '\n'))).toEqual([
    'One: todo -> in-progress (captain)\n',
    'One: in-progress -> done (captain)\n',
    'One: done -> declined (captain)\n',
    'One: declined -> done (captain)\n',
    'One: done -> in-progress (captain)\n',
    'One: in-progress -> todo (captain)\n',
  ])
  expect(commits(git).length - writes).toBe(6)
  expect(marker(fs, 'Two')).toBe('~')
  await pane.unmount()
})

test('z asks why and pauses the selected item with the reason; an empty answer pauses nothing', async ($, on) => {
  const { fs, git, pane } = await keynav($, on, { [BRIDGE]: '' })
  expect((await pane.find({ key: 'item:pause' }))?.props).toMatchObject({ hotkey: 'z' })
  await ring($, 'todo:two')
  await pane.press({ key: 'item:pause' })
  expect((await pane.find({ key: 'todo:pause-reason' }))?.props).toMatchObject({ autoFocus: true })
  await pane.input({ key: 'todo:pause-reason', text: '   ' })
  await flush()
  expect(await pane.find({ key: 'todo:pause-reason' })).toBeUndefined()
  expect(marker(fs, 'Two')).toBe('~')
  const notified = bridge.notified.length
  const writes = commits(git).length
  await pane.press({ key: 'item:pause' })
  await pane.input({ key: 'todo:pause-reason', text: 'the CI queue is full' })
  await flush()
  expect(await pane.find({ key: 'todo:pause-reason' })).toBeUndefined()
  expect(bare(fs[BOUND])).toContain('- [/] Two <!-- paused:the CI queue is full -->\n')
  expect(logsOf(fs[BOUND]).some(row => row.includes('| captain | status |') && row.includes('Two | in-progress -> paused | the CI queue is full'))).toBe(true)
  expect(bridge.notified.slice(notified).map(line => line.replace(/ \[id:[a-z0-9]+\]\n$/, '\n'))).toEqual(['Two: in-progress -> paused (captain)\n'])
  expect(commits(git).length - writes).toBe(1)
  expect((await pane.find({ key: 'open:two' }))?.props.label).toBe('Two (paused: the CI queue is full)')
  await pane.unmount()
})

test('the row of toggles is the legend Claude reads with the todo list, mark and name, in its order', async ($, on) => {
  const { pane } = await keynav($, on)
  const legend = /notes-keeping \((.*?)\)\./.exec(context('- [ ] a') ?? '')?.[1]?.split(', ') ?? []
  expect(legend).toHaveLength(6)
  const toggles = (await pane.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('show:') === true)
  expect(toggles.map(button => button.props.label)).toEqual(legend.map(entry => `${entry}: shown`))
  const keys = (await pane.findAll({ type: 'Button' })).map(button => button.key ?? '')
  expect(keys.indexOf('show:declined')).toBeLessThan(keys.findIndex(key => key.startsWith('todo')))
  await pane.unmount()
})

// The end column of each toggle in the row as the terminal draws a plain Button with a hotkey (`1: label`), the row's
// gap between toggles, starting a new line where a wrapping row runs past `columns`.
function toggleEnds(labels: { hotkey: string; label: string }[], gap: number, wraps: boolean, columns: number): number[] {
  let at = 0
  return labels.map(({ hotkey, label }) => {
    const width = `${hotkey}: ${label}`.length
    const start = at === 0 ? 0 : at + gap
    at = wraps && at > 0 && start + width > columns ? width : start + width
    return at
  })
}

test('every status toggle, [!] blocked included, fits a sidebar 89 columns wide', async ($, on) => {
  const { pane } = await keynav($, on)
  const row = await pane.find({ key: 'filters' })
  const toggles = (await pane.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('show:') === true)
  expect(toggles.map(button => button.key)).toContain('show:blocked')
  const ends = toggleEnds(toggles.map(button => ({ hotkey: button.props.hotkey, label: button.props.label })), row?.props.gap, row?.props.flexWrap === 'wrap', 89)
  expect(ends.filter(end => end > 89)).toEqual([])
  await pane.unmount()
})

test('keys 1 to 4 hide and show todo, in-progress, done and declined items, and the pane says which are shown and which marker each status is', async ($, on) => {
  const { pane } = await keynav($, on)
  const toggles = ['show:todo', 'show:in-progress', 'show:done', 'show:declined']
  expect(await Promise.all(toggles.map(async key => (await pane.find({ key }))?.props))).toMatchObject([
    { hotkey: '1', label: '[ ] todo: shown' },
    { hotkey: '2', label: '[~] in-progress: shown' },
    { hotkey: '3', label: '[x] done: shown' },
    { hotkey: '4', label: '[-] declined: shown' },
  ])
  await pane.press({ key: 'show:done' })
  expect((await pane.find({ key: 'show:done' }))?.props.label).toBe('[x] done: hidden')
  expect((await todoRows(pane)).map(row => row.id)).toEqual(['one', 'two', 'four'])
  await pane.press({ key: 'show:done' })
  expect((await pane.find({ key: 'show:done' }))?.props.label).toBe('[x] done: shown')
  expect((await todoRows(pane)).map(row => row.id)).toEqual(['one', 'two', 'three', 'four'])
  for (const key of toggles) await pane.press({ key })
  expect(await todoRows(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: '(4 items, every status hidden)' })).toBeDefined()
  const hotkeys = (await pane.findAll({ type: 'Button' })).map(button => button.props.hotkey).filter(hotkey => hotkey !== undefined)
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
  await pane.unmount()
})

test('a status change that hides the selected item moves the selection to the next shown item, or to the one before at the end', async ($, on) => {
  const { fs, pane } = await keynav($, on)
  await pane.press({ key: 'show:done' })
  await ring($, 'todo:two')
  await pane.press({ key: 'todo:two' })
  await flush()
  expect(marker(fs, 'Two')).toBe('x')
  expect((await todoRows(pane)).map(row => row.id)).toEqual(['one', 'four'])
  expect(await selectedTodo(pane)).toEqual(['four'])

  await pane.press({ key: 'status:prev' })
  await flush()
  expect(marker(fs, 'Four')).toBe('x')
  expect(await selectedTodo(pane)).toEqual(['one'])
  await pane.unmount()
})

test('hiding the status of the selected item moves the selection to the next shown item', async ($, on) => {
  const { pane } = await keynav($, on)
  await ring($, 'todo:two')
  await pane.press({ key: 'show:in-progress' })
  await flush()
  expect(await selectedTodo(pane)).toEqual(['three'])
  await pane.unmount()
})

// The engine keeps the ring at its position through a redraw that drops or adds rows, and a $.ui.focus on a row
// already drawn lands before that redraw: a key not drawn before is one a focus waits for. The ring landing is
// checked live; here, that each hand-over draws the selected row under a new key and that key still selects it.
// A notes file whose items came from a numbered objective with details under it and from an update, plus one written by hand.
const SOURCED = [
  '# Objectives',
  '',
  'Sessions: s',
  '',
  '1. Ship the bridge',
  '   See the notes',
  '   - https://example.com/spec',
  '',
  '## Updates',
  '',
  '[UPDATE] 2026-10-29 08:00',
  'Project: dotfiles',
  'Add a pane with two keys.',
  'Then show it on the phone.',
  '',
  '# Todo',
  '',
  '- [ ] Ship the bridge',
  '- [~] Add a pane with two keys.',
  '- [ ] Written by hand',
  '',
  '# Important',
  '',
  '# Chat',
  '',
].join('\n')

test('a todo row is its marker, which cycles the status, and its text, which opens the item with the objective or update it came from, whole', async ($, on) => {
  const { fs, git, pane } = await keynav($, on, { [BOUND]: SOURCED })
  expect((await pane.find({ key: 'todo:ship the bridge' }))?.props.label).toBe('[ ]')
  expect((await pane.find({ key: 'open:ship the bridge' }))?.props.label).toBe('Ship the bridge')
  const writes = commits(git).length
  await pane.press({ key: 'todo:ship the bridge' })
  await flush()
  expect(marker(fs, 'Ship the bridge')).toBe('~')
  expect(logsOf(fs[BOUND]).at(-1)).toBe(`- ${UTC} | captain | status | ${cell('Ship the bridge')} | todo -> in-progress`)
  expect(commits(git).length - writes).toBe(1)

  // A press on the text writes nothing and opens the item.
  await pane.press({ key: 'open:ship the bridge' })
  await flush()
  expect(commits(git).length - writes).toBe(1)
  expect(marker(fs, 'Ship the bridge')).toBe('~')
  expect(await pane.find({ key: 'todo:ship the bridge' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '[~] in-progress' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Ship the bridge' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'From the objectives' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '1. Ship the bridge\n   See the notes\n   - https://example.com/spec' })).toBeDefined()
  expect((await pane.find({ key: 'view:back' }))?.props).toMatchObject({ hotkey: 'b' })
  await pane.press({ key: 'view:back' })
  expect(await pane.find({ key: 'todo:ship the bridge' })).toBeDefined()

  await pane.press({ key: 'open:add a pane with two keys.' })
  expect(await pane.find({ type: 'Text', text: 'From an update' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[UPDATE] 2026-10-29 08:00\nProject: dotfiles\nAdd a pane with two keys.\nThen show it on the phone.' })).toBeDefined()
  await pane.press({ key: 'view:back' })

  await pane.press({ key: 'open:written by hand' })
  expect(await pane.find({ type: 'Text', text: 'No objective or update holds this item: it was written in the todo list.' })).toBeDefined()
  await pane.unmount()
})

test('d opens the selected item, the ring on the text of a row selects it, and the help names the keys', async ($, on) => {
  const { pane } = await keynav($, on, { [BOUND]: SOURCED })
  expect((await pane.find({ key: 'item:open' }))?.props).toMatchObject({ hotkey: 'd' })
  expect(
    await pane.find({ type: 'Text', text: 'j and k select the next and previous item (Up and Down walk every marker and text), Enter or a click on its marker cycles its status, d or a click on its text opens it, f and p step it forward and back, z pauses it with a reason, 1 to 6 show or hide a status' }),
  ).toBeDefined()
  await pane.press({ key: 'item:open' })
  expect(await pane.find({ type: 'Text', text: '1. Ship the bridge\n   See the notes\n   - https://example.com/spec' })).toBeDefined()
  await pane.press({ key: 'view:back' })
  await ring($, 'open:add a pane with two keys.')
  expect(await selectedTodo(pane)).toEqual(['add a pane with two keys.'])
  await pane.press({ key: 'item:open' })
  expect(await pane.find({ type: 'Text', text: 'From an update' })).toBeDefined()
  await pane.unmount()
})

test('a toggle, or a status change that hides a row, draws the selected row under a key not drawn before, and the ring on it selects it', async ($, on) => {
  const { pane } = await keynav($, on)
  const drawn = new Set((await todoRows(pane)).map(row => row.key))
  const handed = async () => {
    const key = await selectedKey(pane)
    expect(key !== undefined && !drawn.has(key)).toBe(true)
    for (const row of await todoRows(pane)) drawn.add(row.key)
    return key ?? ''
  }
  await pane.press({ key: 'show:done' })
  await flush()
  const one = await handed()
  expect(await selectedTodo(pane)).toEqual(['one'])
  await ring($, 'todo:two')
  expect(await selectedTodo(pane)).toEqual(['two'])
  await ring($, one)
  expect(await selectedTodo(pane)).toEqual(['one'])

  await ring($, 'todo:two')
  await pane.press({ key: 'todo:two' })
  await flush()
  await handed()
  expect(await selectedTodo(pane)).toEqual(['four'])

  await pane.press({ key: 'show:done' })
  await flush()
  await handed()
  expect(await selectedTodo(pane)).toEqual(['four'])
  await pane.unmount()
})

test('a click in the notes pane while the prompt holds the keyboard hands the keyboard to the pane', async ($, on) => {
  const fs: Fs = { [BOUND]: KEYNAV }
  const { ui } = engine(on, fs, { ...SESSION_BOUND })
  on('ui.focus', () => ({ value: {} }) as never)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  // The person clicks the prompt: it takes the keyboard back from the pane.
  ui.panes.set('notes-keeping', { isFocused: false })
  const opens = ui.opened.length
  await pane.press({ key: 'todo:three' })
  await flush()
  expect(marker(fs, 'Three')).toBe('-')
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping', focus: true }])
  expect(ui.panes.get('notes-keeping')?.isFocused).toBe(true)
  // A press while the pane already holds the keyboard opens nothing again.
  await pane.press({ key: 'status:next' })
  await flush()
  expect(ui.opened.slice(opens)).toEqual([{ id: 'notes-keeping', focus: true }])
  await pane.unmount()
})

test('a click on a todo row selects it, so f and p step the clicked item', async ($, on) => {
  const { fs, pane } = await keynav($, on)
  expect(await selectedTodo(pane)).toEqual(['one'])
  await pane.press({ key: 'todo:two' })
  await flush()
  expect(marker(fs, 'Two')).toBe('x')
  expect(await selectedTodo(pane)).toEqual(['two'])
  await pane.press({ key: 'status:prev' })
  await flush()
  expect(marker(fs, 'Two')).toBe('~')
  expect(marker(fs, 'One')).toBe(' ')
  await pane.unmount()
})

test('in the Todos view j selects the next shown item and k the previous one, staying put at either end', async ($, on) => {
  const { pane } = await keynav($, on)
  expect((await pane.find({ key: 'select:down' }))?.props).toMatchObject({ hotkey: 'j' })
  expect((await pane.find({ key: 'select:up' }))?.props).toMatchObject({ hotkey: 'k' })
  expect(await selectedTodo(pane)).toEqual(['one'])
  const seen: string[][] = []
  for (const key of ['select:down', 'select:down', 'select:down', 'select:down', 'select:up']) {
    await pane.press({ key })
    await flush()
    seen.push(await selectedTodo(pane))
  }
  expect(seen).toEqual([['two'], ['three'], ['four'], ['four'], ['three']])
  // A hidden status is skipped.
  await pane.press({ key: 'show:in-progress' })
  await flush()
  await ring($, 'todo:one')
  await pane.press({ key: 'select:down' })
  await flush()
  expect(await selectedTodo(pane)).toEqual(['three'])
  await pane.unmount()
})

test('the shown statuses stay as set when the panel is closed and opened again', async ($, on) => {
  const { pane } = await keynav($, on)
  await pane.press({ key: 'show:declined' })
  await pane.unmount()
  await run($, 'hide')
  await run($, 'show')
  const again = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await again.find({ key: 'show:declined' }))?.props.label).toBe('[-] declined: hidden')
  expect(await again.find({ key: 'todo:four' })).toBeUndefined()
  await again.unmount()
})

// One block of an assistant reply as the transcript draws it, in the row `requestId`.
function reply(requestId: string, text: string, isFirstOfReply = true) {
  return { plugin: 'notes-keeping', component: 'AssistantMessage', requestId, surface: 'terminal', props: { text, isFirstOfReply } } as const
}

test('a reply to text selected in an assistant row marks that text as a link in the row, queued and once sent; a click opens the note', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n' }
  let selection: string | undefined
  const sent = submitting(on)
  const { clock, ui } = engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => selection)
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const source = 'The quick **brown** fox jumps.'

  // No note yet: the engine draws the row.
  const before = await $.ui.mount(reply('row-1', source))
  expect(await before.find({ type: 'Markdown' })).toBeUndefined()
  await before.unmount()

  selection = 'brown fox'
  await clock.advance(1200)
  const menu = await $.ui.mount({ ...SELECT_PANE, surface: 'terminal' })
  await menu.press({ key: 'reply-open' })
  await menu.input({ key: 'reply', text: 'Too slow' })
  await menu.unmount()
  selection = undefined

  const queued = await $.ui.mount(reply('row-1', source))
  const text = (await queued.find({ type: 'Markdown' }))?.props.text as string
  const href = /\]\((https:[^)]+)\)/.exec(text)?.[1] ?? ''
  expect(text).toBe(`The quick [**brown** fox](${href}) jumps.`)
  // The drawing replaces the engine's, gutter included: the reply's bullet on its first block, two blanks on the others.
  expect(await queued.find({ type: 'Text', text: '⏺ ' })).toBeDefined()
  await queued.unmount()
  const later = await $.ui.mount(reply('row-1', source, false))
  expect(await later.find({ type: 'Text', text: '⏺ ' })).toBeUndefined()
  expect(await later.find({ type: 'Text', text: '  ' })).toBeDefined()
  await later.unmount()
  // Another row holding the same text is not the one selected.
  const other = await $.ui.mount(reply('row-2', source))
  expect(await other.find({ type: 'Markdown' })).toBeUndefined()
  await other.unmount()

  await submit($, 'carry on')
  expect(sent.at(-1)?.text).toBe('[AI_AGENT] brown fox\n[USER] Too slow\n\ncarry on')
  const id = href.split('/').pop()
  expect(sections(fs[BOUND] ?? '').chat).toBe(`[AI_AGENT] brown fox <!-- note:${id} row:row-1 at:0 -->\n[USER] Too slow\n\n[USER] carry on`)

  const row = await $.ui.mount(reply('row-1', source))
  expect((await row.find({ type: 'Markdown' }))?.props.text).toBe(text)
  await row.press({ key: 'notes', link: { href } })
  expect(ui.opened.at(-1)).toEqual({ id: 'notes-keeping', focus: true })
  await row.unmount()
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: '[AI_AGENT] brown fox' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[USER] Too slow' })).toBeDefined()
  await pane.unmount()
})

test('a resumed session marks the rows its notes file anchors as soon as it starts, before anything else reads the file', async ($, on) => {
  const note = ' <!-- note:k3x9 row:row-1 at:0 -->'
  const fs: Fs = { [BOUND]: `# Objectives\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n\n[AI_AGENT] brown fox${note}\n[USER] Too slow\n` }
  engine(on, fs, { [`session:${SESSION}`]: BOUND })
  engineDraws(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  const row = await $.ui.mount(reply('row-1', 'The quick brown fox jumps.'))
  expect((await row.find({ type: 'Markdown' }))?.props.text).toBe('The quick [brown fox](https://notes-keeping.invalid/note/k3x9) jumps.')
  await row.unmount()
})

test('a reply moved into the prompt with s keeps its anchor in # Chat', async ($, on) => {
  const fs: Fs = { [BOUND]: '# Objectives\n\nPlan\n\n## Updates\n\n# Important\n\n# Chat\n' }
  engine(on, fs, { [`session:${SESSION}`]: BOUND }, () => 'brown fox')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await run($, 'reply Too slow')
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'send' })
  await pane.unmount()
  expect(sections(fs[BOUND] ?? '').chat).toBe(`[AI_AGENT] brown fox${anchor('row-1', 'brown fox', 'Too slow')}\n[USER] Too slow`)
})

// A fleet row as `bridge fleet` prints it.
function fleetRow(task: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { task, kind: 'ship', title: null, word: 'working', at: null, flag: '', waiting: '', window: `s:fm-${task}`, live: true, gone: false, pr: null, report: null, summary: null, todo: null, answer: null, ...extra }
}
// The fake clock's time in seconds, as the bridge stamps rows.
const SECONDS = Math.floor(new Date(2026, 9, 26, 10, 58).getTime() / 1000)
const FLEET = {
  rows: [
    fleetRow('decide-x', { kind: 'captain', title: 'Harness decisions', word: 'call', at: SECONDS - 7200, flag: '!', waiting: 'you: D1 learned facts', window: null, live: false, answer: 'origin-x decide-x', origin: 'origin-x' }),
    fleetRow('ask', { title: 'Sentry injected filter', word: 'decision', at: SECONDS - 120, flag: '?', waiting: 'firstmate: new PR body', pr: 'https://x/pull/27970', answer: 'ask pr-body' }),
    fleetRow('run-a', { title: 'OpenUI POC', at: SECONDS - 60, waiting: 'worker: implementing', todo: 'ab12cd3' }),
    fleetRow('old', { word: 'done', at: SECONDS - 900000, waiting: 'PR https://x/pull/1', live: false, gone: true }),
  ],
  calls: 2,
}

async function work($: Engine, on: On, selection: () => string | undefined = () => undefined, extra: Fs = {}) {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] **Build the table**: build the fleet table <!-- id:ab12cd3 -->'), [PYTHON]: '', [BRIDGE]: '', ...extra }
  const { clock, git, ui } = engine(on, fs, { ...SESSION_BOUND }, selection)
  on('ui.focus', () => ({ value: {} }) as never)
  fakeLaya()
  bridge.fleet = FLEET
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await flush()
  await clock.advance(5_000)
  await flush()
  return { clock, git, ui }
}

test('the refresh tick reads bridge fleet with the notes file; a live call that needs the captain pins the status line and notifies once', async ($, on) => {
  const { clock, ui } = await work($, on)
  expect(bridge.argv.filter(call => call[1] === 'fleet')).toEqual([[BRIDGE, 'fleet', BOUND]])
  expect(ui.status.at(-1)).toBe('work: 1 needs you · w')
  expect(ui.notices).toEqual([{ text: 'Harness decisions: D1 learned facts', title: 'Firstmate' }])
  await clock.advance(5_000)
  await flush()
  expect(ui.notices).toHaveLength(1)
  bridge.fleet = { rows: [], calls: 0 }
  await clock.advance(5_000)
  await flush()
  expect(ui.status.at(-1)).toBeUndefined()
})

test("a ? row raises no notification and no status line: it is firstmate's move", async ($, on) => {
  const { clock, ui } = await work($, on)
  bridge.fleet = { rows: [FLEET.rows[1] as Record<string, unknown>], calls: 0 }
  ui.notices.length = 0
  await clock.advance(5_000)
  await flush()
  expect(ui.notices).toEqual([])
  expect(ui.status.at(-1)).toBeUndefined()
})

test('a queued reply and a call that needs the captain share the one status line', async ($, on) => {
  const { ui } = await work($, on, () => 'brown fox')
  await run($, 'reply Too slow')
  expect(ui.status.at(-1)).toBe('notes: 1 reply queued, sent with your next message. Ctrl+q: edit, remove, send · work: 1 needs you · w')
})

test('the Work tab carries the count of rows that need the captain; Todos stays the view the panel opens on', async ($, on) => {
  await work($, on)
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'view:work' }))?.props).toMatchObject({ hotkey: 'w', label: 'Work (1!)' })
  expect(await pane.find({ key: 'show:todo' })).toBeDefined()
  await pane.unmount()
})

test('without a bridge the panel has no Work tab and runs no fleet read', async ($, on) => {
  const fs: Fs = { [BOUND]: setTodoFile('- [ ] One'), [PYTHON]: '' }
  const { clock } = engine(on, fs, { ...SESSION_BOUND })
  fakeLaya()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.advance(5_000)
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'view:work' })).toBeUndefined()
  expect(bridge.calls).toEqual([])
  await pane.unmount()
})

test('the Work view lists ! rows, then ? rows, then the rest; a row is named by its linked todo label, else its title; gone records are hidden and counted, 6 shows them', async ($, on) => {
  await work($, on)
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  const rows = async () => (await pane.findAll({ type: 'Button' })).filter(button => FLEET.rows.some(row => `work:${row.task}` === button.key))
  expect((await rows()).map(button => button.key)).toEqual(['work:decide-x', 'work:ask', 'work:run-a'])
  const labels = (await rows()).map(button => String(button.props.label))
  expect(labels[0]).toMatch(/^! Harness decisions +call +2h  you: D1 learned facts$/)
  expect(labels[1]).toMatch(/^\? Sentry injected filter +decision +2m  firstmate: new PR body$/)
  expect(labels[2]).toMatch(/^ {2}Build the table +working +1m  worker: implementing$/)
  expect(await pane.find({ type: 'Text', text: /^Work {2}3 rows · 1 needs you · 1 firstmate · read \d\d:\d\d:\d\d UTC \(\d+[smhd] ago\)$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '+1 gone task records hidden (worktree or window gone)  6: show' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '+2 other calls · /bearings' })).toBeDefined()
  await pane.press({ key: 'work-show:gone' })
  expect((await rows()).map(button => button.key)).toEqual(['work:decide-x', 'work:ask', 'work:run-a', 'work:old'])
  expect(await pane.find({ type: 'Text', text: /gone task records hidden/ })).toBeUndefined()
  await pane.press({ key: 'work-show:firstmate' })
  expect((await rows()).map(button => button.key)).toEqual(['work:decide-x', 'work:run-a', 'work:old'])
  await pane.unmount()
})

test('a on a ? row fills the prompt with "<task> <key>: <text>" for the captain to send; nothing is closed from the plugin', async ($, on) => {
  const { ui } = await work($, on)
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  await ring($, 'work:ask')
  expect((await pane.find({ key: 'work:answer' }))?.props).toMatchObject({ hotkey: 'a' })
  await pane.press({ key: 'work:answer' })
  // A key not drawn before, which the plugin's $.ui.focus waits for; the fake engine has no ring to check that on.
  expect((await pane.find({ key: 'work:reply' }))?.type).toBe('Input')
  await pane.input({ key: 'work:reply', text: 'ship the new body' })
  expect(ui.fills).toEqual([{ text: 'ask pr-body: ship the new body', mode: 'insert' }])
  expect(bridge.calls.filter(verb => !['fleet', 'status', 'pending', 'notify'].includes(verb))).toEqual([])
  await pane.unmount()
})

test('a is not offered on a row that waits on nobody but its worker', async ($, on) => {
  await work($, on)
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  await ring($, 'work:run-a')
  expect(await pane.find({ key: 'work:answer' })).toBeUndefined()
  await pane.unmount()
})

test('Enter on a row opens its details; y copies the PR link, r reads the crew state for that one task, g goes to its window', async ($, on) => {
  const { git, ui } = await work($, on)
  bridge.crew = 'state: done · source: run-step · checks green\n'
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  await pane.press({ key: 'work:ask' })
  expect(await pane.find({ type: 'Text', text: /^Sentry injected filter {2}· {2}ask {2}· {2}ship/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'last    decision 2m ago: firstmate: new PR body' })).toBeDefined()
  await pane.press({ key: 'work:copy' })
  expect(ui.copied).toEqual(['https://x/pull/27970'])
  await pane.press({ key: 'work:crew' })
  expect(bridge.argv.filter(call => call[1] === 'crew')).toEqual([[BRIDGE, 'crew', 'ask']])
  expect(await pane.find({ type: 'Text', text: 'crew    state: done · source: run-step · checks green' })).toBeDefined()
  await pane.press({ key: 'work:go' })
  expect(git.calls).toContainEqual(['tmux', 'switch-client', '-t', 's:fm-ask'])
  await pane.unmount()
})

const REPORT = '/fm/data/cleanroom-poc/report.md'
const REPORT_TEXT = '# Cleanroom POC\n\nStatus: BLOCKED at step 1.\n\n## What is needed from the captain\n\n1. Start the app.\n'
const REPORTED = fleetRow('cleanroom-poc', {
  kind: 'scout', word: 'blocked', at: SECONDS - 600, flag: '?', waiting: 'firstmate: worker gone; last: app down', live: false, pr: 'https://x/pull/9', report: REPORT,
  summary: { title: 'Cleanroom POC', outcome: 'BLOCKED at step 1.', ask: 'Start the app.', at: SECONDS - 86400 }, answer: 'cleanroom-poc',
})

test('the Work view puts rows under a header per group, and a row with a report carries its title, outcome and ask beneath it', async ($, on) => {
  const { clock } = await work($, on)
  bridge.fleet = { rows: [...FLEET.rows, REPORTED], calls: 0 }
  await clock.advance(5_000)
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  const texts = (await pane.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts.filter(text => /^(Needs you|Firstmate|Running|Idle|Done|Gone) · \d+$/.test(text ?? ''))).toEqual(['Needs you · 1', 'Firstmate · 2', 'Running · 1'])
  const at = texts.indexOf('Firstmate · 2')
  expect(texts.slice(at + 1, at + 3)).toEqual(['    report 1d  Cleanroom POC: BLOCKED at step 1.', '    needs  Start the app.'])
  const label = String((await pane.find({ key: 'work:cleanroom-poc' }))?.props.label)
  expect(label).toMatch(/blocked +10m  gone: app down$/)
  await pane.unmount()
})

test('v reads the report in the pane, even on a row with a PR; y there copies its path, u opens the PR, e opens the report in the editor, b goes back', async ($, on) => {
  shell.vars = { EDITOR: 'hx', TMUX: '/tmp/tmux-1/default,1,0' }
  const { clock, git, ui } = await work($, on, undefined, { [REPORT]: REPORT_TEXT })
  bridge.fleet = { rows: [REPORTED], calls: 0 }
  await clock.advance(5_000)
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  await ring($, 'work:cleanroom-poc')
  expect((await pane.find({ key: 'work:view' }))?.props).toMatchObject({ hotkey: 'v', label: 'read report' })
  expect((await pane.find({ key: 'work:pr' }))?.props).toMatchObject({ hotkey: 'u', label: 'open PR' })
  await pane.press({ key: 'work:view' })
  expect(await pane.find({ type: 'Text', text: 'Cleanroom POC' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: `${REPORT} · written 1d ago` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'needs    Start the app.' })).toBeDefined()
  expect((await pane.find({ key: 'work:report-text' }))?.props).toMatchObject({ text: REPORT_TEXT })
  await pane.press({ key: 'work:copy' })
  expect(ui.copied).toEqual([REPORT])
  await pane.press({ key: 'work:pr' })
  expect(git.calls).toContainEqual(['open', 'https://x/pull/9'])
  await pane.press({ key: 'work:edit' })
  await flush()
  expect(shell.spawned).toEqual([['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', `hx '${REPORT}'`]])
  await pane.press({ key: 'view:back' })
  expect(await pane.find({ type: 'Text', text: /^cleanroom-poc {2}· {2}cleanroom-poc/ })).toBeDefined()
  await pane.unmount()
})

test('a report the pane cannot read says so and keeps e and y', async ($, on) => {
  const { clock } = await work($, on)
  bridge.fleet = { rows: [{ ...REPORTED, summary: null }], calls: 0 }
  await clock.advance(5_000)
  await flush()
  await run($, 'show')
  const pane = await $.ui.mount({ ...NOTES_PANE, surface: 'terminal' })
  await pane.press({ key: 'view:work' })
  await ring($, 'work:cleanroom-poc')
  await pane.press({ key: 'work:view' })
  expect(await pane.find({ type: 'Text', text: /^Cannot read .*cleanroom-poc\/report\.md/ })).toBeDefined()
  expect(await pane.find({ key: 'work:edit' })).toBeDefined()
  expect(await pane.find({ key: 'work:copy' })).toBeDefined()
  await pane.unmount()
})
