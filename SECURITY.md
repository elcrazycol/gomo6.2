# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately by opening an issue with the `security` label or contacting the maintainers directly. **Do not disclose vulnerabilities publicly** until they have been addressed.

## Security Measures

### Environment Variables

- **NEVER commit `.env` files** to version control
- Use `.env.example` as a template with placeholder values
- Generate secure random secrets for production

#### Required Secrets Generation

**1. JWT_SECRET** (Signs authentication tokens, min 32 chars):
```bash
openssl rand -base64 32
```

**2. FEDERATION_KEY** (Inter-server authentication, min 32 chars):
```bash
openssl rand -base64 32
```

**3. GARAGE_S3_SECRET_KEY** (S3 storage authentication, 64 chars):
```bash
openssl rand -hex 32
```

**4. MESSENGER_SHARED_SESSION_SECRET** (Session cookie signing, min 32 chars):
```bash
openssl rand -base64 32
```

**5. POSTGRES_PASSWORD** (Database password, min 16 chars):
```bash
openssl rand -base64 24
```

#### Quick Setup Script

```bash
#!/bin/bash
echo "=== Gomo6 Secrets Generator ==="
echo ""
echo "Copy these to your .env file:"
echo ""
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "FEDERATION_KEY=$(openssl rand -base64 32)"
echo "GARAGE_S3_SECRET_KEY=$(openssl rand -hex 32)"
echo "MESSENGER_SHARED_SESSION_SECRET=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

Save as `generate-secrets.sh`, run `chmod +x generate-secrets.sh && ./generate-secrets.sh`

### Rate Limiting

The application implements Redis-based rate limiting for all API endpoints:

| Endpoint Category | Requests/Second | Burst Size |
|------------------|-----------------|------------|
| API              | 10              | 20         |
| Auth             | 5               | 10         |
| Messenger        | 30              | 50         |
| Upload           | 2               | 5          |
| RPC              | 20              | 40         |

### Security Headers

The following security headers are applied to all responses:

- `Content-Security-Policy` - Prevents XSS and injection attacks
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS filter
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `Referrer-Policy` - Controls referrer information
- `Permissions-Policy` - Disables unnecessary browser features
- `Strict-Transport-Security` - Enforces HTTPS (production only)

### Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Full health check with DB/Redis status |
| `/health/live` | Liveness probe (no dependencies) |
| `/health/ready` | Readiness probe (checks all dependencies) |

### Database Security

- PostgreSQL connection uses parameterized queries to prevent SQL injection
- JSONB fields should be validated before storage
- User input is sanitized before database operations

### WebSocket Security

- JWT authentication required for WebSocket connections
- Rate limiting applied to WebSocket messages
- Allowed origins configured via `ALLOWED_ORIGINS` environment variable

### Production Checklist

Before deploying to production:

- [ ] Replace all placeholder secrets with secure random values
- [ ] Enable HTTPS/TLS termination
- [ ] Configure `ALLOWED_ORIGINS` for your production domain
- [ ] Set `ENVIRONMENT=production`
- [ ] Enable HSTS with appropriate max-age
- [ ] Review and tighten CSP directives
- [ ] Configure proper database backups
- [ ] Set up monitoring and alerting
- [ ] Review firewall rules and port exposure

### Known Limitations

- Federation is not yet implemented (endpoints return 501)
- Some RPC endpoints lack comprehensive input validation
- Bot timeout is set to 5 seconds (may need adjustment)
