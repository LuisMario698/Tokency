#!/bin/sh
# Compila la app de Mac con SwiftPM y arma Tokency.app (D-012).
#
#   scripts/mac/build-app.sh             compila y deja el .app en apps/mac/build/
#   scripts/mac/build-app.sh --install   además lo instala en ~/Applications y lo abre
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PKG="$ROOT/apps/mac"
OUT="$PKG/build"
APP="$OUT/Tokency.app"
INSTALL_DIR="$HOME/Applications"
BUNDLE_ID="com.tokency.mac"

VERSION=$(node -p "require('$ROOT/package.json').version")
BUILD=$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)

echo "Verificando TokencyKit…"
swift run --package-path "$PKG" TokencyKitChecks 2>&1 | grep -E 'TokencyKit:|✗'

echo "Compilando Tokency $VERSION ($BUILD)…"
swift build --package-path "$PKG" -c release --product Tokency 2>&1 | grep -E 'error|Build complete' || true
BIN="$(swift build --package-path "$PKG" -c release --show-bin-path)/Tokency"
[ -x "$BIN" ] || { echo "No se generó el ejecutable." >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/Tokency"
cat >"$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleName</key>
	<string>Tokency</string>
	<key>CFBundleDisplayName</key>
	<string>Tokency</string>
	<key>CFBundleExecutable</key>
	<string>Tokency</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$BUILD</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>Proyecto personal de Luis Mario.</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
</dict>
</plist>
EOF
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Firma local (ad hoc): basta para una app personal que no se distribuye.
codesign --force --sign - --identifier "$BUNDLE_ID" "$APP"
echo "Listo: $APP"

if [ "${1:-}" = "--install" ]; then
  osascript -e 'tell application id "com.tokency.mac" to quit' >/dev/null 2>&1 || true
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/Tokency.app"
  ditto "$APP" "$INSTALL_DIR/Tokency.app"
  open "$INSTALL_DIR/Tokency.app"
  echo "Instalada y abierta: $INSTALL_DIR/Tokency.app"
fi
