import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { WatchLight } from '../../types'
import { joinPath, parseModsConfig } from '../lib/config'
import { parentOf, type Project } from '../lib/project'
import { count, describe, keepWeek, levelOf, median, parseLogs, takeLease, WATCH_PREFIX, type Sample } from '../lib/watch'
import { isOn, type Options } from '../lib/switch'

// The light pulse draws in the band, and what /logs reports since it was last run.
const light = atom({ plugin: 'allan', key: 'watchLight' } as const, null)
const unseen = atom({ plugin: 'allan', key: 'watchUnseen' } as const, { errors: 0, blocks: 0, bypass: 0, since: null })
const recent = atom({ plugin: 'allan', key: 'watchRecent' } as const, [])

export const watchCommands = [
  { name: 'logs', description: 'What watch saw in the agent logs since you last asked: errors, preprocessor blocks, gate bypasses, failing checks.' },
]

let timer: Timer | null = null
let first: Timer | null = null

function intervalMs(options: Options): number {
  const v = (options as Record<string, unknown>)['watchIntervalMin']
  return (typeof v === 'number' && v >= 1 ? v : 10) * 60_000
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

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null
}

/** One look at the logs and checks. Cheap: one page of 100 lines, one process per check. */
async function tick($: EngineInterface, options: Options): Promise<void> {
  if (!isOn(options, 'watch')) return
  const project = await findProject($)
  if (project === null) return
  const config = parseModsConfig(await readOr($, `${project.root}/.claude-mods.json`))
  const agentDir = config.agent === null ? project.root : joinPath(project.root, config.agent)
  if (!(await $.fs.exists(`${agentDir}/lua.skill.yaml`))) return

  const now = await $.clock.now()
  const selfId = await $.session.id()
  const leaseKey = `${WATCH_PREFIX}${project.root}`
  const lease = takeLease(await $.store.get(leaseKey), selfId, now, intervalMs(options))
  if (lease === null) return
  await $.store.set(leaseKey, lease)

  const markKey = `${WATCH_PREFIX}mark:${project.root}`
  const seenKey = `${WATCH_PREFIX}seen:${project.root}`
  const historyKey = `${WATCH_PREFIX}history:${project.root}`
  const mark = await $.store.get(markKey)
  const since = typeof mark === 'string' && mark !== '' ? mark : '1h'
  const r = await $.process.run(['lua', 'logs', '--ci', '--json', '--limit', '100', '--since', since], { cwd: agentDir, timeoutMs: 60_000 })
  const entries = r.exitCode === 0 ? parseLogs(r.stdout) : null
  if (entries === null) {
    await update($, light, () => ({ level: 'amber', text: `lua logs failed: ${(r.stderr || r.stdout).trim().slice(0, 80)}`, at: now, project: project.name }))
    return
  }
  const seenRaw = await $.store.get(seenKey)
  const seen = new Set(Array.isArray(seenRaw) ? (seenRaw as string[]) : [])
  const fresh = entries.filter(e => !seen.has(e.id))
  await $.store.set(seenKey, [...seen, ...fresh.map(e => e.id)].slice(-400))
  const newest = entries.map(e => e.at).filter(a => a !== '').sort().pop()
  if (newest !== undefined) await $.store.set(markKey, newest)

  const c = count(fresh)
  const historyRaw = await $.store.get(historyKey)
  const history = keepWeek(Array.isArray(historyRaw) ? (historyRaw as Sample[]) : [], now)
  const usual = median(history.map(s => s.errors))
  await $.store.set(historyKey, [...history, { at: now, ...c }])

  const failed: string[] = []
  for (const check of config.checks) {
    try {
      const run = await $.process.run(['sh', '-c', check.command], { cwd: project.root, timeoutMs: 60_000 })
      if (run.exitCode !== 0) failed.push(check.name)
    } catch {
      failed.push(check.name)
    }
  }

  const level = levelOf(c, usual, failed)
  const text = describe(c, level, failed)
  const before = await read($, light)
  await update($, light, () => ({ level, text, at: now, project: project.name }))
  await update($, unseen, u => ({ errors: u.errors + c.errors, blocks: u.blocks + c.blocks, bypass: u.bypass + c.bypass, since: u.since ?? now }))
  const lines = fresh.filter(e => e.isError || e.isBypass || e.isBlock).map(e => `${e.at.slice(11, 19)} ${e.message.slice(0, 160)}`)
  if (lines.length > 0) await update($, recent, l => [...l, ...lines].slice(-10))
  if (level !== 'green' && before?.level !== level) $.ui.toast(`watch ${level === 'red' ? '🔴' : '🟡'} ${project.name}: ${text}. /logs for the lines.`)
}

async function report($: EngineInterface, options: Options): Promise<string> {
  const l = await read($, light)
  if (l === null) {
    return isOn(options, 'watch')
      ? 'watch has not looked yet (it runs every ' + String(intervalMs(options) / 60_000) + ' min in a folder with lua.skill.yaml, or set "agent" in .claude-mods.json).'
      : 'watch is off (/mods on watch).'
  }
  const u = await read($, unseen)
  const lines = await read($, recent)
  const dot = l.level === 'green' ? '🟢' : l.level === 'amber' ? '🟡' : '🔴'
  const out = [
    `${dot} ${l.project}: ${l.text} (last look ${new Date(l.at).toISOString().slice(11, 16)} UTC)`,
    u.since === null ? 'Nothing new since you last asked.' : `Since ${new Date(u.since).toISOString().slice(11, 16)} UTC: ${u.errors} errors, ${u.blocks} blocks, ${u.bypass} bypass lines.`,
    ...(lines.length > 0 ? ['', 'Recent lines:', ...lines.map(x => `  ${x}`)] : []),
  ]
  await update($, unseen, () => ({ errors: 0, blocks: 0, bypass: 0, since: null }))
  await update($, recent, () => [])
  return out.join('\n')
}

export function watch(on: On, options: Options): void {
  // Starts (or restarts, after a reload) the timer; a surface is set on every session a person sits at.
  on('session.start', { surface: /terminal|desktop|vscode|mobile/ }, async ($, e, next) => {
    timer?.cancel()
    first?.cancel()
    timer = null
    first = null
    if (isOn(options, 'watch') && e.isInteractive) {
      const safely = () => { tick($, options).catch(() => { /* the light is a convenience; the next tick tries again */ }) }
      first = $.clock.after(15_000, safely)
      timer = $.clock.every(intervalMs(options), safely)
    }
    return next(e)
  })

  on('command.run', { command: 'logs' }, async $ => ({ text: await report($, options) }))
}
