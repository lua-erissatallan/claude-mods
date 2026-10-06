import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { VoiceStyle } from '../../types'
import { isOn, textOf, type Options } from '../lib/switch'

const style = atom({ plugin: 'allan', key: 'style' } as const, null)

const BASE = [
  "How to write replies for Allan (his standing preferences, kept here so they survive compaction):",
  '- Lead with the answer or the outcome. Then only the detail he needs to act. Aim for half the length you would naturally write.',
  '- Plain words, short sentences. He juggles several client projects and often reads on his phone.',
  '- When a task is non-trivial to implement, walk through the build steps; he knows the terms but has not built much end to end.',
  '- Minimize em dashes and hyphens in prose, code identifiers and anything sent outward.',
  '- Never put internal memory references (decision or handoff ids like D12, H22, Claude_Memory paths) into anything a client or another company will read.',
  '- Any message he must paste into another session goes between a START line and an END line that name the target session.',
].join('\n')

const EXTRA: Record<VoiceStyle, string> = {
  normal: '',
  plain:
    '- Style for this session: explain as if to a bright high school student. Keep every crucial detail; drop jargon or explain it in one clause.',
  visual:
    '- Style for this session: where a flow, sequence or structure is involved, add one small ASCII diagram (under 12 lines) before the prose.',
}

function asStyle(value: string): VoiceStyle {
  return value === 'plain' || value === 'visual' ? value : 'normal'
}

export const styleCommand = {
  name: 'style',
  description: 'Reply style for this session: /style normal · /style plain (high school tone) · /style visual (ASCII diagrams)',
  argumentHint: '[normal|plain|visual]',
}

/** The voice section's text for a style (pure: register.ts reads the state and options). */
export function voiceText(chosen: VoiceStyle): string {
  return [BASE, EXTRA[chosen]].filter(Boolean).join('\n')
}

export { asStyle }

export function voice(on: On, options: Options): void {
  on('command.run', { command: 'style' }, async ($, e) => {
    const wanted = e.args.trim()
    if (wanted === '') {
      const now = (await read($, style)) ?? asStyle(textOf(options, 'voiceStyle', 'normal'))
      return { text: `Reply style: ${now}${isOn(options, 'voice') ? '' : ' (voice is off: /mods on voice)'}` }
    }
    if (wanted !== 'normal' && wanted !== 'plain' && wanted !== 'visual') {
      return { text: 'Styles: normal, plain, visual.' }
    }
    await update($, style, () => wanted)
    return { text: `Reply style for this session: ${wanted}.` }
  })

}
