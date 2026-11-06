export type RtlCodeIsOn = boolean

declare module 'claude-code' {
  interface PluginState {
    'rtl-code': { isOn: RtlCodeIsOn; draft: string; caret: number; lit: boolean; waiting: string[]; folded: boolean }
  }
}
