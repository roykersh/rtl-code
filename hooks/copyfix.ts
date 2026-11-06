// A selection copied off the terminal holds each line's cells left to right:
// a line drawn right to left (dir="rtl") comes out in visual order, so a paste
// reads backwards. These helpers turn such a line back into reading order.

const HEB = /[א-תװ-״יִ-ﭏ]/
const LAT = /[A-Za-zÀ-ɏ]/
const LTR = /[A-Za-z0-9À-ɏ]/
const FINAL_AT_END = /[ךםןףץ]$/ // ך ם ן ף ץ
const FINAL_AT_START = /^[ךםןףץ]/
// What the mod draws beside a message row: its markers and the waiting label.
const EDGE = /^[\s❮◷]+|[\s❮◷]+$/g
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' }

/** Whether a copied line was drawn right to left, so its cells are in visual order. */
export function isVisualRtl(line: string): boolean {
  const t = line.replace(EDGE, '')
  if (!HEB.test(t)) return false
  // Final letters (ך ם ן ף ץ) end a word as written; read first, the word is reversed.
  let reversed = 0
  let written = 0
  for (const w of t.match(/[א-ת]{2,}/g) ?? []) {
    if (FINAL_AT_START.test(w) && !FINAL_AT_END.test(w)) reversed++
    else if (FINAL_AT_END.test(w) && !FINAL_AT_START.test(w)) written++
  }
  if (reversed !== written) return reversed > written
  // No telling letters: a right-to-left line starts at its right edge, with Hebrew.
  const chars = Array.from(t)
  const strong = (c: string) => (HEB.test(c) ? 'R' : LAT.test(c) ? 'L' : null)
  const right = chars.reverse().map(strong).find(Boolean)
  return right === 'R'
}

/** One visual-order line back in reading order, its mirrored brackets put back. */
export function toLogical(line: string): string {
  const chars = Array.from(line.replace(EDGE, '')).reverse()
  const inRun = new Array<boolean>(chars.length).fill(false)
  // Left-to-right runs (Latin, digits, and what stands between them short of
  // Hebrew) were drawn in their own order: reverse each one back.
  let i = 0
  while (i < chars.length) {
    if (!LTR.test(chars[i]!)) {
      i++
      continue
    }
    let end = i
    for (let k = i + 1; k < chars.length && !HEB.test(chars[k]!); k++) if (LTR.test(chars[k]!)) end = k
    const run = chars.slice(i, end + 1).reverse()
    for (let k = i; k <= end; k++) {
      chars[k] = run[k - i]!
      inRun[k] = true
    }
    i = end + 1
  }
  return chars.map((c, k) => (inRun[k] ? c : MIRROR[c] ?? c)).join('')
}

const norm = (s: string) => s.replace(/[()[\]{}<>«»*_`]/g, '').replace(/\s+/g, ' ').trim()

/**
 * A copied selection with every right-to-left line in reading order. `known`
 * holds the lines of the rows drawn lately, as they read: a line that does not
 * read as one of them (a wrapped paragraph, its rows joined) is matched to one
 * by its words, and that one's words are used.
 */
export function fixCopy(text: string, known: readonly string[] = []): string {
  if (!HEB.test(text)) return text
  return text
    .split('\n')
    .map(line => {
      if (!isVisualRtl(line)) return line
      const fixed = toLogical(line)
      const n = norm(fixed)
      if (!n || known.some(k => norm(k).includes(n))) return fixed
      const words = n.split(' ')
      const want = [...words].sort().join(' ')
      for (const k of known) {
        const kw = k.replace(/\s+/g, ' ').trim().split(' ')
        const kn = kw.map(norm)
        for (let s = 0; s + words.length <= kw.length; s++) {
          if ([...kn.slice(s, s + words.length)].sort().join(' ') === want) return kw.slice(s, s + words.length).join(' ')
        }
      }
      return fixed
    })
    .join('\n')
}
