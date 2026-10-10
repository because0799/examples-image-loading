#!/usr/bin/env bash
# Builds dist/EpicCheckers.apk without Gradle or the Android SDK, using the Debian packages
# aapt (v1), dalvik-exchange (dx), zipalign and apksigner plus a JDK, and the android.jar in
# /opt/android-jars.
#
#   bash tools/build-apk.sh               # web build + APK
#   bash tools/build-apk.sh --skip-web    # reuse the existing dist/www
#   bash tools/build-apk.sh --icons       # also regenerate launcher icons (needs Playwright)
#
# Steps: web bundle -> stage res + assets/www -> aapt package (resources.arsc stored) ->
# javac (Java 8 bytecode, no lambdas) -> dx -> classes.dex -> zipalign -p 4 -> apksigner
# (v2 + v3) -> verification + summary. Idempotent: everything is rebuilt in dist/apk-build.
#
# Signing key: android/keystore/epic-checkers.jks (alias "epic", password "epicbadass").
# It is committed on purpose so every build of this hobby project has the same signature and
# installs as an update over the previous one. Created with keytool if missing.
#
# Tool locations can be overridden: AAPT, DX, ZIPALIGN, APKSIGNER, JAVAC, KEYTOOL, ANDROID_JAR.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_WEB=0
ICONS=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --icons) ICONS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

AAPT="${AAPT:-aapt}"
DX="${DX:-dalvik-exchange}"
ZIPALIGN="${ZIPALIGN:-zipalign}"
APKSIGNER="${APKSIGNER:-apksigner}"
JAVAC="${JAVAC:-javac}"
KEYTOOL="${KEYTOOL:-keytool}"
ANDROID_JAR="${ANDROID_JAR:-/opt/android-jars/android-34-reginer.jar}"

MIN_SDK=24
TARGET_SDK=34
MANIFEST="$ROOT/android/AndroidManifest.xml"
JAVA_SRC="$ROOT/android/java"
RES_SRC="$ROOT/android/res"
KEYSTORE="$ROOT/android/keystore/epic-checkers.jks"
KEY_ALIAS="epic"
KEY_PASS="epicbadass"
WWW="$ROOT/dist/www"
BUILD="$ROOT/dist/apk-build"
OUT="$ROOT/dist/EpicCheckers.apk"

say() { printf '\033[1;35m[apk]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[apk] error:\033[0m %s\n' "$*" >&2; exit 1; }

# Runs a Java-based tool and hides the noisy "Picked up JAVA_TOOL_OPTIONS" banner.
quiet_java() {
  local log status
  log="$(mktemp)"
  set +e
  "$@" >"$log" 2>&1
  status=$?
  set -e
  grep -v '^Picked up JAVA_TOOL_OPTIONS' "$log" | sed '/^[[:space:]]*$/d' || true
  rm -f "$log"
  return "$status"
}

need() { command -v "$1" >/dev/null 2>&1 || die "missing tool '$1' ($2)"; }
need "$AAPT" "apt install aapt"
need "$DX" "apt install dalvik-exchange"
need "$ZIPALIGN" "apt install zipalign"
need "$APKSIGNER" "apt install apksigner"
need "$JAVAC" "install a JDK (8+)"
need "$KEYTOOL" "install a JDK (8+)"
[[ -f "$ANDROID_JAR" ]] || die "android.jar not found at $ANDROID_JAR (set ANDROID_JAR)"
[[ -f "$MANIFEST" ]] || die "missing $MANIFEST"

# ---------------------------------------------------------------- 1. web bundle
if [[ "$SKIP_WEB" == 0 ]]; then
  say "building web bundle (node tools/build-web.mjs)"
  node tools/build-web.mjs
fi
[[ -f "$WWW/index.html" ]] || die "dist/www/index.html missing - run without --skip-web"
if [[ "$SKIP_WEB" == 1 && "${ALLOW_STALE_WEB:-0}" != 1 ]]; then
  # --skip-web must not package a web build that is older than the sources (F5)
  STALE="$(find "$ROOT/src" "$ROOT/web" -type f -newer "$WWW/app.js" ! -path '*/src/dev/*' | head -5)"
  [[ -z "$STALE" ]] || die "dist/www is older than the sources (e.g. ${STALE//$'\n'/, }) - run without --skip-web (or ALLOW_STALE_WEB=1)"
fi

# ---------------------------------------------------------------- 2. icons
if [[ "$ICONS" == 1 || ! -f "$RES_SRC/mipmap-xxxhdpi/ic_launcher.png" || ! -f "$RES_SRC/mipmap-anydpi-v26/ic_launcher.xml" ]]; then
  say "rendering launcher icons (node tools/make-icon.mjs)"
  node tools/make-icon.mjs
fi

