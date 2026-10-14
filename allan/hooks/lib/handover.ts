import type { Parked } from './project'

export const SECTIONS = ['Work done', 'Learnings and gotchas', 'Pending items', 'How to start'] as const
/** Drafted with the sections but kept out of the file: what this session should still do itself. */
export const CLOSING = 'Do before closing this session'

/** "60,70,80,90" → [60, 70, 80, 90], sorted, out of range values dropped. */
export function thresholdsOf(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0 && n < 100)
    .sort((a, b) => a - b)
}

/**
 * Which thresholds this reading crosses for the first time. A jump past several raises one
 * alert (the highest) but marks them all, so each fires at most once per session.
 * A reading under the lowest threshold (after a compaction) re-arms them.
 */
export function alertFor(percent: number, thresholds: number[], fired: number[]): { alert: number | null; fired: number[] } {
  const lowest = thresholds[0]
  if (lowest === undefined) return { alert: null, fired }
  if (percent < lowest) return { alert: null, fired: fired.length === 0 ? fired : [] }
  const crossed = thresholds.filter(t => percent >= t && !fired.includes(t))
  if (crossed.length === 0) return { alert: null, fired }
  return { alert: crossed[crossed.length - 1] ?? null, fired: [...fired, ...crossed].sort((a, b) => a - b) }
}

export function alertText(percent: number, threshold: number, thresholds: number[]): string {
  const last = thresholds[thresholds.length - 1]
  if (threshold === last) return `Context ${percent}%. Run /handover <successor> now, while there is room to write it.`
  return `Context ${percent}%. Plan the handover: /handover <successor> when you reach a stopping point.`
}

/** Allan's own handover ask, as he types it when a session is almost out of context. */
export function forkPrompt(successor: string, me: string): string {
  return [
    `This session (${me}) is almost out of context. Write the handover document for the \`${successor}\` session Allan will create and point at it.`,
    'Include all our work, learnings, gotchas, pending items, deploys and commits, things we learned from breaking things or from being wrong, and things that are easy to get wrong for a session that does not know what you now know. The objective is to lose no important context and have that session proceed as if it were you.',
    `Use exactly these five sections as "## " headings, in this order: ${SECTIONS.join('; ')}; ${CLOSING}.`,
    'Work done: what changed, with file paths, commit hashes and commands. Learnings and gotchas: what broke, what we were wrong about, what is easy to get wrong. Pending items: every unfinished thread, deploy, commit or question in priority order, each with its next step, and say which of them are recorded nowhere else the successor can see. How to start: what to read first and the first action.',
    `${CLOSING}: the pending items you recommend this session handles itself with its remaining context, because they are quicker to finish here than to hand over; write "- none" if there are none.`,
    'Short bullets, specific, no preamble, no closing line. No em dashes.',
  ].join('\n')
}

/** Allan's closing question: what lives only in this conversation. */
export function closePrompt(): string {
  return [
    'Allan is about to close this session and not come back to it.',
    'Is there pending work, learnings or items that live only in this conversation, which a successor session will not learn or catch from the files (Claude_Memory, HANDOVER files, git)?',
    'Answer with "Nothing: safe to close." or a short bullet list, each item with where it should be recorded. No preamble. No em dashes.',
  ].join('\n')
}

/** Splits one "## <name>" section out of a drafted body: the body without it, and its bullets. */
export function splitSection(body: string, name: string): { rest: string; section: string | null } {
  const re = new RegExp(`^##\\s+${name}\\s*$\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi')
  const m = body.match(re)
  if (m === null) return { rest: body, section: null }
  return { rest: (body.slice(0, m.index) + body.slice((m.index ?? 0) + m[0].length)).trim(), section: (m[1] ?? '').trim() }
}

/** The model's sections when all four headings came back, else null. */
export function sectionsFrom(reply: string): string | null {
  const text = reply.trim()
  const start = text.search(/^##\s/m)
  if (start < 0) return null
  const body = text.slice(start)
  return SECTIONS.every(s => new RegExp(`^##\\s+${s}\\s*$`, 'mi').test(body)) ? body : null
}

export function emptySections(): string {
  return SECTIONS.map(s => `## ${s}\n\n- ❓ fill in\n`).join('\n')
}

export function handoverDoc(args: { me: string; successor: string; date: string; sessionId: string; percent: number | null; sections: string }): string {
  const at = args.percent === null ? '' : ` at ${args.percent}% context`
  return [
    `# HANDOVER: ${args.me} → ${args.successor}`,
    '',
    `\`Written ${args.date} by ${args.me} (session ${args.sessionId})${at}.\``,
    '',
    args.sections.trim(),
    '',
  ].join('\n')
}

export function kickoff(args: { me: string; successor: string; project: string; root: string; file: string }): string {
  const marker = `message for ${args.successor}`
  return [
    `▼▼▼ START · ${marker}`,
    `You are ${args.successor}, successor to ${args.me} in the ${args.project} workspace (${args.root}). The objective is to lose no context and proceed as if you were ${args.me}.`,
    '',
    'Read first, in order:',
    `1. ${args.file}, all of it`,
    '2. Claude_Memory/INDEX.md: the ▶ Baton line and ⏳ Parked',
    '',
    'Register yourself in Claude_Memory/HANDOFFS.md → ## Surfaces if the startup hook asks.',
    'Then tell me in a few lines where things stand, what is pending, and what you will do first.',
    `▲▲▲ END · ${marker}`,
  ].join('\n')
}

/** A session name that may refuse auto compaction (Orchestrator, Lead…, Code…). */
export function isLead(name: string | null, pattern: string): boolean {
  if (name === null || name === '') return false
  try {
    return new RegExp(pattern).test(name)
  } catch {
    return false
  }
}

export type CloseCheck = { ok: boolean; line: string }

export function closeChecks(args: {
  porcelain: string | null
  today: string
  modified: Record<string, string | null>
  parked: Parked[]
  session: string | null
  staleDays: number
}): CloseCheck[] {
  const checks: CloseCheck[] = []
  if (args.porcelain === null) checks.push({ ok: true, line: 'git: not a repository here (skipped)' })
  else {
    const dirty = args.porcelain.split('\n').filter(l => l.trim() !== '')
    checks.push(dirty.length === 0
      ? { ok: true, line: 'git: working tree clean' }
      : { ok: false, line: `git: ${dirty.length} uncommitted path${dirty.length === 1 ? '' : 's'}: ${dirty.slice(0, 5).map(l => l.slice(3)).join(', ')}${dirty.length > 5 ? ', …' : ''}` })
  }
  for (const [file, date] of Object.entries(args.modified)) {
    if (date === null) checks.push({ ok: true, line: `${file}: not in this project (skipped)` })
    else checks.push(date === args.today
      ? { ok: true, line: `${file}: updated today` }
      : { ok: false, line: `${file}: last changed ${date}; update it (baton, status) before closing` })
  }
  const mine = args.session === null ? [] : args.parked.filter(p => p.text.endsWith(`(${args.session})`))
  const stale = mine.filter(p => p.ageDays > args.staleDays)
  checks.push(stale.length === 0
    ? { ok: true, line: `⏳ Parked: nothing of ${args.session ?? 'this session'} older than ${args.staleDays} days` }
    : { ok: false, line: `⏳ Parked: ${stale.length} of ${args.session}'s items older than ${args.staleDays} days: ${stale.map(p => p.text.slice(0, 40)).join('; ')}` })
  return checks
}

export function localDate(ms: number, offsetMinutes: number): string {
  return new Date(ms - offsetMinutes * 60_000).toISOString().slice(0, 10)
}
