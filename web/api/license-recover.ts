// "Sign in anywhere": email → we send every licence key registered to that
// address. Nothing is revealed in the HTTP response (always 204) so the
// endpoint can't be used to probe which emails bought Pro.
//   POST { email }

export const config = { runtime: "edge" };

import { readEvents } from "./_lib/metrics";
import { PLANS, type Plan } from "./_lib/license";
import { recoveryMail, sendMail } from "./_lib/mail";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,64}\.[^\s@]{2,24}$/;
const bucket = new Map<string, { n: number; reset: number }>();

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(
  req: Request,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });
  let email = "";
  try {
    email = String(((await req.json()) as { email?: string }).email ?? "").trim().toLowerCase();
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }
  if (!EMAIL_RE.test(email)) return new Response(null, { status: 400, headers: cors });

  // 3 recovery mails per address per hour.
  const now = Date.now();
  const b = bucket.get(email);
  if (b && b.reset > now && b.n >= 3) return new Response(null, { status: 429, headers: cors });
  bucket.set(email, b && b.reset > now ? { n: b.n + 1, reset: b.reset } : { n: 1, reset: now + 3_600_000 });

  const work = (async () => {
    const events = await readEvents("licenses", 400);
    const keys = events
      .filter((e) => String(e.email ?? "").toLowerCase() === email && typeof e.license === "string")
      .map((e) => ({
        key: String(e.license),
        planLabel: PLANS[String(e.plan) as Plan]?.label ?? String(e.plan),
        expiresIso: e.exp ? new Date(Number(e.exp) * 1000).toISOString() : null,
      }));
    if (keys.length) await sendMail(recoveryMail({ to: email, keys }));
  })();
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
  return new Response(null, { status: 204, headers: cors });
}
