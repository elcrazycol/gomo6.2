#!/bin/sh
# Per-container memory and CPU as Prometheus text for node-exporter's textfile
# collector.
#
# Why not cAdvisor: it costs 100-200 MB of RAM, and this VPS has 961 MB in total
# with swap already in use. This script runs once a minute from cron, costs
# almost nothing, and gives the same answer to "which container is eating
# memory?" (without CPU throttling, which is irrelevant on a single idle core).
#
# Install (on the VPS):
#   * * * * * /root/gomo6.2/observability/container-metrics.sh >/dev/null 2>&1
set -eu

OUT="${1:-/var/lib/gomo6-node-exporter/containers.prom}"
TMP="${OUT}.tmp"
mkdir -p "$(dirname "$OUT")"

{
  echo "# HELP container_memory_usage_bytes Resident memory per container."
  echo "# TYPE container_memory_usage_bytes gauge"
  echo "# HELP container_cpu_usage_percent CPU usage per container (docker stats)."
  echo "# TYPE container_cpu_usage_percent gauge"

  docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}' 2>/dev/null |
    while IFS='|' read -r name mem cpu; do
      # mem looks like "81.02MiB / 961.5MiB" — take the first part, convert to bytes.
      used=$(printf '%s' "$mem" | awk '{print $1}')
      bytes=$(printf '%s' "$used" | awk '
        /KiB$/{sub("KiB",""); printf "%.0f", $1*1024; next}
        /MiB$/{sub("MiB",""); printf "%.0f", $1*1024*1024; next}
        /GiB$/{sub("GiB",""); printf "%.0f", $1*1024*1024*1024; next}
        /B$/{sub("B",""); printf "%.0f", $1; next}
        {printf "0"}')
      pct=$(printf '%s' "$cpu" | tr -d '%')
      echo "container_memory_usage_bytes{name=\"$name\"} $bytes"
      echo "container_cpu_usage_percent{name=\"$name\"} $pct"
    done
} >"$TMP"

mv "$TMP" "$OUT"
