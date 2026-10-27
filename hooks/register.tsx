import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Notes, Pair, Select, Todo, View } from '../types'
import {
  AGENT_TAG,
  USER_TAG,
  addChat,
  addImportant,
  addSession,
  addTurn,
  addUpdate,
  chatPair,
  create,
  fileName,
  inject,
  nameParts,
  newestFirst,
  projectName,
  sections,
  setContinuation,
  setObjectives,
  stamp,
  summary,
} from './notes'
import { TodoSlot, nextStatus } from './todos'

const NAME = 'notes-keeping'
const PANE = 'notes-keeping'
const SELECT = 'notes-keeping-select'
const TITLE = 'Notes'
const DIR = '.notes-keeping'
// An engine action with no handler mounted at the prompt; a Global binding of the chord in the user's keybindings.json presses it.
const ACTION = 'app:cycleDiffBase'
const CHORD = 'ctrl+q'
const GIT_MS = 10_000
const POLL_MS = 600
const REFRESH_MS = 5_000
const PREVIEW = 60
const HISTORY_CAP = 20
const HEAD_CHARS = 200
const NEAR = 2

const SUBCOMMANDS = ['init', 'objectives', 'update', 'important', 'reply', 'replies', 'history', 'show', 'hide']

const USAGE = [
  'Usage: /notes-keeping <subcommand>',
  '  init [--new] [objectives]  start this session\'s notes; text sets the objectives',
  '  objectives <text>          set the objectives; once set, add an [UPDATE] under ## Updates',
  '  update <text>              same as objectives',
  '  important [text]           add text, or the selected text, to # Important',
  '  reply <text>               queue the selected text and your reply; they go out with your next message',
  '  replies                    open the panel at the queue: every reply editable, s moves all into the prompt',
  '  history [n|file]           list earlier notes; pick one to continue it here',
  `  show | hide                open or close the notes panel (also ${CHORD}); o objectives, i important, c chat, e queue, s send queue`,
  `${CHORD} works once ~/.claude/keybindings.json binds it: { "bindings": [{ "context": "Global", "bindings": { "${CHORD}": "${ACTION}" } }] }`,
  'Every write starts the notes file when the session has none.',
].join('\n')

const notes = atom({ plugin: 'notes-keeping', key: 'notes' } as const, null as Notes | null)
const select = atom({ plugin: 'notes-keeping', key: 'select' } as const, null as Select | null)
const handled = atom({ plugin: 'notes-keeping', key: 'handled' } as const, '')
const queue = atom({ plugin: 'notes-keeping', key: 'queue' } as const, [] as Pair[])
const editing = atom({ plugin: 'notes-keeping', key: 'editing' } as const, false)
const view = atom({ plugin: 'notes-keeping', key: 'view' } as const, 'overview' as View)
const todos = atom({ plugin: 'notes-keeping', key: 'todos' } as const, [] as Todo[])
const isNotesOpen = atom({ plugin: 'notes-keeping', key: 'isNotesOpen' } as const, false)

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error'
}

function bindKey(sessionId: string): string {
  return `session:${sessionId}`
}

function headKey(sessionId: string): string {
  return `head:${sessionId}`
}

// The file a /clear or a /resume left behind; the next session id to look for its notes takes it.
let carried: string | undefined
// A session that starts with messages was continued or resumed: its first prompt carries the notes.
let resumed = false
// The selection the last poll read: a drag still under way changes it between polls.
let seen = ''
// Closing the dock widens the transcript, and the kept selection then covers other text.
let isClosed = false

async function boundPath($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  const path = await $.store.get(bindKey(id))
  if (typeof path === 'string') return path
  if (carried === undefined) return undefined
  const kept = carried
  carried = undefined
  await $.store.set(bindKey(id), kept)
  warn($, told('', await save($, kept, addSession(await readText($, kept), id), 'session')))
  return kept
}

async function readText($: EngineInterface, path: string): Promise<string> {
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text : ''
}

