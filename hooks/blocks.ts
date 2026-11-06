// For the terminal: splits a message into the lines that read right to left,
// drawn by the mod as Text with dir="rtl" (flush right, letters ordered by the
// engine), and everything else, left to the engine's own Markdown. No control
// characters are inserted: a terminal that does not run the bidi algorithm
// (Windows Terminal) draws those as boxes or question marks.

import { directionOf } from './bidi'

const HAS_HEB = /[א-תׯ-ײיִ-ﭏ]/

export type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean }

export type RtlLine = {
  kind: 'rtl'
  /** Leading spaces of a nested item, kept so nesting shows from the right. */
  indent: string
  /** The drawn marker: '• ', '1. ', '│ ', '☐ ', or ''. */
  marker: string
  heading: boolean
  runs: Run[]
}

export type Block = { kind: 'md'; text: string } | { kind: 'blank' } | RtlLine

const PREFIX = /^([ \t]*)((?:>[ \t]?)*)(#{1,6}[ \t]+|[-*+][ \t]+(?:\[([ xX])\][ \t]+)?|(\d{1,9})([.)])[ \t]+)?/

/** Inline markdown of one RTL line as styled runs: code, bold, italic, links as their text. */
export function inlineRuns(s: string): Run[] {
  const runs: Run[] = []
  let plain = ''
  const flush = () => {
    if (plain) runs.push({ text: plain })
    plain = ''
  }
  let i = 0
  while (i < s.length) {
    const rest = s.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush()
      runs.push({ text: m[2]!.trim() === '' ? m[2]! : m[2]!.replace(/^ (.*) $/, '$1'), code: true })
      i += m[0].length
      continue
    }
    if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      flush()
      for (const r of inlineRuns(m[2]!)) runs.push({ ...r, bold: true })
      i += m[0].length
      continue
    }
    if ((m = /^\*(?=[^\s*])([^*]*?[^\s*])\*/.exec(rest)) && !/[A-Za-z0-9]/.test(s[i - 1] ?? '')) {
      flush()
      for (const r of inlineRuns(m[1]!)) runs.push({ ...r, italic: true })
      i += m[0].length
      continue
    }
    if ((m = /^!?\[([^\]\n]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest))) {
      plain += m[1] || m[2]
      i += m[0].length
      continue
    }
    if ((m = /^<((?:https?|mailto|file):[^>\s]+)>/.exec(rest))) {
      plain += m[1]
      i += m[0].length
      continue
    }
    if (s[i] === '\\' && /[\\`*_{}\[\]()#+\-.!|>~]/.test(s[i + 1] ?? '')) {
      plain += s[i + 1]
      i += 2
      continue
    }
    plain += s[i]
    i++
  }
  flush()
  return runs
}

/** One line as an RTL line, or null when it reads left to right or holds no Hebrew. */
export function rtlLine(line: string): RtlLine | null {
  if (!HAS_HEB.test(line)) return null
  const m = PREFIX.exec(line)!
  const content = line.slice(m[0].length)
  if (!HAS_HEB.test(content) || directionOf(content) !== 'rtl') return null
  const indent = m[1]!.replace(/\t/g, '  ')
  const quote = m[2] ? '│ ' : ''
  const item = m[3] ?? ''
  let marker = ''
  let heading = false
  if (item.startsWith('#')) heading = true
  else if (m[5]) marker = m[5] + m[6] + ' '
  else if (m[4] !== undefined) marker = m[4] === ' ' ? '☐ ' : '☑ '
  else if (item) marker = '• '
  return { kind: 'rtl', indent, marker: quote + marker, heading, runs: inlineRuns(content) }
}

/**
 * The blocks to draw, or null when no line reads right to left (the engine
 * then draws the message as it would anyway).
 */
export function splitBlocks(text: string): Block[] | null {
  if (!HAS_HEB.test(text)) return null
  type Item = { kind: 'md'; line: string } | { kind: 'blank' } | RtlLine
  const items: Item[] = []
  let fence: { char: string; len: number } | null = null
  for (const line of text.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null
      items.push({ kind: 'md', line })
      continue
    }
    if (f) {
      fence = { char: f[1]![0]!, len: f[1]!.length }
      items.push({ kind: 'md', line })
      continue
    }
    if (line.trim() === '') {
      items.push({ kind: 'blank' })
      continue
    }
    if (/^\s*\|/.test(line)) {
      items.push({ kind: 'md', line })
      continue
    }
    items.push(rtlLine(line) ?? { kind: 'md', line })
  }
  if (!items.some(i => i.kind === 'rtl')) return null

  const out: Block[] = []
  for (let k = 0; k < items.length; k++) {
    const it = items[k]!
    if (it.kind === 'rtl') {
      out.push(it)
      continue
    }
    if (it.kind === 'md') {
      const last = out[out.length - 1]
      if (last?.kind === 'md') last.text += '\n' + it.line
      else out.push({ kind: 'md', text: it.line })
      continue
    }
    // A blank line: inside a run of markdown it stays in that markdown
    // (paragraphs, lists); elsewhere it is one blank row, never two in a row.
    let n = k
    while (n < items.length && items[n]!.kind === 'blank') n++
    const prev = out[out.length - 1]
    const nextItem = items[n]
    if (!prev || !nextItem) {
      k = n - 1
      continue
    }
    if (prev.kind === 'md' && nextItem.kind === 'md') prev.text += '\n'.repeat(n - k)
    else out.push({ kind: 'blank' })
    k = n - 1
  }
  return out
}
