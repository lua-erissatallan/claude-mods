import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { parseModsConfig } from '../lib/config'
import { addDraft, ageDays, draftsIn, markSent, parseDrafts, slackify, type Draft } from '../lib/outbox'
import { parentOf, type Project } from '../lib/project'
import { isOn, type Options } from '../lib/switch'

const PANE = 'allan-outbox'
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)
const shown = atom({ plugin: 'allan', key: 'outboxDrafts' } as const, [])
const note = atom({ plugin: 'allan', key: 'outboxNote' } as const, null)

export const outboxCommands = [
  { name: 'outbox', description: 'Drafts for your contacts kept in Claude_Memory/MESSAGES.md, in a pane with Copy, Copy for Slack and Mark sent.' },
]

const REMINDER = 'Re-read the live systems behind every claim before you send this.'

/** Walks up from the cwd to the nearest folder holding Claude_Memory/INDEX.md or lua.skill.yaml. */
async function findProject($: EngineInterface): Promise<Project | null> {
  let dir: string | null = await $.session.cwd()
  while (dir !== null) {
    const hasMemory = await $.fs.exists(`${dir}/Claude_Memory/INDEX.md`)
    const hasAgent = await $.fs.exists(`${dir}/lua.skill.yaml`)
    if (hasMemory || hasAgent) {
      return { root: dir, name: dir.slice(dir.lastIndexOf('/') + 1), memoryDir: hasMemory ? `${dir}/Claude_Memory` : null, hasAgent }
    }
    dir = parentOf(dir)
  }
  return null
}

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null
}

async function messagesPath($: EngineInterface): Promise<{ path: string; contacts: string[] } | null> {
  const project = await findProject($)
  if (project === null || project.memoryDir === null) return null
  const config = parseModsConfig(await readOr($, `${project.root}/.claude-mods.json`))
  return { path: `${project.memoryDir}/MESSAGES.md`, contacts: config.contacts }
}

async function today($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

/** Keeps every message for a contact found in the reply. */
async function capture($: EngineInterface, answer: string): Promise<void> {
  const where = await messagesPath($)
  if (where === null || where.contacts.length === 0) return
  const found = draftsIn(answer, where.contacts)
  if (found.length === 0) return
  let text = await readOr($, where.path)
  const date = await today($)
  const by = (await read($, sessionName)) ?? 'unnamed session'
  const added: number[] = []
  for (const d of found) {
    const next = addDraft(text, d.to, d.body, date, by)
    if (next === null) continue
    text = next.text
    added.push(next.id)
  }
  if (added.length === 0 || text === null) return
  await $.fs.write(where.path, text)
  $.ui.toast(`outbox kept draft${added.length === 1 ? '' : 's'} M${added.join(', M')} in Claude_Memory/MESSAGES.md (/outbox).`)
}

async function refresh($: EngineInterface): Promise<Draft[]> {
  const where = await messagesPath($)
  const drafts = where === null ? [] : parseDrafts((await readOr($, where.path)) ?? '').filter(d => d.status === 'DRAFT')
  await update($, shown, () => drafts)
  return drafts
}

async function open($: EngineInterface): Promise<string> {
  const where = await messagesPath($)
  if (where === null) return 'No Claude_Memory above this folder, so no MESSAGES.md.'
  const drafts = await refresh($)
  await update($, note, () => null)
  if (drafts.length === 0) return `No drafts in ${where.path.replace(/^.*\/Claude_Memory/, 'Claude_Memory')}.${where.contacts.length === 0 ? ' Add "contacts" to .claude-mods.json for drafts to be kept.' : ''}`
  void $.ui.open({ id: PANE, title: 'Outbox', focus: true })
  return [`${drafts.length} draft${drafts.length === 1 ? '' : 's'} (pane opened):`, ...drafts.map(d => `  M${d.id} · ${d.date} · to ${d.to} · ${d.title}`)].join('\n')
}

export function outbox(on: On, options: Options): void {
  // One line per finished turn: any message for a contact in the reply is kept.
  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    const done = await next(e)
    if (!isOn(options, 'outbox') || e.agentId !== undefined) return done
    try { await capture($, e.answer) } catch { /* a draft not kept is a draft still in the reply */ }
    return done
  })

  // Drafts left over a day are mentioned once, at the start of a session in that project.
  on('session.start', { cwd: /./ }, async ($, e, next) => {
    if (!isOn(options, 'outbox') || !e.isInteractive) return next(e)
    try {
      const where = await messagesPath($)
      if (where !== null) {
        const now = await $.clock.now()
        const old = parseDrafts((await readOr($, where.path)) ?? '').filter(d => d.status === 'DRAFT' && ageDays(d.date, now) >= 1)
        if (old.length > 0) $.ui.toast(`outbox: ${old.length} draft${old.length === 1 ? '' : 's'} older than a day (M${old.map(d => d.id).join(', M')}). /outbox to send or drop them.`)
      }
    } catch { /* the reminder is a convenience */ }
    return next(e)
  })

  on('command.run', { command: 'outbox' }, async $ => {
    if (!isOn(options, 'outbox')) return { text: 'outbox is off (/mods on outbox).' }
    return { text: await open($) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const drafts = await read($, shown)
    const last = await read($, note)
    const copy = (text: string, what: string) => async (press: { surface?: 'terminal' | 'desktop' | 'vscode' | 'mobile' }) => {
      const copied = (await $.ui.copy({ text, surface: press.surface })).isCopied
      await update($, note, () => (copied ? `${what} copied. ${REMINDER}` : `Could not reach a clipboard for ${what}.`))
      $.ui.toast(copied ? `${what} copied. ${REMINDER}` : 'No clipboard reached.')
    }
    const sent = (id: number) => async () => {
      const where = await messagesPath($)
      if (where === null) return
      const text = await readOr($, where.path)
      const done = text === null ? null : markSent(text, id, await today($))
      if (done !== null) await $.fs.write(where.path, done)
      await update($, note, () => (done === null ? `M${id} not found as a draft.` : `M${id} marked sent.`))
      await refresh($)
    }
    return (
      <Box flexDirection="column">
        <Text bold>Outbox: {drafts.length} draft{drafts.length === 1 ? '' : 's'}. {REMINDER}</Text>
        {drafts.map(d => (
          <Box key={`d${d.id}`} flexDirection="column">
            <Text>M{d.id} · {d.date} · to {d.to} · {d.title}</Text>
            <Box>
              <Button key={`copy${d.id}`} onPress={copy(d.body, `M${d.id}`)}>Copy</Button>
              <Button key={`slack${d.id}`} onPress={copy(slackify(d.body), `M${d.id} for Slack`)}>Copy for Slack</Button>
              <Button key={`sent${d.id}`} variant="primary" onPress={sent(d.id)}>Mark sent</Button>
            </Box>
          </Box>
        ))}
        {last !== null && <Text dimColor>{last}</Text>}
        <Button role="dismiss" onPress={async () => { await update($, note, () => null) }}>Close</Button>
      </Box>
    )
  })
}
