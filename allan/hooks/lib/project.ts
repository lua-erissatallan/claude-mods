export type Parked = { date: string; ageDays: number; text: string }

export type Project = {
  root: string
  name: string
  memoryDir: string | null
  hasAgent: boolean
}

export function parentOf(dir: string): string | null {
  if (dir === '/' || dir === '') return null
  const cut = dir.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : dir.slice(0, cut)
}

export function batonOf(index: string): string | null {
  const line = index.split('\n').find(l => /NEXT UP/i.test(l))
  if (line === undefined) return null
  const m = line.replace(/\*/g, '').match(/NEXT UP\s*[:\-—]?\s*(.+)$/i)
  return m?.[1]?.trim() ?? null
}

export function parkedOf(index: string, now: number): Parked[] {
  const start = index.search(/^##\s*⏳\s*Parked/m)
  if (start < 0) return []
  const rest = index.slice(start).split('\n').slice(1)
  const out: Parked[] = []
  for (const line of rest) {
    if (/^##\s/.test(line)) break
    const m = line.match(/^-\s*(\d{4}-\d{2}-\d{2})\s*·\s*(.+)$/)
    if (m === null) continue
    const date = m[1] ?? ''
    const ageDays = Math.max(0, Math.floor((now - Date.parse(`${date}T00:00:00Z`)) / 86_400_000))
    out.push({ date, ageDays, text: (m[2] ?? '').trim() })
  }
  return out
}
