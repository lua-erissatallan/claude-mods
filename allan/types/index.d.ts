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

export type PulseParkedItem = { index: number; date: string; ageDays: number; text: string }
export type PulseHandoffItem = { index: number; id: string; from: string; to: string; title: string }
export type PulseSelection = { kind: 'parked' | 'handoff'; index: number } | null

declare module 'claude-code' {
  interface PluginState {
    allan: {
      style: VoiceStyle | null
      pulse: PulseView | null
      session: string | null
      parkedItems: PulseParkedItem[]
      handoffItems: PulseHandoffItem[]
      selected: PulseSelection
    }
  }
}
