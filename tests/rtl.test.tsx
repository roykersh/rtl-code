import { expect, mock, test } from 'claude-code/testing'

import { LRE, LRM, PDF, RLE, RLM, directionOf, markLine, markText } from '../hooks/bidi'

// ---- the line rewrite ----

test('a Hebrew line reads RTL and an English code span in it is embedded LTR', () => {
  expect(markLine('הרץ את `npm install` עכשיו')).toBe(RLM + RLE + 'הרץ את ' + LRE + '`npm install`' + PDF + ' עכשיו')
})

test('an English line with a Hebrew quote holding an English word', () => {
  expect(markLine('The button says "לחץ על Save כאן" now')).toBe(
    LRM + LRE + 'The button says "' + RLE + 'לחץ על Save כאן' + PDF + '" now',
  )
})

test('an English quote in an English line is left alone', () => {
  expect(markLine('He said "go home" and שלום')).toBe(LRM + LRE + 'He said "go home" and ' + RLE + 'שלום' + PDF)
})

test('a bare Hebrew run in an English line is embedded with its closing punctuation', () => {
  expect(markLine('Use the word שלום עולם, then continue.')).toBe(
    LRM + LRE + 'Use the word ' + RLE + 'שלום עולם,' + PDF + ' then continue.',
  )
})

test('quotes, code spans and links do not count toward the direction', () => {
  // 26 Latin letters inside the quote, 10 Hebrew outside it: still a Hebrew line
  expect(directionOf('אמרתי "hello world to everyone here" אתמול')).toBe('rtl')
  expect(directionOf('ראה [the documentation page here](https://x.y) בבקשה')).toBe('rtl')
  expect(directionOf('קרא `a very long english code span` עכשיו')).toBe('rtl')
  expect(directionOf('Run "שלום עולם לכולם" now')).toBe('ltr')
})

test('the marks go after markdown markers, with nothing closed at the end', () => {
  expect(markLine('## כותרת עם API')).toBe('## ' + RLM + RLE + 'כותרת עם API')
  expect(markLine('1. שלום לכולם')).toBe('1. ' + RLM + RLE + 'שלום לכולם')
  expect(markLine('> - שלום')).toBe('> - ' + RLM + RLE + 'שלום')
  expect(markLine('- [ ] משימה')).toBe('- [ ] ' + RLM + RLE + 'משימה')
  expect(markLine('## כותרת').endsWith(PDF)).toBe(false)
})

test('gershayim inside a Hebrew word is not a quote', () => {
  expect(markLine('צה"ל is great')).toBe(LRM + LRE + RLE + 'צה"ל' + PDF + ' is great')
})

test('lines without Hebrew, and code blocks, are untouched', () => {
  expect(markLine('just English here')).toBe('just English here')
  expect(markText('```\nשלום\n```\nשלום')).toBe('```\nשלום\n```\n' + RLM + RLE + 'שלום')
  expect(markText('~~~ts\nconst a = "שלום"\n~~~')).toBe('~~~ts\nconst a = "שלום"\n~~~')
})

test('a table is marked cell by cell', () => {
  expect(markText('| שם | name |\n|---|---|\n| `ls` הרץ | run it |')).toBe(
    '| ' + RLM + RLE + 'שם | name |\n|---|---|\n| ' + RLM + RLE + LRE + '`ls`' + PDF + ' הרץ | run it |',
  )
})

// ---- the mod in a session ----

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['desktop'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const rtl = (args: string) => ({
  command: 'rtl',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const BAND = {
  plugin: 'rtl-code',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const MODES = {
  plugin: 'rtl-code',
  component: 'SessionMode',
  requestId: 'modes',
  props: { modes: [] as string[] },
} as const

const engineDraws = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

test('the button shows OFF, then ON after a press, and the choice is stored', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'rtl' } }))
  engineDraws(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // The terminal draws it under the input box, beside the session's mode labels;
  // the desktop keeps its pill in the band above the prompt.
  for (const [surface, site] of [['terminal', MODES], ['desktop', BAND]] as const) {
    const ui = await $.ui.mount({ ...(site as any), surface })
    expect((await ui.find({ type: 'Text', text: /^(ON|OFF)$/ }))?.text).toBe('OFF')
    await ui.press({ key: 'rtl' })
    expect((await ui.find({ type: 'Text', text: /^(ON|OFF)$/ }))?.text).toBe('ON')
    await ui.press({ key: 'rtl' })
    await ui.unmount()
  }
})

