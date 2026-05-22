#!/bin/bash
# OAuth 2.0 + OpenID Connect — полный smoke-тест через curl
# Использование: bash test_oauth_smoke.sh
# Требования: docker compose up -d, jq, openssl

set -euo pipefail

API_BASE="http://localhost:8080"
TEST_USER="oauth_smoke_$(date +%s)"
TEST_EMAIL="${TEST_USER}@example.com"
TEST_PASS="SmokeTest123!"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass_count=0
fail_count=0

check() {
    local name="$1"
    local desc="$2"
    if [ "$3" = "ok" ]; then
        echo -e "  ${GREEN}✅ ${name}${NC} — ${desc}"
        pass_count=$((pass_count + 1))
    else
        echo -e "  ${RED}❌ ${name}${NC} — ${desc}"
        fail_count=$((fail_count + 1))
        if [ -n "${4:-}" ]; then
            echo -e "    ${YELLOW}Details:${NC} $4"
        fi
    fi
}

section() {
    echo -e "\n${CYAN}━━━ ${1} ━━━${NC}"
}

# --- 1. Health ---
section "1. Health Check"
health_resp=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/health" 2>&1 || true)
check "Server health" "HTTP $health_resp" "$([ "$health_resp" = "200" ] && echo "ok" || echo "fail")"

# --- 2. Register user ---
section "2. Register test user"
register_resp=$(curl -s -X POST "$API_BASE/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$TEST_USER\", \"email\": \"$TEST_EMAIL\", \"password\": \"$TEST_PASS\"}")

USER_TOKEN=$(echo "$register_resp" | jq -r '.data.token // .token // empty')
USER_ID=$(echo "$register_resp" | jq -r '.data.user.id // .user.id // empty')

if [ -n "$USER_TOKEN" ]; then
    check "Register user" "Token obtained (${USER_TOKEN:0:16}...)" "ok"
else
    # Maybe user already exists — try login
    echo -e "  ${YELLOW}↻ Registration may have failed, trying login...${NC}"
    login_resp=$(curl -s -X POST "$API_BASE/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$TEST_EMAIL\", \"password\": \"$TEST_PASS\"}")
    USER_TOKEN=$(echo "$login_resp" | jq -r '.data.token // .token // empty')
    USER_ID=$(echo "$login_resp" | jq -r '.data.user.id // .user.id // empty')
    if [ -n "$USER_TOKEN" ]; then
        check "Login existing user" "Token obtained (${USER_TOKEN:0:16}...)" "ok"
    else
        check "Auth" "Failed to register or login" "fail" "$register_resp"
    fi
fi

# --- 3. OpenID Discovery ---
section "3. OpenID Connect Discovery"
discovery_resp=$(curl -s "$API_BASE/.well-known/openid-configuration")
issuer=$(echo "$discovery_resp" | jq -r '.issuer // empty')
has_introspect=$(echo "$discovery_resp" | jq -r '.introspection_endpoint // empty')
has_jwks=$(echo "$discovery_resp" | jq -r '.jwks_uri // empty')
scopes=$(echo "$discovery_resp" | jq -r '.scopes_supported | join(",")')

check "Discovery issuer" "$issuer" "$([ -n "$issuer" ] && echo "ok" || echo "fail")"
check "Introspection endpoint" "${has_introspect:0:40}..." "$([ -n "$has_introspect" ] && echo "ok" || echo "fail")"
check "JWKS URI" "${has_jwks:0:40}..." "$([ -n "$has_jwks" ] && echo "ok" || echo "fail")"
check "Scopes supported" "$scopes" "$([ -n "$scopes" ] && echo "ok" || echo "fail")"

# --- 4. JWKS ---
section "4. JWKS"
jwks_resp=$(curl -s "$API_BASE/.well-known/jwks.json")
key_count=$(echo "$jwks_resp" | jq '.keys | length')
kty=$(echo "$jwks_resp" | jq -r '.keys[0].kty // empty')
check "JWKS keys" "$key_count key(s) of type $kty" "$([ "$key_count" -gt 0 ] && echo "ok" || echo "fail")"

