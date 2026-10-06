import type { Register } from 'claude-code'

export type Options = Parameters<Register>[1]
export type Mode = 'off' | 'warn' | 'block'

/** Set from ALLAN_MODS_OFF at session start; when true every feature passes through. */
export const kill = { isOn: false }

/** A feature is on unless its userConfig row is false or the kill switch is set. */
export function isOn(options: Options, feature: string): boolean {
  return !kill.isOn && (options as Record<string, unknown>)[feature] !== false
}

export function modeOf(options: Options, field: string, fallback: Mode): Mode {
  const value = (options as Record<string, unknown>)[field]
  return value === 'off' || value === 'warn' || value === 'block' ? value : fallback
}

export function textOf(options: Options, field: string, fallback: string): string {
  const value = (options as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** Every feature and the userConfig fields it owns, in build order. */
export const FEATURES: Record<string, readonly string[]> = {
  voice: ['voice', 'voiceStyle'],
  commit: ['commit', 'commitIdentity', 'commitEmail', 'commitInternalIds'],
  pulse: ['pulse', 'pulseStaleDays'],
}
