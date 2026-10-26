export type Sections = {
  continuation: string | undefined
  sessions: readonly string[]
  prompt: string
  updates: string
  important: string
  chat: string
}

export type Notes = { path: string; sections: Sections }

export type NameParts = { date: string; time: string; project: string; shortId: string }

export type Band = { mode: 'menu' | 'reply'; selection: string }

declare module 'claude-code' {
  interface PluginState {
    'notes-keeping': { notes: Notes | null; band: Band | null; handled: string }
  }
}
