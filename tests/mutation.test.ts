import { describe, expect, test } from 'claude-code/testing'

import { applyMutation, revisionOf, type MutationRequest } from '../hooks/mutation'
import { create, sections } from '../hooks/notes'
import { items } from '../hooks/todo'

const base = (kind: MutationRequest['kind'], text: string, eventId: string): MutationRequest => ({
  kind,
  text,
  actor: 'captain',
  transport: 'tmux/codex',
  eventId,
  requestHash: revisionOf(`${kind}:${text}`),
  at: Date.UTC(2026, 10, 20, 9),
})

describe('shared mutation engine', () => {
  test('revision is SHA-256 for ASCII and UTF-8', () => {
    expect(revisionOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(revisionOf('日本語')).toBe('77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5')
  })

  test('direct categories share note semantics and content-free audit metadata', () => {
    let markdown = create('', 'codex-session')
    markdown = applyMutation(markdown, base('add', 'Ship popup', '1111111111111111')).markdown
    markdown = applyMutation(markdown, base('update', 'Popup works', '2222222222222222')).markdown
    markdown = applyMutation(markdown, base('objective', 'Capture exact text', '3333333333333333')).markdown
    markdown = applyMutation(markdown, base('objective', 'Keep improving', '4444444444444444')).markdown
    markdown = applyMutation(markdown, base('important', 'Do not scrape', '5555555555555555')).markdown
    const parsed = sections(markdown)
    expect(items(parsed.todo).map(item => item.text)).toEqual(['Ship popup'])
    expect(parsed.objectives).toBe('Capture exact text')
    expect(parsed.updates).toContain('Popup works')
    expect(parsed.updates).toContain('Keep improving')
    expect(parsed.important).toBe('[AI_AGENT] Do not scrape')
    expect(parsed.logs).not.toContain('Do not scrape')
    expect(parsed.logs).toContain('transport=tmux/codex event=5555555555555555 hash=')
  })
})
