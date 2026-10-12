export type LogEntry = { id: string; at: string; message: string; isError: boolean; isBlock: boolean; isBypass: boolean }
export type Counts = { errors: number; blocks: number; bypass: number }
export type Level = 'green' | 'amber' | 'red'
export type Sample = { at: number; errors: number; blocks: number; bypass: number }
export type Lease = { sessionId: string; expiresAt: number }

const BYPASS = /fail open|GATE BYPASSED/i
const BLOCK = /Preprocessor result[^\n]*["']action["']\s*:\s*["']block["']/

/** `lua logs --ci --json`: `{ logs: [{ id, timestamp, type, subType, message, metadata: { logSource } }], … }`. */
export function parseLogs(stdout: string): LogEntry[] | null {
  const start = stdout.indexOf('{')
  if (start < 0) return null
  try {
    const raw = JSON.parse(stdout.slice(start, stdout.lastIndexOf('}') + 1)) as Record<string, unknown>
    const list = Array.isArray(raw['logs']) ? raw['logs'] : Array.isArray(raw) ? (raw as unknown[]) : null
    if (list === null) return null
    return list
      .map(l => l as Record<string, unknown>)
      .filter(l => typeof l['id'] === 'string' || typeof l['_id'] === 'string')
      .map(l => {
        const meta = (l['metadata'] ?? {}) as Record<string, unknown>
        const message = typeof l['message'] === 'string' ? l['message'] : JSON.stringify(l['message'] ?? '')
        const source = String(meta['logSource'] ?? '')
        const sub = String(l['subType'] ?? '')
        return {
          id: String(l['id'] ?? l['_id']),
          at: String(l['timestamp'] ?? ''),
          message,
          isError: source === 'agent_error' || sub === 'error' || String(l['type']) === 'error',
          isBlock: BLOCK.test(message),
          isBypass: BYPASS.test(message),
        }
      })
  } catch {
    return null
  }
}

export function count(entries: LogEntry[]): Counts {
  return {
    errors: entries.filter(e => e.isError).length,
    blocks: entries.filter(e => e.isBlock).length,
    bypass: entries.filter(e => e.isBypass).length,
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

/** Red: a gate bypassed, a check failed, or errors well above the week's usual. Amber: more errors than usual, or blocks. */
export function levelOf(c: Counts, usual: number, failedChecks: string[]): Level {
  if (c.bypass > 0 || failedChecks.length > 0 || c.errors >= Math.max(5, usual * 3)) return 'red'
  if ((c.errors > 0 && c.errors > usual) || c.blocks > 0) return 'amber'
  return 'green'
}

export function describe(c: Counts, level: Level, failedChecks: string[]): string {
  const parts = [
    c.errors > 0 ? `${c.errors} error${c.errors === 1 ? '' : 's'}` : null,
    c.blocks > 0 ? `${c.blocks} blocked by a preprocessor` : null,
    c.bypass > 0 ? `${c.bypass} fail open / gate bypassed` : null,
    failedChecks.length > 0 ? `checks failing: ${failedChecks.join(', ')}` : null,
  ].filter((p): p is string => p !== null)
  return parts.length === 0 ? (level === 'green' ? 'quiet' : level) : parts.join(', ')
}

/** Whether this session may watch the project now, and the lease to store if so. */
export function takeLease(stored: unknown, selfId: string, now: number, intervalMs: number): Lease | null {
  const s = stored as Lease | null | undefined
  if (s !== null && s !== undefined && typeof s['sessionId'] === 'string' && typeof s['expiresAt'] === 'number' && s.sessionId !== selfId && s.expiresAt > now) return null
  return { sessionId: selfId, expiresAt: now + intervalMs * 2 + 30_000 }
}

/** Keeps a week of samples, newest last. */
export function keepWeek(samples: Sample[], now: number): Sample[] {
  return samples.filter(s => now - s.at < 7 * 86_400_000).slice(-2000)
}

export const WATCH_PREFIX = 'watch:'
