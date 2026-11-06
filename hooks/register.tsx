import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { markText } from './bidi'
import { type Block, inlineRuns, mirrorRtl, splitBlocks } from './blocks'
import { fixCopy } from './copyfix'

export { markText } from './bidi'

const isOn = atom({ plugin: 'rtl-mode', key: 'isOn' } as const, false)
// The prompt box's draft, mirrored right to left above the box while it holds Hebrew.
const draft = atom({ plugin: 'rtl-mode', key: 'draft' } as const, '')
// Where the caret stands in the draft, and whether the drawn caret is lit (it blinks).
const caret = atom({ plugin: 'rtl-mode', key: 'caret' } as const, 0)
const lit = atom({ plugin: 'rtl-mode', key: 'lit' } as const, true)
let blinker: { cancel: () => void } | undefined
// Prompts typed while a turn ran that Claude has not read yet, as normalized text.
const waiting = atom({ plugin: 'rtl-mode', key: 'waiting' } as const, [] as string[])
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

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
      sections: [...composed.sections, { id: 'rtl-mode:guide', text: GUIDE, scope: 'session' as const }],
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
        const t = norm(r.text)
        if (t) await update($, waiting, w => (w.includes(t) ? w : [...w, t]))
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.agentId || (e.door !== 'attachment' && e.door !== 'prompt')) return r
      const w = await read($, waiting)
      if (w.length === 0) return r
      const said = norm(
        (e.message.content ?? [])
          .map(c => (c.type === 'text' ? c.text : ''))
          .join(' '),
      )
      if (said) {
        const left = w.filter(t => !said.includes(t))
        if (left.length !== w.length) await update($, waiting, () => left)
      }
    } catch {}
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const value = await read($, isOn)
    const typed = value && e.surface === 'terminal' ? await read($, draft) : ''
    const { Box, Button, Text } = $.ui.resolve(e)
    const button = (
      <Button key="rtl" plain onPress={() => setMode($, !value, true)}>
        <Text dimColor size="footnote" mono>RTL </Text>
        <Text color={value ? GREEN : 'subtle'} weight="bold" size="footnote" mono>
          {value ? 'ON' : 'OFF'}
        </Text>
      </Button>
    )
    // Each line of the draft with where it starts, the last ones that fit.
    const all: { text: string; at: number }[] = []
    if (HEB.test(typed)) {
      let at = 0
      for (const text of typed.split(String.fromCharCode(10))) {
        all.push({ text: mirrorRtl(text), at })
        at += text.length + 1
      }
    }
    const lines = all.slice(-Math.max(1, e.props.maxRows - 1))
    const pos = lines.length ? await read($, caret) : 0
    const blinkOn = lines.length ? await read($, lit) : false
    const row = (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {e.surface === 'desktop' ? (
          // On the desktop the button gets a tinted box, like the usage pills beside it.
          <Box backgroundColor={value ? PILL_ON : PILL_OFF} paddingX="sm" paddingY="xs">
            {button}
          </Box>
        ) : (
          button
        )}
        {below}
      </Box>
    )
    if (lines.length === 0) return row
    // The draft as it will read, flush right, above the toggle row.
    return (
      <Box flexDirection="column">
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
        {row}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
