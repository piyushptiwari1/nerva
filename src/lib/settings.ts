import { invoke } from "@tauri-apps/api/core";

export interface SettingsBundle {
  ai_endpoint: string;
  ai_model: string;
  installed_models: string[];
  timer_presets_min: number[];
  audio_volume: number;
  audio_muted: boolean;
  focus_dnd: boolean | null;
  focus_dnd_supported: boolean;
}

export const settings = {
  /** One-shot bundle read used to populate the Settings pane. */
  get: () => invoke<SettingsBundle>("settings_get"),
  setTimerPresets: (presets_min: number[]) =>
    invoke<number[]>("timer_presets_set", { args: { presets_min } }),
};
