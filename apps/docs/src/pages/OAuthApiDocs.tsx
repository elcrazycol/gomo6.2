import { useState } from 'react'

const CodeBlock = ({ code, language = 'bash' }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group my-4">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{language}</span>
        <button
          onClick={handleCopy}
          className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded text-xs transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-black/50 rounded-lg p-4 pt-10 overflow-x-auto text-sm font-mono leading-relaxed text-gray-300 border border-gray-700/50">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const Section = ({ title, id, children }: { title: string; id: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-20 mb-12">
    <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-gray-700/50">{title}</h2>
    {children}
  </section>
)

const curlToken = `curl -X POST http://localhost:8080/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=AUTHORIZATION_CODE" \\
  -d "redirect_uri=https://myapp.com/callback" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`

const curlUserinfo = `curl http://localhost:8080/oauth/userinfo \\
  -H "Authorization: Bearer ACCESS_TOKEN"`

const curlRefresh = `curl -X POST http://localhost:8080/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=refresh_token" \\
  -d "refresh_token=YOUR_REFRESH_TOKEN" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`

const curlRevoke = `curl -X POST http://localhost:8080/oauth/revoke \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "token=ACCESS_OR_REFRESH_TOKEN" \\
  -d "token_hint=access_token" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`

const curlIntrospect = `curl -X POST http://localhost:8080/oauth/introspect \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "token=ACCESS_TOKEN" \\
  -d "token_type_hint=access_token" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`

const curlIntrospectBearer = `curl -X POST http://localhost:8080/oauth/introspect \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -H "Authorization: Bearer RESOURCE_SERVER_TOKEN" \\
  -d "token=ACCESS_TOKEN"`

const curlAppInfo = `curl "http://localhost:8080/oauth/app-info?client_id=app_abc123"`

const curlAuthorize = `# Откройте в браузере:
http://localhost:8080/oauth/authorize?response_type=code&client_id=app_abc123&redirect_uri=https://myapp.com/callback&scope=openid+profile+email&state=xyz789`

const jsExample = `// Полный пример авторизации через gomo6
const CONFIG = {
  clientId: 'app_abc123',
  clientSecret: 'secret_xyz',
  redirectUri: 'https://myapp.com/callback',
  authUrl: 'http://localhost:8080/oauth/authorize',
  tokenUrl: 'http://localhost:8080/oauth/token',
  userInfoUrl: 'http://localhost:8080/oauth/userinfo',
};

// 1. Редирект на авторизацию
function login() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    scope: 'openid profile email',
    state: crypto.randomUUID(),
  });
  window.location.href = \`\${CONFIG.authUrl}?\${params}\`;
}

// 2. Обработка callback
async function handleCallback() {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return;

  const res = await fetch(CONFIG.tokenUrl, {
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

  const tokens = await res.json();
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
  return tokens;
}

// 3. Получение информации о пользователе
async function getUserInfo() {
  const res = await fetch(CONFIG.userInfoUrl, {
    headers: { Authorization: \`Bearer \${localStorage.getItem('access_token')}\` },
  });
  return res.json();
}`

