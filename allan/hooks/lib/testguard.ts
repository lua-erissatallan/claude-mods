const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const KEY_SHAPED = /\b(?:sk|am|lua)_[A-Za-z0-9_]{16,}/
const RECIPIENT_KEY = /(CC|ALLOWLIST|RECIPIENT|TO)$/
const ENV_SET = /\blua\s+env\b[^;&|\n]*?\s-k\s+(\S+)/

/** Protected addresses named in a command, lowercased. */
export function protectedIn(text: string, protectedList: string[]): string[] {
  if (protectedList.length === 0) return []
  const found = new Set((text.match(EMAIL) ?? []).map(e => e.toLowerCase()).filter(e => protectedList.includes(e)))
  return [...found]
}

/** Script files a command runs, so their text can be checked too: `node x.mjs`, `tsx x.ts`, `sh x.sh`, `./x.sh`, `python x.py`. */
export function scriptsIn(command: string): string[] {
  const out = new Set<string>()
  for (const m of command.matchAll(/(?:^|[\s;&|(])(?:node|tsx|ts-node|bun|deno run|sh|bash|zsh|python3?)\s+(?:-[A-Za-z]+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const f = (m[1] ?? '').replace(/^["']|["']$/g, '')
    if (f !== '' && !f.startsWith('-') && /\.(m?[jt]s|sh|py|cjs)$/.test(f)) out.add(f)
  }
  for (const m of command.matchAll(/(?:^|[\s;&|(])(\.\/[^\s;&|]+)/g)) out.add(m[1] ?? '')
  out.delete('')
  return [...out]
}

/** The `-k KEY` of a lua env command when KEY names recipients. */
export function recipientKey(command: string): string | null {
  const key = command.match(ENV_SET)?.[1] ?? null
  return key !== null && RECIPIENT_KEY.test(key) ? key : null
}

export function looksLikeKey(text: string): boolean {
  return KEY_SHAPED.test(text)
}

/** `$NAME` or `${NAME}` references in a command, for the names given. */
export function secretsUsed(command: string, names: string[]): string[] {
  return names.filter(n => new RegExp(`\\$\\{?${n}\\}?(?![A-Za-z0-9_])`).test(command))
}

/** Prefixes the command with exports of the secrets it uses, single quoted. */
export function withSecrets(command: string, secrets: Record<string, string>, names: string[]): string {
  const exports = names.map(n => `export ${n}='${(secrets[n] ?? '').replace(/'/g, `'\\''`)}'`).join('; ')
  return exports === '' ? command : `${exports}; ${command}`
}

/** Every secret value in `text` replaced by `[NAME redacted]`. */
export function redact(text: string, secrets: Record<string, string>): string {
  let out = text
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length < 4) continue
    out = out.split(value).join(`[${name} redacted]`)
  }
  return out
}

/** Redacts the text blocks and tool_result strings of a row's content; returns null when nothing changed. */
export function redactBlocks(content: Array<Record<string, unknown>>, secrets: Record<string, string>): Array<Record<string, unknown>> | null {
  let changed = false
  const walk = (block: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...block }
    if (typeof next['text'] === 'string') {
      const r = redact(next['text'], secrets)
      if (r !== next['text']) { next['text'] = r; changed = true }
    }
    const inner = next['content']
    if (typeof inner === 'string') {
      const r = redact(inner, secrets)
      if (r !== inner) { next['content'] = r; changed = true }
    } else if (Array.isArray(inner)) {
      next['content'] = inner.map(b => (b !== null && typeof b === 'object' ? walk(b as Record<string, unknown>) : b))
    }
    return next
  }
  const out = content.map(walk)
  return changed ? out : null
}

export const TESTMODE_HELD = (what: string) => `testguard: ${what} while /testmode is on. Turn it off with /testmode off when the test is over.`
