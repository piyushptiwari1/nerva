import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsUi } from "@/store/settings";
import { useApp } from "@/store/app";
import { settings as settingsApi, type SettingsBundle, diag, type CrashEntry } from "@/lib/settings";
import { ai, AI_PROVIDERS, type AiProvider } from "@/lib/ai";
import { ipc } from "@/lib/ipc";
import {
  consentState as telemetryConsentState,
  setConsent as setTelemetryConsent,
} from "@/lib/telemetry";
import { ALL_SECTIONS, useLayout } from "@/store/layout";
import { FeedbackForm } from "@/components/Feedback";
import { BUY_URL, planLabel, useLicense } from "@/lib/license";
import { isMobile } from "@/lib/platform";

type Tab = "ai" | "timers" | "audio" | "focus" | "layout" | "pro" | "feedback" | "diag" | "about";
const DESKTOP_TABS: Tab[] = ["ai", "timers", "audio", "focus", "layout", "pro", "feedback", "diag", "about"];
// No sidebar layout, DND or synthesized audio on phones.
const MOBILE_TABS: Tab[] = ["timers", "ai", "pro", "feedback", "diag", "about"];
const TABS: Tab[] = isMobile() ? MOBILE_TABS : DESKTOP_TABS;

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
  const consumePendingTab = useSettingsUi((s) => s.consumePendingTab);
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Honor deep-link from the command palette (e.g. "Reset Nerva" opens
    // Settings already focused on Diagnostics so the button is in view).
    const pending = consumePendingTab();
    if (pending && (TABS as string[]).includes(pending)) {
      setTab(pending as Tab);
    }
    setLoading(true);
    setErr(null);
    settingsApi
      .get()
      .then(setBundle)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [open, consumePendingTab]);

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
            className={
              isMobile()
                ? "w-full h-full glass overflow-hidden flex flex-col"
                : "w-[680px] max-w-[94vw] h-[460px] glass rounded-xl border border-ink-700/60 overflow-hidden flex flex-col"
            }
          >
            <header className="px-4 py-2.5 border-b border-ink-700/40 flex items-center">
              <span className="text-sm font-medium text-ink-100">Settings</span>
              <span className="ml-2 text-[10px] text-ink-500">Nerva by Bytical</span>
              {isMobile() ? (
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto w-9 h-9 grid place-items-center rounded-md text-ink-300 active:bg-ink-800 text-base"
                  aria-label="Close settings"
                >
                  ×
                </button>
              ) : (
                <span className="ml-auto text-[10px] text-ink-500">
                  <kbd className="border border-ink-700 rounded px-1">Esc</kbd> close
                </span>
              )}
            </header>
            <div className="flex-1 min-h-0 flex">
              {/* Tab rail */}
              <nav className="w-28 border-r border-ink-700/40 py-2 flex flex-col" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`text-left text-xs px-3 py-1.5 ${
                      tab === t
                        ? "text-accent-glow bg-accent/10 border-l-2 border-accent"
                        : "text-ink-400 hover:text-ink-100"
                    }`}
                  >
                    {t === "ai"
                      ? "Nerva AI"
                      : t === "diag"
                      ? "Diagnostics"
                      : t[0].toUpperCase() + t.slice(1)}
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
                    {tab === "layout" && <LayoutTab />}
                    {tab === "pro" && <ProTab />}
                    {tab === "feedback" && <FeedbackForm />}
                    {tab === "diag" && <DiagTab />}
                    {tab === "about" && <AboutTab />}
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
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState<"provider" | "endpoint" | "model" | "key" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setEndpoint(bundle.ai_endpoint); }, [bundle.ai_endpoint]);
  useEffect(() => { setModel(bundle.ai_model); }, [bundle.ai_model]);

  const providerMeta = AI_PROVIDERS.find((p) => p.id === bundle.ai_provider) ?? AI_PROVIDERS[0];

  async function refreshBundle() {
    // Re-probe so the health line + model list reflect the new config.
    const refreshed = await settingsApi.get();
    onChange(refreshed);
  }

  async function switchProvider(p: AiProvider) {
    if (p === bundle.ai_provider) return;
    setSaving("provider");
    setErr(null);
    try {
      await ai.setProvider(p);
      await refreshBundle();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function commitEndpoint() {
    if (endpoint === bundle.ai_endpoint) return;
    setSaving("endpoint");
    setErr(null);
    try {
      await ai.setEndpoint(endpoint);
      await refreshBundle();
    } catch (e) {
      setErr(String(e));
      setEndpoint(bundle.ai_endpoint);
    } finally {
      setSaving(null);
    }
  }

  async function commitModel(next: string) {
    if (!next || next === bundle.ai_model) return;
    setSaving("model");
    try {
      const updated = await ai.setModel(next);
      onChange({ ...bundle, ai_model: updated.model });
    } finally {
      setSaving(null);
    }
  }

  async function commitKey() {
    if (!key.trim()) return;
    setSaving("key");
    setErr(null);
    try {
      await ai.setApiKey(key.trim());
      setKey("");
      await refreshBundle();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function clearKey() {
    setSaving("key");
    try {
      await ai.setApiKey("");
      await refreshBundle();
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field
        label="Provider"
        help="Ask Nerva runs on a local Ollama model by default. Bring your own key to use a hosted model instead — keys stay on this device (never synced, never included in telemetry)."
      >
        <div className="flex flex-wrap gap-1.5">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => void switchProvider(p.id)}
              title={p.hint}
              disabled={saving === "provider"}
              className={`text-[11px] px-2 py-1 rounded border ${
                bundle.ai_provider === p.id
                  ? "bg-accent/20 border-accent text-accent-glow"
                  : "border-ink-700 hover:bg-ink-800 text-ink-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${bundle.ai_available ? "bg-rest" : "bg-danger"}`}
            aria-hidden
          />
          <span className={bundle.ai_available ? "text-rest" : "text-ink-400"}>
            {bundle.ai_available
              ? `Connected · ${bundle.installed_models.length} model${bundle.installed_models.length === 1 ? "" : "s"} available`
              : bundle.ai_error ?? "Not reachable"}
          </span>
        </div>
      </Field>

      {bundle.ai_needs_key && (
        <Field
          label="API key"
          help={
            bundle.ai_has_api_key
              ? `Stored (${bundle.ai_api_key_hint ?? "hidden"}). Paste a new one to replace it.`
              : "Required for this provider."
          }
        >
          <div className="flex gap-1.5">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void commitKey(); }}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={bundle.ai_has_api_key ? "paste new key to replace…" : "sk-…"}
              className="flex-1 bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
              aria-label="API key"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="text-[11px] px-2 rounded hairline hover:bg-ink-800 text-ink-300"
              title={showKey ? "Hide" : "Show"}
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? "hide" : "show"}
            </button>
            <button
              onClick={() => void commitKey()}
              disabled={!key.trim() || saving === "key"}
              className="text-[11px] px-2 rounded bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
            >
              Save
            </button>
            {bundle.ai_has_api_key && (
              <button
                onClick={() => void clearKey()}
                className="text-[11px] px-2 rounded hairline hover:bg-danger/20 text-ink-400 hover:text-danger"
              >
                Remove
              </button>
            )}
          </div>
          {providerMeta.keyUrl && (
            <div className="mt-1 text-[10px] text-ink-500">
              Get a key:{" "}
              <a href={providerMeta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent-glow hover:underline">
                {providerMeta.keyUrl.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
        </Field>
      )}

      <Field
        label={bundle.ai_provider === "ollama" ? "Ollama endpoint" : "Endpoint (base URL)"}
        help={
          bundle.ai_provider === "ollama"
            ? "Base URL of your local LLM sidecar. Default http://localhost:11434."
            : bundle.ai_provider === "custom"
              ? "Any OpenAI-compatible server, e.g. http://localhost:1234/v1 (LM Studio) or https://api.groq.com/openai/v1."
              : "Leave as default unless you use a proxy or regional endpoint."
        }
      >
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onBlur={commitEndpoint}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
          className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
        />
        <Status saving={saving === "endpoint"} error={err} />
      </Field>
      <Field
        label="Model"
        help={
          bundle.installed_models.length
            ? `${bundle.installed_models.length} available`
            : "Provider offline — type a model name manually"
        }
      >
        {bundle.installed_models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); commitModel(e.target.value); }}
            className="w-full bg-ink-900 hairline rounded px-2 py-1 text-xs text-ink-100"
            aria-label="Model"
          >
            {!bundle.installed_models.includes(model) && (
              <option value={model}>{model} (not listed)</option>
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
            aria-label="Model"
          />
        )}
        <Status saving={saving === "model"} />
      </Field>
      {bundle.ai_provider !== "ollama" && (
        <p className="text-[10px] text-ink-500 leading-relaxed">
          Semantic note search keeps using local Ollama embeddings regardless of the chat provider,
          so your note text is never sent to a third party for indexing. Ask Nerva prompts (and the
          workspace context you opt into) are sent to the provider you choose.
        </p>
      )}
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
      <Field
        label="Auto breaks (pomodoro structure)"
        help="Timers of 30 min or more are split into 25-min focus blocks with 5-min breaks (15 min every 4th) inside ONE timer. Sessions always end on focus. Shorter timers are never split. You can override this per timer."
      >
        <Toggle
          label={bundle.timer_auto_breaks ? "On — new long timers include breaks" : "Off — every timer is one focus block"}
          on={bundle.timer_auto_breaks}
          onChange={(v) => {
            void settingsApi
              .setTimerAutoBreaks(v)
              .then((next) => onChange({ ...bundle, timer_auto_breaks: next }));
          }}
        />
        <div className="mt-2 text-[10px] text-ink-500 tnum">
          e.g. 60m → 25 focus · 5 break · 30 focus &nbsp;│&nbsp; 2h → 25·5·25·5·25·5·30
        </div>
      </Field>
    </section>
  );
}

function AudioTab() {
  const audio = useApp((s) => s.audio);
  const setVolume = useApp((s) => s.setVolume);
  const setMuted = useApp((s) => s.setMuted);
  const setSound = useApp((s) => s.setSound);
  const testAudio = useApp((s) => s.testAudio);
  const setAmbient = useApp((s) => s.setAmbient);
  const setAmbientVolume = useApp((s) => s.setAmbientVolume);

  if (!audio) return <div className="text-xs text-ink-500">audio engine unavailable</div>;

  const sounds: { id: import("@/lib/ipc").CompletionSound; label: string; hint: string }[] = [
    { id: "classic", label: "Classic", hint: "descending three-note chime — warm, resolved" },
    { id: "chime", label: "Chime", hint: "ascending arpeggio — bright, celebratory" },
    { id: "bell", label: "Bell", hint: "struck bell, two strikes, long shimmer" },
    { id: "beep", label: "Beep", hint: "crisp triple-beep — cuts through noise" },
    { id: "soft", label: "Soft", hint: "slow swell with a long tail — unobtrusive" },
  ];

  const kinds: { id: "white" | "pink" | "brown"; label: string; hint: string }[] = [
    { id: "pink", label: "Pink", hint: "balanced, warm — best for focus" },
    { id: "brown", label: "Brown", hint: "deeper, rumbling — masks low freq noise" },
    { id: "white", label: "White", hint: "flat spectrum — harsher, calibration only" },
  ];

  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field
        label="Completion sound"
        help="Pick the ding that plays when a timer reaches zero. Selecting one plays a preview."
      >
        <div className="flex flex-wrap gap-1.5">
          {sounds.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                void setSound(s.id).then(() => testAudio());
              }}
              title={s.hint}
              className={`text-[11px] px-2 py-1 rounded border ${
                audio.sound === s.id
                  ? "bg-accent/20 border-accent text-accent-glow"
                  : "border-ink-700 hover:bg-ink-800 text-ink-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>
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
        <Toggle label="Muted" on={audio.muted} onChange={(v) => void setMuted(v)} />
        <button
          onClick={() => void testAudio()}
          className="text-[11px] px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 text-accent-glow"
        >
          Play test ding
        </button>
      </div>
      <Field
        label="Phase cues"
        help="Structured sessions play distinct cues so you can tell them apart without looking. All derive from the family you picked above."
      >
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["break", "Break starts", "two descending notes — relax"],
              ["focus", "Focus resumes", "two ascending notes — go"],
              ["resume", "Resume / restart", "one short tick"],
            ] as const
          ).map(([cue, label, hint]) => (
            <button
              key={cue}
              onClick={() => void ipc.audioTestCue(cue)}
              title={hint}
              className="text-[11px] px-2 py-1 rounded border border-ink-700 hover:bg-ink-800 text-ink-200"
            >
              ▶ {label}
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="Ambient noise"
        help="Procedurally generated background hiss. Survives app restart only if you press Play again — Nerva doesn't auto-resume on boot."
      >
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => void setAmbient(null)}
            className={`text-[11px] px-2 py-1 rounded border ${
              audio.ambient === null
                ? "bg-accent/20 border-accent text-accent-glow"
                : "border-ink-700 hover:bg-ink-800 text-ink-200"
            }`}
          >
            Off
          </button>
          {kinds.map((k) => (
            <button
              key={k.id}
              onClick={() => void setAmbient(k.id)}
              title={k.hint}
              className={`text-[11px] px-2 py-1 rounded border ${
                audio.ambient === k.id
                  ? "bg-accent/20 border-accent text-accent-glow"
                  : "border-ink-700 hover:bg-ink-800 text-ink-200"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-ink-500 w-16">volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={audio.ambient_volume}
            onChange={(e) => void setAmbientVolume(Number(e.target.value))}
            className="flex-1 accent-accent h-1"
          />
          <span className="text-[10px] text-ink-400 w-8 text-right tnum">
            {Math.round(audio.ambient_volume * 100)}%
          </span>
        </div>
      </Field>
      {!audio.available && (
        <div className="text-[11px] text-amber-400">
          Host audio device not detected. Ambient + ding will be no-ops until audio is available.
        </div>
      )}
    </section>
  );
}

function LayoutTab() {
  const order = useLayout((s) => s.order);
  const hidden = useLayout((s) => s.hidden);
  const move = useLayout((s) => s.move);
  const setHidden = useLayout((s) => s.setHidden);
  const showTimeline = useLayout((s) => s.showTimeline);
  const setShowTimeline = useLayout((s) => s.setShowTimeline);
  const reset = useLayout((s) => s.reset);
  const meta = Object.fromEntries(ALL_SECTIONS.map((s) => [s.id, s]));

  return (
    <section className="flex flex-col gap-4 text-sm">
      <Field
        label="Sidebar sections"
        help="Show, hide and reorder what lives in the left column. Changes apply instantly and are saved on this device."
      >
        <ul className="flex flex-col gap-1">
          {order.map((id, i) => {
            const isHidden = hidden.includes(id);
            return (
              <li
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ink-900/60 hairline"
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={(e) => setHidden(id, !e.target.checked)}
                  aria-label={`Show ${meta[id].label}`}
                  className="accent-[rgb(var(--accent))]"
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs ${isHidden ? "text-ink-500 line-through" : "text-ink-100"}`}>
                    {meta[id].label}
                  </div>
                  <div className="text-[10px] text-ink-500 truncate">{meta[id].hint}</div>
                </div>
                <button
                  onClick={() => move(id, -1)}
                  disabled={i === 0}
                  className="text-ink-400 hover:text-ink-100 disabled:opacity-30 px-1"
                  aria-label={`Move ${meta[id].label} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(id, 1)}
                  disabled={i === order.length - 1}
                  className="text-ink-400 hover:text-ink-100 disabled:opacity-30 px-1"
                  aria-label={`Move ${meta[id].label} down`}
                  title="Move down"
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ul>
        <button
          onClick={reset}
          className="mt-2 text-[11px] px-2 py-0.5 rounded hairline hover:bg-ink-800 text-ink-300"
        >
          Reset to default
        </button>
      </Field>
      <Field
        label="Advanced"
        help="The event timeline is a raw replay of everything Nerva records (timer started, note saved…). Handy for debugging; most people won't need it."
      >
        <label className="flex items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={showTimeline}
            onChange={(e) => setShowTimeline(e.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Show event timeline at the bottom of the window
        </label>
      </Field>
    </section>
  );
}

function ProTab() {
  const {
    status, key, devices, limit, busy, error, limitHit, isPro,
    activate, deactivateDevice, deactivateHere, recover,
  } = useLicense();
  const [draft, setDraft] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverState, setRecoverState] = useState<"idle" | "sent" | "fail">("idle");

  async function onActivate() {
    const ok = await activate(draft);
    if (ok) setDraft("");
  }

  const exp = status?.license_exp ?? null;
  const tokenExp = status?.token_exp ?? null;

  return (
    <section className="flex flex-col gap-4 text-sm">
      <div className={`rounded-lg p-3 flex items-start gap-3 ${isPro ? "border border-focus/40 bg-focus/5" : "hairline bg-ink-900/60"}`}>
        <span
          className={`mt-0.5 w-6 h-6 rounded-md grid place-items-center text-[11px] font-semibold ${
            isPro ? "bg-focus/20 border border-focus/40 text-focus" : "bg-ink-800 text-ink-400"
          }`}
        >
          ★
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-ink-100">
            {isPro ? `Nerva Pro · ${planLabel(status?.plan)}` : "Nerva Free"}
          </div>
          <div className="text-[11px] text-ink-400 mt-0.5">
            {isPro
              ? `${exp ? `Valid until ${new Date(exp * 1000).toLocaleDateString()}` : "Lifetime licence"}${status?.email_hint ? ` · ${status.email_hint}` : ""}${
                  tokenExp ? ` · device check renews ${new Date(tokenExp * 1000).toLocaleDateString()}` : ""
                }`
              : "Everything you use today stays free forever. Pro adds encrypted Google Drive backup and multi-device restore (shipping next), and helps fund development."}
            {!isPro && status?.reason && key ? ` · ${status.reason}` : ""}
          </div>
        </div>
      </div>

      {!isPro && (
        <Field label="Get Nerva Pro" help="Monthly, yearly or lifetime via PayU (INR; international cards accepted). Your key arrives by email and on the purchase page.">
          <a
            href={BUY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
          >
            See plans → nerva.bytical.ai/#pro
          </a>
        </Field>
      )}

      <Field
        label={isPro ? "Licence key" : "Already have a key?"}
        help={
          isPro
            ? "This device is registered to your licence. Deactivate to free the slot for another machine."
            : "Paste the NERVA-… key. The same key works on every device you own, up to the plan limit."
        }
      >
        {isPro && key ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-[11px] text-ink-300 bg-ink-900 hairline rounded px-2 py-1">
              {key.slice(0, 18)}…{key.slice(-6)}
            </code>
            <button
              onClick={() => {
                if (window.confirm("Deactivate Nerva Pro on this device?")) void deactivateHere();
              }}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded hairline hover:bg-danger/20 text-ink-300 hover:text-danger disabled:opacity-40"
            >
              Deactivate here
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onActivate()}
              placeholder="NERVA-…"
              spellCheck={false}
              className="flex-1 bg-ink-900 hairline rounded px-2 py-1 text-xs font-mono text-ink-100"
            />
            <button
              onClick={() => void onActivate()}
              disabled={busy || !draft.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
            >
              {busy ? "Checking…" : "Activate"}
            </button>
          </div>
        )}
        {error && <div className="mt-1 text-[11px] text-danger">{error}</div>}
      </Field>

      {(isPro || limitHit) && (
        <Field
          label={`Devices${limit ? ` · ${devices.length}/${limit}` : ""}`}
          help={
            limitHit
              ? "This licence is already active on the maximum number of devices. Remove one to activate here."
              : "Monthly 2 · Yearly 3 · Lifetime 5 simultaneous devices. Removing a device frees its slot immediately."
          }
        >
          <ul className="flex flex-col gap-1">
            {devices.length === 0 && <li className="text-[11px] text-ink-500">Device list loads after the next online check.</li>}
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ink-900/60 hairline text-xs">
                <span className="flex-1 min-w-0 truncate text-ink-200">
                  {d.name}
                  {d.this_device && <span className="ml-1 text-[10px] text-focus">(this device)</span>}
                </span>
                <span className="text-[10px] text-ink-500 tnum">{String(d.last_seen).slice(0, 10)}</span>
                {!d.this_device && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${d.name}" from this licence?`)) void deactivateDevice(d.id);
                    }}
                    disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded hairline hover:bg-danger/20 text-ink-400 hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {limitHit && draft.trim() && (
            <button
              onClick={() => void onActivate()}
              disabled={busy}
              className="mt-2 text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
            >
              Retry activation here
            </button>
          )}
        </Field>
      )}

      {!isPro && (
        <Field label="Lost your key?" help="We'll email every licence registered to this address. Nothing else is revealed.">
          <div className="flex items-center gap-2">
            <input
              value={recoverEmail}
              onChange={(e) => setRecoverEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="flex-1 bg-ink-900 hairline rounded px-2 py-1 text-xs text-ink-100"
            />
            <button
              onClick={async () => setRecoverState((await recover(recoverEmail.trim())) ? "sent" : "fail")}
              disabled={!/^\S+@\S+\.\S+$/.test(recoverEmail)}
              className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-800 text-ink-200 disabled:opacity-40"
            >
              Email my keys
            </button>
          </div>
          {recoverState === "sent" && <div className="mt-1 text-[11px] text-rest">If that address has a licence, the email is on its way.</div>}
          {recoverState === "fail" && <div className="mt-1 text-[11px] text-danger">Couldn't reach the server — try again later.</div>}
        </Field>
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

function DiagTab() {
  const [list, setList] = useState<CrashEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; body: string } | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const bootstrapErrors = useApp((s) => s.bootstrapErrors);

  useEffect(() => {
    ipc.runtime()
      .then((info) => {
        setDataDir(info.data_dir);
        setEventCount(info.event_count);
      })
      .catch(() => void 0);
  }, []);

  async function reveal() {
    try {
      await ipc.revealDataDir();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function resetAll() {
    const ok = confirm(
      "Reset Nerva to a clean state?\n\n" +
        "This wipes every task, timer, note, habit, and workspace from your " +
        "local database. A timestamped backup of the database is kept inside " +
        "the data folder so support can recover it by hand if needed.\n\n" +
        "Nerva will relaunch automatically.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      // Clear UI-side localStorage too, so the tutorial replays on first launch.
      // Preserve theme + UI preferences — they're not what the user wants gone.
      try {
        const KEEP = new Set(["nerva-theme"]);
        const drop: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && !KEEP.has(k)) drop.push(k);
        }
        drop.forEach((k) => localStorage.removeItem(k));
      } catch {
        /* private mode etc. — best-effort */
      }
      await ipc.resetAllData();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  async function refresh() {
    setErr(null);
    try {
      setList(await diag.listCrashes());
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function open(name: string) {
    try {
      const body = await diag.readCrash(name);
      setViewing({ name, body });
    } catch (e) {
      setErr(String(e));
    }
  }

  async function clear() {
    if (!list || list.length === 0) return;
    if (!confirm(`Delete ${list.length} crash log${list.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      await diag.clearCrashes();
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 text-sm">
      <div className="text-[11px] text-ink-400 leading-relaxed">
        Local-only panic logs. Nerva writes a file here whenever the Rust
        backend crashes, then surfaces them so you can copy the stack trace
        into a bug report. Nothing is uploaded — files live under your
        platform's user data directory.
      </div>

      {/* Storage / recovery — the escape hatch when the on-disk state goes bad. */}
      <div className="border border-ink-700/60 rounded-md p-2.5 flex flex-col gap-1.5">
        <div className="text-[11px] font-medium text-ink-200">Storage</div>
        {dataDir && (
          <div className="text-[10px] text-ink-400 font-mono break-all leading-snug">
            {dataDir}
          </div>
        )}
        {eventCount !== null && (
          <div className="text-[10px] text-ink-500 tnum">
            {eventCount.toLocaleString()} event{eventCount === 1 ? "" : "s"} in store
          </div>
        )}
        {bootstrapErrors.length > 0 && (
          <div className="text-[10px] text-amber-300 leading-snug">
            ⚠ Partial boot — some panels failed to load: {bootstrapErrors.join(", ")}.
            If symptoms persist, try Reset.
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 mt-1">
          <button
            onClick={() => void reveal()}
            className="text-[11px] px-2 py-0.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200"
          >
            Open data folder
          </button>
          <button
            onClick={() => void resetAll()}
            disabled={busy}
            className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset all data…
          </button>
        </div>
        <div className="text-[10px] text-ink-500 leading-snug">
          Reset keeps a timestamped <code>backup-…</code> copy of the database
          inside the same folder. Nothing is sent off-device.
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void refresh()}
          className="text-[11px] px-2 py-0.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200"
        >
          Refresh
        </button>
        <button
          onClick={() => void clear()}
          disabled={busy || !list || list.length === 0}
          className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear all
        </button>
      </div>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      {list && list.length === 0 && (
        <div className="text-[11px] text-ink-500">No crashes recorded. </div>
      )}
      {list && list.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {list.map((c) => (
            <li
              key={c.name}
              className="border border-ink-700/60 rounded px-2 py-1.5 hover:bg-ink-800/50 cursor-pointer"
              onClick={() => void open(c.name)}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] text-ink-100 font-mono">{c.name}</span>
                <span className="text-[10px] text-ink-500 tnum ml-auto">
                  {new Date(c.ts_ms).toLocaleString()} · {(c.size_bytes / 1024).toFixed(1)} KB
                </span>
              </div>
              {c.snippet && (
                <div className="text-[10px] text-ink-400 truncate mt-0.5">{c.snippet}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}
        >
          <div className="w-[640px] max-w-[94vw] max-h-[80vh] glass rounded-xl border border-ink-700/60 flex flex-col">
            <header className="px-3 py-2 border-b border-ink-700/40 flex items-center gap-2">
              <span className="text-xs font-mono text-ink-100">{viewing.name}</span>
              <button
                onClick={() => navigator.clipboard.writeText(viewing.body)}
                className="ml-auto text-[10px] px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 text-accent-glow"
              >
                Copy
              </button>
              <button
                onClick={() => setViewing(null)}
                className="text-[10px] px-2 py-0.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200"
              >
                Close
              </button>
            </header>
            <pre className="flex-1 min-h-0 overflow-auto text-[11px] text-ink-200 p-3 font-mono whitespace-pre-wrap">
              {viewing.body}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * About / Support panel. Surfaces what Nerva is, what version is running,
 * the project links (source, license, issues), and how to support
 * development — GitHub Sponsors first, one-time donate URL second.
 *
 * Nerva is and stays free and open source (Apache-2.0). Sponsorships fund
 * code-signing certs, CI minutes, and future cross-device sync infra.
 * There is no telemetry; this panel does not call out anywhere.
 *
 * Donate URL is intentionally a plain external link rather than an
 * in-app PayU/Stripe form — keeps the OSS desktop binary free of any
 * payment-gateway secrets and lets the supporting page (hosted on
 * nerva.bytical.ai/support) evolve independently of the app release
 * cycle. The hosted page itself reuses the Bytical platform's PayU
 * integration once it lands.
 */
function AboutTab() {
  // Version is filled in at build time by Vite (`__APP_VERSION__` in
  // vite.config). Falls back to "dev" in non-bundled runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const version: string = (globalThis as any).__APP_VERSION__ ?? "dev";

  // Opt-in anonymous usage stats — read once, then track locally. The
  // telemetry module owns persistence (localStorage).
  const [telemetryOn, setTelemetryOn] = useState(
    () => telemetryConsentState() === "granted",
  );
  function toggleTelemetry(v: boolean) {
    setTelemetryConsent(v);
    setTelemetryOn(v);
  }

  type UpdateState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "up-to-date" }
    | { kind: "available"; version: string }
    | { kind: "installing" }
    | { kind: "installed"; version: string }
    | { kind: "error"; message: string };
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });

  /**
   * Manual update check. Mirrors what `scheduleUpdateCheck()` does at boot
   * but surfaces every state to the user — including "you're already on
   * the latest" which the silent boot check swallows. Confined to the
   * desktop bundle: the dynamic import keeps web/dev builds buildable
   * even though the plugin only exists in the Tauri runtime.
   */
  async function checkForUpdates() {
    setUpdateState({ kind: "checking" });
    let phase: "check" | "install" | "relaunch" = "check";
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import("@tauri-apps/plugin-updater"),
        import("@tauri-apps/plugin-process"),
      ]);
      const update = await check();
      if (!update) {
        setUpdateState({ kind: "up-to-date" });
        return;
      }
      setUpdateState({ kind: "available", version: update.version });
      // Native confirm so we honor the user's "not now" choice without
      // building bespoke UI for download progress.
      const ok = window.confirm(
        `Nerva ${update.version} is available (you're on ${version}). ` +
          `Download and install now? Nerva will relaunch automatically.`,
      );
      if (!ok) {
        setUpdateState({ kind: "idle" });
        return;
      }
      phase = "install";
      setUpdateState({ kind: "installing" });
      await update.downloadAndInstall();
      phase = "relaunch";
      setUpdateState({ kind: "installed", version: update.version });
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[updater] ${phase} failed:`, err);
      if (phase === "relaunch") {
        // The update IS installed; only the restart failed. Don't call it a
        // failure — tell the user to restart by hand.
        setUpdateState({ kind: "installed", version: "" });
        return;
      }
      setUpdateState({ kind: "error", message: `${phase}: ${message}` });
    }
  }

  // Tauri 2's default webview opens target="_blank" links in the OS browser,
  // so plain anchors are enough — no shell plugin / IPC dance needed.
  const linkClass =
    "hover:text-ink-100 underline-offset-2 hover:underline transition-colors";

  return (
    <section className="space-y-4 text-xs">
      <header className="space-y-1">
        <h3 className="text-sm font-medium text-ink-100">
          Nerva <span className="text-ink-400 font-normal">by Bytical</span>
        </h3>
        <p className="text-ink-400">
          The focus workspace that never forgets. Native, offline-first.
          Apache-2.0. Usage stats are opt-in, anonymous, and never include
          your content.
        </p>
        <p className="text-ink-500">
          v{version} · © 2026 Bytical Solutions Private Limited
        </p>
      </header>

      {/* Privacy — anonymous usage stats opt-in/out. */}
      <div className="space-y-2">
        <h4 className="text-[11px] uppercase tracking-wider text-ink-300">Privacy</h4>
        <Toggle
          label="Share anonymous usage stats (weekly)"
          on={telemetryOn}
          onChange={toggleTelemetry}
        />
        <p className="text-[10px] text-ink-500 leading-relaxed">
          When on, Nerva sends one anonymous ping per week: app version, OS,
          locale, and feature counts (e.g. “12 notes, 3 timers”). Never the
          contents of notes, tasks, or anything you type. Off = zero outbound
          calls except update checks.
        </p>
      </div>

      {/* Updates — manual check. The app also auto-checks 4 s after launch.
          Phones update through the store, so the button is desktop-only. */}
      {!isMobile() && (
      <div className="space-y-2">
        <h4 className="text-[11px] uppercase tracking-wider text-ink-300">Updates</h4>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={checkForUpdates}
            disabled={updateState.kind === "checking" || updateState.kind === "installing"}
            className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 border border-ink-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateState.kind === "checking"
              ? "Checking…"
              : updateState.kind === "installing"
              ? "Installing…"
              : "Check for updates"}
          </button>
          {updateState.kind === "up-to-date" && (
            <span className="text-ink-400">You're on the latest version.</span>
          )}
          {updateState.kind === "available" && (
            <span className="text-accent-glow">
              {updateState.version} available.
            </span>
          )}
          {updateState.kind === "installed" && (
            <span className="text-rest">
              Update installed{updateState.version ? ` (${updateState.version})` : ""} — quit and reopen Nerva to finish.
            </span>
          )}
          {updateState.kind === "error" && (
            <span className="text-red-400 break-all" title={updateState.message}>
              Update {updateState.message}
            </span>
          )}
        </div>
        <p className="text-[10px] text-ink-500">
          Updates are signed and verified locally. Snap and Microsoft Store
          builds update through their respective channels.
        </p>
      </div>
      )}

      <div className="space-y-2">
        <h4 className="text-[11px] uppercase tracking-wider text-ink-300">Support development</h4>
        <p className="text-ink-400">
          Nerva is free and open-source and will stay that way. If it earns a
          place in your workflow, a sponsorship keeps it that way — it funds
          the Windows code-signing cert, CI minutes, and the cross-device
          sync infra on the roadmap.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="https://github.com/sponsors/piyushptiwari1"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded bg-accent/15 hover:bg-accent/25 text-accent-glow border border-accent/30 transition-colors"
          >
            ❤︎ Sponsor on GitHub
          </a>
          <a
            href="https://nerva.bytical.ai/support"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 border border-ink-700/60 transition-colors"
          >
            One-time donation
          </a>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] uppercase tracking-wider text-ink-300">Project</h4>
        <ul className="space-y-1 text-ink-400">
          <li>
            <a href="https://nerva.bytical.ai" target="_blank" rel="noopener noreferrer" className={linkClass}>
              nerva.bytical.ai
            </a>
            <span className="text-ink-500"> — website</span>
          </li>
          <li>
            <a href="https://github.com/piyushptiwari1/nerva" target="_blank" rel="noopener noreferrer" className={linkClass}>
              github.com/piyushptiwari1/nerva
            </a>
            <span className="text-ink-500"> — source, issues, contributions welcome</span>
          </li>
          <li>
            <a href="https://github.com/piyushptiwari1/nerva/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className={linkClass}>
              Apache-2.0 license
            </a>
          </li>
          <li>
            <a href="https://github.com/piyushptiwari1/nerva/releases" target="_blank" rel="noopener noreferrer" className={linkClass}>
              Release notes
            </a>
          </li>
        </ul>
      </div>

      <p className="text-[10px] text-ink-500 pt-2 border-t border-ink-800">
        Built with Tauri + Rust + React. No analytics, no accounts, no cloud.
      </p>
    </section>
  );
}
