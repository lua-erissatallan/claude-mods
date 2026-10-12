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
export type PulseSelection = { kind: 'parked' | 'handoff' | 'parkedList' | 'inbox'; index: number } | null
export type RelayInboxItem = { from: string; at: number; preview: string }
export type WatchLight = { level: 'green' | 'amber' | 'red'; text: string; at: number; project: string }
export type WatchUnseen = { errors: number; blocks: number; bypass: number; since: number | null }
export type OutboxDraft = { id: number; status: 'DRAFT' | 'SENT' | 'DROPPED'; date: string; to: string; title: string; body: string; by: string }
export type ReleaseAgent = { dir: string; name: string; active: number | null; next: number | null; nextMessage: string; count: number; prune: number[]; error: string | null; done: boolean }

declare module 'claude-code' {
  interface PluginState {
    allan: {
      style: VoiceStyle | null
      pulse: PulseView | null
      session: string | null
      parkedItems: PulseParkedItem[]
      handoffItems: PulseHandoffItem[]
      selected: PulseSelection
      handoverFired: number[]
      inbox: RelayInboxItem[]
      askTurn: boolean
      releasePlan: ReleaseAgent[] | null
      releaseLog: string[]
      watchLight: WatchLight | null
      watchUnseen: WatchUnseen
      watchRecent: string[]
      testMode: boolean
      secrets: Record<string, string>
      outboxDrafts: OutboxDraft[]
      outboxNote: string | null
    }
  }
}
