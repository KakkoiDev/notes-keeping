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

// item: one todo item whole, opened from the Todos view; note: one reply, opened from its mark in the transcript; work:
// the firstmate fleet, work-item one row of it whole, and work-report that row's report read in the pane.
export type View = 'todos' | 'objectives' | 'important' | 'chat' | 'queue' | 'history' | 'logs' | 'item' | 'note' | 'work' | 'work-item' | 'work-report'

// The note the History view shows whole (preview) or is about to attach (confirm).
export type Opened = { name: string; step: 'preview' | 'confirm' }

// What `bridge fleet` reads from the head of a row's report: its title, its outcome line, what it asks the captain, and
// the file's mtime in epoch seconds.
export type ReportSummary = { title: string; outcome: string | null; ask: string | null; at: number }

// One row of `bridge fleet`: a task with a meta, or a live captain hold (word "call"). at: the epoch second of its last
// state line, or of the hold. flag: "!" waits on the captain, "?" on firstmate. answer: what a reply to it starts with.
export type FleetRow = {
  task: string
  kind: string | null
  title: string | null
  word: string
  at: number | null
  flag: '!' | '?' | ''
  waiting: string
  window: string | null
  live: boolean
  gone: boolean
  pr: string | null
  report: string | null
  // null when the row names no report or it could not be read.
  summary: ReportSummary | null
  todo: string | null
  answer: string | null
}

// at: when the plugin read it, in clock milliseconds. calls: live captain holds tied to no row, counted only.
export type Fleet = { rows: FleetRow[]; calls: number; at: number }

// The Work view's filters, keys 1 to 6.
export type WorkGroup = 'you' | 'firstmate' | 'running' | 'idle' | 'done' | 'gone'

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
      fleet: Fleet | null
      workHidden: WorkGroup[]
      workCursor: string | null
      workOpen: string | null
      workAnswering: boolean
      crew: { task: string; text: string } | null
    }
  }
}
