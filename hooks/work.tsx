import type { Call, Fleet, FleetRow, SubLine, Todo, TrailStep, WorkShown } from '../types'

const NAME_COLS = 28
const WORD_COLS = 9
// The sidebar's width: a row is cut to it.
const ROW_COLS = 89
// A report line sits under its row, indented by this.
const REPORT_INDENT = '    '
const GONE = /^firstmate: worker gone; (?:last: )?/

// Time since `at` (epoch seconds) at `now` (milliseconds), in its largest whole unit.
export function ageOf(at: number | null, now: number): string {
  if (at === null) return '-'
  const s = Math.max(0, Math.floor(now / 1000) - at)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`
}

function cut(text: string, cols: number): string {
  return text.length <= cols ? text : `${text.slice(0, cols - 1)}…`
}

// text cut to cols at a word boundary, ending in an ellipsis when cut.
function cutWord(text: string, cols: number): string {
  if (text.length <= cols) return text
  const head = text.slice(0, cols - 1)
  const at = head.lastIndexOf(' ')
  return `${(at > 0 ? head.slice(0, at) : head).replace(/[\s·,]+$/, '')}…`
}

// left, then right ending at the row's right edge; left is cut to leave a space before right.
function edged(left: string, right: string): string {
  return `${cutWord(left, ROW_COLS - right.length - 1).padEnd(ROW_COLS - right.length)}${right}`
}

const ENDED = ['finished', 'stopped', 'gone']
const WAITER = /^(?:worker|firstmate): /

function wordOf(row: FleetRow): string {
  return row.word === 'done' ? 'finished' : row.word
}

const PR_LINK = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\S*/g

// A question with its first word lowered when that word is a plain capitalized word; a name or acronym is kept.
function lowered(text: string): string {
  return /^[A-Z][a-z]*\b/.test(text) && !/^[A-Z][a-z]*[A-Z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

// A PR link as <repo>#<number>.
export function prName(pr: string): string {
  const m = /\/([^/]+)\/pull\/(\d+)/.exec(pr)
  return m ? `${m[1]}#${m[2]}` : pr
}

// The lines under to-do `id` (with `status`) in the Todos view: a worker line per linked worker row, then a call line per
// open call linked to it, then, when every linked worker finished and the to-do is still open, the hint to mark it done.
export function todoLines(rows: readonly FleetRow[], id: string, status: Todo['status'], now: number): SubLine[] {
  const on = rows.filter(row => !row.gone && row.todos.includes(id))
  const workers = on.filter(row => row.word !== 'call')
  const workerLines = workers.map(row => {
    const word = wordOf(row)
    const age = row.at === null ? '' : ` ${ageOf(row.at, now)}${ENDED.includes(word) ? ' ago' : ''}`
    const said = (row.summary?.outcome ?? row.summary?.title ?? row.waiting.replace(WAITER, '')).replace(PR_LINK, prName)
    return { text: cutWord(`      worker ${word}${age}${said === '' ? '' : ` · ${said}`}${row.pr === null || said.includes(prName(row.pr)) ? '' : ` · PR ${prName(row.pr)}`}`, ROW_COLS) }
  })
  const callLines = on.flatMap(row =>
    row.call?.state === 'open' ? [{ text: edged(`    ! your call: ${lowered(row.call.question)}`, `open · ${ageOf(row.call.at, now)} · a: answer`), isCall: true as const, task: row.task }]
    : row.call?.state === 'answered' ? [{ text: cutWord(answeredLine(row.trail ?? [], now), ROW_COLS) }]
    : [],
  )
  const isFinished = workers.length > 0 && workers.every(row => wordOf(row) === 'finished') && (status === 'todo' || status === 'in-progress')
  const hint = isFinished ? [{ text: edged(`      worker finished, to-do still ${status === 'todo' ? 'todo' : 'in progress'}`, 'f: mark done') }] : []
  return [...workerLines, ...callLines, ...hint]
}

