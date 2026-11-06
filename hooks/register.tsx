import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { markText } from './bidi'
import { type Block, inlineRuns, mirrorRtl, splitBlocks } from './blocks'
import { fixCopy } from './copyfix'

export { markText } from './bidi'

const isOn = atom({ plugin: 'rtl-code', key: 'isOn' } as const, false)
// The prompt box's draft, mirrored right to left above the box while it holds Hebrew.
const draft = atom({ plugin: 'rtl-code', key: 'draft' } as const, '')
// Where the caret stands in the draft, and whether the drawn caret is lit (it blinks).
const caret = atom({ plugin: 'rtl-code', key: 'caret' } as const, 0)
const lit = atom({ plugin: 'rtl-code', key: 'lit' } as const, true)
// Whether the draft preview is folded down to its mark; kept across sessions in $.store.
const folded = atom({ plugin: 'rtl-code', key: 'folded' } as const, false)
let blinker: { cancel: () => void } | undefined
// Prompts typed while a turn ran that Claude has not read yet, as normalized text.
const waiting = atom({ plugin: 'rtl-code', key: 'waiting' } as const, [] as string[])
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
// How many times the queue's record of each text was raised (put in, taken out).
const queued = new Map<string, number>()
/** Every string in a value (a row, its blocks), joined: where a prompt's words may sit. */
function textsOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(textsOf).join(' ')
  if (v && typeof v === 'object') return Object.values(v).map(textsOf).join(' ')
  return ''
}
/** Drops the waiting prompts that `said` holds: Claude has read them. */
async function markRead(said: string, $: EngineInterface) {
  if (!said) return
  const w = await read($, waiting)
  if (w.length === 0) return
  const left = w.filter(t => !said.includes(t))
  if (left.length !== w.length) await update($, waiting, () => left)
}
async function clearWaiting($: EngineInterface) {
  queued.clear()
  if ((await read($, waiting)).length > 0) await update($, waiting, () => [] as string[])
}

