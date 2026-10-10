import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { FORGET_MS, inboxItem, isEntry, lastBlock, listing, resolve, STORE_PREFIX, wrap, type SessionEntry } from '../lib/relay'
import { parentOf } from '../lib/project'
import { isOn, type Options } from '../lib/switch'

// The session name pulse records; the messages other sessions relayed here (pulse draws them).
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)
const inbox = atom({ plugin: 'allan', key: 'inbox' } as const, [])

export const relayCommands = [
  { name: 'sessions', description: 'Your sessions seen in the last 12 hours, this project first, then the others by project.' },
  { name: 'relay', description: 'Send text, or the last START/END block of my last reply, to another session: /relay Code-4 last · /relay Jackfruit/Code-QC <text>', argumentHint: '<name|Project/name> <text|last>' },
]

/** The nearest folder above the cwd holding Claude_Memory/INDEX.md or lua.skill.yaml, by name; else the cwd's name. */
async function projectName($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  let dir: string | null = cwd
  while (dir !== null) {
    if ((await $.fs.exists(`${dir}/Claude_Memory/INDEX.md`)) || (await $.fs.exists(`${dir}/lua.skill.yaml`))) return dir.slice(dir.lastIndexOf('/') + 1)
    dir = parentOf(dir)
  }
  return cwd.slice(cwd.lastIndexOf('/') + 1)
}

/** Every session in the registry; entries unseen for a week are forgotten on the way. */
async function registry($: EngineInterface, now: number): Promise<SessionEntry[]> {
  const out: SessionEntry[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX)) continue
    const entry = await $.store.get(key)
    if (!isEntry(entry) || now - entry.lastSeen > FORGET_MS) await $.store.delete(key)
    else out.push(entry)
  }
  return out
}

async function send($: EngineInterface, args: string): Promise<string> {
  const m = args.trim().match(/^(\S+)\s+([\s\S]+)$/)
  if (m === null) return 'Usage: /relay <name> <text|last>, for example /relay Code-4 last'
  const target = m[1] ?? ''
  const rest = (m[2] ?? '').trim()

  const now = await $.clock.now()
  const selfId = await $.session.id()
  const project = await projectName($)
  const found = resolve(target, await registry($, now), selfId, project, now)
  if (!found.ok) return found.why

  let body = rest
  if (rest === 'last') {
    const replies = (await $.session.messages()).filter(x => x.role === 'assistant').map(x => x.text)
    const block = lastBlock(replies.slice(-10))
    if (block === null) return 'No START/END block in my recent replies. /relay <name> <text> sends text as typed.'
    body = block
  }

  const me = (await read($, sessionName)) ?? `unnamed ${selfId.slice(0, 8)}`
  const text = wrap(body, me, project)
  const to = `${found.to.project}/${found.to.name ?? found.to.id.slice(0, 8)}`
  const sent = await $.session.send({ to: { sessionId: found.to.id }, text })
  if (sent.isDelivered) return `Relayed to ${to}${rest === 'last' ? ' (the last START/END block)' : ''}.`
  const copied = (await $.ui.copy({ text })).isCopied
  return `Not delivered to ${to}: ${sent.reason}. ${copied ? 'Copied to the clipboard; paste it there.' : 'Copy it by hand:'}\n\n${copied ? '' : text}`.trimEnd()
}

export function relay(on: On, options: Options): void {
  on('command.run', { command: 'sessions' }, async $ => {
    if (!isOn(options, 'relay')) return { text: 'relay is off (/mods on relay).' }
    const now = await $.clock.now()
    return { text: listing(await registry($, now), await $.session.id(), await projectName($), now) }
  })

  on('command.run', { command: 'relay' }, async ($, e) => {
    if (!isOn(options, 'relay')) return { text: 'relay is off (/mods on relay).' }
    return { text: await send($, e.args) }
  })

  // A message from another session goes on to the model as usual; the band shows it arrived.
  on('session.receive', async ($, e, next) => {
    const done = await next(e)
    if (!isOn(options, 'relay') || e.agentId !== undefined) return done
    if (e.origin.kind !== 'peer-send-message' && !e.text.startsWith('[relay from ')) return done
    try {
      const item = inboxItem(e.text, await $.clock.now())
      await update($, inbox, items => [...items, item].slice(-20))
    } catch { /* the inbox row is a convenience; the message itself is already delivered */ }
    return done
  })
}
