import { create } from "zustand";

/** Tiny store for palette + Ask Nerva pane state. Decouples the global key
 *  handler and the action sources from the rest of the app store. */
interface PaletteStore {
  open: boolean;
  set: (v: boolean) => void;
  toggle: () => void;
  /** When non-null, the AskNerva pane is open with this initial prompt. */
  askPrompt: string | null;
  ask: (prompt: string) => void;
  closeAsk: () => void;
}

export const usePalette = create<PaletteStore>((set, get) => ({
  open: false,
  set: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
  askPrompt: null,
  ask: (prompt) => set({ open: false, askPrompt: prompt }),
  closeAsk: () => set({ askPrompt: null }),
}));