test('a stored ON is read back when the next session starts', async ($, on) => {
  mock.store(on, { isOn: true })
  on('command.register', () => ({ value: { command: 'rtl' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  engineDraws(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^(ON|OFF)$/ }))?.text).toBe('ON')
  await ui.unmount()
  const modes = await $.ui.mount({ ...MODES, surface: 'terminal' })
  expect((await modes.find({ type: 'Text', text: /^(ON|OFF)$/ }))?.text).toBe('ON')
  await modes.unmount()
})

test('on the terminal the band above the prompt holds no toggle', async ($, on) => {
  mock.store(on, { isOn: true })
  on('command.register', () => ({ value: { command: 'rtl' } }))
  engineDraws(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^(ON|OFF)$/ })).toBe(undefined)
  await band.unmount()
  // The desktop's footer is left as the engine draws it.
  const modes = await $.ui.mount({ ...MODES, surface: 'desktop' })
  expect(await modes.find({ type: 'Text', text: /^(ON|OFF)$/ })).toBe(undefined)
  await modes.unmount()
})

const typeDraft = ($: any, text: string) => $.prompt.change({ text, cursor: 0, origin: { kind: 'history' } })

test('the Hebrew draft preview folds to its mark and opens again, and the choice is stored', async ($, on) => {
  mock.store(on, { isOn: true })
  on('command.register', () => ({ value: { command: 'rtl' } }))
  engineDraws(on)
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await typeDraft($, 'שלום עולם')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /שלום/ }))?.props?.dir).toBe('rtl')
  expect((await ui.find({ type: 'Button', key: 'fold' }))?.text).toBe('▾')
  await ui.press({ key: 'fold' })
  expect(await ui.find({ type: 'Text', text: /שלום/ })).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'fold' }))?.text).toBe('▸')
  await ui.unmount()

  // A new session reads the fold back from the store.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await again.find({ type: 'Button', key: 'fold' }))?.text).toBe('▸')
  await again.press({ key: 'fold' })
  expect((await again.find({ type: 'Text', text: /שלום/ }))?.props?.dir).toBe('rtl')
  await again.unmount()
})

test('a stored fold is read back, and without Hebrew in the draft no mark shows', async ($, on) => {
  mock.store(on, { isOn: true, folded: true })
  on('command.register', () => ({ value: { command: 'rtl' } }))
  engineDraws(on)
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await typeDraft($, 'only English')
  const plain = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await plain.find({ type: 'Button', key: 'fold' })).toBe(undefined)
  await plain.unmount()
  await typeDraft($, 'שלום')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'fold' }))?.text).toBe('▸')
  expect(await ui.find({ type: 'Text', text: /שלום/ })).toBe(undefined)
  await ui.unmount()
})

