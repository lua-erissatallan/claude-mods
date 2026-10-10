import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { alertFor, closeChecks, isLead, sectionsFrom, thresholdsOf } from '../hooks/lib/handover'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const INDEX = [
  '# INDEX',
  '**NEXT UP: Code-3**',
  '## ⏳ Parked',
  '- 2026-09-01 · old thread · next step: x · (Code-3)',
  '- 2026-10-09 · fresh thread · (Code-3)',
  '- 2026-08-01 · someone else · (Orchestrator)',
  '## Brief',
].join('\n')

const DRAFT = [
  'Here is the handover.',
  '## Work done',
  '- built handover',
  '## Learnings and gotchas',
  '- rule 5',
  '## Pending items',
  '- relay',
  '## How to start',
  '- read BUILD-PLAN.md',
].join('\n')

const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const NOW = Date.parse('2026-10-10T12:00:00Z')
const MSG = [{ role: 'user', text: 'hi', toolUses: [] }]

const measure = (percent: number) => ({ context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits: [], changed: ['context'] }) as never

/** A Code-3 session in /w/M-Kopa with a memory folder. */
function workspace(on: Parameters<TestBody>[1], name = 'Code-3', allExist = false) {
  mock.env(on, {})
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: '/w/M-Kopa' }))
  on('fs.exists', ($, e) => ({ value: allExist || String(e.path).endsWith('Claude_Memory/INDEX.md') || String(e.path).endsWith('Claude_Memory/HANDOFFS.md') }))
  on('fs.read', () => ({ value: INDEX }))
  on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', () => ({ messages: MSG }) as never)
  return async ($: Parameters<TestBody>[0]) => {
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: name } as never)
  }
}