// The line under a to-do for an answered call: that the captain answered, then once the trail has them, when it
// reached the worker and that the worker read it.
function answeredLine(trail: readonly TrailStep[], now: number): string {
  const ago = (at: number | null) => (at === null ? '' : ` ${ageOf(at, now)} ago`)
  const said = trail.find(step => step.who === 'you')
  const sent = trail.find(step => step.who === 'firstmate' && step.text.startsWith('sent it to the worker'))
  const read = trail.find(step => step.who === 'worker' && step.text === 'read it')
  return `      you answered${ago(said?.at ?? null)}${sent ? ` · reached the worker${ago(sent.at)}` : ''}${read ? ' · it read it' : ''}`
}

// The head of a call card in the Item view.
export function callHead(call: Call, now: number): string {
  if (call.state === 'answered') return `! Your call · answered${call.at === null ? '' : ` ${ageOf(call.at, now)} ago`}`
  return `! Your call · open · asked ${ageOf(call.at, now)} ago`
}

// The trail under an answered call's question: the captain's words, then each later step, its UTC time first.
export function trailLines(trail: readonly TrailStep[]): string[] {
  return trail.map((step, i) =>
    i === 0 && step.who === 'you' ? `  You: "${step.text}"` : `  ${(step.at === null ? '' : new Date(step.at * 1000).toISOString().slice(11, 16)).padEnd(5)}  ${step.who} ${step.text}`,
  )
}

// A worker block in the Item view: its state and age, its report title (else its backlog title) and Outcome: line.
export function workerBlock(row: FleetRow, now: number): string[] {
  const word = wordOf(row)
  const title = row.summary?.title ?? row.title
  return [
    `Worker · ${word} ${ageOf(row.at, now)}${ENDED.includes(word) ? ' ago' : ''}`,
    ...(title ? [`  ${title}`] : []),
    ...(row.summary?.outcome ? [`  Outcome: ${row.summary.outcome}`] : []),
  ]
}

// A row's name: its linked todo item's label, else its backlog title, else its task id.
export function nameOf(row: FleetRow, labels: Readonly<Record<string, string>>): string {
  return (row.todos[0] === undefined ? undefined : labels[row.todos[0]]) ?? row.title ?? row.task
}

// A row's waiting cell: "gone: <last line>" for a worker whose window is gone.
export function waitingText(waiting: string): string {
  return waiting.replace(GONE, 'gone: ')
}

export function lineOf(row: FleetRow, name: string, now: number): string {
  return cut(`${row.flag || ' '} ${cut(name, NAME_COLS).padEnd(NAME_COLS)} ${row.word.padEnd(WORD_COLS)} ${ageOf(row.at, now).padStart(4)}  ${waitingText(row.waiting)}`.replace(/\s+$/, ''), ROW_COLS)
}

// The rows the Work view lists: the calls and live workers no open to-do links, then, while 6 shows them, the gone ones.
export function unlinkedRows(rows: readonly FleetRow[], shown: readonly WorkShown[]): FleetRow[] {
  return rows.filter(row => (row.gone ? shown.includes('gone') : row.todos.length === 0 && (row.word === 'call' || row.live)))
}

// The lines under a row in the list: its report's age, title and outcome, and what it asks the captain on a row that
// waits on the captain or firstmate. A report that could not be read shows its path.
export function reportLines(row: FleetRow, now: number): string[] {
  if (row.report === null) return []
  const summary = row.summary
  if (!summary) return [cut(`report  ${row.report} (not readable)`, ROW_COLS - REPORT_INDENT.length)]
  const head = `report ${ageOf(summary.at, now)}  ${summary.title}${summary.outcome === null ? '' : `: ${summary.outcome}`}`
  const ask = summary.ask !== null && row.flag !== '' ? [`needs  ${summary.ask}`] : []
  return [head, ...ask].map(line => cut(line, ROW_COLS - REPORT_INDENT.length))
}

