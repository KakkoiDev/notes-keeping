export type Sections = {
  continuation: string | undefined
  sessions: readonly string[]
  objectives: string
  updates: string
  todo: string
  important: string
  chat: string
}

export type Notes = { path: string; sections: Sections }

export type NameParts = { date: string; time: string; project: string; shortId: string }

// isPlaced: the selection pane is drawn; hadFocus: it held the keyboard, so losing it closes it.
export type Select = { mode: 'menu' | 'reply'; selection: string; isPlaced: boolean; hadFocus: boolean }

export type Pair = { agent: string; user: string }

export type View = 'todos' | 'objectives' | 'important' | 'chat' | 'queue' | 'history'

// The note the History view shows whole (preview) or is about to attach (confirm).
export type Opened = { name: string; step: 'preview' | 'confirm' }

export type Todo = { id: string; text: string; status: 'todo' | 'in-progress' | 'done' | 'declined' }

declare module 'claude-code' {
  interface PluginState {
    'notes-keeping': {
      notes: Notes | null
      select: Select | null
      handled: string
      queue: Pair[]
      editing: boolean
      view: View
      isNotesOpen: boolean
      picked: Opened | null
      cursor: string | null
      todoCursor: string | null
      hidden: Todo['status'][]
    }
  }
}
