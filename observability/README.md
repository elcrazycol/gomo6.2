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
| `overview` | 10 | **RED**: stat cards with sparklines/thresholds (RPS, 5xx %, p99, WebSocket), traffic stacked by class (2xx/4xx/5xx/429), error share, p50/p90/p99, p95 now vs `offset 1w`, top-routes table, vmui deep links |
| `product` | 7 | registrations/messages totals, online now, active today, events per minute, WebSocket fan-out, content creation per hour |
| `resources` | 8 | **USE**: CPU/RAM/disk/swap utilization (traffic-light cards), saturation (load, DB pool), per-container memory, OOM kills + network drops |
| `data` | 10 | Postgres (connections vs max, cache hit %, tx rate, deadlocks, size, block timings) and Redis (hit ratio, memory, clients, keys, ops/s, evictions) |
| `host` | 114 | upstream Node Exporter dashboard (CPU / memory / disk / network / filesystem) |

Panels carry **deep links into vmui** (click a spike → the exact MetricsQL is
pre-filled), and every dashboard links to the others plus vmalert/Alertmanager.

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

**Info alerts are dashboard-only.** `severity="info"` is routed to a `null`
receiver: the rule still evaluates and is visible in the vmalert/Alertmanager
UI, but it never reaches Telegram. The only info rule is `RedisCacheHitLow`, and
its firing is expected: this Redis is multi-purpose (rate limits, auth cache,
blacklists, presence, data cache), and Redis `keyspace_hits/misses` count only
read lookups (writes like `SET`/`INCR` are excluded), so the global ratio sits
structurally low — it is not a cache-health signal.

## Per-container memory without cAdvisor

`observability/container-metrics.sh` writes `container_memory_usage_bytes` /
`container_cpu_usage_percent` once a minute into
`/var/lib/gomo6-node-exporter/containers.prom`, which node-exporter picks up via
`--collector.textfile.directory`. Install it on the VPS with cron:

```cron
* * * * * /root/gomo6.2/observability/container-metrics.sh >/dev/null 2>&1
```

cAdvisor was rejected deliberately: it costs 100–200 MB of RAM and this VPS has
961 MB total with swap already in use. The script gives the same answer to
"which container is eating memory" at ~0 MB.

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
