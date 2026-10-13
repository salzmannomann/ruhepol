#!/usr/bin/env bash
# Legt ältere Stände der Erweiterung zum Vergleichen an: tools/versionen.sh 1.21.0 1.28.2 …
# → .vergleich/<Version>/extension (vendor/ als harte Links aus dem aktuellen Stand).
# „aktuell“ nimmt den Arbeitsstand (auch Ungespeichertes).
set -euo pipefail
cd "$(dirname "$0")/.."
for v in "$@"; do
  d=".vergleich/$v"
  rm -rf "$d"; mkdir -p "$d"
  if [ "$v" = aktuell ]; then
    cp -r extension "$d/"; rm -rf "$d/extension/vendor"
  else
    c=$(git log --format=%h -S"\"version\": \"$v\"" -- extension/manifest.json | tail -1)
    [ -n "$c" ] || { echo "Version $v nicht gefunden" >&2; exit 1; }
    git archive "$c" extension | tar -x -C "$d"
  fi
  cp -al extension/vendor "$d/extension/vendor"
  echo "$d/extension ($(node -p "require('./$d/extension/manifest.json').version"))"
done
