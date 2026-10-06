import type { On } from 'claude-code'

import { FEATURES, type Options } from '../lib/switch'

const FIELDS = new Set(Object.values(FEATURES).flat())

function listing(options: Options): string {
  const o = options as Record<string, unknown>
  const lines = Object.entries(FEATURES).map(([name, fields]) => {
    const state = o[name] === false ? 'off' : 'on '
    const extra = fields
      .filter(f => f !== name)
      .map(f => `${f}=${String(o[f] ?? 'default')}`)
      .join('  ')
    return `${state}  ${name.padEnd(10)} ${extra}`
  })
  return [
    "Allan's mods",
    ...lines,
    '',
    '/mods off <feature>  ·  /mods on <feature>  ·  /mods set <field> <value>',
    'Everything off at once: start Claude with ALLAN_MODS_OFF=1, or /plugin disable allan@allan-mods.',
  ].join('\n')
}

export const modsCommand = {
  name: 'mods',
  description: "List Allan's mods, or switch one: /mods off watch · /mods on watch · /mods set commitIdentity warn",
  argumentHint: '[on|off|set] [feature|field] [value]',
}

export function mods(on: On, options: Options): void {
  on('command.run', { command: 'mods' }, async ($, e) => {
    const [verb, target, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === undefined) return { text: listing(options) }

    if ((verb === 'on' || verb === 'off') && target === undefined) {
      return { text: `Which feature? For example /mods ${verb} voice. Features: ${Object.keys(FEATURES).join(', ')}.` }
    }

    if ((verb === 'on' || verb === 'off') && target !== undefined) {
      if (!(target in FEATURES)) return { text: `No feature named "${target}". /mods lists them.` }
      await $.config.set({ key: `allan.${target}`, value: verb === 'on' })
      return { text: `${target} is ${verb}. It takes effect from the next prompt.` }
    }

    if (verb === 'set' && target !== undefined && rest.length > 0) {
      if (!FIELDS.has(target)) return { text: `No field named "${target}". /mods lists them.` }
      const raw = rest.join(' ')
      const value = raw === 'true' ? true : raw === 'false' ? false : raw
      await $.config.set({ key: `allan.${target}`, value })
      return { text: `${target} = ${raw}.` }
    }

    return { text: `Not understood: /mods ${e.args}\n\n${listing(options)}` }
  })
}
