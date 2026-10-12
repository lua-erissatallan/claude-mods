export type Version = { version: number; status: string; message: string }

/** `lua version list --json`: an array of `{ version, status, message, createdAt, … }`, newest first. */
export function parseVersions(stdout: string): Version[] | null {
  const start = stdout.indexOf('[')
  if (start < 0) return null
  try {
    const raw = JSON.parse(stdout.slice(start, stdout.lastIndexOf(']') + 1)) as unknown
    if (!Array.isArray(raw)) return null
    return raw
      .map(v => v as Record<string, unknown>)
      .filter(v => typeof v['version'] === 'number')
      .map(v => ({ version: Number(v['version']), status: String(v['status'] ?? ''), message: String(v['message'] ?? '') }))
  } catch {
    return null
  }
}

export type AgentPlan = {
  dir: string
  name: string
  active: number | null
  next: number | null
  nextMessage: string
  count: number
  /** Versions to delete after the promote, oldest first, to get back under the cap. */
  prune: number[]
}

/** What /promote would do for one agent: the newest staged version above the active one, and the prune list. */
export function planFor(dir: string, versions: Version[], cap: number): AgentPlan {
  const name = dir.slice(dir.lastIndexOf('/') + 1)
  const live = versions.filter(v => v.status !== 'deleted')
  const active = live.find(v => v.status === 'active')?.version ?? null
  const staged = live.filter(v => v.status === 'staged' && (active === null || v.version > active)).sort((a, b) => b.version - a.version)
  const next = staged[0] ?? null
  // After the promote the count grows by nothing (the staged version already counts); prune the oldest
  // superseded ones past the cap, never the active one, never the one about to go live.
  const over = Math.max(0, live.length - cap)
  const prune = live
    .filter(v => v.status === 'superseded' && v.version !== active && v.version !== next?.version)
    .sort((a, b) => a.version - b.version)
    .slice(0, over)
    .map(v => v.version)
  return { dir, name, active, next: next?.version ?? null, nextMessage: next?.message.slice(0, 80) ?? '', count: live.length, prune }
}

export function techLine(date: string, plan: AgentPlan, pruned: number[], by: string): string {
  const tail = pruned.length === 0 ? '' : `; pruned v${pruned.join(', v')}`
  return `- ${date} · ${plan.name}: promoted v${plan.next ?? '?'} (was v${plan.active ?? '?'})${tail} · via /promote (${by})`
}

/** Appends a dated line under a "## Releases" heading in TECH.md, creating the heading at the end if absent. */
export function addTechLine(tech: string, line: string): string {
  const heading = '## Releases'
  const at = tech.indexOf(heading)
  if (at < 0) return `${tech.replace(/\s*$/, '')}\n\n${heading}\n> Written by the release mod on each /promote.\n${line}\n`
  const afterHeading = tech.indexOf('\n', at) + 1
  // Insert after the heading's note lines (lines starting with >) so the newest line comes first.
  let cursor = afterHeading
  for (;;) {
    const end = tech.indexOf('\n', cursor)
    const l = tech.slice(cursor, end < 0 ? undefined : end)
    if (!l.startsWith('>')) break
    if (end < 0) { cursor = tech.length; break }
    cursor = end + 1
  }
  return `${tech.slice(0, cursor)}${line}\n${tech.slice(cursor)}`
}
