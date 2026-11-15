#!/bin/sh
# Builds the OSRM road graph (MLD) from the OSM extract when it is missing or REFRESH=true.
set -eu
cd /data
if [ "${REFRESH:-false}" = "true" ] || [ ! -f region.osrm.mldgr ]; then
  echo "Preparing OSRM data from region.osm.pbf ..."
  rm -f region.osrm*
  osrm-extract -p /opt/car.lua region.osm.pbf
  osrm-partition region.osrm
  osrm-customize region.osrm
  echo "OSRM data ready."
else
  echo "OSRM data present; skipping (set REFRESH=true to rebuild)."
fi
