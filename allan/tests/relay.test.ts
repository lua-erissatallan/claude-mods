import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { inboxItem, lastBlock, listing, resolve, type SessionEntry } from '../hooks/lib/relay'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const NOW = Date.parse('2026-10-10T12:00:00Z')
const at = (minsAgo: number) => NOW - minsAgo * 60_000
const entry = (id: string, name: string | null, project: string, minsAgo = 5): SessionEntry => ({ id, name, project, cwd: `/w/${project}`, lastSeen: at(minsAgo) })

const ALL = [
  entry('self', 'Code-3', 'M-Kopa'),
  entry('s1', 'Orchestrator', 'M-Kopa'),
  entry('s2', 'Orchestrator', 'Jackfruit'),
  entry('s3', 'Code-QC', 'Jackfruit'),
  entry('s4', 'Code-QC', 'Danco-Plastics'),
  entry('s5', 'Lead', 'Numida', 60 * 13),
]

const BLOCK = '▼▼▼ START · message for Code-QC\nRun Phase 0.\n▲▲▲ END · message for Code-QC'

describe('relay', () => {
  test('a bare name prefers this project, then anywhere; never guesses', async () => {
    const here = resolve('orchestrator', ALL, 'self', 'M-Kopa', NOW)
    expect(here.ok && here.to.id).toBe('s1')
    const ambiguous = resolve('Code-QC', ALL, 'self', 'M-Kopa', NOW)
    expect(ambiguous.ok).toBe(false)
    expect(!ambiguous.ok && ambiguous.why).toContain('Jackfruit/Code-QC')
    const named = resolve('Jackfruit/Code-QC', ALL, 'self', 'M-Kopa', NOW)
    expect(named.ok && named.to.id).toBe('s3')
    expect(resolve('Lead', ALL, 'self', 'M-Kopa', NOW).ok).toBe(false)
    expect(resolve('Code-3', ALL, 'self', 'M-Kopa', NOW).ok).toBe(false)
  })

  test('/sessions lists this project first and drops the stale', async () => {
    const text = listing(ALL, 'self', 'M-Kopa', NOW)
    expect(text.indexOf('M-Kopa (this project)')).toBe(0)
    expect(text).toContain('← this session')
    expect(text).toContain('Danco-Plastics')
    expect(text).not.toContain('Numida')
  })

  test('last picks the final block of the newest reply that has one', async () => {
    expect(lastBlock(['old\n▼▼▼ START · x\nA\n▲▲▲ END · x', `two\n${BLOCK}\nafter`, 'no block'])).toBe(BLOCK)
    expect(lastBlock(['nothing here'])).toBeNull()
    const item = inboxItem(`[relay from Orchestrator · Jackfruit]\n${BLOCK}`, NOW)
    expect(item.from).toBe('Orchestrator (Jackfruit)')
    expect(item.preview).toBe('Run Phase 0.')
  })
})

type World = {
  store: Map<string, unknown>
  sent: Array<{ to: unknown; text: string }>
  copies: string[]
  refuse: string | null
  replies: string[]
}

/** A Code-3 session in /w/M-Kopa, the registry seeded with ALL. Every hook beneath the plugin is set here, before any $ call. */
function seeded(on: Parameters<TestBody>[1]): World {
  const world: World = {
    store: new Map<string, unknown>(ALL.filter(s => s.id !== 'self').map(s => [`session:${s.id}`, s])),
    sent: [],
    copies: [],
    refuse: null,
    replies: [],
  }
  mock.env(on, {})
  mock.clock(on, { now: NOW })
  on('store.get', ($, e) => ({ value: world.store.get(e.key) }))
  on('store.set', ($, e) => { world.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($, e) => { world.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  on('session.cwd', () => ({ value: '/w/M-Kopa' }))
  on('session.id', () => ({ value: 'self' }))
  on('fs.exists', ($, e) => ({ value: String(e.path) === '/w/M-Kopa/Claude_Memory/INDEX.md' }))
  on('fs.read', () => ({ value: '# INDEX\n**NEXT UP: Code-3**' }))
  on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
  on('session.messages', () => ({ value: world.replies.map(text => ({ role: 'assistant', text, toolUses: [] })) }) as never)
  on('session.send', ($, e) => {
    if (world.refuse !== null) return { isDelivered: false, reason: world.refuse } as never
    world.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  on('ui.copy', ($, e) => { world.copies.push(String(e.text)); return { value: { isCopied: true } } as never })
  on('session.receive', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return world
}

const named = ($: Parameters<TestBody>[0]) => $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code-3' } as never)

describe('relay commands', () => {
  test('a prompt puts this session in the registry', async ($, on) => {
    const world = seeded(on)
    await named($)
    const self = world.store.get('session:self') as SessionEntry
    expect(self.name).toBe('Code-3')
    expect(self.project).toBe('M-Kopa')
  })

  test('/relay <name> last sends the block by session id, with the sender', async ($, on) => {
    const world = seeded(on)
    world.replies = [`Here:\n${BLOCK}`]
    await named($)
    const { text } = await $.command.run(cmd('relay', 'Jackfruit/Code-QC last'))
    expect(text).toContain('Relayed to Jackfruit/Code-QC')
    expect(world.sent.length).toBe(1)
    expect(world.sent[0]?.to).toBe('s3')
    expect(world.sent[0]?.text.startsWith('[relay from Code-3 · M-Kopa]\n▼▼▼ START')).toBe(true)
  })

  test('not delivered: the text is copied and the reason given', async ($, on) => {
    const world = seeded(on)
    world.refuse = 'the recipient is not running'
    await named($)
    const { text } = await $.command.run(cmd('relay', 'Orchestrator please re-read INDEX'))
    expect(text).toContain('not running')
    expect(world.copies[0]).toBe('[relay from Code-3 · M-Kopa]\nplease re-read INDEX')
  })

  test('/relay to an ambiguous name refuses and lists the choices', async ($, on) => {
    const world = seeded(on)
    await named($)
    const { text } = await $.command.run(cmd('relay', 'Code-QC hello'))
    expect(text).toContain('Danco-Plastics/Code-QC')
    expect(world.sent.length).toBe(0)
  })

  test('an incoming relay lands in the band inbox', async ($, on) => {
    seeded(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    await named($)
    await $.session.receive({ origin: { kind: 'peer-send-message' }, text: `[relay from Orchestrator · Jackfruit]\n${BLOCK}` } as never)
    const band = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } } as never)
    const shown = (await band.find({ type: 'Text', text: /✉/ } as never))?.text ?? ''
    expect(shown).toContain('1 from Orchestrator (Jackfruit)')
    await band.unmount()
  })

  test('relay off: no registry, no inbox, commands say so', { options: { relay: false } }, async ($, on) => {
    const world = seeded(on)
    await named($)
    expect(world.store.has('session:self')).toBe(false)
    const r = await $.session.receive({ origin: { kind: 'peer-send-message' }, text: '[relay from X · Y]\nhi' } as never)
    expect(r.text).toContain('hi')
    const { text } = await $.command.run(cmd('relay', 'Orchestrator hi'))
    expect(text).toContain('relay is off')
  })

  test('/sessions works before any prompt: the caller registers itself', async ($, on) => {
    const world = seeded(on)
    const { text } = await $.command.run(cmd('sessions', ''))
    expect(text).toContain('← this session')
    expect(world.store.has('session:self')).toBe(true)
  })

  test('a reload registers the session without waiting for a prompt', async ($, on) => {
    const world = seeded(on)
    on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    expect(world.store.has('session:self')).toBe(true)
  })
})