async function notesDir($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/${DIR}`
}

async function publish($: EngineInterface, path: string, text: string): Promise<void> {
  await update($, notes, () => ({ path, sections: sections(text) }))
}

// Commits every write in the notes folder's own repository; never pushes. Returns what the user must hear.
async function commit($: EngineInterface, dir: string, subject: string): Promise<string[]> {
  if (!(await $.fs.exists(`${dir}/.git`))) await $.process.run(['git', '-C', dir, 'init', '-q'], { timeoutMs: GIT_MS })
  await $.process.run(['git', '-C', dir, 'add', '-A'], { timeoutMs: GIT_MS })
  const done = await $.process.run(['git', '-C', dir, 'commit', '-q', '-m', subject], { timeoutMs: GIT_MS })
  const said: string[] = []
  if (done.exitCode !== 0 && !/nothing to commit/.test(done.stdout)) {
    said.push(`git commit in ${dir} failed: ${(done.stderr.trim() || done.stdout.trim()).split('\n')[0]}`)
  }
  const remotes = (await $.process.run(['git', '-C', dir, 'remote'], { timeoutMs: GIT_MS })).stdout.trim()
  if (remotes !== '') {
    said.push(`Warning: ${dir} has a git remote (${remotes.split('\n').join(', ')}). notes-keeping never pushes, but a push would publish your notes.`)
  }
  return said
}

async function save($: EngineInterface, path: string, text: string, subject: string): Promise<string[]> {
  await $.fs.write(path, text)
  await publish($, path, text)
  return commit($, await notesDir($), `${subject}: ${path.split('/').pop()}`)
}

async function start($: EngineInterface, objectives: string): Promise<{ path: string; said: string[] }> {
  const dir = await notesDir($)
  const taken = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(entry => entry.name) : []
  const id = await $.session.id()
  const path = `${dir}/${fileName(projectName(await $.session.root()), id, await $.clock.now(), taken)}`
  await $.store.set(bindKey(id), path)
  return { path, said: await save($, path, create(objectives, id), 'init') }
}

// The session's notes file, started with empty objectives when it has none.
async function bound($: EngineInterface): Promise<{ path: string; said: string[] }> {
  const path = await boundPath($)
  if (path !== undefined) return { path, said: [] }
  const started = await start($, '')
  $.ui.toast(`Notes started: ${started.path}`)
  return started
}

async function edit($: EngineInterface, subject: string, change: (text: string) => string): Promise<string[]> {
  const { path, said } = await bound($)
  return [...said, ...(await save($, path, change(await readText($, path)), subject))]
}

function told(text: string, said: readonly string[]): string {
  return [text, ...said].join('\n')
}

// A press has no output row: what follows the first line goes to a toast.
function warn($: EngineInterface, text: string): void {
  const rest = text.split('\n').slice(1).join(' ')
  if (rest !== '') $.ui.toast(rest)
}

async function guard($: EngineInterface, path: string): Promise<string | undefined> {
  const dir = await notesDir($)
  return path === dir || path.startsWith(`${dir}/`)
    ? `${NAME}: ${path} is the user's notes; only the user writes them, through /notes-keeping.`
    : undefined
}

async function listNotes($: EngineInterface): Promise<string[]> {
  const dir = await notesDir($)
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return newestFirst(entries.filter(entry => entry.kind === 'file').map(entry => entry.name))
}

// Sets the objectives while they are empty; after that each text is an [UPDATE] under ## Updates.
async function objectives($: EngineInterface, text: string): Promise<string> {
  const { path, said } = await bound($)
  const md = await readText($, path)
  if (sections(md).objectives === '') {
    return told('Objectives set.', [...said, ...(await save($, path, setObjectives(md, text), 'objectives'))])
  }
  const when = stamp(await $.clock.now())
  return told('Objectives updated under ## Updates.', [...said, ...(await save($, path, addUpdate(md, when, text), 'update'))])
}

async function init($: EngineInterface, args: string): Promise<string> {
  const isNew = /^--new\b/.test(args)
  const text = args.replace(/^--new\b\s*/, '').trim()
  const current = await boundPath($)
  if (current !== undefined && !isNew) {
    if (text === '') return `This session already keeps ${current}. Run /notes-keeping init --new [objectives] to start a new file for it.`
    return told(`This session keeps ${current}.`, [await objectives($, text)])
  }
  const { path, said } = await start($, text)
  return told(`Notes started: ${path}`, said)
}

