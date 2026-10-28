#!/usr/bin/env bash
# Builds the installable extension zip for a GitHub release (or a store upload).
#
# Usage: scripts/package-release.sh
# Output: dist/search-warm-up-v<version>.zip, where <version> comes from manifest.json
#
# Only files the extension needs at runtime (plus its license and privacy
# policy) go into the zip; developer tools, tests and local files stay out.

set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

# Read the version from manifest.json so the zip name always matches it.
version="$(node -p 'require("./manifest.json").version')"
output_dir="dist"
output_zip="$output_dir/search-warm-up-v$version.zip"

mkdir -p "$output_dir"
rm -f "$output_zip"

zip -r -X "$output_zip" \
  manifest.json \
  src \
  icons \
  LICENSE \
  PRIVACY.md \
  -x "*.DS_Store"

echo
echo "Built $output_zip"