test('/rtl on rewrites messages and adds the writing guide; /rtl off undoes both', async ($, on) => {
  mock.store(on)
  mock.session(on)
  on('command.register', () => ({ value: { command: 'rtl' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const MSG = {
    plugin: 'rtl-code',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'desktop',
    props: { text: 'שלום לכולם `x` world', isFirstOfReply: true },
  } as const

  expect((await $.command.run(rtl('on'))).text).toBe('RTL mode ON')
  const ui = await $.ui.mount(MSG)
  expect((await ui.find({ type: 'Text' }))?.text).toBe(RLM + RLE + 'שלום לכולם ' + LRE + '`x`' + PDF + ' world')
  await ui.unmount()
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'rtl-code:guide'])

  expect((await $.command.run(rtl('off'))).text).toBe('RTL mode OFF')
  const plain = await $.ui.mount(MSG)
  expect((await plain.find({ type: 'Text' }))?.text).toBe('שלום לכולם `x` world')
  await plain.unmount()
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['intro'])

  expect((await $.command.run(rtl('sideways'))).text).toContain('Usage')
})

// ---- the terminal drawing ----

import { inlineRuns, splitBlocks } from '../hooks/blocks'

test('terminal blocks: Hebrew lines go RTL, English lines and fences stay markdown', () => {
  const b = splitBlocks('## כותרת\n\nשורה עם `npm i` ו **מודגש**\n- פריט\n1. ראשון\n\nEnglish line here\nmore English\n\n```\nשלום\n```')!
  expect(b.map(x => x.kind)).toEqual(['rtl', 'blank', 'rtl', 'rtl', 'rtl', 'blank', 'md'])
  const [h, , line, item, num, , md] = b as any[]
  expect(h.heading).toBe(true)
  expect(line.runs).toEqual([{ text: 'שורה עם ' }, { text: 'npm i', code: true }, { text: ' ו ' }, { text: 'מודגש', bold: true }])
  expect(item.marker).toBe('• ')
  expect(num.marker).toBe('1. ')
  expect(md.text).toBe('English line here\nmore English\n\n```\nשלום\n```')
})

test('terminal blocks: nothing to do without a right-to-left line', () => {
  expect(splitBlocks('only English')).toBe(null)
  expect(splitBlocks('English with one מילה inside')).toBe(null)
})

test('inline runs: links show their text, escapes drop the backslash', () => {
  expect(inlineRuns(String.raw`ראה [המדריך](https://x.y) \*כאן\*`)).toEqual([{ text: 'ראה המדריך *כאן*' }])
})

test('on the terminal a Hebrew reply is drawn as dir="rtl" Text, with no control marks', async ($, on) => {
  mock.store(on, { isOn: true })
  on('command.register', () => ({ value: { command: 'rtl' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'rtl-code',
    component: 'AssistantMessage',
    requestId: 't1',
    surface: 'terminal',
    props: { text: 'שלום לכולם `x` world', isFirstOfReply: true },
  } as const)
  const row = await ui.find({ type: 'Text', text: /שלום/ })
  expect(row?.text).toBe('שלום לכולם x world')
  expect(row?.props?.dir).toBe('rtl')
  expect(/[\u200e\u200f\u202a-\u202e]/.test(row?.text ?? '')).toBe(false)
  await ui.unmount()
})

import { mirrorRtl } from '../hooks/blocks'

test('brackets that resolve right to left are mirrored, Latin-only ones are not', () => {
  expect(mirrorRtl('גרסה (0.8.0): חדשה')).toBe('גרסה )0.8.0(: חדשה')
  expect(mirrorRtl('שים לב [Image #1] הפוכים')).toBe('שים לב ]Image #1[ הפוכים')
  expect(mirrorRtl('הרץ foo(bar) עכשיו')).toBe('הרץ foo(bar) עכשיו')
  expect(mirrorRtl('שלום (עולם)')).toBe('שלום )עולם(')
  expect(mirrorRtl('אין סוגריים')).toBe('אין סוגריים')
})

// ---- copying off the terminal ----
import { fixCopy, isVisualRtl, toLogical } from '../hooks/copyfix'

test('a copied right-to-left line comes back in reading order', () => {
  expect(toLogical('םלוע םולש')).toBe('שלום עולם')
  expect(toLogical('וישכע npm install יתצרה')).toBe('הרצתי npm install עכשיו')
  expect(toLogical('םיצבק 3 שי')).toBe('יש 3 קבצים')
  expect(toLogical('(םולש)')).toBe('(שלום)')
  expect(toLogical('םולש ❮ ')).toBe('שלום')
})

test('only lines drawn right to left are turned around', () => {
  expect(isVisualRtl('םלוע םולש')).toBe(true)
  expect(isVisualRtl('Run the שלום step')).toBe(false)
  expect(isVisualRtl('only English')).toBe(false)
  expect(fixCopy('English line\nםלוע םולש')).toBe('English line\nשלום עולם')
  expect(fixCopy('nothing to do')).toBe('nothing to do')
})

test('a wrapped paragraph, its rows joined, is matched to the line it came from', () => {
  const known = ['אחת שתיים שלוש ארבע']
  expect(fixCopy('םייתש תחא עברא שולש', known)).toBe('אחת שתיים שלוש ארבע')
})

// ---- a prompt typed mid-turn waits until Claude reads it ----

const USER = (text: string) =>
  ({
    plugin: 'rtl-code',
    component: 'UserMessage',
    requestId: 'u-' + text.length,
    surface: 'terminal',
    props: { text },
  }) as const

async function typedMidTurn($: any, on: any, text: string) {
  mock.store(on, { isOn: true })
  mock.session(on)
  on('command.register', () => ({ value: { command: 'rtl' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  engineDraws(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text, turnId: 't1', wait: false, origin: { kind: 'composer' } })
}
const isWaiting = async ($: any, text: string) => {
  const ui = await $.ui.mount(USER(text))
  const label = await ui.find({ type: 'Text', text: /ממתין לקריאה/ })
  await ui.unmount()
  return label !== undefined
}
const queueRecord = (text: string, uuid: string) => ({
  message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text }] },
  door: 'queue' as const,
  origin: { kind: 'composer' as const },
  uuid,
})

test('a prompt typed mid-turn waits, and is read once the queue takes it out', async ($, on) => {
  const text = 'שאלה נוספת על הקוד'
  await typedMidTurn($, on, text)
  expect(await isWaiting($, text)).toBe(true)
  // Put in the queue: still waiting.
  await $.session.append(queueRecord(text, 'q1') as any)
  expect(await isWaiting($, text)).toBe(true)
  // Taken out to be read mid-turn: read.
  await $.session.append(queueRecord(text, 'q2') as any)
  expect(await isWaiting($, text)).toBe(false)
})

test('a waiting prompt is read when its text arrives in an attachment row', async ($, on) => {
  const text = 'שאלה נוספת\nבשתי שורות'
  await typedMidTurn($, on, text)
  await $.session.append({
    message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text: 'The user sent:\n' + text }] },
    door: 'attachment',
    origin: { kind: 'composer' },
    uuid: 'a1',
  } as any)
  expect(await isWaiting($, text)).toBe(false)
})

test('a waiting prompt is read when the next turn starts', async ($, on) => {
  const text = 'עוד הודעה'
  await typedMidTurn($, on, text)
  expect(await isWaiting($, text)).toBe(true)
  await $.turn.start({ text, turnId: 't2' })
  expect(await isWaiting($, text)).toBe(false)
})
