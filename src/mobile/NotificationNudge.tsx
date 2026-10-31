import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { requestPermission } from "@tauri-apps/plugin-notification";
import { BellRing, X } from "lucide-react";
import { isAndroid } from "@/lib/platform";
import { haptic } from "@/lib/haptics";
import { androidWidgets, type WidgetStatus } from "./widgets";

const KEY = "nerva.notifications.nudge";

/**
 * One-time, dismissible prompt asking for notification permission so timer
 * alerts, reminders and habit nudges actually reach the user. Shown on the
 * first phone launch where permission is missing; never shown again once
 * granted or dismissed.
 */
export function NotificationNudge({ ready }: { ready: boolean }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !isAndroid() || !isTauri()) return;
    if (localStorage.getItem(KEY) === "done") return;
    const timer = window.setTimeout(() => {
      void androidWidgets<WidgetStatus>("status")
        .then((status) => {
          if (status?.notifications) localStorage.setItem(KEY, "done");
          else setShow(true);
        })
        .catch(() => void 0);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!show) return null;

  async function allow() {
    setBusy(true);
    haptic.tap();
    try {
      const result = await requestPermission();
      if (result === "granted") haptic.complete();
    } catch { /* permission dialog unavailable — fall through */ }
    localStorage.setItem(KEY, "done");
    setShow(false);
    setBusy(false);
  }

  function dismiss() {
    localStorage.setItem(KEY, "done");
    setShow(false);
  }

  return (
    <div className="mobile-nudge" role="status">
      <BellRing size={20} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="mobile-nudge-title">Get timer and reminder alerts</div>
        <div className="mobile-nudge-help">Nerva can tell you when a focus block ends or a habit is due, even when the app is closed.</div>
      </div>
      <button className="btn-primary" disabled={busy} onClick={() => void allow()}>Allow</button>
      <button className="mobile-icon" onClick={dismiss} aria-label="Not now"><X size={18} /></button>
    </div>
  );
}
