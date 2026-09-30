import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isAndroid } from "@/lib/platform";
import { useApp } from "@/store/app";

export type WidgetKind = "focus" | "tasks" | "habits" | "notes";

export interface WidgetStatus {
  exactAlarms: boolean;
  notifications: boolean;
  canPin: boolean;
  counts: Record<WidgetKind, number>;
}

export function androidWidgets<T = null>(action: "refresh" | "status" | "pin" | "alarmSettings", kind?: WidgetKind): Promise<T> {
  return invoke<T>("android_widgets", { action, kind });
}

let legacyAlarmCleanup: Promise<void> | undefined;

export function useNativeWidgets(): string | null {
  const ready = useApp((state) => state.ready);
  const signature = useApp((state) => JSON.stringify([
    state.timers.map((timer) => [timer.id, timer.status, timer.started_at_ms, timer.paused_at_ms, timer.paused_total_ms, timer.phase_index]),
    state.tasks,
    state.notes,
    state.workspaces,
  ]));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !isAndroid() || !isTauri()) return;
    let disposed = false;
    const refresh = async () => {
      try {
        legacyAlarmCleanup ??= import("@tauri-apps/plugin-notification").then((notifications) => notifications.cancelAll());
        await legacyAlarmCleanup;
        await androidWidgets("refresh");
        if (!disposed) setError(null);
      } catch (failure) {
        if (!disposed) setError(String(failure));
      }
    };
    const timer = window.setTimeout(() => void refresh(), 80);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [ready, signature]);

  useEffect(() => {
    if (!ready || !isAndroid() || !isTauri()) return;
    let disposed = false;
    const subscriptions: UnlistenFn[] = [];
    const refresh = () => {
      void androidWidgets("refresh").catch((failure) => { if (!disposed) setError(String(failure)); });
    };
    const reload = () => {
      const state = useApp.getState();
      void Promise.all([state.refreshTimers(), state.refreshTasks(), state.refreshNotes(), state.refreshMomentum()]);
      refresh();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") reload(); };
    const subscribe = async () => {
      for (const event of ["habit:changed", "note:saved", "note:deleted", "widget:changed"]) {
        const unlisten = await listen(event, event === "widget:changed" ? reload : refresh);
        if (disposed) unlisten();
        else subscriptions.push(unlisten);
      }
    };
    void subscribe().catch((failure) => { if (!disposed) setError(String(failure)); });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      subscriptions.forEach((unlisten) => unlisten());
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready]);

  return error;
}