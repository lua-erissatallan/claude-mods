import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { addParked, isForSurface, openHandoffs, parseParkArgs, removeParked, surfaceOf } from '../hooks/lib/memory'
import { batonOf, parkedOf } from '../hooks/lib/project'

tier('user')

const INDEX = [
  '# INDEX.md',
  '',
  '## ▶ Baton',
  '**NEXT UP: Code-2 — read HANDOVER-Code-1.md**',
  '',
  '## ⏳ Parked',
  '> Threads Allan branched away from.',
  '- 2026-09-13 · lua-qc build waits on Lee · next step: read the report · (Code-2)',
  '- 2026-08-29 · Voice agent clause-repeat · next step: reproduce · (Code-2)',
  '',
  '## Brief',
  'M-KOPA is a tier-one prospect.',
].join('\n')

const HANDOFFS = [
  '| ID | Route | Title | Opened | Status |',
  '|---|---|---|---|---|',
  '| C50 | Code-Inquiry-5 → Orchestrator | Create the memory repo | 2026-09-08 | [~] account chosen |',
  '| O16 | Orchestrator → Code | Build the qc folder | 2026-09-13 | [ ] open |',
  '| O12 | Orchestrator → Code | Old thing | 2026-09-01 | [x] done |',
].join('\n')

const NOW = Date.parse('2026-10-06T12:00:00Z')

