import { create } from "zustand";

/**
 * Lightweight open/close store for the SettingsPane. We keep it separate from
 * `useApp` because settings is an overlay UI concern, not part of the core
 * workspace state — and putting it here lets the palette + global hotkey both
 * toggle it without circular imports.
 */
interface SettingsUiState {
  open: boolean;
  /**
   * Optional tab to focus the next time the pane opens. Cleared by the
   * pane once consumed so a subsequent plain `setOpen(true)` re-shows the
   * tab the user was last on, not the deep-link.
   */
  pendingTab: string | null;
  setOpen: (v: boolean) => void;
  /** Open the pane on a specific tab (e.g. palette → "Diagnostics"). */
  openOn: (tab: string) => void;
  consumePendingTab: () => string | null;
  toggle: () => void;
}

export const useSettingsUi = create<SettingsUiState>((set, get) => ({
  open: false,
  pendingTab: null,
  setOpen: (v) => set({ open: v }),
  openOn: (tab) => set({ open: true, pendingTab: tab }),
  consumePendingTab: () => {
    const t = get().pendingTab;
    if (t) set({ pendingTab: null });
    return t;
  },
  toggle: () => set({ open: !get().open }),
}));
