import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Notes } from '../types'
import {
  AGENT_TAG,
  USER_TAG,
  addChat,
  addImportant,
  addSession,
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
  stamp,
  summary,
} from './notes'

const NAME = 'notes-keeping'
const PANE = 'notes-keeping'
const TITLE = 'Notes'
const DIR = '.notes-keeping'
const GIT_MS = 10_000
const POLL_MS = 600
const REFRESH_MS = 5_000
const PREVIEW = 60
const HISTORY_CAP = 20
const HEAD_CHARS = 200

const USAGE = [
  'Usage: /notes-keeping <subcommand>',
  '  init [--new] [prompt]   start this session\'s notes; no prompt takes the session\'s first prompt',
  '  update <text>           add an [UPDATE] block under # Initial Prompt > ## Updates',
  '  important [text]        add text, or the selected text, to # Important',
  '  reply <text>            add the selected text and your reply to # Chat and to the prompt box',
  '  history [n|file]        list earlier notes; pick one to continue it here',
  '  show | hide             open or close the notes pane',
].join('\n')

const notes = atom({ plugin: 'notes-keeping', key: 'notes' } as const, null as Notes | null)
const band = atom({ plugin: 'notes-keeping', key: 'band' } as const, null as Band | null)
const handled = atom({ plugin: 'notes-keeping', key: 'handled' } as const, '')

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

async function edit($: EngineInterface, subject: string, change: (text: string) => string): Promise<string[]> {
  const path = await boundPath($)
  if (path === undefined) throw new Error('no notes file for this session; run /notes-keeping init first')
  return save($, path, change(await readText($, path)), subject)
}

function told(text: string, said: readonly string[]): string {
  return [text, ...said].join('\n')
}

// A band press has no output row: what follows the first line goes to a toast.
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

async function firstPrompt($: EngineInterface): Promise<string> {
  const rows = await $.session.messages()
  return rows.find(row => row.role === 'user' && row.text.trim() !== '' && !row.text.trim().startsWith('/'))?.text ?? ''
}

async function init($: EngineInterface, args: string): Promise<string> {
  const isNew = /^--new\b/.test(args)
  const prompt = args.replace(/^--new\b\s*/, '').trim() || (await firstPrompt($))
  const current = await boundPath($)
  if (current !== undefined && !isNew) {
    return `This session already keeps ${current}. Run /notes-keeping init --new [prompt] to start a new file for it.`
  }
  const dir = await notesDir($)
  const taken = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(entry => entry.name) : []
  const id = await $.session.id()
  const path = `${dir}/${fileName(projectName(await $.session.root()), id, await $.clock.now(), taken)}`
  await $.store.set(bindKey(id), path)
  return told(`Notes started: ${path}`, await save($, path, create(prompt, id), 'init'))
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
  if (current === undefined) return { text: 'Run /notes-keeping init first, then pick the notes to continue.' }
  const previous = await readText($, `${dir}/${pick}`)
  const said = await edit($, 'continue', text => setContinuation(text, pick))
  return {
    text: told(`Continuing ${pick}: the whole file is now in context.`, said),
    context: [inject(previous, `${dir}/${pick}`)],
  }
}

async function selected($: EngineInterface): Promise<string> {
  return ((await $.ui.selection())?.text ?? '').trim()
}

async function important($: EngineInterface, text: string, tag: string): Promise<string> {
  return told('Added to # Important.', await edit($, 'important', md => addImportant(md, tag, text)))
}

async function reply($: EngineInterface, agent: string, user: string): Promise<string> {
  const said = await edit($, 'reply', md => addChat(md, agent, user))
  await $.prompt.fill({ text: `${chatPair(agent, user)}\n`, mode: 'append' })
  await update($, handled, () => agent)
  await update($, band, () => null)
  return told('Added to # Chat and to the prompt box.', said)
}

async function refresh($: EngineInterface): Promise<void> {
  const path = await boundPath($)
  if (path === undefined) return
  await publish($, path, await readText($, path))
}

