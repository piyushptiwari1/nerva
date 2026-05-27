import { create } from "zustand";

/** Tiny store for palette open/close — keeps CommandPalette & global key
 *  handler decoupled from the rest of the app store. */
interface PaletteStore {
  open: boolean;
  set: (v: boolean) => void;
  toggle: () => void;
}

export const usePalette = create<PaletteStore>((set, get) => ({
  open: false,
  set: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));