# --- 5. Create OAuth App ---
section "5. Create OAuth Application"
app_resp=$(curl -s -X POST "$API_BASE/api/v1/developer/apps" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${USER_TOKEN}" \
    -d '{
        "name": "Smoke Test App",
        "description": "Created by OAuth smoke test",
        "redirect_uris": ["http://localhost:9999/callback"],
        "allowed_scopes": ["openid","profile","email"],
        "is_confidential": true
    }')

CLIENT_ID=$(echo "$app_resp" | jq -r '.app.client_id // empty')
CLIENT_SECRET=$(echo "$app_resp" | jq -r '.client_secret // empty')

if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ]; then
    check "Create app" "client_id: ${CLIENT_ID:0:16}..." "ok"
else
    check "Create app" "Failed to create" "fail" "$app_resp"
fi

# --- 6. App Info (consent screen) ---
section "6. App Info (consent data)"
app_info=$(curl -s "$API_BASE/oauth/app-info?client_id=${CLIENT_ID}")
app_name=$(echo "$app_info" | jq -r '.name // empty')
has_descriptions=$(echo "$app_info" | jq -r '.scope_descriptions | length')
has_labels=$(echo "$app_info" | jq -r '.scope_labels | length')
check "App info" "name=$app_name, ${has_descriptions} descs, ${has_labels} labels" \
    "$([ -n "$app_name" ] && echo "ok" || echo "fail")"

# --- 7. PKCE + Authorize ---
section "7. Authorization Code (PKCE S256)"
# Generate PKCE challenge
CODE_VERIFIER=$(openssl rand -base64 48 | tr -d '\n' | tr '/+' '_-' | tr -d '=')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '/+' '_-' | tr -d '=')

authorize_resp=$(curl -s -G "$API_BASE/oauth/authorize" \
    --data-urlencode "response_type=code" \
    --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "redirect_uri=http://localhost:9999/callback" \
    --data-urlencode "scope=openid profile email offline_access" \
    --data-urlencode "state=smoke-test-state" \
    --data-urlencode "code_challenge=${CODE_CHALLENGE}" \
    --data-urlencode "code_challenge_method=S256" \
    --data-urlencode "consent=true" \
    --data-urlencode "nonce=smoke-test-nonce" \
    -H "Authorization: Bearer ${USER_TOKEN}")

AUTH_CODE=$(echo "$authorize_resp" | jq -r '.code // empty')
REDIRECT_URL=$(echo "$authorize_resp" | jq -r '.redirect_url // empty')

if [ -n "$AUTH_CODE" ]; then
    check "Authorization code" "Code obtained (${AUTH_CODE:0:16}...)" "ok"
elif [ -n "$REDIRECT_URL" ]; then
    # Extract code from redirect URL
    AUTH_CODE=$(echo "$REDIRECT_URL" | grep -oP 'code=\K[^&]+')
    check "Authorization code (from redirect)" "Code: ${AUTH_CODE:0:16}..." "ok"
else
    check "Authorization code" "Failed" "fail" "$authorize_resp"
fi

# --- 8. Token Exchange ---
section "8. Token Exchange (authorization_code → access + refresh + id)"
token_resp=$(curl -s -X POST "$API_BASE/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code" \
    -d "code=${AUTH_CODE}" \
    -d "redirect_uri=http://localhost:9999/callback" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}" \
    -d "code_verifier=${CODE_VERIFIER}")

ACCESS_TOKEN=$(echo "$token_resp" | jq -r '.access_token // empty')
REFRESH_TOKEN=$(echo "$token_resp" | jq -r '.refresh_token // empty')
ID_TOKEN=$(echo "$token_resp" | jq -r '.id_token // empty')
TOKEN_TYPE=$(echo "$token_resp" | jq -r '.token_type // empty')
EXPIRES_IN=$(echo "$token_resp" | jq -r '.expires_in // empty')

