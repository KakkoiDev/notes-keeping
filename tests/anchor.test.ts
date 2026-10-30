import { describe, expect, test } from 'claude-code/testing'

import { hrefOf, locate, marked, noteOf } from '../hooks/anchor'

const h = hrefOf('n1')
const g = hrefOf('n2')

describe('locate: the selected text, as the terminal copies it, found in the markdown source', () => {
  test('plain text: every occurrence, in order', () => {
    expect(locate('a cat and a cat', 'cat')).toEqual([{ start: 2, end: 5 }, { start: 12, end: 15 }])
  })

  test('markup the terminal does not show is skipped on both sides', () => {
    const source = 'the `foo` fn and **bold text** here'
    const [span] = locate(source, 'foo fn and bold')
    expect(source.slice(span?.start, span?.end)).toBe('foo` fn and **bold')
  })

  test('a link shows its label; list bullets, headings, quotes and wrapped whitespace are skipped', () => {
    const source = '## Plan\n\n- see [the docs](https://x.y) now\n> quoted\n  line'
    expect(locate(source, 'Plan')).toHaveLength(1)
    const [span] = locate(source, '• see the docs now quoted line')
    expect(source.slice(span?.start, span?.end)).toBe('see [the docs](https://x.y) now\n> quoted\n  line')
  })

  test('text inside a fenced code block is not found: a link cannot be drawn there', () => {
    expect(locate('```ts\nconst a = 1\n```', 'const a = 1')).toEqual([])
  })

  test('a selection of markup or whitespace alone finds nothing', () => {
    expect(locate('a **b** c', ' ** ')).toEqual([])
  })
})

describe('marked: each noted span drawn as a link to its note', () => {
  test('the span becomes a link; the rest of the text is left as written', () => {
    expect(marked('The quick brown fox jumps.', [{ id: 'n1', at: 0, agent: 'brown fox' }])).toBe(`The quick [brown fox](${h}) jumps.`)
  })

  test('at picks the occurrence; one that is not there marks nothing', () => {
    expect(marked('a cat and a cat', [{ id: 'n1', at: 1, agent: 'cat' }])).toBe(`a cat and a [cat](${h})`)
    expect(marked('a cat and a cat', [{ id: 'n1', at: 2, agent: 'cat' }])).toBe('a cat and a cat')
    expect(marked('a cat', [{ id: 'n1', at: 0, agent: 'dog' }])).toBe('a cat')
  })

  test('a span that cuts a code span or emphasis grows to hold it whole, so the markup stays balanced', () => {
    expect(marked('the `foo` fn and **bold text** here', [{ id: 'n1', at: 0, agent: 'foo fn and bold' }])).toBe(
      `the [\`foo\` fn and **bold text**](${h}) here`,
    )
  })

  test('a span over several lines is one link per line, past each line\'s bullet', () => {
    expect(marked('- first item\n- second item', [{ id: 'n1', at: 0, agent: 'item\nsecond' }])).toBe(`- first [item](${h})\n- [second](${h}) item`)
  })

  test('a link inside the span gives way to its label: a link cannot hold another', () => {
    expect(marked('see [the docs](https://x.y) now', [{ id: 'n1', at: 0, agent: 'docs now' }])).toBe(`see [the docs now](${h})`)
  })

  test('two notes on one block each get their own link; an overlapping second one is dropped', () => {
    const notes = [
      { id: 'n1', at: 0, agent: 'quick' },
      { id: 'n2', at: 0, agent: 'fox' },
    ]
    expect(marked('The quick brown fox.', notes)).toBe(`The [quick](${h}) brown [fox](${g}).`)
    expect(marked('The quick brown fox.', [notes[0]!, { id: 'n2', at: 0, agent: 'quick brown' }])).toBe(`The [quick](${h}) brown fox.`)
  })

  test('the href names the note and reads back; any other href names none', () => {
    expect(noteOf(h)).toBe('n1')
    expect(noteOf('https://example.com/n1')).toBeUndefined()
  })
})
