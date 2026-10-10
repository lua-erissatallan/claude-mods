import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { HELD, intentOf, isMutatingBash } from '../lib/askmode'
import { isOn, type Options } from '../lib/switch'

// Whether the turn running now answers a question; pulse clears it when the turn completes.
const askTurn = atom({ plugin: 'allan', key: 'askTurn' } as const, false)

export const askmodeCommands = [
  { name: 'build', description: 'This turn may change files and production after all (askmode marked it a question).' },
]

function usesModel(options: Options): boolean {
  return (options as Record<string, unknown>)['askmodeUseModel'] === true
}

async function hold($: EngineInterface, what: string): Promise<{ deny: string }> {
  $.ui.toast(`askmode held back ${what}: this turn is a question. Reply 'go' or /build to allow it.`)
  return { deny: HELD }
}

export function askmode(on: On, options: Options): void {
  on('prompt.submit', async ($, e, next) => {
    if (!isOn(options, 'askmode')) return next(e)
    let intent = intentOf(e.text)
    if (intent === 'unclear' && usesModel(options)) {
      try {
        const label = await $.model.classify(e.text, ['question', 'request for changes'], { model: 'haiku' })
        if (label === 'question') intent = 'question'
      } catch { /* unclear stays unmarked */ }
    }
    await update($, askTurn, () => intent === 'question')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!isOn(options, 'askmode') || !(await read($, askTurn))) return next(e)
    return hold($, 'Edit')
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!isOn(options, 'askmode') || !(await read($, askTurn))) return next(e)
    return hold($, 'Write')
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    if (!isOn(options, 'askmode') || !(await read($, askTurn))) return next(e)
    return hold($, 'NotebookEdit')
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn(options, 'askmode') || !(await read($, askTurn))) return next(e)
    const command = String(e.command ?? '')
    return isMutatingBash(command) ? hold($, `\`${command.slice(0, 60)}\``) : next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'build' }, async $ => {
    const was = await read($, askTurn)
    await update($, askTurn, () => false)
    return { text: was ? 'Changes allowed for the rest of this turn.' : 'Nothing was held: this turn was not marked a question.' }
  })
}