# ---------------------------------------------------------------- 3. stage
say "staging resources and assets"
rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/assets/www" "$BUILD/gen" "$BUILD/classes"
cp -R "$RES_SRC/." "$BUILD/res/"
cp -R "$WWW/." "$BUILD/assets/www/"
# never ship source maps, debug copies, unused icons or stray OS files (F5)
find "$BUILD/assets" \( -name '*.map' -o -name '.DS_Store' -o -name 'Thumbs.db' \) -type f -delete
rm -f "$BUILD/assets/www/ai-worker.js" "$BUILD/assets/www/icon-512.png"
sed -i '/href="icon-512\.png"/d' "$BUILD/assets/www/index.html"
# a --dev bundle (inline source map, __DEV__ = true → debug hooks on) must never be packaged
if grep -q 'sourceMappingURL=data:' "$BUILD/assets/www/app.js"; then
  die "dist/www/app.js is a --dev build (inline source map) - run node tools/build-web.mjs without --dev"
fi

# ---------------------------------------------------------------- 4. resources (aapt v1)
say "aapt package (minSdk $MIN_SDK, targetSdk $TARGET_SDK)"
# -0 arsc: resources.arsc must be STORED (uncompressed) for targetSdk >= 30.
# Woff2/png/ogg/mp3 are already compressed; aapt stores known media types as-is anyway.
# --ignore-assets: aapt's default also drops dot-files and "_dir" folders - keep those.
"$AAPT" package -f \
  --ignore-assets '!.svn:!.git:!.DS_Store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~' \
  -M "$MANIFEST" \
  -S "$BUILD/res" \
  -A "$BUILD/assets" \
  -I "$ANDROID_JAR" \
  -J "$BUILD/gen" \
  -F "$BUILD/unaligned.apk" \
  -0 arsc \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK"

# ---------------------------------------------------------------- 5. code
say "javac (Java 8 bytecode against android-$TARGET_SDK)"
find "$JAVA_SRC" "$BUILD/gen" -name '*.java' | sort > "$BUILD/sources.txt"
quiet_java "$JAVAC" \
  -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" \
  -encoding UTF-8 \
  -Xlint:-options \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

say "dx -> classes.dex"
quiet_java "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$BUILD/classes.dex" "$BUILD/classes"
[[ -s "$BUILD/classes.dex" ]] || die "dx produced no classes.dex"
(cd "$BUILD" && "$AAPT" add -f unaligned.apk classes.dex >/dev/null)

# ---------------------------------------------------------------- 6. align
say "zipalign -p 4"
"$ZIPALIGN" -p -f 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk"

# ---------------------------------------------------------------- 7. sign
if [[ ! -f "$KEYSTORE" ]]; then
  say "creating signing key $KEYSTORE"
  mkdir -p "$(dirname "$KEYSTORE")"
  quiet_java "$KEYTOOL" -genkeypair -noprompt \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Epic Checkers, OU=Hobby, O=Epic Checkers, C=RU"
fi
say "apksigner sign (v2 + v3)"
rm -f "$OUT" "$OUT.idsig"
quiet_java "$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEY_PASS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version "$MIN_SDK" \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --v4-signing-enabled false \
  --out "$OUT" "$BUILD/aligned.apk"

# ---------------------------------------------------------------- 8. verify
say "verifying"
quiet_java "$APKSIGNER" verify --min-sdk-version "$MIN_SDK" --verbose "$OUT" | grep -E '^Verifies|Verified using v[1-4]|^WARNING|^ERROR' || true
quiet_java "$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$OUT" >/dev/null || die "apksigner verify failed"
"$ZIPALIGN" -c -p 4 "$OUT" >/dev/null || die "zipalign check failed"
ARSC_METHOD="$(unzip -v "$OUT" resources.arsc | awk '$NF=="resources.arsc"{print $2}')"
[[ "$ARSC_METHOD" == "Stored" ]] || die "resources.arsc is '$ARSC_METHOD', must be Stored"
unzip -l "$OUT" classes.dex >/dev/null || die "classes.dex missing from APK"
unzip -l "$OUT" assets/www/index.html >/dev/null || die "assets/www/index.html missing from APK"
unzip -p "$OUT" assets/www/app.js | cmp -s - "$WWW/app.js" || die "packaged app.js differs from dist/www/app.js"
STAGED_COUNT="$(cd "$BUILD" && find assets -type f | wc -l)"
PACKED_COUNT="$(unzip -Z1 "$OUT" 'assets/*' | grep -vc '/$' || true)"
if [[ "$STAGED_COUNT" != "$PACKED_COUNT" ]]; then
  (cd "$BUILD" && find assets -type f | sort) > "$BUILD/staged.txt"
  unzip -Z1 "$OUT" 'assets/*' | sort > "$BUILD/packed.txt"
  diff "$BUILD/staged.txt" "$BUILD/packed.txt" >&2 || true
  die "aapt dropped assets ($PACKED_COUNT of $STAGED_COUNT packed)"
fi

"$AAPT" dump badging "$OUT" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|application-label-ru|application-label-en|application-icon-160|launchable-activity|uses-permission):" || true

SIZE_BYTES="$(stat -c %s "$OUT")"
SIZE_HUMAN="$(numfmt --to=iec-i --suffix=B "$SIZE_BYTES" 2>/dev/null || echo "$SIZE_BYTES bytes")"
ASSETS="$(unzip -l "$OUT" 'assets/*' | tail -1 | awk '{print $2}')"
say "OK -> ${OUT#$ROOT/} ($SIZE_HUMAN, $SIZE_BYTES bytes; $ASSETS asset files)"
