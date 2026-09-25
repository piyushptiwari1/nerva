# Nerva Pro — design, licensing & payments

## Payments (PayU)

- Gateway: **PayU India** (`PAYU_KEY` / `PAYU_SALT` / `PAYU_BASE_URL` — identical values to the Bytical platform backend's `.env.production`). Hash algorithm mirrors `routes/payment_endpoints.py` exactly.
- **International cards:** PayU India accepts foreign-issued Visa / Mastercard / Amex and settles to us in INR ("International Payments" must be **enabled on the merchant account** — PayU support ticket + KYC; it is off by default on new accounts). The cardholder's bank converts INR → local currency. PayU also offers multi-currency pricing (135+ currencies, DCC) on request — we show ≈ USD equivalents on the site and charge INR.
- UPI / net-banking are India-only; cards are the international path. If PayU declines a foreign card, the failure page tells the buyer to use a card and offers the feedback form.
- Prices (INR, GST-inclusive, SAC 997331): Monthly ₹249 · Yearly ₹1,999 · Lifetime ₹4,999. Single source: `web/api/_lib/license.ts → PLANS`; the `#pro` section on the site mirrors it manually.
- No auto-renew. Reminder emails invite a manual renewal; a renewal issues a fresh key.

## Licence model

```
purchase ──► licence KEY  (NERVA-<payload>.<hmac>)  — bound to email, plan, txnid, expiry
                 │  HMAC-SHA256 with LICENSE_SIGNING_SECRET; only the server can read/verify it
                 ▼
app: Settings → Pro → paste key ──► POST /api/license-activate {key, device_id}
                 │  server checks: HMAC ok · not expired · not revoked · device slots
                 ▼
device TOKEN  (NVT1.<payload>.<ecdsa-p256>)  — bound to THIS device id, 30-day TTL
                 │  signed with LICENSE_SIGNING_JWK (private) ; public key compiled into Rust
                 ▼
Rust core `license_status` re-verifies signature + device + expiry on every call → isPro
```

- **Sign in anywhere with the same identity:** the key is the identity (tied to the purchase email). Paste it on any machine. Forgotten? "Lost your key?" (app + site) emails every key registered to that address — `/api/license-recover` always returns 204 so it cannot be used to probe emails.
- **Limits:** simultaneous devices — Monthly 2 · Yearly 3 · Lifetime 5. Re-activating an existing device never consumes a slot. Users remove devices from Settings → Pro (`/api/license-deactivate`); a removed device keeps working until its 30-day token lapses.
- **Offline:** the last verified token works until it expires; the app refreshes when < 10 days remain. Revocation (`licenses/revoked.json`) or expiry surfaces at the next refresh.
- **Anti-tamper (honest statement):** Nerva is open source, so a determined user can patch the binary — no licence scheme prevents that. What we guarantee: no data edit (SQLite / localStorage / config) can produce Pro, because the app only trusts an ECDSA signature it cannot forge; keys are useless past the device cap; and revocation propagates within 30 days. Server-side Pro features (backup relay) are gated on the server independently, so patched clients get nothing there.

## Emails (Mailjet — Bytical account, `MAILJET_API_KEY` / `MAILJET_API_SECRET`, from `hello@bytical.ai`)

| When | Template | Content |
|---|---|---|
| Payment success | `purchaseMail` | Plan, amount, **licence key**, activation steps, device limit, invoice link (signed) |
| Payment success but key issuance failed | `purchaseMail` (pending) | Reference + "reply to get your key" |
| T-7 days / T-1 day / expiry (monthly, yearly) | `reminderMail` | Renew CTA, no auto-renew reassurance — daily cron `/api/cron-reminders` (09:00 UTC), state in `licenses/reminders.json` |
| "Lost your key" | `recoveryMail` | All keys for that email with plan + expiry |

Invoice: `/api/invoice?txnid=…&sig=…` — printable tax invoice (GST 18 % breakdown, SAC 997331). Fill `BYTICAL_GSTIN` and `BYTICAL_ADDRESS` in Vercel env to print them.

## How Pro looks in the app

- Gold **★ Pro** chip in the command bar (click → Settings → Pro).
- Settings → Pro card turns gold-bordered with plan, expiry, email hint and device list.
- Pro-only surfaces (Drive backup card, multi-device restore) show a lock + "Pro" tag for free users and are live for Pro — the `useLicense().isPro` flag, backed by the Rust-verified status, gates them.
- Everything that exists today stays free; Pro never removes a feature.

## Required Vercel env (production)

| Var | Purpose |
|---|---|
| `PAYU_KEY`, `PAYU_SALT`, `PAYU_BASE_URL` | PayU live (`https://secure.payu.in/_payment`) — from Bytical backend `.env.production` |
| `LICENSE_SIGNING_SECRET` | HMAC for licence keys + invoice links (random ≥ 32 bytes) |
| `LICENSE_SIGNING_JWK` | ECDSA P-256 **private** JWK for device tokens (`secrets/license-signing.private.jwk.json`) — public half is in `src-tauri/src/license.rs` |
| `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAIL_FROM` | Transactional email |
| `GH_METRICS_TOKEN` | Already present — licence records + activations live in the private metrics repo |
| `CRON_SECRET` | Protects `/api/cron-reminders` |
| `BYTICAL_GSTIN`, `BYTICAL_ADDRESS` | Invoice header (optional) |

## Data stored (private `nerva-metrics` repo)

- `events/licenses/YYYY-MM-DD.json` — purchases (email, name, plan, amount, txnid, exp, key)
- `licenses/activations/<txnid>.json` — device list per licence
- `licenses/revoked.json` — array of txnids
- `licenses/reminders.json` — sent-reminder flags
