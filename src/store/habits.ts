import { create } from "zustand";

interface HabitsUiStore {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useHabitsUi = create<HabitsUiStore>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
