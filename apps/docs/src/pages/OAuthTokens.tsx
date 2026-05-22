import { useState } from 'react'
import { RefreshCw, XCircle, Search, Clock, AlertTriangle } from 'lucide-react'

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
  -H "Authorization: Bearer RESOURCE_SERVER_TOKEN" \\
  -d "token=ACCESS_TOKEN"`

const introspectResponse = `{
  "active": true,
  "scope": "openid profile email",
  "client_id": "app_abc123",
  "sub": "user_uuid",
  "token_type": "Bearer",
  "exp": 1712345678,
  "iat": 1712342078
}`

export const OAuthTokens = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Управление токенами</h1>
        <p className="text-gray-400">Обновление, отзыв и интроспекция OAuth токенов</p>
      </div>

      {/* Token lifecycle */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400" />
          Жизненный цикл токена
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/30 text-center">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-2">
              <span className="text-xs font-bold text-emerald-400">1</span>
            </div>
            <div className="text-sm font-medium text-gray-200">Получение</div>
            <div className="text-[11px] text-gray-500 mt-1">Authorization code → токены (срок: 1 час)</div>
          </div>
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/30 text-center">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-2">
              <span className="text-xs font-bold text-blue-400">2</span>
            </div>
            <div className="text-sm font-medium text-gray-200">Использование</div>
            <div className="text-[11px] text-gray-500 mt-1">API запросы с Bearer токеном</div>
          </div>
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/30 text-center">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-2">
              <span className="text-xs font-bold text-purple-400">3</span>
            </div>
            <div className="text-sm font-medium text-gray-200">Обновление / Отзыв</div>
            <div className="text-[11px] text-gray-500 mt-1">Refresh при истечении или Revoke при выходе</div>
          </div>
        </div>
      </div>

      {/* Refresh */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-400" />
          Обновление токена
        </h2>
        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-blue-300 mb-1">Когда access_token истекает</h3>
              <p className="text-xs text-gray-400">
                Access token живёт 1 час. Для получения нового используйте refresh token.
                Требуется scope <code className="bg-gray-800 px-1 rounded text-xs">offline_access</code> при авторизации.
              </p>
            </div>
          </div>
        </div>
        <CodeBlock language="bash" code={curlRefresh} />
        <div className="mt-4 text-xs text-gray-400 space-y-1">
          <p><strong className="text-gray-300">Параметры:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 ml-2">
            <li><code className="bg-gray-800 px-1 rounded">grant_type</code> — <code className="bg-gray-800 px-1 rounded">refresh_token</code></li>
            <li><code className="bg-gray-800 px-1 rounded">refresh_token</code> — ваш refresh token</li>
            <li><code className="bg-gray-800 px-1 rounded">client_id</code> / <code className="bg-gray-800 px-1 rounded">client_secret</code> — для confidential клиентов</li>
          </ul>
        </div>
      </section>

      {/* Revoke */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-400" />
          Отзыв токена
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          При выходе пользователя из вашего приложения рекомендуется отозвать токен.
          Это деактивирует как access, так и refresh токены.
        </p>
        <CodeBlock language="bash" code={curlRevoke} />
        <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-gray-400">
            <strong className="text-gray-300">Важно:</strong> После отзыва токена все API запросы с этим токеном
            будут отклонены с HTTP 401. Сохраните idempotency на клиенте.
          </div>
        </div>
      </section>

      {/* Introspect */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Search className="w-5 h-5 text-purple-400" />
          Интроспекция токена (RFC 7662)
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Проверьте валидность токена. Используется Resource Server'ами для верификации без необходимости
          расшифровывать JWT.
        </p>
        <CodeBlock language="bash" code={curlIntrospect} />
        <div className="mt-4 bg-gray-800/30 border border-gray-700/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Формат ответа</h3>
          </div>
          <pre className="text-xs font-mono text-gray-400">{introspectResponse}</pre>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-2">Аутентификация</div>
            <ul className="space-y-1.5 text-xs text-gray-400">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                Через <code className="bg-gray-800 px-1 rounded text-xs">client_id + client_secret</code>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                Через <code className="bg-gray-800 px-1 rounded text-xs">Authorization: Bearer</code>
              </li>
            </ul>
          </div>
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-2">Ключевые поля ответа</div>
            <ul className="space-y-1.5 text-xs text-gray-400">
              <li><code className="bg-gray-800 px-1 rounded text-xs">active</code> — true/false</li>
              <li><code className="bg-gray-800 px-1 rounded text-xs">scope</code> — разрешённые scopes</li>
              <li><code className="bg-gray-800 px-1 rounded text-xs">sub</code> — ID пользователя</li>
              <li><code className="bg-gray-800 px-1 rounded text-xs">exp</code> — expires timestamp</li>
            </ul>
          </div>
        </div>
      </section>

    </div>
  )
}
