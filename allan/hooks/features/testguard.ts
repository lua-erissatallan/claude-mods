import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { parseModsConfig } from '../lib/config'
import { parentOf } from '../lib/project'
import { isOn, type Options } from '../lib/switch'
import { protectedIn, recipientKey, redactBlocks, scriptsIn, secretsUsed, TESTMODE_HELD, withSecrets } from '../lib/testguard'

// Whether /testmode is on, and the secrets /secret set holds for this session only.
const testMode = atom({ plugin: 'allan', key: 'testMode' } as const, false)
const secrets = atom({ plugin: 'allan', key: 'secrets' } as const, {})

export const testguardCommands = [
  { name: 'testmode', description: 'Protect real recipients while you test: /testmode on | off | status. Bash naming a protected address, or lua env setting a recipient key, is refused while on.', argumentHint: 'on|off|status' },
  { name: 'secret', description: 'Hold a secret for this session from the clipboard, never in the transcript: /secret set NAME, then use $NAME in commands. /secret list · /secret clear', argumentHint: 'set <NAME> | list | clear' },
]

/** The nearest folder above the cwd with a .claude-mods.json, read; else empty config. */
async function config($: EngineInterface) {
  let dir: string | null = await $.session.cwd()
  while (dir !== null) {
    const path = `${dir}/.claude-mods.json`
    if (await $.fs.exists(path)) return parseModsConfig(await $.fs.read(path))
    if ((await $.fs.exists(`${dir}/Claude_Memory/INDEX.md`)) || (await $.fs.exists(`${dir}/lua.skill.yaml`))) break
    dir = parentOf(dir)
  }
  return parseModsConfig(null)
}

async function isTesting($: EngineInterface): Promise<boolean> {
  if (await read($, testMode)) return true
  return (await $.env.get('ALLAN_TESTMODE')) === '1'
}

async function testmode($: EngineInterface, args: string): Promise<string> {
  const verb = args.trim().toLowerCase()
  if (verb === 'on') {
    await update($, testMode, () => true)
    const list = (await config($)).protected
    return list.length === 0
      ? 'Test mode on, but .claude-mods.json names no "protected" addresses above this folder, so only recipient env keys are guarded.'
      : `Test mode on. Protected: ${list.join(', ')}. Bash naming them and lua env -k *CC/*ALLOWLIST/*RECIPIENT/*TO are refused until /testmode off.`
  }
  if (verb === 'off') {
    await update($, testMode, () => false)
    return (await $.env.get('ALLAN_TESTMODE')) === '1' ? 'Test mode off here, but ALLAN_TESTMODE=1 is set in the environment, so the guard stays on.' : 'Test mode off.'
  }
  const on = await isTesting($)
  const list = (await config($)).protected
  return `Test mode is ${on ? 'on' : 'off'}. Protected: ${list.length === 0 ? '(none in .claude-mods.json)' : list.join(', ')}.`
}

async function secret($: EngineInterface, args: string): Promise<string> {
  const [verb, name] = args.trim().split(/\s+/)
  if (verb === 'list') {
    const names = Object.keys(await read($, secrets))
    return names.length === 0 ? 'No secrets held this session.' : `Held this session: ${names.join(', ')}. Use $NAME in Bash; the value never shows.`
  }
  if (verb === 'clear') {
    await update($, secrets, () => ({}))
    return 'Secrets cleared.'
  }
  if (verb !== 'set' || name === undefined || !/^[A-Z_][A-Z0-9_]*$/.test(name)) return 'Usage: /secret set NAME (the value is read from the clipboard) · /secret list · /secret clear'
  const paste = await $.process.run(['pbpaste'])
  const value = paste.stdout.trim()
  if (paste.exitCode !== 0 || value === '') return 'The clipboard is empty. Copy the value first, then /secret set NAME.'
  await update($, secrets, s => ({ ...s, [name]: value }))
  return `${name} held for this session (${value.length} characters, never shown). Use $${name} in Bash commands; tool results are redacted.`
}

export function testguard(on: On, options: Options): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn(options, 'testguard')) return next(e)
    let command = String(e.command ?? '')

    if (await isTesting($)) {
      const list = (await config($)).protected
      const named = protectedIn(command, list)
      if (named.length > 0) {
        $.ui.toast(`testguard held a command naming ${named[0]}`)
        return { deny: TESTMODE_HELD(`this command names a protected address (${named.join(', ')})`) }
      }
      const cwd = await $.session.cwd()
      for (const script of scriptsIn(command)) {
        const path = script.startsWith('/') ? script : `${cwd}/${script}`
        if (!(await $.fs.exists(path))) continue
        const inside = protectedIn(await $.fs.read(path), list)
        if (inside.length > 0) {
          $.ui.toast(`testguard held ${script}: it names ${inside[0]}`)
          return { deny: TESTMODE_HELD(`${script} names a protected address (${inside.join(', ')})`) }
        }
      }
      const key = recipientKey(command)
      if (key !== null) {
        $.ui.toast(`testguard held lua env -k ${key}`)
        return { deny: TESTMODE_HELD(`${key} names recipients; changing it`) }
      }
    }

    const held = await read($, secrets)
    const used = secretsUsed(command, Object.keys(held))
    if (used.length > 0) command = withSecrets(command, held, used)
    return command === e.command ? next(e) : next({ ...e, command })
  }).catch(($, e, next) => next(e))

  // Every row kept in the transcript: a secret's value is replaced before it is stored or read by the model.
  on('session.append', async ($, e, next) => {
    if (!isOn(options, 'testguard')) return next(e)
    const held = await read($, secrets)
    if (Object.keys(held).length === 0) return next(e)
    const content = redactBlocks(e.message.content as Array<Record<string, unknown>>, held)
    return content === null ? next(e) : next({ ...e, message: { ...e.message, content: content as typeof e.message.content } })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'testmode' }, async ($, e) => ({ text: await testmode($, e.args) }))
  on('command.run', { command: 'secret' }, async ($, e) => ({ text: await secret($, e.args) }))
}
