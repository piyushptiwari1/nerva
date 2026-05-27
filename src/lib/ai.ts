import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AiHealth {
  available: boolean;
  endpoint: string;
  model: string;
  installed_models: string[];
  error: string | null;
}

export interface AiSettings {
  endpoint: string;
  model: string;
}

interface AiChunk { request_id: string; delta: string }
interface AiDone { request_id: string; text: string }

/**
 * Stream a chat completion. The promise resolves with the final assembled
 * text; `onChunk` fires for each delta. We bind two listeners scoped to the
 * given `request_id` so concurrent asks don't cross-contaminate.
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
    unlistenChunk = await listen<AiChunk>("ai.chunk", (e) => {
      if (e.payload.request_id === request_id) opts.onChunk(e.payload.delta);
    });
    // We don't strictly need ai.done (the invoke promise resolves with the
    // full text), but a listener is handy for future telemetry.
    unlistenDone = await listen<AiDone>("ai.done", () => void 0);

    // If the caller aborts, we can't kill Ollama mid-stream from JS, but we
    // can stop showing tokens by detaching the listener early.
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
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
  ask: aiAsk,
};
