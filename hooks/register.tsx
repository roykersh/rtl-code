import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { markText } from './bidi'
import { type Block, splitBlocks } from './blocks'

export { markText } from './bidi'

const isOn = atom({ plugin: 'rtl-mode', key: 'isOn' } as const, false)
// The prompt box's draft, mirrored right to left above the box while it holds Hebrew.
const draft = atom({ plugin: 'rtl-mode', key: 'draft' } as const, '')
// Where the caret stands in the draft, and whether the drawn caret is lit (it blinks).
const caret = atom({ plugin: 'rtl-mode', key: 'caret' } as const, 0)
const lit = atom({ plugin: 'rtl-mode', key: 'lit' } as const, true)
let blinker: { cancel: () => void } | undefined

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
function drawBlocks(ui: unknown, blocks: Block[], markdown: boolean) {
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
    return next(e)
  })

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
      const blocks = splitBlocks(e.props.text)
      return blocks ? drawBlocks($.ui.resolve(e), blocks, false) : next(e)
    }
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    if (e.surface === 'terminal') {
      const blocks = splitBlocks(e.props.text)
      return blocks ? drawBlocks($.ui.resolve(e), blocks, true) : next(e)
    }
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
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
        all.push({ text, at })
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
          // The caret: the cell it stands on drawn inverse while lit; past the end, a space.
          const under = Array.from(l.text.slice(k))[0] ?? ' '
          return (
            <Text key={`d${i}`} dir="rtl">
              {l.text.slice(0, k)}
              <Text key={`d${i}c`} inverse={blinkOn}>{under}</Text>
              {l.text.slice(k + under.length)}
            </Text>
          )
        })}
        {row}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
