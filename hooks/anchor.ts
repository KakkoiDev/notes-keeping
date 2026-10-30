// A note's anchor is a span of an assistant reply's markdown source, found again from the text the terminal copied.

export type Span = { start: number; end: number }
export type Anchored = { id: string; at: number; agent: string }

// .invalid never resolves: a ctrl or cmd click, which opens the link, goes nowhere.
const HREF = 'https://notes-keeping.invalid/note/'
// Markup the terminal draws as styling, and whitespace, which wrapping and copying change; both sides skip them.
const SKIPPED = /[\s*_`~|\\]/
const FENCE = /^[ \t]*(```|~~~)/
// A line's bullet, heading, quote or task marker; the terminal draws some as other glyphs (•) and a reply opens with ⏺.
const PREFIX = /^[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|(?:[-*+•⏺]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)*/
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g
// Runs a span must hold whole or not cut: a code span, emphasis, strikethrough, a link.
const RUNS = [/`[^`\n]+`/g, /(\*\*|__|~~)(?=\S)[^\n]*?\S\1/g, /(?<![*\w])\*(?=[^\s*])[^\n*]*?[^\s*]\*(?![*\w])/g, LINK]

export function hrefOf(id: string): string {
  return `${HREF}${id}`
}

export function noteOf(href: string): string | undefined {
  return href.startsWith(HREF) ? href.slice(HREF.length) : undefined
}

type Line = { start: number; body: number; end: number; isCode: boolean }

function lines(text: string): Line[] {
  const out: Line[] = []
  let isCode = false
  let start = 0
  for (const line of text.split('\n')) {
    const isFence = FENCE.test(line)
    out.push({ start, body: start + (PREFIX.exec(line)?.[0].length ?? 0), end: start + line.length, isCode: isCode || isFence })
    if (isFence) isCode = !isCode
    start += line.length + 1
  }
  return out
}

// The characters the terminal shows, less SKIPPED, each with its index in `text`.
function keyed(text: string): { key: string; at: number[] } {
  const dropped = new Set<number>()
  for (const m of text.matchAll(LINK)) {
    dropped.add(m.index)
    for (let i = m.index + 1 + (m[1]?.length ?? 0); i < m.index + m[0].length; i++) dropped.add(i)
  }
  let key = ''
  const at: number[] = []
  for (const line of lines(text)) {
    if (line.isCode) continue
    for (let i = line.body; i < line.end; i++) {
      const ch = text[i] ?? ''
      if (dropped.has(i) || SKIPPED.test(ch)) continue
      key += ch
      at.push(i)
    }
  }
  return { key, at }
}

export function locate(source: string, selection: string): Span[] {
  const want = keyed(selection).key
  if (want === '') return []
  const { key, at } = keyed(source)
  const out: Span[] = []
  for (let i = key.indexOf(want); i >= 0; i = key.indexOf(want, i + want.length)) {
    out.push({ start: at[i] ?? 0, end: (at[i + want.length - 1] ?? 0) + 1 })
  }
  return out
}

// Widens [start, end) until no run on the line is cut by it.
function widen(source: string, line: Line, start: number, end: number): Span {
  const text = source.slice(line.body, line.end)
  const runs = RUNS.flatMap(re => [...text.matchAll(re)].map(m => ({ start: line.body + m.index, end: line.body + m.index + m[0].length })))
  let span = { start, end }
  for (let moved = true; moved; ) {
    moved = false
    for (const run of runs) {
      const cuts = (span.start > run.start && span.start < run.end) || (span.end > run.start && span.end < run.end)
      if (cuts) {
        span = { start: Math.min(span.start, run.start), end: Math.max(span.end, run.end) }
        moved = true
      }
    }
  }
  return span
}

// One segment per line the span covers, past the line's prefix, trimmed, out of fenced code.
function segments(source: string, span: Span): Span[] {
  const out: Span[] = []
  for (const line of lines(source)) {
    if (line.isCode || line.end <= span.start || line.start >= span.end) continue
    let start = Math.max(span.start, line.body)
    let end = Math.min(span.end, line.end)
    while (start < end && /\s/.test(source[start] ?? '')) start++
    while (end > start && /\s/.test(source[end - 1] ?? '')) end--
    if (start < end) out.push(widen(source, line, start, end))
  }
  return out
}

// Each note's span as a markdown link to its note; a span overlapping one already drawn is left out.
export function marked(source: string, notes: readonly Anchored[]): string {
  const links: (Span & { label: string; href: string })[] = []
  for (const note of notes) {
    const span = locate(source, note.agent)[note.at]
    if (span === undefined) continue
    for (const seg of segments(source, span)) {
      const label = source.slice(seg.start, seg.end).replace(LINK, '$1')
      if (/[[\]]/.test(label) || links.some(link => seg.start < link.end && link.start < seg.end)) continue
      links.push({ ...seg, label, href: hrefOf(note.id) })
    }
  }
  let out = source
  for (const link of links.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, link.start)}[${link.label}](${link.href})${out.slice(link.end)}`
  }
  return out
}
