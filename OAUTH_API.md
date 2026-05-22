# OAuth 2.0 + OpenID Connect API — gomo6

## Overview

gomo6 предоставляет полноценный OAuth 2.0 сервер с поддержкой OpenID Connect.
Сторонние сайты могут использовать gomo6 для авторизации пользователей.

**Base URL:** `http://localhost:8080`
**OpenID Discovery:** `/.well-known/openid-configuration`

---

## 1. Регистрация приложения

Зайдите в **Dev-панель** → **Создать приложение** и заполните:

| Поле | Описание |
|------|----------|
| Name | Название приложения (показывается пользователю) |
| Description | Описание приложения |
| Homepage URL | Ссылка на сайт приложения |
| Redirect URIs | Список разрешённых URI для редиректа (через запятую) |
| Confidential client | Если да — требуется client_secret. Если нет — public client (например SPA) |

После создания вы получите:
- **client_id** — публичный идентификатор
- **client_secret** — секретный ключ (показывается один раз)

---

## 2. Authorization Code Flow

### Шаг 1: Редирект пользователя на авторизацию

```
GET /oauth/authorize?response_type=code
                   &client_id=YOUR_CLIENT_ID
                   &redirect_uri=YOUR_REDIRECT_URI
                   &scope=openid+profile+email
                   &state=random_state_string
                   &code_challenge=CHALLENGE_HASH
                   &code_challenge_method=S256
```

**Параметры:**

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `response_type` | Да | Всегда `code` |
| `client_id` | Да | ID вашего приложения |
| `redirect_uri` | Да | URI для редиректа (должен быть в списке разрешённых) |
| `scope` | Опционально | `scope` | Опционально | `openid`, `profile`, `email`, `offline_access` (через пробел) |
| `state` | Рекомендуется | Строка для CSRF-защиты |
| `code_challenge` | Рекомендуется | PKCE challenge (SHA-256 хеш code_verifier) |
| `code_challenge_method` | Для PKCE | `S256` или `plain` |

**Пример ссылки:**

```html
<a href="http://localhost:8080/oauth/authorize?response_type=code&client_id=app_abc123&redirect_uri=https://myapp.com/callback&scope=openid+profile+email&state=xyz789">
  Войти через gomo6
</a>
```

После подтверждения пользователем, браузер будет перенаправлен на:

```
https://myapp.com/callback?code=AUTHORIZATION_CODE&state=xyz789
```

### Шаг 2: Обмен кода на токены

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTHORIZATION_CODE
&redirect_uri=https://myapp.com/callback
&client_id=app_abc123
&client_secret=YOUR_CLIENT_SECRET
&code_verifier=VERIFIER_STRING
```

**Параметры:**

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `grant_type` | Да | `authorization_code` |
| `code` | Да | Код из предыдущего шага |
| `redirect_uri` | Да | Тот же URI, что использовался |
| `client_id` | Да | ID приложения |
| `client_secret` | Для confidential | Секретный ключ приложения |
| `code_verifier` | Для PKCE | Исходная строка для проверки |

**Пример cURL:**

```bash
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=def456" \
  -d "redirect_uri=https://myapp.com/callback" \
  -d "client_id=app_abc123" \
  -d "client_secret=secret_xyz" \
  -d "code_verifier=my_verifier_string"
```

**Ответ:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_abc123...",
  "id_token": "eyJhbGciOiJIUzI1NiIs...",
  "scope": "openid profile email"
}

**cURL с PKCE:**

```bash
# Сгенерируйте code_verifier + code_challenge (см. раздел PKCE)
CODE_VERIFIER="my_random_verifier_string_here"
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')

# Шаг 1: редирект пользователя
# http://localhost:8080/oauth/authorize?response_type=code&client_id=app_abc123&redirect_uri=...&scope=openid+profile+email&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256

# Шаг 2: обмен кода на токены
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=def456" \
  -d "redirect_uri=https://myapp.com/callback" \
  -d "client_id=app_abc123" \
  -d "code_verifier=$CODE_VERIFIER"
```
```

---

## 3. Использование токена

Полученный access_token передаётся в заголовке:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Получение информации о пользователе

```
GET /oauth/userinfo
Authorization: Bearer ACCESS_TOKEN
```

**Ответ:**

```json
{
  "sub": "user_uuid",
  "name": "Имя пользователя",
  "preferred_username": "username",
  "email": "user@example.com",
  "email_verified": true,
  "picture": "https://cdn.gomo6.net/avatars/..."
}
```

### cURL пример:

```bash
curl http://localhost:8080/oauth/userinfo \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## 4. Refresh Token

Когда access_token истекает, можно получить новый через refresh_token:

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=YOUR_REFRESH_TOKEN
&client_id=app_abc123
&client_secret=YOUR_CLIENT_SECRET
```

