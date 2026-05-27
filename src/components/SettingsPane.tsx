import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsUi } from "@/store/settings";
import { useApp } from "@/store/app";
import { settings as settingsApi, type SettingsBundle } from "@/lib/settings";
import { ai } from "@/lib/ai";

type Tab = "ai" | "timers" | "audio" | "focus";

/**
 * Tabbed settings overlay. Opens via `useSettingsUi.toggle()` — bound to
 * Ctrl/Cmd+, in App.tsx and exposed in the command palette.
 *
 * All writes hit the backend immediately; reads come from a single
 * `settings_get` bundle on open so the pane renders in one round-trip even
 * when Ollama is offline (the health probe failure leaves `installed_models`
 * empty but doesn't break the rest of the pane).
 */
export function SettingsPane() {
  const open = useSettingsUi((s) => s.open);
  const setOpen = useSettingsUi((s) => s.setOpen);
  const [tab, setTab] = useState<Tab>("ai");
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    settingsApi
      .get()
      .then(setBundle)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-[680px] max-w-[94vw] h-[460px] glass rounded-xl border border-ink-700/60 overflow-hidden flex flex-col"
          >
            <header className="px-4 py-2.5 border-b border-ink-700/40 flex items-center">
              <span className="text-sm font-medium text-ink-100">Settings</span>
              <span className="ml-auto text-[10px] text-ink-500">
                <kbd className="border border-ink-700 rounded px-1">Esc</kbd> close
              </span>
            </header>
            <div className="flex-1 min-h-0 flex">
              {/* Tab rail */}
              <nav className="w-28 border-r border-ink-700/40 py-2 flex flex-col">
                {(["ai", "timers", "audio", "focus"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`text-left text-xs px-3 py-1.5 ${
                      tab === t
                        ? "text-accent-glow bg-accent/10 border-l-2 border-accent"
                        : "text-ink-400 hover:text-ink-100"
                    }`}
                  >
                    {t === "ai" ? "Nerva AI" : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>
              {/* Body */}
              <div className="flex-1 min-w-0 p-4 overflow-y-auto">
                {loading && <div className="text-xs text-ink-500">loading…</div>}
                {err && <div className="text-xs text-red-400">{err}</div>}
                {!loading && bundle && (
                  <>
                    {tab === "ai" && <AiTab bundle={bundle} onChange={setBundle} />}
                    {tab === "timers" && <TimersTab bundle={bundle} onChange={setBundle} />}
                    {tab === "audio" && <AudioTab />}
                    {tab === "focus" && <FocusTab />}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface TabProps {
  bundle: SettingsBundle;
  onChange: (b: SettingsBundle) => void;
}

function AiTab({ bundle, onChange }: TabProps) {
  // Local edit buffers so users can fix typos before committing. We only
  // write on blur/Enter to avoid spamming the backend on every keystroke.
  const [endpoint, setEndpoint] = useState(bundle.ai_endpoint);
  const [model, setModel] = useState(bundle.ai_model);
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [endpointErr, setEndpointErr] = useState<string | null>(null);

  useEffect(() => { setEndpoint(bundle.ai_endpoint); }, [bundle.ai_endpoint]);
  useEffect(() => { setModel(bundle.ai_model); }, [bundle.ai_model]);

  async function commitEndpoint() {
    if (endpoint === bundle.ai_endpoint) return;
    setSavingEndpoint(true);
    setEndpointErr(null);
    try {
      const next = await ai.setEndpoint(endpoint);
      // Re-probe installed models after endpoint change so the model picker
      // reflects what's actually available on the new sidecar.
      const refreshed = await settingsApi.get();
      onChange({ ...refreshed, ai_endpoint: next.endpoint });
    } catch (e) {
      setEndpointErr(String(e));
      setEndpoint(bundle.ai_endpoint);
    } finally {
      setSavingEndpoint(false);
    }
  }

  async function commitModel(next: string) {
    if (!next || next === bundle.ai_model) return;
    setSavingModel(true);
    try {
      const updated = await ai.setModel(next);
      onChange({ ...bundle, ai_model: updated.model });
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field
        label="Ollama endpoint"
        help="Base URL of your local LLM sidecar. Default http://localhost:11434."
      >
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onBlur={commitEndpoint}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
          className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
        />
        <Status saving={savingEndpoint} error={endpointErr} />
      </Field>
      <Field
        label="Model"
        help={
          bundle.installed_models.length
            ? `${bundle.installed_models.length} installed`
            : "Sidecar offline — type a model name manually"
        }
      >
        {bundle.installed_models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); commitModel(e.target.value); }}
            className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs text-ink-100"
          >
            {!bundle.installed_models.includes(model) && (
              <option value={model}>{model} (not installed)</option>
            )}
            {bundle.installed_models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => commitModel(model)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            spellCheck={false}
            className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
          />
        )}
        <Status saving={savingModel} />
      </Field>
    </section>
  );
}

function TimersTab({ bundle, onChange }: TabProps) {
  const [draft, setDraft] = useState(bundle.timer_presets_min.join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setDraft(bundle.timer_presets_min.join(", ")); }, [bundle.timer_presets_min]);

  async function commit() {
    const parsed = draft
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length === 0) {
      setErr("at least one positive number required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const next = await settingsApi.setTimerPresets(parsed);
      onChange({ ...bundle, timer_presets_min: next });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field
        label="Default timer durations (minutes)"
        help="Comma-separated list, shown as quick presets when creating a timer. Auto-sorted + deduped on save."
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
          className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
        />
        <Status saving={saving} error={err} />
        <div className="mt-2 flex flex-wrap gap-1">
          {bundle.timer_presets_min.map((m) => (
            <span
              key={m}
              className="text-[10px] px-1.5 py-0.5 rounded bg-ink-800 text-ink-300"
            >
              {m}m
            </span>
          ))}
        </div>
      </Field>
    </section>
  );
}

function AudioTab() {
  const audio = useApp((s) => s.audio);
  const setVolume = useApp((s) => s.setVolume);
  const setMuted = useApp((s) => s.setMuted);
  const testAudio = useApp((s) => s.testAudio);

  if (!audio) return <div className="text-xs text-ink-500">audio engine unavailable</div>;
  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field label="Completion ding volume" help="Plays when a timer reaches zero.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.muted ? 0 : audio.volume}
            disabled={audio.muted}
            onChange={(e) => void setVolume(Number(e.target.value))}
            className="flex-1 accent-accent h-1"
          />
          <span className="text-[10px] text-ink-400 w-8 text-right tnum">
            {Math.round((audio.muted ? 0 : audio.volume) * 100)}%
          </span>
        </div>
      </Field>
      <div className="flex items-center gap-3">
        <Toggle
          label="Muted"
          on={audio.muted}
          onChange={(v) => void setMuted(v)}
        />
        <button
          onClick={() => void testAudio()}
          className="text-[11px] px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 text-accent-glow"
        >
          Play test ding
        </button>
      </div>
      {!audio.available && (
        <div className="text-[11px] text-amber-400">
          Host audio device not detected. Ding will be a no-op until audio is available.
        </div>
      )}
    </section>
  );
}

function FocusTab() {
  const focus = useApp((s) => s.focus);
  const setDnd = useApp((s) => s.setDnd);
  if (!focus) return <div className="text-xs text-ink-500">focus state unavailable</div>;
  if (!focus.supported) {
    return (
      <div className="text-xs text-ink-400">
        Do Not Disturb integration isn't available on this platform yet. On
        Linux this requires a desktop portal that exposes the focus state;
        Nerva will pick it up automatically once present.
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-4 text-sm">
      <Toggle
        label="Do Not Disturb"
        on={!!focus.dnd}
        onChange={(v) => void setDnd(v)}
      />
      <p className="text-[11px] text-ink-500">
        Toggles your system focus state. Nerva also flips this automatically
        when a focus timer starts (if configured).
      </p>
    </section>
  );
}

// ---- small primitives ----

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-ink-400 mb-1">
        {label}
      </label>
      {children}
      {help && <div className="mt-1 text-[10px] text-ink-500">{help}</div>}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <span
        onClick={() => onChange(!on)}
        className={`w-7 h-4 rounded-full relative transition-colors ${
          on ? "bg-accent" : "bg-ink-700"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-ink-100 transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
      <span className="text-xs text-ink-200">{label}</span>
    </label>
  );
}

function Status({ saving, error }: { saving?: boolean; error?: string | null }) {
  if (error) return <div className="mt-1 text-[10px] text-red-400">{error}</div>;
  if (saving) return <div className="mt-1 text-[10px] text-ink-500">saving…</div>;
  return null;
}
