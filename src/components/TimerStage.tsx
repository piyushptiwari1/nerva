import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/store/app";
import { ipc, formatRemaining, type Timer } from "@/lib/ipc";

const PRESETS: Array<{ label: string; ms: number; color: string }> = [
  { label: "25m Focus", ms: 25 * 60_000, color: "#7c9cff" },
  { label: "50m Deep", ms: 50 * 60_000, color: "#a8bdff" },
  { label: "90m Deep Work", ms: 90 * 60_000, color: "#e8b86d" },
  { label: "5m Break", ms: 5 * 60_000, color: "#7dd6a8" },
  { label: "8m Tea", ms: 8 * 60_000, color: "#7dd6a8" },
];

export function TimerStage() {
  const { timers, refreshTimers } = useApp();
  const [creating, setCreating] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customMin, setCustomMin] = useState(25);

  async function spawnPreset(p: typeof PRESETS[number]) {
    const t = await ipc.timerCreate({ name: p.label, duration_ms: p.ms, color: p.color });
    await ipc.timerStart(t.id);
    await refreshTimers();
  }

  async function spawnCustom() {
    if (!customName.trim() || customMin <= 0) return;
    const t = await ipc.timerCreate({
      name: customName.trim(),
      duration_ms: customMin * 60_000,
    });
    await ipc.timerStart(t.id);
    setCustomName("");
    setCreating(false);
    await refreshTimers();
  }

  return (
    <section className="glass rounded-xl p-4 flex flex-col gap-4 min-h-0">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-100">Focus stage</h2>
          <p className="text-xs text-ink-400">
            Parallel timers, wall-clock math, survives reboot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ipc.openTimerWidget()}
            className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-700 text-ink-300"
            title="Open as floating always-on-top widget"
          >
            ↗ pop up
          </button>
          <button
            onClick={() => setCreating((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
          >
            {creating ? "Cancel" : "+ New timer"}
          </button>
        </div>
      </header>

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
                  placeholder="Custom timer name"
                  className="flex-1 bg-ink-800 hairline rounded-md px-2.5 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  value={customMin}
                  onChange={(e) => setCustomMin(parseInt(e.target.value || "0", 10))}
                  className="w-20 bg-ink-800 hairline rounded-md px-2 py-1.5 text-sm tnum"
                />
                <span className="text-xs text-ink-400">min</span>
                <button
                  onClick={spawnCustom}
                  className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
                >
                  Start
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-3 content-start">
        {timers.length === 0 && (
          <div className="col-span-full text-center text-ink-400 py-16">
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
        {timers.map((t) => (
          <TimerCard key={t.id} timer={t} onChange={refreshTimers} />
        ))}
      </div>
    </section>
  );
}

function TimerCard({ timer, onChange }: { timer: Timer; onChange: () => Promise<void> }) {
  const progress =
    timer.duration_ms > 0
      ? 1 - Math.max(0, Math.min(1, timer.remaining_ms / timer.duration_ms))
      : 0;
  const size = 160;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * progress;

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
  async function remove() { await ipc.timerDelete(timer.id); await onChange(); }

  return (
    <div
      className="glass rounded-xl p-4 flex flex-col items-center gap-2"
      style={{ borderTop: `2px solid ${timer.color}` }}
    >
      <div className="w-full flex items-center justify-between text-xs">
        <span className="text-ink-200 truncate">{timer.name}</span>
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
      </div>

      <svg width={size} height={size} className="my-1">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={timer.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 250ms linear" }}
        />
        <text
          x="50%" y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="tnum"
          fill="#e3e6ec"
          fontSize="26"
          fontWeight={600}
        >
          {formatRemaining(timer.remaining_ms)}
        </text>
      </svg>

      <div className="flex gap-2">
        <button
          onClick={toggle}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
        >
          {timer.status === "running" ? "Pause" : timer.status === "paused" ? "Resume" : "Start"}
        </button>
        <button
          onClick={reset}
          className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-700"
        >
          Reset
        </button>
        <button
          onClick={remove}
          className="text-xs px-2.5 py-1.5 rounded-md hairline hover:bg-danger/20 text-ink-400 hover:text-danger"
          title="Delete"
        >
          ×
        </button>
      </div>
    </div>
  );
}
