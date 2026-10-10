export type Intent = 'question' | 'build' | 'unclear'

const SAYS_QUESTION = /\b(no code change|don'?t change|do not change|without changing|just a question|just asking|don'?t build|do not build)\b/i
const STARTS_BUILD = /^(go|build|do it|yes|ok|okay|proceed|ship it|fix|implement|add|make|change|update|write|create|remove|delete|rename|refactor|run|commit|push)\b/i
const STARTS_REQUEST = /^(can|could|would|will) you (please )?(?!explain|tell|clarify|describe|confirm|check whether)/i
const STARTS_QUESTION = /^(quick question|question|why|what|how|when|where|which|who|can you explain|could you explain|explain|(do|does|did|is|are|should|would|will) (you|it|this|that|we|i|the|there)\b)/i

/**
 * Whether a prompt only asks something. A plain request ("can you fix X?") is not a question,
 * whatever its punctuation; "go" or /build after a question turn lets changes through.
 */
export function intentOf(prompt: string): Intent {
  const text = prompt.trim()
  if (text === '' || text.startsWith('/')) return 'unclear'
  const first = text.split('\n')[0]?.trim() ?? ''
  if (SAYS_QUESTION.test(text)) return 'question'
  if (STARTS_BUILD.test(first) || STARTS_REQUEST.test(first)) return 'build'
  if (STARTS_QUESTION.test(first) || text.endsWith('?')) return 'question'
  return 'unclear'
}

/** Changes the guard holds back on a question turn: production, git history, file edits by shell. */
const MUTATING = [
  /\blua\s+(push|deploy|promote)\b/,
  /\blua\s+env\b[^;&|\n]*\s-k\b/,
  /\blua\s+version\s+(create|promote)\b/,
  /\bgit\b(?:\s+-C\s+\S+)?\s+(commit|push)\b/,
  /\bvercel\b/,
  /(^|[;&|(]\s*)rm\s/,
  /\bsed\s+-i\b/,
]

export function isMutatingBash(command: string): boolean {
  return MUTATING.some(re => re.test(command))
}

export const HELD = "This turn is a question; reply 'go' or /build to allow changes."
