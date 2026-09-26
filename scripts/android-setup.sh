#!/usr/bin/env bash
# One-shot Android toolchain for Tauri 2 mobile — user-local, no sudo.
# Installs: Temurin JDK 17, Android cmdline-tools, platform-tools,
# platform 34, build-tools 34, NDK 27, Rust android targets.
# Re-runnable; skips anything already present. Prints the env exports to add
# to your shell at the end (also written to ~/.nerva-android.env).
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
JDK_DIR="$HOME/.local/jdk-17"
NDK_VER="27.0.12077973"
CMDLINE_ZIP="commandlinetools-linux-11076708_latest.zip"
JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"

mkdir -p "$SDK" "$HOME/.local"

# --- JDK 17 ------------------------------------------------------------------
if [[ ! -x "$JDK_DIR/bin/javac" ]]; then
  echo "▶ Installing Temurin JDK 17 → $JDK_DIR"
  tmp=$(mktemp -d)
  curl -fL --progress-bar "$JDK_URL" -o "$tmp/jdk.tar.gz"
  mkdir -p "$JDK_DIR"
  tar -xzf "$tmp/jdk.tar.gz" -C "$JDK_DIR" --strip-components=1
  rm -rf "$tmp"
fi
export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

# --- cmdline-tools -----------------------------------------------------------
if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
  echo "▶ Installing Android cmdline-tools → $SDK/cmdline-tools/latest"
  tmp=$(mktemp -d)
  curl -fL --progress-bar "https://dl.google.com/android/repository/$CMDLINE_ZIP" -o "$tmp/ct.zip"
  unzip -q "$tmp/ct.zip" -d "$tmp"
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$tmp"
fi
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"

# --- SDK packages ------------------------------------------------------------
echo "▶ Accepting licences + installing SDK packages (this is the slow part)"
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null || true
"$SDKMANAGER" --sdk_root="$SDK" \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;34.0.0" \
  "ndk;$NDK_VER"

# --- Rust targets ------------------------------------------------------------
echo "▶ Adding Rust Android targets"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# --- Env file ----------------------------------------------------------------
ENV_FILE="$HOME/.nerva-android.env"
cat >"$ENV_FILE" <<EOF
export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK"
export NDK_HOME="$SDK/ndk/$NDK_VER"
export PATH="\$JAVA_HOME/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
EOF

echo
echo "✔ Done. Load the environment with:"
echo "    source $ENV_FILE"
echo "then run:  npm run tauri android init   (first time)   /   npm run tauri android build"
