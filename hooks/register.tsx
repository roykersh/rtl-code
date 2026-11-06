import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { markText } from './bidi'

export { markText } from './bidi'

const isOn = atom({ plugin: 'rtl-mode', key: 'isOn' } as const, false)

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
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const text = markText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const value = await read($, isOn)
    const { Box, Button, Text } = $.ui.resolve(e)
    const button = (
      <Button key="rtl" plain onPress={() => setMode($, !value, true)}>
        <Text dimColor size="footnote" mono>RTL </Text>
        <Text color={value ? GREEN : 'subtle'} weight="bold" size="footnote" mono>
          {value ? 'ON' : 'OFF'}
        </Text>
      </Button>
    )
    return (
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
  }).catch(($, e, next) => next(e))
}
