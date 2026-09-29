# Observability (VictoriaMetrics stack)

Self-hosted replacement for **Grafana Cloud + Grafana Alloy**: one place for
metric storage, alert rules and the UI, with no third party seeing your data.

## Why not Grafana

The previous setup shipped every series to Grafana Cloud through a 599 MB Alloy
container. This stack stores the same series locally with components that are
individually smaller than Alloy alone, and keeps the dashboards and rules in
git.

## Components

| Service | Image | Role |
|---|---|---|
| `victoriametrics` | `victoriametrics/victoria-metrics:v1.153.0` | TSDB + `vmui` (ad-hoc queries, cardinality explorer) |
| `vmagent` | `victoriametrics/vmagent:v1.153.0` | scrapes `/metrics` and remote-writes to VM |
| `vmalert` | `victoriametrics/vmalert:v1.153.0` | evaluates the rules in `vmalert-rules.yml` |
| `alertmanager` | `prom/alertmanager:v0.34.1` | routing + de-duplication + Telegram delivery |
| `blackbox-exporter` | `prom/blackbox-exporter:v0.28.0` | availability and TLS-expiry probes |
| `node-exporter` | `prom/node-exporter:v1.12.1` | host CPU / RAM / disk / network |

Total image size is below the single Alloy container it replaces.

## Access (no public domain needed)

Every UI is bound to `127.0.0.1` on the VPS, so nothing is exposed to the
internet. Tunnel in:

```bash
ssh -L 8428:127.0.0.1:8428 -L 9093:127.0.0.1:9093 root@gomo6.wtf
```

* vmui (queries, metrics/cardinality explorer): <http://localhost:8428/vmui>
* Alertmanager (silences, current alerts): <http://localhost:9093>

Perses (dashboards-as-code) will be added on the same `127.0.0.1`-only basis.

## Enabling Telegram alerts

Alertmanager does **not** expand environment variables, so the token is kept out
of git:

```bash
cd /root/gomo6.2
cp observability/alertmanager.yml.example observability/alertmanager.yml
# fill in <TELEGRAM_BOT_TOKEN> and <TELEGRAM_CHAT_ID>
docker compose up -d --no-build alertmanager
docker compose exec alertmanager amtool --alertmanager.url=http://localhost:9093 alert add \
  alertname=TestInstanceDown severity=critical
```

If alerts never arrive, check `docker compose logs alertmanager`.

## Operations

```bash
# Apply config changes (these services are NOT in the CI deploy matrix):
docker compose up -d --no-build victoriametrics vmagent vmalert alertmanager blackbox-exporter node-exporter

# Check the agent sees its targets:
#   http://localhost:8429/targets   (through the tunnel; add -L 8429:127.0.0.1:8429)

# Retention is 1y (-retentionPeriod); data lives in the vm_data volume.
# Backups: docker run --rm -v gomo62_vm_data:/data -v /root/backups:/backup \
#   alpine tar czf /backup/vm_data_$(date +%F).tgz -C /data .
```

## Files

| File | Purpose |
|---|---|
| `vmagent.yml` | scrape targets (backend, stack self-metrics, node, blackbox) |
| `vmalert-rules.yml` | alert rules (availability, HTTP, DB/background, host) |
| `blackbox.yml` | probe modules |
| `alertmanager.yml.example` | routing + Telegram template (real file is gitignored) |

## Not done yet

* **Latency (p95) alerts** need a histogram. The backend exposes
  `http_request_duration_ms_sum` / `http_requests_total` but no buckets, so a
  percentile cannot be computed yet. Adding fixed-bucket histograms to
  `internal/metrics` is the next instrumentation task; the alert goes into
  `vmalert-rules.yml` afterwards.
* **Perses** dashboards (charts per service, product metrics).
* **postgres/redis exporters** — DB-level insight (connections, cache hit ratio,
  slow queries via `pg_stat_statements`).