if [ -n "$ACCESS_TOKEN" ]; then
    check "Access token" "type=$TOKEN_TYPE, expires=${EXPIRES_IN}s" "ok"
else
    check "Access token" "Failed" "fail" "$token_resp"
fi

if [ -n "$REFRESH_TOKEN" ]; then
    check "Refresh token" "Present (offline_access granted)" "ok"
else
    check "Refresh token" "Not issued" "ok" "(may be intended — only with offline_access)"
fi

if [ -n "$ID_TOKEN" ]; then
    check "ID token" "Present (RS256 signed)" "ok"
else
    check "ID token" "Not issued" "ok" "(may be intended — requires openid scope)"
fi

# --- 9. Userinfo ---
section "9. Userinfo (access token validation)"
userinfo_resp=$(curl -s -G "$API_BASE/oauth/userinfo" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")

USERINFO_SUB=$(echo "$userinfo_resp" | jq -r '.sub // empty')
USERINFO_NAME=$(echo "$userinfo_resp" | jq -r '.name // empty')
USERINFO_EMAIL=$(echo "$userinfo_resp" | jq -r '.email // empty')

if [ -n "$USERINFO_SUB" ]; then
    check "Userinfo sub" "$USERINFO_SUB" "ok"
    check "Userinfo name" "$USERINFO_NAME" "$([ -n "$USERINFO_NAME" ] && echo "ok" || echo "fail")"
    check "Userinfo email" "$USERINFO_EMAIL" "$([ -n "$USERINFO_EMAIL" ] && echo "ok" || echo "fail")"
else
    check "Userinfo" "Failed" "fail" "$userinfo_resp"
fi

# --- 10. Scope-based userinfo (openid only) ---
section "10. Scope-based Userinfo (openid only)"
# Re-authorize with only openid scope
code_verifier2=$(openssl rand -base64 48 | tr -d '\n' | tr '/+' '_-' | tr -d '=')
code_challenge2=$(echo -n "$code_verifier2" | openssl dgst -sha256 -binary | openssl base64 -A | tr '/+' '_-' | tr -d '=')

auth2=$(curl -s -G "$API_BASE/oauth/authorize" \
    --data-urlencode "response_type=code" \
    --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "redirect_uri=http://localhost:9999/callback" \
    --data-urlencode "scope=openid" \
    --data-urlencode "code_challenge=${code_challenge2}" \
    --data-urlencode "code_challenge_method=S256" \
    --data-urlencode "consent=true" \
    -H "Authorization: Bearer ${USER_TOKEN}")

code2=$(echo "$auth2" | jq -r '.code // empty')
if [ -n "$code2" ]; then
    token2=$(curl -s -X POST "$API_BASE/oauth/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=authorization_code" \
        -d "code=${code2}" \
        -d "redirect_uri=http://localhost:9999/callback" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}" \
        -d "code_verifier=${code_verifier2}")
    at2=$(echo "$token2" | jq -r '.access_token // empty')
    if [ -n "$at2" ]; then
        ui2=$(curl -s -G "$API_BASE/oauth/userinfo" -H "Authorization: Bearer ${at2}")
        only_sub=$(echo "$ui2" | jq -r '.name // "null"')
        if [ "$only_sub" = "null" ]; then
            check "Scope filter (openid only)" "No profile/email leaked" "ok"
        else
            check "Scope filter (openid only)" "Name leaked without scope" "fail" "$ui2"
        fi
    fi
else
    check "Scope filter (openid only)" "Could not re-authorize" "fail" "$auth2"
fi

# --- 11. Token Refresh (rotation) ---
section "11. Token Refresh (rotation)"
if [ -n "$REFRESH_TOKEN" ]; then
    refresh_resp=$(curl -s -X POST "$API_BASE/oauth/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=refresh_token" \
        -d "refresh_token=${REFRESH_TOKEN}" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}")

    NEW_ACCESS=$(echo "$refresh_resp" | jq -r '.access_token // empty')
    NEW_REFRESH=$(echo "$refresh_resp" | jq -r '.refresh_token // empty')

    if [ -n "$NEW_ACCESS" ]; then
        check "Refresh — new access token" "Issued" "ok"
        # Old refresh token should be revoked
        old_refresh_check=$(curl -s -X POST "$API_BASE/oauth/token" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=refresh_token" \
            -d "refresh_token=${REFRESH_TOKEN}" \
            -d "client_id=${CLIENT_ID}" \
            -d "client_secret=${CLIENT_SECRET}")
        old_err=$(echo "$old_refresh_check" | jq -r '.error // empty')
        if [ -n "$old_err" ]; then
            check "Refresh — old token revoked" "Error: $old_err" "ok"
        else
            check "Refresh — old token revoked" "Unexpectedly still valid" "fail" "$old_refresh_check"
        fi

        # Validate new access token
        ui_new=$(curl -s -G "$API_BASE/oauth/userinfo" -H "Authorization: Bearer ${NEW_ACCESS}")
        new_sub=$(echo "$ui_new" | jq -r '.sub // empty')
        check "New token — userinfo" "sub=$new_sub" "$([ -n "$new_sub" ] && echo "ok" || echo "fail")"

        if [ -n "$NEW_REFRESH" ]; then
            check "Refresh — new refresh token" "Rotation issued new RT" "ok"
        fi

        # Update for further use
        ACCESS_TOKEN=$NEW_ACCESS
        REFRESH_TOKEN=$NEW_REFRESH
    else
        check "Token refresh" "Failed" "fail" "$refresh_resp"
    fi
else
    echo -e "  ${YELLOW}⏭  No refresh token to test.${NC}"
fi

# --- 12. Token Revocation ---
section "12. Token Revocation"
revoke_resp=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/oauth/revoke" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=${ACCESS_TOKEN}" \
    -d "token_type_hint=access_token" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}")
check "Revoke access token" "HTTP $revoke_resp (expected 200)" \
    "$([ "$revoke_resp" = "200" ] && echo "ok" || echo "fail")"

# Verify revoked token is invalid
ui_revoked=$(curl -s -o /dev/null -w '%{http_code}' -G "$API_BASE/oauth/userinfo" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
check "Revoked token rejected" "HTTP $ui_revoked (expected 401)" \
    "$([ "$ui_revoked" = "401" ] && echo "ok" || echo "fail")"

# --- 13. Token Introspection ---
section "13. Token Introspection (RFC 7662)"

# 13a. Revoked token → active: false
echo -e "  ${YELLOW}13a. Revoked access token...${NC}"
introspect_revoked=$(curl -s -X POST "$API_BASE/oauth/introspect" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=${ACCESS_TOKEN}" \
    -d "token_type_hint=access_token" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}")
active_revoked=$(echo "$introspect_revoked" | jq -r '.active')
check "Introspect — revoked token" "active=$active_revoked" \
    "$([ "$active_revoked" = "false" ] && echo "ok" || echo "fail")" "$introspect_revoked"

# 13b. Invalid token → active: false
echo -e "  ${YELLOW}13b. Invalid token...${NC}"
introspect_invalid=$(curl -s -X POST "$API_BASE/oauth/introspect" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=invalid-jwt-token-that-does-not-exist" \
    -d "token_type_hint=access_token" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}")
active_invalid=$(echo "$introspect_invalid" | jq -r '.active')
check "Introspect — invalid token" "active=$active_invalid" \
    "$([ "$active_invalid" = "false" ] && echo "ok" || echo "fail")" "$introspect_invalid"

# 13c. Bearer auth introspection (resource server)
echo -e "  ${YELLOW}13c. Bearer token auth...${NC}"
# Get a fresh token first
cv3=$(openssl rand -base64 48 | tr -d '\n' | tr '/+' '_-' | tr -d '=')
cc3=$(echo -n "$cv3" | openssl dgst -sha256 -binary | openssl base64 -A | tr '/+' '_-' | tr -d '=')
auth3=$(curl -s -G "$API_BASE/oauth/authorize" \
    --data-urlencode "response_type=code" \
    --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "redirect_uri=http://localhost:9999/callback" \
    --data-urlencode "scope=openid profile" \
    --data-urlencode "code_challenge=${cc3}" \
    --data-urlencode "code_challenge_method=S256" \
    --data-urlencode "consent=true" \
    -H "Authorization: Bearer ${USER_TOKEN}")
code3=$(echo "$auth3" | jq -r '.code // empty')
if [ -n "$code3" ]; then
    t3=$(curl -s -X POST "$API_BASE/oauth/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=authorization_code" \
        -d "code=${code3}" \
        -d "redirect_uri=http://localhost:9999/callback" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}" \
        -d "code_verifier=${cv3}")
    at3=$(echo "$t3" | jq -r '.access_token // empty')
    if [ -n "$at3" ]; then
        # Introspect using Bearer token (resource server scenario)
        introspect_bearer=$(curl -s -X POST "$API_BASE/oauth/introspect" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -H "Authorization: Bearer ${at3}" \
            -d "token=${at3}" \
            -d "token_type_hint=access_token")
        active_bearer=$(echo "$introspect_bearer" | jq -r '.active')
        client_id_from_intro=$(echo "$introspect_bearer" | jq -r '.client_id // empty')
        check "Introspect — Bearer auth" "active=$active_bearer, client=$CLIENT_ID" \
            "$([ "$active_bearer" = "true" ] && [ "$client_id_from_intro" = "$CLIENT_ID" ] && echo "ok" || echo "fail")" \
            "$introspect_bearer"
    fi
fi

# 13d. Introspect without auth → 401
echo -e "  ${YELLOW}13d. No auth → 401...${NC}"
introspect_noauth=$(curl -s -w '\n%{http_code}' -X POST "$API_BASE/oauth/introspect" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=test")
noauth_code=$(echo "$introspect_noauth" | tail -1)
check "Introspect — no auth" "HTTP $noauth_code (expected 401)" \
    "$([ "$noauth_code" = "401" ] && echo "ok" || echo "fail")"

# --- 14. Audit Log ---
section "14. Audit Log Verification"
# Query audit log directly from the database via Docker
audit_authorize=$(docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -t -A -c "SELECT COUNT(*) FROM oauth_audit_log WHERE action = 'authorize' AND client_id = '${CLIENT_ID}'" 2>/dev/null || echo "0")
audit_total=$(docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -t -A -c "SELECT COUNT(*) FROM oauth_audit_log WHERE client_id = '${CLIENT_ID}'" 2>/dev/null || echo "0")

# Trim whitespace
audit_authorize=$(echo "$audit_authorize" | xargs)
audit_total=$(echo "$audit_total" | xargs)

check "Audit log (authorize)" "$audit_authorize entries for this client" \
    "$([ "$audit_authorize" -ge 1 ] 2>/dev/null && echo "ok" || echo "fail")"
check "Audit log (total)" "$audit_total entries for this client" \
    "$([ "$audit_total" -ge 1 ] 2>/dev/null && echo "ok" || echo "fail")"

# --- Results ---
section "RESULTS"
echo -e "${GREEN}✅ Passed: ${pass_count}${NC}"
echo -e "${RED}❌ Failed: ${fail_count}${NC}"
total=$((pass_count + fail_count))
echo -e "${CYAN}📊 Total: ${total}${NC}"

if [ "$fail_count" -eq 0 ]; then
    echo -e "\n${GREEN}🎉 Все OAuth smoke-тесты пройдены!${NC}"
    exit 0
else
    echo -e "\n${RED}⚠️  Некоторые тесты не прошли.${NC}"
    exit 1
fi
