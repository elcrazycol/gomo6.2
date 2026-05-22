import { useState } from 'react'
import { Code2, BookOpen, Box, Link2, Layers, Shield, Zap, Wifi, FileJson, Key, RefreshCw, LogOut, Search, User } from 'lucide-react'

const CodeBlock = ({ code, language = 'typescript' }: { code: string; language?: string }) => {
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
        <button onClick={handleCopy} className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded text-xs transition-colors">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-black/50 rounded-lg p-4 pt-10 overflow-x-auto text-sm font-mono leading-relaxed text-gray-300 border border-gray-700/50">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ─── Code examples ──────────────────────────────────────────────────────────

const codeConstructor = `import { OAuthClient } from './oauth';

const client = new OAuthClient({
  clientId: 'app_abc123',
  redirectUri: 'https://myapp.com/callback',
  authorizationBaseUrl: 'https://gomo6.net',
});`

const codeExchange = `const tokens = await client.exchangeCode({
  code: 'auth_code_from_callback',
  codeVerifier: 'saved_verifier',
});

console.log(tokens.accessToken);   // JWT токен
console.log(tokens.refreshToken);  // для обновления
console.log(tokens.idToken);       // OpenID Connect
console.log(tokens.expiresIn);     // 3600`

const codeUserinfo = `const user = await client.getUserinfo(accessToken);
console.log(user.sub);                // 'user_uuid'
console.log(user.name);              // 'Имя пользователя'
console.log(user.preferredUsername); // 'username'
console.log(user.email);             // 'user@example.com'
console.log(user.picture);           // 'https://...'`

const codeGetToken = `// Автоматически вернёт токен, обновив его при необходимости
const token = await client.getAccessToken();
if (!token) {
  // Пользователь не авторизован — редирект на логин
  return;
}

// Используйте токен для API запросов
const res = await fetch('/api/data', {
  headers: { Authorization: 'Bearer ' + token },
});`

const codeStartAuth = `const { url, verifier } = await client.startAuthorization({
  scope: 'openid profile email',
});

// Сохраните verifier для callback
sessionStorage.setItem('pkce_verifier', verifier);

// Редирект на страницу авторизации
window.location.href = url.toString();`

const codeCallback = `// На странице /callback
const tokens = await client.handleCallback(
  window.location.href,
  sessionStorage.getItem('pkce_verifier'),
  sessionStorage.getItem('oauth_state'),
);`

const codeError = `import { OAuthError } from './oauth';

try {
  const tokens = await client.exchangeCode({ code, codeVerifier });
} catch (err) {
  if (err instanceof OAuthError) {
    console.error(err.error);              // 'invalid_grant'
    console.error(err.errorDescription);   // 'Authorization code expired'
    console.error(err.httpStatus);         // 400
  }
}`

const quickStartCode = `import { OAuthClient } from './oauth';

const oauth = new OAuthClient({
  clientId: 'app_abc123',
  redirectUri: 'https://myapp.com/callback',
  authorizationBaseUrl: 'https://gomo6.net',
});

// 1. Авторизация (кнопка "Войти через gomo6")
const { url, verifier } = await oauth.startAuthorization();
sessionStorage.setItem('pkce_verifier', verifier);
window.location.href = url.toString();

// 2. Обработка callback (страница /callback)
const tokens = await oauth.handleCallback(
  window.location.href,
  sessionStorage.getItem('pkce_verifier'),
);

// 3. Получение данных пользователя
const user = await oauth.getUserinfo(tokens.accessToken);
console.log('Привет,', user.name);

// 4. При следующем заходе — автоматический refresh
const token = await oauth.getAccessToken();
// токен будет обновлён, если истёк`

const useOAuthExample = `import { useOAuth } from './useOAuth';

function LoginButton() {
  const { loginWithRedirect, isAuthenticated, user, logout, isLoading } = useOAuth({
    config: {
      clientId: 'app_abc123',
      redirectUri: 'https://myapp.com/callback',
    },
  });

  if (isLoading) return <div>Загрузка...</div>;

  if (isAuthenticated) {
    return (
      <div>
        <img src={user?.picture} alt="" />
        <span>{user?.name}</span>
        <button onClick={logout}>Выйти</button>
      </div>
    );
  }

  return (
    <button onClick={() => loginWithRedirect()}>
      Войти через gomo6
    </button>
  );
}

// Обработка callback
function CallbackPage() {
  const { handleCallback, error, isLoading } = useOAuth({
    config: { clientId: 'app_abc123', redirectUri: 'https://myapp.com/callback' },
    savedVerifier: sessionStorage.getItem('pkce_verifier'),
    savedState: sessionStorage.getItem('oauth_state'),
    callbackUrl: window.location.href,
  });

  if (isLoading) return <div>Вход...</div>;
  if (error) return <div>Ошибка: {error.message}</div>;

  return null; // Редирект на главную
}`

const fullComponentExample = `import { useEffect } from 'react';
import { useOAuth } from './useOAuth';

function Gomo6Auth() {
  const {
    user, isLoading, isAuthenticated,
    loginWithRedirect, logout, getAccessToken,
  } = useOAuth({
    config: {
      clientId: 'app_abc123',
      redirectUri: 'https://myapp.com/callback',
    },
  });

  useEffect(() => {
    if (isAuthenticated) {
      getAccessToken().then(token => {
        if (token) {
          api.setAuthToken(token);
        }
      });
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return <div className="animate-pulse">Загрузка...</div>;
  }

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-3">
        <img
          src={user.picture}
          alt={user.name}
          className="w-10 h-10 rounded-full"
        />
        <div>
          <div className="font-medium">{user.name}</div>
          <div className="text-sm text-gray-500">@{user.preferredUsername}</div>
        </div>
        <button onClick={logout}>Выйти</button>
      </div>
    );
  }

  return (
    <button onClick={() => loginWithRedirect('openid profile email')}>
      Войти через gomo6
    </button>
  );
}`

// Method card component
function ApiMethod({
  icon: Icon,
  title,
  desc,
  params,
  returns,
  children,
}: {
  icon: any
  title: string
  desc: string
  params?: { name: string; type: string; desc: string }[]
  returns?: string
  children?: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-gray-600/50 transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <Icon className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <code className="text-sm font-semibold text-gray-200">{title}</code>
            {returns && (
              <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                &rarr; {returns}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
        <div className="text-gray-600 shrink-0 mt-1">
          {expanded ? '\u2212' : '+'}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-700/30 pt-3">
          {params && params.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Параметры</h4>
              <div className="space-y-1">
                {params.map((p) => (
                  <div key={p.name} className="flex items-start gap-2 text-xs">
                    <code className="text-gray-300 bg-gray-800 px-1 rounded shrink-0">{p.name}</code>
                    <code className="text-[10px] text-gray-500 shrink-0">{p.type}</code>
                    <span className="text-gray-500">{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

export const OAuthClientLibrary = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Hero */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">TypeScript клиентская библиотека</h1>
            <p className="text-sm text-gray-400">Browser-native OAuth 2.0 + OpenID Connect клиент на Web Crypto API</p>
          </div>
        </div>
      </div>

      {/* Intro */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <Box className="w-5 h-5 text-emerald-400" />
          О библиотеке
        </h2>
        <p className="text-sm text-gray-400 leading-relaxed mb-4">
          Наша TypeScript библиотека — это полноценный OAuth 2.0 клиент, работающий прямо в браузере
          без единой внешней зависимости. Использует Web Crypto API для PKCE, localStorage для хранения
          токенов и предоставляет React hook для удобной интеграции в ваше приложение.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Shield, label: 'Zero dependencies', desc: 'Чистый TypeScript, Web Crypto API' },
            { icon: Zap, label: 'PKCE из коробки', desc: 'S256 code challenge, авто-генерация' },
            { icon: RefreshCw, label: 'Auto-refresh', desc: 'Автоматическое обновление токенов' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-2.5 bg-gray-800/50 rounded-lg p-3 border border-gray-700/30">
              <Icon className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-gray-300">{label}</div>
                <div className="text-[11px] text-gray-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Installation */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          Установка
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Просто скопируйте файл <code className="bg-gray-800 px-1 rounded text-xs">oauth.ts</code> в ваш проект.
          Никаких npm пакетов устанавливать не нужно.
        </p>
      </section>

      {/* Quick Start */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          Быстрый старт
        </h2>
        <p className="text-sm text-gray-400 mb-4">Полная интеграция в 3 шага:</p>
        <CodeBlock language="typescript" code={quickStartCode} />
      </section>

      {/* OAuthClient API Reference */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Box className="w-5 h-5 text-blue-400" />
          OAuthClient API
        </h2>

        <div className="space-y-6">
          <ApiMethod
            icon={Link2}
            title="new OAuthClient(config)"
            desc="Создание экземпляра клиента"
            params={[
              { name: "clientId", type: "string", desc: "OAuth client_id (обязательно)" },
              { name: "clientSecret?", type: "string", desc: "Client secret для confidential клиентов" },
              { name: "redirectUri", type: "string", desc: "Redirect URI, зарегистрированный в приложении" },
              { name: "authorizationBaseUrl?", type: "string", desc: "Базовый URL сервера (по умолчанию — текущий origin)" },
              { name: "storageKey?", type: "string", desc: "Префикс для localStorage (по умолчанию gomo6_oauth)" },
            ]}
          >
            <CodeBlock code={codeConstructor} />
          </ApiMethod>

          <ApiMethod
            icon={Link2}
            title="client.createAuthorizeUrl(params)"
            desc="Создание URL для редиректа на авторизацию"
            params={[
              { name: "scope", type: "string", desc: "Scopes через пробел (e.g. openid profile email)" },
              { name: "codeChallenge", type: "string", desc: "PKCE code challenge" },
              { name: "codeChallengeMethod?", type: "'S256' | 'plain'", desc: "Метод PKCE (по умолчанию S256)" },
              { name: "state?", type: "string", desc: "Для CSRF-защиты" },
              { name: "nonce?", type: "string", desc: "Для ID token replay protection" },
            ]}
            returns="URL"
          />

          <ApiMethod
            icon={Key}
            title="client.exchangeCode(params)"
            desc="Обмен authorization code на токены"
            params={[
              { name: "code", type: "string", desc: "Код из callback URL" },
              { name: "codeVerifier", type: "string", desc: "PKCE verifier (для public клиентов)" },
              { name: "redirectUri?", type: "string", desc: "Redirect URI (по умолчанию из config)" },
            ]}
            returns="Promise&lt;TokenResponse&gt;"
          >
            <CodeBlock code={codeExchange} />
          </ApiMethod>

          <ApiMethod
            icon={RefreshCw}
            title="client.refreshToken(refreshToken, scopes?)"
            desc="Обновление access token через refresh token"
            params={[
              { name: "refreshToken", type: "string", desc: "Refresh token" },
              { name: "scopes?", type: "string", desc: "Опционально — новые scopes" },
            ]}
            returns="Promise&lt;TokenResponse&gt;"
          />

          <ApiMethod
            icon={LogOut}
            title="client.revokeToken(params)"
            desc="Отзыв токена"
            params={[
              { name: "token", type: "string", desc: "Access или refresh token" },
              { name: "tokenTypeHint?", type: "'access_token' | 'refresh_token'", desc: "Подсказка типа токена" },
            ]}
            returns="Promise&lt;void&gt;"
          />

          <ApiMethod
            icon={Search}
            title="client.introspectToken(params, accessToken?)"
            desc="Интроспекция токена (RFC 7662)"
            params={[
              { name: "token", type: "string", desc: "Токен для проверки" },
              { name: "tokenTypeHint?", type: "string", desc: "access_token или refresh_token" },
              { name: "accessToken?", type: "string", desc: "Bearer token ресурс-сервера" },
            ]}
            returns="Promise&lt;IntrospectResponse&gt;"
          />

          <ApiMethod
            icon={User}
            title="client.getUserinfo(accessToken)"
            desc="Получение информации о пользователе"
            params={[{ name: "accessToken", type: "string", desc: "Валидный access token" }]}
            returns="Promise&lt;UserInfoResponse&gt;"
          >
            <CodeBlock code={codeUserinfo} />
          </ApiMethod>

          <ApiMethod
            icon={Wifi}
            title="client.fetchOpenIDConfig()"
            desc="Загрузка OpenID Connect discovery configuration"
            returns="Promise&lt;OpenIDConfiguration&gt;"
          />

          <ApiMethod
            icon={Key}
            title="client.getAccessToken()"
            desc="Получение валидного access token с авто-refresh"
            returns="Promise&lt;string | null&gt;"
          >
            <CodeBlock code={codeGetToken} />
          </ApiMethod>

          <ApiMethod
            icon={Layers}
            title="client.saveTokens() / loadTokens() / clearTokens()"
            desc="Управление хранением токенов в localStorage"
            returns="void | TokenStore | null"
          />

          <ApiMethod
            icon={Shield}
            title="client.hasValidAccessToken(leewaySeconds?)"
            desc="Проверка валидности сохранённого access token"
            returns="boolean"
          />

          <ApiMethod
            icon={Zap}
            title="client.startAuthorization(params)"
            desc="Полный PKCE flow в один вызов"
            params={[
              { name: "scope?", type: "string", desc: "По умолчанию openid profile email" },
              { name: "state?", type: "string", desc: "Для CSRF (по умолчанию randomUUID)" },
              { name: "nonce?", type: "string", desc: "Для ID token (по умолчанию randomUUID)" },
            ]}
            returns="Promise&lt;{ url: URL; verifier: string }&gt;"
          >
            <CodeBlock code={codeStartAuth} />
          </ApiMethod>

          <ApiMethod
            icon={Link2}
            title="client.handleCallback(callbackUrl, savedVerifier, savedState?)"
            desc="Обработка callback — извлекает code, валидирует state, обменивает на токены и сохраняет"
            params={[
              { name: "callbackUrl", type: "string", desc: "URL callback (по умолчанию window.location.href)" },
              { name: "savedVerifier", type: "string", desc: "Сохранённый PKCE verifier" },
              { name: "savedState?", type: "string", desc: "Сохранённый state для проверки" },
            ]}
            returns="Promise&lt;TokenResponse&gt;"
          >
            <CodeBlock code={codeCallback} />
          </ApiMethod>
        </div>
      </section>

      {/* PKCE Utilities */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          PKCE Utilities
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Отдельные функции для генерации PKCE, если вы предпочитаете свой flow:
        </p>
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-300">generateCodeVerifier()</span>
              <span className="text-[10px] text-gray-500">&rarr; string</span>
            </div>
            <p className="text-xs text-gray-400">Генерирует криптографически случайный code verifier (RFC 7636, 48 байт &rarr; 64 символа base64url).</p>
          </div>
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-300">generateCodeChallenge(verifier)</span>
              <span className="text-[10px] text-gray-500">&rarr; Promise&lt;string&gt;</span>
            </div>
            <p className="text-xs text-gray-400">Вычисляет S256 code challenge из verifier через Web Crypto API. Использует SHA-256.</p>
          </div>
        </div>
      </section>

      {/* JWT Utilities */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <FileJson className="w-5 h-5 text-purple-400" />
          JWT Utilities
        </h2>
        <p className="text-sm text-gray-400 mb-4">Вспомогательные функции для работы с JWT токенами:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { name: "decodeJWT&lt;T&gt;(token)", returns: "T | null", desc: "Декодирует JWT payload без проверки подписи" },
            { name: "isJWTExpired(token, leeway?)", returns: "boolean", desc: "Проверяет, истёк ли токен по exp claim (по умолчанию leeway 30s)" },
            { name: "getJWTId(token)", returns: "string | null", desc: "Извлекает jti (JWT ID) из токена" },
          ].map(({ name, returns, desc }) => (
            <div key={name} className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
              <div className="text-xs font-semibold text-gray-300 mb-1">{name}</div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-gray-500">&rarr;</span>
                <code className="text-[10px] text-purple-400">{returns}</code>
              </div>
              <p className="text-[11px] text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* useOAuth React Hook */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-amber-400" />
          useOAuth React Hook
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          React hook для удобной интеграции OAuth в ваше приложение. Управляет состоянием,
          автоматически загружает токены, обрабатывает callback и обновляет профиль пользователя.
        </p>

        <CodeBlock code={useOAuthExample} language="typescript" />

        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold text-white">Параметры хука</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-700/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50 border-b border-gray-700/50">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-300 text-xs uppercase">Параметр</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-300 text-xs uppercase">Тип</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-300 text-xs uppercase">Описание</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                <tr className="hover:bg-gray-800/30"><td className="py-2 px-3 text-xs"><code className="text-gray-300">config</code></td><td className="py-2 px-3 text-xs text-gray-400"><code>OAuthClientConfig</code></td><td className="py-2 px-3 text-xs text-gray-500">Конфигурация клиента</td></tr>
                <tr className="hover:bg-gray-800/30"><td className="py-2 px-3 text-xs"><code className="text-gray-300">autoLoad?</code></td><td className="py-2 px-3 text-xs text-gray-400"><code>boolean</code></td><td className="py-2 px-3 text-xs text-gray-500">Авто-загрузка токенов (по умолч. true)</td></tr>
                <tr className="hover:bg-gray-800/30"><td className="py-2 px-3 text-xs"><code className="text-gray-300">callbackUrl?</code></td><td className="py-2 px-3 text-xs text-gray-400"><code>string</code></td><td className="py-2 px-3 text-xs text-gray-500">URL для обработки callback</td></tr>
                <tr className="hover:bg-gray-800/30"><td className="py-2 px-3 text-xs"><code className="text-gray-300">savedVerifier?</code></td><td className="py-2 px-3 text-xs text-gray-400"><code>string</code></td><td className="py-2 px-3 text-xs text-gray-500">Сохранённый PKCE verifier</td></tr>
                <tr className="hover:bg-gray-800/30"><td className="py-2 px-3 text-xs"><code className="text-gray-300">savedState?</code></td><td className="py-2 px-3 text-xs text-gray-400"><code>string</code></td><td className="py-2 px-3 text-xs text-gray-500">Сохранённый state для проверки</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-white mb-3">Возвращаемые значения</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { name: "client", t: "OAuthClient", desc: "Экземпляр клиента" },
              { name: "accessToken", t: "string | null", desc: "Текущий access token" },
              { name: "refreshToken", t: "string | null", desc: "Refresh token" },
              { name: "idToken", t: "string | null", desc: "OpenID ID token" },
              { name: "user", t: "UserInfoResponse | null", desc: "Данные пользователя" },
              { name: "isAuthenticated", t: "boolean", desc: "Авторизован ли пользователь" },
              { name: "isLoading", t: "boolean", desc: "Загрузка состояния" },
              { name: "isExpired", t: "boolean", desc: "Токен истёк" },
              { name: "error", t: "OAuthError | null", desc: "Последняя ошибка" },
              { name: "loginWithRedirect()", t: "Promise&lt;URL&gt;", desc: "Начать авторизацию" },
              { name: "handleCallback()", t: "Promise&lt;void&gt;", desc: "Обработать callback" },
              { name: "logout()", t: "void", desc: "Выйти" },
              { name: "getAccessToken()", t: "Promise&lt;string | null&gt;", desc: "Получить токен (с refresh)" },
              { name: "refresh()", t: "Promise&lt;void&gt;", desc: "Принудительно обновить" },
            ].map(({ name, t, desc }) => (
              <div key={name} className="flex items-center gap-2 text-xs bg-gray-800/30 rounded-lg p-2.5 border border-gray-700/30">
                <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">{name}</code>
                <span className="text-gray-500 flex-1">{t}</span>
                <code className="text-[10px] text-gray-500">{desc}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Singleton Factory */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Link2 className="w-5 h-5 text-blue-400" />
          Singleton Factory
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Для простых приложений с одним OAuth провайдером:
        </p>
        <div className="space-y-3">
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-1"><code>createOAuthClient(config)</code></div>
            <p className="text-[11px] text-gray-500">Создаёт и сохраняет глобальный экземпляр OAuthClient.</p>
          </div>
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-1"><code>getOAuthClient()</code></div>
            <p className="text-[11px] text-gray-500">Возвращает глобальный экземпляр. Throws если не инициализирован.</p>
          </div>
        </div>
      </section>

      {/* Error Handling */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Shield className="w-5 h-5 text-red-400" />
          Обработка ошибок
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Все ошибки типизированы как <code className="bg-gray-800 px-1 rounded text-xs">OAuthError</code>:
        </p>
        <CodeBlock code={codeError} />
      </section>

      {/* Full Example */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-purple-400" />
          Полный пример компонента
        </h2>
        <p className="text-sm text-gray-400 mb-4">Готовый React компонент с логином через gomo6:</p>
        <CodeBlock code={fullComponentExample} />
      </section>

    </div>
  )
}
