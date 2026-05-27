import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePalette } from "@/store/palette";
import { ai, type AiExchange, type AiHealth } from "@/lib/ai";

/**
 * "Ask Nerva" pane — a focused modal for streaming local-LLM replies.
 *
 * Opened from the command palette (`?` prefix, Ask Nerva, Recap today, or
 * Ask history). Talks to the Ollama sidecar via `ai_ask`; cancel propagates
 * to the backend via `ai_cancel` so generation actually stops server-side.
 *
 * Three sections, top-to-bottom:
 *   1. Header with model picker + history toggle
 *   2. Prompt textarea + send/stop
 *   3. Streaming reply OR collapsible recent-exchanges drawer
 */
export function AskNerva() {
  const askPrompt = usePalette((s) => s.askPrompt);
  const askShowHistory = usePalette((s) => s.askShowHistory);
  const close = usePalette((s) => s.closeAsk);

  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AiExchange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isOpen = askPrompt !== null;

  const run = useCallback(async (p: string) => {
    const q = p.trim();
    if (!q || streaming) return;
    setReply("");
    setError(null);
    setStreaming(true);
    setShowHistory(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await ai.ask(q, {
        includeContext: true,
        signal: ctrl.signal,
        onChunk: (delta) => setReply((prev) => prev + delta),
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [streaming]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const h = await ai.history(30);
      setHistory(h);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Initial prompt: when opened from the palette, seed & auto-submit
  // (unless we were asked to open the history drawer instead).
  useEffect(() => {
    if (!isOpen) return;
    setPrompt(askPrompt ?? "");
    setReply("");
    setError(null);
    setShowHistory(askShowHistory);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!askShowHistory && askPrompt && askPrompt.trim()) {
      void run(askPrompt);
    }
    if (askShowHistory) {
      void loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Lazy health probe — refresh every time the pane opens to catch the
  // case where Ollama was started between sessions.
  useEffect(() => {
    if (!isOpen) return;
    ai.health().then(setHealth).catch(() => setHealth(null));
  }, [isOpen]);

  // Auto-scroll the reply area as tokens arrive.
  useEffect(() => {
    if (replyRef.current) {
      replyRef.current.scrollTop = replyRef.current.scrollHeight;
    }
  }, [reply]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (streaming) {
        abortRef.current?.abort();
      } else {
        close();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run(prompt);
    }
  }

  async function onModelChange(m: string) {
    if (!m || m === health?.model) return;
    try {
      const next = await ai.setModel(m);
      setHealth((h) => (h ? { ...h, model: next.model } : h));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function restoreExchange(ex: AiExchange) {
    setPrompt(ex.prompt);
    setReply(ex.response);
    setShowHistory(false);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) void loadHistory();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-ink-950/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-[720px] max-w-[94vw] glass rounded-xl shadow-2xl border border-ink-700/60 overflow-hidden flex flex-col"
            onKeyDown={onKeyDown}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-700/40 text-ink-300">
              <span className="text-accent-glow text-sm">✦</span>
              <span className="text-sm font-medium">Ask Nerva</span>

              {/* Model picker: only when there are installed models to choose from */}
              {health?.available && health.installed_models.length > 0 ? (
                <select
                  value={health.model}
                  onChange={(e) => void onModelChange(e.target.value)}
                  disabled={streaming}
                  className="ml-1 text-[11px] bg-ink-900/60 hairline rounded px-1.5 py-0.5 text-ink-200 outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
                  title="Active local model"
                >
                  {/* Surface current model even if not in /api/tags (lets user
                      stay on a model they've pinned but uninstalled) */}
                  {!health.installed_models.includes(health.model) && (
                    <option value={health.model}>{health.model}</option>
                  )}
                  {health.installed_models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-ink-500">
                  {health?.available
                    ? `· ${health.model}`
                    : health
                    ? "· offline"
                    : "· checking…"}
                </span>
              )}

              <button
                onClick={toggleHistory}
                className={`ml-2 text-[11px] px-1.5 py-0.5 rounded hairline ${
                  showHistory ? "text-accent-glow bg-accent/10" : "text-ink-400 hover:text-ink-200"
                }`}
                title="Recent exchanges"
              >
                History
              </button>

              <span className="ml-auto text-[10px] text-ink-500">
                <kbd className="border border-ink-700 rounded px-1">⌃↵</kbd> send
                · <kbd className="border border-ink-700 rounded px-1">Esc</kbd>{" "}
                {streaming ? "stop" : "close"}
              </span>
            </div>

            {/* Health hint */}
            {health && !health.available && (
              <div className="px-4 py-3 text-[12px] text-ink-300 bg-ink-800/40 border-b border-ink-700/40 leading-snug">
                <div className="text-ink-100 font-medium mb-1">Ollama isn't reachable.</div>
                <div className="text-ink-400">{health.error}</div>
                <div className="mt-2 text-ink-400">
                  Install from{" "}
                  <span className="text-accent-glow">ollama.com</span>, then run:
                  <pre className="mt-1 px-2 py-1 rounded bg-ink-900/80 text-ink-200 text-[11px] font-mono">
{`ollama serve   # starts the sidecar
ollama pull ${health.model}`}
                  </pre>
                </div>
              </div>
            )}

            {/* Prompt input */}
            <div className="p-3 border-b border-ink-700/40">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Plan my next 25 minutes · Summarize what I did today · …"
                rows={3}
                disabled={streaming}
                className="w-full bg-ink-900/40 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:ring-1 focus:ring-accent/40 resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => run(prompt)}
                  disabled={!prompt.trim() || streaming || (health !== null && !health.available)}
                  className="text-xs px-3 py-1 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
                >
                  {streaming ? "Streaming…" : "Send"}
                </button>
                {streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="text-xs px-2 py-1 rounded-md text-ink-400 hover:text-ink-100"
                  >
                    Stop
                  </button>
                )}
                <span className="ml-auto text-[10px] text-ink-500">
                  context: workspace + recent events + tasks
                </span>
              </div>
            </div>

            {/* Body: history drawer OR streaming reply */}
            {showHistory ? (
              <div className="max-h-[40vh] overflow-y-auto">
                {historyLoading ? (
                  <div className="px-4 py-6 text-[12px] text-ink-500">Loading…</div>
                ) : history.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-ink-500">
                    No saved exchanges yet. Anything you ask Nerva will appear here.
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-700/40">
                    {history.map((ex) => (
                      <li key={ex.id}>
                        <button
                          onClick={() => restoreExchange(ex)}
                          className="w-full text-left px-4 py-2 hover:bg-ink-800/40 group"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-[11px] text-ink-500">
                              {formatRelative(ex.ts_ms)}
                            </span>
                            <span className="text-[10px] text-ink-600">{ex.model}</span>
                          </div>
                          <div className="text-[13px] text-ink-100 truncate">
                            {ex.prompt}
                          </div>
                          <div className="text-[11px] text-ink-400 truncate">
                            {ex.response}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div
                ref={replyRef}
                className="px-4 py-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-sm text-ink-100 leading-relaxed font-[ui-sans-serif]"
              >
                {reply && reply}
                {streaming && (
                  <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom bg-accent/70 animate-pulse" />
                )}
                {!reply && !streaming && !error && (
                  <div className="text-ink-500 text-[12px]">
                    Replies stream here. Nothing leaves your machine — answers are
                    produced by the local Ollama sidecar.
                  </div>
                )}
                {error && (
                  <div className="text-[12px] text-rest mt-2">Error: {error}</div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small relative-time helper. We deliberately avoid dayjs/luxon — it's only
 *  used in this one drawer and the dep budget for the LLM modal stays nil. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}
