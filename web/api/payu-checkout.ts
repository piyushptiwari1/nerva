// Edge function: build a PayU payment intent for a one-time INR
// donation to the Nerva project and return an auto-submitting HTML
// form that posts to PayU's hosted checkout.
//
// PayU credentials live in Vercel env (PAYU_KEY, PAYU_SALT,
// PAYU_BASE_URL). Hash algorithm mirrors the Bytical platform
// backend (routes/payment_endpoints.py:generate_payu_hash), namely
// SHA-512 of:
//   key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
//
// Donations are anonymous-friendly: name/email are user-supplied,
// not authenticated. No DB writes; the callback handler logs txnid
// + status into Vercel logs only.

export const config = { runtime: "edge" };

const PRODUCT_INFO = "Nerva donation";
const ALLOWED_AMOUNTS = [199, 499, 999, 1999, 4999];
const MIN_AMOUNT = 50;
const MAX_AMOUNT = 100000;

interface CheckoutBody {
  amount?: number | string;
  name?: string;
  email?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function randomTxnid(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha512Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-512", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  let body: CheckoutBody = {};
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      body = (await req.json()) as CheckoutBody;
    } else {
      const form = await req.formData();
      body = {
        amount: form.get("amount")?.toString(),
        name: form.get("name")?.toString(),
        email: form.get("email")?.toString(),
      };
    }
  } catch {
    return new Response("Bad request body", { status: 400 });
  }

  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum) || amountNum < MIN_AMOUNT || amountNum > MAX_AMOUNT) {
    return new Response(`Amount must be between ₹${MIN_AMOUNT} and ₹${MAX_AMOUNT}.`, {
      status: 400,
    });
  }
  // Round to 2dp; PayU expects a string.
  const amount = amountNum.toFixed(2);

  const name = (body.name || "Friend of Nerva").trim().slice(0, 60) || "Friend of Nerva";
  const email = (body.email || "").trim().slice(0, 100);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response("A valid email is required (PayU requirement).", { status: 400 });
  }

  const key = process.env.PAYU_KEY;
  const salt = process.env.PAYU_SALT;
  const payuBase = process.env.PAYU_BASE_URL || "https://secure.payu.in/_payment";
  if (!key || !salt) {
    return new Response("PayU not configured on this deploy.", { status: 503 });
  }

  // udf2 = "donation" so the callback handler can branch on intent.
  const udf1 = "";
  const udf2 = "donation";
  const udf3 = ALLOWED_AMOUNTS.includes(amountNum) ? "preset" : "custom";
  const udf4 = "nerva-web";
  const udf5 = "";

  const txnid = randomTxnid();
  const origin = new URL(req.url).origin;
  const surl = `${origin}/api/payu-callback`;
  const furl = `${origin}/api/payu-callback`;

  const hashSeq =
    `${key}|${txnid}|${amount}|${PRODUCT_INFO}|${name}|${email}` +
    `|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  const hash = await sha512Hex(hashSeq);

  // Auto-submitting form. Browsers handle the navigation themselves;
  // PayU's hosted page takes over from there.
  const fields: Record<string, string> = {
    key,
    txnid,
    amount,
    productinfo: PRODUCT_INFO,
    firstname: name,
    email,
    surl,
    furl,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
    hash,
    service_provider: "payu_paisa",
  };

  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`)
    .join("\n");

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<title>Redirecting to PayU…</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;
       background:#0a0b0d;color:#ecf0f6;margin:0;min-height:100vh;
       display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .card{max-width:420px;border:1px solid rgba(255,255,255,0.10);border-radius:14px;
        padding:32px;background:#15171c}
  h1{font-size:18px;margin:0 0 8px}
  p{margin:0;color:#a8acb4;font-size:14px;line-height:1.55}
  button{margin-top:16px;background:#7c9cff;color:#0a0b0d;border:0;border-radius:8px;
         padding:10px 18px;font-weight:600;cursor:pointer}
</style>
</head><body>
<form id="payu" method="POST" action="${escapeHtml(payuBase)}">
  ${inputs}
  <div class="card">
    <h1>Redirecting to PayU…</h1>
    <p>You're being sent to PayU's secure page to complete a ₹${escapeHtml(amount)} donation. If this page doesn't redirect automatically, tap the button below.</p>
    <button type="submit">Continue to PayU</button>
  </div>
</form>
<script>document.getElementById('payu').submit();</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
