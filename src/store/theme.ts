import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Theme store. Persisted to localStorage and reflected on the <html> element
 * via `data-theme` so the Tailwind `ink-*` palette (CSS-variable driven)
 * repaints the whole UI in one shot. Default is `dark` to preserve the
 * existing visual identity for returning users.
 */
export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

function apply(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      setTheme: (t) => {
        apply(t);
        set({ theme: t });
      },
      toggleTheme: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        apply(next);
        set({ theme: next });
      },
    }),
    {
      name: "nerva-theme",
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.theme);
      },
    },
  ),
);

/** Apply the persisted theme as early as possible (called from main.tsx). */
export function bootstrapTheme() {
  try {
    const raw = localStorage.getItem("nerva-theme");
    const t = raw ? (JSON.parse(raw).state?.theme as Theme) : "dark";
    apply(t === "light" ? "light" : "dark");
  } catch {
    apply("dark");
  }
}
