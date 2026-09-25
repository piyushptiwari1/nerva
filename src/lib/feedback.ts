import { ipc } from "@/lib/ipc";

/**
 * Ratings, feature requests and bug reports.
 *
 * Unlike telemetry this is user-initiated and may contain free text — but
 * it is still anonymous unless the user *types* an email. Payloads go to
 * nerva.bytical.ai/api/feedback (length-capped + rate-limited server-side).
 * Offline sends are queued in localStorage and retried on the next launch.
 */

const ENDPOINT = "https://nerva.bytical.ai/api/feedback";
const K_QUEUE = "nerva.feedback.queue";
const K_INSTALLED = "nerva.feedback.installedAt";
const K_PROMPT_DISMISSED = "nerva.feedback.promptDismissed"; // count
const K_RATED = "nerva.feedback.rated"; // "1" once a rating is sent
const K_ANON = "nerva.telemetry.anonId"; // shared with telemetry if consented

export type FeedbackKind = "rating" | "feature" | "bug" | "other";

export interface FeedbackPayload {
  kind: FeedbackKind;
  stars?: number; // 1..5, rating only
  text?: string;
  email?: string;
  app_version: string;
  os: string;
  theme: string;
  sent_at: number;
  anon_id?: string;
}

export const MAX_TEXT = 2000;

function os(): string {
  const ua = navigator.userAgent;
  return ua.includes("Windows") ? "windows" : ua.includes("Mac") ? "macos" : "linux";
}

async function envelope(partial: Omit<FeedbackPayload, "app_version" | "os" | "theme" | "sent_at" | "anon_id">): Promise<FeedbackPayload> {
  let version = "unknown";
  try {
    version = (await ipc.runtime()).version;
  } catch {
    /* ignore */
  }
  return {
    ...partial,
    text: partial.text?.slice(0, MAX_TEXT),
    app_version: version,
    os: os(),
    theme: document.documentElement.dataset.theme ?? "dark",
    sent_at: Date.now(),
    anon_id: localStorage.getItem(K_ANON) ?? undefined,
  };
}

async function post(p: FeedbackPayload): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readQueue(): FeedbackPayload[] {
  try {
    return JSON.parse(localStorage.getItem(K_QUEUE) ?? "[]") as FeedbackPayload[];
  } catch {
    return [];
  }
}

function writeQueue(q: FeedbackPayload[]) {
  localStorage.setItem(K_QUEUE, JSON.stringify(q.slice(-20)));
}

/**
 * Send now, or queue if offline. Resolves `true` when delivered, `false`
 * when queued for a later retry (never throws).
 */
export async function sendFeedback(
  partial: { kind: FeedbackKind; stars?: number; text?: string; email?: string },
): Promise<boolean> {
  const p = await envelope(partial);
  if (partial.kind === "rating") localStorage.setItem(K_RATED, "1");
  if (await post(p)) return true;
  writeQueue([...readQueue(), p]);
  return false;
}

/** Retry queued items. Call once shortly after launch. */
export async function flushFeedbackQueue(): Promise<void> {
  const q = readQueue();
  if (!q.length) return;
  const remaining: FeedbackPayload[] = [];
  for (const p of q) {
    if (!(await post(p))) remaining.push(p);
  }
  writeQueue(remaining);
}

// ---- soft rating prompt gating ----

const PROMPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DISMISSALS = 2;

/** Record first launch; idempotent. */
export function markInstalled(): void {
  if (!localStorage.getItem(K_INSTALLED)) {
    localStorage.setItem(K_INSTALLED, String(Date.now()));
  }
}

/** Show the "how is Nerva working for you?" card? */
export function shouldPromptRating(): boolean {
  if (localStorage.getItem(K_RATED) === "1") return false;
  if (Number(localStorage.getItem(K_PROMPT_DISMISSED) ?? 0) >= MAX_DISMISSALS) return false;
  const installed = Number(localStorage.getItem(K_INSTALLED) ?? 0);
  return installed > 0 && Date.now() - installed >= PROMPT_AFTER_MS;
}

export function dismissRatingPrompt(): void {
  const n = Number(localStorage.getItem(K_PROMPT_DISMISSED) ?? 0) + 1;
  localStorage.setItem(K_PROMPT_DISMISSED, String(n));
  // Push the next nudge out by another week.
  localStorage.setItem(K_INSTALLED, String(Date.now()));
}

export const GITHUB_ISSUES = "https://github.com/piyushptiwari1/nerva/issues/new/choose";
