import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Sidebar layout — which sections show and in what order. UI-only
 * preference, persisted in localStorage (never synced / telemetered).
 */
export type SectionId = "workspaces" | "tasks" | "habits" | "clocks" | "momentum";

export const ALL_SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "workspaces", label: "Workspaces", hint: "Switch context; timers/notes/tasks are scoped per workspace" },
  { id: "tasks", label: "Tasks", hint: "Today's list for the active workspace" },
  { id: "habits", label: "Habits", hint: "One-tap daily log" },
  { id: "clocks", label: "World clocks", hint: "Up to 6 time zones" },
  { id: "momentum", label: "Momentum", hint: "7-day focus bars" },
];

const DEFAULT_ORDER: SectionId[] = ["workspaces", "tasks", "habits", "clocks", "momentum"];
const DEFAULT_HIDDEN: SectionId[] = ["clocks"];

interface LayoutState {
  order: SectionId[];
  hidden: SectionId[];
  move: (id: SectionId, dir: -1 | 1) => void;
  setHidden: (id: SectionId, hidden: boolean) => void;
  reset: () => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      order: DEFAULT_ORDER,
      hidden: DEFAULT_HIDDEN,
      move: (id, dir) => {
        const order = [...get().order];
        const i = order.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        set({ order });
      },
      setHidden: (id, hidden) => {
        const cur = get().hidden.filter((h) => h !== id);
        set({ hidden: hidden ? [...cur, id] : cur });
      },
      reset: () => set({ order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN }),
    }),
    {
      name: "nerva-layout",
      version: 1,
      // Tolerate sections added in later versions: append unknown-to-user
      // ids at the end so new features are discoverable.
      merge: (persisted, current) => {
        const p = (persisted as Partial<LayoutState>) ?? {};
        const order = (p.order ?? []).filter((id) => DEFAULT_ORDER.includes(id));
        for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
        return { ...current, ...p, order, hidden: p.hidden ?? current.hidden };
      },
    },
  ),
);

/** World clocks — list of IANA zone ids shown in the sidebar. */
interface ClocksState {
  zones: string[];
  add: (zone: string) => void;
  remove: (zone: string) => void;
}

export const MAX_CLOCKS = 6;

export const useClocks = create<ClocksState>()(
  persist(
    (set, get) => ({
      zones: [],
      add: (zone) => {
        const z = get().zones;
        if (z.includes(zone) || z.length >= MAX_CLOCKS) return;
        set({ zones: [...z, zone] });
      },
      remove: (zone) => set({ zones: get().zones.filter((x) => x !== zone) }),
    }),
    { name: "nerva-clocks" },
  ),
);