**cURL пример:**

```bash
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=rt_abc123..." \
  -d "client_id=app_abc123" \
  -d "client_secret=secret_xyz"
```

**Ответ** — новый набор токенов (с новым refresh_token):

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_new_refresh_token",
  "id_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

> ⚠️ **Token Rotation**: При каждом обновлении выдаётся новый refresh_token. Старый становится недействительным.

> ⚠️ Для получения refresh_token необходимо запросить scope `offline_access` при авторизации.

---

## 5. Token Introspection (RFC 7662)

Проверка валидности токена. Используется resource server'ами для проверки токенов без самостоятельного декодирования JWT.

```
POST /oauth/introspect
Content-Type: application/x-www-form-urlencoded

token=ACCESS_OR_REFRESH_TOKEN
&token_type_hint=access_token
&client_id=app_abc123
&client_secret=YOUR_CLIENT_SECRET
```

**Аутентификация:**
- Через Bearer токен (OAuth access token resource server'а)
- **Или** через client_id + client_secret (confidential clients)
- **Или** через client_id (public clients — только ID, без секрета)

**cURL пример (client credentials):**

```bash
curl -X POST http://localhost:8080/oauth/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=eyJhbGciOiJIUzI1NiIs..." \
  -d "token_type_hint=access_token" \
  -d "client_id=app_abc123" \
  -d "client_secret=secret_xyz"
```

**cURL пример (Bearer token):**

```bash
curl -X POST http://localhost:8080/oauth/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -d "token=eyJhbGciOiJIUzI1NiIs..."
```

**Ответ:**

```json
{
  "active": true,
  "scope": "openid profile email",
  "client_id": "app_abc123",
  "user_id": "user_uuid",
  "token_id": "tok_abc123",
  "token_type": "access_token",
  "sub": "user_uuid",
  "username": "username",
  "aud": ["app_abc123"],
  "iss": "http://localhost:8080",
  "exp": 1715000000,
  "iat": 1714996400
}
```

Для невалидного или отозванного токена:

```json
{"active": false}
```

---

## 6. Revoke токена
Content-Type: application/x-www-form-urlencoded

token=ACCESS_OR_REFRESH_TOKEN
&token_hint=access_token
&client_id=app_abc123
&client_secret=YOUR_CLIENT_SECRET
```

**cURL пример:**

```bash
curl -X POST http://localhost:8080/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=eyJhbGciOiJIUzI1NiIs..." \
  -d "token_hint=access_token" \
  -d "client_id=app_abc123" \
  -d "client_secret=secret_xyz"
```

**Ответ:** `200 OK` (всегда, даже если токен не существовал)

---

## 7. Информация о приложении (консент-скрин)

Получение информации о приложении для отображения на экране согласия:

```
GET /oauth/app-info?client_id=app_abc123
```

**cURL пример:**

```bash
curl "http://localhost:8080/oauth/app-info?client_id=app_abc123"
```

**Ответ:**

```json
{
  "client_id": "app_abc123",
  "name": "My App",
  "description": "Описание приложения",
  "logo_url": "",
  "homepage_url": "https://myapp.com",
  "allowed_scopes": ["openid", "profile", "email"],
  "scope_descriptions": {
    "openid": "Идентификация вашей учётной записи (OpenID Connect)",
    "profile": "Чтение вашего имени пользователя и аватара",
    "email": "Чтение вашего email адреса",
    "offline_access": "Обновление токенов в фоне (offline access)"
  },
  "scope_labels": {
    "openid": "OpenID Connect (аутентификация)",
    "profile": "Имя пользователя и аватар",
    "email": "Email адрес",
    "offline_access": "Offline доступ"
  }
}
```

Фронтенд консент-скрина доступен по адресу `/oauth/consent?client_id=...&scope=...`.

---

## 8. PKCE (для публичных клиентов)

Для SPA/мобильных приложений используйте PKCE:

1. **Сгенерируйте code_verifier** — рандомная строка (43-128 символов, [A-Za-z0-9-._~])
2. **Вычислите code_challenge** — SHA-256 хеш от code_verifier, закодированный в base64url
3. Передайте code_challenge в `/oauth/authorize`
4. Передайте code_verifier в `/oauth/token`

### JavaScript пример:

```javascript
// Генерация verifier и challenge
async function generatePKCE() {
  const verifier = generateRandomString(64);
  
  // SHA-256 хеш
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  
  // base64url encoded
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  return { verifier, challenge };
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

---

## 9. OpenID Connect

**Discovery URL:**

```
GET /.well-known/openid-configuration
```

**Ответ:**

```json
{
  "issuer": "http://localhost:8080",
  "authorization_endpoint": "http://localhost:8080/oauth/authorize",
  "token_endpoint": "http://localhost:8080/oauth/token",
  "userinfo_endpoint": "http://localhost:8080/oauth/userinfo",
  "revocation_endpoint": "http://localhost:8080/oauth/revoke",
  "introspection_endpoint": "http://localhost:8080/oauth/introspect",
  "jwks_uri": "http://localhost:8080/.well-known/jwks.json",
  "scopes_supported": ["openid", "profile", "email", "offline_access"],
  "claims_supported": ["sub", "name", "preferred_username", "email", "email_verified", "picture"]
}
```

**JWKS endpoint** (публичные ключи для проверки подписи JWT):

```
GET /.well-known/jwks.json
```

---

## 10. Scopes

| Scope | Доступ | Claims в id_token / userinfo |
|-------|--------|-------------------------|
| `openid` | Базовая | `sub` (user ID) |
| `profile` | Профиль | `name`, `preferred_username`, `picture` |
| `email` | Email | `email`, `email_verified` |
| `offline_access` | Refresh token | Нет claims (только refresh_token в ответе) |

---

## 11. Ошибки

Стандартные OAuth 2.0 ошибки:

| HTTP Status | error | Описание |
|-------------|-------|----------|
| 400 | `invalid_request` | Неверные параметры запроса |
| 400 | `invalid_grant` | Неверный/просроченный код или refresh_token |
| 400 | `unauthorized_client` | Клиент не авторизован |
| 400 | `invalid_scope` | Неверный scope |
| 401 | `invalid_client` | Неверный client_id или client_secret |
| 401 | `invalid_token` | Неверный или просроченный access_token |

---

## 12. Клиентская библиотека (TypeScript)

**Файл:** `src/integrations/api/oauth.ts` (0 зависимостей, использует Web Crypto API)

### Быстрый старт

```typescript
import { createOAuthClient, getOAuthClient } from "@/integrations/api/oauth"

// Инициализация (один раз при старте приложения)
createOAuthClient({
  clientId: "app_abc123",
  redirectUri: "https://myapp.com/callback",
  // clientSecret: "secret_xyz", // только для confidential clients
  // authorizationBaseUrl: "http://localhost:8080", // по умолчанию — текущий origin
})
```

### Авторизация через редирект (PKCE)

```typescript
const client = getOAuthClient()

// 1. Генерация PKCE + редирект
const { url, verifier } = await client.startAuthorization({
  scope: "openid profile email offline_access",
})

// Сохраняем verifier для callback
sessionStorage.setItem("oauth_verifier", verifier)

// Редиректим пользователя
window.location.href = url.href

// 2. В callback handler (/callback?code=...&state=...)
const savedVerifier = sessionStorage.getItem("oauth_verifier")!
sessionStorage.removeItem("oauth_verifier")

const tokens = await client.handleCallback(
  window.location.href,
  savedVerifier
)

console.log("Access token:", tokens.accessToken)
console.log("ID token:", tokens.idToken)
```

### Авто-refresh токена

```typescript
const client = getOAuthClient()

// При каждом запросе — библиотека сама обновит токен если нужно
const token = await client.getAccessToken()
if (!token) {
  // Нет валидного токена — нужно авторизоваться заново
  return redirectToLogin()
}

fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
})
```

### Получение данных пользователя

```typescript
const client = getOAuthClient()

// Из ID token (без запроса к серверу)
const userFromIDToken = client.getUserFromIDToken()
console.log(userFromIDToken?.name)

// Из /userinfo endpoint
const user = await client.getUserinfo(await client.getAccessToken()!)
console.log(user.preferredUsername, user.email)
```

### Интроспекция токена

```typescript
const client = getOAuthClient()

// Как resource server — с Bearer токеном
const result = await client.introspectToken(
  { token: "eyJhbGciOiJIUzI1NiIs...", tokenTypeHint: "access_token" },
  "my_resource_server_token"
)
console.log("Active:", result.active)
console.log("Scope:", result.scope)
console.log("User:", result.sub)

// С client credentials (без Bearer)
const result2 = await client.introspectToken({
  token: "eyJhbGciOiJIUzI1NiIs...",
  tokenTypeHint: "access_token",
})
```

### Отзыв токена

```typescript
const client = getOAuthClient()

await client.revokeToken({
  token: "eyJhbGciOiJIUzI1NiIs...",
  tokenTypeHint: "access_token",
})
```

### React Hook

```typescript
import { useOAuth } from "@/hooks/useOAuth"

function LoginButton() {
  const { loginWithRedirect, isAuthenticated, user, logout } = useOAuth({
    config: {
      clientId: "app_abc123",
      redirectUri: "https://myapp.com/callback",
    }
  })

  if (isAuthenticated) {
    return (
      <div>
        Привет, {user?.name}!<br/>
        <button onClick={logout}>Выйти</button>
      </div>
    )
  }

  return (
    <button onClick={() => loginWithRedirect("openid profile email")}>
      Войти через gomo6
    </button>
  )
}
```

---

## 13. Полный пример (JavaScript)

```javascript
const CONFIG = {
  clientId: 'app_abc123',
  clientSecret: 'secret_xyz', // необязательно для public client
  redirectUri: 'https://myapp.com/callback',
  authUrl: 'http://localhost:8080/oauth/authorize',
  tokenUrl: 'http://localhost:8080/oauth/token',
  userInfoUrl: 'http://localhost:8080/oauth/userinfo',
};

// 1. Авторизация
function login() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    scope: 'openid profile email',
    state: generateRandomString(16),
  });
  
  window.location.href = `${CONFIG.authUrl}?${params}`;
}

// 2. Обработка callback (/callback?code=...&state=...)
async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  
  if (!code) return;
  
  const response = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.redirectUri,
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });
  
  const tokens = await response.json();
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
  return tokens;
}

// 3. Получение данных пользователя
async function getUserInfo() {
  const token = localStorage.getItem('access_token');
  
  const response = await fetch(CONFIG.userInfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  return await response.json();
}

// 4. Обновление токена
async function refreshToken() {
  const refresh = localStorage.getItem('refresh_token');
  
  const response = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });
  
  const tokens = await response.json();
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
}
```

---

## 14. Полный пример (Python)

```python
import requests

CLIENT_ID = "app_abc123"
CLIENT_SECRET = "secret_xyz"
REDIRECT_URI = "https://myapp.com/callback"
AUTH_URL = "http://localhost:8080/oauth/authorize"
TOKEN_URL = "http://localhost:8080/oauth/token"
USERINFO_URL = "http://localhost:8080/oauth/userinfo"

# 1. Генерируем ссылку для входа
import secrets
state = secrets.token_urlsafe(16)
auth_link = (
    f"{AUTH_URL}?response_type=code"
    f"&client_id={CLIENT_ID}"
    f"&redirect_uri={REDIRECT_URI}"
    f"&scope=openid+profile+email"
    f"&state={state}"
)
print(f"Отправьте пользователя: {auth_link}")

# 2. Получаем code из callback (пользователь нажимает, попадает на ваш callback)
code = input("Вставьте code из URL callback: ")

# 3. Обмениваем на токены
response = requests.post(TOKEN_URL, data={
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
})
tokens = response.json()
access_token = tokens["access_token"]
refresh_token = tokens["refresh_token"]
print(f"Access Token: {access_token[:50]}...")

# 4. Получаем данные пользователя
user_response = requests.get(
    USERINFO_URL,
    headers={"Authorization": f"Bearer {access_token}"}
)
print("User info:", user_response.json())

# 5. Обновление токена
refresh_response = requests.post(TOKEN_URL, data={
    "grant_type": "refresh_token",
    "refresh_token": refresh_token,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
})
new_tokens = refresh_response.json()
print("New access token:", new_tokens["access_token"][:50], "...")
```

---

## 15. Аудит (Audit Log)

Все OAuth действия логируются в таблицу `oauth_audit_log`:

| Действие | Описание |
|----------|----------|
| `authorize` | Пользователь разрешил доступ приложению |
| `token_exchange` | Обмен кода на токены |
| `token_refresh` | Обновление токена |
| `token_revoke` | Отзыв токена |
| `token_introspect` | Интроспекция токена |
| `app_created` | Создано новое приложение |
| `app_updated` | Обновлено приложение |
| `app_deleted` | Удалено приложение |
| `secret_regenerated` | Сброшен client_secret |
| `user_tokens_revoked` | Отозваны все токены пользователя |

Лог содержит user_id, client_id, название приложения, IP адрес и timestamp.

---

## 16. Проверка ID Token (JWT)

ID Token — это JWT, подписанный HS256. Проверить его можно через JWKS endpoint:

```bash
# Получить публичные ключи
curl http://localhost:8080/.well-known/jwks.json

# Декодировать JWT (без проверки подписи)
echo "eyJhbGciOiJIUzI1NiIs..." | cut -d'.' -f2 | base64 -d 2>/dev/null || echo "Декодируйте вручную на jwt.io"
```

ID Token — это JWT, подписанный HS256. Проверить его можно через JWKS endpoint:

```bash
# Получить публичные ключи
curl http://localhost:8080/.well-known/jwks.json

# Декодировать JWT (без проверки подписи)
echo "eyJhbGciOiJIUzI1NiIs..." | cut -d'.' -f2 | base64 -d 2>/dev/null || echo "Декодируйте вручную на jwt.io"