async function history($: EngineInterface, args: string): Promise<{ text: string; context?: string[] }> {
  const current = await boundPath($)
  const names = (await listNotes($)).filter(name => current === undefined || !current.endsWith(`/${name}`))
  if (names.length === 0) return { text: 'No earlier notes.' }
  const dir = await notesDir($)
  if (args === '') {
    const rows = await Promise.all(
      names.slice(0, HISTORY_CAP).map(async (name, i) => {
        const line = summary(await readText($, `${dir}/${name}`).catch(() => ''))
        const parts = nameParts(name)
        const label = parts === undefined ? name : `${parts.date} ${parts.time}  ${parts.project}  ${parts.shortId}`
        return `${String(i + 1).padStart(2)}. ${label}  ${line.slice(0, PREVIEW)}`
      }),
    )
    const more = names.length > HISTORY_CAP ? [`(${names.length - HISTORY_CAP} older not listed)`] : []
    return { text: [...rows, ...more, '', 'Continue one here: /notes-keeping history <n|file>'].join('\n') }
  }
  const pick = /^\d+$/.test(args) ? names[Number(args) - 1] : names.find(name => name === args || name === `${args}.md`)
  if (pick === undefined) return { text: `No earlier notes match "${args}".` }
  const previous = await readText($, `${dir}/${pick}`)
  const said = await edit($, 'continue', text => setContinuation(text, pick))
  return {
    text: told(`Continuing ${pick}: the whole file is now in context.`, said),
    context: [inject(previous, `${dir}/${pick}`)],
  }
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length] ?? 0
}

function unknown(sub: string): string {
  const near = SUBCOMMANDS.map(name => ({ name, d: distance(sub, name) })).sort((a, b) => a.d - b.d)[0]
  const said = near !== undefined && near.d <= NEAR ? `unknown subcommand ${sub}, did you mean ${near.name}?` : `unknown subcommand ${sub}`
  return `${said}\n${USAGE}`
}

async function selected($: EngineInterface): Promise<string> {
  return ((await $.ui.selection())?.text ?? '').trim()
}

async function important($: EngineInterface, text: string, tag: string): Promise<string> {
  return told('Added to # Important.', await edit($, 'important', md => addImportant(md, tag, text)))
}

function showQueue($: EngineInterface, n: number): void {
  $.ui.status(n === 0 ? undefined : `notes: ${n} repl${n === 1 ? 'y' : 'ies'} queued, sent with your next message. /notes-keeping replies: edit, remove, send`)
}

// The selection is answered: the same text does not raise the pane again until it changes.
async function finish($: EngineInterface, selection: string): Promise<void> {
  await update($, handled, () => selection)
  await update($, select, () => null)
  await $.ui.close({ id: SELECT })
  isClosed = true
}

async function queueReply($: EngineInterface, agent: string, user: string): Promise<void> {
  const next = await update($, queue, list => [...list, { agent, user }])
  showQueue($, next.length)
  await finish($, agent)
}

// Moves every queued reply into the prompt box; the user presses Enter. Nothing is sent from here.
async function sendQueue($: EngineInterface): Promise<void> {
  const pending = await read($, queue)
  if (pending.length === 0) {
    $.ui.toast('No replies queued.')
    return
  }
  const filled = await $.prompt.fill({ text: pending.map(pair => chatPair(pair.agent, pair.user)).join('\n\n'), mode: 'insert' })
  if (!filled.isFilled) {
    $.ui.toast('The prompt box cannot take the replies now; they stay queued.')
    return
  }
  warn($, told('', await edit($, 'reply', md => pending.reduce((text, pair) => addChat(text, pair.agent, pair.user), md))))
  await update($, queue, () => [])
  showQueue($, 0)
}

async function openSelect($: EngineInterface, selection: string): Promise<void> {
  await update($, select, () => ({ mode: 'menu', selection, isPlaced: false, hadFocus: false }))
  const opened = await $.ui.open({ id: SELECT, title: 'Selection', focus: true, closeOnEscape: true, rows: 4 })
  await update($, select, current => (current === null ? null : { ...current, isPlaced: opened.isPlaced }))
}

async function openReply($: EngineInterface, selection: string): Promise<void> {
  await update($, select, () => ({ mode: 'reply', selection, isPlaced: true, hadFocus: false }))
  await $.ui.open({ id: SELECT, title: 'Reply', focus: true, closeOnEscape: true, rows: 4 })
}

async function refresh($: EngineInterface): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  await publish($, path, await readText($, path))
}

async function showNotes($: EngineInterface, at: View = 'overview'): Promise<void> {
  await refresh($)
  await update($, view, () => at)
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  await update($, isNotesOpen, () => true)
}

// A close the mod asks for itself does not pass through its own ui.close hook.
async function hideNotes($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await update($, editing, () => false)
  await update($, isNotesOpen, () => false)
}

