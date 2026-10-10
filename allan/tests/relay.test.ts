import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { alivePids, inboxItem, lastBlock, listing, parseSessionFile, resolve, type SessionEntry } from '../hooks/lib/relay'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const NOW = Date.parse('2026-10-10T12:00:00Z')
const at = (minsAgo: number) => NOW - minsAgo * 60_000
let pid = 100
const entry = (id: string, name: string | null, project: string, minsAgo = 5): SessionEntry =>
  ({ id, name, project, cwd: `/w/${project}`, lastSeen: at(minsAgo), status: 'idle', pid: pid++ })

const ALL = [
  entry('self0000', 'Code-3', 'M-Kopa'),
  entry('s1000000', 'Orchestrator', 'M-Kopa'),
  entry('s2000000', 'Orchestrator', 'Jackfruit'),
  entry('s3000000', 'Code-QC', 'Jackfruit'),
  entry('s4000000', 'Code-QC', 'Danco-Plastics', 60 * 70),
  entry('abcdef12', null, 'Numida'),
]

const BLOCK = '▼▼▼ START · message for Code-QC\nRun Phase 0.\n▲▲▲ END · message for Code-QC'

describe('relay', () => {
  test('a bare name prefers this project, then anywhere; never guesses', async () => {
    const here = resolve('orchestrator', ALL, 'self0000', 'M-Kopa')
    expect(here.ok && here.to.id).toBe('s1000000')
    const ambiguous = resolve('Code-QC', ALL, 'self0000', 'M-Kopa')
    expect(ambiguous.ok).toBe(false)
    expect(!ambiguous.ok && ambiguous.why).toContain('Jackfruit/Code-QC')
    const named = resolve('Jackfruit/Code-QC', ALL, 'self0000', 'M-Kopa')
    expect(named.ok && named.to.id).toBe('s3000000')
    const byId = resolve('Numida/abcdef', ALL, 'self0000', 'M-Kopa')
    expect(byId.ok && byId.to.id).toBe('abcdef12')
    expect(resolve('Lead', ALL, 'self0000', 'M-Kopa').ok).toBe(false)
    expect(resolve('Code-3', ALL, 'self0000', 'M-Kopa').ok).toBe(false)
  })

  test('/sessions lists this project first, idle ones with their age', async () => {
    const text = listing(ALL, 'self0000', 'M-Kopa', NOW)
    expect(text.indexOf('M-Kopa (this project)')).toBe(0)
    expect(text).toContain('← this session')
    expect(text).toContain('active 3d ago')
    expect(text).toContain('abcdef12')
  })

  test('reads Claude Code session files; dead pids are dropped', async () => {
    const file = JSON.stringify({ pid: 7, sessionId: 'x1', cwd: '/w/Lee', name: 'Code-Calendar-6', status: 'idle', updatedAt: 5 })
    expect(parseSessionFile(file)).toEqual({ id: 'x1', name: 'Code-Calendar-6', cwd: '/w/Lee', lastSeen: 5, status: 'idle', pid: 7 })
    expect(parseSessionFile('{"pid":1}')).toBeNull()
    expect(parseSessionFile('not json')).toBeNull()
    expect([...alivePids('  7\n 12\n')]).toEqual([7, 12])
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
  sent: Array<{ to: unknown; text: string }>
  copies: string[]
  refuse: string | null
  replies: string[]
  dead: number[]
}

const FILES = ALL.map(s => ({ name: `${s.pid}.json`, text: JSON.stringify({ pid: s.pid, sessionId: s.id, cwd: s.cwd, name: s.name ?? undefined, status: s.status, updatedAt: s.lastSeen }) }))

/** Code-3 in /w/M-Kopa, Claude Code's session list holding ALL. Every hook beneath the plugin is set here, before any $ call. */
function seeded(on: Parameters<TestBody>[1]): World {
  const world: World = { sent: [], copies: [], refuse: null, replies: [], dead: [] }
  mock.env(on, { HOME: '/home' })
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: '/w/M-Kopa' }))
  on('session.id', () => ({ value: 'self0000' }))
  on('fs.exists', ($, e) => ({ value: String(e.path) === '/home/.claude/sessions' || /^\/w\/[^/]+\/Claude_Memory\/INDEX\.md$/.test(String(e.path)) }))
  on('fs.list', () => ({ value: FILES.map(f => ({ name: f.name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }) as never)
  on('fs.read', ($, e) => ({ value: FILES.find(f => String(e.path).endsWith(`/${f.name}`))?.text ?? '# INDEX\n**NEXT UP: Code-3**' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: ALL.filter(s => !world.dead.includes(s.pid)).map(s => ` ${s.pid}`).join('\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
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
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  return world
}

describe('relay commands', () => {
  test('/sessions shows real names from Claude Code, without any prompt first', async ($, on) => {
    seeded(on)
    const { text } = await $.command.run(cmd('sessions', ''))
    expect(text).toContain('Code-3')
    expect(text).toContain('← this session')
    expect(text).toContain('Jackfruit')
  })

  test('a session whose process is gone is not listed', async ($, on) => {
    const world = seeded(on)
    world.dead = [ALL[2]?.pid ?? 0]
    const { text } = await $.command.run(cmd('sessions', ''))
    expect((text ?? '').match(/Orchestrator/g)?.length).toBe(1)
    expect(text).toContain('Jackfruit\n  Code-QC')
  })

  test('/relay <name> last sends the block by session id, with the sender', async ($, on) => {
    const world = seeded(on)
    world.replies = [`Here:\n${BLOCK}`]
    const { text } = await $.command.run(cmd('relay', 'Jackfruit/Code-QC last'))
    expect(text).toContain('Relayed to Jackfruit/Code-QC')
    expect(world.sent.length).toBe(1)
    expect(world.sent[0]?.to).toBe('s3000000')
    expect(world.sent[0]?.text.startsWith('[relay from Code-3 · M-Kopa]\n▼▼▼ START')).toBe(true)
  })

  test('not delivered: the text is copied and the reason given', async ($, on) => {
    const world = seeded(on)
    world.refuse = 'the recipient is not running'
    const { text } = await $.command.run(cmd('relay', 'Orchestrator please re-read INDEX'))
    expect(text).toContain('not running')
    expect(world.copies[0]).toBe('[relay from Code-3 · M-Kopa]\nplease re-read INDEX')
  })

  test('/relay to an ambiguous name refuses and lists the choices', async ($, on) => {
    const world = seeded(on)
    const { text } = await $.command.run(cmd('relay', 'Code-QC hello'))
    expect(text).toContain('Danco-Plastics/Code-QC')
    expect(world.sent.length).toBe(0)
  })

  test('an incoming relay lands in the band inbox', async ($, on) => {
    seeded(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code-3' } as never)
    await $.session.receive({ origin: { kind: 'peer-send-message' }, text: `[relay from Orchestrator · Jackfruit]\n${BLOCK}` } as never)
    const band = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } } as never)
    const shown = (await band.find({ type: 'Text', text: /✉/ } as never))?.text ?? ''
    expect(shown).toContain('1 from Orchestrator (Jackfruit)')
    await band.unmount()
  })

  test('relay off: no inbox, commands say so', { options: { relay: false } }, async ($, on) => {
    seeded(on)
    const r = await $.session.receive({ origin: { kind: 'peer-send-message' }, text: '[relay from X · Y]\nhi' } as never)
    expect(r.text).toContain('hi')
    const { text } = await $.command.run(cmd('relay', 'Orchestrator hi'))
    expect(text).toContain('relay is off')
  })
})
