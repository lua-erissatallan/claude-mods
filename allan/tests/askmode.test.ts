import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { intentOf, isMutatingBash } from '../hooks/lib/askmode'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const PROMPT = (text: string) => ({ text, wait: false }) as never

/** Hooks beneath the plugin, set before any $ call; `ran` counts tools that went through. */
function world(on: Parameters<TestBody>[1]) {
  const state = { ran: [] as string[], toasts: [] as string[] }
  mock.env(on, {})
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', ($, e) => { state.ran.push(String(e.tool)); return { result: 'ok' } as never })
  on('ui.toast', ($, e) => { state.toasts.push(String(e.text)); return { value: undefined } })
  on('turn.complete', ($, e) => ({ text: '' }) as never)
  on('session.cwd', () => ({ value: '/w' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'git@github.com-lua:x/y.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return state
}

describe('askmode', () => {
  test('reads questions, requests and the rest', async () => {
    expect(intentOf('why does the band show 6 parked?')).toBe('question')
    expect(intentOf('what is next to build')).toBe('question')
    expect(intentOf('Will it pick only sessions for the current project?')).toBe('question')
    expect(intentOf('tidy this up, no code change, just tell me')).toBe('question')
    expect(intentOf('can you fix the relay header?')).toBe('build')
    expect(intentOf('can you explain the relay header?')).toBe('question')
    expect(intentOf('go, with the toast')).toBe('build')
    expect(intentOf('Fix the band. Why did it break?')).toBe('build')
    expect(intentOf('the band looks off')).toBe('unclear')
    expect(intentOf('/sessions')).toBe('unclear')
  })

  test('changing commands are recognised; reads are not', async () => {
    for (const c of ['lua push skill --ci', 'cd x && lua version create', 'lua env production -k FOO -v bar', 'git -C /w commit -m x', 'git push', 'vercel --prod', 'rm -rf dist', "sed -i '' s/a/b/ f"]) {
      expect(isMutatingBash(c)).toBe(true)
    }
    for (const c of ['lua logs --ci --json', 'lua env production --list', 'git status', 'grep -rn rm src', 'ls -la', 'npm test']) {
      expect(isMutatingBash(c)).toBe(false)
    }
  })

  test('a question turn holds back edits and changing commands, with a toast; reads run', async ($, on) => {
    const state = world(on)
    await $.prompt.submit(PROMPT('why is the ctx meter still showing?'))
    const edit = await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect(String(edit.deny ?? '')).toContain("reply 'go'")
    const commit = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(String(commit.deny ?? '')).toContain('question')
    const read = await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
    expect(read.deny).toBeUndefined()
    expect(state.toasts.length).toBe(2)
    expect(state.ran).toEqual(['Bash'])
  })

  test('/build lifts the hold; the next turn starts fresh', async ($, on) => {
    world(on)
    await $.prompt.submit(PROMPT('what does this do?'))
    const { text } = await $.command.run(cmd('build', ''))
    expect(text).toContain('allowed')
    const edit = await $.tool.call({ tool: 'Write', file_path: '/w/a.ts', content: 'x' } as never)
    expect(edit.deny).toBeUndefined()

    await $.prompt.submit(PROMPT('how does relay find names?'))
    await $.turn.complete({ reason: 'answer', answer: 'it reads ~/.claude/sessions', durationMs: 1, isAborted: false, turnId: 't1' } as never)
    const after = await $.tool.call({ tool: 'Write', file_path: '/w/a.ts', content: 'x' } as never)
    expect(after.deny).toBeUndefined()
  })

  test('a request turn is never held', async ($, on) => {
    world(on)
    await $.prompt.submit(PROMPT('go, build askmode'))
    const edit = await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect(edit.deny).toBeUndefined()
  })

  test('askmode off: a question turn changes nothing', { options: { askmode: false } }, async ($, on) => {
    const state = world(on)
    await $.prompt.submit(PROMPT('why is this broken?'))
    const edit = await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect(edit.deny).toBeUndefined()
    expect(state.toasts.length).toBe(0)
  })
})