// The lines of the message rows drawn lately, as they read (markdown dropped),
// newest last; a copied selection is checked against them (copyfix.ts).
const drawn = new Map<string, string[]>()
function remember(id: string, text: string) {
  drawn.delete(id)
  drawn.set(
    id,
    text
      .split(String.fromCharCode(10))
      .map(l => inlineRuns(l.replace(/^[ \t>]*(#{1,6}[ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)?/, '')).map(r => r.text).join(''))
      .filter(l => l.trim() !== ''),
  )
  if (drawn.size > 300) drawn.delete(drawn.keys().next().value!)
}
const knownLines = () => [...drawn.values()].flat()

// A selection copied off the terminal reads right-to-left lines backwards. The
// engine copies it as the mouse lets go; a moment later the mod puts the same
// selection on the clipboard in reading order, and once more a little after.
let poller: { cancel: () => void } | undefined
let seen = ''
let still = 0
const ours = new Set<string>()
async function watchSelection($: EngineInterface) {
  if (!(await read($, isOn))) return
  const sel = await $.ui.selection()
  const text = sel?.text ?? ''
  if (text !== seen) {
    seen = text
    still = 0
    return
  }
  still++
  if (!text || (still !== 1 && still !== 5)) return
  const fixed = fixCopy(text, knownLines())
  if (fixed === text) return
  ours.add(fixed)
  await $.ui.copy({ text: fixed, surface: 'terminal' })
}

/** Mirrors the box: the draft and caret, a lit caret after each edit, the blink while Hebrew shows. */
async function mirror($: EngineInterface, text: string, cursor: number) {
  await update($, draft, () => text)
  await update($, caret, () => cursor)
  await update($, lit, () => true)
  if (HEB.test(text)) {
    blinker ??= $.clock.every(530, () => void update($, lit, b => !b).catch(() => {}))
  } else {
    blinker?.cancel()
    blinker = undefined
  }
}
const HEB = /[א-ת]/

const GREEN = '#17DD95'
// The toggle's box on the desktop: green-tinted while on, a neutral grey while off.
const PILL_ON = 'rgba(52,211,153,0.16)'
const PILL_OFF = 'rgba(148,163,184,0.16)'
// A waiting prompt's row: a dark amber that reads on the dark theme.
const WAIT_BG = '#3D3214'

export const GUIDE = [
  'RTL mode is on: the person reads this conversation with Hebrew lines drawn right to left.',
  'When you answer in Hebrew:',
  '- Open every line (each paragraph, list item, heading and table cell) with a Hebrew word, never with an English word, a number, a command or a path.',
  '- Put a space on both sides of every English word.',
  '- Never join English to Hebrew with a hyphen (not "ה-API", write "ה API" or rephrase).',
  '- Put every command, file path and code identifier in backticks.',
  'When you answer in English: write normally, and put any Hebrew word or phrase inside double quotes.',
].join('\n')


/**
 * The terminal drawing: right-to-left lines as Text with dir="rtl" (flush
 * right, ordered by the engine), the rest as the engine draws it.
 */
function drawBlocks(ui: unknown, blocks: Block[], markdown: boolean, pending = false) {
  const { Box, Text, Markdown } = ui as any
  const body = (
    <Box flexDirection="column">
      {blocks.map((b, i) => {
        if (b.kind === 'blank') return <Text key={`b${i}`}> </Text>
        if (b.kind === 'md') return markdown ? <Markdown key={`m${i}`} text={b.text} /> : <Text key={`m${i}`}>{b.text}</Text>
        return (
          <Text key={`r${i}`} dir="rtl" weight={b.heading ? 'bold' : undefined}>
            {b.indent + b.marker}
            {b.runs.map((r, j) =>
              r.code ? (
                <Text key={`r${i}c${j}`} color="permission">{r.text}</Text>
              ) : r.bold || r.italic ? (
                <Text key={`r${i}s${j}`} weight={r.bold ? 'bold' : undefined} italic={r.italic}>{r.text}</Text>
              ) : (
                r.text
              ),
            )}
          </Text>
        )
      })}
    </Box>
  )
  if (markdown) return body
  // The person's own message: the prompt row's background and a mirrored marker
  // on the right, so it stands apart from the replies as it does with RTL off.
  // One Claude has not read yet (typed mid-turn, still queued) sits on an amber
  // row with a bold "waiting" label, until the engine hands it over.
  if (pending) {
    return (
      <Box flexDirection="row" backgroundColor={WAIT_BG}>
        <Box flexDirection="column" flexGrow={1}>
          {body}
          <Text dir="rtl" color="warning" weight="bold">{String.fromCharCode(0x25f7) + ' ממתין לקריאה'}</Text>
        </Box>
        <Text color="warning" weight="bold"> {String.fromCharCode(0x25f7)} </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="row" backgroundColor="userMessageBackground">
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
      <Text color="subtle"> {String.fromCharCode(0x276e)} </Text>
    </Box>
  )
}

const OFF_NOTE = 'RTL mode is off now: the RTL writing rules given earlier no longer apply.'

/**
 * The toggle itself. On the terminal it sits under the input box, at the right
 * of the prompt footer beside the session's own mode labels; on the desktop it
 * keeps its pill in the band above the prompt.
 */
function toggle(ui: unknown, $: EngineInterface, value: boolean) {
  const { Button, Text } = ui as any
  return (
    <Button key="rtl" plain onPress={() => setMode($, !value, true)}>
      <Text dimColor size="footnote" mono>RTL </Text>
      <Text color={value ? GREEN : 'subtle'} weight="bold" size="footnote" mono>
        {value ? 'ON' : 'OFF'}
      </Text>
    </Button>
  )
}

async function setFolded($: EngineInterface, value: boolean) {
  await update($, folded, () => value)
  await $.store.set('folded', value)
}

async function setMode($: EngineInterface, value: boolean, tellModel: boolean) {
  const before = await read($, isOn)
  await update($, isOn, () => value)
  await $.store.set('isOn', value)
  if (tellModel && before !== value) {
    // The system prompt of a running thread is fixed: tell the model in a row.
    await $.session
      .append({ message: { type: 'user', content: [{ type: 'text', text: value ? GUIDE : OFF_NOTE }] } })
      .catch(() => {})
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('isOn')
    await update($, isOn, () => stored === true)
    const fold = await $.store.get('folded')
    await update($, folded, () => fold === true)
    await $.command.register({
      name: 'rtl',
      description: 'Right-to-left display for Hebrew: toggle, or /rtl on, /rtl off',
      argumentHint: '[on|off]',
      immediate: true,
    })
    if (e.surface === 'terminal') {
      poller?.cancel()
      poller = $.clock.every(300, () => void watchSelection($).catch(() => {}))
    }
    return next(e)
  })

  // A copy of the person's selection, if the engine's own copy comes this way:
  // put right in place. Another plugin's copy of some other text is left alone.
  on('ui.copy', async ($, e, next) => {
    if (ours.delete(e.text)) return next(e)
    try {
      if (await read($, isOn)) {
        const sel = await $.ui.selection()
        if (sel && sel.text === e.text) {
          const fixed = fixCopy(e.text, knownLines())
          if (fixed !== e.text) return next({ ...e, text: fixed })
        }
      }
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'rtl' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Usage: /rtl, /rtl on or /rtl off' }
    const value = arg === '' ? !(await read($, isOn)) : arg === 'on'
    await setMode($, value, true)
    return { text: `RTL mode ${value ? 'ON' : 'OFF'}` }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOn))) return composed
    return {
      sections: [...composed.sections, { id: 'rtl-code:guide', text: GUIDE, scope: 'session' as const }],
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    if (e.surface === 'terminal') {
      // A notification or another agent's message keeps the engine's compact row.
      if (e.props.task || e.props.from) return next(e)
      remember(e.requestId, e.props.text)
      const pending = (await read($, waiting)).includes(norm(e.props.text))
      // An English prompt still waiting gets the waiting look too, drawn as typed.
      const blocks = splitBlocks(e.props.text) ?? (pending ? [{ kind: 'md', text: e.props.text } as Block] : null)
      if (!blocks) return next(e)
      return drawBlocks($.ui.resolve(e), blocks, false, pending)
    }
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    if (e.surface === 'terminal') {
      remember(e.requestId, e.props.text)
      const blocks = splitBlocks(e.props.text)
      return blocks ? drawBlocks($.ui.resolve(e), blocks, true) : next(e)
    }
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  // A prompt typed at the box while a turn runs waits in the queue until the
  // engine hands it to Claude: mid-turn as a queued_command attachment, or as
  // the next turn's prompt. Its row is drawn as waiting until then.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.turnId && e.origin.kind === 'composer' && 'text' in r && (await read($, isOn))) {
        const t = norm(r.text ?? '')
        if (t) await update($, waiting, w => (w.includes(t) ? w : [...w, t]))
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  // Claude reads a waiting prompt by one of three roads, and any one clears it:
  // the queue's record of it is raised twice under the door `queue` (put in
  // the queue, then taken out to be read); its text arrives in a row (the
  // queued_command attachment mid-turn, or the next turn's prompt); or a turn
  // starts or ends on the main loop, when the queue has been read in any case.
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.agentId) return r
      if (e.door === 'queue') {
        const t = norm(textsOf(e.message.content))
        if (!t) return r
        const n = (queued.get(t) ?? 0) + 1
        if (n < 2) {
          queued.set(t, n)
          return r
        }
        queued.delete(t)
        await markRead(t, $)
        return r
      }
      if (e.door !== 'attachment' && e.door !== 'prompt') return r
      await markRead(norm(textsOf(e.message)), $)
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await clearWaiting($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await clearWaiting($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  // Each keystroke's result, and every other change of the box (a submit clears it).
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (await read($, isOn)) await mirror($, r.text, r.cursor)
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.change', async ($, e, next) => {
    const r = await next(e)
    if (await read($, isOn)) await mirror($, e.text, e.cursor)
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const modes = await next(e)
    const value = await read($, isOn)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="row" gap={1}>
        {modes}
        {toggle(ui, $, value)}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const value = await read($, isOn)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    if (e.surface === 'desktop') {
      // On the desktop the button gets a tinted box, like the usage pills beside it.
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Box backgroundColor={value ? PILL_ON : PILL_OFF} paddingX="sm" paddingY="xs">
            {toggle(ui, $, value)}
          </Box>
          {below}
        </Box>
      )
    }
    const typed = value && e.surface === 'terminal' ? await read($, draft) : ''
    if (!HEB.test(typed)) return below
    const fold = await read($, folded)
    // The mark that folds the preview away and opens it again.
    const mark = (
      <Button key="fold" plain dimColor onPress={() => setFolded($, !fold)}>
        {String.fromCharCode(fold ? 0x25b8 : 0x25be)}
      </Button>
    )
    if (fold) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">{mark}</Box>
          {below}
        </Box>
      )
    }
    // Each line of the draft with where it starts, the last ones that fit.
    const all: { text: string; at: number }[] = []
    let at = 0
    for (const text of typed.split(String.fromCharCode(10))) {
      all.push({ text: mirrorRtl(text), at })
      at += text.length + 1
    }
    const lines = all.slice(-Math.max(1, e.props.maxRows))
    const pos = await read($, caret)
    const blinkOn = await read($, lit)
    // The draft as it will read, flush right, the mark at the left of its top row.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {mark}
          <Box flexDirection="column" flexGrow={1}>
            {lines.map((l, i) => {
              const k = pos - l.at
              if (k < 0 || k > l.text.length) return <Text key={`d${i}`} dir="rtl">{l.text === '' ? ' ' : l.text}</Text>
              // The caret: a thin bar in a cell of its own between the characters, a
              // space while it blinks off so the text never moves.
              return (
                <Text key={`d${i}`} dir="rtl">
                  {l.text.slice(0, k)}
                  <Text key={`d${i}c`} color="text">{blinkOn ? String.fromCharCode(0x2502) : ' '}</Text>
                  {l.text.slice(k)}
                </Text>
              )
            })}
          </Box>
        </Box>
        {below}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
