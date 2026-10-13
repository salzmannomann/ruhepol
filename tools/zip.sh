#!/usr/bin/env bash
# Baut die ZIP zum Verteilen: dist/ruhepol-<Version>.zip (ohne Testmodelle und ohne die 118-MB-Modelldatei,
# dafür mit Hinweisdatei, wo das Modell hingehört).
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(node -p "require('./extension/manifest.json').version")
tmp=$(mktemp -d)
cp -r extension "$tmp/ruhepol"
rm -rf "$tmp/ruhepol/vendor/test" "$tmp/ruhepol/vendor/models/test" \
  "$tmp/ruhepol/vendor/models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx"
cp tools/HIER-MODELL-ABLEGEN.txt "$tmp/ruhepol/HIER-MODELL-ABLEGEN.txt"
cp tools/HIER-MODELL-ABLEGEN.txt "$tmp/ruhepol/vendor/models/Xenova/multilingual-e5-small/onnx/HIER-MODELL-ABLEGEN.txt"
mkdir -p dist
rm -f "dist/ruhepol-$v.zip"
(cd "$tmp" && zip -qr "$OLDPWD/dist/ruhepol-$v.zip" ruhepol)
rm -rf "$tmp"
echo "dist/ruhepol-$v.zip"
