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

export interface CrashEntry {
  name: string;
  ts_ms: number;
  size_bytes: number;
  snippet: string;
}

export const diag = {
  listCrashes: () => invoke<CrashEntry[]>("diag_list_crashes"),
  readCrash: (name: string) =>
    invoke<string>("diag_read_crash", { args: { name } }),
  clearCrashes: () => invoke<number>("diag_clear_crashes"),
};
