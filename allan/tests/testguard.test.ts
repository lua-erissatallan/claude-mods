import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { looksLikeKey, protectedIn, recipientKey, redact, redactBlocks, scriptsIn, secretsUsed, withSecrets } from '../hooks/lib/testguard'

tier('user')

type RunInput = import('claude-code').CommandRunInput
const cmd = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as unknown as RunInput

const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const PROTECTED = ['drew@leerealestate.com', 'kiri@leerealestate.com']

describe('testguard', () => {
  test('finds protected addresses, scripts, recipient keys and key shaped strings', async () => {
    expect(protectedIn('curl -d to=Drew@LeeRealEstate.com', PROTECTED)).toEqual(['drew@leerealestate.com'])
    expect(protectedIn('curl -d to=allan@luaimplementation.ai', PROTECTED)).toEqual([])
    expect(scriptsIn('node scripts/send-test.mjs --dry && ./deploy.sh; python3 x.py')).toEqual(['scripts/send-test.mjs', 'x.py', './deploy.sh'])
    expect(recipientKey('lua env production -k NOTIFY_CC -v a@b.c')).toBe('NOTIFY_CC')
    expect(recipientKey('lua env production -k STAFF_ALLOWLIST -v x')).toBe('STAFF_ALLOWLIST')
    expect(recipientKey('lua env production -k OPENAI_MODEL -v x')).toBeNull()
    expect(recipientKey('lua env production --list')).toBeNull()
    expect(looksLikeKey('here is sk_live_abcdefghijklmnop1234')).toBe(true)
    expect(looksLikeKey('the lua_cli docs')).toBe(false)
  })

  test('secrets: used names, the export prefix, and redaction of blocks', async () => {
    expect(secretsUsed('curl -H "x: $LUA_KEY" $URL ${LUA_KEYS}', ['LUA_KEY', 'URL', 'LUA_KEYS', 'OTHER'])).toEqual(['LUA_KEY', 'URL', 'LUA_KEYS'])
    expect(withSecrets('echo $A', { A: "it's" }, ['A'])).toBe("export A='it'\\''s'; echo $A")
    expect(redact('token=abcd1234 ok', { T: 'abcd1234' })).toBe('token=[T redacted] ok')
    const blocks = redactBlocks([{ type: 'tool_result', content: [{ type: 'text', text: 'got abcd1234' }] }, { type: 'text', text: 'plain' }], { T: 'abcd1234' })
    expect(JSON.stringify(blocks)).toContain('[T redacted]')
    expect(redactBlocks([{ type: 'text', text: 'nothing' }], { T: 'abcd1234' })).toBeNull()
  })
})

type World = { ran: string[][]; toasts: string[]; clipboard: string; files: Record<string, string> }

/** A session in /w/lee with protected addresses in .claude-mods.json; every hook set before any $ call. */
function world(on: Parameters<TestBody>[1], env: Record<string, string> = {}): World {
  const w: World = { ran: [], toasts: [], clipboard: '', files: { '/w/lee/.claude-mods.json': JSON.stringify({ protected: PROTECTED }), '/w/lee/scripts/blast.mjs': 'sendTo("drew@leerealestate.com")' } }
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/w/lee' }))
  on('fs.exists', ($, e) => ({ value: String(e.path) in w.files }))
  on('fs.read', ($, e) => ({ value: w.files[String(e.path)] ?? '' }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    return { value: { ...OK, stdout: argv[0] === 'pbpaste' ? w.clipboard : '' } }
  })
  on('tool.call', ($, e) => ({ result: { stdout: `ran: ${String((e as { command?: string }).command ?? '')}`, stderr: '', interrupted: false } } as never))
  on('ui.toast', ($, e) => { w.toasts.push(String(e.text)); return { value: undefined } })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  return w
}

describe('testguard guards', () => {
  test('with test mode off nothing is held', async ($, on) => {
    world(on)
    const r = await $.tool.call({ tool: 'Bash', command: 'node scripts/blast.mjs' } as never)
    expect(r.deny).toBeUndefined()
  })

  test('/testmode on holds a protected address, a script naming one, and a recipient env key', async ($, on) => {
    const w = world(on)
    const { text } = await $.command.run(cmd('testmode', 'on'))
    expect(text).toContain('drew@leerealestate.com')
    const direct = await $.tool.call({ tool: 'Bash', command: 'curl -d to=drew@leerealestate.com https://x' } as never)
    expect(String(direct.deny ?? '')).toContain('protected address')
    const script = await $.tool.call({ tool: 'Bash', command: 'node scripts/blast.mjs' } as never)
    expect(String(script.deny ?? '')).toContain('scripts/blast.mjs')
    const env = await $.tool.call({ tool: 'Bash', command: 'lua env production -k NOTIFY_CC -v test@example.com' } as never)
    expect(String(env.deny ?? '')).toContain('NOTIFY_CC')
    const fine = await $.tool.call({ tool: 'Bash', command: 'lua logs --ci --json' } as never)
    expect(fine.deny).toBeUndefined()
    expect(w.toasts.length).toBe(3)
    await $.command.run(cmd('testmode', 'off'))
    const after = await $.tool.call({ tool: 'Bash', command: 'node scripts/blast.mjs' } as never)
    expect(after.deny).toBeUndefined()
  })

  test('ALLAN_TESTMODE=1 in the environment is test mode', async ($, on) => {
    world(on, { ALLAN_TESTMODE: '1' })
    const r = await $.tool.call({ tool: 'Bash', command: 'echo kiri@leerealestate.com' } as never)
    expect(String(r.deny ?? '')).toContain('kiri@leerealestate.com')
  })

  test('/secret set takes the clipboard, injects $NAME, and the transcript row is redacted', async ($, on) => {
    const w = world(on)
    w.clipboard = 'lua_abcdef1234567890XYZ\n'
    const { text } = await $.command.run(cmd('secret', 'set LUA_KEY'))
    expect(text).toContain('LUA_KEY held')
    expect(text).not.toContain('abcdef')
    const r = await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: $LUA_KEY" https://x' } as never)
    expect(String((r.result as { stdout?: string } | undefined)?.stdout ?? '')).toContain("export LUA_KEY='lua_abcdef1234567890XYZ'; curl")
    const row = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'the server said lua_abcdef1234567890XYZ' }] } } as never)
    expect(JSON.stringify(row.message?.content ?? '')).toContain('[LUA_KEY redacted]')
    expect(JSON.stringify(row.message?.content ?? '')).not.toContain('abcdef')
    const { text: listed } = await $.command.run(cmd('secret', 'list'))
    expect(listed).toContain('LUA_KEY')
  })

  test('a key shaped prompt gets a warning toast', async ($, on) => {
    const w = world(on)
    await $.prompt.submit({ text: 'use sk_live_abcdefghijklmnop1234 for the call', wait: false } as never)
    expect(w.toasts.some(t => t.includes('API key'))).toBe(true)
  })

  test('testguard off: test mode holds nothing, no redaction, no warning', { options: { testguard: false } }, async ($, on) => {
    const w = world(on, { ALLAN_TESTMODE: '1' })
    const r = await $.tool.call({ tool: 'Bash', command: 'echo drew@leerealestate.com' } as never)
    expect(r.deny).toBeUndefined()
    await $.prompt.submit({ text: 'sk_live_abcdefghijklmnop1234', wait: false } as never)
    expect(w.toasts.length).toBe(0)
  })
})
