// Display-only bidi marking for markdown text: every line that holds Hebrew
// gets a direction by the language most of its letters are in, and the parts
// in the other direction are embedded. Nothing is closed at the end of a line.

export const LRM = '‎'
export const RLM = '‏'
export const LRE = '‪'
export const RLE = '‫'
export const PDF = '‬'

const HEB_LETTER = /[א-תׯ-ײיִ-ﭏ]/
const LAT_LETTER = /[A-Za-zÀ-ɏ]/
const WORD = /[A-Za-zÀ-ɏא-תׯ-ײיִ-ﭏ0-9]/
const HAS_HEB = /[א-תׯ-ײיִ-ﭏ]/
// What closes a Hebrew run in an English line along with it.
const TRAILING_PUNCT = /[.,;:!?…׃]/

const isHeb = (c: string | undefined) => c !== undefined && HEB_LETTER.test(c)
const isLat = (c: string | undefined) => c !== undefined && LAT_LETTER.test(c)
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c)
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

export type Seg =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string }
  | { kind: 'quote'; open: string; body: string; close: string }

export type Counts = { heb: number; lat: number }

export function countLetters(s: string): Counts {
  let heb = 0
  let lat = 0
  for (const c of s) {
    if (isHeb(c)) heb++
    else if (isLat(c)) lat++
  }
  return { heb, lat }
}

/** The end (exclusive) of a code span opening at `i`, or -1 when it does not close. */
function codeSpanEnd(s: string, i: number): number {
  let n = 0
  while (s[i + n] === '`') n++
  let j = i + n
  while (j < s.length) {
    if (s[j] !== '`') {
      j++
      continue
    }
    let m = 0
    while (s[j + m] === '`') m++
    if (m === n) return j + m
    j += m
  }
  return -1
}

const LINK = /^!?\[[^\]\n]*\]\([^)\s]*(?:\s+"[^"]*")?\)/
const AUTOLINK = /^<(?:https?|mailto|file):[^>\s]+>/
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>()]+/
const QUOTE_PAIRS: Record<string, string> = { '"': '"', '“': '”', '„': '“' }

/** The index of the quote mark closing a quote opened at `i`, or -1. */
function quoteClose(s: string, i: number): number {
  const open = s[i]!
  const close = QUOTE_PAIRS[open]!
  if (isWord(s[i - 1])) return -1 // gershayim inside a word: צה"ל
  if (isSpace(s[i + 1])) return -1
  for (let j = i + 2; j < s.length; j++) {
    if (s[j] === '`') {
      const end = codeSpanEnd(s, j)
      if (end > 0) {
        j = end - 1
        continue
      }
    }
    if (s[j] === close || (open === '„' && s[j] === '”')) {
      if (isSpace(s[j - 1])) continue
      if (close === '"' && isWord(s[j + 1])) continue // gershayim again
      return j
    }
  }
  return -1
}

/** Splits a line's content into plain text, code spans, links and quotes. */
export function segment(s: string): Seg[] {
  const out: Seg[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    const rest = s.slice(i)
    if (c === '`') {
      const end = codeSpanEnd(s, i)
      if (end > 0) {
        flush()
        out.push({ kind: 'code', text: s.slice(i, end) })
        i = end
        continue
      }
      let n = 0
      while (s[i + n] === '`') n++
      text += s.slice(i, i + n)
      i += n
      continue
    }
    if (c === '[' || c === '!' || c === '<' || ((c === 'h' || c === 'w') && !isWord(s[i - 1]))) {
      const m = LINK.exec(rest) ?? AUTOLINK.exec(rest) ?? (c === 'h' || c === 'w' ? BARE_URL.exec(rest) : null)
      if (m) {
        flush()
        out.push({ kind: 'link', text: m[0] })
        i += m[0].length
        continue
      }
    }
    if (c in QUOTE_PAIRS) {
      const j = quoteClose(s, i)
      if (j > 0) {
        flush()
        out.push({ kind: 'quote', open: c, body: s.slice(i + 1, j), close: s[j]! })
        i = j + 1
        continue
      }
    }
    text += c
    i++
  }
  flush()
  return out
}

