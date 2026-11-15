#!/bin/sh
# Downloads the OSM extract (Geofabrik) when the OSRM data is missing or REFRESH=true.
set -eu
if [ "${REFRESH:-false}" = "true" ] || [ ! -f /data/region.osrm.mldgr ]; then
  echo "Downloading ${OSM_URL} ..."
  curl -fL --retry 5 --retry-delay 10 -o /data/region.osm.pbf.tmp "${OSM_URL}"
  mv /data/region.osm.pbf.tmp /data/region.osm.pbf
else
  echo "OSRM data present; no download needed."
fi
