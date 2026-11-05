import type { Fleet, FleetRow, WorkGroup } from '../types'

export const GROUPS: readonly WorkGroup[] = ['you', 'firstmate', 'running', 'idle', 'done', 'gone']
const SHOW: Record<WorkGroup, string> = { you: '1', firstmate: '2', running: '3', idle: '4', done: '5', gone: '6' }
const GROUP_LABEL: Record<WorkGroup, string> = { you: '[!] you', firstmate: '[?] firstmate', running: 'running', idle: 'idle', done: 'done', gone: 'gone' }
const GROUP_TITLE: Record<WorkGroup, string> = { you: 'Needs you', firstmate: 'Firstmate', running: 'Running', idle: 'Idle', done: 'Done', gone: 'Gone' }
const NAME_COLS = 28
const WORD_COLS = 9
// The sidebar's width: a row is cut to it.
const ROW_COLS = 89
// A report line sits under its row, indented by this.
const REPORT_INDENT = '    '
const GONE = /^firstmate: worker gone; (?:last: )?/

export function groupOf(row: FleetRow): WorkGroup {
  if (row.gone) return 'gone'
  if (row.flag === '!') return 'you'
  if (row.flag === '?') return 'firstmate'
  if (row.word === 'idle' || row.word === 'done') return row.word
  return 'running'
}

// Time since `at` (epoch seconds) at `now` (milliseconds), in its largest whole unit.
export function ageOf(at: number | null, now: number): string {
  if (at === null) return '-'
  const s = Math.max(0, Math.floor(now / 1000) - at)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`
}

function cut(text: string, cols: number): string {
  return text.length <= cols ? text : `${text.slice(0, cols - 1)}…`
}

// A row's name: its linked todo item's label, else its backlog title, else its task id.
export function nameOf(row: FleetRow, labels: Readonly<Record<string, string>>): string {
  return (row.todo === null ? undefined : labels[row.todo]) ?? row.title ?? row.task
}

// A row's waiting cell: "gone: <last line>" for a worker whose window is gone.
export function waitingText(waiting: string): string {
  return waiting.replace(GONE, 'gone: ')
}

export function lineOf(row: FleetRow, name: string, now: number): string {
  return cut(`${row.flag || ' '} ${cut(name, NAME_COLS).padEnd(NAME_COLS)} ${row.word.padEnd(WORD_COLS)} ${ageOf(row.at, now).padStart(4)}  ${waitingText(row.waiting)}`.replace(/\s+$/, ''), ROW_COLS)
}

// The shown rows under their group, in the filter order; a group with no shown row is left out.
export function groupsOf(rows: readonly FleetRow[], hidden: readonly WorkGroup[]): { group: WorkGroup; title: string; rows: FleetRow[] }[] {
  return GROUPS.filter(group => !hidden.includes(group))
    .map(group => ({ group, title: GROUP_TITLE[group], rows: rows.filter(row => groupOf(row) === group) }))
    .filter(section => section.rows.length > 0)
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

// The top of the report view: title, path and age, outcome and ask.
export function reportHead(row: FleetRow, now: number): string[] {
  const summary = row.summary
  const at = summary ? ` · written ${ageOf(summary.at, now)} ago` : ' · not readable'
  return [
    summary ? summary.title : (row.report ?? row.task),
    `${row.report ?? 'no report'}${at}`,
    ...(summary && summary.outcome !== null ? [`outcome  ${summary.outcome}`] : []),
    ...(summary && summary.ask !== null ? [`needs    ${summary.ask}`] : []),
  ]
}

export function needsYou(fleet: Fleet | null): FleetRow[] {
  return fleet === null ? [] : fleet.rows.filter(row => row.flag === '!')
}

// The status line under the prompt for rows that need the captain; undefined when none do.
export function workStatus(n: number): string | undefined {
  return n === 0 ? undefined : `work: ${n} need${n === 1 ? 's' : ''} you · w`
}

// The row the ring stands on while it is shown, else the first shown one.
export function selectedRow(rows: readonly FleetRow[], cursor: string | null): string | undefined {
  return (rows.find(row => row.task === cursor) ?? rows[0])?.task
}

// The Work view: one row per task or live captain hold from `bridge fleet` under a header per group, each row's report
// summary beneath it, filters on 1 to 6, and the actions for the selected row. `onOpen(task)` is called when a row is pressed, `onToggle(group)` when a filter is.
export function WorkSlot(props: {
  Box: any
  Button: any
  Text: any
  fleet: Fleet
  labels: Readonly<Record<string, string>>
  hidden: readonly WorkGroup[]
  selected: string | undefined
  now: number
  onOpen: (task: string) => unknown
  onToggle: (group: WorkGroup) => unknown
}) {
  const { Box, Button, Text, fleet, labels, hidden, selected, now, onOpen, onToggle } = props
  const shown = fleet.rows.filter(row => !hidden.includes(groupOf(row)))
  const gone = fleet.rows.filter(row => row.gone).length
  const read = new Date(fleet.at).toISOString().slice(11, 19)
  const count = (group: WorkGroup) => fleet.rows.filter(row => groupOf(row) === group).length
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{`Work  ${shown.length} rows · ${count('you')} need${count('you') === 1 ? 's' : ''} you · ${count('firstmate')} firstmate · read ${read} UTC (${ageOf(Math.floor(fleet.at / 1000), now)} ago)`}</Text>
      <Box key="filters" flexDirection="row" flexWrap="wrap" gap={2}>
        {GROUPS.map(group => (
          <Button key={`work-show:${group}`} plain hotkey={SHOW[group]} dimColor={hidden.includes(group)} label={`${GROUP_LABEL[group]}: ${hidden.includes(group) ? 'hidden' : 'shown'}`} onPress={() => onToggle(group)} />
        ))}
      </Box>
      <Text dimColor>{`  ${'Work'.padEnd(NAME_COLS)} ${'State'.padEnd(WORD_COLS)}  Age  Waiting on`}</Text>
      {shown.length === 0 ? <Text dimColor>(no rows shown)</Text> : null}
      {groupsOf(fleet.rows, hidden).map(section => (
        <Box key={`work-group:${section.group}`} flexDirection="column" marginTop={1}>
          <Text bold>{`${section.title} · ${section.rows.length}`}</Text>
          {section.rows.flatMap(row => [
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
        </Box>
      ))}
      {gone > 0 && hidden.includes('gone') ? <Text dimColor>{`+${gone} gone task records hidden (worktree or window gone)  6: show`}</Text> : null}
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
export function details(row: FleetRow, name: string, now: number, item: string | undefined, crew: string | undefined): string[] {
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
    `todo    ${item ?? (row.todo === null ? 'no linked todo item' : `id:${row.todo} is not in this notes file`)}`,
    ...(row.flag === '?' ? ['why ?   firstmate\'s move: a decision, block or failure it handles first, or a worker gone with its wait open'] : []),
    ...(crew === undefined ? [] : crew.trim().split('\n').map(line => `crew    ${line}`)),
  ]
}
