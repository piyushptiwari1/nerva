import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePalette } from "@/store/palette";
import { ai, type AiHealth } from "@/lib/ai";

/**
 * "Ask Nerva" pane — a focused modal for streaming local-LLM replies. The
 * pane is opened via the command palette (`?` prefix or `Ask Nerva` action)
 * and talks to the Ollama sidecar via the `ai_ask` IPC.
 *
 * Health is probed once on first open and cached; if Ollama is unreachable
 * we show a setup hint rather than failing silently.
 */
export function AskNerva() {
  const askPrompt = usePalette((s) => s.askPrompt);
  const close = usePalette((s) => s.closeAsk);

  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isOpen = askPrompt !== null;

  // Initial prompt: when opened from the palette, seed & auto-submit.
  useEffect(() => {
    if (!isOpen) return;
    setPrompt(askPrompt ?? "");
    setReply("");
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (askPrompt && askPrompt.trim()) {
      // Auto-fire when entered with substantive content.
      void run(askPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Lazy health probe — only when the pane is first opened in a session.
  useEffect(() => {
    if (!isOpen || health) return;
    ai.health().then(setHealth).catch(() => setHealth(null));
  }, [isOpen, health]);

  // Auto-scroll the reply area as tokens arrive.
  useEffect(() => {
    if (replyRef.current) {
      replyRef.current.scrollTop = replyRef.current.scrollHeight;
    }
  }, [reply]);

  async function run(p: string) {
    const q = p.trim();
    if (!q || streaming) return;
    setReply("");
    setError(null);
    setStreaming(true);
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
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // First Escape stops streaming; second closes.
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
            <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-700/40 text-ink-300">
              <span className="text-accent-glow text-sm">✦</span>
              <span className="text-sm font-medium">Ask Nerva</span>
              <span className="text-[11px] text-ink-500">
                {health?.available
                  ? `· ${health.model}`
                  : health
                  ? "· offline"
                  : "· checking…"}
              </span>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
