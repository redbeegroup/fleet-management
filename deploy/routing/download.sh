#!/bin/sh
# Downloads the OSM extract when the OSRM data is missing or REFRESH=true.
# Slow or unreliable links: the partial file is kept and the transfer resumes (also across pod restarts).
set -eu
TMP=/data/region.osm.pbf.part
if [ "${REFRESH:-false}" != "true" ] && [ -f /data/region.osrm.mldgr ]; then
  echo "OSRM data present; no download needed."
  exit 0
fi
if [ "${REFRESH:-false}" = "true" ] && [ -f /data/region.osm.pbf ] && [ ! -f "$TMP" ]; then
  : > "$TMP" # refresh: start a new download, keep the old extract until it completes
fi
echo "Downloading ${OSM_URL} (resumable) ..."
n=0
until curl -fL -C - --connect-timeout 30 --speed-limit 1 --speed-time 300 -o "$TMP" "${OSM_URL}"; do
  rc=$?
  n=$((n + 1))
  # 33: the server does not support ranges; 36: bad resume offset. Start over in both cases.
  if [ "$rc" = 33 ] || [ "$rc" = 36 ]; then echo "cannot resume (curl $rc); restarting the download"; : > "$TMP"; fi
  [ "$n" -ge 200 ] && { echo "giving up after $n attempts"; exit 1; }
  echo "transfer interrupted (curl $rc, $(wc -c < "$TMP") bytes so far); retrying (attempt $n)"
  sleep "${RETRY_DELAY:-20}"
done
mv "$TMP" /data/region.osm.pbf
echo "Downloaded $(wc -c < /data/region.osm.pbf) bytes."
