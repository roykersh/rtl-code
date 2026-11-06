export type RtlModeIsOn = boolean

declare module 'claude-code' {
  interface PluginState {
    'rtl-mode': { isOn: RtlModeIsOn; draft: string; caret: number; lit: boolean; waiting: string[]; folded: boolean }
  }
}
