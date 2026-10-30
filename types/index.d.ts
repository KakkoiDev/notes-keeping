export type Sections = {
  continuation: string | undefined
  sessions: readonly string[]
  objectives: string
  updates: string
  todo: string
  important: string
  chat: string
  logs: string
}

export type Notes = { path: string; sections: Sections }

export type NameParts = { date: string; time: string; project: string; shortId: string }

// row: the transcript row the selection lies in; isPlaced: the selection pane is drawn; hadFocus: it held the keyboard, so losing it closes it.
export type Select = { mode: 'menu' | 'reply'; selection: string; row?: string; isPlaced: boolean; hadFocus: boolean }

// A reply's anchor: the note's id, the transcript row (requestId) the quoted text was selected in, and which occurrence of it in that row.
export type Note = { id: string; row: string; at: number }

export type Pair = { agent: string; user: string; note?: Note }

export type ChatNote = Note & { agent: string; user: string }

// item: one todo item whole, opened from the Todos view; note: one reply, opened from its mark in the transcript.
export type View = 'todos' | 'objectives' | 'important' | 'chat' | 'queue' | 'history' | 'logs' | 'item' | 'note'

// The note the History view shows whole (preview) or is about to attach (confirm).
export type Opened = { name: string; step: 'preview' | 'confirm' }

export type Todo = { id: string; text: string; status: 'todo' | 'in-progress' | 'done' | 'declined' | 'blocked' }

declare module 'claude-code' {
  interface PluginState {
    'notes-keeping': {
      notes: Notes | null
      select: Select | null
      handled: string
      queue: Pair[]
      editing: boolean
      draft: string
      view: View
      isNotesOpen: boolean
      picked: Opened | null
      cursor: string | null
      todoCursor: string | null
      todoOpen: string | null
      noteOpen: string | null
      hidden: Todo['status'][]
    }
  }
}
