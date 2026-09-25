// Daily Vercel Cron: expiry reminders for monthly/yearly Pro licences.
// Sends at T-7 days, T-1 day and on expiry (T+0). Sent flags persist in
// licenses/reminders.json so each mail goes out exactly once.
//
// Protected by CRON_SECRET (Vercel sets `authorization: Bearer <CRON_SECRET>`
// on cron invocations when the env var exists).

export const config = { runtime: "edge" };

import { readEvents, readJson, writeJson } from "./_lib/metrics";
import { PLANS, type Plan } from "./_lib/license";
import { reminderMail, sendMail, mailConfigured } from "./_lib/mail";

type Sent = Record<string, { r7?: string; r1?: string; r0?: string }>;
const DAY = 86_400_000;

export default async function handler(req: Request): Promise<Response> {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!mailConfigured()) return new Response(JSON.stringify({ skipped: "mail not configured" }), { status: 200 });

  const events = await readEvents("licenses", 400);
  const stateDoc = await readJson<Sent>("licenses/reminders.json");
  const sent: Sent = stateDoc?.data ?? {};
  const now = Date.now();
  const out: string[] = [];
  let changed = false;

  for (const e of events) {
    const exp = Number(e.exp ?? 0);
    const email = String(e.email ?? "");
    const txnid = String(e.txnid ?? "");
    if (!exp || !email || !txnid) continue; // lifetime or malformed
    const msLeft = exp * 1000 - now;
    const daysLeft = Math.ceil(msLeft / DAY);
    let slot: "r7" | "r1" | "r0" | null = null;
    let days = 0;
    if (msLeft <= 0 && msLeft > -3 * DAY) {
      slot = "r0";
      days = 0;
    } else if (daysLeft === 1) {
      slot = "r1";
      days = 1;
    } else if (daysLeft === 7) {
      slot = "r7";
      days = 7;
    }
    if (!slot) continue;
    sent[txnid] = sent[txnid] ?? {};
    if (sent[txnid][slot]) continue;
    const ok = await sendMail(
      reminderMail({
        to: email,
        planLabel: PLANS[String(e.plan) as Plan]?.label ?? String(e.plan),
        daysLeft: days,
        expiresIso: new Date(exp * 1000).toISOString(),
        renewUrl: "https://nerva.bytical.ai/#pro",
      }),
    );
    if (ok) {
      sent[txnid][slot] = new Date().toISOString();
      changed = true;
      out.push(`${txnid}:${slot}`);
    }
  }
  if (changed) await writeJson("licenses/reminders.json", sent, `reminders ${out.length}`, stateDoc?.sha);
  return new Response(JSON.stringify({ sent: out }), { headers: { "content-type": "application/json" } });
}
