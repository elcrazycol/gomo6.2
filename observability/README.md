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
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.20.1` | connections, cache hit ratio, deadlocks, tx rate, DB size |
| `redis-exporter` | `oliver006/redis_exporter:v1.92.1` | hit ratio, memory, clients, keys, ops/s, evictions |
| `perses` | `persesdev/perses:v0.54.0` | dashboards-as-code UI (JSON in git) |

Total image size is below the single Alloy container it replaces.

## Access (no public domain needed)

Every UI is bound to `127.0.0.1` on the VPS, so nothing is exposed to the
internet. Tunnel in:

```bash
ssh -L 8428:127.0.0.1:8428 -L 8429:127.0.0.1:8429 -L 8880:127.0.0.1:8880 -L 9093:127.0.0.1:9093 -L 8080:127.0.0.1:8080 root@gomo6.wtf
```

* Perses (dashboards): <http://localhost:8080>
* vmui (queries, metrics/cardinality explorer): <http://localhost:8428/vmui>
* vmagent targets ("is scraping working"): <http://localhost:8429/targets>
* vmalert (rules, alert state): <http://localhost:8880>
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

## Dashboards (Perses, project `gomo6`)

| Dashboard | Panels | Content |
|---|---|---|
| `overview` | 18 | backend availability, 5xx share, per-route request/error/429 rate, **p95 latency**, WebSocket, DB pool, background pools, process, blackbox probes, product counters (events/min, online, active today) |
| `host` | 114 | upstream Node Exporter dashboard (CPU / memory / disk / network / filesystem) |
| `data` | 10 | Postgres (connections vs max, cache hit %, tx rate, deadlocks, size, block timings) and Redis (hit ratio, memory, clients, keys, ops/s, evictions) |

## Alerts (vmalert → Alertmanager → Telegram)

18 rules: availability (`SiteDown`, `BackendDown`, `TLSCertExpiringSoon`),
HTTP (`HighServerErrorRate`, `HighLatencyP95`, `RateLimitSurge`), database/cache
(`PostgresConnectionsHigh`, `PostgresCacheHitLow`, `PostgresDeadlocks`,
`RedisEvictions`, `RedisCacheHitLow`), resources (`DBPoolSaturated`,
`BackgroundTasksDropped`, `DBTxErrors`, `DiskSpaceLow`, `HostMemoryHigh`,
`HostLoadHigh`) and `Watchdog`.

**Watchdog** always fires and is delivered once a day (route `severity="none"`,
24h repeat): if the heartbeat stops arriving, the alerting pipeline itself is
broken — otherwise a silent failure.

## Manual analysis (not exported as series)

`pg_stat_statements` is enabled (migration 122, preloaded) so top queries can be
inspected on demand:

```bash
docker compose exec postgres psql -U gomo6 -d gomo6 -c \
  "SELECT calls, round(total_exec_time::numeric,1) AS ms, left(query,80)
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"
```

It is deliberately **not** scraped: postgres_exporter would emit one series per
distinct query, which is a cardinality bomb on a small VPS.
