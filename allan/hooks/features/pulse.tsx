import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { PulseHandoffItem, PulseParkedItem, PulseSelection, PulseView } from '../../types'
import { STORE_PREFIX, type SessionEntry } from '../lib/relay'
import { addParked, isForSurface, openHandoffs, parseParkArgs, removeParked, surfaceOf } from '../lib/memory'
import { batonOf, parentOf, parkedOf, type Project } from '../lib/project'
import { isOn, type Options } from '../lib/switch'

const PANE = 'allan-pulse'
const view = atom({ plugin: 'allan', key: 'pulse' } as const, null)
const sessionName = atom({ plugin: 'allan', key: 'session' } as const, null)
const parkedItems = atom({ plugin: 'allan', key: 'parkedItems' } as const, [])
const handoffItems = atom({ plugin: 'allan', key: 'handoffItems' } as const, [])
const selected = atom({ plugin: 'allan', key: 'selected' } as const, null)
// Messages other sessions relayed here (relay.ts records them).
const inbox = atom({ plugin: 'allan', key: 'inbox' } as const, [])

const PARKED_HOTKEYS = '123456789'
const LIST: PulseSelection = { kind: 'parkedList', index: 0 }

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
    await update($, parkedItems, () => [])
    await update($, handoffItems, () => [])
    return
  }
  const project = await findProject($)
  if (project === null || project.memoryDir === null) {
    await update($, view, () => null)
    await update($, parkedItems, () => [])
    await update($, handoffItems, () => [])
    return
  }
  const index = await readOr($, `${project.memoryDir}/INDEX.md`)
  const handoffs = await readOr($, `${project.memoryDir}/HANDOFFS.md`)
  const session = await read($, sessionName)
  const parked = parkedOf(index, await $.clock.now())
  const surface = session === null ? '' : surfaceOf(session)
  const mine = openHandoffs(handoffs).filter(r => isForSurface(r, surface))

  const nextView: PulseView = {
    session,
    project: project.name,
    baton: batonOf(index),
    parked: parked.length,
    oldestDays: parked.reduce((m, p) => Math.max(m, p.ageDays), 0),
    staleCount: parked.filter(p => p.ageDays > staleDaysOf(options)).length,
    handoffs: mine.length,
  }
  const nextParked: PulseParkedItem[] = parked.map((p, i) => ({ index: i + 1, ...p }))
  const nextHandoffs: PulseHandoffItem[] = mine.map((r, i) => ({ index: i + 1, ...r }))

  await update($, view, () => nextView)
  await update($, parkedItems, () => nextParked)
  await update($, handoffItems, () => nextHandoffs)

  // A selection pointing at an item that no longer exists (unparked, or the list shrank) is dropped.
  const current = await read($, selected)
  if (current?.kind === 'parked' && current.index > nextParked.length) await update($, selected, () => null)
  if (current?.kind === 'handoff' && current.index > nextHandoffs.length) await update($, selected, () => null)
}

/** Puts this session in the cross-session registry relay reads (/sessions, /relay). */
async function record($: EngineInterface, options: Options): Promise<void> {
  if (!isOn(options, 'relay')) return
  const id = await $.session.id()
  const cwd = await $.session.cwd()
  const project = await findProject($)
  const entry: SessionEntry = {
    id,
    name: await read($, sessionName),
    project: project?.name ?? cwd.slice(cwd.lastIndexOf('/') + 1),
    cwd,
    lastSeen: await $.clock.now(),
  }
  await $.store.set(`${STORE_PREFIX}${id}`, entry)
}

async function doUnpark($: EngineInterface, options: Options, n: number): Promise<string> {
  const project = await findProject($)
  if (project === null || project.memoryDir === null) return 'No Claude_Memory/INDEX.md above this folder.'
  const path = `${project.memoryDir}/INDEX.md`
  const done = removeParked(await $.fs.read(path), n)
  if (done === null) return `There is no parked item ${n}. /pending lists them.`
  await $.fs.write(path, done.text)
  await refresh($, options)
  if ((await read($, selected))?.kind === 'parked') await update($, selected, () => LIST)
  return `Unparked: ${done.removed}`
}