export const register: Register = on => {
  let bandId: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: NAME,
      description: 'Session notes: init, update, important, reply, history, show, hide',
      argumentHint: 'init|update|important|reply|history|show|hide [text]',
    })
    if (e.isInteractive) {
      $.clock.every(POLL_MS, async () => {
        const current = await read($, band)
        if (current?.mode === 'reply') return
        const text = (await boundPath($)) === undefined ? '' : await selected($)
        if (text === '') {
          if (current !== null) await update($, band, () => null)
          if ((await read($, handled)) !== '') await update($, handled, () => '')
          return
        }
        if (text === (await read($, handled)) || text === current?.selection) return
        await update($, band, () => ({ mode: 'menu', selection: text }))
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
        case 'update': {
          if (rest === '') return { text: 'Usage: /notes-keeping update <text>' }
          const when = stamp(await $.clock.now())
          return { text: told('Update kept under ## Updates.', await edit($, 'update', md => addUpdate(md, when, rest))) }
        }
        case 'important': {
          const text = rest || (await selected($))
          if (text === '') return { text: 'Nothing to keep: give text or select some first.' }
          return { text: await important($, text, rest === '' ? AGENT_TAG : USER_TAG) }
        }
        case 'reply': {
          const agent = await selected($)
          if (agent === '') return { text: 'Select the text to reply to first.' }
          if (rest === '') return { text: 'Usage: /notes-keeping reply <your reply>' }
          return { text: await reply($, agent, rest) }
        }
        case 'history':
          return await history($, rest)
        case 'show':
          await refresh($)
          await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
          return {}
        case 'hide':
          await $.ui.close({ id: PANE })
          return {}
        default:
          return { text: USAGE }
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

  // Compaction puts its summary in place of the first message, so a changed first message means one ran.
  // On this machine the managed-settings plugin bypasses classic.SessionStart, prompt.context and
  // session.compact for user plugins; prompt.submit is the hook that still reaches the model.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const path = await boundPath($)
    if (path === undefined) return next(e)
    const key = headKey(await $.session.id())
    const seen = await $.store.get(key)
    // Every summary opens with the same sentence, so the tail and the length tell two apart.
    const first = (await $.session.messages())[0]?.text ?? ''
    const head = `${first.length}:${first.slice(-HEAD_CHARS)}`
    await $.store.set(key, head)
    if (typeof seen !== 'string' || seen === head) return next(e)
    return next({ ...e, context: [...(e.context ?? []), inject(await readText($, path), path)] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, band)
    if (e.props.hasSurvey || current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    bandId = e.requestId
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const width = Math.max(10, (e.viewport?.columns ?? 80) - 40)
    const preview = current.selection.replace(/\s+/g, ' ')
    const dismiss = async () => {
      await update($, handled, () => current.selection)
      await update($, band, () => null)
    }
    if (current.mode === 'reply') {
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {AGENT_TAG} {preview.slice(0, width)}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Input
              key="reply"
              label={`${USER_TAG} `}
              placeholder="your reply, Enter to keep it"
              submitLabel="keep"
              autoFocus
              onSubmit={async value => warn($, await reply($, current.selection, value))}
            />
            <Button key="cancel" plain label="Cancel" onPress={dismiss} />
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">
          Selected: {preview.slice(0, width)}
        </Text>
        <Button
          key="reply-open"
          plain
          hotkey="r"
          label="Reply"
          onPress={async () => {
            await update($, band, () => ({ mode: 'reply', selection: current.selection }))
            // The Input's autoFocus covers a surface that refuses the move.
            if (bandId !== undefined) await $.ui.focus({ requestId: bandId, key: 'reply' }).catch(() => undefined)
          }}
        />
        <Button
          key="important"
          plain
          hotkey="i"
          label="Important"
          onPress={async () => {
            warn($, await important($, current.selection, AGENT_TAG))
            await dismiss()
          }}
        />
        <Button key="dismiss" plain hotkey="x" label="Dismiss" onPress={dismiss} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, notes)
    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No notes for this session. Run /notes-keeping init.</Text>
        </Box>
      )
    }
    const s = current.sections
    const section = (key: string, title: string, body: string) => (
      <Box key={key} flexDirection="column" marginBottom={1}>
        <Text bold>{title}</Text>
        <Text dimColor={body === ''}>{body === '' ? '(empty)' : body}</Text>
      </Box>
    )
    const initial = [s.continuation === undefined ? '' : `Continuation of: ${s.continuation}\n\n`, s.prompt]
      .join('')
      .trim()
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-start">
          {current.path}
        </Text>
        {section('initial', 'Initial Prompt', initial)}
        {section('updates', 'Updates', s.updates)}
        {section('important', 'Important', s.important)}
        {section('chat', 'Chat', s.chat)}
      </Box>
    )
  })
}
