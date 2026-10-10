export type SessionEntry = { id: string; name: string | null; project: string; cwd: string; lastSeen: number; status: string; pid: number }
export type InboxItem = { from: string; at: number; preview: string }

/**
 * One file of Claude Code's own live session list (~/.claude/sessions/<pid>.json): the session's
 * id, the name given with /rename, its folder, status and last activity. Project is filled later.
 */
export function parseSessionFile(text: string): Omit<SessionEntry, 'project'> | null {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    if (typeof d['sessionId'] !== 'string' || typeof d['cwd'] !== 'string' || typeof d['pid'] !== 'number') return null
    return {
      id: d['sessionId'],
      name: typeof d['name'] === 'string' && d['name'] !== '' ? d['name'] : null,
      cwd: d['cwd'],
      lastSeen: typeof d['updatedAt'] === 'number' ? d['updatedAt'] : 0,
      status: typeof d['status'] === 'string' ? d['status'] : '',
      pid: d['pid'],
    }
  } catch {
    return null
  }
}

/** `ps -o pid= -p 1,2,3` output → the pids still running. */
export function alivePids(psOut: string): Set<number> {
  return new Set(psOut.split('\n').map(l => Number.parseInt(l.trim(), 10)).filter(Number.isFinite))
}

export function label(s: SessionEntry): string {
  return s.name ?? s.id.slice(0, 8)
}

function ago(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** This project's sessions first, then the others grouped by project; the caller's own marked. */
export function listing(all: SessionEntry[], selfId: string, project: string, now: number): string {
  if (all.length === 0) return 'No open sessions found.'
  const projects = [...new Set(all.map(s => s.project))].sort((a, b) => (a === project ? -1 : b === project ? 1 : a.localeCompare(b)))
  const lines: string[] = []
  for (const p of projects) {
    lines.push(p === project ? `${p} (this project)` : p)
    for (const s of all.filter(x => x.project === p).sort((a, b) => b.lastSeen - a.lastSeen)) {
      const state = s.status === 'busy' ? 'working' : `active ${ago(now - s.lastSeen)} ago`
      lines.push(`  ${label(s).padEnd(26)} ${state}${s.id === selfId ? '  ← this session' : ''}`)
    }
  }
  lines.push('', '/relay <name> <text|last> · another project: /relay <Project>/<name> …')
  return lines.join('\n')
}

export type Resolved = { ok: true; to: SessionEntry } | { ok: false; why: string }

/**
 * `Name` looks in this project first, then everywhere; `Project/Name` looks in that project; an id
 * prefix (6+ characters, as /sessions shows for an unnamed session) names one directly. Never guesses.
 */
export function resolve(target: string, all: SessionEntry[], selfId: string, project: string): Resolved {
  const others = all.filter(s => s.id !== selfId)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const slash = target.indexOf('/')
  const scope = slash > 0 ? others.filter(s => same(s.project, target.slice(0, slash))) : others
  const want = slash > 0 ? target.slice(slash + 1) : target
  const byName = (list: SessionEntry[]) => list.filter(s => s.name !== null && same(s.name, want))
  let candidates = slash > 0 ? byName(scope) : byName(scope.filter(s => s.project === project))
  if (candidates.length === 0 && slash < 0) candidates = byName(scope)
  if (candidates.length === 0 && /^[0-9a-f]{6,}$/i.test(want)) candidates = scope.filter(s => s.id.toLowerCase().startsWith(want.toLowerCase()))
  const first = candidates[0]
  if (candidates.length === 1 && first !== undefined) return { ok: true, to: first }
  if (candidates.length === 0) return { ok: false, why: `No open session named "${target}". /sessions lists them.` }
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

const ENVELOPE = /from-name="([^"]+)"/

export function inboxItem(text: string, at: number): InboxItem {
  const m = text.match(HEADER)
  const from = m !== null ? `${m[1]} (${m[2]})` : (text.match(ENVELOPE)?.[1] ?? 'another session')
  const body = (m === null ? text : text.slice(m[0].length)).replace(/^\s*▼▼▼[^\n]*\n/, '').trim()
  return { from, at, preview: body.split('\n')[0]?.slice(0, 80) ?? '' }
}
