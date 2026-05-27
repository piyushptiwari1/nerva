#!/usr/bin/env bash
# Generate a self-signed code-signing certificate (PFX) for Bytical / Nerva.
#
# Usage:
#   ./scripts/gen-signing-cert.sh
#
# Output:
#   secrets/bytical-codesign.key       (private key, KEEP SECRET)
#   secrets/bytical-codesign.crt       (public certificate)
#   secrets/bytical-codesign.pfx       (combined PFX for signtool / osslsigncode)
#   secrets/bytical-codesign.pfx.b64   (base64 form for GitHub Actions secret)
#
# Then add to GitHub repo secrets:
#   WINDOWS_CERTIFICATE          = <contents of bytical-codesign.pfx.b64>
#   WINDOWS_CERTIFICATE_PASSWORD = <the password you used below>

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( dirname "$SCRIPT_DIR" )"
OUT_DIR="$REPO_ROOT/secrets"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

if [[ -f bytical-codesign.pfx ]]; then
  echo "[gen-signing-cert] secrets/bytical-codesign.pfx already exists. Refusing to overwrite."
  echo "                   Delete it first if you really want to regenerate."
  exit 1
fi

# Read PFX password (no echo)
read -srp "Choose a password for the PFX (will be needed in CI): " PFX_PW
echo

# 1. Private key
openssl genrsa -out bytical-codesign.key 4096

# 2. Self-signed certificate, 3-year validity, with codeSigning EKU
cat > bytical-codesign.cnf <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions    = v3_codesign
prompt             = no

[req_distinguished_name]
C  = IN
O  = Bytical Solutions Private Limited
OU = Nerva
CN = Bytical Solutions Private Limited

[v3_codesign]
basicConstraints     = critical, CA:FALSE
keyUsage             = critical, digitalSignature
extendedKeyUsage     = critical, codeSigning
subjectKeyIdentifier = hash
EOF

openssl req -x509 -new -key bytical-codesign.key \
  -out bytical-codesign.crt \
  -days 1095 \
  -sha256 \
  -config bytical-codesign.cnf

# 3. Bundle to PFX (PKCS#12) for signtool / osslsigncode
openssl pkcs12 -export \
  -out bytical-codesign.pfx \
  -inkey bytical-codesign.key \
  -in bytical-codesign.crt \
  -name "Bytical Solutions Private Limited" \
  -passout "pass:${PFX_PW}"

# 4. Base64 form for GitHub Actions secret
base64 -w 0 bytical-codesign.pfx > bytical-codesign.pfx.b64

# 5. SHA-1 thumbprint (signtool / Tauri windows.certificateThumbprint)
THUMB=$(openssl x509 -in bytical-codesign.crt -noout -fingerprint -sha1 | sed 's/^.*=//;s/://g')
echo "$THUMB" > bytical-codesign.thumbprint.txt

rm -f bytical-codesign.cnf

cat <<EOM

[gen-signing-cert] DONE.

  PFX file:            $OUT_DIR/bytical-codesign.pfx
  PFX base64:          $OUT_DIR/bytical-codesign.pfx.b64
  SHA-1 thumbprint:    $THUMB
  Validity:            3 years from today

NEXT STEPS:
  1. Add to GitHub repo secrets (Settings → Secrets and variables → Actions):
       WINDOWS_CERTIFICATE          = <paste contents of bytical-codesign.pfx.b64>
       WINDOWS_CERTIFICATE_PASSWORD = <the password you just chose>
       WINDOWS_CERTIFICATE_THUMBPRINT = $THUMB

  2. Distribute bytical-codesign.crt to users who want full trust
     (they import it into "Trusted Root CAs" → no SmartScreen warning).

  3. NEVER commit anything in secrets/ — already in .gitignore.

EOM