// The top of the report reader: the title with its age and b at the right edge, the kind and the to-do it is on, and
// while a call on it is open, what it needs with a at the right edge. No path: y copies it.
export function reportHead(row: FleetRow, now: number, todo?: { label: string; mark: string }, needs?: string | null): string[] {
  const title = row.summary?.title ?? row.title ?? row.task
  return [
    edged(title, row.summary ? `${ageOf(row.summary.at, now)} ago · b: back` : 'b: back'),
    [row.kind, todo === undefined ? null : `to-do: ${todo.label} ${todo.mark}`].filter(Boolean).join(' · '),
    ...(needs ? [edged(`! Needs you: ${needs}`, 'a: answer')] : []),
  ]
}

// The open call a row's report waits on: the row's own, else one on a to-do the row is on.
export function openCallOf(rows: readonly FleetRow[], row: FleetRow): FleetRow | undefined {
  if (row.call?.state === 'open') return row
  return rows.find(other => !other.gone && other.call?.state === 'open' && other.todos.some(id => row.todos.includes(id)))
}

// The row whose report v reads from a to-do: a linked worker with a report, else a linked call with one.
export function reportRowOf(rows: readonly FleetRow[], id: string): FleetRow | undefined {
  const on = rows.filter(row => !row.gone && row.report !== null && row.todos.includes(id))
  return on.find(row => row.word !== 'call') ?? on[0]
}

