// Printable tax invoice for a Nerva Pro purchase.
//   GET /api/invoice?txnid=…&sig=…   (sig = invoiceSig(txnid), emailed to the buyer)
//
// Bytical Solutions Private Limited is an Indian company; prices are
// GST-inclusive at 18 % (SAC 997331, software licensing). GSTIN and address
// come from env so they can be filled in without a code change.

export const config = { runtime: "edge" };

import { readEvents } from "./_lib/metrics";
import { PLANS, invoiceSig, type Plan } from "./_lib/license";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const txnid = url.searchParams.get("txnid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!txnid || !sig || sig !== (await invoiceSig(txnid))) {
    return new Response("Invalid or expired invoice link.", { status: 403 });
  }
  const events = await readEvents("licenses", 400);
  const rec = events.find((e) => e.txnid === txnid);
  if (!rec) return new Response("Invoice not found yet — try again in a minute.", { status: 404 });

  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const origin = new URL(req.url).origin;
  const gstin = env.BYTICAL_GSTIN ?? "";
  const address = env.BYTICAL_ADDRESS ?? "India";
  const plan = String(rec.plan) as Plan;
  const gross = Number(rec.amount ?? PLANS[plan]?.amountInr ?? 0);
  const taxable = gross / 1.18;
  const gst = gross - taxable;
  const date = String(rec.ts ?? "").slice(0, 10);
  const invNo = `NRV-${date.replace(/-/g, "")}-${txnid.slice(0, 6).toUpperCase()}`;
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Invoice ${esc(invNo)} — Nerva by Bytical</title>
<meta name="robots" content="noindex"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;color:#111;margin:0;padding:40px;background:#f4f5f8}
.sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.06);overflow:hidden}
.brand{background:#071B34;padding:22px 40px;display:flex;justify-content:space-between;align-items:center}
.brand img{height:34px;display:block}.brand .tag{color:#9fb3c8;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.inner{padding:32px 40px 40px}
h1{font-size:22px;margin:0}.muted{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
td.num,th.num{text-align:right}.tot td{font-weight:600;border-bottom:0}
.row{display:flex;justify-content:space-between;gap:24px;margin-top:24px}.row>div{flex:1}
@media print{body{background:#fff;padding:0}.sheet{box-shadow:none}.noprint{display:none}}
button{background:#111;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer}
</style></head><body><div class="sheet">
<div class="brand"><img src="${esc(origin)}/brand/bytical-wordmark-on-dark-h80-2x.png" alt="Bytical"/><span class="tag">Nerva by Bytical</span></div>
<div class="inner">
<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>Tax Invoice</h1><div class="muted">${esc(invNo)} · ${esc(date)}</div></div>
  <div style="text-align:right"><strong>Bytical Solutions Private Limited</strong><div class="muted">${esc(address)}${gstin ? `<br/>GSTIN: ${esc(gstin)}` : ""}<br/>hello@bytical.ai · bytical.ai</div></div>
</div>
<div class="row">
  <div><div class="muted">Billed to</div><strong>${esc(rec.name || "Customer")}</strong><br/><span class="muted">${esc(rec.email)}</span></div>
  <div><div class="muted">Payment</div>PayU · Ref ${esc(txnid)}<br/><span class="muted">Status: paid</span></div>
</div>
<table>
  <thead><tr><th>Description</th><th>SAC</th><th class="num">Taxable value</th><th class="num">GST 18 %</th><th class="num">Total</th></tr></thead>
  <tbody>
    <tr><td>${esc(PLANS[plan]?.label ?? plan)} — software licence${rec.exp ? ` (valid until ${esc(new Date(Number(rec.exp) * 1000).toISOString().slice(0, 10))})` : " (perpetual)"}</td><td>997331</td><td class="num">₹${fmt(taxable)}</td><td class="num">₹${fmt(gst)}</td><td class="num">₹${fmt(gross)}</td></tr>
    <tr class="tot"><td colspan="4">Amount paid (INR, inclusive of GST)</td><td class="num">₹${fmt(gross)}</td></tr>
  </tbody>
</table>
<p class="muted" style="margin-top:24px">This is a computer-generated invoice and does not require a signature. For international customers the card issuer converts INR to your local currency at their rate. Refunds within 14 days of purchase on request via hello@bytical.ai.</p>
<p class="noprint" style="margin-top:20px"><button onclick="window.print()">Print / Save as PDF</button></p>
</div></div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
