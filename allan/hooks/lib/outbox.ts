export type Draft = { id: number; status: 'DRAFT' | 'SENT' | 'DROPPED'; date: string; to: string; title: string; body: string; by: string }

const START_BLOCK = /^▼▼▼ START[^\n]*\n[\s\S]*?\n▲▲▲ END[^\n]*$/gm

function namesContact(line: string, contacts: string[]): string | null {
  const l = line.toLowerCase()
  return contacts.find(c => new RegExp(`(^|[^a-z])${c.toLowerCase()}([^a-z]|$)`).test(l)) ?? null
}

/**
 * Messages in a reply that are meant for a contact: a START/END block whose START line names one, or
 * a quoted block (lines starting with >) introduced within three lines by a line naming one.
 */
export function draftsIn(answer: string, contacts: string[]): Array<{ to: string; body: string }> {
  if (contacts.length === 0) return []
  const out: Array<{ to: string; body: string }> = []
  for (const block of answer.match(START_BLOCK) ?? []) {
    const first = block.split('\n')[0] ?? ''
    const to = namesContact(first, contacts)
    if (to !== null) out.push({ to, body: block.split('\n').slice(1, -1).join('\n').trim() })
  }
  const lines = answer.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^>\s?/.test(lines[i] ?? '') || (i > 0 && /^>\s?/.test(lines[i - 1] ?? ''))) continue
    let end = i
    while (end < lines.length && /^>\s?/.test(lines[end] ?? '')) end++
    const quoted = lines.slice(i, end).map(l => l.replace(/^>\s?/, '')).join('\n').trim()
    if (quoted.split('\n').length < 2) { i = end; continue }
    const intro = lines.slice(Math.max(0, i - 3), i).join(' ')
    const to = /\b(draft|message|email|reply|note|whatsapp|slack|send|for|to)\b/i.test(intro) ? namesContact(intro, contacts) : null
    if (to !== null && !out.some(d => d.body === quoted)) out.push({ to, body: quoted })
    i = end
  }
  return out
}

const ENTRY = /^## M(\d+) · (DRAFT|SENT|DROPPED)(?: ([0-9-]{10}))?[^\n]*?· to ([^·\n]+?) · ([^\n]*)$/

/** Every entry of MESSAGES.md, in file order. */
export function parseDrafts(text: string): Draft[] {
  const out: Draft[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ENTRY)
    if (m === null) continue
    let end = i + 1
    while (end < lines.length && !/^## /.test(lines[end] ?? '')) end++
    const section = lines.slice(i + 1, end)
    const by = section.find(l => l.startsWith('**By:**'))?.replace('**By:**', '').trim() ?? ''
    const body = section.filter(l => /^>\s?/.test(l)).map(l => l.replace(/^>\s?/, '')).join('\n').trim()
    out.push({ id: Number(m[1]), status: m[2] as Draft['status'], date: m[3] ?? '', to: (m[4] ?? '').trim(), title: (m[5] ?? '').trim(), body, by })
    i = end - 1
  }
  return out
}

export function entryText(id: number, date: string, to: string, body: string, by: string): string {
  const title = (body.split('\n').find(l => l.trim() !== '') ?? '').slice(0, 70)
  const quoted = body.split('\n').map(l => (l === '' ? '>' : `> ${l}`)).join('\n')
  return `## M${id} · DRAFT ${date} · to ${to} · ${title}\n**By:** ${by}\n**Verified:** ❓ re-read every live claim before sending.\n\n${quoted}\n`
}

const HEADER = [
  '# MESSAGES — drafts for Allan to send',
  '',
  'Written by the outbox mod when a reply holds a message for a contact named in .claude-mods.json.',
  'Newest first. Status DRAFT → SENT <date> (from /outbox) or DROPPED <reason>. Re-read live systems before sending.',
  '',
  '---',
].join('\n')

/** Adds a draft as the newest entry (after the first `---`, or at the top of a new file). Returns null when the body is already there. */
export function addDraft(text: string | null, to: string, body: string, date: string, by: string): { text: string; id: number } | null {
  const existing = text ?? ''
  const drafts = parseDrafts(existing)
  if (drafts.some(d => d.body === body)) return null
  const id = drafts.reduce((m, d) => Math.max(m, d.id), 0) + 1
  const entry = entryText(id, date, to, body, by)
  if (text === null || text.trim() === '') return { text: `${HEADER}\n\n${entry}`, id }
  const rule = existing.indexOf('\n---\n')
  if (rule < 0) return { text: `${existing.replace(/\s*$/, '')}\n\n---\n\n${entry}`, id }
  const at = rule + '\n---\n'.length
  return { text: `${existing.slice(0, at)}\n${entry}${existing.slice(at).replace(/^\n+/, '\n')}`, id }
}

export function markSent(text: string, id: number, date: string): string | null {
  const re = new RegExp(`^(## M${id} · )DRAFT(?: [0-9-]{10})?`, 'm')
  return re.test(text) ? text.replace(re, `$1SENT ${date}`) : null
}

/** Markdown tables become aligned plain text, so they survive a paste into Slack or WhatsApp. */
export function slackify(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i] ?? '')) { out.push(lines[i] ?? ''); continue }
    const rows: string[][] = []
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
      const cells = (lines[i] ?? '').trim().slice(1, -1).split('|').map(c => c.trim())
      if (!cells.every(c => /^:?-+:?$/.test(c))) rows.push(cells)
      i++
    }
    i--
    const widths = rows.reduce<number[]>((w, r) => r.map((c, k) => Math.max(w[k] ?? 0, c.length)), [])
    for (const r of rows) out.push(r.map((c, k) => c.padEnd(widths[k] ?? 0)).join('   ').trimEnd())
  }
  return out.join('\n').replace(/\*\*([^*]+)\*\*/g, '*$1*')
}

export function ageDays(date: string, now: number): number {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0
}
