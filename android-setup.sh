#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# android-setup.sh — Restaurant POS · Full Android build setup
#
# Run this once from the repo root after cloning (or after wiping the android/
# directory).  The script installs Capacitor packages, builds Next.js, scaffolds
# the Android project, merges all custom files, and opens Android Studio.
#
# Usage:
#   chmod +x android-setup.sh
#   ./android-setup.sh
#
# Requirements:
#   - Node.js 18+  (check: node -v)
#   - Java 17+     (check: java -version)
#   - Android Studio installed (https://developer.android.com/studio)
#   - ANDROID_HOME env var set  (usually ~/Library/Android/sdk on macOS)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Locate the app directory relative to this script ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
SRC_DIR="$APP_DIR/android-src"

[[ -d "$APP_DIR" ]]  || error "Cannot find app/ directory at: $APP_DIR"
[[ -d "$SRC_DIR" ]]  || error "Cannot find android-src/ directory at: $SRC_DIR"

# ── 0. Pre-flight checks ──────────────────────────────────────────────────────
info "Checking requirements..."

command -v node >/dev/null 2>&1  || error "Node.js not found. Install from https://nodejs.org"
command -v java >/dev/null 2>&1  || error "Java not found. Install JDK 17+ from https://adoptium.net"

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
(( NODE_VER >= 18 )) || error "Node.js 18+ required. Current: $(node -v)"

JAVA_VER=$(java -version 2>&1 | head -1 | grep -oE '[0-9]+' | head -1)
(( JAVA_VER >= 17 )) || error "Java 17+ required. Current: $(java -version 2>&1 | head -1)"

if [[ -z "${ANDROID_HOME:-}" ]]; then
    # Try common macOS default
    if [[ -d "$HOME/Library/Android/sdk" ]]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
        warn "ANDROID_HOME not set — using $ANDROID_HOME"
    else
        error "ANDROID_HOME is not set. Open Android Studio, go to Preferences → Android SDK, copy the SDK path, then run:\n  export ANDROID_HOME=<path>\n  ./android-setup.sh"
    fi
fi

success "All requirements met."

# ── 1. Install npm packages ───────────────────────────────────────────────────
info "Installing npm packages (including Capacitor)..."
cd "$APP_DIR"
npm install
npm install \
    @capacitor/core \
    @capacitor/android \
    @capacitor/splash-screen \
    --save
npm install @capacitor/cli --save-dev
success "npm packages installed."

# ── 2. Build Next.js ──────────────────────────────────────────────────────────
info "Building Next.js app..."
npm run build
success "Next.js build complete."

# ── 3. Add / reset the Android platform ──────────────────────────────────────
ANDROID_DIR="$APP_DIR/android"

if [[ -d "$ANDROID_DIR" ]]; then
    warn "android/ already exists — skipping 'cap add android'. Delete it first if you want a clean scaffold."
else
    info "Scaffolding Android project with 'npx cap add android'..."
    npx cap add android
    success "Android platform added."
fi

# ── 4. Copy custom Kotlin files ───────────────────────────────────────────────
info "Copying custom Kotlin plugins and workers..."

KOTLIN_DST="$ANDROID_DIR/app/src/main/java/com/restaurant/pos"
KOTLIN_SRC="$SRC_DIR/app/src/main/java/com/restaurant/pos"

mkdir -p "$KOTLIN_DST/plugins" "$KOTLIN_DST/sync"

cp "$KOTLIN_SRC/MainActivity.kt"                     "$KOTLIN_DST/MainActivity.kt"
cp "$KOTLIN_SRC/plugins/BluetoothPrinterPlugin.kt"   "$KOTLIN_DST/plugins/"
cp "$KOTLIN_SRC/plugins/UsbPrinterPlugin.kt"         "$KOTLIN_DST/plugins/"
cp "$KOTLIN_SRC/plugins/TcpPrinterPlugin.kt"         "$KOTLIN_DST/plugins/"
cp "$KOTLIN_SRC/sync/OutboxSyncWorker.kt"            "$KOTLIN_DST/sync/"
cp "$KOTLIN_SRC/sync/MenuSyncWorker.kt"              "$KOTLIN_DST/sync/"

success "Kotlin files copied."

# ── 5. Copy network security config ──────────────────────────────────────────
info "Copying network_security_config.xml..."

XML_DST="$ANDROID_DIR/app/src/main/res/xml"
mkdir -p "$XML_DST"
cp "$SRC_DIR/app/src/main/res/xml/network_security_config.xml" "$XML_DST/"

success "network_security_config.xml copied."

# ── 6. Merge build.gradle additions ──────────────────────────────────────────
info "Merging build.gradle dependencies..."

GRADLE_FILE="$ANDROID_DIR/app/build.gradle"
[[ -f "$GRADLE_FILE" ]] || error "build.gradle not found at: $GRADLE_FILE"

