import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ReleaseAgent } from '../../types'
import { joinPath, parseModsConfig } from '../lib/config'
import { parentOf, type Project } from '../lib/project'
import { addTechLine, parseVersions, planFor, techLine } from '../lib/release'
import { isOn, type Options } from '../lib/switch'

const PANE = 'allan-release'
const plan = atom({ plugin: 'allan', key: 'releasePlan' } as const, null)
const log = atom({ plugin: 'allan', key: 'releaseLog' } as const, [])
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)

export const releaseCommands = [
  { name: 'promote', description: 'Promote the newest staged version of this agent and its paired agents, from a pane with one Promote button per agent. Refuses on a dirty git tree.' },
]

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

/** The Claude_Memory folder at or above `dir`, if any. */
async function memoryAbove($: EngineInterface, dir: string): Promise<string | null> {
  let at: string | null = dir
  while (at !== null) {
    if (await $.fs.exists(`${at}/Claude_Memory/INDEX.md`)) return `${at}/Claude_Memory`
    at = parentOf(at)
  }
  return null
}

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null
}

async function lua($: EngineInterface, dir: string, args: string[], confirmed = false): Promise<{ ok: boolean; out: string }> {
  const r = await $.process.run(['lua', ...args], { cwd: dir, timeoutMs: 120_000, env: confirmed ? { LUA_DEPLOY_CONFIRMED: '1' } : {} })
  const out = `${r.stdout}\n${r.stderr}`.trim()
  return { ok: r.exitCode === 0, out }
}

async function prepare($: EngineInterface): Promise<string> {
  const project = await findProject($)
  if (project === null) return 'No lua.skill.yaml or Claude_Memory above this folder.'
  const config = parseModsConfig(await readOr($, `${project.root}/.claude-mods.json`))
  const agentDir = config.agent === null ? project.root : joinPath(project.root, config.agent)
  if (!(await $.fs.exists(`${agentDir}/lua.skill.yaml`))) return `No lua.skill.yaml in ${agentDir}. Set "agent" in ${project.root}/.claude-mods.json to the agent folder.`

  const status = await $.process.run(['git', '-C', project.root, 'status', '--porcelain'])
  if (status.exitCode === 0 && status.stdout.trim() !== '') {
    const n = status.stdout.trim().split('\n').length
    return `Refused: ${n} uncommitted path${n === 1 ? '' : 's'} in ${project.root}. Commit first; the promote should match a commit.`
  }

  const dirs = [agentDir, ...config.pairs.map(p => joinPath(agentDir, p))]
  const agents: ReleaseAgent[] = []
  for (const dir of dirs) {
    if (!(await $.fs.exists(`${dir}/lua.skill.yaml`))) {
      agents.push({ dir, name: dir.slice(dir.lastIndexOf('/') + 1), active: null, next: null, nextMessage: '', count: 0, prune: [], error: 'no lua.skill.yaml here', done: false })
      continue
    }
    const listed = await lua($, dir, ['version', 'list', '--json', '--all'])
    const versions = listed.ok ? parseVersions(listed.out) : null
    if (versions === null) {
      agents.push({ dir, name: dir.slice(dir.lastIndexOf('/') + 1), active: null, next: null, nextMessage: '', count: 0, prune: [], error: `lua version list failed: ${listed.out.slice(0, 120)}`, done: false })
      continue
    }
    agents.push({ ...planFor(dir, versions, config.versionCap), error: null, done: false })
  }
  await update($, plan, () => agents)
  await update($, log, () => [])
  void $.ui.open({ id: PANE, title: 'Promote', focus: true })
  const lines = agents.map(a => a.error !== null ? `  ${a.name}: ${a.error}` : a.next === null ? `  ${a.name}: nothing staged above v${a.active ?? '?'}` : `  ${a.name}: v${a.active ?? '?'} → v${a.next}${a.prune.length > 0 ? ` (then prune v${a.prune.join(', v')})` : ''}`)
  return ['Promote plan (press the button in the pane; nothing runs until you do):', ...lines].join('\n')
}

async function promoteOne($: EngineInterface, index: number): Promise<void> {
  const agents = (await read($, plan)) ?? []
  const agent = agents[index]
  if (agent === undefined || agent.next === null || agent.done) return
  const say = async (line: string) => { await update($, log, l => [...l, line].slice(-30)) }
  await say(`${agent.name}: promoting v${agent.next}…`)
  const promoted = await lua($, agent.dir, ['version', 'promote', String(agent.next)], true)
  if (!promoted.ok) {
    await say(`${agent.name}: promote FAILED: ${promoted.out.slice(0, 200)}`)
    $.ui.toast(`${agent.name}: promote failed. See the Promote pane.`)
    return
  }
  await say(`${agent.name}: v${agent.next} is live.`)
  const pruned: number[] = []
  for (const v of agent.prune) {
    const gone = await lua($, agent.dir, ['version', 'delete', String(v), '--force'], true)
    if (gone.ok) pruned.push(v)
    else await say(`${agent.name}: could not delete v${v}: ${gone.out.slice(0, 120)}`)
  }
  if (pruned.length > 0) await say(`${agent.name}: pruned v${pruned.join(', v')}.`)
  try {
    const memory = await memoryAbove($, agent.dir)
    if (memory !== null) {
      const path = `${memory}/TECH.md`
      const tech = (await readOr($, path)) ?? ''
      const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
      await $.fs.write(path, addTechLine(tech, techLine(date, agent, pruned, (await read($, sessionName)) ?? 'unnamed session')))
      await say(`${agent.name}: noted in ${path.replace(/^.*\/Claude_Memory/, 'Claude_Memory')}.`)
    }
  } catch { await say(`${agent.name}: could not write TECH.md (promote stands).`) }
  await update($, plan, list => (list ?? []).map((a, i) => (i === index ? { ...a, done: true, active: a.next, next: null } : a)))
  $.ui.toast(`${agent.name}: v${agent.next} promoted. Run lua version list to confirm.`)
}

export function release(on: On, options: Options): void {
  on('command.run', { command: 'promote' }, async $ => {
    if (!isOn(options, 'release')) return { text: 'release is off (/mods on release).' }
    return { text: await prepare($) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const agents = (await read($, plan)) ?? []
    const lines = await read($, log)
    return (
      <Box flexDirection="column">
        <Text bold>Promote (each button runs lua version promote with LUA_DEPLOY_CONFIRMED=1)</Text>
        {agents.map((a, i) => (
          <Box key={`a${i}`}>
            {a.error !== null && <Text color="red">{a.name}: {a.error}</Text>}
            {a.error === null && a.done && <Text color="green">{a.name}: v{a.active} live ✔</Text>}
            {a.error === null && !a.done && a.next === null && <Text dimColor>{a.name}: nothing staged above v{a.active ?? '?'}</Text>}
            {a.error === null && !a.done && a.next !== null && (
              <Button key={`promote${i}`} variant="primary" onPress={async () => { await promoteOne($, i) }}>
                Promote {a.name} v{a.active ?? '?'} → v{a.next}{a.prune.length > 0 ? ` (prune ${a.prune.length})` : ''}
              </Button>
            )}
            {a.error === null && !a.done && a.next !== null && <Text dimColor>  {a.nextMessage}</Text>}
          </Box>
        ))}
        {lines.map((l, i) => <Text key={`l${i}`} dimColor>{l}</Text>)}
        <Button role="dismiss" onPress={async () => { await update($, plan, () => null) }}>Close</Button>
      </Box>
    )
  })
}