function counted(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`
}

// The line under the Todos list for live work no open to-do links: its calls and live workers; undefined when none.
export function unlinkedText(fleet: Fleet): string | undefined {
  const free = fleet.rows.filter(row => !row.gone && row.todos.length === 0)
  const calls = free.filter(row => row.word === 'call').length
  const workers = free.filter(row => row.word !== 'call' && row.live).length
  const closed = fleet.closedToday ?? 0
  if (calls + workers + closed === 0) return undefined
  const live = calls + workers === 0 ? 'nothing live' : [calls === 0 ? '' : counted(calls, 'call'), workers === 0 ? '' : counted(workers, 'worker')].filter(Boolean).join(', ')
  return `Not on a to-do: ${live}${closed === 0 ? '' : ` · ${counted(closed, 'call')} closed without you today`}`
}

// The open calls the Todos tab counts: those linked to a shown to-do, and those linked to none.
export function callsShown(fleet: Fleet | null, shownIds: ReadonlySet<string>): number {
  return needsYou(fleet).filter(row => row.todos.length === 0 || row.todos.some(id => shownIds.has(id))).length
}

export function needsYou(fleet: Fleet | null): FleetRow[] {
  return fleet === null ? [] : fleet.rows.filter(row => row.flag === '!')
}

// The status line under the prompt for rows that need the captain; undefined when none do.
export function workStatus(n: number): string | undefined {
  return n === 0 ? undefined : `calls: ${n} need${n === 1 ? 's' : ''} you · ctrl+q`
}

// The row the ring stands on while it is shown, else the first shown one.
export function selectedRow(rows: readonly FleetRow[], cursor: string | null): string | undefined {
  return (rows.find(row => row.task === cursor) ?? rows[0])?.task
}

// The Work view, work without a to-do: a row per call and live worker no open to-do links, each row's report summary
// beneath it; the gone workers and the calls closed today without the captain counted, 6 and x listing them.
// `onOpen(task)` is called when a row is pressed, `onToggle(what)` when 6 or x is.
export function WorkSlot(props: {
  Box: any
  Button: any
  Text: any
  fleet: Fleet
  labels: Readonly<Record<string, string>>
  shown: readonly WorkShown[]
  selected: string | undefined
  now: number
  onOpen: (task: string) => unknown
  onToggle: (what: WorkShown) => unknown
}) {
  const { Box, Button, Text, fleet, labels, shown, selected, now, onOpen, onToggle } = props
  const rows = unlinkedRows(fleet.rows, shown)
  const gone = fleet.rows.filter(row => row.gone).length
  const closed = fleet.closed ?? []
  const read = new Date(fleet.at).toISOString().slice(11, 16)
  const counts = [gone === 0 ? '' : `${counted(gone, 'worker')} gone without finishing`, closed.length === 0 ? '' : `${counted(closed.length, 'call')} closed without you today`].filter(Boolean)
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{edged('Work without a to-do', `read ${read} UTC · b: back`)}</Text>
      {rows.filter(row => !row.gone).length === 0 ? <Text dimColor>Every live worker and open call is on a to-do.</Text> : null}
      {rows.flatMap(row => [
        <Button
          key={`work:${row.task}`}
          plain
          autoFocus={row.task === selected ? true : undefined}
          dimColor={row.task !== selected}
          label={lineOf(row, nameOf(row, labels), now)}
          onPress={() => onOpen(row.task)}
        />,
        ...reportLines(row, now).map((line, i) => (
          <Text key={`work-report:${row.task}:${i}`} dimColor={row.task !== selected}>
            {`${REPORT_INDENT}${line}`}
          </Text>
        )),
      ])}
      {shown.includes('closed') ? closed.map(one => <Text key={`work-closed:${one.task}`}>{`  ${one.title}${one.evidence === null ? '' : ` · ${one.evidence}`}`}</Text>) : null}
      {counts.length === 0 ? null : (
        <Box key="work-counts" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text dimColor>{counts.join(' · ')}</Text>
          {gone === 0 ? null : <Button key="work:gone" plain hotkey="6" label={shown.includes('gone') ? 'hide gone' : 'show gone'} onPress={() => onToggle('gone')} />}
          {closed.length === 0 ? null : <Button key="work:closed" plain hotkey="x" label={shown.includes('closed') ? 'hide closed' : 'show closed'} onPress={() => onToggle('closed')} />}
        </Box>
      )}
      {fleet.calls > 0 ? <Text dimColor>{`+${fleet.calls} other calls · /bearings`}</Text> : null}
    </Box>
  )
}

// The prompt text an answer fills: the row's task and key, then the captain's words.
export function answerText(row: FleetRow, text: string): string {
  return `${row.answer ?? row.task}: ${text}`
}

// What y copies: the PR link, else the report path, else the task id.
export function copyText(row: FleetRow): string {
  return row.pr ?? row.report ?? row.task
}

// The details of one row, the lines Enter on it shows.
export function details(row: FleetRow, name: string, now: number, item: string | undefined): string[] {
  const where = row.word === 'call' ? 'captain call' : row.live ? `window ${row.window ?? '-'}` : 'worker window gone'
  const summary = row.summary
  const report =
    row.report === null ? ['report  none named']
    : !summary ? [`report  ${row.report} (not readable)`]
    : [
        `report  ${summary.title}  (${ageOf(summary.at, now)} ago, v reads it here)`,
        ...(summary.outcome === null ? [] : [`outcome ${summary.outcome}`]),
        ...(summary.ask === null ? [] : [`needs   ${summary.ask}`]),
      ]
  return [
    `${name}  ·  ${row.task}  ·  ${row.kind ?? '-'}  ·  ${where}`,
    ...report,
    `last    ${row.word} ${ageOf(row.at, now)} ago: ${waitingText(row.waiting)}`,
    `PR      ${row.pr ?? 'none recorded'}`,
    ...(row.report === null ? [] : [`file    ${row.report}`]),
    `todo    ${item ?? (row.todos[0] === undefined ? 'no linked todo item' : `id:${row.todos[0]} is not in this notes file`)}`,
    ...(row.flag === '?' ? ['why ?   firstmate\'s move: a decision, block or failure it handles first, or a worker gone with its wait open'] : []),
  ]
}
