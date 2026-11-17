#!/usr/bin/env bash
# Serves the dashboard on http://localhost:8000 using the committed fixtures instead of real results.
# The copied files are git-ignored. Do not run this where site/series holds real exported data: it would be replaced.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf site/series
cp -R site/fixtures/series site/series
cp site/fixtures/index.json site/fixtures/latest.json site/
exec python3 -m http.server -d site 8000
