import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { alivePids, inboxItem, label, lastBlock, listing, parseSessionFile, resolve, wrap, type SessionEntry } from '../lib/relay'
import { parentOf } from '../lib/project'
import { isOn, type Options } from '../lib/switch'

// The session name pulse records; the messages other sessions relayed here (pulse draws them).
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)
const inbox = atom({ plugin: 'allan', key: 'inbox' } as const, [])

export const relayCommands = [
  { name: 'sessions', description: 'Your open Claude Code sessions, this project first, then the others by project.' },
  { name: 'relay', description: 'Send text, or the last START/END block of my last reply, to another session: /relay Code-4 last · /relay Jackfruit/Code-QC <text>', argumentHint: '<name|Project/name> <text|last>' },
]

/** The nearest folder at or above `dir` holding Claude_Memory/INDEX.md or lua.skill.yaml, by name; else `dir`'s own name. */
async function projectOf($: EngineInterface, dir: string): Promise<string> {
  let at: string | null = dir
  while (at !== null) {
    if ((await $.fs.exists(`${at}/Claude_Memory/INDEX.md`)) || (await $.fs.exists(`${at}/lua.skill.yaml`))) return at.slice(at.lastIndexOf('/') + 1)
    at = parentOf(at)
  }
  return dir.slice(dir.lastIndexOf('/') + 1)
}

/** Every file of Claude Code's own list of sessions (~/.claude/sessions), parsed. */
async function sessionFiles($: EngineInterface): Promise<Array<Omit<SessionEntry, 'project'>>> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.claude/sessions`
  if (!(await $.fs.exists(dir))) return []
  const found: Array<Omit<SessionEntry, 'project'>> = []
  for (const f of await $.fs.list(dir)) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const entry = parseSessionFile(await $.fs.read(`${dir}/${f.name}`))
    if (entry !== null) found.push(entry)
  }
  return found
}

/** This session's name as /rename set it (Claude Code's list), else as pulse saw it, else its id. */
async function selfName($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  return (await sessionFiles($)).find(s => s.id === id)?.name ?? (await read($, sessionName)) ?? id.slice(0, 8)
}

/** Claude Code's own list of running sessions, each with its project. */
async function registry($: EngineInterface): Promise<SessionEntry[]> {
  const found = await sessionFiles($)
  if (found.length === 0) return []
  // A file left behind by a session that crashed names a pid no longer running.
  const ps = await $.process.run(['ps', '-o', 'pid=', '-p', found.map(s => s.pid).join(',')])
  const alive = alivePids(ps.stdout)
  const projects = new Map<string, string>()
  const out: SessionEntry[] = []
  for (const s of found) {
    if (!alive.has(s.pid)) continue
    const project = projects.get(s.cwd) ?? (await projectOf($, s.cwd))
    projects.set(s.cwd, project)
    out.push({ ...s, project })
  }
  return out
}

async function send($: EngineInterface, args: string): Promise<string> {
  const m = args.trim().match(/^(\S+)\s+([\s\S]+)$/)
  if (m === null) return 'Usage: /relay <name> <text|last>, for example /relay Code-4 last'
  const target = m[1] ?? ''
  const rest = (m[2] ?? '').trim()

  const selfId = await $.session.id()
  const project = await projectOf($, await $.session.cwd())
  const all = await registry($)
  const found = resolve(target, all, selfId, project)
  if (!found.ok) return found.why

  let body = rest
  if (rest === 'last') {
    const replies = (await $.session.messages()).filter(x => x.role === 'assistant').map(x => x.text)
    const block = lastBlock(replies.slice(-10))
    if (block === null) return 'No START/END block in my recent replies. /relay <name> <text> sends text as typed.'
    body = block
  }

  const me = all.find(s => s.id === selfId)?.name ?? (await read($, sessionName)) ?? selfId.slice(0, 8)
  const text = wrap(body, me, project)
  const to = `${found.to.project}/${label(found.to)}`
  const sent = await $.session.send({ to: { sessionId: found.to.id }, text })
  if (sent.isDelivered) return `Relayed to ${to}${rest === 'last' ? ' (the last START/END block)' : ''}.`
  const copied = (await $.ui.copy({ text })).isCopied
  return `Not delivered to ${to}: ${sent.reason}. ${copied ? 'Copied to the clipboard; paste it there.' : 'Copy it by hand:'}\n\n${copied ? '' : text}`.trimEnd()
}

export function relay(on: On, options: Options): void {
  on('command.run', { command: 'sessions' }, async $ => {
    if (!isOn(options, 'relay')) return { text: 'relay is off (/mods on relay).' }
    const text = listing(await registry($), await $.session.id(), await projectOf($, await $.session.cwd()), await $.clock.now())
    return { text }
  })

  on('command.run', { command: 'relay' }, async ($, e) => {
    if (!isOn(options, 'relay')) return { text: 'relay is off (/mods on relay).' }
    return { text: await send($, e.args) }
  })

  // Everything this session's model sends another session (SendMessage) carries the sender too.
  on('session.send', async ($, e, next) => {
    if (!isOn(options, 'relay') || e.origin?.kind !== 'model' || e.agentId !== undefined || e.text.startsWith('[relay from ')) return next(e)
    let text = e.text
    try {
      text = wrap(e.text, await selfName($), await projectOf($, await $.session.cwd()))
    } catch { /* send it unheaded rather than not at all */ }
    return next({ ...e, text })
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
