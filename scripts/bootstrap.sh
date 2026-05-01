#!/usr/bin/env bash
set -euo pipefail

# Downloads vendor libraries for local/offline use.
# Run from the project root:
#   bash scripts/bootstrap.sh

JSZIP_URL="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
JSON5_URL="https://cdnjs.cloudflare.com/ajax/libs/json5/2.2.3/index.min.js"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor"
TINYMCE_DIR="$ROOT_DIR/tinymce"

mkdir -p "$VENDOR_DIR" "$TINYMCE_DIR"

echo "==> Downloading JSZip -> vendor/jszip.min.js"
curl -fL "$JSZIP_URL" -o "$VENDOR_DIR/jszip.min.js"

echo "==> Downloading JSON5 -> vendor/json5.min.js"
# Saved as json5.min.js for consistent naming (CDN filename is index.min.js)
curl -fL "$JSON5_URL" -o "$VENDOR_DIR/json5.min.js"

echo "==> Installing TinyMCE to tinymce/ (via npm pack; includes plugins/skins/icons)"
if command -v npm >/dev/null 2>&1; then
  TMP_DIR="$(mktemp -d)"
  pushd "$TMP_DIR" >/dev/null
  npm pack tinymce@^8 >/dev/null
  TARFILE=$(ls tinymce-*.tgz | head -n 1)
  tar -xzf "$TARFILE"
  rm -rf "$TINYMCE_DIR"/*
  cp -R package/* "$TINYMCE_DIR"/
  popd >/dev/null
  rm -rf "$TMP_DIR"
  echo "   TinyMCE installed to $TINYMCE_DIR"
else
  echo "   WARNING: npm not found."
  echo "   TinyMCE needs plugins/skins/icons to run fully offline."
  echo "   Install Node/npm and rerun this script, or use the in-app 'Load from CDN' button." 
fi

echo "==> Done."
