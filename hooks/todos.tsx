import type { Todo } from '../types'
import { legend, markOf } from './todo'

export const STATUSES: readonly Todo['status'][] = ['todo', 'in-progress', 'done', 'declined', 'blocked']
// Enter, f and p move through these; on a blocked item, which only the bridge sets, each lands on todo.
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

const SHOW: Record<Todo['status'], string> = { todo: '1', 'in-progress': '2', done: '3', declined: '4', blocked: '5' }

// The todo list of the notes panel's Todos view. The notes-todo work owns this file and the `todos` atom in
// register.tsx: it fills the atom, `onCycle(id)` is called when a row's marker is clicked or Enter is pressed on it, and
// `onOpen(id)` when its text is clicked or d is pressed.
export function TodoSlot(props: {
  Box: any
  Button: any
  Text: any
  todos: readonly Todo[]
  hidden: readonly Todo['status'][]
  selected: string | undefined
  landing: Landing | undefined
  onCycle: (id: string) => unknown
  onOpen: (id: string) => unknown
  onStep: (id: string, by: 1 | -1) => unknown
  onSelect: (id: string) => unknown
  onToggle: (status: Todo['status']) => unknown
}) {
  const { Box, Button, Text, todos, hidden, selected, landing, onCycle, onOpen, onStep, onSelect, onToggle } = props
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
      </Box>
      {todos.length === 0 ? (
        <Text dimColor>(no todos yet)</Text>
      ) : shown.length === 0 ? (
        <Text dimColor>{`(${todos.length} items, every status hidden)`}</Text>
      ) : (
        shown.map(item => (
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
          </Box>
        ))
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="select:down" plain hotkey="j" label="next item" onPress={move(1)} />
        <Button key="select:up" plain hotkey="k" label="previous item" onPress={move(-1)} />
        <Button key="status:next" plain hotkey="f" label="next status" onPress={step(1)} />
        <Button key="status:prev" plain hotkey="p" label="previous status" onPress={step(-1)} />
        <Button key="item:open" plain hotkey="d" label="open item" onPress={() => (selected === undefined ? undefined : onOpen(selected))} />
      </Box>
      <Text dimColor>j and k select the next and previous item (Up and Down walk every marker and text), Enter or a click on its marker cycles its status, d or a click on its text opens it, f and p step it forward and back, 1 to 5 show or hide a status</Text>
    </Box>
  )
}
