import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { commit } from './features/commit'
import { handover, handoverCommands } from './features/handover'
import { mods, modsCommand } from './features/mods'
import { pulse, pulseCommands } from './features/pulse'
import { relay, relayCommands } from './features/relay'
import { asStyle, styleCommand, voice, voiceText } from './features/voice'
import { isOn, kill, textOf } from './lib/switch'

// The same session value voice.ts writes from /style.
const style = atom({ plugin: 'allan', key: 'style' } as const, null)

// One plugin, many features. Events with no matcher (session start, the system prompt) are
// hooked once here, with pure helpers from the features. Matched events (a tool, a command)
// are hooked inside each feature.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    kill.isOn = (await $.env.get('ALLAN_MODS_OFF')) === '1'
    if (kill.isOn) {
      $.ui.toast("Allan's mods are off for this session (ALLAN_MODS_OFF=1).")
      return next(e)
    }
    await $.command.register(modsCommand)
    await $.command.register(styleCommand)
    for (const spec of pulseCommands) await $.command.register(spec)
    for (const spec of handoverCommands) await $.command.register(spec)
    for (const spec of relayCommands) await $.command.register(spec)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!isOn(options, 'voice')) return composed
    const chosen = (await read($, style)) ?? asStyle(textOf(options, 'voiceStyle', 'normal'))
    return { sections: [...composed.sections, { id: 'allan:voice', text: voiceText(chosen), scope: 'session' as const }] }
  })

  // Each feature registers on its own, so one failing never takes the others down.
  try { mods(on, options) } catch { /* reported by the engine */ }
  try { voice(on, options) } catch { /* reported by the engine */ }
  try { commit(on, options) } catch { /* reported by the engine */ }
  try { pulse(on, options) } catch { /* reported by the engine */ }
  try { handover(on, options) } catch { /* reported by the engine */ }
  try { relay(on, options) } catch { /* reported by the engine */ }
}
