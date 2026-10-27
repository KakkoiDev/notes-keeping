import type { Todo } from '../types'

export const STATUSES: readonly Todo['status'][] = ['todo', 'in-progress', 'done', 'declined']

export function nextStatus(status: Todo['status']): Todo['status'] {
  return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length] ?? 'todo'
}

const MARK: Record<Todo['status'], string> = { todo: '[ ]', 'in-progress': '[~]', done: '[x]', declined: '[-]' }

// The top of the notes panel, reserved for the todo list. The notes-todo work owns this file and the `todos` atom in
// register.tsx: it fills the atom, and `onCycle(id)` is called when a row is clicked.
export function TodoSlot(props: {
  Box: any
  Button: any
  Text: any
  todos: readonly Todo[]
  onCycle: (id: string) => unknown
}) {
  const { Box, Button, Text, todos, onCycle } = props
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Todo</Text>
      {todos.length === 0 ? (
        <Text dimColor>(no todos yet)</Text>
      ) : (
        todos.map(item => (
          <Button key={`todo:${item.id}`} plain label={`${MARK[item.status]} ${item.text}`} onPress={() => onCycle(item.id)} />
        ))
      )}
    </Box>
  )
}
