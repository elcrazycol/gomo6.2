# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-24

### Added
- Auto-deploy to VPS via GitHub Actions on green CI (`deploy.yml` + `deploy-vps.sh`)
- Commit hash displayed in site footer (hover for full SHA)
- `.env` preservation during deploy (backup/restore + trap on failure)
- Self-locating repo path in deploy scripts (no hardcoded directories)
- Pre-commit CI script: `./scripts/ci-local.sh [quick|full]`
- CI and Deploy status badges in README
- `corsOrigins()` function for S3 CORS configuration

### Changed
- All OAuth redirect URLs now use `https://` (ISSUER_URL, FRONTEND_URL, DEV_DASHBOARD_URL)
- Stats page migrated to Go backend with `user_id` filter
- Refactored `client_simple.ts` → `auth.ts` + `dataApi.ts` + `supabaseCompat.ts`
- Refactored `dataApi.ts` → `query-builder.ts` + `rpc.ts` + `storage.ts`

### Fixed
- RPC network errors no longer cause unhandled promise rejections (unified try/catch)
- PUT/DELETE `/table/:id` correctly uses path ID as WHERE filter
- `BoardRouter.tsx`: `profilesResponse` → `profileResponse` (TS2552)
- `Board.tsx`: empty `catch {}` blocks now properly commented (ESLint `no-empty`)
- `upload.go`: all error strings lowercase (Go convention ST1005)
- `rpc.go`: `optionEntry` struct literal → type conversion (S1016)
- `corsOrigins` undefined (missing function referenced in tests)

### Security
- `.env` removed from git tracking (was committed with Supabase keys)
- OAuth mixed content blocked by browser — all redirects now HTTPS
- Caddy auto-provisions Let's Encrypt TLS certificates in production

### Removed
- Supabase integration (replaced by direct Postgres + Garage S3)

---

[1.0.0]: https://github.com/scramble22/gomo6.2/releases/tag/v1.0.0
