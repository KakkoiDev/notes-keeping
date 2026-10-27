export type Sections = {
  continuation: string | undefined
  sessions: readonly string[]
  objectives: string
  updates: string
  important: string
  chat: string
}

export type Notes = { path: string; sections: Sections }

export type NameParts = { date: string; time: string; project: string; shortId: string }

// isPlaced: the selection pane is drawn; hadFocus: it held the keyboard, so losing it closes it.
export type Select = { mode: 'menu' | 'reply'; selection: string; isPlaced: boolean; hadFocus: boolean }

export type Pair = { agent: string; user: string }

declare module 'claude-code' {
  interface PluginState {
    'notes-keeping': {
      notes: Notes | null
      select: Select | null
      handled: string
      queue: Pair[]
      editing: boolean
      picked: number | null
      revising: boolean
      isNotesOpen: boolean
    }
  }
}
