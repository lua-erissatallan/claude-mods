export type SessionEntry = { id: string; name: string | null; project: string; cwd: string; lastSeen: number }
export type InboxItem = { from: string; at: number; preview: string }

export const STORE_PREFIX = 'session:'
export const LIVE_MS = 12 * 3_600_000
export const FORGET_MS = 7 * 86_400_000

export function isEntry(v: unknown): v is SessionEntry {
  const o = v as Record<string, unknown> | null
  return o !== null && typeof o === 'object' && typeof o['id'] === 'string' && typeof o['project'] === 'string' && typeof o['lastSeen'] === 'number'
}

export function label(s: SessionEntry): string {
  return s.name ?? `unnamed ${s.id.slice(0, 8)}`
}

/** This project's sessions first, then the others grouped by project; the caller's own marked. */
export function listing(all: SessionEntry[], selfId: string, project: string, now: number): string {
  const live = all.filter(s => now - s.lastSeen < LIVE_MS)
  if (live.length === 0) return 'No sessions seen in the last 12 hours.'
  const projects = [...new Set(live.map(s => s.project))].sort((a, b) => (a === project ? -1 : b === project ? 1 : a.localeCompare(b)))
  const lines: string[] = []
  for (const p of projects) {
    lines.push(p === project ? `${p} (this project)` : p)
    for (const s of live.filter(x => x.project === p).sort((a, b) => b.lastSeen - a.lastSeen)) {
      const mins = Math.round((now - s.lastSeen) / 60_000)
      const ago = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`
      lines.push(`  ${label(s).padEnd(18)} ${ago.padStart(4)} ago${s.id === selfId ? '  ← this session' : ''}`)
    }
  }
  lines.push('', '/relay <name> <text|last> · another project: /relay <Project>/<name> …')
  return lines.join('\n')
}

export type Resolved = { ok: true; to: SessionEntry } | { ok: false; why: string }

/** `Name` looks in this project first, then everywhere; `Project/Name` looks in that project. Never guesses. */
export function resolve(target: string, all: SessionEntry[], selfId: string, project: string, now: number): Resolved {
  const live = all.filter(s => now - s.lastSeen < LIVE_MS && s.id !== selfId && s.name !== null)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const slash = target.indexOf('/')
  const candidates = slash > 0
    ? live.filter(s => same(s.project, target.slice(0, slash)) && same(s.name ?? '', target.slice(slash + 1)))
    : (() => {
        const here = live.filter(s => s.project === project && same(s.name ?? '', target))
        return here.length > 0 ? here : live.filter(s => same(s.name ?? '', target))
      })()
  const first = candidates[0]
  if (candidates.length === 1 && first !== undefined) return { ok: true, to: first }
  if (candidates.length === 0) return { ok: false, why: `No live session named "${target}". /sessions lists them.` }
  return { ok: false, why: `"${target}" matches ${candidates.length} sessions: ${candidates.map(s => `${s.project}/${label(s)}`).join(', ')}. Name one as <Project>/<name>.` }
}

const BLOCK = /^▼▼▼ START[^\n]*\n[\s\S]*?\n▲▲▲ END[^\n]*$/gm

/** The last START/END block of the newest reply that holds one. */
export function lastBlock(replies: string[]): string | null {
  for (let i = replies.length - 1; i >= 0; i--) {
    const found = (replies[i] ?? '').match(BLOCK)
    const last = found?.[found.length - 1]
    if (last !== undefined) return last
  }
  return null
}

export function wrap(text: string, me: string, project: string): string {
  return `[relay from ${me} · ${project}]\n${text}`
}

const HEADER = /^\[relay from (.+?) · (.+?)\]/

export function inboxItem(text: string, at: number): InboxItem {
  const m = text.match(HEADER)
  const from = m === null ? 'another session' : `${m[1]} (${m[2]})`
  const body = (m === null ? text : text.slice(m[0].length)).replace(/^\s*▼▼▼[^\n]*\n/, '').trim()
  return { from, at, preview: body.split('\n')[0]?.slice(0, 80) ?? '' }
}