export const OAuthApiDocs = () => {
  return (
    <div className="text-gray-300 space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">OAuth 2.0 API</h1>
        <p className="text-gray-400">
          Интеграция "Войти через gomo6" для сторонних сайтов. Полностью совместимо с OpenID Connect.
        </p>
      </div>

      {/* Badge */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">OpenID Connect</span>
          <span className="text-sm text-gray-400">Полностью совместимо с OAuth 2.0 и OpenID Connect</span>
          <a
            href="/.well-known/openid-configuration"
            target="_blank"
            className="ml-auto text-sm text-blue-400 hover:underline"
          >
            Discovery →
          </a>
        </div>
      </div>

      {/* 1. Создайте приложение */}
      <Section title="1. Создайте приложение" id="create-app">
        <p className="text-sm text-gray-400 mb-4">
          Зайдите в Dev-панель → "Создать приложение". Укажите название, redirect URI и тип клиента.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-gray-800/50 p-3 border border-gray-700/30">
            <div className="text-xs font-semibold text-white mb-1">Confidential client</div>
            <div className="text-xs text-gray-400">Для серверных приложений. Требует client_secret.</div>
          </div>
          <div className="rounded-lg bg-gray-800/50 p-3 border border-gray-700/30">
            <div className="text-xs font-semibold text-white mb-1">Public client</div>
            <div className="text-xs text-gray-400">Для SPA/React/мобильных. Использует PKCE.</div>
          </div>
        </div>
        <p className="text-sm text-gray-400">
          После создания вы получите <code className="bg-gray-800 px-1 rounded text-xs text-gray-300">client_id</code> и <code className="bg-gray-800 px-1 rounded text-xs text-gray-300">client_secret</code>.
        </p>
      </Section>

      {/* 2. Авторизация */}
      <Section title="2. Редирект на авторизацию" id="authorize">
        <p className="text-sm text-gray-400 mb-4">
          Создайте ссылку "Войти через gomo6" на вашем сайте:
        </p>
        <CodeBlock language="html" code={curlAuthorize} />
        <div className="text-xs text-gray-500 space-y-1 mt-3">
          <p className="text-gray-400 font-medium">Параметры:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><code className="text-gray-300">response_type</code> — всегда <code className="text-gray-300">code</code></li>
            <li><code className="text-gray-300">client_id</code> — ID вашего приложения</li>
            <li><code className="text-gray-300">redirect_uri</code> — должен быть в списке разрешённых</li>
            <li><code className="text-gray-300">scope</code> — через пробел: <code className="text-gray-300">openid profile email</code></li>
            <li><code className="text-gray-300">state</code> — для CSRF-защиты (рекомендуется)</li>
          </ul>
        </div>
      </Section>

      {/* 3. Обмен кода на токены */}
      <Section title="3. Обмен кода на токены" id="token">
        <p className="text-sm text-gray-400 mb-4">
          После подтверждения пользователем вы получите code в callback. Обменяйте его на токены:
        </p>
        <CodeBlock language="bash" code={curlToken} />
        <pre className="text-xs font-mono text-gray-400 bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
{JSON.stringify({
  access_token: "eyJhbGciOiJIUzI1NiIs...",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "rt_abc123...",
  id_token: "eyJhbGciOiJIUzI1NiIs...",
  scope: "openid profile email"
}, null, 2)}
        </pre>
      </Section>

      {/* 4. Userinfo */}
      <Section title="4. Получение данных пользователя" id="userinfo">
        <p className="text-sm text-gray-400 mb-4">
          Используйте access_token для получения информации о пользователе:
        </p>
        <CodeBlock language="bash" code={curlUserinfo} />
        <pre className="text-xs font-mono text-gray-400 bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
{JSON.stringify({
  sub: "user_uuid",
  name: "Имя пользователя",
  preferred_username: "username",
  email: "user@example.com",
  email_verified: true,
  picture: "https://cdn.gomo6.net/avatars/..."
}, null, 2)}
        </pre>
      </Section>

      {/* 5. Refresh */}
      <Section title="5. Обновление токена" id="refresh">
        <p className="text-sm text-gray-400 mb-4">
          Когда access_token истекает, используйте refresh_token (требуется scope <code className="bg-gray-800 px-1 rounded">offline_access</code>):
        </p>
        <CodeBlock language="bash" code={curlRefresh} />
      </Section>

      {/* 6. Revoke */}
      <Section title="6. Отзыв токена" id="revoke">
        <p className="text-sm text-gray-400 mb-4">
          Отзовите токен, когда пользователь выходит из вашего приложения:
        </p>
        <CodeBlock language="bash" code={curlRevoke} />
      </Section>

      {/* 7. Introspect */}
      <Section title="7. Интроспекция токена (RFC 7662)" id="introspect">
        <p className="text-sm text-gray-400 mb-4">
          Проверьте валидность токена через Resource Server:
        </p>
        <p className="text-xs text-gray-500 mb-2">Через client credentials (confidential clients):</p>
        <CodeBlock language="bash" code={curlIntrospect} />
        <p className="text-xs text-gray-500 mb-2">Через Bearer аутентификацию:</p>
        <CodeBlock language="bash" code={curlIntrospectBearer} />
        <pre className="text-xs font-mono text-gray-400 bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
{JSON.stringify({
  active: true,
  scope: "openid profile email",
  client_id: "app_abc123",
  sub: "user_uuid",
  token_type: "Bearer",
  exp: 1712345678,
  iat: 1712342078
}, null, 2)}
        </pre>
      </Section>

      {/* 8. App Info */}
      <Section title="8. Информация о приложении" id="app-info">
        <p className="text-sm text-gray-400 mb-4">
          Получите информацию о приложении для отображения консент-скрина:
        </p>
        <CodeBlock language="bash" code={curlAppInfo} />
      </Section>

      {/* 9. PKCE */}
      <Section title="9. PKCE (для публичных клиентов)" id="pkce">
        <p className="text-sm text-gray-400 mb-4">
          Для SPA приложений, которые не могут хранить client_secret, используйте PKCE:
        </p>
        <div className="text-xs text-gray-500 space-y-2 mb-4">
          <p>1. Сгенерируйте <code className="bg-gray-800 px-1 rounded text-gray-300">code_verifier</code> (случайная строка 43-128 символов)</p>
          <p>2. Вычислите <code className="bg-gray-800 px-1 rounded text-gray-300">code_challenge</code> = SHA-256(code_verifier) в base64url</p>
          <p>3. Передайте challenge в authorize + verifier в token</p>
        </div>
        <CodeBlock language="javascript" code={`// Генерация PKCE
async function generatePKCE() {
  const verifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}`} />
      </Section>

      {/* 10. Scopes */}
      <Section title="10. Scopes" id="scopes">
        <p className="text-sm text-gray-400 mb-4">Какие данные запрашивать и что вы получите:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 px-3 font-semibold text-gray-300">Scope</th>
                <th className="text-left py-2 px-3 font-semibold text-gray-300">Доступ</th>
                <th className="text-left py-2 px-3 font-semibold text-gray-300">Claims</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-700/50">
                <td className="py-2 px-3"><code className="bg-gray-800 px-1 rounded text-xs text-gray-300">openid</code></td>
                <td className="py-2 px-3 text-gray-400">Базовая авторизация</td>
                <td className="py-2 px-3"><code className="text-xs text-gray-400">sub</code></td>
              </tr>
              <tr className="border-b border-gray-700/50">
                <td className="py-2 px-3"><code className="bg-gray-800 px-1 rounded text-xs text-gray-300">profile</code></td>
                <td className="py-2 px-3 text-gray-400">Профиль</td>
                <td className="py-2 px-3"><code className="text-xs text-gray-400">name</code>, <code className="text-xs text-gray-400">preferred_username</code>, <code className="text-xs text-gray-400">picture</code></td>
              </tr>
              <tr className="border-b border-gray-700/50">
                <td className="py-2 px-3"><code className="bg-gray-800 px-1 rounded text-xs text-gray-300">email</code></td>
                <td className="py-2 px-3 text-gray-400">Email</td>
                <td className="py-2 px-3"><code className="text-xs text-gray-400">email</code>, <code className="text-xs text-gray-400">email_verified</code></td>
              </tr>
              <tr>
                <td className="py-2 px-3"><code className="bg-gray-800 px-1 rounded text-xs text-gray-300">offline_access</code></td>
                <td className="py-2 px-3 text-gray-400">Refresh token</td>
                <td className="py-2 px-3"><code className="text-xs text-gray-400">—</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 11. Endpoints */}
      <Section title="11. Endpoint'ы" id="endpoints">
        <p className="text-sm text-gray-400 mb-4">Все OAuth 2.0 / OpenID Connect endpoint'ы:</p>
        <div className="space-y-1">
          <EndpointRow method="GET" path="/oauth/authorize" desc="Авторизация пользователя" auth="Нет" />
          <EndpointRow method="POST" path="/oauth/token" desc="Обмен кода на токены" auth="client_secret" />
          <EndpointRow method="POST" path="/oauth/revoke" desc="Отзыв токена" auth="client_secret" />
          <EndpointRow method="GET" path="/oauth/userinfo" desc="Информация о пользователе" auth="Bearer" />
          <EndpointRow method="POST" path="/oauth/introspect" desc="Интроспекция токена" auth="Bearer / client_id" />
          <EndpointRow method="GET" path="/oauth/app-info" desc="Информация о приложении" auth="Нет" />
          <EndpointRow method="GET" path="/.well-known/openid-configuration" desc="OpenID Discovery" auth="Нет" />
          <EndpointRow method="GET" path="/.well-known/jwks.json" desc="Публичные ключи JWT" auth="Нет" />
        </div>
      </Section>

      {/* 12. JavaScript Example */}
      <Section title="12. Пример на JavaScript" id="example-js">
        <p className="text-sm text-gray-400 mb-4">Полный пример интеграции с gomo6 OAuth:</p>
        <CodeBlock language="javascript" code={jsExample} />
        <p className="text-sm text-gray-400 mt-4">
          Также доступна <a href="/oauth/ts-client" className="text-blue-400 hover:underline">TypeScript клиентская библиотека</a> с поддержкой PKCE, авто-refresh и React hook.
        </p>
      </Section>

      {/* 13. Audit Log */}
      <Section title="13. Audit Log" id="audit">
        <p className="text-sm text-gray-400 mb-4">Все действия в OAuth логируются для безопасности:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ["authorize", "Пользователь разрешил доступ"],
            ["token_exchange", "Обмен кода на токены"],
            ["token_refresh", "Обновление токена"],
            ["token_revoke", "Отзыв токена"],
            ["token_introspect", "Интроспекция токена"],
            ["app_created", "Создание приложения"],
            ["app_updated", "Обновление приложения"],
            ["app_deleted", "Удаление приложения"],
            ["secret_regenerated", "Сброс client_secret"],
            ["user_tokens_revoked", "Отзыв токенов пользователя"],
          ].map(([action, desc]) => (
            <div key={action} className="flex items-center gap-2 text-xs bg-gray-800/30 rounded p-2 border border-gray-700/30">
              <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">{action}</code>
              <span className="text-gray-500">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Лог содержит user_id, client_id, название приложения, IP адрес и timestamp.
        </p>
      </Section>
    </div>
  )
}

const EndpointRow = ({ method, path, desc, auth }: { method: string; path: string; desc: string; auth: string }) => {
  const colorMap: Record<string, string> = {
    GET: "text-green-400",
    POST: "text-blue-400",
    PUT: "text-orange-400",
    DELETE: "text-red-400",
  }

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-700/30 last:border-0">
      <span className={`text-xs font-mono font-bold w-14 shrink-0 ${colorMap[method] || ''}`}>{method}</span>
      <code className="text-xs text-gray-300 flex-1">{path}</code>
      <span className="text-xs text-gray-500 hidden sm:block flex-1">{desc}</span>
      <span className="text-[10px] text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded shrink-0">{auth}</span>
    </div>
  )
}
