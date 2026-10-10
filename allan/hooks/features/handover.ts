import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { alertFor, alertText, closeChecks, emptySections, forkPrompt, handoverDoc, isLead, kickoff, localDate, sectionsFrom, thresholdsOf } from '../lib/handover'
import { parentOf, parkedOf, type Project } from '../lib/project'
import { isOn, textOf, type Options } from '../lib/switch'

// The session name pulse records from the classic hooks; the thresholds already alerted.
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)
const fired = atom({ plugin: 'allan', key: 'handoverFired' } as const, [])

export const handoverCommands = [
  { name: 'handover', description: 'Write Claude_Memory/HANDOVER_<successor>.md from this session and copy the kickoff prompt: /handover Code-4', argumentHint: '<successor> [--force]' },
  { name: 'close', description: 'Before closing this session: git clean, INDEX and HANDOFFS updated today, nothing of yours parked too long.' },
]

function blocksAutoCompact(options: Options): boolean {
  return (options as Record<string, unknown>)['handoverBlockAutoCompact'] !== false
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

async function today($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  return localDate(now, new Date(now).getTimezoneOffset())
}

async function writeHandover($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const force = words.includes('--force')
  const successor = words.find(w => w !== '--force')
  if (successor === undefined || !/^[A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*$/.test(successor)) {
    return 'Usage: /handover <successor>, for example /handover Code-4'
  }

  const cwd = await $.session.cwd()
  const project = await findProject($)
  const root = project?.root ?? cwd
  const dir = project?.memoryDir ?? root
  const file = `${dir}/HANDOVER_${successor}.md`
  const shown = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
  if (!force && (await $.fs.exists(file))) return `${shown} already exists. /handover ${successor} --force replaces it.`

  const me = (await read($, sessionName)) ?? 'this session'
  const reply = await $.model.fork({ prompt: forkPrompt(successor, me) })
  const drafted = reply.isAnswered ? sectionsFrom(reply.text) : null
  const usage = await $.session.usage()
  await $.fs.write(file, handoverDoc({
    me,
    successor,
    date: await today($),
    sessionId: await $.session.id(),
    percent: usage.context.percent ?? null,
    sections: drafted ?? emptySections(),
  }))

  const prompt = kickoff({ me, successor, project: project?.name ?? root.slice(root.lastIndexOf('/') + 1), root, file: shown })
  const copied = (await $.ui.copy({ text: prompt })).isCopied
  const how = drafted !== null
    ? 'Sections drafted from this session; read it and fix anything wrong before you close.'
    : `The model did not draft it (${reply.isAnswered ? 'its reply lacked the four headings' : reply.reason}): the file has empty headings to fill.`
  return [
    `Wrote ${shown}. ${how}`,
    copied ? 'Kickoff prompt copied to the clipboard:' : 'Kickoff prompt (copy it by hand):',
    '',
    prompt,
    '',
    `Start ${successor} with /rename ${successor}, paste the prompt, then /close here.`,
  ].join('\n')
}

async function gitPorcelain($: EngineInterface, dir: string): Promise<string | null> {
  const r = await $.process.run(['git', '-C', dir, 'status', '--porcelain'])
  return r.exitCode === 0 ? r.stdout : null
}

async function close($: EngineInterface, options: Options): Promise<string> {
  const project = await findProject($)
  const root = project?.root ?? (await $.session.cwd())
  const day = await today($)
  const modified: Record<string, string | null> = {}
  let index = ''
  for (const name of ['INDEX.md', 'HANDOFFS.md']) {
    const path = project?.memoryDir == null ? null : `${project.memoryDir}/${name}`
    if (path === null || !(await $.fs.exists(path))) {
      modified[name] = null
      continue
    }
    const stat = await $.fs.stat(path)
    modified[name] = localDate(stat.mtimeMs, new Date(stat.mtimeMs).getTimezoneOffset())
    if (name === 'INDEX.md') index = await $.fs.read(path)
  }
  const stale = (options as Record<string, unknown>)['pulseStaleDays']
  const checks = closeChecks({
    porcelain: await gitPorcelain($, root),
    today: day,
    modified,
    parked: parkedOf(index, await $.clock.now()),
    session: await read($, sessionName),
    staleDays: typeof stale === 'number' && stale > 0 ? stale : 7,
  })
  const missing = checks.filter(c => !c.ok).length
  return [
    ...checks.map(c => `${c.ok ? '✔' : '✘'} ${c.line}`),
    '',
    missing === 0 ? 'Safe to close.' : `Not yet: ${missing} item${missing === 1 ? '' : 's'} above.`,
  ].join('\n')
}

export function handover(on: On, options: Options): void {
  on('session.measure', async ($, e, next) => {
    const done = await next(e)
    if (!isOn(options, 'handover') || !e.changed.includes('context')) return done
    const percent = e.context.percent
    if (percent === undefined) return done
    const thresholds = thresholdsOf(textOf(options, 'handoverThresholds', '60,70,80,90'))
    // Quiet until the first threshold; cleared again after a compaction brings it back under.
    $.ui.status(percent >= (thresholds[0] ?? 0) ? `ctx ${percent}%` : undefined)
    const result = alertFor(percent, thresholds, await read($, fired))
    await update($, fired, () => result.fired)
    if (result.alert !== null) $.ui.toast(alertText(percent, result.alert, thresholds))
    return done
  })

  // Lead sessions hand over instead of compacting away what they know. Manual /compact still runs.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (!isOn(options, 'handover') || !blocksAutoCompact(options) || e.agentId !== undefined) return next(e)
    const name = await read($, sessionName)
    if (!isLead(name, textOf(options, 'handoverLeadPattern', '^(Orchestrator|Lead|Code)'))) return next(e)
    $.ui.toast('Auto compaction skipped for a lead session: /handover <successor>, or /compact to compact anyway.')
    return { skip: `${name} is a lead session: hand over (/handover <successor>) or run /compact yourself.` }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'handover' }, async ($, e) => ({ text: await writeHandover($, e.args) }))

  on('command.run', { command: 'close' }, async $ => ({ text: await close($, options) }))
}
