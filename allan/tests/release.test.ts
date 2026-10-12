import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { joinPath, parseModsConfig } from '../hooks/lib/config'
import { addTechLine, parseVersions, planFor } from '../hooks/lib/release'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const NOW = Date.parse('2026-10-12T12:00:00Z')
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const versions = (active: number, staged: number[], total: number) => {
  const out: Array<{ version: number; status: string; message: string }> = []
  for (let v = total; v >= 1; v--) {
    out.push({ version: v, status: staged.includes(v) ? 'staged' : v === active ? 'active' : 'superseded', message: `v${v}: things` })
  }
  return JSON.stringify(out)
}

describe('release', () => {
  test('reads .claude-mods.json with defaults', async () => {
    const c = parseModsConfig('{"pairs":["../lead"],"versionCap":50,"checks":{"neon":"node x.mjs"},"protected":["Drew@X.com"],"contacts":["Drew",{"name":"Kiri"}]}')
    expect(c.pairs).toEqual(['../lead'])
    expect(c.versionCap).toBe(50)
    expect(c.checks).toEqual([{ name: 'neon', command: 'node x.mjs' }])
    expect(c.protected).toEqual(['drew@x.com'])
    expect(c.contacts).toEqual(['Drew', 'Kiri'])
    expect(parseModsConfig(null).versionCap).toBe(95)
    expect(parseModsConfig('not json').pairs).toEqual([])
    expect(joinPath('/w/jf/topup', '../lead')).toBe('/w/jf/lead')
  })

  test('plans the newest staged version and the prune list', async () => {
    const parsed = parseVersions(`${versions(33, [34], 34)}\n\n  Update available`)
    expect(parsed?.length).toBe(34)
    const plan = planFor('/w/danco', parsed ?? [], 30)
    expect(plan.active).toBe(33)
    expect(plan.next).toBe(34)
    expect(plan.prune).toEqual([1, 2, 3, 4])
    const nothing = planFor('/w/danco', parseVersions(versions(10, [], 10)) ?? [], 95)
    expect(nothing.next).toBeNull()
    expect(nothing.prune).toEqual([])
    expect(parseVersions('garbage')).toBeNull()
  })

  test('TECH.md gets a Releases section, newest line first', async () => {
    const once = addTechLine('# TECH\n\nbody\n', '- 2026-10-12 · danco: promoted v34 (was v33)')
    expect(once).toContain('## Releases')
    const twice = addTechLine(once, '- 2026-10-13 · danco: promoted v35 (was v34)')
    expect(twice.indexOf('v35')).toBeLessThan(twice.indexOf('v34 (was'))
    expect(twice.indexOf('v34 (was')).toBeGreaterThan(twice.indexOf('## Releases'))
  })
})

type World = { ran: string[][]; writes: Array<[string, string]>; dirty: boolean; toasts: string[] }

/** A session in /w/jf/topup, paired with ../lead, both with versions; every hook set before any $ call. */
function world(on: Parameters<TestBody>[1]): World {
  const w: World = { ran: [], writes: [], dirty: false, toasts: [] }
  mock.env(on, {})
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: '/w/jf/topup' }))
  on('fs.exists', ($, e) => {
    const p = String(e.path)
    return { value: p === '/w/jf/topup/lua.skill.yaml' || p === '/w/jf/lead/lua.skill.yaml' || p === '/w/jf/topup/.claude-mods.json' || p === '/w/jf/Claude_Memory/INDEX.md' || p === '/w/jf/Claude_Memory/TECH.md' }
  })
  on('fs.read', ($, e) => {
    const p = String(e.path)
    if (p.endsWith('.claude-mods.json')) return { value: '{"pairs":["../lead"],"versionCap":30}' }
    if (p.endsWith('TECH.md')) return { value: '# TECH\n' }
    return { value: '' }
  })
  on('fs.write', ($, e) => { w.writes.push([String(e.path), String(e.text)]); return { value: undefined } })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    if (argv[0] === 'git') return { value: { ...OK, stdout: w.dirty ? ' M src/a.ts\n' : '' } }
    if (argv[1] === 'version' && argv[2] === 'list') return { value: { ...OK, stdout: e.init?.cwd === '/w/jf/lead' ? versions(22, [23], 23) : versions(33, [34], 34) } }
    return { value: { ...OK, stdout: 'done' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => { w.toasts.push(String(e.text)); return { value: undefined } })
  return w
}

describe('/promote', () => {
  test('refuses on a dirty tree, running nothing that changes state', async ($, on) => {
    const w = world(on)
    w.dirty = true
    const { text } = await $.command.run(cmd('promote', ''))
    expect(text).toContain('Refused')
    expect(w.ran.some(a => a[1] === 'version')).toBe(false)
  })

  test('plans both agents and opens the pane; nothing runs until the button', async ($, on) => {
    const w = world(on)
    const { text } = await $.command.run(cmd('promote', ''))
    expect(text).toContain('topup: v33 → v34 (then prune v1, v2, v3, v4)')
    expect(text).toContain('lead: v22 → v23')
    expect(w.ran.filter(a => a[2] === 'promote').length).toBe(0)
  })

  test('the Promote button promotes one agent with the confirm env, prunes, and notes TECH.md', async ($, on) => {
    const w = world(on)
    await $.command.run(cmd('promote', ''))
    const pane = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'Pane', requestId: 'allan-release', props: { title: 'Promote', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } } as never)
    await pane.press({ key: 'promote0' } as never)
    const promotes = w.ran.filter(a => a[2] === 'promote')
    expect(promotes).toEqual([['lua', 'version', 'promote', '34']])
    const deletes = w.ran.filter(a => a[2] === 'delete').map(a => a[3])
    expect(deletes).toEqual(['1', '2', '3', '4'])
    expect(w.writes[0]?.[0]).toBe('/w/jf/Claude_Memory/TECH.md')
    expect(w.writes[0]?.[1]).toContain('topup: promoted v34 (was v33); pruned v1, v2, v3, v4')
    expect(w.ran.filter(a => a[2] === 'promote' && a[3] === '23').length).toBe(0)
    await pane.unmount()
  })

  test('release off: /promote says so and runs nothing', { options: { release: false } }, async ($, on) => {
    const w = world(on)
    const { text } = await $.command.run(cmd('promote', ''))
    expect(text).toContain('release is off')
    expect(w.ran.length).toBe(0)
  })
})
