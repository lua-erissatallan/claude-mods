import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { addDraft, ageDays, draftsIn, markSent, parseDrafts, slackify } from '../hooks/lib/outbox'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const NOW = Date.parse('2026-10-12T12:00:00Z')
const CONTACTS = ['Drew', 'Kiri']

const REPLY = [
  'Two things. First the question for Drew:',
  '',
  '> Hi Drew,',
  '> Would you like the assistant to keep proposing an owner block?',
  '> Thanks, Allan',
  '',
  'And the session message:',
  '▼▼▼ START · message for Code-Calendar-6',
  'Run Phase 0.',
  '▲▲▲ END · message for Code-Calendar-6',
  '',
  '▼▼▼ START · message for Kiri',
  'The staff list is updated.',
  '▲▲▲ END · message for Kiri',
].join('\n')

describe('outbox', () => {
  test('finds a quoted draft introduced for a contact and a START/END block naming one; not a session block', async () => {
    const found = draftsIn(REPLY, CONTACTS)
    expect(found.map(d => d.to)).toEqual(['Kiri', 'Drew'])
    expect(found[1]?.body.startsWith('Hi Drew,')).toBe(true)
    expect(draftsIn(REPLY, [])).toEqual([])
  })

  test('MESSAGES.md: add newest first, parse, mark sent, no duplicates', async () => {
    const first = addDraft(null, 'Drew', 'Hi Drew,\nline two', '2026-10-11', 'Code-Calendar-6')
    expect(first?.id).toBe(1)
    const second = addDraft(first?.text ?? '', 'Kiri', 'Hello Kiri', '2026-10-12', 'Code-Calendar-6')
    expect(second?.id).toBe(2)
    const drafts = parseDrafts(second?.text ?? '')
    expect(drafts.map(d => d.id)).toEqual([2, 1])
    expect(drafts[1]?.body).toBe('Hi Drew,\nline two')
    expect(drafts[1]?.by).toBe('Code-Calendar-6')
    expect(addDraft(second?.text ?? '', 'Drew', 'Hi Drew,\nline two', '2026-10-12', 'x')).toBeNull()
    const sent = markSent(second?.text ?? '', 1, '2026-10-12')
    expect(parseDrafts(sent ?? '').find(d => d.id === 1)?.status).toBe('SENT')
    expect(markSent(sent ?? '', 9, '2026-10-12')).toBeNull()
    expect(ageDays('2026-10-11', NOW)).toBe(1)
  })

  test('reads an existing file in the Lee format', async () => {
    const lee = '# MESSAGES\n\nrules\n\n---\n\n## M21 · DRAFT 2026-10-12 · to Drew · Owner says no\n**Why:** x\n\n> Hi Drew,\n>\n> A quick question.\n\n## M20 · SENT 2026-10-10 · to Kiri · Staff list\n> done\n'
    const drafts = parseDrafts(lee)
    expect(drafts.map(d => `${d.id}:${d.status}`)).toEqual(['21:DRAFT', '20:SENT'])
    expect(drafts[0]?.body).toBe('Hi Drew,\n\nA quick question.')
    const added = addDraft(lee, 'Drew', 'New one\nline', '2026-10-12', 'Code')
    expect(added?.id).toBe(22)
    expect(parseDrafts(added?.text ?? '').map(d => d.id)).toEqual([22, 21, 20])
  })

  test('slackify flattens tables and bold', async () => {
    const out = slackify('Totals:\n| House | Weeks |\n|---|---|\n| 64 Cliff | 3 |\n| 8 Heath Lane | 12 |\n**done**')
    expect(out).toBe('Totals:\nHouse          Weeks\n64 Cliff       3\n8 Heath Lane   12\n*done*')
  })
})

type World = { files: Record<string, string>; writes: Array<[string, string]>; toasts: string[]; copies: string[] }

/** A Code-Calendar-6 session in /w/lee with Drew and Kiri as contacts; every hook set before any $ call. */
function world(on: Parameters<TestBody>[1], messages: string | null = null): World {
  const w: World = { files: { '/w/lee/Claude_Memory/INDEX.md': '# INDEX', '/w/lee/.claude-mods.json': '{"contacts":["Drew","Kiri"]}' }, writes: [], toasts: [], copies: [] }
  if (messages !== null) w.files['/w/lee/Claude_Memory/MESSAGES.md'] = messages
  mock.env(on, {})
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: '/w/lee' }))
  on('fs.exists', ($, e) => ({ value: String(e.path) in w.files }))
  on('fs.read', ($, e) => ({ value: w.files[String(e.path)] ?? '' }))
  on('fs.write', ($, e) => { w.files[String(e.path)] = String(e.text); w.writes.push([String(e.path), String(e.text)]); return { value: undefined } })
  on('ui.toast', ($, e) => { w.toasts.push(String(e.text)); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', ($, e) => { w.copies.push(String(e.text)); return { value: { isCopied: true } } as never })
  on('turn.complete', () => ({ text: '' }) as never)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
  return w
}

const TURN = (answer: string) => ({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId: 't1' }) as never

describe('outbox commands', () => {
  test('a finished turn keeps the drafts in MESSAGES.md, with a toast', async ($, on) => {
    const w = world(on)
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code-Calendar-6' } as never)
    await $.turn.complete(TURN(REPLY))
    expect(w.writes.length).toBe(1)
    const text = w.files['/w/lee/Claude_Memory/MESSAGES.md'] ?? ''
    expect(parseDrafts(text).map(d => `${d.id}:${d.to}`)).toEqual(['2:Drew', '1:Kiri'])
    expect(text).toContain('**By:** Code-Calendar-6')
    expect(w.toasts[0]).toContain('M1, M2')
    await $.turn.complete(TURN(REPLY))
    expect(w.writes.length).toBe(1)
  })

  test('/outbox opens the pane; Copy for Slack copies with the reminder; Mark sent updates the file', async ($, on) => {
    const w = world(on, addDraft(null, 'Drew', 'Hi Drew,\n| a | b |\n|---|---|\n| 1 | 2 |', '2026-10-11', 'Code')?.text ?? '')
    const { text } = await $.command.run(cmd('outbox', ''))
    expect(text).toContain('M1 · 2026-10-11 · to Drew')
    const pane = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'Pane', requestId: 'allan-outbox', props: { title: 'Outbox', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } } as never)
    await pane.press({ key: 'slack1' } as never)
    expect(w.copies[0]).toBe('Hi Drew,\na   b\n1   2')
    expect(w.toasts.some(t => t.includes('Re-read the live systems'))).toBe(true)
    await pane.press({ key: 'sent1' } as never)
    expect(parseDrafts(w.files['/w/lee/Claude_Memory/MESSAGES.md'] ?? '')[0]?.status).toBe('SENT')
    await pane.unmount()
  })

  test('a draft older than a day is mentioned at session start', async ($, on) => {
    const w = world(on, addDraft(null, 'Drew', 'old one', '2026-10-09', 'Code')?.text ?? '')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/lee' })
    expect(w.toasts.some(t => t.includes('older than a day'))).toBe(true)
  })

  test('outbox off: nothing kept, no toast, /outbox says so', { options: { outbox: false } }, async ($, on) => {
    const w = world(on, addDraft(null, 'Drew', 'old one', '2026-10-09', 'Code')?.text ?? '')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/lee' })
    await $.turn.complete(TURN(REPLY))
    expect(w.writes.length).toBe(0)
    expect(w.toasts.length).toBe(0)
    const { text } = await $.command.run(cmd('outbox', ''))
    expect(text).toContain('outbox is off')
  })
})
