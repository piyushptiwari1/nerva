import { useEffect, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useApp } from "@/store/app";
import { ipc, formatRemaining, planPhases, phaseLabel, type Timer } from "@/lib/ipc";
import { settings } from "@/lib/settings";
import { isMobile } from "@/lib/platform";
import { inWorkspace } from "@/lib/workspaces";
import { SectionHead } from "@/components/SectionHead";

const PRESETS: Array<{ label: string; ms: number; color: string }> = [
  { label: "25m Focus", ms: 25 * 60_000, color: "#7c9cff" },
  { label: "50m Deep", ms: 50 * 60_000, color: "#a8bdff" },
  { label: "90m Deep Work", ms: 90 * 60_000, color: "#e8b86d" },
  { label: "2h Sprint", ms: 120 * 60_000, color: "#e8b86d" },
  { label: "5m Break", ms: 5 * 60_000, color: "#7dd6a8" },
  { label: "8m Tea", ms: 8 * 60_000, color: "#7dd6a8" },
];

export function TimerStage() {
  const { timers: allTimers, active, refreshTimers } = useApp();
  const timers = allTimers.filter((timer) => inWorkspace(timer, active?.id ?? null));
  const [creating, setCreating] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customMin, setCustomMin] = useState(25);
  // Default comes from Settings → Timers; the form lets you override per timer.
  const [autoBreaks, setAutoBreaks] = useState(true);

  useEffect(() => {
    if (!creating) return;
    settings
      .get()
      .then((b) => setAutoBreaks(b.timer_auto_breaks))
      .catch(() => void 0);
  }, [creating]);

  async function spawnPreset(p: typeof PRESETS[number]) {
    const t = await ipc.timerCreate({
      name: p.label,
      duration_ms: p.ms,
      color: p.color,
      workspace_id: active?.id,
      auto_breaks: autoBreaks,
    });
    await ipc.timerStart(t.id);
    await refreshTimers();
  }

  async function spawnCustom() {
    if (!customName.trim() || customMin <= 0) return;
    const t = await ipc.timerCreate({
      name: customName.trim(),
      duration_ms: customMin * 60_000,
      workspace_id: active?.id,
      auto_breaks: autoBreaks,
    });
    await ipc.timerStart(t.id);
    setCustomName("");
    setCreating(false);
    await refreshTimers();
  }

  const preview = planPhases(Math.max(0, customMin) * 60_000);
  const structured = autoBreaks && preview.length > 1;

  // The timer you are actually doing gets the stage. Running wins; otherwise
  // the most recently paused one. Everything else is parked in a strip.
  const hero =
    timers.find((t) => t.status === "running") ??
    [...timers].filter((t) => t.status === "paused").sort((a, b) => (b.paused_at_ms ?? 0) - (a.paused_at_ms ?? 0))[0] ??
    null;
  const parked = hero ? timers.filter((t) => t.id !== hero.id) : timers;

  return (
    <section className="glass rounded-xl p-4 flex flex-col gap-3 min-h-0">
      <SectionHead
        as="h2"
        title="Focus"
        count={timers.length}
        sub={hero ? `${hero.name} is on stage — others wait below` : "Start a session; it takes the stage while it runs"}
        actions={
          <>
            {!isMobile() && (
              <button
                onClick={() => ipc.openTimerWidget()}
                className="control-chip"
                title="Open as a floating always-on-top widget"
              >
                Pop up ↗
              </button>
            )}
            <button
              onClick={() => setCreating((v) => !v)}
              className={creating ? "btn" : "btn-primary"}
            >
              {creating ? "Cancel" : "+ New timer"}
            </button>
          </>
        }
      />

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass rounded-lg p-3 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => spawnPreset(p)}
                    className="text-xs px-2.5 py-1.5 rounded-md hairline bg-ink-800/60 hover:bg-ink-700"
                    style={{ borderLeft: `2px solid ${p.color}` }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && spawnCustom()}
                  placeholder="Custom timer name"
                  className="field flex-1"
                />
                <input
                  type="number"
                  min={1}
                  value={customMin}
                  onChange={(e) => setCustomMin(parseInt(e.target.value || "0", 10))}
                  className="field w-20 tnum"
                  aria-label="Duration in minutes"
                />
                <span className="text-xs text-ink-400">min</span>
                <button onClick={spawnCustom} className="btn-primary">
                  Start
                </button>
              </div>
              {/* Session structure: ≥30 min timers get pomodoro breaks baked
                  in as phases of ONE timer (no separate "break" timers). */}
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="flex items-center gap-2 text-ink-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoBreaks}
                    onChange={(e) => setAutoBreaks(e.target.checked)}
                    className="accent-[rgb(var(--accent))]"
                  />
                  Auto breaks (25/5, long break every 4th)
                </label>
                <span className="text-ink-400 tnum">
                  {customMin < 30
                    ? "under 30 min → single focus block"
                    : structured
                      ? `${preview.filter((p) => p.kind === "focus").length} focus · ${preview.filter((p) => p.kind === "break").length} breaks`
                      : "single focus block"}
                </span>
              </div>
              {structured && (
                <div className="flex h-1.5 w-full gap-px rounded overflow-hidden" aria-hidden>
                  {preview.map((p, i) => (
                    <span
                      key={i}
                      style={{ flex: p.duration_ms }}
                      className={p.kind === "focus" ? "bg-accent/70" : "bg-rest/70"}
                      title={`${p.kind} ${p.duration_ms / 60_000}m`}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3">
        {timers.length === 0 && (
          <div className="text-center text-ink-400 py-16">
            <p className="text-sm">No active timers.</p>
            <p className="text-xs mt-1">
              Tap{" "}
              <span className="text-accent-glow">+ New timer</span> or press{" "}
              <kbd className="border border-ink-600 rounded px-1.5 text-[10px]">
                Ctrl
              </kbd>{" "}
              <kbd className="border border-ink-600 rounded px-1.5 text-[10px]">
                K
              </kbd>
              .
            </p>
          </div>
        )}
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {hero && (
              <motion.div
                key={hero.id}
                layout
                layoutId={`timer-${hero.id}`}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.8 }}
                data-testid="timer-hero"
              >
                <TimerCard timer={hero} onChange={refreshTimers} hero />
              </motion.div>
            )}
          </AnimatePresence>
          {parked.length > 0 && (
            <div className={`grid gap-3 content-start ${hero ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-2"}`}>
              <AnimatePresence initial={false}>
                {parked.map((t) => (
                  <motion.div
                    key={t.id}
                    layout
                    layoutId={`timer-${t.id}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.8 }}
                  >
                    <TimerCard timer={t} onChange={refreshTimers} compact={!!hero} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </LayoutGroup>
      </div>
    </section>
  );
}

function TimerCard({ timer, onChange, hero = false, compact = false }: { timer: Timer; onChange: () => Promise<void>; hero?: boolean; compact?: boolean }) {
  const structured = (timer.phases?.length ?? 1) > 1;
  const isBreak = timer.phase_kind === "break";
  // Ring shows the CURRENT phase for structured sessions (so a break reads
  // as its own countdown), the whole timer otherwise.
  const ringTotal = structured ? timer.phase_duration_ms : timer.duration_ms;
  const ringLeft = structured ? timer.phase_remaining_ms : timer.remaining_ms;
  const progress = ringTotal > 0 ? 1 - Math.max(0, Math.min(1, ringLeft / ringTotal)) : 0;
  const sessionProgress =
    timer.duration_ms > 0
      ? 1 - Math.max(0, Math.min(1, timer.remaining_ms / timer.duration_ms))
      : 0;
  const size = hero ? 240 : compact ? 112 : 160;
  const stroke = hero ? 12 : compact ? 8 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * progress;
  const ringColor = isBreak ? "rgb(var(--rest))" : timer.color;
  const label = phaseLabel(timer);

  async function toggle() {
    if (timer.status === "running") await ipc.timerPause(timer.id);
    else if (timer.status === "paused") await ipc.timerResume(timer.id);
    else if (timer.status === "idle") await ipc.timerStart(timer.id);
    else if (timer.status === "completed") {
      await ipc.timerReset(timer.id);
      await ipc.timerStart(timer.id);
    }
    await onChange();
  }
  async function reset() { await ipc.timerReset(timer.id); await onChange(); }
  async function remove() {
    if (
      timer.status === "running" &&
      !window.confirm(`Delete the running timer "${timer.name}"?`)
    )
      return;
    await ipc.timerDelete(timer.id);
    await onChange();
  }

  return (
    <div
      className={`glass rounded-xl flex flex-col items-center ${hero ? "p-6 gap-3 timer-hero" : compact ? "p-3 gap-1.5" : "p-4 gap-2"}`}
      style={{ borderTop: `2px solid ${timer.color}`, ...(hero ? { boxShadow: `0 18px 60px ${timer.color}33, var(--glass-shadow)` } : {}) }}
      aria-label={hero ? `${timer.name}, on stage` : undefined}
    >
      <div className="w-full flex items-center justify-between text-xs gap-2">
        <span className="text-ink-200 truncate" title={timer.name}>{timer.name}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {label && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                isBreak ? "bg-rest/15 text-rest" : "bg-accent/15 text-accent-glow"
              }`}
            >
              {label}
            </span>
          )}
          <span
            className={`uppercase tracking-wider text-[10px] ${
              timer.status === "running"
                ? "text-rest"
                : timer.status === "paused"
                ? "text-focus"
                : timer.status === "completed"
                ? "text-accent-glow"
                : "text-ink-400"
            }`}
          >
            {timer.status}
          </span>
        </span>
      </div>

      <svg width={size} height={size} className="my-1">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--hairline)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 250ms linear, stroke 300ms" }}
        />
        {/* `currentColor` + text-ink-100 so digits follow the theme; the
            old hard-coded #e3e6ec was invisible on the light palette. */}
        <text
          x="50%" y={structured ? "46%" : "50%"}
          textAnchor="middle"
          dominantBaseline="central"
          className="tnum text-ink-100"
          fill="currentColor"
          fontSize={hero ? 42 : compact ? 20 : 26}
          fontWeight={600}
        >
          {formatRemaining(ringLeft)}
        </text>
        {structured && !compact && (
          <text
            x="50%" y="62%"
            textAnchor="middle"
            dominantBaseline="central"
            className="tnum text-ink-400"
            fill="currentColor"
            fontSize="10"
          >
            {formatRemaining(timer.remaining_ms)} total
          </text>
        )}
      </svg>

      {structured && (
        <div className="w-full" title="Whole session: focus (accent) and break (green) phases">
          <div className="flex h-1 w-full gap-px rounded overflow-hidden relative">
            {timer.phases.map((p, i) => (
              <span
                key={i}
                style={{ flex: p.duration_ms, opacity: i < timer.phase_index ? 0.35 : i === timer.phase_index ? 1 : 0.6 }}
                className={p.kind === "focus" ? "bg-accent/70" : "bg-rest/70"}
              />
            ))}
            <span
              className="absolute top-0 bottom-0 w-px bg-ink-100"
              style={{ left: `${sessionProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={toggle}
          className={hero ? "btn-primary px-6" : "btn"}
        >
          {timer.status === "running" ? "Pause" : timer.status === "paused" ? "Resume" : "Start"}
        </button>
        {!compact && (
          <button onClick={reset} className="btn">
            Reset
          </button>
        )}
        <button
          onClick={remove}
          className="icon-button text-ink-400 hover:text-danger"
          title="Delete"
          aria-label={`Delete timer ${timer.name}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