async function toggleNotes($: EngineInterface): Promise<void> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) await hideNotes($)
  else await showNotes($)
}

function isDrawn(surface: string): boolean {
  return surface === 'terminal' || surface === 'desktop'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: NAME,
      description: 'Session notes: objectives, important, queued replies, history, show, hide',
      argumentHint: 'init|objectives|update|important|reply|replies|history|show|hide [text]',
    })
    resumed = (await $.session.messages()).length > 0
    if (e.isInteractive) {
      $.clock.every(POLL_MS, async () => {
        const current = await read($, select)
        if (current?.mode === 'reply') return
        const isFocused = (await $.ui.panes()).some(pane => pane.id === SELECT && pane.isFocused)
        // A key that is none of r/i/x hands the keyboard back to the prompt: the menu goes with it.
        if (current !== null && current.hadFocus && !isFocused) {
          await finish($, current.selection)
          return
        }
        if (current !== null && isFocused && !current.hadFocus) await update($, select, () => ({ ...current, hadFocus: true }))
        const text = await selected($)
        // The first selection read after a close is the old one, moved by the reflow: it counts as answered.
        if (isClosed) {
          isClosed = false
          if (text !== '') await update($, handled, () => text)
          return
        }
        // A docked pane narrows the transcript and the terminal drops the selection, so an open pane outlives it.
        if (text === '') {
          seen = ''
          if (current !== null && !current.isPlaced) await update($, select, () => null)
          if (current === null && (await read($, handled)) !== '') await update($, handled, () => '')
          return
        }
        if (text === (await read($, handled)) || text === current?.selection) return
        // Opening the dock mid-drag reflows the transcript under the pointer, so the pane waits for a still selection.
        if (text !== seen) {
          seen = text
          return
        }
        await openSelect($, text)
      })
      $.clock.every(REFRESH_MS, async () => {
        const panes = await $.ui.panes()
        if (panes.some(pane => pane.id === PANE)) await refresh($)
      })
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') carried = await boundPath($)
    if (e.reason === 'clear') {
      await update($, queue, () => [])
      showQueue($, 0)
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === SELECT) {
      const current = await read($, select)
      if (current !== null) {
        await update($, handled, () => current.selection)
        await update($, select, () => null)
      }
      isClosed = true
    }
    if (e.id === PANE) {
      await update($, editing, () => false)
      await update($, isNotesOpen, () => false)
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const trimmed = e.args.trim()
    const sub = trimmed.split(/\s+/)[0] ?? ''
    const rest = trimmed.slice(sub.length).trim()
    try {
      switch (sub) {
        case 'init':
          return { text: await init($, rest) }
        case 'objectives':
        case 'update':
          if (rest === '') return { text: `Usage: /notes-keeping ${sub} <text>` }
          return { text: await objectives($, rest) }
        case 'important': {
          const text = rest || (await selected($))
          if (text === '') return { text: 'Nothing to keep: give text or select some first.' }
          return { text: await important($, text, rest === '' ? AGENT_TAG : USER_TAG) }
        }
        case 'reply': {
          const agent = await selected($)
          if (agent === '') return { text: 'Select the text to reply to first.' }
          if (rest === '') return { text: 'Usage: /notes-keeping reply <your reply>' }
          await queueReply($, agent, rest)
          return { text: 'Reply queued; it goes out with your next message.' }
        }
        case 'replies':
          await showNotes($, 'queue')
          return {}
        case 'history':
          return await history($, rest)
        case 'show':
          await showNotes($)
          return {}
        case 'hide':
          await hideNotes($)
          return {}
        case '':
          return { text: USAGE }
        default:
          return { text: unknown(sub) }
      }
    } catch (error) {
      return { text: `notes-keeping: ${message(error)}` }
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await guard($, e.file_path)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: its notes guard failed.` }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await guard($, e.file_path)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: its notes guard failed.` }))

  // Queued replies go out ahead of the user's own Enter, and that turn is recorded in # Chat.
  // Compaction puts its summary in place of the first message, so a changed first message means one ran.
  // On this machine the managed-settings plugin bypasses classic.SessionStart, prompt.context and
  // session.compact for user plugins; prompt.submit is the hook that still reaches the model.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const pending = e.origin.kind === 'composer' && e.isMeta !== true ? await read($, queue) : []
    let text = e.text
    if (pending.length > 0) {
      text = [...pending.map(pair => chatPair(pair.agent, pair.user)), e.text].join('\n\n')
      warn($, told('', await edit($, 'reply', md => addTurn(md, pending, e.text))))
      await update($, queue, () => [])
      showQueue($, 0)
    }
    const path = await boundPath($)
    const isResumed = resumed
    resumed = false
    if (path === undefined) return next({ ...e, text })
    const key = headKey(await $.session.id())
    const seen = await $.store.get(key)
    // Every summary opens with the same sentence, so the tail and the length tell two apart.
    const first = (await $.session.messages())[0]?.text ?? ''
    const head = `${first.length}:${first.slice(-HEAD_CHARS)}`
    await $.store.set(key, head)
    if (!isResumed && (typeof seen !== 'string' || seen === head)) return next({ ...e, text })
    return next({ ...e, text, context: [...(e.context ?? []), inject(await readText($, path), path)] })
  })

  // Under the prompt, beside the engine's hint: the Notes toggle, always drawn, pressed by click or chord.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!isDrawn(e.surface)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, isNotesOpen)
    const waiting = (await read($, queue)).length
    return (
      <Box flexDirection="row" gap={2}>
        <Text dimColor wrap="truncate-end">
          {e.props.hint}
        </Text>
        <Button
          key="notes-toggle"
          plain
          dimColor
          action={ACTION}
          label={`Notes: ${isOpen ? 'hide' : 'show'} (${CHORD})`}
          onPress={() => toggleNotes($)}
        />
        {waiting === 0 ? null : <Button key="send-queue" plain dimColor label={`[send queue: ${waiting}]`} onPress={() => sendQueue($)} />}
        {waiting === 0 ? null : <Button key="edit-queue" plain dimColor label="[edit queue]" onPress={() => showNotes($, 'queue')} />}
      </Box>
    )
  })

  // The band carries the menu only when the selection pane could not be drawn (a narrow terminal).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, select)
    if (e.props.hasSurvey || current === null || current.mode !== 'menu' || current.isPlaced || !isDrawn(e.surface)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(10, (e.viewport?.columns ?? 80) - 40)
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">
          Selected: {current.selection.replace(/\s+/g, ' ').slice(0, width)}
        </Text>
        <Button key="reply-open" plain hotkey="1" action={ACTION} label="Reply" onPress={() => openReply($, current.selection)} />
        <Button
          key="important"
          plain
          hotkey="2"
          label="Important"
          onPress={async () => {
            warn($, await important($, current.selection, AGENT_TAG))
            await finish($, current.selection)
          }}
        />
        <Button key="dismiss" plain hotkey="3" label="Dismiss" onPress={() => finish($, current.selection)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SELECT }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // The mobile app draws no field.
    const Input = 'Input' in table ? table.Input : undefined
    const current = await read($, select)
    if (current === null) return <Text dimColor>Nothing selected.</Text>
    const preview = current.selection.replace(/\s+/g, ' ')
    if (current.mode === 'reply') {
      if (Input === undefined) return <Text dimColor>Reply from a terminal or desktop: this surface draws no field.</Text>
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {AGENT_TAG} {preview}
          </Text>
          <Input
            key="reply"
            label={USER_TAG}
            placeholder="your reply; it goes out with your next message"
            submitLabel="queue"
            autoFocus
            onSubmit={async (value: string) => {
              if (value.trim() !== '') await queueReply($, current.selection, value.trim())
            }}
          />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {AGENT_TAG} {preview}
        </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="reply-open" plain hotkey="r" action={ACTION} label="Reply" onPress={() => openReply($, current.selection)} />
          <Button
            key="important"
            plain
            hotkey="i"
            label="Important"
            onPress={async () => {
              warn($, await important($, current.selection, AGENT_TAG))
              await finish($, current.selection)
            }}
          />
          <Button key="dismiss" plain hotkey="x" label="Dismiss" onPress={() => finish($, current.selection)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // The mobile app draws no field.
    const Input = 'Input' in table ? table.Input : undefined
    const current = await read($, notes)
    const isEditing = await read($, editing)
    const at = await read($, view)
    const list = await read($, queue)
    const items = await read($, todos)
    const s = current?.sections
    const hasObjectives = s !== undefined && s.objectives !== ''
    const go = (to: View) => async () => {
      await update($, editing, () => false)
      await update($, view, () => to)
    }
    const tab = (key: string, hotkey: string, label: string, to: View) => (
      <Button key={`view:${key}`} plain hotkey={hotkey} dimColor={at !== to} label={label} onPress={go(to)} />
    )
    const nav = (
      <Box key="nav" flexDirection="row" gap={2} marginBottom={1}>
        {tab('objectives', 'o', 'Objectives', 'objectives')}
        {tab('important', 'i', 'Important', 'important')}
        {tab('chat', 'c', 'Chat', 'chat')}
        {tab('queue', 'e', `Queue (${list.length})`, 'queue')}
        <Button key="send" plain hotkey="s" label="Send queue" onPress={() => sendQueue($)} />
        {at === 'overview' ? null : <Button key="view:overview" plain hotkey="b" label="Back" onPress={go('overview')} />}
      </Box>
    )
    const slot = (
      <TodoSlot
        key="todos"
        Box={Box}
        Button={Button}
        Text={Text}
        todos={items}
        onCycle={id => update($, todos, rows => rows.map(row => (row.id === id ? { ...row, status: nextStatus(row.status) } : row)))}
      />
    )
    const hint = (text: string) => (
      <Text key="hint" dimColor>
        {text}
      </Text>
    )
    const body = (title: string, text: string) => (
      <Box key="body" flexDirection="column">
        <Text bold>{title}</Text>
        <Text dimColor={text === ''}>{text === '' ? '(empty)' : text}</Text>
      </Box>
    )
    let content
    if (at === 'queue') {
      content = (
        <Box key="content" flexDirection="column">
          <Text bold>Queued replies ({list.length})</Text>
          {list.length === 0 ? <Text dimColor>No replies queued.</Text> : null}
          {list.map((pair, i) => (
            <Box key={`queued:${i}`} flexDirection="column" marginBottom={1}>
              <Text dimColor wrap="truncate-end">
                {AGENT_TAG} {pair.agent.replace(/\s+/g, ' ')}
              </Text>
              {Input === undefined ? (
                <Text>{`${USER_TAG} ${pair.user}`}</Text>
              ) : (
                <Input
                  key={`reply:${i}`}
                  label={USER_TAG}
                  value={pair.user}
                  submitLabel="keep"
                  onSubmit={async (value: string) => {
                    if (value.trim() !== '') await update($, queue, rows => rows.map((row, j) => (j === i ? { ...row, user: value.trim() } : row)))
                  }}
                />
              )}
              <Button
                key={`remove:${i}`}
                plain
                dimColor
                label="[remove]"
                onPress={async () => {
                  const next = await update($, queue, rows => rows.filter((_, j) => j !== i))
                  showQueue($, next.length)
                }}
              />
            </Box>
          ))}
          {hint('Tab to a reply, edit it, Enter keeps it. [remove] drops it. s sends all to the prompt, b goes back.')}
        </Box>
      )
    } else if (at === 'objectives') {
      const goals = s === undefined ? '' : [s.continuation === undefined ? '' : `Continuation of: ${s.continuation}\n\n`, s.objectives].join('').trim()
      const control =
        isEditing && Input !== undefined ? (
          <Input
            key="objectives"
            label="Objectives"
            placeholder={hasObjectives ? 'an update to the objectives' : 'the objectives of this session'}
            submitLabel="keep"
            autoFocus
            onSubmit={async (value: string) => {
              if (value.trim() !== '') warn($, await objectives($, value.trim()))
              await update($, editing, () => false)
            }}
          />
        ) : (
          <Button
            key="objectives"
            plain
            hotkey="u"
            label={hasObjectives ? 'Update objectives' : 'Set objectives'}
            onPress={() => update($, editing, () => true)}
          />
        )
      content = (
        <Box key="content" flexDirection="column">
          {control}
          {body('Objectives', goals)}
          {body('Updates', s?.updates ?? '')}
          {hint(hasObjectives ? 'u adds an update under Updates, Enter keeps it, b goes back' : 'u sets the objectives, Enter keeps it, b goes back')}
        </Box>
      )
    } else if (at === 'important') {
      content = body('Important', s?.important ?? '')
    } else if (at === 'chat') {
      content = body('Chat', s?.chat ?? '')
    } else {
      content = (
        <Box key="content" flexDirection="column">
          {current === null ? <Text dimColor>No notes for this session yet; the first write starts them.</Text> : <Text dimColor wrap="truncate-start">{current.path}</Text>}
          {hint('o objectives (u adds an update there), i important, c chat, e queue, s send queue, Esc closes')}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {slot}
        {nav}
        {content}
      </Box>
    )
  })
}
