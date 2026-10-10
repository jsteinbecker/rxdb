#!/usr/bin/env bash
# Captures every item in the /dev/iln-examples gallery (ILN doc examples and
# every shape) into static/iln-examples/<key>.png. Needs the dev server on :5199.
set -uo pipefail
BASE=${BASE:-http://localhost:5199/dev/iln-examples}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
OUT=static/iln-examples
mkdir -p "$OUT"
keys=$(curl -s "$BASE" | grep -o 'data-key="[^"]*"' | cut -d'"' -f2)
for k in $keys; do
	"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
		--window-size=500,280 --screenshot="$OUT/$k.png" "$BASE?only=$k" >/dev/null 2>&1
	echo "$OUT/$k.png"
done
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1400,4200 \
	--screenshot="$OUT/_gallery.png" "$BASE" >/dev/null 2>&1
