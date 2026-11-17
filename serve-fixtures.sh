#!/usr/bin/env bash
# Serves the dashboard on http://localhost:8000 from a throwaway copy (site-preview/, git-ignored) that holds the
# committed fixtures, so site/ itself never receives fixture data.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf site-preview
mkdir site-preview
for f in site/*; do
  [[ "$f" == site/fixtures ]] || cp -R "$f" site-preview/
done
cp -R site/fixtures/series site-preview/series
cp site/fixtures/index.json site/fixtures/latest.json site-preview/
cp -R data site-preview/data
exec python3 -m http.server -d site-preview 8000
