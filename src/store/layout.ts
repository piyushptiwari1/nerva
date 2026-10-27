import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Sidebar layout — which sections show and in what order. UI-only
 * preference, persisted in localStorage (never synced / telemetered).
 */
export type SectionId = "workspaces" | "tasks" | "habits" | "momentum";

export const ALL_SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "workspaces", label: "Workspaces", hint: "Switch context; timers/notes/tasks are scoped per workspace" },
  { id: "tasks", label: "Tasks", hint: "Today's list for the active workspace" },
  { id: "habits", label: "Habits", hint: "One-tap daily log" },
  { id: "momentum", label: "This week", hint: "Focus time, sessions and tasks done vs last week" },
];

const DEFAULT_ORDER: SectionId[] = ["workspaces", "tasks", "habits", "momentum"];
const DEFAULT_HIDDEN: SectionId[] = ["momentum"];

interface LayoutState {
  order: SectionId[];
  hidden: SectionId[];
  /** Bottom event-log strip. Developer-ish; off unless asked for. */
  showTimeline: boolean;
  move: (id: SectionId, dir: -1 | 1) => void;
  setHidden: (id: SectionId, hidden: boolean) => void;
  setShowTimeline: (v: boolean) => void;
  reset: () => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      order: DEFAULT_ORDER,
      hidden: DEFAULT_HIDDEN,
      showTimeline: false,
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
      setShowTimeline: (showTimeline) => set({ showTimeline }),
      reset: () => set({ order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN, showTimeline: false }),
    }),
    {
      name: "nerva-layout",
      version: 2,
      // v2 (0.1.14): Momentum and the Timeline strip became opt-in. Existing
      // users get the same clean default; they can re-enable in Settings → Layout.
      migrate: (persisted, version) => {
        const p = (persisted as Partial<LayoutState>) ?? {};
        if (version < 2) {
          const hidden = p.hidden ?? [];
          if (!hidden.includes("momentum")) p.hidden = [...hidden, "momentum"];
          p.showTimeline = false;
        }
        return p as LayoutState;
      },
      // Tolerate sections added or removed in later versions: drop unknown
      // ids (e.g. "clocks", now in the top-bar popover) and append new ones.
      merge: (persisted, current) => {
        const p = (persisted as Partial<LayoutState>) ?? {};
        const order = (p.order ?? []).filter((id) => DEFAULT_ORDER.includes(id));
        for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
        const hidden = (p.hidden ?? current.hidden).filter((id) => DEFAULT_ORDER.includes(id));
        return { ...current, ...p, order, hidden };
      },
    },
  ),
);

/** World clocks — list of IANA zone ids shown in the top-bar popover. */
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

/**
 * Column widths for the three-pane desktop layout. The centre pane takes
 * whatever is left. Clamped so no pane can be dragged into uselessness.
 */
export const PANE_LIMITS = { sidebar: [220, 440] as const, notes: [280, 640] as const };
const DEFAULT_PANES = { sidebar: 272, notes: 340 };

interface PanesState {
  sidebar: number;
  notes: number;
  setSidebar: (px: number) => void;
  setNotes: (px: number) => void;
  reset: () => void;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.round(Math.min(hi, Math.max(lo, v)));

export const usePanes = create<PanesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PANES,
      setSidebar: (px) => set({ sidebar: clamp(px, PANE_LIMITS.sidebar) }),
      setNotes: (px) => set({ notes: clamp(px, PANE_LIMITS.notes) }),
      reset: () => set(DEFAULT_PANES),
    }),
    { name: "nerva-panes" },
  ),
);
