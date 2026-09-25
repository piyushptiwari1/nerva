// Transactional email via Mailjet (same account as the Bytical platform —
// MAILJET_API_KEY / MAILJET_API_SECRET in Vercel env). Sender defaults to
// hello@bytical.ai (verified in Mailjet). Every send is best-effort: a mail
// failure must never fail a payment callback.

const FROM_EMAIL = () =>
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.MAIL_FROM ??
  "hello@bytical.ai";
const FROM_NAME = "Nerva by Bytical";

function creds(): { key: string; secret: string } | null {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const key = env.MAILJET_API_KEY;
  const secret = env.MAILJET_API_SECRET;
  return key && secret ? { key, secret } : null;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Mailjet custom id for reconciliation in their dashboard. */
  tag?: string;
}

/** Returns true when Mailjet accepted the message. */
export async function sendMail(m: Mail): Promise<boolean> {
  const c = creds();
  if (!c) return false;
  try {
    const res = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + btoa(`${c.key}:${c.secret}`),
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: FROM_EMAIL(), Name: FROM_NAME },
            To: [{ Email: m.to }],
            Subject: m.subject,
            TextPart: m.text,
            HTMLPart: m.html,
            CustomID: m.tag ?? "nerva",
          },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function mailConfigured(): boolean {
  return creds() !== null;
}

// ---------- templates ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const SITE = "https://nerva.bytical.ai";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0a0b0d;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;color:#ecf0f6">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <div style="background:#071B34;border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between">
    <img src="${SITE}/brand/bytical-wordmark-on-dark-h80-2x.png" alt="Bytical" height="28" style="height:28px;display:block"/>
    <span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9fb3c8">Nerva by Bytical</span>
  </div>
  <div style="background:#15171c;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:28px">
    <h1 style="font-size:20px;margin:0 0 14px;letter-spacing:-.01em">${esc(title)}</h1>
    ${bodyHtml}
  </div>
  <p style="font-size:11px;color:#5a6273;margin-top:18px;line-height:1.6">Bytical Solutions Private Limited · GSTIN 06AAMCB3963E1ZN · Udyog Vihar Phase 1, Gurugram, Haryana 122016, India · <a href="${SITE}" style="color:#7c9cff">nerva.bytical.ai</a> · <a href="https://bytical.ai" style="color:#7c9cff">bytical.ai</a><br/>You received this because you bought or asked about Nerva Pro. Reply to this email for support.</p>
</div></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 12px;color:#a8acb4;line-height:1.6">${s}</p>`;
const keyBox = (k: string) =>
  `<div style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;word-break:break-all;background:#0f1115;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:14px;color:#e8b86d;margin:14px 0">${esc(k)}</div>`;
const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#7c9cff;color:#0a0b0d;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;margin:6px 8px 6px 0">${esc(label)}</a>`;

export function purchaseMail(a: {
  to: string;
  name: string;
  plan: string;
  planLabel: string;
  amountInr: string;
  key: string | null;
  txnid: string;
  invoiceUrl: string;
  expiresIso: string | null;
}): Mail {
  const title = a.key ? "Your Nerva Pro licence key" : "Your Nerva Pro payment was received";
  const html = shell(
    title,
    p(`Hi ${esc(a.name || "there")}, thank you for supporting Nerva.`) +
      p(`<strong style="color:#ecf0f6">${esc(a.planLabel)}</strong> · ₹${esc(a.amountInr)}${a.expiresIso ? ` · valid until ${esc(a.expiresIso.slice(0, 10))}` : " · never expires"}`) +
      (a.key
        ? p("Your licence key (keep this email):") + keyBox(a.key) +
          p("<strong style=\"color:#ecf0f6\">Activate:</strong> open Nerva → <code>Ctrl+,</code> → <strong>Pro</strong> → paste the key → Activate. You can use it on up to " +
            `${a.plan === "lifetime" ? 5 : a.plan === "yearly" ? 3 : 2} devices at once; manage them from the same screen.`)
        : p("The licence server could not issue your key automatically. Reply to this email with your reference and we will send it within 24 hours.")) +
      `<div style="margin-top:16px">${btn(a.invoiceUrl, "Download invoice")}${btn("https://nerva.bytical.ai/#download", "Get Nerva")}</div>` +
      p(`<span style="font-size:12px;color:#5a6273">Reference: ${esc(a.txnid)}</span>`),
  );
  const text = `${title}\n\n${a.planLabel} · ₹${a.amountInr}\n${a.key ? `Licence key:\n${a.key}\n\nActivate: Nerva → Settings (Ctrl+,) → Pro → paste → Activate.` : "Key pending — reply with your reference."}\nInvoice: ${a.invoiceUrl}\nReference: ${a.txnid}\n`;
  return { to: a.to, subject: title, html, text, tag: "nerva-pro-purchase" };
}

export function reminderMail(a: {
  to: string;
  planLabel: string;
  daysLeft: number; // 7, 1, or 0 (expired)
  expiresIso: string;
  renewUrl: string;
}): Mail {
  const title =
    a.daysLeft === 0
      ? "Your Nerva Pro licence has expired"
      : `Your Nerva Pro licence expires in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`;
  const body =
    a.daysLeft === 0
      ? p(`Your <strong style="color:#ecf0f6">${esc(a.planLabel)}</strong> ended on ${esc(a.expiresIso.slice(0, 10))}. Nerva keeps working — everything free stays free — but Pro features are paused until you renew.`)
      : p(`Your <strong style="color:#ecf0f6">${esc(a.planLabel)}</strong> ends on ${esc(a.expiresIso.slice(0, 10))}. Renewing gives you a new key; paste it in Settings → Pro and you're done.`);
  const html = shell(title, body + `<div style="margin-top:16px">${btn(a.renewUrl, "Renew Nerva Pro")}</div>` + p(`<span style="font-size:12px;color:#5a6273">No auto-renew, ever — we only charge when you click.</span>`));
  const text = `${title}\n\n${a.planLabel} — ${a.daysLeft === 0 ? "expired" : "expires"} ${a.expiresIso.slice(0, 10)}.\nRenew: ${a.renewUrl}\n`;
  return { to: a.to, subject: title, html, text, tag: `nerva-pro-reminder-${a.daysLeft}` };
}

export function recoveryMail(a: { to: string; keys: { key: string; planLabel: string; expiresIso: string | null }[] }): Mail {
  const title = "Your Nerva Pro licence keys";
  const list = a.keys
    .map((k) => p(`<strong style="color:#ecf0f6">${esc(k.planLabel)}</strong>${k.expiresIso ? ` · valid until ${esc(k.expiresIso.slice(0, 10))}` : " · never expires"}`) + keyBox(k.key))
    .join("");
  const html = shell(title, p("Someone (hopefully you) asked for the licence keys registered to this email address.") + list + p("Activate in Nerva → Settings → Pro. If you didn't request this, you can ignore it — nothing changed."));
  const text = `${title}\n\n${a.keys.map((k) => `${k.planLabel}${k.expiresIso ? ` (until ${k.expiresIso.slice(0, 10)})` : ""}\n${k.key}`).join("\n\n")}\n`;
  return { to: a.to, subject: title, html, text, tag: "nerva-pro-recovery" };
}