describe('pulse', () => {
  test('reads the baton and parked items with ages', async () => {
    expect(batonOf(INDEX)).toBe('Code-2 — read HANDOVER-Code-1.md')
    const parked = parkedOf(INDEX, NOW)
    expect(parked.map(p => p.ageDays)).toEqual([23, 38])
  })

  test('finds open handoffs for a session by its surface', async () => {
    const open = openHandoffs(HANDOFFS)
    expect(open.map(r => r.id)).toEqual(['C50', 'O16'])
    expect(surfaceOf('Code-2')).toBe('code')
    expect(surfaceOf('Code-Inquiry-7')).toBe('code-inquiry')
    expect(open.filter(r => isForSurface(r, 'code')).map(r => r.id)).toEqual(['O16'])
    expect(open.filter(r => isForSurface(r, 'orchestrator')).map(r => r.id)).toEqual(['C50'])
  })

  test('/park adds a line under Parked and keeps the rest of INDEX intact', async () => {
    const out = addParked(INDEX, '- 2026-10-06 · new thread · next step: x · (Code-2)')
    expect(parkedOf(out, NOW).length).toBe(3)
    expect(out).toContain('## Brief')
    expect(out.indexOf('new thread')).toBeLessThan(out.indexOf('## Brief'))
  })

  test('/park replaces a (none) placeholder and creates the section when missing', async () => {
    const empty = '# INDEX\n\n## ⏳ Parked\n> note\n\n- (none)\n\n## Brief\nx'
    const out = addParked(empty, '- 2026-10-06 · a · (S)')
    expect(out).not.toContain('(none)')
    expect(parkedOf(out, NOW).length).toBe(1)
    const none = addParked('# INDEX\n\n## Brief\nx', '- 2026-10-06 · a · (S)')
    expect(parkedOf(none, NOW).length).toBe(1)
  })

  test('/unpark removes item n only', async () => {
    const done = removeParked(INDEX, 2)
    expect(done?.removed).toContain('clause-repeat')
    expect(parkedOf(done?.text ?? '', NOW).length).toBe(1)
    expect(removeParked(INDEX, 5)).toBeNull()
  })

  test('park arguments: quoted pair or pipe', async () => {
    expect(parseParkArgs('"fix U3" "port the patterns"')).toEqual({ what: 'fix U3', next: 'port the patterns' })
    expect(parseParkArgs('fix U3 | port the patterns')).toEqual({ what: 'fix U3', next: 'port the patterns' })
    expect(parseParkArgs('   ')).toBeNull()
  })

  test('/pending answers from the files', async ($, on) => {
    mock.env(on, {})
    mock.clock(on)
    on('session.cwd', () => ({ value: '/w/M-Kopa' }))
    on('fs.exists', ($, e) => ({ value: e.path === '/w/M-Kopa/Claude_Memory/INDEX.md' || e.path === '/w/M-Kopa/Claude_Memory/HANDOFFS.md' }))
    on('fs.read', ($, e) => ({ value: String(e.path).endsWith('INDEX.md') ? INDEX : HANDOFFS }))
    const { text } = await $.command.run({ command: 'pending', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
    expect(text).toContain('M-Kopa')
    expect(text).toContain('Parked (2)')
    expect(text).toContain('Code-2')
  })

  test('pulse off: /pending still answers, the band stays empty', { options: { pulse: false } }, async ($, on) => {
    mock.env(on, {})
    on('session.cwd', () => ({ value: '/nowhere' }))
    on('fs.exists', () => ({ value: false }))
    const { text } = await $.command.run({ command: 'pending', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
    expect(text).toContain('No Claude_Memory')
  })

  test('the band draws the project, baton and parked count', async ($, on) => {
    mock.env(on, {})
    mock.clock(on)
    on('session.cwd', () => ({ value: '/w/M-Kopa' }))
    on('fs.exists', ($, e) => ({ value: e.path === '/w/M-Kopa/Claude_Memory/INDEX.md' || e.path === '/w/M-Kopa/Claude_Memory/HANDOFFS.md' }))
    on('fs.read', ($, e) => ({ value: String(e.path).endsWith('INDEX.md') ? INDEX : HANDOFFS }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'allan',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 },
      } as never)
      const text = (await ui.find({ type: 'Text', text: /M-Kopa/ } as never))?.text ?? ''
      expect(text).toContain('M-Kopa')
      expect(text).toContain('2 parked')
      await ui.unmount()
    }
  })

  test('selecting a parked item in the band shows it in the pane, with Unpark', async ($, on) => {
    mock.env(on, {})
    mock.clock(on)
    on('session.cwd', () => ({ value: '/w/M-Kopa' }))
    on('fs.exists', ($, e) => ({ value: e.path === '/w/M-Kopa/Claude_Memory/INDEX.md' || e.path === '/w/M-Kopa/Claude_Memory/HANDOFFS.md' }))
    on('fs.read', ($, e) => ({ value: String(e.path).endsWith('INDEX.md') ? INDEX : HANDOFFS }))
    const writes: Array<[string, string]> = []
    on('fs.write', ($, e) => { writes.push([String(e.path), String(e.text)]); return { value: undefined } })
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })

    const band = await $.ui.mount({
      plugin: 'allan',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 },
    } as never)
    await band.press({ key: 'p1' } as never)

    const pane = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'Pane', requestId: 'allan-pulse', props: { title: 'Pulse', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } } } as never)
    const shown = (await pane.find({ type: 'Text', text: /lua-qc build waits/ } as never))?.text ?? ''
    expect(shown).toContain('lua-qc build waits')

    await pane.press({ key: 'Unpark' } as never)
    expect(writes.length).toBe(1)
    expect(writes[0]?.[1]).not.toContain('lua-qc build waits')

    await band.unmount()
    await pane.unmount()
  })

  test('selecting a handoff shows its id and title, read only', async ($, on) => {
    mock.env(on, {})
    mock.clock(on)
    on('session.cwd', () => ({ value: '/w/M-Kopa' }))
    on('fs.exists', ($, e) => ({ value: e.path === '/w/M-Kopa/Claude_Memory/INDEX.md' || e.path === '/w/M-Kopa/Claude_Memory/HANDOFFS.md' }))
    on('fs.read', ($, e) => ({ value: String(e.path).endsWith('INDEX.md') ? INDEX : HANDOFFS }))
    let wrote = false
    on('fs.write', () => { wrote = true; return { value: undefined } })
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code' } as never)

    const band = await $.ui.mount({
      plugin: 'allan',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 },
    } as never)
    await band.press({ key: 'handoffs' } as never)

    const pane = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'Pane', requestId: 'allan-pulse', props: { title: 'Pulse', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } } } as never)
    const shown = (await pane.find({ type: 'Text', text: /O16/ } as never))?.text ?? ''
    expect(shown).toBe('O16')
    expect(await pane.find({ key: 'next' } as never)).toBeFalsy()
    expect(wrote).toBe(false)

    await band.unmount()
    await pane.unmount()
  })
  test('h opens the first handoff; Next pages through the rest', async ($, on) => {
    const two = `${HANDOFFS}\n| O17 | Orchestrator → Code | Second thing | 2026-09-14 | [ ] open |`
    mock.env(on, {})
    mock.clock(on)
    on('session.cwd', () => ({ value: '/w/M-Kopa' }))
    on('fs.exists', ($, e) => ({ value: e.path === '/w/M-Kopa/Claude_Memory/INDEX.md' || e.path === '/w/M-Kopa/Claude_Memory/HANDOFFS.md' }))
    on('fs.read', ($, e) => ({ value: String(e.path).endsWith('INDEX.md') ? INDEX : two }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('classic.UserPromptSubmit', ($, e) => ({ prompt: e.prompt } as never))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/M-Kopa' })
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Code' } as never)

    const band = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } } as never)
    await band.press({ key: 'handoffs' } as never)
    const pane = await $.ui.mount({ plugin: 'allan', surface: 'terminal', component: 'Pane', requestId: 'allan-pulse', props: { title: 'Pulse', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } } } as never)
    expect((await pane.find({ type: 'Text', text: /^O16$/ } as never))?.text).toBe('O16')
    await pane.press({ key: 'next' } as never)
    expect((await pane.find({ type: 'Text', text: /^O17$/ } as never))?.text).toBe('O17')
    await pane.press({ key: 'next' } as never)
    expect((await pane.find({ type: 'Text', text: /^O16$/ } as never))?.text).toBe('O16')
    await band.unmount()
    await pane.unmount()
  })
})
