// Pure readers and writers for a project's Claude_Memory files. No $ here: callers read and write the files.

export type HandoffRow = { id: string; from: string; to: string; title: string; status: string }

/** The surface a session name belongs to: "Code-Inquiry-7" -> "code-inquiry", "Code-2" -> "code". */
export function surfaceOf(session: string): string {
  return session.trim().replace(/[-\s]*\d+$/, '').toLowerCase()
}

/** Open rows of the HANDOFFS queue tables: `| ID | FROM → TO | title | ... | [ ] status |`. */
export function openHandoffs(handoffs: string): HandoffRow[] {
  const rows: HandoffRow[] = []
  for (const line of handoffs.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 4) continue
    const route = cells[1] ?? ''
    if (!route.includes('→')) continue
    const status = cells[cells.length - 1] ?? ''
    if (!/\[\s\]|\[~\]|\[\?\]/.test(status)) continue
    const [from = '', to = ''] = route.split('→').map(s => s.replace(/\*/g, '').trim())
    rows.push({ id: (cells[0] ?? '').replace(/\*/g, ''), from, to, title: (cells[2] ?? '').replace(/\*\*/g, '').slice(0, 120), status })
  }
  return rows
}

export function isForSurface(row: HandoffRow, surface: string): boolean {
  const to = row.to.toLowerCase()
  if (surface === '') return false
  return to === surface || to.startsWith(`${surface} `) || to.startsWith(`${surface}(`) || to.includes(surface)
}

/** Adds one line under "## ⏳ Parked", creating the section if missing and dropping a "- (none)" placeholder. */
export function addParked(index: string, line: string): string {
  const lines = index.split('\n')
  let at = lines.findIndex(l => /^##\s*⏳\s*Parked/.test(l))
  if (at < 0) {
    const firstSection = lines.findIndex((l, i) => i > 0 && /^##\s/.test(l))
    const insertAt = firstSection < 0 ? lines.length : firstSection
    lines.splice(insertAt, 0, '## ⏳ Parked', line, '')
    return lines.join('\n')
  }
  let end = at + 1
  while (end < lines.length && !/^##\s/.test(lines[end] ?? '')) end++
  const body = lines.slice(at + 1, end).filter(l => !/^-\s*\(none\)\s*$/.test(l))
  let lastItem = -1
  body.forEach((l, i) => { if (/^-\s/.test(l)) lastItem = i })
  const insertIn = lastItem >= 0 ? lastItem + 1 : body.findIndex(l => l.trim() !== '' && !l.startsWith('>')) >= 0 ? body.length : body.length
  const trimmedTail = body.slice(insertIn)
  const newBody = [...body.slice(0, insertIn), line, ...trimmedTail]
  return [...lines.slice(0, at + 1), ...newBody, ...lines.slice(end)].join('\n')
}

/** Removes the nth (1-based) dated item under "## ⏳ Parked"; returns null when there is no such item. */
export function removeParked(index: string, n: number): { text: string; removed: string } | null {
  const lines = index.split('\n')
  const at = lines.findIndex(l => /^##\s*⏳\s*Parked/.test(l))
  if (at < 0) return null
  let seen = 0
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^##\s/.test(l)) break
    if (/^-\s*\d{4}-\d{2}-\d{2}/.test(l)) {
      seen++
      if (seen === n) {
        lines.splice(i, 1)
        return { text: lines.join('\n'), removed: l }
      }
    }
  }
  return null
}

/** Splits `/park "what" "next step"` or `/park what | next step`. */
export function parseParkArgs(args: string): { what: string; next: string } | null {
  const quoted = [...args.matchAll(/"([^"]+)"/g)].map(m => m[1] ?? '')
  if (quoted.length >= 1) return { what: quoted[0] ?? '', next: quoted[1] ?? '' }
  const [what = '', next = ''] = args.split('|').map(s => s.trim())
  return what === '' ? null : { what, next }
}