const segText = (seg: Seg) => (seg.kind === 'quote' ? seg.open + seg.body + seg.close : seg.text)

/** 'rtl' when most of the letters outside quotes, code spans and links are Hebrew. */
export function directionOf(content: string, segs = segment(content)): 'rtl' | 'ltr' {
  const plain = countLetters(segs.filter(s => s.kind === 'text').map(segText).join(''))
  if (plain.heb !== plain.lat) return plain.heb > plain.lat ? 'rtl' : 'ltr'
  const all = countLetters(content)
  if (all.heb !== all.lat) return all.heb > all.lat ? 'rtl' : 'ltr'
  for (const c of content) {
    if (isHeb(c)) return 'rtl'
    if (isLat(c)) return 'ltr'
  }
  return 'rtl'
}

const isMostlyLatin = (s: string) => {
  const n = countLetters(s)
  return n.lat > n.heb
}
const isMostlyHebrew = (s: string) => {
  const n = countLetters(s)
  return n.heb > n.lat
}

/** Embeds each Hebrew run of plain text (with the punctuation closing it) RTL. */
export function embedHebrewRuns(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (!isHeb(text[i])) {
      out += text[i]
      i++
      continue
    }
    let last = i
    let k = i
    while (k < text.length && !isLat(text[k])) {
      if (isHeb(text[k])) last = k
      k++
    }
    let end = last + 1
    while (end < text.length && TRAILING_PUNCT.test(text[end]!)) end++
    out += RLE + text.slice(i, end) + PDF
    i = end
  }
  return out
}

/** Marks one line's content (what follows its markdown markers). */
export function markContent(content: string): string {
  if (!HAS_HEB.test(content)) return content
  if (content.startsWith(RLM) || content.startsWith(LRM)) return content
  const segs = segment(content)
  if (directionOf(content, segs) === 'rtl') {
    const body = segs
      .map(s => (s.kind === 'code' && isMostlyLatin(s.text) ? LRE + s.text + PDF : segText(s)))
      .join('')
    return RLM + RLE + body
  }
  const body = segs
    .map(s => {
      if (s.kind === 'quote') return isMostlyHebrew(s.body) ? s.open + RLE + s.body + PDF + s.close : segText(s)
      if (s.kind === 'text') return embedHebrewRuns(s.text)
      return s.text
    })
    .join('')
  return LRM + LRE + body
}

const PREFIX = /^[ \t]*(?:(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)[ \t]*)*/

/** Marks one line, its markdown markers kept ahead of the marks. */
export function markLine(line: string): string {
  if (!HAS_HEB.test(line)) return line
  if (/^\s*\|/.test(line)) return markTableRow(line)
  const prefix = PREFIX.exec(line)?.[0] ?? ''
  return prefix + markContent(line.slice(prefix.length))
}

/** Splits a table row on its pipes, leaving `\|` and pipes in code spans alone. */
export function splitCells(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let i = 0
  while (i < line.length) {
    const c = line[i]!
    if (c === '\\' && line[i + 1] === '|') {
      cell += '\\|'
      i += 2
      continue
    }
    if (c === '`') {
      const end = codeSpanEnd(line, i)
      if (end > 0) {
        cell += line.slice(i, end)
        i = end
        continue
      }
    }
    if (c === '|') {
      cells.push(cell)
      cell = ''
      i++
      continue
    }
    cell += c
    i++
  }
  cells.push(cell)
  return cells
}

export function markTableRow(line: string): string {
  return splitCells(line)
    .map(cell => {
      const lead = /^\s*/.exec(cell)![0]
      return lead + markContent(cell.slice(lead.length))
    })
    .join('|')
}

/** Marks every line of a markdown text, leaving fenced code blocks alone. */
export function markText(text: string): string {
  if (!HAS_HEB.test(text)) return text
  let fence: { char: string; len: number } | null = null
  return text
    .split('\n')
    .map(line => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null
        return line
      }
      if (m) {
        fence = { char: m[1]![0]!, len: m[1]!.length }
        return line
      }
      return markLine(line)
    })
    .join('\n')
}
