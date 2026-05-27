import { create } from "zustand";

interface TutorialStore {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useTutorial = create<TutorialStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
