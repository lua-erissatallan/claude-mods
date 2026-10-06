import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { PulseView } from '../../types'
import { addParked, isForSurface, openHandoffs, parseParkArgs, removeParked, surfaceOf } from '../lib/memory'
import { batonOf, parentOf, parkedOf, type Project } from '../lib/project'
import { isOn, type Options } from '../lib/switch'

const view = atom({ plugin: 'allan', key: 'pulse' } as const, null)
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)

export const pulseCommands = [
  { name: 'pending', description: 'What is pending here: baton, parked items with ages, open handoffs for this session. Reads the files, no model call.' },
  { name: 'park', description: 'Park a thread before you pivot: /park "what" "next step"', argumentHint: '"what" "next step"' },
  { name: 'unpark', description: 'Remove parked item n (as numbered by /pending): /unpark 2', argumentHint: '<n>' },
]

function staleDaysOf(options: Options): number {
  const v = (options as Record<string, unknown>)['pulseStaleDays']
  return typeof v === 'number' && v > 0 ? v : 7
}

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

async function readOr($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
}

async function refresh($: EngineInterface, options: Options): Promise<void> {
  if (!isOn(options, 'pulse')) {
    await update($, view, () => null)
    return
  }
  const project = await findProject($)
  if (project === null || project.memoryDir === null) {
    await update($, view, () => null)
    return
  }
  const index = await readOr($, `${project.memoryDir}/INDEX.md`)
  const handoffs = await readOr($, `${project.memoryDir}/HANDOFFS.md`)
  const session = await read($, sessionName)
  const parked = parkedOf(index, await $.clock.now())
  const surface = session === null ? '' : surfaceOf(session)
  const next: PulseView = {
    session,
    project: project.name,
    baton: batonOf(index),
    parked: parked.length,
    oldestDays: parked.reduce((m, p) => Math.max(m, p.ageDays), 0),
    staleCount: parked.filter(p => p.ageDays > staleDaysOf(options)).length,
    handoffs: openHandoffs(handoffs).filter(r => isForSurface(r, surface)).length,
  }
  await update($, view, () => next)
}

export function pulse(on: On, options: Options): void {
  // Also fires after each reload of this plugin, so the band is filled without waiting for a prompt.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await refresh($, options)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.session_title === 'string' && e.session_title !== '') await update($, sessionName, () => e.session_title ?? null)
    await refresh($, options)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.session_title === 'string' && e.session_title !== '') await update($, sessionName, () => e.session_title ?? null)
    await refresh($, options)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, options)
    return done
  })

  on('command.run', { command: 'pending' }, async $ => {
    const project = await findProject($)
    if (project === null || project.memoryDir === null) return { text: 'No Claude_Memory/INDEX.md above this folder.' }
    const index = await readOr($, `${project.memoryDir}/INDEX.md`)
    const handoffs = await readOr($, `${project.memoryDir}/HANDOFFS.md`)
    const session = await read($, sessionName)
    const parked = parkedOf(index, await $.clock.now())
    const mine = openHandoffs(handoffs).filter(r => isForSurface(r, session === null ? '' : surfaceOf(session)))
    const lines = [
      `${project.name}${session === null ? '' : ` · ${session}`}`,
      `▶ ${batonOf(index) ?? 'no baton line in INDEX.md'}`,
      '',
      parked.length === 0 ? '⏳ Nothing parked.' : `⏳ Parked (${parked.length}):`,
      ...parked.map((p, i) => `  ${i + 1}. ${p.ageDays}d · ${p.text}`),
      '',
      session === null
        ? 'Handoffs: session has no name yet (/rename it to see its handoffs).'
        : mine.length === 0 ? `No open handoffs addressed to ${surfaceOf(session)}.` : `Open handoffs for ${surfaceOf(session)} (${mine.length}):`,
      ...mine.slice(0, 15).map(r => `  ${r.id} · from ${r.from} · ${r.title}`),
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    const parsed = parseParkArgs(e.args)
    if (parsed === null) return { text: 'Usage: /park "what" "next step"' }
    const project = await findProject($)
    if (project === null || project.memoryDir === null) return { text: 'No Claude_Memory/INDEX.md above this folder.' }
    const path = `${project.memoryDir}/INDEX.md`
    const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
    const who = (await read($, sessionName)) ?? 'unnamed session'
    const line = `- ${date} · ${parsed.what}${parsed.next === '' ? '' : ` · next step: ${parsed.next}`} · (${who})`
    await $.fs.write(path, addParked(await $.fs.read(path), line))
    await refresh($, options)
    return { text: `Parked in ${project.name}/Claude_Memory/INDEX.md:\n${line}` }
  })

  on('command.run', { command: 'unpark' }, async ($, e) => {
    const n = Number.parseInt(e.args.trim(), 10)
    if (!Number.isFinite(n) || n < 1) return { text: 'Usage: /unpark <n>, numbered as /pending lists them.' }
    const project = await findProject($)
    if (project === null || project.memoryDir === null) return { text: 'No Claude_Memory/INDEX.md above this folder.' }
    const path = `${project.memoryDir}/INDEX.md`
    const done = removeParked(await $.fs.read(path), n)
    if (done === null) return { text: `There is no parked item ${n}. /pending lists them.` }
    await $.fs.write(path, done.text)
    await refresh($, options)
    return { text: `Unparked: ${done.removed}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === null || e.props.hasSurvey || !isOn(options, 'pulse')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const parts = [
      v.session ?? 'unnamed',
      v.project,
      v.baton === null ? null : `▶ ${v.baton.slice(0, 40)}`,
      v.parked === 0 ? null : `⏳ ${v.parked} parked (oldest ${v.oldestDays}d)`,
      v.handoffs === 0 ? null : `${v.handoffs} handoff${v.handoffs === 1 ? '' : 's'} for you`,
    ].filter((p): p is string => p !== null)
    return (
      <Box>
        <Text dimColor={v.staleCount === 0} color={v.staleCount > 0 ? 'yellow' : undefined}>
          {parts.join('  ·  ')}
        </Text>
      </Box>
    )
  })
}
