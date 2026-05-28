// Edge function: receive PayU's server-to-server callback (POSTed
// as application/x-www-form-urlencoded to both surl and furl) and
// verify the response hash before redirecting the user to a
// thank-you or failure page on the marketing site.
//
// Hash algorithm mirrors the Bytical platform backend
// (routes/payment_endpoints.py:verify_payu_response_hash):
//   SHA-512( SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key )

export const config = { runtime: "edge" };

async function sha512Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-512", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("POST or GET only", { status: 405 });
  }

  // PayU always POSTs form-encoded. A GET means the user opened the
  // URL directly — just bounce them home.
  if (req.method === "GET") {
    return Response.redirect(new URL("/support", req.url).toString(), 302);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.redirect(new URL("/support/failed", req.url).toString(), 302);
  }

  const get = (k: string): string => (form.get(k)?.toString() || "");

  const salt = process.env.PAYU_SALT;
  if (!salt) {
    return new Response("PayU not configured.", { status: 503 });
  }

  const key = get("key");
  const txnid = get("txnid");
  const amount = get("amount");
  const productinfo = get("productinfo");
  const firstname = get("firstname");
  const email = get("email");
  const status = get("status");
  const udf1 = get("udf1");
  const udf2 = get("udf2");
  const udf3 = get("udf3");
  const udf4 = get("udf4");
  const udf5 = get("udf5");
  const receivedHash = get("hash").toLowerCase();

  const hashSeq =
    `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}` +
    `|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const expected = await sha512Hex(hashSeq);

  const ok = constantTimeEqual(expected, receivedHash);

  // Log to Vercel runtime logs — useful for debugging / reconciling
  // donations against PayU dashboard. Never log salt or hash.
  console.log(
    JSON.stringify({
      event: "payu_callback",
      txnid,
      status,
      amount,
      udf2,
      hash_ok: ok,
    }),
  );

  const dest =
    ok && status === "success"
      ? `/support/thanks?txnid=${encodeURIComponent(txnid)}&amount=${encodeURIComponent(amount)}`
      : `/support/failed?txnid=${encodeURIComponent(txnid)}&status=${encodeURIComponent(status || "unknown")}`;

  return Response.redirect(new URL(dest, req.url).toString(), 303);
}
