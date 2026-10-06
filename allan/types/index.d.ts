export type VoiceStyle = 'normal' | 'plain' | 'visual'

declare module 'claude-code' {
  interface PluginState {
    allan: { style: VoiceStyle | null }
  }
}
