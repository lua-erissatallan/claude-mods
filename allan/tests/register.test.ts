import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

type ComposeInput = import('claude-code').PromptComposeInput
const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: { name: 'default', isKeepingCodingInstructions: true },
  traits: [],
  sections: [],
} as unknown as ComposeInput

const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

describe('register', () => {
  test('commit: Claude attribution is removed from commits and PRs', async ($, on) => {
    mock.env(on, {})
    on('attribution.text', ($, e) => ({ text: e.text }))
    expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).text).toBe('')
    expect((await $.attribution.text({ kind: 'pr', text: 'Generated with Claude Code' })).text).toBe('')
  })

  test('commit: attribution passes through when commit is off', { options: { commit: false } }, async ($, on) => {
    mock.env(on, {})
    on('attribution.text', ($, e) => ({ text: e.text }))
    expect((await $.attribution.text({ kind: 'commit', text: 'kept' })).text).toBe('kept')
  })

  test('commit: a push through a personal remote is refused', async ($, on) => {
    mock.env(on, {})
    on('session.cwd', () => ({ value: '/work' }))
    on('process.run', ($, e) => {
      const args = e.argv.join(' ')
      if (args.includes('remote get-url')) return { value: { exitCode: 0, stdout: 'git@github.com:erissatallan/x.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: 'allan@luaimplementation.ai\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('tool.call', () => ({ result: 'pushed' }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(String(ran.deny ?? '')).toContain('wrong identity')
  })

  test('commit: a push through github.com-lua with the work email passes', async ($, on) => {
    mock.env(on, {})
    on('session.cwd', () => ({ value: '/work' }))
    on('process.run', ($, e) => {
      const args = e.argv.join(' ')
      if (args.includes('remote get-url')) return { value: { exitCode: 0, stdout: 'git@github.com-lua:lua-erissatallan/x.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: 'allan@luaimplementation.ai\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('tool.call', () => ({ result: 'pushed' }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(ran.deny).toBeUndefined()
  })

  test('voice: the system prompt gains the voice section', async ($, on) => {
    mock.env(on, {})
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    const { sections } = await $.prompt.compose(COMPOSE)
    const voice = sections.find(s => s.id === 'allan:voice')
    expect(voice?.text).toContain('Lead with the answer')
  })

  test('voice: off means no section', { options: { voice: false } }, async ($, on) => {
    mock.env(on, {})
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.some(s => s.id === 'allan:voice')).toBe(false)
  })

  test('kill switch: ALLAN_MODS_OFF=1 turns every feature into a pass-through', async ($, on) => {
    mock.env(on, { ALLAN_MODS_OFF: '1' })
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.toast', () => ({ value: undefined }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    await $.session.start(START)
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.some(s => s.id === 'allan:voice')).toBe(false)
  })

  test('mods: /mods off voice sets the voice row to false', async ($, on) => {
    mock.env(on, {})
    const set: Array<[string, unknown]> = []
    on('config.set', ($, e) => {
      set.push([e.key, e.value])
      return { value: e.value }
    })
    const { text } = await $.command.run(cmd('mods', 'off voice'))
    expect(set).toEqual([['allan.voice', false]])
    expect(text).toContain('voice is now off')
  })

  test('mods: /mods lists every feature', async ($, on) => {
    mock.env(on, {})
    const { text } = await $.command.run(cmd('mods', ''))
    expect(text).toContain('voice')
    expect(text).toContain('commit')
  })
})
