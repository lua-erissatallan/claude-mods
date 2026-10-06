export type VoiceStyle = 'normal' | 'plain' | 'visual'

export type PulseView = {
  session: string | null
  project: string
  baton: string | null
  parked: number
  oldestDays: number
  staleCount: number
  handoffs: number
}

declare module 'claude-code' {
  interface PluginState {
    allan: { style: VoiceStyle | null; pulse: PulseView | null; session: string | null }
  }
}
