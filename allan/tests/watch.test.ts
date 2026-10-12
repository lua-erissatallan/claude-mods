import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { count, describe as describeLight, keepWeek, levelOf, median, parseLogs, takeLease } from '../hooks/lib/watch'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const NOW = Date.parse('2026-10-12T12:00:00Z')
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const line = (id: string, message: string, source = 'job', subType = 'debug') =>
  ({ id, timestamp: '2026-10-12T11:5' + id.slice(-1) + ':00.000Z', type: 'log', subType, message, metadata: { logSource: source } })

const page = (lines: unknown[]) => JSON.stringify({ logs: lines, pagination: { hasNextPage: false } }) + '\n\n  Update available: 3.47.0'

describe('watch', () => {
  test('parses a logs page and counts errors, blocks and bypasses', async () => {
    const parsed = parseLogs(page([
      line('a1', 'Job result ok'),
      line('a2', 'TypeError: x is undefined', 'agent_error', 'error'),
      line('a3', 'Preprocessor result {"action":"block","reason":"greeting"}', 'preprocessor'),
      line('a4', 'GATE BYPASSED: notify reps skipped', 'skill'),
    ]))
    expect(parsed?.length).toBe(4)
    expect(count(parsed ?? [])).toEqual({ errors: 1, blocks: 1, bypass: 1 })
    expect(parseLogs('not json')).toBeNull()
  })

  test('levels: usual is the median; red on bypass, a failed check or many errors', async () => {
    expect(median([0, 0, 1, 3, 2])).toBe(1)
    expect(levelOf({ errors: 0, blocks: 0, bypass: 0 }, 0, [])).toBe('green')
    expect(levelOf({ errors: 1, blocks: 0, bypass: 0 }, 0, [])).toBe('amber')
    expect(levelOf({ errors: 1, blocks: 0, bypass: 0 }, 2, [])).toBe('green')
    expect(levelOf({ errors: 0, blocks: 2, bypass: 0 }, 0, [])).toBe('amber')
    expect(levelOf({ errors: 0, blocks: 0, bypass: 1 }, 0, [])).toBe('red')
    expect(levelOf({ errors: 0, blocks: 0, bypass: 0 }, 0, ['neon'])).toBe('red')
    expect(levelOf({ errors: 9, blocks: 0, bypass: 0 }, 2, [])).toBe('red')
    expect(describeLight({ errors: 2, blocks: 0, bypass: 0 }, 'amber', ['canary'])).toBe('2 errors, checks failing: canary')
  })

  test('one session holds the lease per project; stale leases are taken over', async () => {
    const mine = takeLease(undefined, 'me', NOW, 600_000)
    expect(mine?.sessionId).toBe('me')
    expect(takeLease(mine, 'other', NOW + 1000, 600_000)).toBeNull()
    expect(takeLease(mine, 'other', NOW + 2_000_000, 600_000)?.sessionId).toBe('other')
    expect(takeLease(mine, 'me', NOW + 1000, 600_000)?.sessionId).toBe('me')
    expect(keepWeek([{ at: NOW - 8 * 86_400_000, errors: 1, blocks: 0, bypass: 0 }, { at: NOW, errors: 0, blocks: 0, bypass: 0 }], NOW).length).toBe(1)
  })
})

type World = { store: Map<string, unknown>; ran: string[][]; toasts: string[]; logs: unknown[]; checkFails: boolean }

/** A session in /w/danco with an agent in Customer_Qualification_Agent and one check; every hook set before any $ call. */
function world(on: Parameters<TestBody>[1]) {
  const w: World = { store: new Map(), ran: [], toasts: [], logs: [], checkFails: false }
  mock.env(on, {})
  const clock = mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: '/w/danco' }))
  on('session.id', () => ({ value: 'me' }))
  on('fs.exists', ($, e) => {
    const p = String(e.path)
    return { value: p === '/w/danco/Claude_Memory/INDEX.md' || p === '/w/danco/.claude-mods.json' || p === '/w/danco/Customer_Qualification_Agent/lua.skill.yaml' }
  })
  on('fs.read', ($, e) => ({ value: String(e.path).endsWith('.claude-mods.json') ? '{"agent":"Customer_Qualification_Agent","checks":{"canary":"node scripts/canary.mjs"}}' : '# INDEX' }))
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    if (argv[0] === 'lua') return { value: { ...OK, stdout: page(w.logs) } }
    return { value: { ...OK, exitCode: w.checkFails ? 1 : 0, stdout: '' } }
  })
  on('ui.toast', ($, e) => { w.toasts.push(String(e.text)); return { value: undefined } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
  return { w, clock }
}

describe('watch ticks', () => {
  test('after the first look the band shows the light and /logs reports; a dead quiet page is green', async ($, on) => {
    const { w, clock } = world(on)
    w.logs = [line('a1', 'Job result ok')]
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/danco' })
    await clock.advance(16_000)
    expect(w.ran.some(a => a[0] === 'lua' && a[1] === 'logs')).toBe(true)
    expect(w.ran.some(a => a[0] === 'sh')).toBe(true)
    expect((w.store.get('watch:/w/danco') as { sessionId: string }).sessionId).toBe('me')
    const { text } = await $.command.run(cmd('logs', ''))
    expect(text).toContain('🟢')
    expect(text).toContain('quiet')
  })

  test('errors turn the light amber with one toast; a failing check turns it red', async ($, on) => {
    const { w, clock } = world(on)
    w.logs = [line('a2', 'TypeError: boom', 'agent_error', 'error')]
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/danco' })
    await clock.advance(16_000)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('🟡')
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code-3' } as never)
    const band = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } } as never)
    expect(await band.find({ type: 'Text', text: /●/ } as never)).toBeTruthy()
    await band.unmount()
    // The same line again is not counted twice; the check failing makes it red.
    w.checkFails = true
    await clock.advance(10 * 60_000)
    expect(w.toasts.length).toBe(2)
    expect(w.toasts[1]).toContain('🔴')
    const { text } = await $.command.run(cmd('logs', ''))
    expect(text).toContain('checks failing: canary')
    expect(text).toContain('1 errors')
  })

  test('another session holding the lease means this one stays quiet', async ($, on) => {
    const { w, clock } = world(on)
    w.store.set('watch:/w/danco', { sessionId: 'other', expiresAt: NOW + 3_600_000 })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/danco' })
    await clock.advance(16_000)
    expect(w.ran.some(a => a[0] === 'lua')).toBe(false)
  })

  test('watch off: no timer, no process, /logs says so', { options: { watch: false } }, async ($, on) => {
    const { w, clock } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/danco' })
    await clock.advance(20 * 60_000)
    expect(w.ran.length).toBe(0)
    const { text } = await $.command.run(cmd('logs', ''))
    expect(text).toContain('watch is off')
  })
})
