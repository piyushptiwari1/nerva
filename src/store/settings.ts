import { create } from "zustand";

/**
 * Lightweight open/close store for the SettingsPane. We keep it separate from
 * `useApp` because settings is an overlay UI concern, not part of the core
 * workspace state — and putting it here lets the palette + global hotkey both
 * toggle it without circular imports.
 */
interface SettingsUiState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useSettingsUi = create<SettingsUiState>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));
