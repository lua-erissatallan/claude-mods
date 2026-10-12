/**
 * `<project>/.claude-mods.json`, read by release, watch, testguard and outbox. Every field is optional:
 * {
 *   "agent": "Customer_Qualification_Agent",      // the lua agent folder, when it is not the project root
 *   "pairs": ["../jackfruit-lead-agent"],          // agents promoted together with this one
 *   "versionCap": 95,                              // prune the oldest versions past this count
 *   "checks": { "neon": "node scripts/db-ping.mjs", "canary": "node scripts/invariant-canary.mjs --quiet" },
 *   "protected": ["drew@example.com"],             // never messaged while /testmode is on
 *   "contacts": ["Drew", "Kiri"]                   // people whose drafts outbox keeps
 * }
 */
export type ModsConfig = {
  agent: string | null
  pairs: string[]
  versionCap: number
  checks: Array<{ name: string; command: string }>
  protected: string[]
  contacts: string[]
}

export const DEFAULT_VERSION_CAP = 95

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])

export function parseModsConfig(text: string | null): ModsConfig {
  const empty: ModsConfig = { agent: null, pairs: [], versionCap: DEFAULT_VERSION_CAP, checks: [], protected: [], contacts: [] }
  if (text === null || text.trim() === '') return empty
  let d: Record<string, unknown>
  try {
    d = JSON.parse(text) as Record<string, unknown>
  } catch {
    return empty
  }
  if (d === null || typeof d !== 'object') return empty
  const cap = d['versionCap']
  const checksRaw = d['checks']
  const checks: Array<{ name: string; command: string }> = []
  if (Array.isArray(checksRaw)) {
    for (const c of checksRaw) {
      const o = c as Record<string, unknown>
      if (o !== null && typeof o === 'object' && typeof o['name'] === 'string' && typeof o['command'] === 'string') checks.push({ name: o['name'], command: o['command'] })
    }
  } else if (checksRaw !== null && typeof checksRaw === 'object') {
    for (const [name, command] of Object.entries(checksRaw as Record<string, unknown>)) if (typeof command === 'string') checks.push({ name, command })
  }
  const contactsRaw = Array.isArray(d['contacts']) ? d['contacts'] : []
  const contacts = contactsRaw
    .map(c => (typeof c === 'string' ? c : typeof (c as Record<string, unknown>)?.['name'] === 'string' ? String((c as Record<string, unknown>)['name']) : ''))
    .filter(c => c !== '')
  return {
    agent: typeof d['agent'] === 'string' && d['agent'] !== '' ? d['agent'] : null,
    pairs: strings(d['pairs']),
    versionCap: typeof cap === 'number' && cap > 0 ? Math.floor(cap) : DEFAULT_VERSION_CAP,
    checks,
    protected: strings(d['protected']).map(s => s.toLowerCase()),
    contacts,
  }
}

/** `dir/../x` and `dir/./x` folded, so paths compare and print cleanly. */
export function joinPath(dir: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const parts = `${dir}/${rel}`.split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return `/${out.join('/')}`
}
