#!/usr/bin/env bash
# Push every production env var Nerva's web functions need into the Vercel
# project. Values are read locally and piped straight into `vercel env add`;
# nothing is printed or committed.
#
#   ./scripts/set-vercel-env.sh            # add missing vars
#   ./scripts/set-vercel-env.sh --force    # overwrite existing ones
#
# Sources:
#   PAYU_*                   ← Bytical platform backend .env.production (live PayU)
#   MAILJET_*                ← same file
#   LICENSE_SIGNING_JWK      ← secrets/license-signing.private.jwk.json
#   LICENSE_SIGNING_SECRET   ← secrets/license-signing.secret (generated if missing)
#   CRON_SECRET              ← secrets/cron.secret (generated if missing)
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_ENV="${BYTICAL_BACKEND_ENV:-$HOME/Desktop/Bytical/bytical-platform-backend/.env.production}"
FORCE="${1:-}"

command -v vercel >/dev/null || { echo "vercel CLI missing: npm i -g vercel"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "Not logged in — run: vercel login"; exit 1; }
[ -f "$BACKEND_ENV" ] || { echo "Missing $BACKEND_ENV"; exit 1; }

# Read KEY="value" or KEY=value from a dotenv file.
readenv() { grep -E "^$1=" "$BACKEND_ENV" | head -1 | sed -E 's/^[^=]+=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }

mkdir -p secrets
[ -f secrets/license-signing.secret ] || openssl rand -base64 48 | tr -d '\n' > secrets/license-signing.secret
[ -f secrets/cron.secret ] || openssl rand -hex 24 | tr -d '\n' > secrets/cron.secret
[ -f secrets/license-signing.private.jwk.json ] || { echo "Missing secrets/license-signing.private.jwk.json (generate with the node snippet in docs/PRO.md)"; exit 1; }

existing="$(vercel env ls production 2>/dev/null | awk '{print $1}')"

setvar() { # name value
  local name="$1" value="$2"
  [ -n "$value" ] || { echo "skip $name (empty)"; return; }
  if grep -qx "$name" <<<"$existing"; then
    if [ "$FORCE" = "--force" ]; then
      printf '%s' "$value" | vercel env add "$name" production --force >/dev/null && echo "updated $name"
    else
      echo "exists  $name (use --force to overwrite)"
    fi
  else
    printf '%s' "$value" | vercel env add "$name" production >/dev/null && echo "added   $name"
  fi
}

setvar PAYU_KEY               "$(readenv PAYU_KEY)"
setvar PAYU_SALT              "$(readenv PAYU_SALT)"
setvar PAYU_BASE_URL          "$(readenv PAYU_BASE_URL)"
setvar MAILJET_API_KEY        "$(readenv MAILJET_API_KEY)"
setvar MAILJET_API_SECRET     "$(readenv MAILJET_API_SECRET)"
setvar MAIL_FROM              "hello@bytical.ai"
setvar LICENSE_SIGNING_JWK    "$(cat secrets/license-signing.private.jwk.json)"
setvar LICENSE_SIGNING_SECRET "$(cat secrets/license-signing.secret)"
setvar CRON_SECRET            "$(cat secrets/cron.secret)"

echo
echo "Done. Redeploy so edge functions pick up the new env:  vercel --prod  (or push to main)"
echo "Optional: BYTICAL_GSTIN / BYTICAL_ADDRESS for invoices:  printf 'GSTIN' | vercel env add BYTICAL_GSTIN production"
