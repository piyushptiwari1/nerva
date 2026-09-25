import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AiProvider = "ollama" | "openai" | "anthropic" | "gemini" | "openrouter" | "custom";

export const AI_PROVIDERS: { id: AiProvider; label: string; hint: string; keyUrl?: string }[] = [
  { id: "ollama", label: "Ollama (local)", hint: "Free, private, runs on your machine. Default." },
  { id: "openai", label: "OpenAI", hint: "gpt-4o-mini, gpt-4o, o-series", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", hint: "Claude Haiku / Sonnet / Opus", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", hint: "gemini-2.0-flash and newer", keyUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openrouter", label: "OpenRouter", hint: "One key, hundreds of models", keyUrl: "https://openrouter.ai/keys" },
  { id: "custom", label: "Custom (OpenAI-compatible)", hint: "LM Studio, Groq, Together, vLLM, llama.cpp server…" },
];

export interface AiHealth {
  available: boolean;
  provider: AiProvider;
  endpoint: string;
  model: string;
  installed_models: string[];
  error: string | null;
}

export interface AiSettings {
  provider: AiProvider;
  endpoint: string;
  model: string;
  has_api_key: boolean;
  api_key_hint: string | null;
  needs_key: boolean;
  default_endpoint: string;
}

export interface AiExchange {
  id: string;
  ts_ms: number;
  prompt: string;
  response: string;
  model: string;
}

interface AiChunk { request_id: string; delta: string }
interface AiDone { request_id: string; text: string; cancelled: boolean; model: string }

/**
 * Stream a chat completion. The promise resolves with the final assembled
 * text; `onChunk` fires for each delta. We bind listeners scoped to the
 * given `request_id` so concurrent asks don't cross-contaminate.
 *
 * If `opts.signal` aborts mid-stream, we send `ai_cancel(request_id)` to the
 * backend so Ollama generation is actually stopped server-side (not just
 * hidden in the UI).
 */
export async function aiAsk(
  prompt: string,
  opts: {
    onChunk: (delta: string) => void;
    includeContext?: boolean;
    signal?: AbortSignal;
  },
): Promise<string> {
  const request_id = crypto.randomUUID();
  let unlistenChunk: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;
  try {
    unlistenChunk = await listen<AiChunk>("ai:chunk", (e) => {
      if (e.payload.request_id === request_id) opts.onChunk(e.payload.delta);
    });
    unlistenDone = await listen<AiDone>("ai:done", () => void 0);

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        // Tell the backend to actually stop generation.
        void invoke("ai_cancel", { requestId: request_id }).catch(() => void 0);
        unlistenChunk?.();
        unlistenChunk = null;
      });
    }

    const res = await invoke<{ request_id: string; text: string }>("ai_ask", {
      args: {
        request_id,
        prompt,
        include_context: opts.includeContext ?? true,
      },
    });
    return res.text;
  } finally {
    unlistenChunk?.();
    unlistenDone?.();
  }
}

export const ai = {
  health: () => invoke<AiHealth>("ai_health"),
  settings: () => invoke<AiSettings>("ai_settings_get"),
  setModel: (model: string) => invoke<AiSettings>("ai_set_model", { model }),
  setEndpoint: (endpoint: string) => invoke<AiSettings>("ai_set_endpoint", { endpoint }),
  setProvider: (provider: AiProvider) => invoke<AiSettings>("ai_set_provider", { provider }),
  /** Empty string clears the stored key. */
  setApiKey: (key: string) => invoke<AiSettings>("ai_set_api_key", { key }),
  history: (limit = 20) => invoke<AiExchange[]>("ai_history", { limit }),
  cancel: (requestId: string) => invoke<boolean>("ai_cancel", { requestId }),
  ask: aiAsk,
};