export function pulse(on: On, options: Options): void {
  // Also fires after each reload of this plugin, so the band is filled without waiting for a prompt.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await refresh($, options)
    try { await record($, options) } catch { /* the registry is a convenience */ }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.session_title === 'string' && e.session_title !== '') await update($, sessionName, () => e.session_title ?? null)
    await refresh($, options)
    try { await record($, options) } catch { /* the registry is a convenience */ }
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.session_title === 'string' && e.session_title !== '') await update($, sessionName, () => e.session_title ?? null)
    await refresh($, options)
    try { await record($, options) } catch { /* the registry is a convenience */ }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, options)
    try { await record($, options) } catch { /* the registry is a convenience */ }
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
    return { text: await doUnpark($, options, n) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === null || e.props.hasSurvey || !isOn(options, 'pulse')) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const handoffs = await read($, handoffItems)
    const received = await read($, inbox)

    const parts = [
      v.session ?? 'unnamed',
      v.project,
      v.baton === null ? null : `▶ ${v.baton.slice(0, 40)}`,
    ].filter((p): p is string => p !== null)

    const openOn = (target: PulseSelection) => async () => {
      await update($, selected, () => target)
      void $.ui.open({ id: PANE, title: 'Pulse' })
    }

    // One line: the details live in the pane, opened with p (parked) or h (handoffs).
    const stale = v.staleCount > 0
    return (
      <Box>
        <Text dimColor>{parts.join('  ·  ')}</Text>
        {v.parked > 0 && <Text dimColor>  ·  </Text>}
        {v.parked > 0 && (
          <Button key="parked" hotkey="p" dimColor={!stale} onPress={openOn(LIST)}>
            <Text color={stale ? 'yellow' : undefined}>p:⏳ {v.parked} parked (oldest {v.oldestDays}d)</Text>
          </Button>
        )}
        {handoffs.length > 0 && <Text dimColor>  ·  </Text>}
        {handoffs.length > 0 && (
          <Button key="handoffs" hotkey="h" dimColor onPress={openOn({ kind: 'handoff', index: 1 })}>
            h:{handoffs.length === 1 ? handoffs[0]?.id : `${handoffs.length} handoffs`}
          </Button>
        )}
        {received.length > 0 && <Text dimColor>  ·  </Text>}
        {received.length > 0 && (
          <Button key="inbox" hotkey="i" onPress={openOn({ kind: 'inbox', index: 0 })}>
            <Text color="cyan">i:✉ {received.length} from {received[received.length - 1]?.from}</Text>
          </Button>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const sel = await read($, selected)
    const parked = await read($, parkedItems)
    const handoffs = await read($, handoffItems)
    const close = async () => { await update($, selected, () => null) }

    if (sel === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Press p (parked), h (handoffs) or i (inbox) in the band to see them here.</Text>
        </Box>
      )
    }

    if (sel.kind === 'inbox') {
      const received = await read($, inbox)
      if (received.length === 0) return <Text dimColor>Inbox empty.</Text>
      return (
        <Box flexDirection="column">
          <Text bold>✉ Relayed to this session ({received.length})</Text>
          {received.map((m, i) => (
            <Text key={`m${i}`}>{new Date(m.at).toISOString().slice(11, 16)} · {m.from} · {m.preview}</Text>
          ))}
          <Box>
            <Button key="clear" variant="primary" onPress={async () => { await update($, inbox, () => []); await close() }}>Clear</Button>
            <Button role="dismiss" onPress={close}>Close</Button>
          </Box>
        </Box>
      )
    }

    if (sel.kind === 'parkedList') {
      if (parked.length === 0) return <Text dimColor>Nothing parked.</Text>
      return (
        <Box flexDirection="column">
          <Text bold>⏳ Parked ({parked.length}): press a number</Text>
          {parked.map(p => (
            <Button key={`p${p.index}`} hotkey={PARKED_HOTKEYS[p.index - 1]} onPress={async () => { await update($, selected, () => ({ kind: 'parked' as const, index: p.index })) }}>
              {p.index}. {p.ageDays}d · {p.text.slice(0, 70)}
            </Button>
          ))}
          <Button role="dismiss" onPress={close}>Close</Button>
        </Box>
      )
    }

    if (sel.kind === 'parked') {
      const item = parked.find(p => p.index === sel.index)
      if (item === undefined) return <Text dimColor>That parked item is gone.</Text>
      return (
        <Box flexDirection="column">
          <Text bold>Parked, {item.ageDays} days ago ({item.date})</Text>
          <Text>{item.text}</Text>
          <Box>
            <Button key="back" hotkey="b" onPress={async () => { await update($, selected, () => LIST) }}>b:Back</Button>
            <Button variant="primary" onPress={async () => { await doUnpark($, options, item.index) }}>
              Unpark
            </Button>
            <Button role="dismiss" onPress={close}>Close</Button>
          </Box>
        </Box>
      )
    }

    const item = handoffs.find(row => row.index === sel.index)
    if (item === undefined) return <Text dimColor>That handoff is gone.</Text>
    const step = (by: number) => async () => {
      const n = ((item.index - 1 + by + handoffs.length) % handoffs.length) + 1
      await update($, selected, () => ({ kind: 'handoff' as const, index: n }))
    }
    return (
      <Box flexDirection="column">
        <Text bold>{item.id}</Text>
        <Text dimColor>from {item.from} → {item.to}  ·  {item.index} of {handoffs.length}</Text>
        <Text>{item.title}</Text>
        <Box>
          {handoffs.length > 1 && (
            <Button key="prev" hotkey="p" onPress={step(-1)}>p:Prev</Button>
          )}
          {handoffs.length > 1 && (
            <Button key="next" hotkey="n" onPress={step(1)}>n:Next</Button>
          )}
          <Button role="dismiss" onPress={close}>Close</Button>
        </Box>
      </Box>
    )
  })
}
