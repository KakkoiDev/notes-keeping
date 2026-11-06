import type { SubLine, Todo } from '../types'
import { legend, markOf } from './todo'

export const STATUSES: readonly Todo['status'][] = ['todo', 'in-progress', 'done', 'declined', 'blocked', 'paused']
// Enter, f and p move through these; on a blocked item, which only the bridge sets, or a paused one, each lands on todo.
const CYCLE: readonly Todo['status'][] = ['todo', 'in-progress', 'done', 'declined']

// The row the selection was last handed to, and the count of hand-overs.
export type Landing = { id: string; count: number }

// The key of a todo row: `todo:<id>`, or `todo#<count>:<id>` for the row the selection was last handed to, a key not
// drawn before.
export function rowKey(id: string, landing: Landing | undefined): string {
  return landing?.id === id ? `todo#${landing.count}:${id}` : `todo:${id}`
}

// The id of a row's marker key, or of its text key `open:<id>`.
export function rowId(key: string): string | undefined {
  return /^(?:todo(?:#\d+)?|open):([^]*)$/.exec(key)?.[1]
}

export function nextStatus(status: Todo['status']): Todo['status'] {
  return CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length] ?? 'todo'
}

// One status forward or back, staying put at todo and at declined.
export function stepStatus(status: Todo['status'], by: 1 | -1): Todo['status'] {
  return CYCLE[Math.min(CYCLE.length - 1, Math.max(0, CYCLE.indexOf(status) + by))] ?? status
}

// The ringed item while it is shown, else the first shown one.
export function selectedOf(todos: readonly Todo[], hidden: readonly Todo['status'][], cursor: string | null): string | undefined {
  const shown = todos.filter(item => !hidden.includes(item.status))
  return (shown.find(item => item.id === cursor) ?? shown[0])?.id
}

// Where the selection goes when `id` is no longer shown: the next shown item, else the last shown one before it.
export function nextShown(todos: readonly Todo[], id: string, hidden: readonly Todo['status'][]): string | undefined {
  const at = todos.findIndex(item => item.id === id)
  const isShown = (item: Todo) => item.id !== id && !hidden.includes(item.status)
  return (todos.slice(at + 1).find(isShown) ?? todos.slice(0, Math.max(at, 0)).reverse().find(isShown))?.id
}

// The filter the hidden statuses amount to: one status alone shown, all shown, or a mix set by hand.
export type Filter = Todo['status'] | 'all' | 'custom'

export function filterOf(hidden: readonly Todo['status'][]): Filter {
  const shown = STATUSES.filter(status => !hidden.includes(status))
  if (shown.length === STATUSES.length) return 'all'
  return shown.length === 1 ? (shown[0] ?? 'custom') : 'custom'
}

// The next filter: all, each status in turn, all again; a hand-set mix goes to the first status.
export function nextFilter(hidden: readonly Todo['status'][]): Filter {
  const at = filterOf(hidden)
  if (at === 'all' || at === 'custom') return STATUSES[0] ?? 'all'
  return STATUSES[STATUSES.indexOf(at) + 1] ?? 'all'
}

// The statuses hidden to show only `filter`.
export function hiddenFor(filter: Filter): Todo['status'][] {
  return filter === 'all' || filter === 'custom' ? [] : STATUSES.filter(status => status !== filter)
}

const SHOW: Record<Todo['status'], string> = { todo: '1', 'in-progress': '2', done: '3', declined: '4', blocked: '5', paused: '6' }

// The todo list of the notes panel's Todos view. The notes-todo work owns this file and the `todos` atom in
// register.tsx: it fills the atom, `onCycle(id)` is called when a row's marker is clicked or Enter is pressed on it, and
// `onOpen(id)` when its text is clicked or d is pressed, `onPause(id)` when z is pressed. `pause`, when set, is drawn in
// place of the key row: the field that asks why.
export function TodoSlot(props: {
  Box: any
  Button: any
  Text: any
  Client?: any
  todos: readonly Todo[]
  hidden: readonly Todo['status'][]
  selected: string | undefined
  landing: Landing | undefined
  onCycle: (id: string) => unknown
  onOpen: (id: string) => unknown
  onStep: (id: string, by: 1 | -1) => unknown
  onSelect: (id: string) => unknown
  onToggle: (status: Todo['status']) => unknown
  onFilter: () => unknown
  onPause: (id: string) => unknown
  // A call line is a button: it opens the item's card on that call, with the answer field.
  onCall?: (id: string, task: string) => unknown
  pause?: unknown
  // The lines drawn under each item, by item id.
  lines?: Readonly<Record<string, readonly SubLine[]>>
  // Keys drawn at the end of the key row, each only when it acts on the selected item.
  keys?: unknown
}) {
  const { Box, Button, Text, Client, todos, hidden, selected, landing, onCycle, onOpen, onStep, onSelect, onToggle, onFilter, onPause, onCall, pause, lines, keys } = props
  const shown = todos.filter(item => !hidden.includes(item.status))
  const step = (by: 1 | -1) => () => (selected === undefined ? undefined : onStep(selected, by))
  const at = shown.findIndex(item => item.id === selected)
  const move = (by: 1 | -1) => () => {
    const to = shown[Math.min(shown.length - 1, Math.max(0, at + by))]
    return to === undefined || to.id === selected ? undefined : onSelect(to.id)
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Todo</Text>
      <Box key="filters" flexDirection="row" flexWrap="wrap" gap={2}>
        {STATUSES.map(status => (
          <Button
            key={`show:${status}`}
            plain
            hotkey={SHOW[status]}
            dimColor={hidden.includes(status)}
            label={`${legend(status)}: ${hidden.includes(status) ? 'hidden' : 'shown'}`}
            onPress={() => onToggle(status)}
          />
        ))}
        <Button key="filter" plain hotkey="m" dimColor={filterOf(hidden) === 'all'} label={`filter: ${filterOf(hidden) === 'all' || filterOf(hidden) === 'custom' ? filterOf(hidden) : legend(filterOf(hidden) as Todo['status'])}`} onPress={onFilter} />
      </Box>
      {todos.length === 0 ? (
        <Text dimColor>(no todos yet)</Text>
      ) : shown.length === 0 ? (
        <Text dimColor>{STATUSES.includes(filterOf(hidden) as Todo['status']) ? `(no ${legend(filterOf(hidden) as Todo['status'])} items)` : `(${todos.length} items, every status hidden)`}</Text>
      ) : (
        shown.flatMap(item => [
          <Box key={`row:${item.id}`} flexDirection="row" gap={1}>
            <Button
              key={rowKey(item.id, landing)}
              plain
              autoFocus={item.id === selected ? true : undefined}
              dimColor={item.id !== selected}
              label={markOf(item.status)}
              onPress={() => onCycle(item.id)}
            />
            <Button key={`open:${item.id}`} plain dimColor={item.id !== selected} label={item.text} onPress={() => onOpen(item.id)} />
          </Box>,
          ...(lines?.[item.id] ?? []).map((line, i) =>
            line.isCall && line.task !== undefined && onCall !== undefined ? (
              <Button key={`callline:${item.id}:${i}`} plain label={line.text} onPress={() => onCall(item.id, line.task ?? '')} />
            ) : (
              <Text key={`sub:${item.id}:${i}`} dimColor={!line.isCall && item.id !== selected}>
                {line.text}
              </Text>
            ),
          ),
        ])
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="select:down" plain hotkey="j" label="next item" onPress={move(1)} />
        <Button key="select:up" plain hotkey="k" label="previous item" onPress={move(-1)} />
        <Button key="status:next" plain hotkey="f" label="next status" onPress={step(1)} />
        <Button key="status:prev" plain hotkey="p" label="previous status" onPress={step(-1)} />
        <Button key="item:open" plain hotkey="d" label="open item" onPress={() => (selected === undefined ? undefined : onOpen(selected))} />
        <Button key="item:pause" plain hotkey="z" label="pause it" onPress={() => (selected === undefined ? undefined : onPause(selected))} />
        {Client === undefined ? null : <Client key="status:arrows" module="./arrows.tsx" />}
        {keys ?? null}
      </Box>
      {pause ?? null}
    </Box>
  )
}
