import { useState } from 'react'
import { ArrowLeftRight, Shield, Lock, Key, Hash, FileCode } from 'lucide-react'

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

const curlAuthorize = `# Откройте в браузере:
http://localhost:8080/oauth/authorize?response_type=code&client_id=app_abc123&redirect_uri=https://myapp.com/callback&scope=openid+profile+email&state=xyz789`

const curlToken = `curl -X POST http://localhost:8080/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=AUTHORIZATION_CODE" \\
  -d "redirect_uri=https://myapp.com/callback" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`

const pkceCode = `// Генерация PKCE
async function generatePKCE() {
  const verifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}`

const tokenResponse = `{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_abc123...",
  "id_token": "eyJhbGciOiJIUzI1NiIs...",
  "scope": "openid profile email"
}`

export const OAuthAuthorization = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Авторизация</h1>
        <p className="text-gray-400">OAuth 2.0 Authorization Code flow с поддержкой PKCE</p>
      </div>

      {/* Flow diagram */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Как это работает</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            { step: '1', icon: ArrowLeftRight, title: 'Редирект', desc: 'Пользователь нажимает «Войти через gomo6»' },
            { step: '2', icon: Shield, title: 'Подтверждение', desc: 'Пользователь подтверждает доступ на consent screen' },
            { step: '3', icon: FileCode, title: 'Callback', desc: 'Вы получаете authorization code' },
            { step: '4', icon: Key, title: 'Токены', desc: 'Обмениваете code на access + refresh токены' },
          ].map(({ step, icon: Icon, title, desc }) => (
            <div key={step} className="text-center p-4 rounded-lg bg-gray-800/50 border border-gray-700/30">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-2">
                <span className="text-xs font-bold text-blue-400">{step}</span>
              </div>
              <Icon className="w-5 h-5 text-blue-400 mx-auto mb-1.5" />
              <div className="text-sm font-medium text-gray-200">{title}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 1. Authorize Redirect */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-blue-400" />
          Редирект на авторизацию
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Создайте ссылку «Войти через gomo6» на вашем сайте. Пользователь будет перенаправлен на consent screen gomo6.
        </p>
        <CodeBlock language="html" code={curlAuthorize} />
        <div className="mt-4 bg-gray-800/30 border border-gray-700/30 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Параметры запроса</h3>
          <div className="space-y-2">
            <ParamRow name="response_type" value="code" desc="Всегда authorization_code" required />
            <ParamRow name="client_id" value="app_abc123" desc="ID вашего приложения из Dev Dashboard" required />
            <ParamRow name="redirect_uri" value="https://myapp.com/callback" desc="Должен быть в списке разрешённых URI приложения" required />
            <ParamRow name="scope" value="openid profile email" desc="Через пробел. openid обязателен" required />
            <ParamRow name="state" value="xyz789" desc="Рандомная строка для CSRF-защиты (рекомендуется)" />
            <ParamRow name="code_challenge" value="E9Melhoa..." desc="PKCE challenge (для public клиентов — обязательно)" />
            <ParamRow name="code_challenge_method" value="S256" desc="Метод PKCE. S256 или plain" />
          </div>
        </div>
      </section>

      {/* 2. PKCE */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-400" />
          PKCE (Proof Key for Code Exchange)
        </h2>
        <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-amber-300 mb-1">Обязательно для public клиентов</h3>
              <p className="text-xs text-gray-400">
                Если ваше приложение не может безопасно хранить client_secret (SPA, мобильные), используйте PKCE.
                Наша клиентская библиотека поддерживает PKCE «из коробки».
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-sm text-gray-400 mb-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
            <Hash className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-300">1. </strong>
              Сгенерируйте <code className="bg-gray-800 px-1 rounded text-xs">code_verifier</code> — случайная строка 43-128 символов (a-z, A-Z, 0-9, -, _, ~, .,)
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
            <Hash className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-300">2. </strong>
              Вычислите <code className="bg-gray-800 px-1 rounded text-xs">code_challenge</code> = SHA-256(code_verifier) в base64url-формате
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
            <Hash className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-300">3. </strong>
              Передайте challenge в authorize endpoint, а verifier сохраните для обмена кода
            </div>
          </div>
        </div>
        <CodeBlock language="javascript" code={pkceCode} />
      </section>

      {/* 3. Code Exchange */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <FileCode className="w-5 h-5 text-blue-400" />
          Обмен кода на токены
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          После подтверждения пользователем вы получите <code className="bg-gray-800 px-1 rounded text-xs">code</code> в callback URL.
          Обменяйте его на access token:
        </p>
        <CodeBlock language="bash" code={curlToken} />
        <div className="mt-4 bg-gray-800/30 border border-gray-700/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Ответ</h3>
          </div>
          <pre className="text-xs font-mono text-gray-400">{tokenResponse}</pre>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-1">Параметры запроса</div>
            <ul className="space-y-1 text-xs text-gray-400">
              <li><code className="text-gray-300">grant_type</code> — <code className="text-gray-300">authorization_code</code></li>
              <li><code className="text-gray-300">code</code> — код из callback</li>
              <li><code className="text-gray-300">redirect_uri</code> — должен совпадать с authorize</li>
              <li><code className="text-gray-300">client_id</code> — ID приложения</li>
              <li><code className="text-gray-300">client_secret</code> — для confidential клиентов</li>
              <li><code className="text-gray-300">code_verifier</code> — для PKCE (public клиенты)</li>
            </ul>
          </div>
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-1">Ответ</div>
            <ul className="space-y-1 text-xs text-gray-400">
              <li><code className="text-gray-300">access_token</code> — JWT, срок 1 час</li>
              <li><code className="text-gray-300">refresh_token</code> — для обновления</li>
              <li><code className="text-gray-300">id_token</code> — JWT с информацией о пользователе</li>
              <li><code className="text-gray-300">expires_in</code> — срок в секундах</li>
            </ul>
          </div>
        </div>
      </section>

    </div>
  )
}

const ParamRow = ({ name, value, desc, required }: { name: string; value: string; desc: string; required?: boolean }) => (
  <div className="flex items-start gap-3 text-xs">
    <div className="flex items-center gap-1.5 min-w-[180px]">
      <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">{name}</code>
      {required && <span className="text-[10px] text-red-400">*</span>}
    </div>
    <code className="text-gray-500 min-w-[120px]">{value}</code>
    <span className="text-gray-500 flex-1">{desc}</span>
  </div>
)