describe('handover', () => {
  test('thresholds alert once each; a jump alerts once; a drop re-arms', async () => {
    const t = thresholdsOf('80, 60,70,abc,150')
    expect(t).toEqual([60, 70, 80])
    let r = alertFor(61, t, [])
    expect(r).toEqual({ alert: 60, fired: [60] })
    expect(alertFor(65, t, r.fired).alert).toBeNull()
    r = alertFor(83, t, r.fired)
    expect(r).toEqual({ alert: 80, fired: [60, 70, 80] })
    expect(alertFor(20, t, r.fired).fired).toEqual([])
  })

  test('lead pattern and model draft parsing', async () => {
    expect(isLead('Code-3', '^(Orchestrator|Lead|Code)')).toBe(true)
    expect(isLead('Research', '^(Orchestrator|Lead|Code)')).toBe(false)
    expect(isLead(null, '^Code')).toBe(false)
    expect(sectionsFrom(DRAFT)?.startsWith('## Work done')).toBe(true)
    expect(sectionsFrom('## Work done\n- only one')).toBeNull()
  })

  test('/close checklist names what is missing', async () => {
    const checks = closeChecks({
      porcelain: ' M a.md\n?? b.md\n',
      today: '2026-10-10',
      modified: { 'INDEX.md': '2026-10-10', 'HANDOFFS.md': '2026-10-01' },
      parked: [{ date: '2026-09-01', ageDays: 39, text: 'old · (Code-3)' }, { date: '2026-08-01', ageDays: 70, text: 'x · (Orchestrator)' }],
      session: 'Code-3',
      staleDays: 7,
    })
    expect(checks.map(c => c.ok)).toEqual([false, true, false, false])
    expect(checks[0]?.line).toContain('a.md, b.md')
  })

  test('context meter: status line and one toast per threshold', async ($, on) => {
    const start = workspace(on)
    const toasts: string[] = []
    const status: Array<string | undefined> = []
    on('ui.toast', ($, e) => { toasts.push(String(e.text)); return { value: undefined } })
    on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
    await start($)
    await $.session.measure(measure(55))
    await $.session.measure(measure(62))
    await $.session.measure(measure(64))
    await $.session.measure(measure(91))
    expect(status).toEqual([undefined, 'ctx 62%', 'ctx 64%', 'ctx 91%'])
    expect(toasts.length).toBe(2)
    expect(toasts[1]).toContain('now')
  })

  test('auto compaction is skipped for a lead session only', async ($, on) => {
    const start = workspace(on)
    on('ui.toast', () => ({ value: undefined }))
    await start($)
    const lead = await $.session.compact({ trigger: 'auto', messages: MSG } as never)
    expect(String(lead.skip ?? '')).toContain('Code-3')
    const manual = await $.session.compact({ trigger: 'manual', messages: MSG } as never)
    expect(manual.skip).toBeUndefined()
  })

  test('auto compaction runs for a session that is not a lead', async ($, on) => {
    const start = workspace(on, 'Research')
    await start($)
    const r = await $.session.compact({ trigger: 'auto', messages: MSG } as never)
    expect(r.skip).toBeUndefined()
  })

  test('/handover writes the drafted file and copies the kickoff prompt', async ($, on) => {
    const start = workspace(on)
    const writes: Array<[string, string]> = []
    const copies: string[] = []
    on('fs.write', ($, e) => { writes.push([String(e.path), String(e.text)]); return { value: undefined } })
    on('model.fork', () => ({ value: { isAnswered: true, text: DRAFT, usage: USAGE } }) as never)
    on('session.usage', () => ({ value: { context: { window: 200_000, tokens: 150_000, percent: 75 }, rateLimits: [] } }) as never)
    on('session.id', () => ({ value: 'abc-123' }))
    on('ui.copy', ($, e) => { copies.push(String(e.text)); return { value: { isCopied: true } } as never })
    await start($)
    const { text } = await $.command.run(cmd('handover', 'Code-4'))
    expect(writes[0]?.[0]).toBe('/w/M-Kopa/Claude_Memory/HANDOVER_Code-4.md')
    expect(writes[0]?.[1]).toContain('# HANDOVER: Code-3 → Code-4')
    expect(writes[0]?.[1]).toContain('## Pending items\n- relay')
    expect(writes[0]?.[1]).not.toContain('Here is the handover')
    expect(copies[0]).toContain('▼▼▼ START · message for Code-4')
    expect(copies[0]).toContain('▲▲▲ END · message for Code-4')
    expect(copies[0]).toContain('/w/M-Kopa')
    expect(text).toContain('copied')
  })

  test('/handover falls back to empty headings when the fork is not answered', async ($, on) => {
    const start = workspace(on)
    const writes: string[] = []
    on('fs.write', ($, e) => { writes.push(String(e.text)); return { value: undefined } })
    on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
    on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }) as never)
    on('session.id', () => ({ value: 'abc-123' }))
    on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-surface' } }) as never)
    await start($)
    const { text } = await $.command.run(cmd('handover', 'Code-4'))
    expect(writes[0]).toContain('## How to start\n\n- ❓ fill in')
    expect(text).toContain('nothing-to-fork')
    expect(text).toContain('copy it by hand')
  })

  test('/handover will not overwrite without --force', async ($, on) => {
    workspace(on, 'Code-3', true)
    const { text } = await $.command.run(cmd('handover', 'Code-4'))
    expect(text).toContain('already exists')
  })

  test('/close reads git, the memory files and Parked', async ($, on) => {
    const start = workspace(on)
    on('process.run', () => ({ value: OK }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }) as never)
    await start($)
    const { text } = await $.command.run(cmd('close', ''))
    expect(text).toContain('working tree clean')
    expect(text).toContain('old thread')
  })

  test('handover off: no meter, no toast, auto compaction runs', { options: { handover: false } }, async ($, on) => {
    const start = workspace(on)
    let touched = false
    on('ui.toast', () => { touched = true; return { value: undefined } })
    on('ui.status', () => { touched = true; return { value: undefined } })
    await start($)
    await $.session.measure(measure(95))
    const r = await $.session.compact({ trigger: 'auto', messages: MSG } as never)
    expect(r.skip).toBeUndefined()
    expect(touched).toBe(false)
  })

  test('a reload clears a stale meter below the first threshold, and sets it above', async ($, on) => {
    const start = workspace(on)
    const status: Array<string | undefined> = []
    let percent = 19
    on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
    on('session.usage', () => ({ value: { context: { window: 200_000, percent }, rateLimits: [] } }) as never)
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.id', () => ({ value: 'abc' }))
    mock.store(on)
    await start($)
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w/M-Kopa' })
    percent = 72
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w/M-Kopa' })
    expect(status).toEqual([undefined, 'ctx 72%'])
  })
})
