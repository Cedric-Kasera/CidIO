#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
OUTPUT_DIR="$ROOT_DIR/dist-release"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "Bundle directory not found: $BUNDLE_DIR" >&2
  echo "Build the app first with: npm run tauri build" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
find "$OUTPUT_DIR" -maxdepth 1 -type f ! -name "README.md" -delete

copied=0
artifact_names=()

while IFS= read -r artifact; do
  cp "$artifact" "$OUTPUT_DIR/"
  copied=1
  artifact_names+=("$(basename "$artifact")")
done < <(
  find "$BUNDLE_DIR" -maxdepth 2 -type f \
    \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.tar.gz" -o -name "*.sig" -o -name "latest*.json" \) \
    | sort
)

if [[ "$copied" -eq 0 ]]; then
  echo "No release artifacts found in $BUNDLE_DIR" >&2
  exit 1
fi

checksum_cmd=()
if command -v sha256sum >/dev/null 2>&1; then
  checksum_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  checksum_cmd=(shasum -a 256)
fi

if [[ ${#checksum_cmd[@]} -gt 0 ]]; then
  (
    cd "$OUTPUT_DIR"
    "${checksum_cmd[@]}" "${artifact_names[@]}" > SHA256SUMS.txt
  )
fi

cat > "$OUTPUT_DIR/README.md" <<'EOF'
# Release Artifacts

This folder is generated from `src-tauri/target/release/bundle/`.

Refresh it with:

```bash
npm run release:collect
```
EOF

echo "Copied release artifacts to $OUTPUT_DIR"
