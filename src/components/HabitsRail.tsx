import { HabitTracker } from "@/components/HabitTracker";
import { isMobile } from "@/lib/platform";

/** Habits in the home sidebar (desktop) or the Habits tab (phone). */
export function HabitsRail() {
  return <HabitTracker compact={!isMobile()} />;
}
