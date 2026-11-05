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

// row: the transcript row the selection lies in; isPlaced: the selection pane is drawn; hadFocus: it held the keyboard, so losing it closes it;
// isPasted: the selection lies in the text of the Paste view.
export type Select = { mode: 'menu' | 'reply'; selection: string; row?: string; isPlaced: boolean; hadFocus: boolean; isPasted?: true }

// A reply's anchor: the note's id, the transcript row (requestId) the quoted text was selected in, and which occurrence of it in that row.
export type Note = { id: string; row: string; at: number }

// pasted: agent holds text the captain pasted (from source, when named) and user the notes taken on it.
export type Pair = { agent: string; user: string; note?: Note; pasted?: { source?: string } }

export type ChatNote = Note & { agent: string; user: string }

// item: one todo item whole, opened from the Todos view; note: one reply, opened from its mark in the transcript; work:
// the firstmate fleet, work-item one row of it whole, and work-report that row's report read in the pane; paste: text the
// captain pasted, to select parts of and note.
export type View = 'paste' | 'todos' | 'objectives' | 'important' | 'chat' | 'queue' | 'history' | 'logs' | 'item' | 'note' | 'work' | 'work-item' | 'work-report'

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
  // The open todo items, by id, a link ties to the row's task or a hold's origin task, in file order.
  todos: string[]
  answer: string | null
  // On a live captain hold: its Question: line (else its title), one option per Options: line, and when it was set.
  call?: Call | null
  // On an answered call: what happened to the answer, from records only, oldest first.
  trail?: TrailStep[]
}

// One step of an answer's trail; at is null when the record carries no time.
export type TrailStep = { at: number | null; who: 'you' | 'firstmate' | 'worker'; text: string }

// A captain call closed today by a resolution not in the captain's words.
export type ClosedCall = { task: string; title: string; evidence: string | null }

export type Call = { question: string; options: string[]; at: number | null; state: 'open' | 'answered' }

// One line under a to-do in the Todos view; right is drawn at the row's right edge, isCall lines are never dim.
export type SubLine = { text: string; right?: string; isCall?: true }

// at: when the plugin read it, in clock milliseconds. calls: live captain holds tied to no row, counted only.
// gone: worker records whose window is gone and no open item links, counted only.
// closedToday: captain calls closed today without the captain, listed in closed.
export type Fleet = { rows: FleetRow[]; calls: number; gone?: number; closedToday?: number; closed?: ClosedCall[]; at: number }

// What the Work view lists beside the work without a to-do: gone workers (6), calls closed without the captain (x).
export type WorkShown = 'gone' | 'closed'

export type Todo = { id: string; text: string; status: 'todo' | 'in-progress' | 'done' | 'declined' | 'blocked' | 'paused' }

declare module 'claude-code' {
  interface PluginState {
    'notes-keeping': {
      notes: Notes | null
      select: Select | null
      handled: string
      queue: Pair[]
      editing: boolean
      draft: string
      pasteText: string
      view: View
      isNotesOpen: boolean
      picked: Opened | null
      cursor: string | null
      todoCursor: string | null
      todoOpen: string | null
      todoPausing: string | null
      noteOpen: string | null
      hidden: Todo['status'][]
      fleet: Fleet | null
      workShown: WorkShown[]
      workCursor: string | null
      workOpen: string | null
      workAnswering: boolean
      callAnswering: string | null
      reportFrom: View
    }
  }
}
