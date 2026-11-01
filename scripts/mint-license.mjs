#!/usr/bin/env node
// Mint a Nerva Pro licence key offline, with the same HMAC secret Vercel uses.
//
//   node scripts/mint-license.mjs <email> [plan=lifetime] [txnid]
//
// Reads secrets/license-signing.secret (or LICENSE_SIGNING_SECRET). The key
// becomes active the first time a device activates it; revoke later by adding
// the txnid to licenses/revoked.json in the metrics repo.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PLANS = { monthly: 31, yearly: 366, lifetime: 0 };
const [email, plan = "lifetime", txnidArg] = process.argv.slice(2);
if (!email || !email.includes("@") || !(plan in PLANS)) {
  console.error("usage: mint-license.mjs <email> [monthly|yearly|lifetime] [txnid]");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const secretPath = join(root, "secrets", "license-signing.secret");
const secret = process.env.LICENSE_SIGNING_SECRET ?? (existsSync(secretPath) ? readFileSync(secretPath, "utf8").trim() : "");
if (!secret) {
  console.error("no LICENSE_SIGNING_SECRET and no secrets/license-signing.secret");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const now = Math.floor(Date.now() / 1000);
const days = PLANS[plan];
const txnid = txnidArg ?? `manual-${plan}-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
const payload = { v: 1, iat: now, e: email.trim().toLowerCase(), p: plan, t: txnid, exp: days ? now + days * 86400 : 0 };
const body = b64url(JSON.stringify(payload));
const sig = b64url(createHmac("sha256", secret).update(body).digest());

console.log(`NERVA-${body}.${sig}`);
console.error(`plan=${plan} email=${payload.e} txnid=${txnid} expires=${payload.exp ? new Date(payload.exp * 1000).toISOString() : "never"}`);
