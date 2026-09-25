import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GITHUB_ISSUES,
  MAX_TEXT,
  dismissRatingPrompt,
  sendFeedback,
  shouldPromptRating,
  type FeedbackKind,
} from "@/lib/feedback";
import { useSettingsUi } from "@/store/settings";

/** Settings → Feedback tab body. */
export function FeedbackForm({ initialKind = "feature" }: { initialKind?: FeedbackKind }) {
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued">("idle");

  const canSend =
    state !== "sending" && (kind === "rating" ? stars > 0 : text.trim().length > 3);

  async function submit() {
    if (!canSend) return;
    setState("sending");
    const ok = await sendFeedback({
      kind,
      stars: kind === "rating" ? stars : undefined,
      text: text.trim() || undefined,
      email: email.trim() || undefined,
    });
    setState(ok ? "sent" : "queued");
    setText("");
    setStars(0);
  }

  const kinds: { id: FeedbackKind; label: string }[] = [
    { id: "rating", label: "Rate Nerva" },
    { id: "feature", label: "Request a feature" },
    { id: "bug", label: "Report a bug" },
    { id: "other", label: "Something else" },
  ];

  return (
    <section className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-ink-400 leading-relaxed">
        Nerva by Bytical is built from feedback like yours. Nothing here is
        sent until you press <span className="text-ink-200">Send</span>; email
        is optional and only used to reply.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k.id}
            onClick={() => {
              setKind(k.id);
              setState("idle");
            }}
            className={`text-[11px] px-2 py-1 rounded border ${
              kind === k.id
                ? "bg-accent/20 border-accent text-accent-glow"
                : "border-ink-700 hover:bg-ink-800 text-ink-200"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {kind === "rating" && <Stars value={stars} onChange={setStars} />}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
        rows={5}
        placeholder={
          kind === "rating"
            ? "What works? What's missing? (optional)"
            : kind === "bug"
              ? "What happened, what did you expect, and how can we reproduce it?"
              : kind === "feature"
                ? "Describe the feature and the problem it solves for you."
                : "Tell us anything."
        }
        className="w-full bg-ink-900 hairline rounded px-2.5 py-2 text-xs text-ink-100 resize-none"
      />
      <div className="flex items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email (optional, for a reply)"
          type="email"
          className="flex-1 bg-ink-900 hairline rounded px-2 py-1 text-xs text-ink-100"
        />
        <button
          onClick={submit}
          disabled={!canSend}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
      {state === "sent" && (
        <div className="text-[11px] text-rest">Thank you — received.</div>
      )}
      {state === "queued" && (
        <div className="text-[11px] text-focus">
          You're offline. Saved locally; it will be sent next time Nerva is online.
        </div>
      )}
      <div className="text-[11px] text-ink-500">
        Prefer GitHub?{" "}
        <a
          href={GITHUB_ISSUES}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-glow hover:underline"
        >
          Open an issue
        </a>{" "}
        — templates for bugs and feature requests are ready.
      </div>
    </section>
  );
}

export function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className={`text-xl leading-none transition-colors ${
            n <= shown ? "text-focus" : "text-ink-600 hover:text-ink-400"
          }`}
        >
          ★
        </button>
      ))}
      <span className="ml-2 text-[11px] text-ink-400">
        {["", "Not for me", "Needs work", "Okay", "Good", "Love it"][shown]}
      </span>
    </div>
  );
}

/**
 * Soft, dismissible day-7 rating nudge (bottom-right card). Gated by
 * `shouldPromptRating()`; never shows again after a rating or two dismissals.
 */
export function RatingPrompt() {
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const openSettingsOn = useSettingsUi((s) => s.openOn);

  useEffect(() => {
    // Delay so it never competes with first paint / tutorial.
    const h = window.setTimeout(() => setOpen(shouldPromptRating()), 20_000);
    return () => window.clearTimeout(h);
  }, []);

  async function rate(n: number) {
    setStars(n);
    await sendFeedback({ kind: "rating", stars: n });
    // Low ratings → invite a sentence about what's wrong.
    if (n <= 3) openSettingsOn("feedback");
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-14 right-4 z-40 glass rounded-xl p-3 w-72 border border-ink-700/60 shadow-glow"
          role="dialog"
          aria-label="Rate Nerva"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm text-ink-100">How is Nerva working for you?</div>
              <div className="text-[11px] text-ink-400 mt-0.5">
                One tap. Anonymous. Helps us decide what to build next.
              </div>
            </div>
            <button
              onClick={() => {
                dismissRatingPrompt();
                setOpen(false);
              }}
              className="text-ink-500 hover:text-ink-100 text-base leading-none"
              aria-label="Not now"
              title="Not now"
            >
              ×
            </button>
          </div>
          <div className="mt-2">
            <Stars value={stars} onChange={(n) => void rate(n)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