# Only patch if not already patched
if grep -q "kotlinx-coroutines-android" "$GRADLE_FILE"; then
    warn "build.gradle already patched — skipping."
else
    # Ensure minSdkVersion is at least 26
    if grep -q "minSdkVersion" "$GRADLE_FILE"; then
        CURRENT_MIN=$(grep "minSdkVersion" "$GRADLE_FILE" | grep -oE '[0-9]+' | head -1)
        if (( CURRENT_MIN < 26 )); then
            sed -i '' "s/minSdkVersion [0-9]*/minSdkVersion 26/" "$GRADLE_FILE"
            info "Updated minSdkVersion to 26."
        fi
    fi

    # Append custom dependencies before the final closing brace of the dependencies block
    DEPS_TO_ADD='
    // ── Kotlin coroutines ────────────────────────────────────────────────────
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3"

    // ── WorkManager (OutboxSyncWorker + MenuSyncWorker) ──────────────────────
    implementation "androidx.work:work-runtime-ktx:2.9.0"

    // ── OkHttp (sync workers HTTP calls) ─────────────────────────────────────
    implementation "com.squareup.okhttp3:okhttp:4.12.0"

    // ── Core KTX helpers ─────────────────────────────────────────────────────
    implementation "androidx.core:core-ktx:1.12.0"'

    # Insert before the last closing brace of the dependencies { } block
    python3 - "$GRADLE_FILE" "$DEPS_TO_ADD" <<'PYEOF'
import sys, re

path = sys.argv[1]
additions = sys.argv[2]

with open(path, 'r') as f:
    content = f.read()

# Find the last closing brace of the dependencies block
pattern = r'(dependencies\s*\{)([\s\S]*?)(\n\})'
match = re.search(pattern, content)
if match:
    new_block = match.group(1) + match.group(2) + additions + match.group(3)
    content = content[:match.start()] + new_block + content[match.end():]
    with open(path, 'w') as f:
        f.write(content)
    print("build.gradle patched.")
else:
    print("WARNING: Could not find dependencies block — add manually.")
PYEOF

    success "build.gradle dependencies merged."
fi

# ── 7. Merge AndroidManifest.xml ─────────────────────────────────────────────
info "Merging AndroidManifest.xml permissions and features..."

MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
[[ -f "$MANIFEST" ]] || error "AndroidManifest.xml not found at: $MANIFEST"

if grep -q "BLUETOOTH_CONNECT" "$MANIFEST"; then
    warn "AndroidManifest.xml already patched — skipping."
else
    python3 - "$MANIFEST" <<'PYEOF'
import sys, re

path = sys.argv[1]

permissions = """
    <!-- Bluetooth (Android ≤ 11) -->
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <!-- Bluetooth (Android 12+) -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <!-- USB Host -->
    <uses-feature android:name="android.hardware.usb.host" android:required="false" />
    <!-- Network -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- WorkManager background sync -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />"""

ns_config = 'android:networkSecurityConfig="@xml/network_security_config"'
keep_screen = 'android:keepScreenOn="true"'
orientation = 'android:screenOrientation="landscape"'

with open(path, 'r') as f:
    content = f.read()

# 1. Insert permissions after <manifest ...>
content = re.sub(
    r'(<manifest[^>]*>)',
    r'\1' + permissions,
    content,
    count=1
)

# 2. Add networkSecurityConfig to <application> tag
if ns_config not in content:
    content = re.sub(
        r'(<application\b)',
        r'\1\n        ' + ns_config,
        content,
        count=1
    )

# 3. Add keepScreenOn + landscape to MainActivity <activity> tag
if keep_screen not in content:
    content = re.sub(
        r'(<activity\b[^>]*android:name=".MainActivity"[^>]*)',
        r'\1\n            ' + keep_screen + '\n            ' + orientation,
        content,
        count=1
    )

with open(path, 'w') as f:
    f.write(content)

print("AndroidManifest.xml patched.")
PYEOF
    success "AndroidManifest.xml merged."
fi

# ── 8. Sync Capacitor ─────────────────────────────────────────────────────────
info "Running 'npx cap sync android'..."
npx cap sync android
success "Capacitor sync complete."

# ── 9. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Android project is ready!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Open Android Studio:"
echo "       npx cap open android"
echo "     OR"
echo "       open -a 'Android Studio' '$ANDROID_DIR'"
echo ""
echo "  2. Plug in your Android device (USB debugging on)"
echo "     OR start an emulator (API 26+)"
echo ""
echo "  3. Click ▶ Run in Android Studio"
echo ""
echo "  4. To generate a release APK:"
echo "       Build → Generate Signed Bundle / APK → APK"
echo ""
echo "  Before running again after code changes:"
echo "       cd app && npm run build && npx cap sync android"
echo ""
